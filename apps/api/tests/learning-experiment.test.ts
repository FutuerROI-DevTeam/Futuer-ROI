import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { forecastDurationModel } from '@futureroi/prediction';
import { buildApp } from '../src/app.ts';
import type { Goal, GoalCreate } from '../src/contracts/goal.ts';
import type { LearningArtifactSummary, LearningComparison, LearningReport, TodayLearning } from '../src/contracts/learning.ts';
import type { LearningFitComputation } from '../src/learning/types.ts';
import { purgeExpiredLearning } from '../src/learning/store.ts';
import { Client, setup, signedInClient, startStack } from './helpers/stack.ts';

const START = new Date('2026-10-11T12:00:00Z'), DAY = 86_400_000;
const input: GoalCreate = { title: 'synthetic experiment', unit: 'minutes', totalRequired: 50,
  initialProgress: 0, sessionAmount: 10, timezone: 'UTC' };
const path = (goal: Goal) => `/api/goals/${goal.id}/learning`;
const check = (response: Awaited<ReturnType<Client['sendExact']>>, status: number) => {
  assert.equal(response.status, status, response.body); assert.equal(response.headers['cache-control'], 'no-store'); return response;
};
const report = async (client: Client, goal: Goal) => check(await client.sendExact('GET', path(goal)), 200).json as unknown as LearningReport;
const fitBody = (state: LearningReport) => ({ expectedGoalSettingsRevision: state.goalSettingsRevision,
  expectedAnswerRevision: state.answerRevision, expectedParticipationId: state.participation!.id, expectedActiveRevision: state.activeRevision });
const query = (artifact: LearningArtifactSummary, amount?: string) =>
  `artifactId=${artifact.id}&artifactHash=${artifact.hash}${amount === undefined ? '' : `&amount=${amount}`}`;

function pauseReservedExperiment(pool: pg.Pool) {
  const connect = pool.connect; let open!: () => void, reached = false, claimed = false;
  const gate = new Promise<void>(resolve => { open = resolve; });
  pool.connect = ((...args: unknown[]) => {
    if (args.some(arg => typeof arg === 'function')) return Reflect.apply(connect, pool, args);
    return Promise.resolve(Reflect.apply(connect, pool, args)).then((client: pg.PoolClient) => {
      const query = client.query, release = client.release; let reserved = false;
      client.query = ((...queryArgs: unknown[]) => {
        const sql = typeof queryArgs[0] === 'string' ? queryArgs[0].trim().toLowerCase() : '';
        if (sql.startsWith('update learning_participation set fit_generation')) reserved = true;
        if (!claimed && reserved && sql === 'commit') {
          claimed = true; pool.connect = connect;
          return Promise.resolve(Reflect.apply(query, client, queryArgs)).then(async result => { reached = true; await gate; return result; });
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
    assert.ok(reached, 'experiment did not commit its reservation');
  } };
}

// Actual HTTP -> fitDurationModel -> owned synthetic DB -> forecast. No ADOPTABLE
// gate or numeric artifact is injected. This verifies experimental wiring only,
// not improvement or empirical 80% calibration on personal data.
test('#227 actual-fit experimental comparison stays separate from qualified primary', async t => {
  const safeDatabase = process.env.DATABASE_URL === undefined || (process.env.GITHUB_ACTIONS === 'true' &&
    process.env.DATABASE_URL === 'postgres://futureroi:ci-only-placeholder@127.0.0.1:5432/futureroi');
  assert.ok(safeDatabase, 'Only absent local URI or the known isolated CI fixture is allowed');
  let now = START;
  const { db, stack } = await setup(t, { now: () => now, evaluation: { enabled: true, buildVersion: 'synthetic-experiment' } }, {
    startStack: (db, options) => startStack(db, options, { buildApp: options => buildApp({ ...options, learning: { enabled: true } }) }),
  });
  const other = await signedInClient(stack.app, 'experiment-other'), anon = new Client(stack.app, 'http://127.0.0.1:3000');
  async function fixture(tag: string, withHistory = true) {
    now = START;
    const client = await signedInClient(stack.app, tag);
    let goal = check(await client.sendExact('POST', '/api/goals', input, { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
    if (withHistory) {
      // Synthetic canonical business records only; no private dataset imported.
      await db.pool.query("update goal set record_start_date='2026-10-04' where id=$1", [goal.id]);
      for (const [i, status] of ['DONE', 'SKIPPED', 'DONE', 'DONE', 'SKIPPED', 'SKIPPED', 'DONE', 'DONE'].entries()) {
        const date = new Date(START.getTime() - (7 - i) * DAY).toISOString().slice(0, 10);
        await db.pool.query('insert into action_log(goal_id,local_date,status,amount) values($1,$2,$3,$4)', [goal.id, date, status, status === 'DONE' ? 7 : null]);
      }
      goal = check(await client.sendExact('PATCH', `/api/goals/${goal.id}`, { expectedGoalSettingsRevision: 0,
        expectedAnswerRevision: 0, questionPrior: { a: 'HIGH', b: 'HIGH' } }), 200).json as unknown as Goal;
    }
    check(await client.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
    return { client, goal, state: await report(client, goal) };
  }
  const f = await fixture('experiment-real-fit');
  let artifact!: LearningArtifactSummary;
  await t.test('owner/auth/Origin/CAS/strict input and no implicit participation', async () => {
    check(await other.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 404);
    check(await anon.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 401);
    check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state), { origin: '' }), 403);
    check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, { ...fitBody(f.state), numeric: {} }), 422);
    check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, { ...fitBody(f.state), expectedAnswerRevision: 999 }), 409);
    check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, { ...fitBody(f.state), expectedParticipationId: randomUUID() }), 409);
    const newGoal = check(await f.client.sendExact('POST', '/api/goals', input, { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
    check(await f.client.sendExact('POST', `${path(newGoal)}/experiments`, fitBody(f.state)), 409);
    assert.equal((await report(f.client, newGoal)).participation, null);
  });
  await t.test('short-history real fit freezes current prior and training prefix without consuming holdout', async () => {
    const owner = (await db.pool.query('select user_id from goal where id=$1', [f.goal.id])).rows[0].user_id;
    await db.pool.query("insert into learning_holdout_receipt(goal_id,user_id,through_date) values($1,$2,'2026-10-01')", [f.goal.id, owner]);
    artifact = check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 201).json as unknown as LearningArtifactSummary;
    assert.equal(artifact.purpose, 'EXPERIMENTAL'); assert.equal(artifact.gate.status, 'INSUFFICIENT');
    assert.deepEqual(artifact.gate.reasons, ['EXPERIMENTAL_NOT_QUALIFIED']); assert.equal(artifact.eligible, false);
    const row = (await db.pool.query<{ payload: LearningFitComputation }>('select payload from learning_artifact where id=$1', [artifact.id])).rows[0]!;
    assert.equal(row.payload.purpose, 'EXPERIMENTAL'); assert.equal(row.payload.trainingCutoff, f.goal.today);
    assert.equal(row.payload.comparison.protocolVersion, 'duration-experimental-v1');
    assert.deepEqual(row.payload.comparison.validationAnchors, []); assert.deepEqual(row.payload.comparison.testAnchors, []);
    assert.equal(row.payload.comparison.holdoutThrough, null);
    assert.equal(row.payload.numeric!.kind, 'DURATION_JOINT_V1');
    if (row.payload.numeric?.kind !== 'DURATION_JOINT_V1') throw new Error('Actual experiment fit must persist joint numeric');
    assert.equal(row.payload.numeric.gammaPrior.length, 17); assert.equal(row.payload.numeric.capDays, 14);
    assert.deepEqual(row.payload.numeric.donePosterior, { alpha: 5, beta: 3 });
    assert.deepEqual(row.payload.numeric.skipReferencePosterior, { alpha: 5, beta: 2 });
    assert.equal((await db.pool.query('select through_date::text d from learning_holdout_receipt where goal_id=$1', [f.goal.id])).rows[0].d, '2026-10-01');
    assert.equal((await report(f.client, f.goal)).activeRevision, 0);
    assert.equal((await report(f.client, f.goal)).activeArtifactId, null);
  });
  await t.test('comparison forecasts actual numeric and leaves primary, active pointer and stored payload unchanged', async () => {
    const before = (await db.pool.query('select payload from learning_artifact where id=$1', [artifact.id])).rows[0].payload as LearningFitComputation;
    const compare = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(artifact)}`), 200).json as unknown as LearningComparison;
    assert.equal(compare.schemaVersion, 'learning-comparison-v1'); assert.equal(compare.experiment.source, 'EXPERIMENTAL');
    assert.equal(compare.reference.source, 'BASELINE'); assert.equal(compare.experiment.status, 'available');
    const forecast = forecastDurationModel(before.numeric!, { initialState: 'DONE', initialRestDays: 0,
      remainingAmount: 15, sessionAmount: 10, horizonDays: 30, samples: 8192, seed: 20261011 });
    assert.equal(forecast.status, 'available');
    if (forecast.status !== 'available') throw new Error('Small-N synthetic forecast must be available');
    assert.equal(forecast.computation.method, 'POSTERIOR_QUADRATURE');
    assert.equal(compare.experiment.p50Days, forecast.p50Days); assert.equal(compare.experiment.p80Days, forecast.p80Days);
    assert.equal(compare.experiment.reachProbability, forecast.cdf[30]);
    assert.equal(compare.experiment.todayAmount, null); assert.equal(compare.experiment.hypothetical, false);
    const primary = check(await f.client.sendExact('GET', `${path(f.goal)}/today`), 200).json as unknown as TodayLearning;
    assert.equal(primary.selectedForecast.source, 'BASELINE'); assert.deepEqual(primary.baseline, compare.baseline);
    assert.equal((await report(f.client, f.goal)).activeArtifactId, null); assert.equal((await report(f.client, f.goal)).activeRevision, 0);
    assert.deepEqual((await db.pool.query('select payload from learning_artifact where id=$1', [artifact.id])).rows[0].payload, before);
    check(await f.client.sendExact('PUT', `${path(f.goal)}/active`, { artifactId: artifact.id, artifactHash: artifact.hash,
      expectedParticipationId: f.state.participation!.id, expectedActiveRevision: 0 }), 409);
    check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/evaluation/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
    const issued = check(await f.client.sendExact('POST', `/api/goals/${f.goal.id}/evaluation/forecasts`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision }), 201).json!;
    assert.equal((await db.pool.query('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0].payload.learningArtifactId, undefined);
  });
  await t.test('comparison query is strict, owner scoped, hash exact and same-amount hypothetical without log mutation', async () => {
    check(await other.sendExact('GET', `${path(f.goal)}/compare?${query(artifact)}`), 404);
    check(await anon.sendExact('GET', `${path(f.goal)}/compare?${query(artifact)}`), 401);
    check(await f.client.sendExact('GET', `${path(f.goal)}/compare?artifactId=${randomUUID()}&artifactHash=${artifact.hash}`), 404);
    check(await f.client.sendExact('GET', `${path(f.goal)}/compare?artifactId=${artifact.id}&artifactHash=${'a'.repeat(64)}`), 409);
    for (const suffix of ['', 'artifactId=bad&artifactHash=' + artifact.hash, query(artifact) + '&unknown=1'])
      check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${suffix}`), 422);
    // ajv-formats accepts uppercase UUID and urn:uuid forms; this endpoint's
    // canonical query must reject them before PG casts / strict artifact lookup.
    for (const id of [artifact.id.toUpperCase(), `urn:uuid:${artifact.id}`])
      check(await f.client.sendExact('GET', `${path(f.goal)}/compare?artifactId=${encodeURIComponent(id)}&artifactHash=${artifact.hash}`), 422);
    for (const amount of ['01', '-1', '1.5', '2147483648', '10000000000', 'true'])
      check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(artifact, amount)}`), 422);
    const before = (await db.pool.query('select local_date,status,amount from action_log where goal_id=$1 order by local_date', [f.goal.id])).rows;
    for (const amount of ['0', '7', '2147483647']) {
      const compare = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(artifact, amount)}`), 200).json as unknown as LearningComparison;
      assert.equal(compare.experiment.todayAmount, Number(amount)); assert.equal(compare.reference.todayAmount, Number(amount));
      assert.equal(compare.experiment.hypothetical, true); assert.equal(compare.reference.hypothetical, true);
      assert.equal(compare.experiment.horizonDays, 30); assert.equal(compare.reference.horizonDays, 30);
      if (amount === '2147483647') { assert.equal(compare.experiment.status, 'completed'); assert.equal(compare.reference.status, 'completed'); }
    }
    assert.deepEqual((await db.pool.query('select local_date,status,amount from action_log where goal_id=$1 order by local_date', [f.goal.id])).rows, before);
  });
  await t.test('last observed cutoff allows a fresh today append but rejects correction inside the training prefix', async () => {
    const f = await fixture('experiment-last-observed-cutoff');
    await db.pool.query('delete from action_log where goal_id=$1 and local_date=$2', [f.goal.id, f.goal.today]);
    const saved = check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 201).json as unknown as LearningArtifactSummary;
    assert.equal(saved.trainingCutoff, '2026-10-10');
    const draft = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(saved)}`), 200).json as unknown as LearningComparison;
    assert.equal(draft.experiment.status, 'available'); assert.equal(draft.experiment.hypothetical, true);
    check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/logs/${f.goal.today}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, status: 'DONE', amount: 8 }), 200);
    const appended = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(saved)}`), 200).json as unknown as LearningComparison;
    assert.equal(appended.experiment.status, 'available'); assert.equal(appended.experiment.hypothetical, false);
    check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/logs/2026-10-10`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, status: 'DONE', amount: 8 }), 200);
    const corrected = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(saved)}`), 200).json as unknown as LearningComparison;
    assert.equal(corrected.experiment.status, 'insufficient'); assert.equal(corrected.experiment.reason, 'INPUT_CORRECTED');
  });
  await t.test('N beyond H keeps reference zero separate from unavailable experimental forecast', async () => {
    const f = await fixture('experiment-beyond-horizon');
    check(await f.client.sendExact('PATCH', `/api/goals/${f.goal.id}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, totalRequired: 1000 }), 200);
    const saved = check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(await report(f.client, f.goal))), 201).json as unknown as LearningArtifactSummary;
    const compare = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(saved)}`), 200).json as unknown as LearningComparison;
    assert.equal(compare.reference.status, 'available'); assert.equal(compare.reference.reachProbability, 0);
    assert.equal(compare.experiment.status, 'insufficient'); assert.equal(compare.experiment.reason, 'BEYOND_LEARNING_HORIZON');
    assert.equal(compare.experiment.reachProbability, null); assert.equal(compare.experiment.p50Days, null); assert.equal(compare.experiment.p80Days, null);
    assert.equal(compare.baseline.prediction.config.horizonDays, 1095);
  });
  await t.test('correction, context and expiry return explicit unusability instead of forecasting', async t => {
    for (const change of ['input', 'answers', 'settings', 'artifact-expiry', 'participation-expiry'] as const) await t.test(change, async () => {
      const f = await fixture(`experiment-unusable-${change}`), saved = check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 201).json as unknown as LearningArtifactSummary;
      if (change === 'input') check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/logs/${f.goal.today}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, status: 'DONE', amount: 8 }), 200);
      if (change === 'answers') check(await f.client.sendExact('PATCH', `/api/goals/${f.goal.id}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision,
        expectedAnswerRevision: f.state.answerRevision, questionPrior: { a: 'LOW', b: 'LOW' } }), 200);
      if (change === 'settings') check(await f.client.sendExact('PATCH', `/api/goals/${f.goal.id}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, totalRequired: 51 }), 200);
      if (change === 'artifact-expiry') await db.pool.query('update learning_artifact set created_at=$2,expires_at=$3 where id=$1', [saved.id, new Date(START.getTime() - DAY), START]);
      if (change === 'participation-expiry') now = new Date(START.getTime() + 90 * DAY);
      const compare = check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(saved)}`), 200).json as unknown as LearningComparison;
      assert.equal(compare.experiment.status, 'insufficient'); assert.ok(compare.experiment.reason);
      assert.equal(compare.experiment.p50Days, null); assert.equal(compare.experiment.p80Days, null); assert.equal(compare.experiment.reachProbability, null);
    });
  });
  await t.test('experiment reserve rejects supersession, withdrawal, correction and context races', async t => {
    for (const change of ['superseded', 'withdraw-rejoin', 'input', 'settings', 'answers', 'rollback', 'expire'] as const) await t.test(change, async () => {
      const f = await fixture(`experiment-race-${change}`), barrier = pauseReservedExperiment(db.pool);
      const pending = f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state));
      try {
        await barrier.wait();
        if (change === 'superseded') check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 201);
        if (change === 'withdraw-rejoin') {
          check(await f.client.sendExact('DELETE', `${path(f.goal)}/participation`, { expectedParticipationId: f.state.participation!.id }), 204);
          check(await f.client.sendExact('PUT', `${path(f.goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
        }
        if (change === 'input') check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/logs/${f.goal.today}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, status: 'DONE', amount: 8 }), 200);
        if (change === 'settings') check(await f.client.sendExact('PATCH', `/api/goals/${f.goal.id}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision, totalRequired: 51 }), 200);
        if (change === 'answers') check(await f.client.sendExact('PATCH', `/api/goals/${f.goal.id}`, { expectedGoalSettingsRevision: f.state.goalSettingsRevision,
          expectedAnswerRevision: f.state.answerRevision, questionPrior: { a: 'LOW', b: 'LOW' } }), 200);
        if (change === 'rollback') check(await f.client.sendExact('DELETE', `${path(f.goal)}/active`, { expectedParticipationId: f.state.participation!.id, expectedActiveRevision: 0 }), 204);
        if (change === 'expire') await db.pool.query('update learning_participation set joined_at=$2,expires_at=$3 where id=$1', [f.state.participation!.id, new Date(START.getTime() - DAY), START]);
        barrier.open(); check(await pending, 409);
        assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where goal_id=$1', [f.goal.id])).rows[0].n, change === 'superseded' ? 1 : 0);
        assert.equal((await db.pool.query('select count(*)::int n from learning_holdout_receipt where goal_id=$1', [f.goal.id])).rows[0].n, 0);
      } finally { barrier.restore(); await pending; }
    });
  });
  await t.test('insufficient math and work limit remain truthful and models stay bounded to five', async () => {
    const empty = await fixture('experiment-no-history', false);
    const insufficient = check(await empty.client.sendExact('POST', `${path(empty.goal)}/experiments`, fitBody(empty.state)), 201).json as unknown as LearningArtifactSummary;
    assert.equal(insufficient.gate.status, 'INSUFFICIENT'); assert.notEqual(insufficient.gate.reasons[0], 'EXPERIMENTAL_NOT_QUALIFIED');
    assert.equal((await db.pool.query('select payload from learning_artifact where id=$1', [insufficient.id])).rows[0].payload.numeric, null);
    const limited = await fixture('experiment-history-limit', false);
    const dates = Array.from({ length: 1096 }, (_, i) => new Date(START.getTime() - i * DAY).toISOString().slice(0, 10));
    await db.pool.query("insert into action_log(goal_id,local_date,status,amount) select $1,day::date,'SKIPPED',null from unnest($2::text[]) day", [limited.goal.id, dates]);
    const bounded = check(await limited.client.sendExact('POST', `${path(limited.goal)}/experiments`, fitBody(limited.state)), 201).json as unknown as LearningArtifactSummary;
    assert.deepEqual(bounded.gate.reasons, ['RECORD_WORK_LIMIT']);
    const fresh = await fixture('experiment-artifact-limit');
    for (let i = 0; i < 7; i++) check(await fresh.client.sendExact('POST', `${path(fresh.goal)}/experiments`, fitBody(await report(fresh.client, fresh.goal))), 201);
    assert.equal((await report(fresh.client, fresh.goal)).artifacts.length, 5);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where goal_id=$1', [fresh.goal.id])).rows[0].n, 5);
  });
  await t.test('withdraw/rejoin deletes experiment and purge preserves business logs and baseline evaluation', async () => {
    const state = await report(f.client, f.goal);
    check(await f.client.sendExact('DELETE', `${path(f.goal)}/participation`, { expectedParticipationId: state.participation!.id }), 204);
    check(await f.client.sendExact('GET', `${path(f.goal)}/compare?${query(artifact)}`), 404);
    assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [f.goal.id])).rows[0].n, 8);
    assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast where goal_id=$1', [f.goal.id])).rows[0].n, 1);
    check(await f.client.sendExact('PUT', `${path(f.goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
    check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(state)), 409);
    const current = await report(f.client, f.goal), newArtifact = check(await f.client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(current)), 201).json as unknown as LearningArtifactSummary;
    now = new Date(START.getTime() + 90 * DAY);
    await purgeExpiredLearning(db.pool, now);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where id=$1', [newArtifact.id])).rows[0].n, 0);
    assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [f.goal.id])).rows[0].n, 8);
  });
  await t.test('default OFF does not register experiment or compare routes or read learning tables', async () => {
    const off = await startStack(db, { now: () => START });
    try {
      const client = await signedInClient(off.app, 'experiment-default-off');
      await db.pool.query('alter table learning_participation rename to synthetic_hidden_learning_participation');
      try {
        assert.equal(check(await client.sendExact('GET', '/api/learning'), 200).json!.enabled, false);
        check(await client.sendExact('POST', `${path(f.goal)}/experiments`, fitBody(f.state)), 404);
        check(await client.sendExact('GET', `${path(f.goal)}/compare?${query(artifact)}`), 404);
      } finally { await db.pool.query('alter table synthetic_hidden_learning_participation rename to learning_participation'); }
    } finally { await off.close(); }
  });
});
