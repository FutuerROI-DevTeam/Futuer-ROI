// 公開前のDB整合チェック（#179）。対象checkoutのmigrationファイルと認証schema定義を、接続先DBの
// 現在状態と照合する。DBを変更しない（DDL・DML・migration適用・schema_migrationsの作成を行わない）。
// 既存runner（migrate.ts）と同じSQL選択規則・名前順・SHA-256を使うが、適用関数は呼ばない。
import { getMigrations } from 'better-auth/db/migration';
import { getSchema } from 'better-auth/db';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { authSchemaOptions } from '../auth/options.ts';
import { defaultMigrationsDir, MIGRATION_FILE, migrationChecksum } from './migrate.ts';
import { matchesMigrationChecksum } from './migration-checksum.ts';

export type FindingCode =
  | 'empty_database'
  | 'history_table_missing'
  | 'pending_migration'
  | 'checksum_mismatch'
  | 'unknown_history'
  | 'auth_table_missing'
  | 'auth_column_missing'
  | 'auth_index_missing'
  | 'auth_unsafe_change'
  | 'auth_introspection_failed'
  | 'db_connection'
  | 'db_authentication'
  | 'db_permission'
  | 'timeout'
  | 'unknown_error';

// auth_unsafe_changeのtargetは固定版ライブラリの説明文で、文言は版依存。機械判定はcodeで行う。
export type Finding = { code: FindingCode; target?: string };

export type DatabaseStatus = 'ok' | 'connection' | 'authentication' | 'permission' | 'timeout' | 'unknown';

export type SchemaCheckReport = {
  version: 1;
  /** ok: 差分なし。drift: 差分あり。unavailable: 接続・timeout・取得失敗で判定できない。 */
  status: 'ok' | 'drift' | 'unavailable';
  findings: Finding[];
  checkout: { files: { name: string; sha256: string }[] };
  app: {
    historyTable: 'present' | 'missing';
    applied: string[];
    pending: string[];
    checksumMismatch: string[];
    /** DBにあるがcheckoutにない履歴。対象checkoutとの互換性未確認として失敗にする。 */
    unknownHistory: string[];
  } | null;
  auth: {
    status: 'ok' | 'drift' | 'failed';
    missingTables: string[];
    missingColumns: { table: string; column: string }[];
    /** table定義のindexes由来だけ。field単位のindex（session_userId_idx等）の欠落は固定版の差分計画に現れず検出しない。 */
    missingIndexes: { table: string; index: string }[];
    unsafeChanges: string[];
    /** 固定版ライブラリの警告（型差・nullable差）。失敗にはしない。 */
    warnings: string[];
  } | null;
  database: { status: DatabaseStatus };
};

export type SchemaCheckOptions = {
  connectionString: string;
  migrationsDir?: URL;
  /** 接続・1query・1文それぞれの上限。既定5秒。 */
  queryTimeoutMs?: number;
  /** DB検査の上限。既定30秒。終了処理はqueryTimeoutMsを上限に別途待つ。 */
  totalTimeoutMs?: number;
};

/** pg_stat_activityで検査の接続を識別し、終了後に接続が残っていないことを確認するための名前。 */
export const SCHEMA_CHECK_APPLICATION_NAME = 'futureroi-schema-check';
export const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

export class SchemaCheckConfigurationError extends Error {}

function validateTimeout(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 600_000) {
    throw new SchemaCheckConfigurationError(`${name} は1〜600000の整数で指定してください。`);
  }
}

export async function listCheckoutMigrations(dir: URL = defaultMigrationsDir): Promise<{ name: string; sha256: string }[]> {
  try {
    const names = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
    // 間違った空directoryを「差分なし」としない。原文のpathや例外は出さない。
    if (names.length === 0) throw new Error('no numbered SQL');
    const files: { name: string; sha256: string }[] = [];
    for (const name of names) files.push({ name, sha256: migrationChecksum(await readFile(new URL(name, dir), 'utf8')) });
    return files;
  } catch {
    throw new SchemaCheckConfigurationError('migrationsDirの番号付きSQLを読み取れません。directoryとファイルを確認してください。');
  }
}

// 例外のname/message/detailは出さず、既知のcodeだけを固定の分類へ変換する（startup-error.tsと同じ考え方）。
const connectionCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01', '3D000', '57P01', '57P02', '57P03']);
const authenticationCodes = new Set(['28P01', '28000']);
const permissionCodes = new Set(['42501']);
// 57014: statement_timeout、55P03: lock_timeout、25P03: idle_in_transaction_session_timeout
const timeoutCodes = new Set(['57014', '55P03', '25P03']);
const timeoutMessages = new Set(['Query read timeout', 'timeout exceeded when trying to connect', 'Connection terminated due to connection timeout']);

class TotalTimeoutError extends Error {}

export function classifyDatabaseError(error: unknown): DatabaseStatus {
  if (error instanceof TotalTimeoutError) return 'timeout';
  if (typeof error !== 'object' || error === null) return 'unknown';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code !== undefined) {
    if (timeoutCodes.has(code)) return 'timeout';
    if (connectionCodes.has(code)) return 'connection';
    if (authenticationCodes.has(code)) return 'authentication';
    if (permissionCodes.has(code)) return 'permission';
  }
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (timeoutMessages.has(message)) return 'timeout';
  return 'unknown';
}

const databaseFinding: Record<Exclude<DatabaseStatus, 'ok'>, FindingCode> = {
  connection: 'db_connection', authentication: 'db_authentication', permission: 'db_permission', timeout: 'timeout', unknown: 'unknown_error',
};

// 検査専用pool。全接続をsession単位でread-onlyにし、DDL/DML（Better AuthのKysely経路を含む）をDB側で拒否させる。
// 限界: session設定でありroleの権限は制限しない。接続roleがownerならその権限自体は残る。
function createSchemaCheckPool(o: { connectionString: string; queryTimeoutMs: number }): pg.Pool {
  const ms = Math.trunc(o.queryTimeoutMs);
  const pool = new pg.Pool({
    connectionString: o.connectionString,
    application_name: SCHEMA_CHECK_APPLICATION_NAME,
    max: 2,
    connectionTimeoutMillis: ms,
    query_timeout: ms,
    keepAlive: true,
    // 接続URIの設定より後に適用し、client側期限が無効化されていてもserver側で打ち切る。
    onConnect: async (client) => {
      await client.query(`set default_transaction_read_only = on; set statement_timeout = ${ms}; set lock_timeout = ${ms}; set idle_in_transaction_session_timeout = ${ms}`);
    },
  });
  pool.on('error', () => { /* idle接続の切断は検査結果の分類で扱う。原文は出さない。 */ });
  return pool;
}

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  const x = a.target ?? '';
  const y = b.target ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
}

async function checkAppMigrations(pool: pg.Pool, files: { name: string; sha256: string }[]): Promise<NonNullable<SchemaCheckReport['app']>> {
  const exists = (await pool.query<{ name: string | null }>(`select to_regclass('schema_migrations')::text as name`)).rows[0]?.name != null;
  if (!exists) {
    return { historyTable: 'missing', applied: [], pending: files.map((f) => f.name), checksumMismatch: [], unknownHistory: [] };
  }
  const recorded = new Map(
    (await pool.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]),
  );
  const applied: string[] = [];
  const pending: string[] = [];
  const checksumMismatch: string[] = [];
  for (const file of files) {
    const previous = recorded.get(file.name);
    if (previous === undefined) pending.push(file.name);
    else if (!matchesMigrationChecksum(file.name, file.sha256, previous)) checksumMismatch.push(file.name);
    else applied.push(file.name);
    recorded.delete(file.name);
  }
  return { historyTable: 'present', applied, pending, checksumMismatch, unknownHistory: sortStrings(recorded.keys()) };
}

async function checkAuthSchema(pool: pg.Pool): Promise<NonNullable<SchemaCheckReport['auth']>> {
  const warnings: string[] = [];
  const options = authSchemaOptions(pool);
  // runMigrations/compileMigrationsは呼ばない。差分計画の取得だけ行う（introspectionと select 1 limit 1 のみ）。
  const plan = await getMigrations(
    { ...options, logger: { level: 'warn', log: (level, message) => { if (level === 'warn' || level === 'error') warnings.push(message); } } },
    { throwOnUnsafe: false },
  );
  const missingTables = sortStrings(plan.toBeCreated.map((t) => t.table));
  // 固定版の差分計画は既存tableの暗黙idを比較しない。getSchemaの実名にidを加え、
  // search_pathで解決したtableの列の存在だけを別途読む（型・PK・field indexの全面監査ではない）。
  const schema = getSchema(options);
  const tables = Object.keys(schema).filter((table) => !schema[table]!.disableMigrations);
  const actual = (await pool.query<{ table: string; column: string }>(`
    select expected.table_name as "table", a.attname as "column"
    from unnest($1::text[]) as expected(table_name)
    join pg_attribute a on a.attrelid = to_regclass(format('%I', expected.table_name))
    where a.attnum > 0 and not a.attisdropped`, [tables])).rows;
  const present = new Set(actual.map((c) => `${c.table}\0${c.column}`));
  const absentTables = new Set(missingTables);
  const missingColumns = tables
    .filter((table) => !absentTables.has(table))
    .flatMap((table) => [...new Set(['id', ...Object.keys(schema[table]!.fields)])]
      .filter((column) => !present.has(`${table}\0${column}`)).map((column) => ({ table, column })))
    .sort((a, b) => (a.table !== b.table ? (a.table < b.table ? -1 : 1) : a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
  const missingIndexes = plan.toBeAddedIndexes
    .map((i) => ({ table: i.table, index: i.name }))
    .sort((a, b) => (a.table !== b.table ? (a.table < b.table ? -1 : 1) : a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
  const unsafeChanges = sortStrings(plan.unsafeChanges);
  const drift = missingTables.length > 0 || missingColumns.length > 0 || missingIndexes.length > 0 || unsafeChanges.length > 0;
  return { status: drift ? 'drift' : 'ok', missingTables, missingColumns, missingIndexes, unsafeChanges, warnings: sortStrings(warnings) };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TotalTimeoutError()), ms); });
  // 期限後に残った側が後から失敗しても未処理rejectionにしない（raceは最初の結果だけを使う）。
  promise.catch(() => undefined);
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function isBetterAuthError(error: unknown): boolean {
  return error instanceof Error && error.name === 'BetterAuthError';
}

async function inspect(pool: pg.Pool, files: { name: string; sha256: string }[]): Promise<Pick<SchemaCheckReport, 'app' | 'auth' | 'database'>> {
  const app = await checkAppMigrations(pool, files);
  try {
    return { app, auth: await checkAuthSchema(pool), database: { status: 'ok' } };
  } catch (error) {
    // index定義の衝突などライブラリ側の失敗。DB接続の失敗は上位で分類する。
    if (!isBetterAuthError(error)) throw error;
    return { app, auth: { status: 'failed', missingTables: [], missingColumns: [], missingIndexes: [], unsafeChanges: [], warnings: [] }, database: { status: 'ok' } };
  }
}

export async function runSchemaCheck(options: SchemaCheckOptions): Promise<SchemaCheckReport> {
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  validateTimeout('queryTimeoutMs', queryTimeoutMs);
  validateTimeout('totalTimeoutMs', totalTimeoutMs);
  const files = await listCheckoutMigrations(options.migrationsDir);
  const pool = createSchemaCheckPool({ connectionString: options.connectionString, queryTimeoutMs });
  let result: Pick<SchemaCheckReport, 'app' | 'auth' | 'database'>;
  try {
    result = await withTimeout(inspect(pool, files), totalTimeoutMs);
  } catch (error) {
    result = { app: null, auth: null, database: { status: classifyDatabaseError(error) } };
  } finally {
    // 失敗・timeout後も接続を残さない。終了自体が止まる場合はCLI側のprocess終了で打ち切る。
    await withTimeout(pool.end(), queryTimeoutMs).catch(() => undefined);
  }
  return buildReport(files, result);
}

function buildReport(files: { name: string; sha256: string }[], r: Pick<SchemaCheckReport, 'app' | 'auth' | 'database'>): SchemaCheckReport {
  const findings: Finding[] = [];
  if (r.database.status !== 'ok') findings.push({ code: databaseFinding[r.database.status] });
  if (r.app) {
    if (r.app.historyTable === 'missing') findings.push({ code: 'history_table_missing' });
    for (const name of r.app.pending) findings.push({ code: 'pending_migration', target: name });
    for (const name of r.app.checksumMismatch) findings.push({ code: 'checksum_mismatch', target: name });
    for (const name of r.app.unknownHistory) findings.push({ code: 'unknown_history', target: name });
  }
  if (r.auth) {
    if (r.auth.status === 'failed') findings.push({ code: 'auth_introspection_failed' });
    for (const table of r.auth.missingTables) findings.push({ code: 'auth_table_missing', target: table });
    for (const c of r.auth.missingColumns) findings.push({ code: 'auth_column_missing', target: `${c.table}.${c.column}` });
    for (const i of r.auth.missingIndexes) findings.push({ code: 'auth_index_missing', target: `${i.table}.${i.index}` });
    for (const message of r.auth.unsafeChanges) findings.push({ code: 'auth_unsafe_change', target: message });
  }
  // 履歴tableも認証の基点table "user" も無い: 空DB（または別物のDB）。個別のfindingsに加えて要約を付ける。
  if (r.app?.historyTable === 'missing' && r.auth?.missingTables.includes('user')) findings.push({ code: 'empty_database' });
  findings.sort(compareFindings);
  const unavailable = r.database.status !== 'ok' || r.auth?.status === 'failed';
  const status: SchemaCheckReport['status'] = unavailable ? 'unavailable' : findings.length === 0 ? 'ok' : 'drift';
  return { version: 1, status, findings, checkout: { files }, app: r.app, auth: r.auth, database: r.database };
}

/** 終了コード: 0 差分なし、1 差分あり、3 判定不能。2 は使い方・設定の誤り（CLI側）。 */
export function exitCodeFor(report: SchemaCheckReport): 0 | 1 | 3 {
  return report.status === 'ok' ? 0 : report.status === 'drift' ? 1 : 3;
}
