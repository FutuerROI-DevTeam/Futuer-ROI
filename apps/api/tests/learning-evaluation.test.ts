import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { fitDurationModel, forecastDurationModel, type DurationArtifact } from '@futureroi/prediction';
import { buildApp } from '../src/app.ts';
import { createAuth } from '../src/auth/options.ts';
import type { Goal, GoalCreate } from '../src/contracts/goal.ts';
import type { LearningReport, TodayLearning } from '../src/contracts/learning.ts';
import { replayLearnedEvaluation, type SavedEvaluation } from '../src/evaluation/assessment.ts';
import { evaluationReport } from '../src/evaluation/store.ts';
import { evaluationPolicy } from '../src/evaluation/policy.ts';
import { purgeExpiredLearning } from '../src/learning/store.ts';
import { emptyLearningGate } from '../src/learning/gates.ts';
import { DURATION_GAMMA_PRIOR, learningInputHash } from '../src/learning/service.ts';
import { loadTodaySnapshot } from '../src/prediction/store.ts';
import { Client, setup, signedInClient, startStack } from './helpers/stack.ts';

const START = new Date('2026-10-11T12:00:00Z');
const input: GoalCreate = { title: 'synthetic evaluation selector', unit: 'minutes', totalRequired: 40,
  initialProgress: 0, sessionAmount: 10, timezone: 'UTC' };
const lp = (goal: Goal) => `/api/goals/${goal.id}/learning`;
const ep = (goal: Goal) => `/api/goals/${goal.id}/evaluation`;
const check = (response: Awaited<ReturnType<Client['sendExact']>>, status: number) => {
  assert.equal(response.status, status, response.body); assert.equal(response.headers['cache-control'], 'no-store'); return response;
};
const create = async (client: Client) => check(await client.sendExact('POST', '/api/goals', input, { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
const report = async (client: Client, goal: Goal) => check(await client.sendExact('GET', lp(goal)), 200).json as unknown as LearningReport;

function pauseSelectionSnapshot(pool: pg.Pool) {
  const connect = pool.connect; let open!: () => void, reached = false, claimed = false;
  const gate = new Promise<void>(resolve => { open = resolve; });
  pool.connect = ((...args: unknown[]) => {
    if (args.some(arg => typeof arg === 'function')) return Reflect.apply(connect, pool, args);
    return Promise.resolve(Reflect.apply(connect, pool, args)).then((client: pg.PoolClient) => {
      const query = client.query, release = client.release; let readOnly = false;
      client.query = ((...queryArgs: unknown[]) => {
        const sql = typeof queryArgs[0] === 'string' ? queryArgs[0].trim().toLowerCase() : '';
        if (sql.startsWith('begin') && sql.includes('read only')) readOnly = true;
        if (!claimed && readOnly && sql === 'commit') {
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
    assert.ok(reached, 'capture did not finish its shared selection snapshot');
  } };
}

// One actual owned synthetic DB. The ADOPTABLE gate below is deliberately injected
// to test storage/selection/CAS, NOT evidence that a real fit improved the model.
test('#227 learned evaluation same-selector/frozen replay/CAS boundaries (injected artifact)', async t => {
  const safeDatabase = process.env.DATABASE_URL === undefined || (process.env.GITHUB_ACTIONS === 'true' &&
    process.env.DATABASE_URL === 'postgres://futureroi:ci-only-placeholder@127.0.0.1:5432/futureroi');
  assert.ok(safeDatabase, 'Only absent local URI or the known isolated CI fixture is allowed');
  let now = START;
  let fixtureAuth!: ReturnType<typeof createAuth>;
  const { db, stack } = await setup(t, { now: () => now, evaluation: { enabled: true, buildVersion: 'synthetic-learning-evaluation' } }, {
    startStack: (db, options) => startStack(db, options, {
      createAuth: options => { fixtureAuth = createAuth(options); return fixtureAuth; },
      buildApp: options => buildApp({ ...options, learning: { enabled: true, maxArtifacts: 1 } }),
    }),
  });
  // Reuse this owned fixture's auth instance so the same synthetic owner can
  // exercise a changed runtime retention policy through authenticated HTTP.
  async function policyStack(retentionDays: number, observationDays = 30) {
    return startStack(db, { now: () => now, evaluation: { enabled: true, buildVersion: 'synthetic-learning-evaluation' } }, {
      createAuth: () => fixtureAuth,
      buildApp: options => buildApp({ ...options, learning: { enabled: true, maxArtifacts: 1, retentionDays, observationDays } }),
    });
  }
  function sameOwner(app: typeof stack.app, original: Client) {
    const client = new Client(app, 'http://127.0.0.1:3000');
    for (const [name, value] of original.cookies) client.cookies.set(name, value);
    return client;
  }
  async function fixture(tag: string, activate = true, joinLearning = true, numericOverride?: DurationArtifact) {
    now = START;
    const client = await signedInClient(stack.app, tag), goal = await create(client);
    check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, { expectedGoalSettingsRevision: 0, status: 'DONE', amount: 7 }), 200);
    check(await client.sendExact('PUT', `${ep(goal)}/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
    if (!joinLearning) return { client, goal, artifactId: '', artifactHash: '', participationId: '' };
    check(await client.sendExact('PUT', `${lp(goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
    const state = await report(client, goal), owner = (await db.pool.query('select user_id from goal where id=$1', [goal.id])).rows[0].user_id;
    const snapshot = (await loadTodaySnapshot(db.pool, owner, goal.id, () => now))!;
    const numeric: DurationArtifact = numericOverride ?? { kind: 'BETA_BASELINE_V1', modelVersion: 'duration-model-v1', capDays: 14,
      posterior: { a: { alpha: 9, beta: 1 }, b: { alpha: 9, beta: 1 } }, training: { doneOrigins: 80, skipOrigins: 80, excludedUnknownDuration: 0 } };
    const artifactId = randomUUID();
    const payload = { modelVersion: 'duration-model-v1', trainingCutoff: goal.today, goalSettingsRevision: 0, answerRevision: 0,
      inputHash: learningInputHash(snapshot, goal.today), evidenceHash: learningInputHash(snapshot, goal.today), numeric,
      gate: { ...emptyLearningGate('injected-storage-fixture'), status: 'ADOPTABLE', reasons: [] },
      comparison: { protocolVersion: 'duration-chronological-v2', horizonDays: 30, trainingCutoff: goal.today,
        validationAnchors: [], testAnchors: [], holdoutThrough: goal.today, reason: null } };
    const artifactHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await db.pool.query(`insert into learning_artifact(id,participation_id,user_id,goal_id,created_at,expires_at,artifact_hash,payload,fit_generation)
      values($1,$2,$3,$4,$5,$6,$7,$8,1)`, [artifactId, state.participation!.id, owner, goal.id, now, new Date(state.participation!.expiresAt), artifactHash, payload]);
    await db.pool.query('update learning_participation set fit_generation=1 where id=$1', [state.participation!.id]);
    if (activate) check(await client.sendExact('PUT', `${lp(goal)}/active`, { artifactId, artifactHash,
      expectedParticipationId: state.participation!.id, expectedActiveRevision: 0 }), 204);
    return { client, goal, artifactId, artifactHash, participationId: state.participation!.id };
  }
  await t.test('learned capture equals primary selector; replay survives inactive eviction; withdrawal preserves baseline', async () => {
    const { client, goal, artifactId, artifactHash, participationId } = await fixture('learning-evaluation-replay');
    const selected = check(await client.sendExact('GET', `${lp(goal)}/today`), 200).json as unknown as TodayLearning;
    assert.equal(selected.selectedForecast.source, 'LEARNED');
    const issued = check(await client.sendExact('POST', `${ep(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    assert.equal(issued.p50Days, selected.selectedForecast.p50Days); assert.equal(issued.p80Days, selected.selectedForecast.p80Days);
    const saved = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    assert.equal(saved.learningArtifactId, artifactId); assert.equal(saved.learningArtifactHash, artifactHash); assert.equal(saved.learningActiveRevision, 1);
    assert.equal(saved.featureVersion, 'duration-records-v1'); assert.equal(saved.learningReplay!.baselineMetadataVersion, 'r11-reference-only-v1');
    assert.equal(saved.remainingAmount, 33); assert.equal(saved.learningReplay!.input.remainingAmount, 33);
    const replay = replayLearnedEvaluation(saved); assert.equal(replay.status, 'available');
    if (replay.status !== 'available') throw new Error('Injected exact-Beta fixture must replay');
    assert.equal(replay.p50Days, issued.p50Days); assert.equal(replay.p80Days, issued.p80Days);
    check(await client.sendExact('DELETE', `${lp(goal)}/active`, { expectedParticipationId: participationId, expectedActiveRevision: 1 }), 204);
    const state = await report(client, goal);
    check(await client.sendExact('POST', `${lp(goal)}/fits`, { expectedGoalSettingsRevision: 0, expectedAnswerRevision: 0,
      expectedParticipationId: participationId, expectedActiveRevision: state.activeRevision }), 201);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where id=$1', [artifactId])).rows[0].n, 0);
    const persisted = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    assert.deepEqual(replayLearnedEvaluation(persisted), replay);
    now = new Date(START.getTime() + 86_400_000);
    check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/2026-10-12`, { expectedGoalSettingsRevision: 0, status: 'SKIPPED' }), 200);
    const baseline = check(await client.sendExact('POST', `${ep(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    const baselineSaved = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [baseline.id])).rows[0]!.payload;
    assert.equal(baselineSaved.learningArtifactId, undefined);
    check(await client.sendExact('DELETE', `${lp(goal)}/participation`, { expectedParticipationId: participationId }), 204);
    assert.deepEqual((await db.pool.query('select id from evaluation_forecast where goal_id=$1', [goal.id])).rows.map(row => row.id), [baseline.id]);
    assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [goal.id])).rows[0].n, 2);
  });
  await t.test('real kernel DURATION_JOINT numeric persists and replays after eviction (manually qualified synthetic gate)', async () => {
    // Numeric values come from the real kernel and server Cgamma17/cap14 setup.
    // The ADOPTABLE gate is manually injected for storage/HTTP integration only;
    // this tiny synthetic training set does not prove held-out improvement.
    const fit = fitDurationModel([
      { from: 'DONE', to: 'DONE', restDays: null, originDate: '2026-10-01', outcomeDate: '2026-10-02' },
      { from: 'DONE', to: 'SKIPPED', restDays: null, originDate: '2026-10-02', outcomeDate: '2026-10-03' },
      { from: 'SKIPPED', to: 'DONE', restDays: 2, originDate: '2026-10-04', outcomeDate: '2026-10-05' },
    ], { a: { alpha: 9, beta: 1 }, b: { alpha: 9, beta: 1 } },
    { capDays: 14, gammaPrior: DURATION_GAMMA_PRIOR, tolerance: 1e-7 });
    assert.equal(fit.status, 'available');
    if (fit.status !== 'available' || fit.artifact.kind !== 'DURATION_JOINT_V1') throw new Error('Synthetic kernel must provide a joint artifact');
    assert.equal(fit.artifact.gammaPrior.length, 17);
    assert.deepEqual(fit.artifact.integration.checks!.map(check => check.order), [16, 32]);
    assert.equal(fit.artifact.integration.tolerance, 1e-7);
    const f = await fixture('learning-evaluation-real-joint-manual-gate', true, true, fit.artifact);
    const forecast = forecastDurationModel(fit.artifact, { initialState: 'DONE', initialRestDays: 0,
      remainingAmount: 33, sessionAmount: 10, horizonDays: 30, samples: 8192, seed: 20261011 });
    assert.equal(forecast.status, 'available');
    if (forecast.status !== 'available') throw new Error('Synthetic small-N quadrature must be available');
    assert.equal(forecast.computation.method, 'POSTERIOR_QUADRATURE');
    const selected = check(await f.client.sendExact('GET', `${lp(f.goal)}/today`), 200).json as unknown as TodayLearning;
    assert.equal(selected.selectedForecast.source, 'LEARNED');
    assert.equal(selected.selectedForecast.p50Days, forecast.p50Days); assert.equal(selected.selectedForecast.p80Days, forecast.p80Days);
    assert.equal(selected.selectedForecast.reachProbability, forecast.cdf[30]);
    const issued = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    assert.equal(issued.p50Days, selected.selectedForecast.p50Days); assert.equal(issued.p80Days, selected.selectedForecast.p80Days);
    const saved = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    assert.deepEqual(saved.learningReplay!.numeric, fit.artifact, 'JSONB must preserve joint nodes, tolerance, and both diagnostic rules');
    assert.deepEqual(replayLearnedEvaluation(saved), forecast);
    check(await f.client.sendExact('DELETE', `${lp(f.goal)}/active`, { expectedParticipationId: f.participationId, expectedActiveRevision: 1 }), 204);
    check(await f.client.sendExact('POST', `${lp(f.goal)}/fits`, { expectedGoalSettingsRevision: 0, expectedAnswerRevision: 0,
      expectedParticipationId: f.participationId, expectedActiveRevision: 2 }), 201);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where id=$1', [f.artifactId])).rows[0].n, 0);
    const persisted = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    assert.deepEqual(replayLearnedEvaluation(persisted), forecast);
    assert.equal((check(await f.client.sendExact('GET', ep(f.goal)), 200).json!.forecasts as { id: string }[])[0]!.id, issued.id);
  });
  await t.test('explicit displayed BASELINE saves R11 with qualified active; omitted legacy capture and immutable replay stay unchanged', async () => {
    // Existing qualified-active storage fixture only: no claim that the manually
    // qualified gate demonstrates real held-out improvement or calibration.
    const baselineFixture = await fixture('learning-evaluation-displayed-baseline');
    const primary = check(await baselineFixture.client.sendExact('GET', `${lp(baselineFixture.goal)}/today`), 200).json as unknown as TodayLearning;
    assert.equal(primary.selectedForecast.source, 'LEARNED', 'fixture must expose the old capture/standard-display mismatch');
    for (const displayedForecast of ['EXPERIMENTAL', 'LEARNED', false])
      check(await baselineFixture.client.sendExact('POST', `${ep(baselineFixture.goal)}/forecasts`,
        { expectedGoalSettingsRevision: 0, displayedForecast }), 422);
    const issued = check(await baselineFixture.client.sendExact('POST', `${ep(baselineFixture.goal)}/forecasts`,
      { expectedGoalSettingsRevision: 0, displayedForecast: 'BASELINE' }), 201).json!;
    const completion = primary.baseline.prediction.completion;
    assert.equal(issued.predictionStatus, completion.status);
    assert.equal(issued.p50Days, completion.status === 'available' ? completion.p50Days : null);
    assert.equal(issued.p80Days, completion.status === 'available' ? completion.p80Days : null);
    const saved = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    assert.equal(saved.learningArtifactId, undefined); assert.equal(saved.learningReplay, undefined);
    assert.equal(saved.featureVersion, 'adjacent-record-counts-v1'); assert.equal(saved.modelVersion, primary.baseline.prediction.modelVersion);
    const replayed = check(await baselineFixture.client.sendExact('POST', `${ep(baselineFixture.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 200).json!;
    assert.equal(replayed.id, issued.id);
    assert.deepEqual((await db.pool.query('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0].payload, saved);

    const legacyFixture = await fixture('learning-evaluation-legacy-qualified-capture');
    const learned = check(await legacyFixture.client.sendExact('POST', `${ep(legacyFixture.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    const learnedPayload = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [learned.id])).rows[0]!.payload;
    assert.equal(learnedPayload.learningArtifactId, legacyFixture.artifactId);
    check(await legacyFixture.client.sendExact('DELETE', `${lp(legacyFixture.goal)}/active`, {
      expectedParticipationId: legacyFixture.participationId, expectedActiveRevision: 1 }), 204);
    const existing = check(await legacyFixture.client.sendExact('POST', `${ep(legacyFixture.goal)}/forecasts`,
      { expectedGoalSettingsRevision: 0, displayedForecast: 'BASELINE' }), 200).json!;
    assert.equal(existing.id, learned.id); assert.equal(existing.p50Days, learned.p50Days); assert.equal(existing.p80Days, learned.p80Days);
    assert.deepEqual((await db.pool.query('select payload from evaluation_forecast where id=$1', [learned.id])).rows[0].payload, learnedPayload);
    const frozen = replayLearnedEvaluation(learnedPayload); assert.equal(frozen.status, 'available');
    if (frozen.status !== 'available') throw new Error('Legacy qualified fixture must remain replayable');
    assert.equal(frozen.p50Days, learned.p50Days); assert.equal(frozen.p80Days, learned.p80Days);
  });
  await t.test('capture rejects learning changes after RR selection, including baseline selection', async t => {
    for (const change of ['rollback', 'withdraw-rejoin', 'expire', 'hash', 'baseline-activate', 'baseline-join'] as const) await t.test(change, async () => {
      const f = await fixture(`learning-evaluation-race-${change}`, change !== 'baseline-activate', change !== 'baseline-join');
      const barrier = pauseSelectionSnapshot(db.pool);
      const pending = f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 });
      try {
        await barrier.wait();
        if (change === 'rollback') check(await f.client.sendExact('DELETE', `${lp(f.goal)}/active`, { expectedParticipationId: f.participationId, expectedActiveRevision: 1 }), 204);
        if (change === 'withdraw-rejoin') {
          check(await f.client.sendExact('DELETE', `${lp(f.goal)}/participation`, { expectedParticipationId: f.participationId }), 204);
          check(await f.client.sendExact('PUT', `${lp(f.goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
        }
        if (change === 'expire') await db.pool.query('update learning_participation set joined_at=$2,expires_at=$3 where id=$1',
          [f.participationId, new Date(START.getTime() - 86_400_000), START]);
        // Isolated DB tamper fixture proves exact hash checking; no public update route exists.
        if (change === 'hash') await db.pool.query('update learning_artifact set artifact_hash=$2 where id=$1', [f.artifactId, 'b'.repeat(64)]);
        if (change === 'baseline-activate') check(await f.client.sendExact('PUT', `${lp(f.goal)}/active`, { artifactId: f.artifactId,
          artifactHash: f.artifactHash, expectedParticipationId: f.participationId, expectedActiveRevision: 0 }), 204);
        if (change === 'baseline-join') check(await f.client.sendExact('PUT', `${lp(f.goal)}/participation`, { policyVersion: 'self-learning-v1' }), 204);
        barrier.open(); const response = check(await pending, 409);
        assert.equal((response.json!.error as { code: string }).code, 'EVALUATION_LEARNING_CHANGED');
        assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast where goal_id=$1', [f.goal.id])).rows[0].n, 0);
      } finally { barrier.restore(); await pending; }
    });
  });
  await t.test('learning ON baseline capture equals actual primary long-tail H1095 fallback', async () => {
    now = START;
    const client = await signedInClient(stack.app, 'learning-evaluation-long-tail');
    const goal = check(await client.sendExact('POST', '/api/goals', { ...input, totalRequired: 1000 },
      { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
    // Isolated synthetic historical records; no imported personal dataset or altered production log.
    for (const [date, status] of [['2026-10-08', 'DONE'], ['2026-10-09', 'SKIPPED'], ['2026-10-10', 'DONE'], ['2026-10-11', 'SKIPPED']] as const)
      await db.pool.query('insert into action_log(goal_id,local_date,status,amount) values($1,$2,$3,$4)', [goal.id, date, status, status === 'DONE' ? 10 : null]);
    check(await client.sendExact('PUT', `${ep(goal)}/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
    const selected = check(await client.sendExact('GET', `${lp(goal)}/today`), 200).json as unknown as TodayLearning;
    assert.equal(selected.selectedForecast.source, 'BASELINE'); assert.equal(selected.selectedForecast.status, 'available');
    assert.ok(selected.selectedForecast.p80Days! > 30, 'fixture must expose the long-tail fallback difference');
    assert.equal(selected.selectedForecast.horizonDays, selected.baseline.prediction.config.horizonDays);
    const issued = check(await client.sendExact('POST', `${ep(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    assert.equal(issued.predictionStatus, selected.selectedForecast.status);
    assert.equal(issued.p50Days, selected.selectedForecast.p50Days); assert.equal(issued.p80Days, selected.selectedForecast.p80Days);
    const payload = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    assert.equal(payload.learningArtifactId, undefined); assert.equal(payload.featureVersion, 'adjacent-record-counts-v1');
  });
  await t.test('learned numeric copy expires at the earliest learning/artifact deadline', async t => {
    for (const boundary of ['participation', 'artifact', 'created-retention'] as const) await t.test(boundary, async () => {
      const f = await fixture(`learning-evaluation-expiry-${boundary}`);
      const deadline = new Date(START.getTime() + 86_400_000);
      if (boundary === 'participation') await db.pool.query('update learning_participation set expires_at=$2 where id=$1', [f.participationId, deadline]);
      else if (boundary === 'artifact') await db.pool.query('update learning_artifact set expires_at=$2 where id=$1', [f.artifactId, deadline]);
      else await db.pool.query('update learning_artifact set created_at=$2 where id=$1', [f.artifactId, new Date(START.getTime() - 89 * 86_400_000)]);
      const issued = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
      assert.equal(issued.expiresAt, deadline.toISOString());
      const before = check(await f.client.sendExact('GET', ep(f.goal)), 200).json!;
      assert.equal((before.forecasts as unknown[]).length, 1);
      now = deadline;
      const expired = check(await f.client.sendExact('GET', ep(f.goal)), 200).json!;
      assert.deepEqual(expired.forecasts, []);
    });
  });
  await t.test('retention shrink and OFF hide learned copies; purge deletes evicted-artifact copies only', async () => {
    const f = await fixture('learning-evaluation-retention-shrink');
    await db.pool.query('update learning_artifact set created_at=$2 where id=$1', [f.artifactId, new Date(START.getTime() - 2 * 86_400_000)]);
    const learned = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    check(await f.client.sendExact('DELETE', `${lp(f.goal)}/active`, { expectedParticipationId: f.participationId, expectedActiveRevision: 1 }), 204);
    now = new Date(START.getTime() + 86_400_000);
    check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/logs/2026-10-12`, { expectedGoalSettingsRevision: 0, status: 'SKIPPED' }), 200);
    const baseline = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    now = new Date(START.getTime() + 2 * 86_400_000);
    const owner = (await db.pool.query('select user_id from goal where id=$1', [f.goal.id])).rows[0].user_id;
    const policy = evaluationPolicy({ enabled: true, buildVersion: 'synthetic-learning-evaluation' });
    const shrink = await evaluationReport(db.pool, owner, f.goal.id, () => now, policy, { enabled: true, retentionDays: 3, observationDays: 1 });
    assert.deepEqual(shrink!.forecasts.map(row => row.id), [baseline.id]);
    const longer = await evaluationReport(db.pool, owner, f.goal.id, () => now, policy, { enabled: true });
    assert.equal(longer!.forecasts.length, 2);
    await db.pool.query('alter table learning_participation rename to synthetic_hidden_learning_participation');
    try {
      const off = await evaluationReport(db.pool, owner, f.goal.id, () => now, policy, { enabled: false });
      assert.deepEqual(off!.forecasts.map(row => row.id), [baseline.id]);
    } finally { await db.pool.query('alter table synthetic_hidden_learning_participation rename to learning_participation'); }
    check(await f.client.sendExact('POST', `${lp(f.goal)}/fits`, { expectedGoalSettingsRevision: 0, expectedAnswerRevision: 0,
      expectedParticipationId: f.participationId, expectedActiveRevision: 2 }), 201);
    assert.equal((await db.pool.query('select count(*)::int n from learning_artifact where id=$1', [f.artifactId])).rows[0].n, 0);
    assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast where id=$1', [learned.id])).rows[0].n, 1);
    await purgeExpiredLearning(db.pool, now, 3);
    assert.deepEqual((await db.pool.query('select id from evaluation_forecast where goal_id=$1', [f.goal.id])).rows.map(row => row.id), [baseline.id]);
    assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [f.goal.id])).rows[0].n, 2);
  });
  await t.test('retention 90 to 60 with unchanged H30 clamps old participation plus new artifact to one day', async () => {
    const f = await fixture('learning-evaluation-joined-retention60');
    const joinedAt = new Date(START.getTime() - 59 * 86_400_000), deadline = new Date(START.getTime() + 86_400_000);
    const oldExpiry = new Date(START.getTime() + 31 * 86_400_000);
    await db.pool.query('update learning_participation set joined_at=$2,expires_at=$3 where id=$1', [f.participationId, joinedAt, oldExpiry]);
    await db.pool.query('update learning_artifact set created_at=$2,expires_at=$3 where id=$1',
      [f.artifactId, new Date(START.getTime() - 86_400_000), oldExpiry]);
    const shorter = await policyStack(60);
    try {
      const client = sameOwner(shorter.app, f.client);
      const selected = check(await client.sendExact('GET', `${lp(f.goal)}/today`), 200).json as unknown as TodayLearning;
      assert.equal(selected.selectedForecast.source, 'LEARNED');
      const issued = check(await client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
      assert.equal(issued.expiresAt, deadline.toISOString());
      const saved = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
      assert.equal(saved.learningRetentionAnchor, joinedAt.toISOString());
      assert.equal((check(await client.sendExact('GET', ep(f.goal)), 200).json!.forecasts as unknown[]).length, 1);
      now = deadline;
      assert.deepEqual(check(await client.sendExact('GET', ep(f.goal)), 200).json!.forecasts, []);
      assert.equal((await report(client, f.goal)).participation, null);
    } finally { await shorter.close(); }
  });
  await t.test('retention 90 to 3 hides old participation new artifact copy via HTTP and purge preserves baseline/logs', async () => {
    const f = await fixture('learning-evaluation-joined-retention3');
    const joinedAt = new Date(START.getTime() - 60 * 86_400_000);
    await db.pool.query('update learning_participation set joined_at=$2,expires_at=$3 where id=$1',
      [f.participationId, joinedAt, new Date(START.getTime() + 30 * 86_400_000)]);
    await db.pool.query('update learning_artifact set created_at=$2 where id=$1', [f.artifactId, new Date(START.getTime() - 2 * 86_400_000)]);
    const learned = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    check(await f.client.sendExact('DELETE', `${lp(f.goal)}/active`, { expectedParticipationId: f.participationId, expectedActiveRevision: 1 }), 204);
    now = new Date(START.getTime() + 86_400_000);
    check(await f.client.sendExact('PUT', `/api/goals/${f.goal.id}/logs/2026-10-12`, { expectedGoalSettingsRevision: 0, status: 'SKIPPED' }), 200);
    const baseline = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    const shorter = await policyStack(3, 1);
    try {
      const client = sameOwner(shorter.app, f.client);
      assert.deepEqual((check(await client.sendExact('GET', ep(f.goal)), 200).json!.forecasts as { id: string }[]).map(row => row.id), [baseline.id]);
      assert.equal((await report(client, f.goal)).participation, null);
      assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast where id=$1', [learned.id])).rows[0].n, 1);
      await purgeExpiredLearning(db.pool, now, 3);
      assert.deepEqual((await db.pool.query('select id from evaluation_forecast where goal_id=$1', [f.goal.id])).rows.map(row => row.id), [baseline.id]);
      assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [f.goal.id])).rows[0].n, 2);
      assert.equal((await db.pool.query('select count(*)::int n from learning_participation where id=$1', [f.participationId])).rows[0].n, 0);
    } finally { await shorter.close(); }
  });
  await t.test('old learned rows missing retention anchor are conservatively hidden', async () => {
    const f = await fixture('learning-evaluation-missing-anchor');
    const issued = check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    await db.pool.query("update evaluation_forecast set payload=payload-'learningRetentionAnchor' where id=$1", [issued.id]);
    const state = check(await f.client.sendExact('GET', ep(f.goal)), 200).json!;
    assert.deepEqual(state.forecasts, []);
    check(await f.client.sendExact('POST', `${ep(f.goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 409);
  });
  await t.test('evaluation stays legacy-compatible when learning OFF and learning table absent', async () => {
  const off = await startStack(db, { now: () => START, evaluation: { enabled: true, buildVersion: 'legacy-evaluation-only' } });
  try {
  const client = await signedInClient(off.app, 'legacy-evaluation-learning-off'), goal = await create(client);
  check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, { expectedGoalSettingsRevision: 0, status: 'DONE', amount: 7 }), 200);
  check(await client.sendExact('PUT', `${ep(goal)}/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
  await db.pool.query('alter table learning_participation rename to synthetic_hidden_learning_participation');
  try {
    const saved = check(await client.sendExact('POST', `${ep(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 201).json!;
    const payload = (await db.pool.query<{ payload: SavedEvaluation }>('select payload from evaluation_forecast where id=$1', [saved.id])).rows[0]!.payload;
    assert.equal(payload.learningArtifactId, undefined); assert.equal(payload.learningReplay, undefined);
    assert.equal(payload.featureVersion, 'adjacent-record-counts-v1');
  } finally { await db.pool.query('alter table synthetic_hidden_learning_participation rename to learning_participation'); }
  } finally { await off.close(); }
  });
});
