import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import type { Goal, GoalCreate } from '../src/contracts/goal.ts';
import type { MilestoneReport } from '../src/contracts/milestone.ts';
import { purgeExpiredMilestone } from '../src/milestone/store.ts';
import { Client, setup, signedInClient } from './helpers/stack.ts';

// 外部admin接続を使わない。このfileは新しいローカル合成clusterだけで実行する。
if (process.env.DATABASE_URL) throw new Error('Milestone tests require DATABASE_URL unset and a fresh synthetic local database');
const POLICY = 'session-milestone-opt-in-v1';
const options = { enabled: true, buildVersion: 'synthetic-milestone-integration' };
const input: GoalCreate = { title: 'synthetic milestone goal', unit: 'minutes', totalRequired: 300,
  initialProgress: 0, sessionAmount: 10, timezone: 'UTC' };
const instant = (day: number) => new Date(Date.UTC(2026, 9, 1 + day, 12));
const date = (day: number) => instant(day).toISOString().slice(0, 10);
const path = (goal: Goal) => `/api/goals/${goal.id}/milestone-calibration`;
type Wire = Awaited<ReturnType<Client['sendExact']>>;
function check(res: Wire, status: number) {
  assert.equal(res.status, status, res.body);
  assert.equal(res.headers['cache-control'], 'no-store');
  return res;
}
async function create(client: Client, body = input): Promise<Goal> {
  return check(await client.sendExact('POST', '/api/goals', body, { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
}
async function record(client: Client, goal: Goal, day: number, status: 'DONE' | 'SKIPPED', amount = 10) {
  check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${date(day)}`, {
    expectedGoalSettingsRevision: goal.goalSettingsRevision, status, ...(status === 'DONE' ? { amount } : {}),
  }), 200);
}
async function report(client: Client, goal: Goal): Promise<MilestoneReport> {
  return check(await client.sendExact('GET', path(goal)), 200).json as unknown as MilestoneReport;
}
const expected = (r: MilestoneReport) => ({ expectedGoalSettingsRevision: r.goalSettingsRevision,
  expectedAnswerRevision: r.answerRevision, expectedParticipationId: r.participationId! });
async function join(client: Client, goal: Goal) {
  check(await client.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: POLICY, expectedGoalSettingsRevision: goal.goalSettingsRevision }), 204);
  return report(client, goal);
}
async function capture(client: Client, goal: Goal, candidate?: NonNullable<MilestoneReport['artifact']>, status = 201) {
  const r = await report(client, goal);
  return check(await client.sendExact('POST', `${path(goal)}/forecasts`, { ...expected(r),
    ...(candidate ? { artifactId: candidate.id, artifactHash: candidate.hash } : {}) }), status).json!;
}
async function fit(client: Client, goal: Goal) {
  const r = await report(client, goal);
  return check(await client.sendExact('POST', `${path(goal)}/fits`, { ...expected(r), expectedFitGeneration: r.fitGeneration }), 200).json as unknown as NonNullable<MilestoneReport['artifact']>;
}
async function warm(client: Client, goal: Goal, setDay: (day: number) => void) {
  for (let d = 0; d <= 3; d++) { setDay(d); await record(client, goal, d, d % 2 ? 'DONE' : 'SKIPPED'); }
}
async function cycle(client: Client, goal: Goal, start: number, setDay: (day: number) => void) {
  for (let d = start + 1; d <= start + 3; d++) { setDay(d); await record(client, goal, d, d === start + 1 ? 'DONE' : 'SKIPPED'); }
}
async function train(client: Client, goal: Goal, setDay: (day: number) => void) {
  await warm(client, goal, setDay);
  await join(client, goal);
  for (const start of [3, 6, 9]) { await capture(client, goal); await cycle(client, goal, start, setDay); }
  return fit(client, goal);
}
function pauseNextCommit(pool: pg.Pool) {
  const original = pool.connect;
  let open!: () => void, reached = false, claimed = false;
  const gate = new Promise<void>(resolve => { open = resolve; });
  pool.connect = ((...args: unknown[]) => {
    if (args.some(arg => typeof arg === 'function')) return Reflect.apply(original, pool, args);
    return Promise.resolve(Reflect.apply(original, pool, args)).then((client: pg.PoolClient) => {
      const query = client.query, release = client.release;
      client.query = ((...q: unknown[]) => {
        if (!claimed && typeof q[0] === 'string' && q[0].trim().toLowerCase() === 'commit') {
          claimed = true; pool.connect = original;
          return Promise.resolve(Reflect.apply(query, client, q)).then(async value => { reached = true; await gate; return value; });
        }
        return Reflect.apply(query, client, q);
      }) as typeof client.query;
      client.release = (...releaseArgs) => { client.query = query; client.release = release; Reflect.apply(release, client, releaseArgs); };
      return client;
    });
  }) as typeof pool.connect;
  return { restore: () => { pool.connect = original; open(); }, wait: async () => {
    const until = Date.now() + 5000;
    while (!reached && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(reached, true, 'owned transaction did not reach its committed preparation');
  } };
}

test('#248 defaults OFF with no milestone tables; existing evaluation opt-in is separate', async t => {
  const { db, stack } = await setup(t, { now: () => instant(0), evaluation: { enabled: true, buildVersion: 'synthetic-existing-evaluation' } });
  await db.pool.query('drop table milestone_artifact, milestone_forecast, milestone_participation');
  const a = await signedInClient(stack.app, 'milestone-off'), goal = await create(a);
  assert.equal(check(await a.sendExact('GET', '/api/milestone-calibration'), 200).json!.enabled, false);
  check(await a.sendExact('PUT', `/api/goals/${goal.id}/evaluation/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
  check(await a.sendExact('GET', path(goal)), 404);
  check(await a.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: POLICY, expectedGoalSettingsRevision: 0 }), 404);
});
test('#248 authenticated synthetic HTTP produces nonzero correction and a frozen prospective comparison', async t => {
  let now = instant(0); const setDay = (d: number) => { now = instant(d); };
  const { db, stack } = await setup(t, { now: () => now, milestoneCalibration: options });
  const a = await signedInClient(stack.app, 'milestone-nonzero'), goal = await create(a);
  await warm(a, goal, setDay); await join(a, goal);
  for (const start of [3, 6, 9]) {
    const issued = await capture(a, goal);
    assert.equal(issued.q, 10);
    if (start < 9) assert.equal((await fit(a, goal)).fit.status, 'IDENTITY');
    await cycle(a, goal, start, setDay);
  }
  const baseline = check(await a.sendExact('GET', `/api/goals/${goal.id}/today?view=r11`), 200).json;
  const artifact = await fit(a, goal);
  assert.equal(artifact.fit.status, 'FIT'); assert.ok(artifact.fit.u > 0);
  assert.ok(artifact.fit.kktResidual! < 1e-12);
  assert.deepEqual(check(await a.sendExact('GET', `/api/goals/${goal.id}/today?view=r11`), 200).json, baseline);
  const preview = check(await a.sendExact('GET', `${path(goal)}/compare?artifactId=${artifact.id}&artifactHash=${artifact.hash}`), 200).json!;
  assert.equal((preview.comparison as Record<string, unknown>).appliedToStandard, false);
  assert.equal((await report(a, goal)).forecasts.length, 3); // GET does not capture.
  const issued = await capture(a, goal, artifact);
  assert.deepEqual(await capture(a, goal, undefined, 200), issued); // immutable same-day first issuance.
  await cycle(a, goal, 12, setDay);
  const r = await report(a, goal), fourth = r.forecasts.find(f => f.id === issued.id)!;
  assert.equal(fourth.state, 'EVENT'); assert.equal(fourth.comparison.artifactId, artifact.id);
  assert.ok(fourth.milestoneScore.candidate! < fourth.milestoneScore.baseline!);
  assert.equal(fourth.finalScore.extrapolation, true);
  assert.equal(fourth.finalScore.baseline, fourth.finalScore.candidate); // early nonarrival is structural zero for this long final target.
  assert.equal(r.artifact!.valid, true); // new records beyond fit cutoff do not contaminate the old fit.
  t.diagnostic(JSON.stringify({ fixture: 'anonymous-synthetic-248', trainingOrigins: [date(3), date(6), date(9)],
    u: artifact.fit.u, oddsMultiplier: Math.exp(artifact.fit.u), kktResidual: artifact.fit.kktResidual,
    prospectiveOrigin: fourth.origin, milestoneScore: fourth.milestoneScore, finalScore: fourth.finalScore,
    standardTodayUnchanged: true, finalImprovementValidated: false }));
  const stored = (await db.pool.query('select payload from milestone_forecast where id=$1', [issued.id])).rows[0]!.payload;
  assert.equal(stored.scope.goalId, goal.id);
  assert.equal(stored.comparison.evidenceScope, 'milestone');
  assert.equal(stored.milestone.computation.method, 'BETA_BINOMIAL');
});
test('#248 authentication, owner/Goal separation, strict input and single active episode', async t => {
  let now = instant(0); const setDay = (d: number) => { now = instant(d); };
  const { db, stack } = await setup(t, { now: () => now, milestoneCalibration: options, evaluation: { enabled: true, buildVersion: 'synthetic-evaluation' } });
  const a = await signedInClient(stack.app, 'milestone-owner'), b = await signedInClient(stack.app, 'milestone-other');
  const anon = new Client(stack.app, 'http://127.0.0.1:3000'), goal = await create(a), other = await create(a);
  check(await anon.sendExact('GET', path(goal)), 401);
  check(await b.sendExact('GET', path(goal)), 404);
  await warm(a, goal, setDay);
  check(await a.sendExact('PUT', `/api/goals/${goal.id}/evaluation/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
  assert.equal((await report(a, goal)).participating, false);
  check(await a.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: 'self-evaluation-v1', expectedGoalSettingsRevision: 0 }), 422);
  const r = await join(a, goal);
  check(await a.sendExact('PUT', `${path(other)}/participation`, { policyVersion: POLICY, expectedGoalSettingsRevision: 0 }), 409);
  check(await a.sendExact('POST', `${path(goal)}/forecasts`, { ...expected(r), cdf: Array(30).fill(.5), u: .1 }), 422);
  check(await a.sendExact('POST', `${path(goal)}/forecasts`, expected(r), { origin: 'https://untrusted.example.test' }), 403);
  check(await b.sendExact('POST', `${path(goal)}/forecasts`, expected(r)), 404);
  await capture(a, goal);
  setDay(4); await record(a, goal, 4, 'DONE');
  check(await a.sendExact('POST', `${path(goal)}/forecasts`, expected(await report(a, goal))), 409);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_forecast')).rows[0]!.n, 1);
  // FK binds participant, Goal and owner even below the route boundary.
  const p = (await db.pool.query('select user_id,id from milestone_participation where goal_id=$1', [goal.id])).rows[0]!;
  await assert.rejects(db.pool.query(`insert into milestone_forecast(id,goal_id,user_id,participation_id,origin_date,issued_at,expires_at,payload,payload_hash)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), other.id, p.user_id, p.id, date(3), instant(3), instant(50), { schemaVersion: 'session-milestone-forecast-v1' }, 'a'.repeat(64)]), (error: unknown) => (error as { code: string }).code === '23503');
});
test('#248 late corrections/settings invalidate; expiry, withdrawal and Goal deletion purge only derived state', async t => {
  let now = instant(0); const setDay = (d: number) => { now = instant(d); };
  const { db, stack } = await setup(t, { now: () => now, milestoneCalibration: options });
  const a = await signedInClient(stack.app, 'milestone-lifecycle'), goal = await create(a);
  const artifact = await train(a, goal, setDay);
  await db.pool.query("update action_log set status='SKIPPED',amount=null where goal_id=$1 and local_date=$2", [goal.id, date(4)]);
  let r = await report(a, goal);
  assert.equal(r.artifact!.valid, false); assert.equal(r.artifact!.fit.u, 0);
  assert.equal(r.artifact!.fit.reason, 'TRAINING_INPUT_CHANGED');
  check(await a.sendExact('GET', `${path(goal)}/compare?artifactId=${artifact.id}&artifactHash=${artifact.hash}`), 409);
  const changed = check(await a.sendExact('PATCH', `/api/goals/${goal.id}`, { expectedGoalSettingsRevision: 0, title: 'changed synthetic title' }), 200).json as unknown as Goal;
  r = await report(a, changed);
  assert.equal(r.artifact!.fit.reason, 'ARTIFACT_CONTEXT_CHANGED');
  assert.equal(r.forecasts[0]!.state, 'INVALID');
  const oldId = r.participationId!;
  check(await a.sendExact('DELETE', `${path(changed)}/participation`, { expectedParticipationId: oldId }), 204);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_forecast')).rows[0]!.n, 0);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_artifact')).rows[0]!.n, 0);
  assert.equal((await db.pool.query('select count(*)::int as n from action_log where goal_id=$1', [goal.id])).rows[0]!.n, 13);
  const newState = await join(a, changed);
  assert.notEqual(newState.participationId, oldId);
  check(await a.sendExact('DELETE', `${path(changed)}/participation`, { expectedParticipationId: oldId }), 409);
  await capture(a, changed);
  const expires = new Date(newState.participationExpiresAt!); now = expires;
  assert.equal((await report(a, changed)).participating, false);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_forecast')).rows[0]!.n, 1); // filtered is not physically purged.
  await purgeExpiredMilestone(db.pool, now);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_forecast')).rows[0]!.n, 0);
  const next = await join(a, changed);
  assert.notEqual(next.participationId, newState.participationId);
  await db.pool.query('delete from goal where id=$1', [goal.id]); // only this owned synthetic Goal.
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_participation')).rows[0]!.n, 0);
});
test('#248 preparation races reject changed logs and withdrawn/rejoined fit generation', async t => {
  let now = instant(0); const setDay = (d: number) => { now = instant(d); };
  const { db, stack } = await setup(t, { now: () => now, milestoneCalibration: options });
  const a = await signedInClient(stack.app, 'milestone-race'), goal = await create(a);
  await warm(a, goal, setDay); let r = await join(a, goal);
  const captureGate = pauseNextCommit(db.pool); t.after(captureGate.restore);
  const pending = a.sendExact('POST', `${path(goal)}/forecasts`, expected(r));
  await captureGate.wait(); await record(a, goal, 3, 'DONE', 11); captureGate.restore();
  check(await pending, 409);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_forecast')).rows[0]!.n, 0);
  await capture(a, goal);
  r = await report(a, goal);
  const fitGate = pauseNextCommit(db.pool); t.after(fitGate.restore);
  const fitting = a.sendExact('POST', `${path(goal)}/fits`, { ...expected(r), expectedFitGeneration: r.fitGeneration });
  await fitGate.wait();
  check(await a.sendExact('DELETE', `${path(goal)}/participation`, { expectedParticipationId: r.participationId! }), 204);
  const restarted = await join(a, goal); assert.notEqual(restarted.participationId, r.participationId);
  fitGate.restore(); check(await fitting, 409);
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_artifact')).rows[0]!.n, 0);
});
test('#248 compare reports expected domain states rather than internal errors', async t => {
  let now = instant(0); const setDay = (d: number) => { now = instant(d); };
  const { db, stack } = await setup(t, { now: () => now, milestoneCalibration: options });
  const a = await signedInClient(stack.app, 'milestone-compare-state'), goal = await create(a);
  const artifact = await train(a, goal, setDay);
  const url = `${path(goal)}/compare?artifactId=${artifact.id}&artifactHash=${artifact.hash}`;
  setDay(13);
  check(await a.sendExact('GET', url), 409); // current day unrecorded.
  await record(a, goal, 13, 'DONE', 250); // current Goal completes; source history through training cutoff is unchanged.
  check(await a.sendExact('GET', url), 409);
  const today = check(await a.sendExact('GET', `/api/goals/${goal.id}/today?view=r11`), 200).json!;
  assert.equal((today.prediction as { completion: { status: string } }).completion.status, 'completed');
  assert.equal((await db.pool.query('select count(*)::int as n from milestone_forecast')).rows[0]!.n, 3);
});
