import { getMigrations } from 'better-auth/db/migration';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { authSchemaOptions } from '../auth/options.ts';
import { matchesMigrationChecksum } from './migration-checksum.ts';

// 実行順は 認証（Better Authのテーブル）→ アプリ（migrations/*.sql）。goal.user_id が "user"(id) を参照するため。
// Demo Seed（db:seed:demo、#82）はこの後に別コマンドで実行する。

export const defaultMigrationsDir = new URL('../../migrations/', import.meta.url);

// 同時実行（複数instanceの起動時など）を直列化するためのadvisory lock。アプリ内で一意なら値は任意。
const MIGRATION_LOCK_KEY = 70_740_001;

export type AuthMigrationResult = { tablesCreated: string[]; columnsAdded: string[] };
export type AppMigrationResult = { applied: string[] };
export type MigrationTarget = 'auth' | 'app' | 'all';
export type MigrationResult = { target: MigrationTarget; auth?: AuthMigrationResult; app?: AppMigrationResult };

// runnerと読み取り専用preflightで、SQL選択と既存checksumの意味を1か所に保つ。
export const MIGRATION_FILE = /^\d{4}_[\w-]+\.sql$/;
export const migrationChecksum = (text: string) => createHash('sha256').update(text).digest('hex');

// 起動ログで履歴不一致を分類する。ファイル名や例外原文をログへ出す必要はない。
export class MigrationChecksumError extends Error {}

// 固定版のライブラリから直接getMigrationsを呼ぶ（CLIの`@latest`取得を避ける。#84 F-9）。2回目以降は差分なしで何もしない。
export async function migrateAuth(pool: Pool): Promise<AuthMigrationResult> {
  const { toBeCreated, toBeAdded, compileMigrations } = await getMigrations(authSchemaOptions(pool));
  // 固定版が生成するDDLを同じ接続のtransactionで適用する。index失敗でも部分schemaを残さない。
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      await client.query(await compileMigrations());
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    client.release();
  }
  return { tablesCreated: toBeCreated.map((t) => t.table), columnsAdded: toBeAdded.map((t) => t.table) };
}

async function applyFile(client: PoolClient, name: string, sql: string, checksum: string): Promise<void> {
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [name, checksum]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

// migrations/ の `NNNN_name.sql` を名前順に、1ファイル1トランザクションで適用する。
// 適用済みファイルはschema_migrationsのchecksumで照合し、内容が変わっていれば失敗させる（履歴を黙って書き換えない）。
export async function migrateApp(pool: Pool, dir: URL = defaultMigrationsDir): Promise<AppMigrationResult> {
  const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const client = await pool.connect();
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())',
    );
    const recorded = new Map(
      (await client.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]),
    );
    const applied: string[] = [];
    for (const name of files) {
      const sql = await readFile(new URL(name, dir), 'utf8');
      const checksum = migrationChecksum(sql);
      const previous = recorded.get(name);
      if (previous !== undefined) {
        if (!matchesMigrationChecksum(name, checksum, previous)) {
          throw new MigrationChecksumError(`適用済みのmigration ${name} の内容が変更されています。既存ファイルを直さず、新しい番号のファイルを追加してください。`);
        }
        continue;
      }
      await applyFile(client, name, sql, checksum);
      applied.push(name);
    }
    return { applied };
  } finally {
    client.release();
  }
}

// 対象を選んで実行する。lockはセッション単位なので、保持用の接続を別に確保して最後に解放する。
export async function migrate(pool: Pool, target: MigrationTarget = 'all', dir?: URL): Promise<MigrationResult> {
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const result: MigrationResult = { target };
      if (target !== 'app') result.auth = await migrateAuth(pool);
      if (target !== 'auth') result.app = await migrateApp(pool, dir);
      return result;
    } finally {
      await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    lock.release();
  }
}
