import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { predict } from '@futureroi/prediction';
import type { Today } from '../src/contracts/log.ts';
import { createDemoSeedData } from '../src/db/demo-data.ts';
import { parseDemoSeedArgs } from '../src/db/demo-seed-args.ts';
import { seedDemo, DemoSeedError } from '../src/db/seed-demo.ts';
import { createDemoSeedPool } from '../src/db/pool.ts';
import { setup, signedInClient, type Client } from './helpers/stack.ts';

const INSTANT = new Date('2026-12-31T15:00:00.000Z'); // 東京の年越し
const options = (userId: string) => ({ userId, timezone: 'Asia/Tokyo', now: () => INSTANT });
// Engineの内部診断だけを除き、公開値はすべて完全一致で検査する。
function publicPrediction(result: ReturnType<typeof predict>) {
  if (result.completion.status !== 'available') return result;
  const { computation: _internal, ...completion } = result.completion;
  return { ...result, completion };
}
async function userId(client: Client) {
  const session = await client.call('GET', '/api/auth/get-session');
  assert.equal(session.status, 200);
  const id = (session.json?.user as { id?: string } | undefined)?.id;
  assert.ok(id);
  return id;
}
async function snapshot(pool: pg.Pool) {
  const rows: Record<string, unknown> = {};
  for (const table of ['goal', 'action_log', 'demo_seed_goal', 'user', 'account', 'session', 'rateLimit']) {
    rows[table] = (await pool.query(`select to_jsonb(t) as row from "${table}" t order by to_jsonb(t)::text`)).rows;
  }
  return rows;
}
async function counts(pool: pg.Pool) {
  return (await pool.query(`select (select count(*)::int from demo_seed_goal) as markers,
    (select count(*)::int from goal g join demo_seed_goal d on d.goal_id=g.id) as goals,
    (select count(*)::int from action_log l join demo_seed_goal d on d.goal_id=l.goal_id) as logs`)).rows[0];
}

// 障害の境界だけを注入し、SQL・lock・COMMIT/ROLLBACKは実PostgreSQLで実行する。
function intercept(pool: pg.Pool, hook: (sql: string, run: () => Promise<pg.QueryResult>) => Promise<pg.QueryResult>, released?: (error?: Error | boolean) => void): pg.Pool {
  return { connect: async () => {
    const client = await pool.connect();
    return {
      query: (sql: string, params?: unknown[]) => hook(sql, () => client.query(sql, params)),
      release: (error?: Error | boolean) => { released?.(error); client.release(error); },
    };
  } } as unknown as pg.Pool;
}
async function waitFor(pool: pg.Pool, predicate: () => Promise<boolean>) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`DB barrier was not reached (${pool.totalCount} observer connections)`);
}

test('CLIはuserIdとIANA timezoneを明示し、email・重複・余分な引数を受け付けない', () => {
  assert.deepEqual(parseDemoSeedArgs(['--timezone', 'UTC', '--user-id', 'exact-id']), { userId: 'exact-id', timezone: 'UTC' });
  for (const args of [[], ['--email', 'demo@example.test', '--timezone', 'UTC'], ['--user-id', ' id ', '--timezone', 'UTC'],
    ['--user-id', 'id', '--user-id', 'id'], ['--user-id', 'id', '--timezone', 'JST'], ['--user-id', 'id', '--timezone', 'UTC', '--force']]) assert.equal(parseDemoSeedArgs(args), null);
});

test('初回とresetは専用2Goalだけを新IDへ替え、同名の通常Goal・他ユーザー・認証全行を保全する', async t => {
  const { db, stack } = await setup(t, { now: () => INSTANT });
  const owner = await signedInClient(stack.app, 'seed-owner');
  const other = await signedInClient(stack.app, 'seed-other');
  const id = await userId(owner);
  await userId(other);
  for (const client of [owner, other]) {
    const goal = await client.call('POST', '/api/goals', { title: 'デモ：すぐ再開する', unit: 'sessions', totalRequired: 60, sessionAmount: 1, timezone: 'Asia/Tokyo' });
    assert.equal(goal.status, 201);
    assert.equal((await client.call('PUT', `/api/goals/${goal.json?.id}/logs/2027-01-01`, { status: 'DONE', amount: 7 })).status, 200);
  }
  const before = await snapshot(db.pool);
  const first = await seedDemo(db.pool, options(id));
  assert.equal(first.replacedGoalCount, 0);
  assert.equal(first.baseDate, '2027-01-01');
  await db.pool.query('update goal set title=$1 where id=$2', ['operator renamed this', first.goals[0]!.id]);
  const second = await seedDemo(db.pool, options(id));
  assert.equal(second.replacedGoalCount, 2);
  assert.ok(second.goals.every(row => !first.goals.some(old => old.id === row.id)));
  assert.deepEqual(await counts(db.pool), { markers: 2, goals: 2, logs: 60 });
  const after = await snapshot(db.pool);
  for (const table of ['user', 'account', 'session', 'rateLimit']) assert.deepEqual(after[table], before[table], `${table} is never rewritten by seed`);
  const normalIds = (before.goal as { row: { id: string } }[]).map(row => row.row.id);
  assert.deepEqual((after.goal as { row: { id: string } }[]).filter(row => normalIds.includes(row.row.id)), before.goal);
  assert.deepEqual((after.action_log as { row: { goal_id: string } }[]).filter(row => normalIds.includes(row.row.goal_id)), before.action_log);
  for (const old of first.goals) {
    assert.equal((await owner.call('GET', `/api/goals/${old.id}`)).status, 404);
    assert.equal((await owner.call('PUT', `/api/goals/${old.id}/logs/2027-01-01`, { status: 'DONE' })).status, 404);
  }
});

test('Todayは実Engineと完全一致し、昨日補完・今日記録を通常APIで扱い、過去の記録制約を維持する', async t => {
  const { db, stack } = await setup(t, { now: () => INSTANT });
  const owner = await signedInClient(stack.app, 'today-demo');
  const seeded = await seedDemo(db.pool, options(await userId(owner)));
  const data = createDemoSeedData(INSTANT, 'Asia/Tokyo');
  for (const [i, goal] of seeded.goals.entries()) {
    const res = await owner.call('GET', `/api/goals/${goal.id}/today`);
    assert.equal(res.status, 200);
    const today = res.json as unknown as Today;
    assert.equal(today.today, '2027-01-01');
    assert.equal(today.yesterday, '2026-12-31');
    assert.equal(today.yesterdayMissing, true);
    assert.equal(today.todayLog, null);
    assert.deepEqual(today.prediction, publicPrediction(predict(data[i]!.input)));
    assert.equal((await owner.call('PUT', `/api/goals/${goal.id}/logs/2026-12-30`, { status: 'DONE', amount: 1, expectedGoalSettingsRevision: 0 })).status, 422);
    assert.equal((await owner.call('PUT', `/api/goals/${goal.id}/logs/2026-12-31`, { status: 'SKIPPED' })).status, 200);
    assert.equal((await owner.call('PUT', `/api/goals/${goal.id}/logs/2027-01-01`, { status: 'DONE', amount: 1, expectedGoalSettingsRevision: 0 })).status, 200);
    const recorded = (await owner.call('GET', `/api/goals/${goal.id}/today`)).json as unknown as Today;
    assert.equal(recorded.yesterdayMissing, false);
    assert.deepEqual(recorded.todayLog, { localDate: '2027-01-01', status: 'DONE', amount: 1 });
    assert.equal(recorded.prediction.progress.done, 16);
  }
});

test('所有者の複合FKと認証済みaccountの存在を検査し、異常入力でも状態を変更しない', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'ownership'));
  const otherId = await userId(await signedInClient(stack.app, 'ownership-other'));
  const seeded = await seedDemo(db.pool, options(id));
  const before = await snapshot(db.pool);
  await assert.rejects(db.pool.query('update demo_seed_goal set user_id=$1 where goal_id=$2', [otherId, seeded.goals[0]!.id]), { code: '23503' });
  for (const invalid of [{ ...options(id), userId: 'absent' }, { ...options(id), userId: ` ${id}` }, { ...options(id), timezone: 'JST' }, { ...options(id), now: () => new Date(NaN) }]) {
    await assert.rejects(seedDemo(db.pool, invalid), DemoSeedError);
    assert.deepEqual(await snapshot(db.pool), before);
  }
  await db.pool.query(`insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ('without-account','x','x@example.test',false,now(),now())`);
  const withoutAccount = await snapshot(db.pool);
  await assert.rejects(seedDemo(db.pool, options('without-account')), { code: 'AUTH_USER_NOT_FOUND' });
  assert.deepEqual(await snapshot(db.pool), withoutAccount);
});

test('削除後・1Goal保存後・2Goal保存後のSQL失敗をrollbackし、元の全行と回答fieldを保全する', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'rollback'));
  await seedDemo(db.pool, options(id));
  const before = await snapshot(db.pool);
  for (const failAt of [1, 31, 60]) {
    let logs = 0;
    const failing = intercept(db.pool, async (sql, run) => {
      if (sql.startsWith('insert into action_log') && ++logs === failAt) throw new Error('injected write failure');
      return run();
    });
    await assert.rejects(seedDemo(failing, options(id)), /injected write failure/);
    assert.deepEqual(await snapshot(db.pool), before, `all data survives log failure ${failAt}`);
  }
  // PostgreSQLがtransactionをabortする失敗も、同じ復元を保証する。
  await db.pool.query(`create function reject_demo_log() returns trigger language plpgsql as $$ begin raise exception 'synthetic insertion failure'; end $$;
    create trigger reject_demo_log before insert on action_log for each row execute function reject_demo_log()`);
  await assert.rejects(seedDemo(db.pool, options(id)), /synthetic insertion failure/);
  assert.deepEqual(await snapshot(db.pool), before);
});

test('同一ユーザーの並行初回・並行resetを直列化し、異なるユーザーは待たせない', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'parallel'));
  const otherId = await userId(await signedInClient(stack.app, 'parallel-other'));
  const observer = new pg.Pool({ connectionString: db.connectionString, max: 1 });
  try {
    for (const reset of [false, true]) {
      const blocker = await db.pool.connect();
      await blocker.query('begin');
      await blocker.query('select pg_advisory_xact_lock(820013, hashtext($1))', [id]);
      const pending = [seedDemo(db.pool, options(id)), seedDemo(db.pool, options(id))];
      try {
        await waitFor(observer, async () => (await observer.query(`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'`)).rows[0]!.n === 2);
        if (!reset) await seedDemo(observer, options(otherId));
      } finally { await blocker.query('commit'); blocker.release(); }
      const results = await Promise.all(pending);
      assert.deepEqual(results.map(row => row.replacedGoalCount).sort(), reset ? [2, 2] : [0, 2]);
      assert.ok(results[0]!.goals.every(row => !results[1]!.goals.some(other => other.id === row.id)));
      assert.deepEqual(await counts(db.pool), { markers: 4, goals: 4, logs: 120 });
    }
  } finally { await observer.end(); }
});

test('未commitの通常DELETEでGoal lockを待たせ、確定後の最新markerで再作成し通常Goalを残す', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'delete-race'));
  const first = await seedDemo(db.pool, options(id));
  const normal = (await db.pool.query(`insert into goal(user_id,title,unit,total_required,session_amount,timezone,record_start_date)
    values($1,'normal','sessions',60,1,'Asia/Tokyo','2026-12-01') returning id`, [id])).rows[0]!.id as string;
  const before = (await snapshot(db.pool)).goal as { row: { id: string } }[];
  const deleter = await db.pool.connect();
  await deleter.query('begin');
  await deleter.query('delete from goal where user_id=$1 and id=$2', [id, first.goals[0]!.id]);
  const pending = seedDemo(db.pool, options(id));
  try {
    await waitFor(db.pool, async () => (await db.pool.query(`select count(*)::int n from pg_stat_activity where datname=current_database()
      and wait_event_type='Lock' and query like 'select g.id from goal g%'`)).rows[0]!.n === 1);
  } finally { await deleter.query('commit'); deleter.release(); }
  const reset = await pending;
  assert.equal(reset.replacedGoalCount, 1);
  assert.ok(reset.goals.every(row => !first.goals.some(old => old.id === row.id)));
  assert.deepEqual(await counts(db.pool), { markers: 2, goals: 2, logs: 60 });
  assert.deepEqual(((await snapshot(db.pool)).goal as { row: { id: string } }[]).filter(row => row.row.id === normal), before.filter(row => row.row.id === normal));
});

test('日またぎlock待機後に時計を1回だけ読み、新しい基準日で全Goalと記録を揃える', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'midnight-lock'));
  const observer = new pg.Pool({ connectionString: db.connectionString, max: 1 });
  try {
    const blocker = await db.pool.connect();
    await blocker.query('begin');
    await blocker.query('select pg_advisory_xact_lock(820013, hashtext($1))', [id]);
    let clockCalls = 0;
    let now = new Date('2026-12-31T14:59:59.999Z');
    const pending = seedDemo(db.pool, { ...options(id), now: () => { clockCalls++; return now; } });
    try {
      await waitFor(observer, async () => (await observer.query(`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'`)).rows[0]!.n === 1);
      assert.equal(clockCalls, 0);
      now = INSTANT;
    } finally { await blocker.query('commit'); blocker.release(); }
    assert.equal((await pending).baseDate, '2027-01-01');
    assert.equal(clockCalls, 1);
    assert.deepEqual((await db.pool.query('select distinct record_start_date::text as d from goal')).rows, [{ d: '2026-12-01' }]);
    assert.deepEqual((await db.pool.query('select min(local_date)::text as first,max(local_date)::text as last from action_log')).rows, [{ first: '2026-12-01', last: '2026-12-30' }]);
  } finally { await observer.end(); }
});

test('COMMITの応答だけ失った場合は確定不明を返し、次回resetで収束する', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'commit-unknown'));
  const first = await seedDemo(db.pool, options(id));
  let discarded = false;
  const lostReply = intercept(db.pool, async (sql, run) => {
    const result = await run();
    if (sql === 'commit') throw new Error('synthetic lost COMMIT reply');
    return result;
  }, error => { discarded = !!error; });
  await assert.rejects(seedDemo(lostReply, options(id)), { code: 'COMMIT_OUTCOME_UNKNOWN' });
  assert.ok(discarded);
  assert.deepEqual(await counts(db.pool), { markers: 2, goals: 2, logs: 60 });
  assert.ok((await db.pool.query('select id from goal')).rows.every(row => !first.goals.some(old => old.id === row.id)));
  assert.equal((await seedDemo(db.pool, options(id))).replacedGoalCount, 2);
});

test('ROLLBACKの通信失敗は成功扱いせずclientを破棄し、切断で未確定変更を戻す', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'rollback-disconnect'));
  await seedDemo(db.pool, options(id));
  const before = await snapshot(db.pool);
  let discarded = false;
  const disconnected = intercept(db.pool, async (sql, run) => {
    if (sql.startsWith('insert into action_log') || sql === 'rollback') throw new Error('synthetic disconnect');
    return run();
  }, error => { discarded = !!error; });
  await assert.rejects(seedDemo(disconnected, options(id)), { code: 'ROLLBACK_FAILED' });
  assert.ok(discarded);
  assert.deepEqual(await snapshot(db.pool), before);
});

async function cli(connectionString: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const processHandle = spawn(process.execPath, [fileURLToPath(new URL('../src/db/seed-demo-cli.ts', import.meta.url)), ...args], {
      env: { ...process.env, DATABASE_URL: connectionString, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => { processHandle.kill(); reject(new Error('demo CLI did not terminate')); }, 15_000);
    for (const stream of [processHandle.stdout, processHandle.stderr]) stream.on('data', data => { output += String(data); });
    processHandle.on('error', error => { clearTimeout(timeout); reject(error); });
    processHandle.on('close', code => { clearTimeout(timeout); resolve({ code, output }); });
  });
}

test('実CLIは認証Secret不要で終了し、接続URL・userId・例外原文を出力しない', async t => {
  const { db, stack } = await setup(t);
  const id = await userId(await signedInClient(stack.app, 'cli'));
  const args = ['--user-id', id, '--timezone', 'Asia/Tokyo'];
  const result = await cli(db.connectionString, args, { NODE_ENV: 'production', BETTER_AUTH_SECRET: '', BETTER_AUTH_URL: '' });
  assert.equal(result.code, 0);
  const output = JSON.parse(result.output) as Record<string, unknown>;
  assert.equal(output.goalCount, 2);
  assert.equal(output.logCount, 60);
  assert.ok(!result.output.includes(id));
  assert.ok(!result.output.includes(db.connectionString));
  const unknown = await cli(db.connectionString, ['--user-id', 'synthetic-private-user', '--timezone', 'UTC']);
  assert.equal(unknown.code, 1);
  assert.deepEqual(JSON.parse(unknown.output), { error: 'AUTH_USER_NOT_FOUND' });
  const failed = await cli('postgres://private-user:synthetic-sensitive-token@127.0.0.1:1/missing', args);
  assert.equal(failed.code, 1);
  assert.deepEqual(JSON.parse(failed.output), { error: 'FAILED' });
  assert.ok(!failed.output.includes('synthetic-sensitive-token'));
  const invalid = await cli(db.connectionString, [...args, '--force']);
  assert.equal(invalid.code, 2);
  const seedPool = createDemoSeedPool({ connectionString: db.connectionString });
  try {
    const settings = await seedPool.query('show statement_timeout');
    assert.equal(settings.rows[0]!.statement_timeout, '35s');
  } finally { await seedPool.end(); }
});

test('接続URIの空／長いquery_timeoutでもSeedの各queryへ40秒を渡す', async t => {
  const { db } = await setup(t);
  const query = pg.Client.prototype.query;
  const received: unknown[] = [];
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0] as { text?: string; query_timeout?: unknown };
    if (config.text === 'select 1 as n' || args[0] === 'select 1 as n') received.push(config.query_timeout);
    return Reflect.apply(query, this, args);
  } as typeof query;
  try {
    for (const value of ['', '120000']) {
      const uri = new URL(db.connectionString);
      uri.searchParams.set('query_timeout', value);
      const pool = createDemoSeedPool({ connectionString: uri.toString() });
      try {
        assert.equal((await pool.query('select 1 as n')).rows[0]!.n, 1);
        assert.equal(received.at(-1), 40_000);
      } finally { await pool.end(); }
    }
  } finally { pg.Client.prototype.query = query; }
});
