import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import type { Goal, GoalCreate } from '../src/contracts/goal.ts';
import { migrate, migrateApp } from '../src/db/migrate.ts';
import { seedDemo } from '../src/db/seed-demo.ts';
import { createGoalOnce, createRequestHash, updateGoal } from '../src/goals/store.ts';
import { putLog } from '../src/logs/store.ts';
import { createTestDatabase } from './helpers/database.ts';
import { setup, signedInClient, type Client } from './helpers/stack.ts';

const NOW = new Date('2026-10-09T01:00:00Z');
const input = { title: 'phase1', unit: 'minutes', totalRequired: 600, sessionAmount: 10, timezone: 'Asia/Tokyo' } as const;
const code = (json: Record<string, unknown> | null) => (json?.error as { code?: string } | undefined)?.code;
async function create(client: Client, body: GoalCreate = input, key: string = randomUUID()) {
  const res = await client.rawCall('POST', '/api/goals', body, { 'idempotency-key': key });
  assert.equal(res.status, 201, res.body);
  return { goal: res.json as unknown as Goal, key };
}
const patch = (client: Client, g: Goal, body: Record<string, unknown>) =>
  client.rawCall('PATCH', `/api/goals/${g.id}`, {
    expectedGoalSettingsRevision: g.goalSettingsRevision,
    ...body,
  });
const log = (client: Client, g: Goal, body: Record<string, unknown>) =>
  client.rawCall('PUT', `/api/goals/${g.id}/logs/${g.today}`, {
    expectedGoalSettingsRevision: g.goalSettingsRevision,
    ...body,
  });

async function waitForLock(pool: pg.Pool, application: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await pool.query(
      'select 1 from pg_stat_activity where datname = current_database() and application_name = $1 and wait_event_type = $2',
      [application, 'Lock'],
    )).rowCount) {
      return;
    }
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Controlled lock barrier not reached');
}

test('#148 API/DB acceptance: raw requests, no contract defaults', async t => {
  const { db, stack } = await setup(t, { now: () => NOW });
  const a = await signedInClient(stack.app, 'phase1-a');
  const b = await signedInClient(stack.app, 'phase1-b');
  const owner = (await a.rawCall('GET', '/api/auth/get-session')).json!.user as { id: string };
  const get = async (g: Goal) => (await a.rawCall('GET', `/api/goals/${g.id}`)).json as unknown as Goal;
  const state = async (id: string) => ({ goal: (await db.pool.query('select * from goal where id = $1', [id])).rows,
    logs: (await db.pool.query('select * from action_log where goal_id = $1 order by local_date', [id])).rows });

  await t.test('U01 initial/DONE unit+title is atomic 422', async () => {
    for (const initialProgress of [0, 10]) {
      const { goal } = await create(a, { ...input, initialProgress });
      if (initialProgress === 0) assert.equal((await log(a, goal, { status: 'DONE', amount: 10 })).status, 200);
      const before = await state(goal.id);
      const res = await patch(a, goal, { unit: 'sessions', title: 'must rollback' });
      assert.equal(res.status, 422);
      assert.equal(code(res.json), 'GOAL_UNIT_LOCKED');
      assert.deepEqual(await state(goal.id), before);
    }
  });
  await t.test('U02 same unit/title succeeds while history stays locked', async () => {
    const { goal } = await create(a);
    await log(a, goal, { status: 'DONE', amount: 10 });
    const res = await patch(a, goal, { unit: 'minutes', title: 'renamed' });
    assert.equal(res.status, 200);
    assert.equal(res.json!.goalSettingsRevision, 1);
    assert.equal(res.json!.unitLocked, true);
    assert.equal((await state(goal.id)).logs[0].amount, 10);
  });
  await t.test('U03 initial zero separate correction; combined bypass refused', async () => {
    const { goal } = await create(a, { ...input, initialProgress: 10 });
    assert.equal((await patch(a, goal, { initialProgress: 0, unit: 'sessions' })).status, 422);
    const zero = await patch(a, goal, { initialProgress: 0 });
    assert.equal(zero.status, 200);
    assert.equal((await patch(a, zero.json as unknown as Goal, { unit: 'sessions' })).status, 200);
  });
  await t.test('U04 new SKIP-only allows unit change; old backfill covered by M01', async () => {
    const { goal } = await create(a);
    await log(a, goal, { status: 'SKIPPED' });
    assert.equal((await get(goal)).unitLocked, false);
    assert.equal((await patch(a, goal, { unit: 'sessions' })).status, 200);
  });
  await t.test('U05 DONE corrected to SKIPPED retains permanent marker', async () => {
    const { goal } = await create(a);
    await log(a, goal, { status: 'DONE', amount: 10 });
    await log(a, goal, { status: 'SKIPPED' });
    assert.equal((await get(goal)).unitLocked, true);
    assert.equal((await patch(a, goal, { unit: 'sessions' })).status, 422);
  });
  await t.test('U06 both controlled first-DONE/unit-PATCH lock orders', async () => {
    for (const doneFirst of [true, false]) {
      const { goal } = await create(a);
      const holder = await db.pool.connect();
      const firstPool = new pg.Pool({ connectionString: db.connectionString, max: 1, application_name: '148-first' });
      const secondPool = new pg.Pool({ connectionString: db.connectionString, max: 1, application_name: '148-second' });
      let first: Promise<unknown> | undefined;
      let second: Promise<unknown> | undefined;
      const done = (pool: pg.Pool) => putLog(pool, owner.id, goal.id, goal.today, { status: 'DONE', amount: 10, expectedGoalSettingsRevision: 0 }, () => NOW);
      const change = (pool: pg.Pool) => updateGoal(pool, owner.id, goal.id, { unit: 'sessions', expectedGoalSettingsRevision: 0 }, () => NOW);
      try {
        await holder.query('begin');
        await holder.query('select id from goal where id = $1 for update', [goal.id]);
        first = doneFirst ? done(firstPool) : change(firstPool);
        await waitForLock(db.pool, '148-first');
        second = doneFirst ? change(secondPool) : done(secondPool);
        await waitForLock(db.pool, '148-second');
        await holder.query('commit');
        const one = await first as { kind: string };
        const two = await second as { kind: string };
        assert.equal(one.kind, doneFirst ? 'saved' : 'updated');
        assert.equal(two.kind, doneFirst ? 'unit_locked' : 'settings_conflict');
        const stored = await state(goal.id);
        assert.equal(stored.goal[0].unit, doneFirst ? 'minutes' : 'sessions');
        assert.equal(stored.logs.length, doneFirst ? 1 : 0);
      } finally {
        await holder.query('rollback').catch(() => {});
        holder.release();
        await Promise.allSettled([first, second]);
        await firstPool.end();
        await secondPool.end();
      }
    }
  });
  await t.test('V01 stale displayed 10 after setting 100 is 409; V02 explicit fresh retry saves 10', async () => {
    const { goal } = await create(a);
    const changed = await patch(a, goal, { sessionAmount: 100 });
    assert.equal(changed.status, 200);
    const before = await state(goal.id);
    const stale = await log(a, goal, { status: 'DONE', amount: 10 });
    assert.equal(stale.status, 409);
    assert.equal(code(stale.json), 'GOAL_SETTINGS_CONFLICT');
    assert.deepEqual(await state(goal.id), before);
    const latest = await get(goal);
    const saved = await log(a, latest, { status: 'DONE', amount: 10 });
    assert.equal(saved.status, 200);
    assert.equal(saved.json!.amount, 10);
  });
  await t.test('V03 no-op/answer/log leaves settings version; actual fields increment once', async () => {
    let { goal } = await create(a);
    for (const body of [{ title: goal.title }, { questionPrior: { a: 'LOW', b: null }, expectedAnswerRevision: 0 }]) {
      const res = await patch(a, goal, body);
      assert.equal(res.status, 200);
      assert.equal(res.json!.goalSettingsRevision, 0);
    }
    await log(a, goal, { status: 'SKIPPED' });
    assert.equal((await get(goal)).goalSettingsRevision, 0);
    const changed = await patch(a, goal, { title: 'different', totalRequired: 700, sessionAmount: 20 });
    assert.equal(changed.status, 200);
    goal = changed.json as unknown as Goal;
    assert.equal(goal.goalSettingsRevision, 1);
  });
  await t.test('V04 stale same-value PATCH and log are still 409 without effects', async () => {
    const { goal } = await create(a);
    await patch(a, goal, { title: 'latest' });
    const before = await state(goal.id);
    assert.equal((await patch(a, goal, { title: 'latest' })).status, 409);
    assert.equal((await log(a, goal, { status: 'SKIPPED' })).status, 409);
    assert.deepEqual(await state(goal.id), before);
  });
  await t.test('V05 int4 revision exhaustion rolls back whole update', async () => {
    const { goal } = await create(a);
    await db.pool.query('update goal set goal_settings_revision = 2147483647 where id = $1', [goal.id]);
    const latest = await get(goal);
    const before = await state(goal.id);
    const res = await patch(a, latest, { title: 'must rollback' });
    assert.equal(res.status, 422);
    assert.equal(code(res.json), 'GOAL_SETTINGS_REVISION_EXHAUSTED');
    assert.deepEqual(await state(goal.id), before);
  });
  await t.test('V06 amount invalid with valid owner/date/revision has no effects', async () => {
    const { goal } = await create(a);
    const before = await state(goal.id);
    for (const body of [{ status: 'DONE' }, ...[0, -1, 0.5, 2147483648].map(amount => ({ status: 'DONE', amount })), { status: 'SKIPPED', amount: 10 }]) {
      assert.equal((await log(a, goal, body)).status, 422, JSON.stringify(body));
      assert.deepEqual(await state(goal.id), before);
    }
  });
  await t.test('V07 other owner GET/PATCH/PUT is 404', async () => {
    const { goal } = await create(a);
    const before = await state(goal.id);
    for (const [method, path, body] of [['GET', `/api/goals/${goal.id}`, undefined], ['PATCH', `/api/goals/${goal.id}`, { title: 'x', expectedGoalSettingsRevision: 0 }], ['PUT', `/api/goals/${goal.id}/logs/${goal.today}`, { status: 'DONE', amount: 10, expectedGoalSettingsRevision: 0 }]] as const) {
      assert.equal((await b.rawCall(method, path, body)).status, 404);
    }
    assert.deepEqual(await state(goal.id), before);
  });
  await t.test('V08 missing/invalid revision independently returns 422', async () => {
    const { goal } = await create(a);
    const before = await state(goal.id);
    for (const value of [undefined, null, -1, 0.5, '0', 2147483648]) {
      const token = value === undefined ? {} : { expectedGoalSettingsRevision: value };
      for (const [method, path, body] of [['PATCH', `/api/goals/${goal.id}`, { title: 'x', ...token }], ['PUT', `/api/goals/${goal.id}/logs/${goal.today}`, { status: 'DONE', amount: 10, ...token }]] as const) {
        const res = await a.rawCall(method, path, body);
        assert.equal(res.status, 422);
        assert.ok((res.json!.error as { fields: { path: string }[] }).fields.some(f => f.path === 'body/expectedGoalSettingsRevision'));
      }
      assert.deepEqual(await state(goal.id), before);
    }
  });
  await t.test('I01 serial replay 201/200/current ID/header; I03 discarded response recovery', async () => {
    const { goal, key } = await create(a);
    const replay = await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key });
    assert.equal(replay.status, 200);
    assert.equal(replay.json!.id, goal.id);
    assert.equal(replay.headers['idempotency-replayed'], 'true');
    const droppedKey = randomUUID();
    await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': droppedKey });
    const recovered = await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': droppedKey });
    assert.equal(recovered.status, 200);
    assert.equal((await db.pool.query('select count(*)::int as n from goal_create_operation where user_id=$1 and idempotency_key=$2', [owner.id, droppedKey])).rows[0].n, 1);
    // This case discards the received result. Real transport cutting is a separate browser/API harness check.
  });
  await t.test('I02 concurrent same operation commits exactly one owner/hash/Goal', async () => {
    const key: string = randomUUID();
    const replies = await Promise.all([a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key }), a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key })]);
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 201]);
    assert.equal(replies[0].json!.id, replies[1].json!.id);
    const rows = (await db.pool.query('select o.*, g.user_id as goal_owner from goal_create_operation o join goal g on g.id=o.goal_id where o.user_id=$1 and o.idempotency_key=$2', [owner.id, key])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].goal_owner, owner.id);
    assert.equal(rows[0].request_hash, createRequestHash(input));
  });
  await t.test('I04 changed body conflicts without writes; I07 compares original create hash after edit', async () => {
    const { goal, key } = await create(a);
    await patch(a, goal, { title: 'edited' });
    const before = await state(goal.id);
    const conflict = await a.rawCall('POST', '/api/goals', { ...input, title: 'different' }, { 'idempotency-key': key });
    assert.equal(conflict.status, 409);
    assert.equal(code(conflict.json), 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(await state(goal.id), before);
    const replay = await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key });
    assert.equal(replay.status, 200);
    assert.equal(replay.json!.title, 'edited');
    assert.equal(replay.json!.id, goal.id);
  });
  await t.test('I05 same UUID under two owners is independent', async () => {
    const key: string = randomUUID();
    const one = await create(a, input, key);
    const two = await create(b, input, key);
    assert.notEqual(one.goal.id, two.goal.id);
  });
  await t.test('I11 X-Create-Owner mismatch rejects fresh/replay without Goal/log/ledger writes', async () => {
    const ownerB = ((await b.rawCall('GET', '/api/auth/get-session')).json!.user as { id: string }).id;
    assert.notEqual(owner.id, ownerB);
    // Auth may refresh a session. The no-write contract concerns application data,
    // including original prior metadata, timestamps and idempotency reservations.
    const snapshot = async () => ({
      goals: (await db.pool.query('select * from goal order by id')).rows,
      logs: (await db.pool.query('select * from action_log order by goal_id, local_date')).rows,
      operations: (await db.pool.query('select * from goal_create_operation order by user_id, idempotency_key')).rows,
    });
    const original = { ...input, questionPrior: { a: 'LOW', b: 'HIGH' } } as const;
    const { goal, key } = await create(a, original);
    assert.equal((await log(a, goal, { status: 'DONE', amount: 10 })).status, 200);
    const other = await create(b, original, key);
    assert.notEqual(other.goal.id, goal.id);
    assert.equal((await log(b, other.goal, { status: 'DONE', amount: 10 })).status, 200);
    const before = await snapshot();
    for (const attemptedKey of [randomUUID(), key]) {
      for (const [client, claimedOwner] of [[a, ownerB], [b, owner.id]] as const) {
        const res = await client.rawCall('POST', '/api/goals', original,
          { 'idempotency-key': attemptedKey, 'x-create-owner': claimedOwner });
        assert.equal(res.status, 409, res.body);
        assert.equal(code(res.json), 'CREATE_OWNER_CHANGED');
        assert.deepEqual(await snapshot(), before);
      }
    }
    // Prove both supported paths reach normal creation/replay rather than rejecting every POST.
    for (const headers of [{ 'x-create-owner': owner.id }, {}]) {
      const key = randomUUID();
      const first = await a.rawCall('POST', '/api/goals', input, { ...headers, 'idempotency-key': key });
      assert.equal(first.status, 201, first.body);
      const replay = await a.rawCall('POST', '/api/goals', input, { ...headers, 'idempotency-key': key });
      assert.equal(replay.status, 200, replay.body);
      assert.equal(replay.json!.id, first.json!.id);
      assert.equal(replay.headers['idempotency-replayed'], 'true');
    }
  });
  await t.test('I06 defaults and UUID case canonicalize equally', async () => {
    const key: string = randomUUID();
    const { goal } = await create(a, input, key.toUpperCase());
    const replay = await a.rawCall('POST', '/api/goals', { ...input, initialProgress: 0, questionPrior: { a: null, b: null } }, { 'idempotency-key': key });
    assert.equal(replay.status, 200);
    assert.equal(replay.json!.id, goal.id);
  });
  await t.test('I08 delete keeps original owner/hash tombstone and never revives', async () => {
    const { goal, key } = await create(a);
    assert.equal((await a.rawCall('DELETE', `/api/goals/${goal.id}`)).status, 204);
    const replay = await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key });
    assert.equal(replay.status, 410);
    assert.equal(code(replay.json), 'CREATE_RESULT_DELETED');
    const row = (await db.pool.query('select * from goal_create_operation where user_id=$1 and idempotency_key=$2', [owner.id, key])).rows[0];
    assert.equal(row.user_id, owner.id);
    assert.equal(row.request_hash, createRequestHash(input));
    assert.equal(row.goal_id, null);
    assert.equal((await state(goal.id)).goal.length, 0);
  });
  await t.test('I09 failure after reservation rolls back Goal and ledger', async () => {
    const key: string = randomUUID();
    const before = (await db.pool.query('select count(*)::int as n from goal')).rows[0].n;
    await assert.rejects(createGoalOnce(db.pool, owner.id, input, () => { throw new Error('synthetic clock failure'); }, key));
    assert.equal((await db.pool.query('select count(*)::int as n from goal')).rows[0].n, before);
    assert.equal((await db.pool.query('select count(*)::int as n from goal_create_operation where user_id=$1 and idempotency_key=$2', [owner.id, key])).rows[0].n, 0);
    assert.equal((await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key })).status, 201);
  });
  await t.test('I10 missing/empty/invalid key rejects valid body before insert', async () => {
    const before = (await db.pool.query('select count(*)::int as n from goal')).rows[0].n;
    for (const key of [undefined, '', 'not-uuid']) {
      const res = await a.rawCall('POST', '/api/goals', input, key === undefined ? {} : { 'idempotency-key': key });
      assert.equal(res.status, 422);
    }
    assert.equal((await db.pool.query('select count(*)::int as n from goal')).rows[0].n, before);
  });
  await t.test('M02 demo seed/reset markers and ordinary create ledger retained', async () => {
    const { goal, key } = await create(a);
    const first = await seedDemo(db.pool, { userId: owner.id, timezone: 'Asia/Tokyo', now: () => NOW });
    for (const item of first.goals) assert.equal((await get({ ...goal, id: item.id })).unitLocked, true);
    await seedDemo(db.pool, { userId: owner.id, timezone: 'Asia/Tokyo', now: () => NOW });
    assert.equal((await a.rawCall('POST', '/api/goals', input, { 'idempotency-key': key })).json!.id, goal.id);
  });
});

test('M01 migration first/repeated preserves old quantities/dates/metadata and conservatively locks old SKIP-only', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool, 'auth');
  const base = resolve('apps/api/.local');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, '148-old-migrations-'));
  t.after(() => {
    // Only this test's newly created direct child may be removed, including on failure.
    assert.equal(dirname(resolve(dir)), base);
    rmSync(dir, { recursive: true, force: true });
  });
  const previous = ['0001_goal_action_log.sql', '0002_goal_record_start_date.sql', '0003_goal_question_prior.sql', '0004_demo_seed_goal.sql'];
  for (const name of previous) writeFileSync(join(dir, name), readFileSync(new URL(`../migrations/${name}`, import.meta.url)));
  const pending = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d{4}_.+\.sql$/.test(name) && !previous.includes(name)).sort();
  await migrateApp(db.pool, pathToFileURL(dir + '/'));
  await db.pool.query(`insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ('legacy','legacy','legacy@example.test',false,now(),now())`);
  const ids = [];
  for (const status of ['DONE', 'SKIPPED']) {
    const id = randomUUID();
    ids.push(id);
    await db.pool.query(`insert into goal (id,user_id,title,unit,total_required,session_amount,initial_progress,timezone,record_start_date) values ($1,'legacy','old','minutes',600,10,7,'Asia/Tokyo','2026-10-08')`, [id]);
    await db.pool.query(`insert into action_log (goal_id,local_date,status,amount) values ($1,'2026-10-08',$2,$3)`, [id,status,status === 'DONE' ? 10 : null]);
  }
  const before = (await db.pool.query('select id,unit,total_required,session_amount,initial_progress,record_start_date,created_at,updated_at from goal order by id')).rows;
  const logs = (await db.pool.query('select * from action_log order by goal_id')).rows;
  assert.deepEqual(await migrateApp(db.pool), { applied: pending });
  assert.deepEqual(await migrateApp(db.pool), { applied: [] });
  assert.deepEqual((await db.pool.query('select id,unit,total_required,session_amount,initial_progress,record_start_date,created_at,updated_at from goal order by id')).rows, before);
  assert.deepEqual((await db.pool.query('select * from action_log order by goal_id')).rows, logs);
  for (const id of ids) {
    assert.equal((await db.pool.query('select unit_history_locked,goal_settings_revision from goal where id=$1', [id])).rows[0].unit_history_locked, true);
    assert.deepEqual(await updateGoal(db.pool, 'legacy', id, { unit: 'sessions', expectedGoalSettingsRevision: 0 }, () => NOW), { kind: 'unit_locked' });
  }
});
