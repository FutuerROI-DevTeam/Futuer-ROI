import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { Pool } from 'pg';
import { matchesMigrationChecksum } from '../src/db/migration-checksum.ts';
import { migrateApp, migrationChecksum, MigrationChecksumError } from '../src/db/migrate.ts';

const dir = new URL('../migrations/', import.meta.url);
const files = ['0001_goal_action_log.sql', '0002_goal_record_start_date.sql', '0003_goal_question_prior.sql',
  '0004_demo_seed_goal.sql', '0005_goal_data_integrity.sql', '0005_goal_target_date.sql',
  '0006_prediction_evaluation.sql', '0008_session_milestone.sql'];
const hash = (sql: string) => createHash('sha256').update(sql).digest('hex');
const lfSql = (name: string) => readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n');
const crlfSql = (sql: string) => sql.replace(/\n/g, '\r\n');

test('監査済み8件だけが、全文名と固定LF/CRLF pairの両方向で互換一致する', () => {
  const checkout = readdirSync(dir);
  for (const name of files) assert.ok(checkout.includes(name));
  for (const name of files) {
    const lf = lfSql(name);
    assert.ok(!lf.includes('\r') && !lf.startsWith('\uFEFF'));
    const pair = [hash(lf), hash(crlfSql(lf))];
    for (const current of pair) for (const recorded of pair) {
      assert.equal(matchesMigrationChecksum(name, current, recorded), true, name);
    }
  }
  assert.equal(hash(lfSql(files[0]!)), '581215086471dd61b8cc578a1e981951e653b9371c2c0f02c3558140f6fc9a3e');
  assert.equal(hash(crlfSql(lfSql(files[0]!))), '3d4249be53dc1edc310c1ad4c6836ea94fcfde2422102a4e7bbf505ed3f546fb');
});

test('本文・BOM・混在・bare CR・末尾改行・コメント変更を旧pairで通さない', () => {
  for (const name of files) {
    const lf = lfSql(name);
    const recorded = [hash(lf), hash(crlfSql(lf))];
    const mutations = [lf + ' ', lf + '-- changed\n', '\uFEFF' + lf,
      lf.replace('\n', '\r\n'), lf.replace('\n', '\r'), lf.replace(/\n$/, ''),
      lf.replace(/(?:create|alter|lock) table/i, 'drop table')];
    for (const changed of mutations) for (const prior of recorded) {
      assert.equal(matchesMigrationChecksum(name, hash(changed), prior), false, name);
    }
    // 同じ名前でも内容が違うpairを動的に生成して許可しない。current側のpinも必要。
    const changed = lf + '-- a different SQL revision\n';
    assert.equal(matchesMigrationChecksum(name, hash(changed), hash(crlfSql(changed))), false);
    assert.equal(matchesMigrationChecksum(name, hash(lf), hash(changed)), false);
  }
});

test('同番号の異名・別filename・未掲載の単一quote/dollarquote SQLへ互換を広げない', () => {
  const first = lfSql('0005_goal_data_integrity.sql');
  const second = lfSql('0005_goal_target_date.sql');
  assert.equal(matchesMigrationChecksum('0005_goal_data_integrity.sql', hash(first), hash(crlfSql(second))), false);
  for (const name of ['0005_elsewhere.sql', 'other/0005_goal_data_integrity.sql', '__proto__']) {
    assert.equal(matchesMigrationChecksum(name, hash(first), hash(crlfSql(first))), false);
  }
  for (const sql of ["insert into example values ('one\ntwo');\n", 'select $$one\ntwo$$;\n']) {
    assert.equal(matchesMigrationChecksum('0099_future.sql', hash(sql), hash(crlfSql(sql))), false);
    assert.equal(matchesMigrationChecksum('0099_future.sql', hash(sql), hash(sql)), true, 'raw equality is unchanged');
  }
});

function historyPool(rows: { name: string; checksum: string; applied_at: string }[]) {
  const calls: { sql: string; args: unknown[] | undefined }[] = [];
  let released = false;
  const pool = { connect: async () => ({
    query: async (sql: string, args?: unknown[]) => {
      calls.push({ sql, args });
      if (sql === 'select name, checksum from schema_migrations') return { rows };
      return { rows: [] };
    },
    release: () => { released = true; },
  }) } as unknown as Pool;
  return { pool, calls, released: () => released };
}

function temporaryMigrations(t: test.TestContext): string {
  const temporary = mkdtempSync(join(tmpdir(), 'futureroi-raw-checksum-'));
  t.after(() => {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  });
  return temporary;
}

test('実runnerは全8旧CRLF履歴を再適用せず、checksumとtimestampを保持する（mock Pool）', async (t) => {
  const temporary = temporaryMigrations(t);
  for (const name of files) writeFileSync(join(temporary, name), lfSql(name));
  const checkout = pathToFileURL(temporary + '/');
  const rows = files.map(name => ({ name, checksum: hash(crlfSql(lfSql(name))), applied_at: '2026-10-12T00:00:00Z' }));
  const before = structuredClone(rows);
  const fixture = historyPool(rows);
  assert.deepEqual(await migrateApp(fixture.pool, checkout), { applied: [] });
  assert.equal(fixture.calls.length, 2, 'only the existing history-table check and history read');
  assert.ok(fixture.calls[0]!.sql.startsWith('create table if not exists schema_migrations'));
  assert.equal(fixture.calls[1]!.sql, 'select name, checksum from schema_migrations');
  assert.deepEqual(rows, before);
  assert.ok(fixture.released());
  rows[0]!.checksum = '0'.repeat(64);
  await assert.rejects(migrateApp(historyPool(rows).pool, checkout), MigrationChecksumError);
});

test('新規適用ではSQL文字列も新しい記録hashもrawのまま（mock Pool）', async (t) => {
  const temporary = temporaryMigrations(t);
  const sql = "create table example (value text default 'one\r\ntwo');\r\n";
  writeFileSync(join(temporary, '0099_future.sql'), sql);
  const fixture = historyPool([]);
  assert.deepEqual(await migrateApp(fixture.pool, pathToFileURL(temporary + '/')), { applied: ['0099_future.sql'] });
  assert.equal(fixture.calls[3]!.sql, sql);
  assert.deepEqual(fixture.calls[4]!.args, ['0099_future.sql', hash(sql)]);
  assert.equal(migrationChecksum(sql), hash(sql));
  assert.notEqual(migrationChecksum(sql), hash(sql.replace(/\r\n/g, '\n')));
  assert.ok(fixture.released());
});
