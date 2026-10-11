import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import type { Goal, GoalCreate } from '../src/contracts/goal.ts';
import type { LearningArtifactSummary, LearningReport, TodayLearning } from '../src/contracts/learning.ts';
import { fitLearning, loadLearningState, purgeExpiredLearning } from '../src/learning/store.ts';
import { learningPolicy } from '../src/learning/policy.ts';
import { Client, setup, signedInClient, startStack } from './helpers/stack.ts';

const instant = new Date('2026-10-11T12:00:00Z');
const input: GoalCreate = { title: 'synthetic learning title', unit: 'minutes', totalRequired: 1000,
  initialProgress: 0, sessionAmount: 10, timezone: 'UTC' };
const path = (goal: Goal) => `/api/goals/${goal.id}/learning`;
const check = (response: Awaited<ReturnType<Client['sendExact']>>, status: number) => {
  assert.equal(response.status, status, response.body); assert.equal(response.headers['cache-control'], 'no-store'); return response;
};
const create = async (client: Client) => check(await client.sendExact('POST', '/api/goals', input,
  { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
const report = async (client: Client, goal: Goal) => check(await client.sendExact('GET', path(goal)), 200).json as unknown as LearningReport;
const join = async (client: Client, goal: Goal) => check(await client.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
const fitBody = (state: LearningReport) => ({ expectedGoalSettingsRevision: state.goalSettingsRevision,
  expectedAnswerRevision: state.answerRevision, expectedParticipationId: state.participation!.id, expectedActiveRevision: state.activeRevision });

function pauseReservedFit(pool: pg.Pool) {
  const connect = pool.connect;
  let open!: () => void, reached = false, claimed = false;
  const gate = new Promise<void>(resolve => { open = resolve; });
  pool.connect = ((...args: unknown[]) => {
    if (args.some(arg => typeof arg === 'function')) return Reflect.apply(connect, pool, args);
    return Promise.resolve(Reflect.apply(connect, pool, args)).then((client: pg.PoolClient) => {
      const query = client.query, release = client.release;
      let reserved = false;
      client.query = ((...queryArgs: unknown[]) => {
        const sql = typeof queryArgs[0] === 'string' ? queryArgs[0].trim().toLowerCase() : '';
        if (sql.startsWith('update learning_participation set fit_generation')) reserved = true;
        if (!claimed && reserved && sql === 'commit') {
          claimed = true; pool.connect = connect;
          return Promise.resolve(Reflect.apply(query, client, queryArgs)).then(async result => {
            reached = true; await gate; return result;
          });
        }
        return Reflect.apply(query, client, queryArgs);
      }) as typeof client.query;
      client.release = (...releaseArgs) => { client.query = query; client.release = release; Reflect.apply(release, client, releaseArgs); };
      return client;
    });
  }) as typeof pool.connect;
  return { open, restore: () => { pool.connect = connect; open(); }, wait: async () => {
    const deadline = Date.now() + 5_000;
    while (!reached && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(reached, 'fit did not commit its reservation');
  } };
}

// One owned embedded synthetic cluster for this file. The caller must unset DATABASE_URL.
test('#227 learning owner/consent/CAS HTTP boundaries with actual storage', async t => {
  const safeDatabase = process.env.DATABASE_URL === undefined || (process.env.GITHUB_ACTIONS === 'true' &&
    process.env.DATABASE_URL === 'postgres://futureroi:ci-only-placeholder@127.0.0.1:5432/futureroi');
  assert.ok(safeDatabase, 'Only absent local URI or the known isolated CI fixture is allowed');
  const { db, stack } = await setup(t, { now: () => instant, evaluation: { enabled: true, buildVersion: 'learning-synthetic' } }, {
    startStack: (db, options) => startStack(db, options, { buildApp: options => buildApp({ ...options, learning: { enabled: true } }) }),
  });
  const a = await signedInClient(stack.app, 'learning-owner');
  const b = await signedInClient(stack.app, 'learning-other');
  const anon = new Client(stack.app, 'http://127.0.0.1:3000');
  const goal = await create(a);
  const second = await create(a);
  await t.test('auth owner Origin strict contracts and no implicit participation', async () => {
    check(await anon.sendExact('GET', '/api/learning'), 401);
    check(await b.sendExact('GET', path(goal)), 404);
    check(await anon.sendExact('GET', path(goal)), 401);
    for (const [method, suffix, body] of [
      ['PUT', '/participation', { policyVersion: 'self-learning-v1' }],
      ['DELETE', '/participation', { expectedParticipationId: randomUUID() }],
      ['POST', '/fits', { expectedGoalSettingsRevision: 0, expectedAnswerRevision: 0, expectedParticipationId: randomUUID(), expectedActiveRevision: 0 }],
      ['PUT', '/active', { artifactId: randomUUID(), artifactHash: 'a'.repeat(64), expectedParticipationId: randomUUID(), expectedActiveRevision: 0 }],
      ['DELETE', '/active', { expectedParticipationId: randomUUID(), expectedActiveRevision: 0 }],
    ] as const) {
      check(await b.sendExact(method, `${path(goal)}${suffix}`, body), 404);
      check(await anon.sendExact(method, `${path(goal)}${suffix}`, body), 401);
      check(await a.sendExact(method, `${path(goal)}${suffix}`, body, { origin: '' }), 403);
    }
    check(await a.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: 'self-learning-v1' }, { origin: 'https://foreign.example.test' }), 403);
    for (const body of [{}, { policyVersion: 'self-evaluation-v1' }, { policyVersion: 'self-learning-v1', userId: 'forged' }])
      check(await a.sendExact('PUT', `${path(goal)}/participation`, body), 422);
    assert.equal((await report(a, goal)).participation, null);
    for (const query of ['01', '-1', '1.5', '2147483648', 'true']) check(await a.sendExact('GET', `${path(goal)}/today?amount=${query}`), 422);
    check(await a.sendExact('GET', `${path(goal)}/today?amount=0`), 200);
    check(await a.sendExact('GET', `${path(goal)}/today?amount=2147483647`), 200);
  });
  await t.test('separate consent one goal UUID generation and stale withdrawal', async () => {
    await join(a, goal); await join(a, goal);
    const state = await report(a, goal);
    assert.ok(state.participation); assert.equal(state.activeRevision, 0);
    check(await a.sendExact('PUT', `${path(second)}/participation`, { policyVersion: 'self-learning-v1' }), 409);
    check(await a.sendExact('DELETE', `${path(goal)}/participation`, {}), 422);
    check(await a.sendExact('DELETE', `${path(goal)}/participation`, { expectedParticipationId: randomUUID() }), 409);
    assert.equal((await db.pool.query('select count(*)::int n from evaluation_participation')).rows[0].n, 0);
  });
  await t.test('fit stores insufficient gate truthfully with immutable inputs, cannot adopt, bounded count', async () => {
    let state = await report(a, goal);
    check(await a.sendExact('POST', `${path(goal)}/fits`, { ...fitBody(state), numeric: {}, gammaPrior: [] }), 422);
    check(await a.sendExact('POST', `${path(goal)}/fits`, { ...fitBody(state), expectedGoalSettingsRevision: 999 }), 409);
    check(await a.sendExact('POST', `${path(goal)}/fits`, { ...fitBody(state), expectedAnswerRevision: 999 }), 409);
    const artifact = check(await a.sendExact('POST', `${path(goal)}/fits`, fitBody(state)), 201).json as unknown as LearningArtifactSummary;
    assert.notEqual(artifact.gate.status, 'ADOPTABLE'); assert.ok(artifact.gate.reasons.length);
    assert.match(artifact.hash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(artifact), /synthetic learning title|example\.test|password|cookie|userId/);
    check(await a.sendExact('PUT', `${path(goal)}/active`, { artifactId: artifact.id, artifactHash: artifact.hash,
      expectedParticipationId: state.participation!.id, expectedActiveRevision: 0 }), 409);
    for (let i = 0; i < 6; i++) { state = await report(a, goal); check(await a.sendExact('POST', `${path(goal)}/fits`, fitBody(state)), 201); }
    state = await report(a, goal); assert.equal(state.artifacts.length, 5); assert.equal(state.participation!.fitGeneration, 7);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact')).rows[0].n, 5);
    const today = check(await a.sendExact('GET', `${path(goal)}/today`), 200).json as unknown as TodayLearning;
    assert.equal(today.selectedForecast.source, 'BASELINE'); assert.equal(today.selectedForecast.artifactId, null);
    check(await a.sendExact('DELETE', `${path(goal)}/active`, { expectedParticipationId: state.participation!.id, expectedActiveRevision: 0 }), 204);
    check(await a.sendExact('DELETE', `${path(goal)}/active`, { expectedParticipationId: state.participation!.id, expectedActiveRevision: 0 }), 409);
  });
  await t.test('withdrawal removes learned derived data only and rejoin rejects previous UUID', async () => {
    const state = await report(a, goal); const old = state.participation!.id;
    const owner = (await db.pool.query('select user_id from goal where id=$1', [goal.id])).rows[0].user_id;
    await db.pool.query('insert into learning_holdout_receipt(goal_id,user_id,through_date) values($1,$2,$3)', [goal.id, owner, '2026-09-01']);
    await a.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, { expectedGoalSettingsRevision: 0, status: 'SKIPPED' });
    await a.sendExact('PUT', `/api/goals/${goal.id}/evaluation/participation`, { policyVersion: 'self-evaluation-v1' });
    check(await a.sendExact('POST', `/api/goals/${goal.id}/evaluation/forecasts`, { expectedGoalSettingsRevision: 0 }), 201);
    const baseline = (await db.pool.query('select id,payload from evaluation_forecast where goal_id=$1', [goal.id])).rows[0];
    await db.pool.query(`insert into evaluation_forecast(id,goal_id,anchor_date,issued_at,expires_at,payload) values($1,$2,'2026-10-10',$3,$4,$5)`,
      [randomUUID(), goal.id, instant, new Date(instant.getTime() + 86_400_000), { ...baseline.payload, learningArtifactId: state.artifacts[0]!.id }]);
    check(await a.sendExact('DELETE', `${path(goal)}/participation`, { expectedParticipationId: old }), 204);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact')).rows[0].n, 0);
    assert.deepEqual((await db.pool.query('select id from evaluation_forecast where goal_id=$1', [goal.id])).rows.map(row => row.id), [baseline.id]);
    assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [goal.id])).rows[0].n, 1);
    await join(a, goal); const current = await report(a, goal); assert.notEqual(current.participation!.id, old);
    assert.equal((await db.pool.query('select through_date::text through_date from learning_holdout_receipt where goal_id=$1', [goal.id])).rows[0].through_date,
      '2026-09-01', 'withdraw/rejoin must not reset previously consumed labels');
    check(await a.sendExact('POST', `${path(goal)}/fits`, { ...fitBody(current), expectedParticipationId: old }), 409);
  });
  await t.test('read retains older active pointer when artifact limit is tightened', async () => {
    const raceClient = await signedInClient(stack.app, 'learning-limit-reader');
    const raceGoal = await create(raceClient); await join(raceClient, raceGoal);
    for (let i = 0; i < 5; i++) {
      const state = await report(raceClient, raceGoal);
      check(await raceClient.sendExact('POST', `${path(raceGoal)}/fits`, fitBody(state)), 201);
    }
    const state = await report(raceClient, raceGoal), oldest = state.artifacts.at(-1)!;
    const owner = (await db.pool.query('select user_id from goal where id=$1', [raceGoal.id])).rows[0].user_id;
    // Storage-only pointer fixture. This does not claim the insufficient artifact is adoptable.
    await db.pool.query('insert into learning_activation(participation_id,user_id,goal_id,artifact_id) values($1,$2,$3,$4)',
      [state.participation!.id, owner, raceGoal.id, oldest.id]);
    const loaded = await loadLearningState(db.pool, owner, raceGoal.id, () => instant, learningPolicy({ enabled: true, maxArtifacts: 2 }));
    assert.equal(loaded!.artifacts.length, 2); assert.equal(loaded!.artifacts[0]!.id, oldest.id);
    assert.equal(loaded!.activeArtifactId, oldest.id);
  });
  await t.test('fit write serialization stays at final CAS clock before participation expiry', async () => {
    const client = await signedInClient(stack.app, 'learning-final-clock');
    const fresh = await create(client); await join(client, fresh);
    const state = await report(client, fresh), owner = (await db.pool.query('select user_id from goal where id=$1', [fresh.id])).rows[0].user_id;
    const deadline = new Date(instant.getTime() + 1000);
    await db.pool.query('update learning_participation set expires_at=$2 where goal_id=$1', [fresh.id, deadline]);
    let calls = 0;
    const clock = () => ++calls <= 2 ? instant : deadline;
    const artifact = await fitLearning(db.pool, owner, fresh.id, fitBody(state), clock, learningPolicy({ enabled: true }));
    assert.ok(artifact); assert.equal(calls, 2, 'report serialization must not resample the clock after a successful CAS');
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where id=$1', [artifact.id])).rows[0].n, 1);
  });
  await t.test('database rejects mismatched owner goal/participation references', async () => {
    const ownerB = (await db.pool.query('select id from "user" where email like $1', ['learning-other-%'])).rows[0]?.id;
    assert.ok(ownerB);
    await assert.rejects(db.pool.query(`insert into learning_participation(user_id,goal_id,policy_version,joined_at,expires_at)
      values($1,$2,'self-learning-v1',$3,$4)`, [ownerB, second.id, instant, new Date(instant.getTime() + 86_400_000)]), { code: '23503' });
  });
  await t.test('two-phase fit rejects superseded generation, rejoin, input and context changes', async t => {
    for (const change of ['superseded', 'withdraw-rejoin', 'input', 'settings'] as const) await t.test(change, async () => {
      const client = await signedInClient(stack.app, `learning-race-${change}`);
      const goal = await create(client); await join(client, goal);
      check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, { expectedGoalSettingsRevision: 0, status: 'SKIPPED' }), 200);
      const before = await report(client, goal); const barrier = pauseReservedFit(db.pool);
      const pending = client.sendExact('POST', `${path(goal)}/fits`, fitBody(before));
      try {
        await barrier.wait();
        if (change === 'superseded') check(await client.sendExact('POST', `${path(goal)}/fits`, fitBody(before)), 201);
        if (change === 'withdraw-rejoin') {
          check(await client.sendExact('DELETE', `${path(goal)}/participation`, { expectedParticipationId: before.participation!.id }), 204);
          await join(client, goal);
        }
        if (change === 'input') check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, {
          expectedGoalSettingsRevision: 0, status: 'DONE', amount: 1 }), 200);
        if (change === 'settings') check(await client.sendExact('PATCH', `/api/goals/${goal.id}`, { expectedGoalSettingsRevision: 0, totalRequired: 1001 }), 200);
        barrier.open(); const result = check(await pending, 409);
        assert.equal((result.json!.error as { code: string }).code, change === 'superseded' ? 'LEARNING_FIT_SUPERSEDED' :
          change === 'withdraw-rejoin' ? 'LEARNING_PARTICIPATION_CHANGED' : 'LEARNING_INPUT_CHANGED');
        assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where goal_id=$1', [goal.id])).rows[0].n, change === 'superseded' ? 1 : 0);
      } finally { barrier.restore(); await pending; }
    });
  });
  await t.test('default OFF capability works even without learning tables', async () => {
    const off = await startStack(db, { now: () => instant });
    try {
      const client = await signedInClient(off.app, 'learning-off');
      await db.pool.query('alter table learning_participation rename to synthetic_hidden_learning_participation');
      try {
        assert.equal(check(await client.sendExact('GET', '/api/learning'), 200).json!.enabled, false);
        for (const [method, suffix, body] of [['GET', '', undefined], ['GET', '/today', undefined],
          ['PUT', '/participation', { policyVersion: 'self-learning-v1' }], ['POST', '/fits', {}]] as const)
          check(await client.sendExact(method, `${path(goal)}${suffix}`, body), 404);
      } finally { await db.pool.query('alter table synthetic_hidden_learning_participation rename to learning_participation'); }
    } finally { await off.close(); }
  });
  await t.test('expired derived data purge is transactional and preserves business data/receipt', async () => {
    const before = await report(a, goal);
    const artifact = check(await a.sendExact('POST', `${path(goal)}/fits`, fitBody(before)), 201).json as unknown as LearningArtifactSummary;
    await db.pool.query('update learning_artifact set created_at=$2,expires_at=$3 where id=$1',
      [artifact.id, new Date(instant.getTime() - 86_400_000), instant]);
    await db.pool.query('update learning_participation set joined_at=$2,expires_at=$3 where goal_id=$1',
      [goal.id, new Date(instant.getTime() - 86_400_000), instant]);
    assert.equal((await report(a, goal)).participation, null);
    await db.pool.query(`create function learning_test_reject_purge() returns trigger language plpgsql as $$
      begin raise exception 'synthetic learning purge rejection'; end $$`);
    await db.pool.query('create trigger learning_test_reject_purge before delete on learning_participation for each row execute function learning_test_reject_purge()');
    try {
      await assert.rejects(purgeExpiredLearning(db.pool, instant), /synthetic learning purge rejection/);
      assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where id=$1', [artifact.id])).rows[0].n, 1);
    } finally {
      await db.pool.query('drop trigger learning_test_reject_purge on learning_participation');
      await db.pool.query('drop function learning_test_reject_purge()');
    }
    const result = await purgeExpiredLearning(db.pool, instant);
    assert.equal(result.participations, 1); assert.equal(result.artifacts, 1);
    assert.deepEqual(await purgeExpiredLearning(db.pool, instant), { forecasts: 0, artifacts: 0, participations: 0 });
    assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [goal.id])).rows[0].n, 1);
    assert.equal((await db.pool.query('select count(*)::int n from learning_holdout_receipt where goal_id=$1', [goal.id])).rows[0].n, 1);
    check(await a.sendExact('DELETE', `/api/goals/${goal.id}`), 204);
    assert.equal((await db.pool.query('select count(*)::int n from learning_holdout_receipt where goal_id=$1', [goal.id])).rows[0].n, 0);
  });
});
