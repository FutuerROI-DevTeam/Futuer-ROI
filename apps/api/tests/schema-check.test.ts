// #179 公開前のDB整合チェック。fixtureの準備（migrate・DDL・行挿入）と検査の実行を分け、検査がDBを変更しないことを
// schema・履歴・全合成行値のdigest比較とDDL event triggerで確認する。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after, before } from 'node:test';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';
import { listCheckoutMigrations, runSchemaCheck, SCHEMA_CHECK_APPLICATION_NAME, SchemaCheckConfigurationError, type SchemaCheckReport } from '../src/db/schema-check.ts';
import { createTestDatabase, type TestDatabase } from './helpers/database.ts';

const migrationsUrl = new URL('../migrations/', import.meta.url);
// runnerの結果から期待値を作らず、同じ抽出規則・名前順で独立に列挙する。
const APP_MIGRATIONS = readdirSync(migrationsUrl).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
const apiDir = fileURLToPath(new URL('../', import.meta.url));
const sourceCli = join(apiDir, 'src', 'db', 'schema-check-cli.ts');
let compiledDir: string | undefined;
let compiledCli: string;

// API直下の新規directoryなら、compiledの../../migrationsも実SQLを指す。古いdistは読まず触らない。
before(() => {
  compiledDir = mkdtempSync(join(apiDir, '.schema-check-build-'));
  const tsc = join(apiDir, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', compiledDir], {
    cwd: apiDir, encoding: 'utf8', timeout: 180_000,
  });
  assert.equal(build.status, 0, `${build.error?.message ?? ''}\n${build.stdout}${build.stderr}`);
  compiledCli = join(compiledDir, 'db', 'schema-check-cli.js');
});
after(() => { if (compiledDir) rmSync(compiledDir, { recursive: true, force: true }); });

type Snapshot = Record<string, unknown>;

async function snapshot(pool: pg.Pool): Promise<Snapshot> {
  const columns = (await pool.query(`select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows;
  const indexes = (await pool.query(`select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1`)).rows;
  const constraints = (await pool.query(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def
    from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).rows;
  const tables = (await pool.query<{ table_name: string }>(`select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.table_name);
  const rowCounts: Record<string, number> = {};
  const rowDigests: Record<string, string> = {};
  for (const t of tables) {
    const name = `"${t.replaceAll('"', '""')}"`;
    // jsonbのキー順と行のソートで、物理行順に依存しない。assert失敗時も合成行そのものを出さない。
    const values = (await pool.query<{ value: string }>(`select to_jsonb(r)::text as value from ${name} r`)).rows.map((r) => r.value).sort();
    rowCounts[t] = values.length;
    rowDigests[t] = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  }
  const history = tables.includes('schema_migrations')
    ? (await pool.query('select name, checksum, applied_at from schema_migrations order by name')).rows : null;
  return { columns, indexes, constraints, tables, rowCounts, rowDigests, history };
}

// 検査中にDDLが発行されたら失敗させる。検査結果（status）にも現れるので、黙って通らない。
async function withDdlGuard<T>(pool: pg.Pool, run: () => Promise<T>): Promise<T> {
  await pool.query(`create function schema_check_guard() returns event_trigger language plpgsql as $$
    begin raise exception 'schema-check issued DDL: %', tg_tag; end $$;
    create event trigger schema_check_guard on ddl_command_start execute function schema_check_guard();`);
  try {
    return await run();
  } finally {
    await pool.query('drop event trigger schema_check_guard; drop function schema_check_guard()');
  }
}

async function checkUnchanged(db: TestDatabase, options: Parameters<typeof runSchemaCheck>[0]): Promise<SchemaCheckReport> {
  const before = await snapshot(db.pool);
  const report = await withDdlGuard(db.pool, () => runSchemaCheck(options));
  assert.deepEqual(await snapshot(db.pool), before, 'the check does not change schema, history or rows');
  return report;
}

async function noLeftoverConnections(db: TestDatabase): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const n = (await db.pool.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where application_name = $1', [SCHEMA_CHECK_APPLICATION_NAME])).rows[0]!.n;
    if (n === 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('schema-check connections remain after the check finished');
}

function copyMigrations(t: test.TestContext, names: string[] = APP_MIGRATIONS): string {
  const dir = mkdtempSync(join(tmpdir(), 'futureroi-schema-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of names) writeFileSync(join(dir, name), readFileSync(new URL(name, migrationsUrl)));
  return dir;
}

function runCli(cli: string, env: Record<string, string | undefined>, args: string[] = []) {
  const result = spawnSync(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function checkCliPairUnchanged(db: TestDatabase, report: SchemaCheckReport, env: Record<string, string | undefined> = {}, args: string[] = []) {
  const before = await snapshot(db.pool);
  await withDdlGuard(db.pool, async () => {
    for (const cli of [sourceCli, compiledCli]) {
      const result = runCli(cli, { DATABASE_URL: db.connectionString, ...env }, args);
      const exit = report.status === 'ok' ? 0 : report.status === 'drift' ? 1 : 3;
      assert.equal(result.status, exit, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), report);
      const url = new URL(db.connectionString);
      for (const output of [result.stdout, result.stderr]) {
        assert.ok(!output.includes(db.connectionString) && !output.includes(decodeURIComponent(url.password)));
        assert.ok(!output.includes('secret-person-7f3a') && !output.includes('value-control@example.test'));
      }
    }
  });
  assert.deepEqual(await snapshot(db.pool), before, 'both CLIs leave schema, history and row values unchanged');
  await noLeftoverConnections(db);
}

function codes(report: SchemaCheckReport): string[] {
  return report.findings.map((f) => (f.target ? `${f.code}:${f.target}` : f.code));
}

async function closedPortUrl(): Promise<string> {
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const p = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(p));
    });
  });
  return `postgres://nobody:nothing@127.0.0.1:${port}/postgres`;
}

test('最新の正常fixtureで差分なし・exit 0。source／compiled CLIのJSONと終了コードが一致し、DBは変更されない', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  await db.pool.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values ('u-secret', 'secret person', 'secret-person-7f3a@example.test', false, now(), now())`);

  const report = await checkUnchanged(db, { connectionString: db.connectionString });
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.checkout.files, await listCheckoutMigrations());
  assert.deepEqual(report.checkout.files.map((f) => f.name), APP_MIGRATIONS);
  for (const f of report.checkout.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.app, { historyTable: 'present', applied: APP_MIGRATIONS, pending: [], checksumMismatch: [], unknownHistory: [] });
  assert.equal(report.auth?.status, 'ok');
  assert.deepEqual([report.auth?.missingTables, report.auth?.missingColumns, report.auth?.missingIndexes, report.auth?.unsafeChanges], [[], [], [], []]);
  assert.deepEqual(report.database, { status: 'ok' });
  await noLeftoverConnections(db);

  // CLI: stdoutはJSON 1行のみ。接続文字列・password・個人データを出さない。
  const url = new URL(db.connectionString);
  const env = { DATABASE_URL: db.connectionString };
  const source = runCli(sourceCli, env);
  assert.equal(source.status, 0, source.stderr);
  assert.deepEqual(JSON.parse(source.stdout), report);
  assert.equal(source.stdout.trim().split('\n').length, 1);
  for (const output of [source.stdout, source.stderr]) {
    assert.ok(!output.includes(decodeURIComponent(url.password)), 'no password in output');
    assert.ok(!output.includes(db.connectionString) && !output.includes('postgres://'), 'no connection string in output');
    assert.ok(!output.includes('secret-person-7f3a'), 'no personal data in output');
  }

  const compiled = runCli(compiledCli, env);
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.deepEqual(JSON.parse(compiled.stdout), JSON.parse(source.stdout));
  await checkCliPairUnchanged(db, report);
  await noLeftoverConnections(db);
});

test('空DBは empty_database・履歴table欠落・全SQL未適用・認証table欠落として exit 1 になり、schema_migrationsを作らない', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const report = await checkUnchanged(db, { connectionString: db.connectionString });
  assert.equal(report.status, 'drift');
  assert.equal(report.app?.historyTable, 'missing');
  assert.deepEqual(report.app?.pending, APP_MIGRATIONS);
  assert.ok(report.auth?.missingTables.includes('user') && report.auth.missingTables.includes('rateLimit'));
  const found = codes(report);
  assert.ok(found.includes('empty_database') && found.includes('history_table_missing'));
  for (const name of APP_MIGRATIONS) assert.ok(found.includes(`pending_migration:${name}`));
  assert.equal((await db.pool.query("select to_regclass('schema_migrations') as t")).rows[0]?.t, null);
  const cli = runCli(sourceCli, { DATABASE_URL: db.connectionString });
  assert.equal(cli.status, 1);
  assert.deepEqual(JSON.parse(cli.stdout), report);
  await checkCliPairUnchanged(db, report);
});

test('旧schema・未適用・同番号の異名を全文名で区別し、新しいSQLを追加すると定義の手修正なしに未適用を検出する', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const applied = copyMigrations(t);
  writeFileSync(join(applied, '0005_schema_check_a.sql'), 'create table schema_check_a (id integer);');
  await migrate(db.pool, 'all', pathToFileURL(`${applied}/`));

  const checkout = copyMigrations(t);
  writeFileSync(join(checkout, '0005_schema_check_a.sql'), 'create table schema_check_a (id integer);');
  writeFileSync(join(checkout, '0005_schema_check_b.sql'), 'create table schema_check_b (id integer);');
  const dir = pathToFileURL(`${checkout}/`);
  const partial = await checkUnchanged(db, { connectionString: db.connectionString, migrationsDir: dir });
  assert.equal(partial.status, 'drift');
  assert.deepEqual(partial.app?.applied, [...APP_MIGRATIONS, '0005_schema_check_a.sql'].sort());
  assert.deepEqual(partial.app?.pending, ['0005_schema_check_b.sql']);
  assert.deepEqual(codes(partial), ['pending_migration:0005_schema_check_b.sql']);

  writeFileSync(join(checkout, '9999_schema_check_new.sql'), 'create table schema_check_new (id integer);');
  const added = await checkUnchanged(db, { connectionString: db.connectionString, migrationsDir: dir });
  assert.deepEqual(added.app?.pending, ['0005_schema_check_b.sql', '9999_schema_check_new.sql']);
  assert.deepEqual(added.checkout.files.map((f) => f.name), [...APP_MIGRATIONS, '0005_schema_check_a.sql', '0005_schema_check_b.sql', '9999_schema_check_new.sql'].sort());
  assert.equal((await db.pool.query("select to_regclass('schema_check_new') as t")).rows[0]?.t, null);
  await checkCliPairUnchanged(db, added, {}, [checkout]);

  // 旧schema: 先頭2ファイルだけ適用したDBを最新checkoutで検査する。
  const old = await createTestDatabase();
  t.after(() => old.close());
  await migrate(old.pool, 'all', pathToFileURL(`${copyMigrations(t, APP_MIGRATIONS.slice(0, 2))}/`));
  const oldReport = await checkUnchanged(old, { connectionString: old.connectionString });
  assert.deepEqual(oldReport.app?.applied, APP_MIGRATIONS.slice(0, 2));
  assert.deepEqual(oldReport.app?.pending, APP_MIGRATIONS.slice(2));
  assert.equal(oldReport.auth?.status, 'ok');
  assert.equal(oldReport.status, 'drift');
  await checkCliPairUnchanged(old, oldReport);
});

test('checksum不一致とcheckoutにない履歴を失敗にし、履歴行を無視・削除・修正しない', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const checkout = copyMigrations(t);
  const dir = pathToFileURL(`${checkout}/`);
  await migrate(db.pool, 'all', dir);
  const first = APP_MIGRATIONS[0]!;
  writeFileSync(join(checkout, first), `${readFileSync(join(checkout, first), 'utf8')}\n-- edited after apply\n`);
  await db.pool.query(`insert into schema_migrations (name, checksum) values ('0042_elsewhere.sql', repeat('0', 64))`);

  const report = await checkUnchanged(db, { connectionString: db.connectionString, migrationsDir: dir });
  assert.equal(report.status, 'drift');
  assert.deepEqual(report.app?.checksumMismatch, [first]);
  assert.deepEqual(report.app?.unknownHistory, ['0042_elsewhere.sql']);
  assert.deepEqual(report.app?.applied, APP_MIGRATIONS.slice(1));
  assert.deepEqual(codes(report), [`checksum_mismatch:${first}`, 'unknown_history:0042_elsewhere.sql']);
  const rows = (await db.pool.query<{ name: string }>('select name from schema_migrations order by name')).rows.map((r) => r.name);
  assert.deepEqual(rows, [...APP_MIGRATIONS, '0042_elsewhere.sql'].sort());
  assert.equal(runCli(sourceCli, { DATABASE_URL: db.connectionString }, [checkout]).status, 1);
  await checkCliPairUnchanged(db, report, {}, [checkout]);
});

test('認証の必要table・columnの欠落を検出し、DDLを適用しない。field単位のindex欠落は検出範囲外', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  await db.pool.query('drop table "rateLimit"; alter table "user" drop column image; drop index "session_userId_idx"');
  const report = await checkUnchanged(db, { connectionString: db.connectionString });
  assert.equal(report.status, 'drift');
  assert.deepEqual(report.auth?.missingTables, ['rateLimit']);
  assert.deepEqual(report.auth?.missingColumns, [{ table: 'user', column: 'image' }]);
  // 固定版1.7.7のgetMigrationsはtable定義のindexes（本設定では未使用）だけをtoBeAddedIndexesに出し、
  // field単位のindex（session_userId_idx等）の欠落は差分計画に現れない。限界として文書化し、ここで挙動を固定する。
  assert.deepEqual(report.auth?.missingIndexes, []);
  assert.equal((await db.pool.query("select to_regclass('\"session_userId_idx\"') as t")).rows[0]?.t, null);
  assert.deepEqual(report.app?.pending, []);
  assert.deepEqual(codes(report), ['auth_column_missing:user.image', 'auth_table_missing:rateLimit']);
  assert.equal((await db.pool.query("select to_regclass('\"rateLimit\"') as t")).rows[0]?.t, null);
  assert.equal(runCli(sourceCli, { DATABASE_URL: db.connectionString }).status, 1);
  await checkCliPairUnchanged(db, report);
});

test('接続失敗・認証失敗は exit 3 で有限時間に終わり、URL・passwordを出力しない', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const started = Date.now();
  const unreachable = await runSchemaCheck({ connectionString: await closedPortUrl(), queryTimeoutMs: 1_000 });
  assert.ok(Date.now() - started < 10_000, 'finishes within a bounded time');
  assert.equal(unreachable.status, 'unavailable');
  assert.deepEqual([unreachable.database, unreachable.app, unreachable.auth, codes(unreachable)], [{ status: 'connection' }, null, null, ['db_connection']]);

  const wrong = new URL(db.connectionString);
  wrong.password = 'wrongpass-9c1e';
  const cli = runCli(sourceCli, { DATABASE_URL: wrong.toString() });
  assert.equal(cli.status, 3, cli.stderr);
  const report = JSON.parse(cli.stdout) as SchemaCheckReport;
  assert.deepEqual([report.status, report.database.status], ['unavailable', 'authentication']);
  for (const output of [cli.stdout, cli.stderr]) {
    assert.ok(!output.includes('wrongpass-9c1e') && !output.includes('postgres://') && !output.includes(wrong.username));
  }
});

test('query待機のtimeoutと全体timeoutで有限時間に終わり、接続を残さない', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  const before = await snapshot(db.pool);
  const blocker = await db.pool.connect();
  await blocker.query('begin; lock table schema_migrations in access exclusive mode');
  try {
    const started = Date.now();
    const perQuery = await runSchemaCheck({ connectionString: db.connectionString, queryTimeoutMs: 500 });
    assert.ok(Date.now() - started < 10_000);
    assert.deepEqual([perQuery.status, perQuery.database.status, codes(perQuery)], ['unavailable', 'timeout', ['timeout']]);
    await noLeftoverConnections(db);

    const total = await runSchemaCheck({ connectionString: db.connectionString, queryTimeoutMs: 2_000, totalTimeoutMs: 300 });
    assert.deepEqual([total.status, total.database.status], ['unavailable', 'timeout']);
    await noLeftoverConnections(db);
  } finally {
    await blocker.query('rollback');
    blocker.release();
  }
  assert.deepEqual(await snapshot(db.pool), before);
  assert.equal((await runSchemaCheck({ connectionString: db.connectionString })).status, 'ok');
});

test('CLIの使い方・設定の誤りは exit 2 で、DATABASE_URL未設定でもSecretを出さない', () => {
  const usage = runCli(sourceCli, { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' }, ['a', 'b']);
  assert.equal(usage.status, 2);
  assert.ok(!usage.stderr.includes('postgres://'));
  const missing = runCli(sourceCli, { DATABASE_URL: undefined });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /DATABASE_URL/);
  const badTimeout = runCli(sourceCli, { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x', SCHEMA_CHECK_TIMEOUT_MS: '5' });
  assert.equal(badTimeout.status, 2);
  assert.ok(!badTimeout.stderr.includes('postgres://'));
});

test('認証の暗黙id列の欠落も非zeroになり、session.idの見逃しを防ぐ', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  await db.pool.query('alter table "session" drop column id');
  const report = await checkUnchanged(db, { connectionString: db.connectionString });
  assert.equal(report.status, 'drift');
  assert.deepEqual(report.auth?.missingColumns, [{ table: 'session', column: 'id' }]);
  assert.ok(codes(report).includes('auth_column_missing:session.id'));
  await checkCliPairUnchanged(db, report);
});

test('行の値のsnapshotは行数が変わらないUPDATEを検出する（検査外の負の対照）', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  await db.pool.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values ('value-control', 'before', 'value-control@example.test', false, now(), now())`);
  const before = await snapshot(db.pool);
  // 検査の副作用ではなく、snapshotの観測力を確かめるfixture準備中の意図的な更新。
  await db.pool.query(`update "user" set name = 'after' where id = 'value-control'`);
  const after = await snapshot(db.pool);
  assert.deepEqual(after.rowCounts, before.rowCounts);
  assert.notDeepEqual(after, before, 'same-count UPDATE must change the snapshot');
  assert.notDeepEqual(after.rowDigests, before.rowDigests);
});

test('現行認証設定の全tableの暗黙idを検出するが、型・PK・field indexの全driftへ広げない', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  const tables = ['account', 'rateLimit', 'session', 'user', 'verification'];
  for (const table of tables) await db.pool.query(`alter table "${table}" drop column id cascade`);
  const report = await checkUnchanged(db, { connectionString: db.connectionString });
  assert.equal(report.status, 'drift');
  assert.deepEqual(report.auth?.missingColumns, tables.map((table) => ({ table, column: 'id' })));
  await checkCliPairUnchanged(db, report);
});

test('CLIで接続/query上限を明示でき、timeoutは判定不能・非zero・秘匿を保つ', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'all');
  const before = await snapshot(db.pool);
  const blocker = await db.pool.connect();
  await blocker.query('begin; lock table schema_migrations in access exclusive mode');
  try {
    for (const cli of [sourceCli, compiledCli]) {
      const result = runCli(cli, { DATABASE_URL: db.connectionString, SCHEMA_CHECK_QUERY_TIMEOUT_MS: '1000', SCHEMA_CHECK_TIMEOUT_MS: '10000' });
      assert.equal(result.status, 3, result.stderr);
      const report = JSON.parse(result.stdout) as SchemaCheckReport;
      assert.deepEqual([report.status, report.database.status, codes(report)], ['unavailable', 'timeout', ['timeout']]);
      assert.ok(!result.stdout.includes(db.connectionString) && !result.stderr.includes(db.connectionString));
      await noLeftoverConnections(db);
    }
  } finally {
    await blocker.query('rollback');
    blocker.release();
  }
  // lock中の履歴SELECTは待つため、全schema・履歴・行値を解除後に比較する。
  assert.deepEqual(await snapshot(db.pool), before);
  const report = await checkUnchanged(db, { connectionString: db.connectionString });
  await checkCliPairUnchanged(db, report, { SCHEMA_CHECK_QUERY_TIMEOUT_MS: '15000', SCHEMA_CHECK_TIMEOUT_MS: '30000' });
});

test('設定エラー・空/missing directory・無効timeoutはexit 2、原文pathやSecretは出さない', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'futureroi-schema-check-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { DATABASE_URL: 'postgres://u:config-secret@127.0.0.1:1/x' };
  for (const cli of [sourceCli, compiledCli]) {
    for (const args of [[dir], [join(dir, 'private-missing-path')]]) {
      const result = runCli(cli, env, args);
      assert.equal(result.status, 2);
      assert.ok(!result.stderr.includes(dir) && !result.stderr.includes('config-secret'));
    }
    for (const value of ['0', 'NaN', 'Infinity', '999', '600001']) {
      assert.equal(runCli(cli, { ...env, SCHEMA_CHECK_QUERY_TIMEOUT_MS: value }).status, 2);
    }
  }
  await assert.rejects(() => runSchemaCheck({ connectionString: env.DATABASE_URL, queryTimeoutMs: 0 }), SchemaCheckConfigurationError);
});

test('pipeに大きいJSONを出してもsource/fresh compiledとも1行を完全に読める', async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const dir = copyMigrations(t);
  for (let i = 0; i < 500; i++) writeFileSync(join(dir, `9000_large_${String(i).padStart(4, '0')}.sql`), '-- synthetic only\n');
  const report = await checkUnchanged(db, { connectionString: db.connectionString, migrationsDir: pathToFileURL(`${dir}/`) });
  assert.ok(JSON.stringify(report).length > 65_536);
  await checkCliPairUnchanged(db, report, {}, [dir]);
  // writeが即returnしcallbackだけ返らない負例。実pipeの同期write停止を再現するものではない。
  // event loopが進む経路のtimer／exit 3だけを検証する（ガイドのI/O限界を参照）。
  const stalledOutput = join(dir, 'stalled-output.mjs');
  writeFileSync(stalledOutput, 'process.stdout.write = () => { setTimeout(() => {}, 5000); return true; };\n');
  const before = await snapshot(db.pool);
  await withDdlGuard(db.pool, async () => {
    for (const cli of [sourceCli, compiledCli]) {
      const started = Date.now();
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(stalledOutput).href, cli, dir], {
        env: { PATH: process.env.PATH, DATABASE_URL: db.connectionString, SCHEMA_CHECK_QUERY_TIMEOUT_MS: '1000' },
        encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(result.status, 3, result.stderr);
      assert.equal(result.stdout, '');
      assert.ok(Date.now() - started < 10_000);
    }
    // callbackのerrorがerror eventより先でも、DB判定のexit 0/1にしてしまわない。
    writeFileSync(stalledOutput, 'process.stdout.write = (_chunk, callback) => { callback(new Error("synthetic output failure")); return false; };\n');
    for (const cli of [sourceCli, compiledCli]) {
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(stalledOutput).href, cli, dir], {
        env: { PATH: process.env.PATH, DATABASE_URL: db.connectionString }, encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(result.status, 3, result.stderr);
      assert.equal(result.stdout, '');
    }
  });
  assert.deepEqual(await snapshot(db.pool), before);
  await noLeftoverConnections(db);
});
