import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import type { Goal, GoalCreate } from '../src/contracts/goal.ts';
import type { TodayR11 } from '../src/contracts/r11.ts';
import type { EvaluationForecast, EvaluationReport } from '../src/contracts/evaluation.ts';
import { purgeExpiredEvaluation } from '../src/evaluation/store.ts';
import { Client, setup, signedInClient } from './helpers/stack.ts';

// #225: real app/auth/migrations and an owned synthetic PostgreSQL database.
// Use sendExact throughout: no implicit revision, amount, or extra GET defaults.
const POLICY = 'self-evaluation-v1';
const START = new Date('2026-10-01T12:00:00Z');
const options = { enabled: true, buildVersion: 'synthetic-evaluation-integration' };
const input: GoalCreate = { title: 'synthetic private title', unit: 'minutes', totalRequired: 100,
  initialProgress: 0, sessionAmount: 10, timezone: 'UTC' };
const path = (goal: Goal) => `/api/goals/${goal.id}/evaluation`;
type Wire = Awaited<ReturnType<Client['sendExact']>>;
type Forecast = EvaluationForecast;
type Report = EvaluationReport;
const instant = (offset: number, hour = 12) => new Date(Date.UTC(2026, 9, 1 + offset, hour));
const date = (offset: number) => instant(offset).toISOString().slice(0, 10);
function check(response: Wire, status: number) {
  assert.equal(response.status, status, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  return response;
}
async function create(client: Client, body: GoalCreate = input): Promise<Goal> {
  return check(await client.sendExact('POST', '/api/goals', body, { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
}
async function get(client: Client, goal: Goal): Promise<Goal> {
  return check(await client.sendExact('GET', `/api/goals/${goal.id}`), 200).json as unknown as Goal;
}
async function record(client: Client, goal: Goal, date: string, status: 'DONE' | 'SKIPPED', amount = 10) {
  check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${date}`, {
    expectedGoalSettingsRevision: goal.goalSettingsRevision, status, ...(status === 'DONE' ? { amount } : {}),
  }), 200);
}
async function participate(client: Client, goal: Goal) {
  check(await client.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: POLICY }), 204);
}
async function capture(client: Client, goal: Goal, status = 201): Promise<Forecast> {
  return check(await client.sendExact('POST', `${path(goal)}/forecasts`, {
    expectedGoalSettingsRevision: goal.goalSettingsRevision,
  }), status).json as unknown as Forecast;
}
async function report(client: Client, goal: Goal): Promise<Report> {
  return check(await client.sendExact('GET', path(goal)), 200).json as unknown as Report;
}

// Pause after the real read-only snapshot commits, before its caller can compute
// and persist. This changes timing only; every statement still runs on the owned
// PostgreSQL fixture. Concurrent normal HTTP writes use undecorated checkouts.
function pauseSnapshot(pool: pg.Pool) {
  const connect = pool.connect;
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  let reached = false;
  let claimed = false;
  pool.connect = ((...args: unknown[]) => {
    if (args.some(arg => typeof arg === 'function')) return Reflect.apply(connect, pool, args);
    return Promise.resolve(Reflect.apply(connect, pool, args)).then((client: pg.PoolClient) => {
      const query = client.query;
      const release = client.release;
      let readOnly = false;
      client.query = ((...queryArgs: unknown[]) => {
        const sql = typeof queryArgs[0] === 'string' ? queryArgs[0].trim().toLowerCase() : '';
        if (sql.includes('begin') && sql.includes('read only')) readOnly = true;
        if (!claimed && readOnly && sql === 'commit') {
          claimed = true;
          pool.connect = connect;
          return Promise.resolve(Reflect.apply(query, client, queryArgs)).then(async result => {
            reached = true;
            await gate;
            return result;
          });
        }
        return Reflect.apply(query, client, queryArgs);
      }) as typeof client.query;
      client.release = (...releaseArgs) => {
        client.query = query;
        client.release = release;
        Reflect.apply(release, client, releaseArgs);
      };
      return client;
    });
  }) as typeof pool.connect;
  return {
    open,
    restore: () => { pool.connect = connect; open(); },
    wait: async () => {
      const deadline = Date.now() + 5_000;
      while (!reached && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(reached, true, 'capture did not reach its real snapshot commit');
    },
  };
}

test('#225 evaluation defaults OFF: capability remains readable but no collection writes', async t => {
  const { db, stack } = await setup(t, { now: () => START });
  const client = await signedInClient(stack.app, 'evaluation-off');
  const goal = await create(client);
  const capability = check(await client.sendExact('GET', '/api/evaluation'), 200);
  assert.equal(capability.json!.enabled, false);
  for (const [method, url, body] of [
    ['GET', path(goal), undefined],
    ['PUT', `${path(goal)}/participation`, { policyVersion: POLICY }],
    ['POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }],
  ] as const) check(await client.sendExact(method, url, body), 404);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_participation')).rows[0]!.n, 0);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast')).rows[0]!.n, 0);
});

test('#225 enabled API: authentication, ownership, Origin, strict bodies and no implicit capture', async t => {
  const { db, stack } = await setup(t, { now: () => START, evaluation: options });
  const a = await signedInClient(stack.app, 'evaluation-owner');
  const b = await signedInClient(stack.app, 'evaluation-other');
  const anon = new Client(stack.app, 'http://127.0.0.1:3000');
  const goal = await create(a);
  const requests = [
    ['GET', path(goal), undefined],
    ['PUT', `${path(goal)}/participation`, { policyVersion: POLICY }],
    ['DELETE', `${path(goal)}/participation`, undefined],
    ['POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }],
  ] as const;
  for (const [method, url, body] of requests) {
    check(await anon.sendExact(method, url, body), 401);
    check(await b.sendExact(method, url, body), 404);
    if (method !== 'GET') {
      check(await a.sendExact(method, url, body, { origin: 'http://foreign.example.test' }), 403);
      check(await a.sendExact(method, url, body, { origin: '' }), 403);
    }
  }
  check(await anon.sendExact('GET', '/api/evaluation'), 401);
  for (const body of [{}, { policyVersion: 'unaccepted-v2' }, { policyVersion: POLICY, userId: 'forged' }]) {
    check(await a.sendExact('PUT', `${path(goal)}/participation`, body), 422);
  }
  for (const body of [{}, { expectedGoalSettingsRevision: '0' }, { expectedGoalSettingsRevision: -1 },
    { expectedGoalSettingsRevision: 0, prediction: {} }]) {
    check(await a.sendExact('POST', `${path(goal)}/forecasts`, body), 422);
  }
  const initial = await report(a, goal);
  assert.equal(initial.participating, false);
  assert.deepEqual(initial.forecasts, []);
  assert.equal(initial.policy.retentionDays, 90);
  assert.equal(initial.policy.maxSnapshots, 90);
  assert.equal(initial.policy.observationDays, 30);
  check(await a.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 409);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_participation')).rows[0]!.n, 0);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast')).rows[0]!.n, 0);
});

test('#225 participation is owner-scoped, explicit, one active goal, and withdrawal preserves normal data', async t => {
  const { db, stack } = await setup(t, { now: () => START, evaluation: options });
  const a = await signedInClient(stack.app, 'evaluation-participation');
  const b = await signedInClient(stack.app, 'evaluation-participation-b');
  const first = await create(a);
  const second = await create(a);
  const otherOwner = await create(b);
  await participate(a, first);
  await participate(a, first);
  check(await a.sendExact('PUT', `${path(second)}/participation`, { policyVersion: POLICY }), 409);
  await participate(b, otherOwner);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_participation')).rows[0]!.n, 2);
  await record(a, first, first.today, 'DONE', 7);
  await capture(a, first);
  const normalData = async () => ({ goal: await get(a, first),
    logs: check(await a.sendExact('GET', `/api/goals/${first.id}/logs`), 200).json });
  const before = await normalData();
  check(await a.sendExact('DELETE', `${path(first)}/participation`), 204);
  check(await a.sendExact('DELETE', `${path(first)}/participation`), 204);
  assert.deepEqual(await normalData(), before);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast where goal_id=$1', [first.id])).rows[0]!.n, 0);
  assert.equal((await report(a, first)).participating, false);
  await participate(a, second);
  assert.equal((await report(b, otherOwner)).participating, true);
});

test('#225 capture freezes actual Engine output and only one first forecast per goal/local day', async t => {
  const { db, stack } = await setup(t, { now: () => START, evaluation: options });
  const a = await signedInClient(stack.app, 'evaluation-capture');
  const goal = await create(a, { ...input, questionPrior: { a: 'HIGH', b: 'HIGH' } });
  await participate(a, goal);
  check(await a.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 409);
  await record(a, goal, goal.today, 'DONE', 17);
  const today = check(await a.sendExact('GET', `/api/goals/${goal.id}/today?view=r11`), 200).json as unknown as TodayR11;
  assert.equal(today.prediction.completion.status, 'available');
  if (today.prediction.completion.status !== 'available') throw new Error('Fixture needs an available actual Engine completion');
  const simultaneous = await Promise.all(Array.from({ length: 6 }, () => a.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 })));
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 200, 200, 200, 200, 201]);
  for (const response of simultaneous) assert.equal(response.headers['cache-control'], 'no-store');
  const issued = simultaneous[0]!.json as unknown as Forecast;
  assert.ok(simultaneous.every(r => r.json!.id === issued.id));
  assert.equal(issued.anchorDate, goal.today);
  assert.equal(issued.remainingAmount, 83, 'today actual 17 counted once, not the setting 10');
  assert.equal(issued.p50Days, today.prediction.completion.p50Days);
  assert.equal(issued.p80Days, today.prediction.completion.p80Days);
  assert.equal(issued.modelVersion, today.prediction.modelVersion);
  assert.equal(issued.buildVersion, options.buildVersion);
  assert.equal(issued.answerRevision, today.context.answerRevision);
  assert.equal(issued.goalSettingsRevision, today.context.goalSettingsRevision);
  assert.equal(issued.unit, 'minutes');
  assert.equal(issued.timezone, 'UTC');
  assert.doesNotMatch(JSON.stringify(issued), /synthetic private title|example\.test|password|cookie|token|userId/);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast where goal_id=$1', [goal.id])).rows[0]!.n, 1);
  const replay = await capture(a, goal, 200);
  assert.equal(replay.id, issued.id);
  assert.equal(replay.remainingAmount, issued.remainingAmount);
});

test('#225 actual amounts, UNKNOWN and the q+2 correction window determine coverage', async t => {
  let now = START;
  const { stack } = await setup(t, { now: () => now, evaluation: options });
  const fixture = async (tag: string) => {
    now = START;
    const client = await signedInClient(stack.app, `evaluation-${tag}`);
    const goal = await create(client, { ...input, totalRequired: 15, questionPrior: { a: 'HIGH', b: 'HIGH' } });
    await participate(client, goal);
    await record(client, goal, goal.today, 'DONE', 5);
    const issued = await capture(client, goal);
    assert.equal(issued.remainingAmount, 10);
    assert.ok(issued.p50Days !== null && issued.p50Days >= 1 && issued.p50Days <= 10);
    assert.ok(issued.p80Days !== null && issued.p80Days >= issued.p50Days && issued.p80Days <= 10);
    return { client, goal, issued, q50: issued.p50Days, q80: issued.p80Days };
  };
  await t.test('at q+1 the deadline day is still editable; only q+2 matures', async () => {
    const f = await fixture('maturity');
    now = instant(f.q50 + 1);
    const pending = await report(f.client, f.goal);
    assert.equal(pending.forecasts[0]!.p50State, 'PENDING');
    assert.equal(pending.summary.p50.lowerCoverage, null);
    assert.equal(pending.summary.p50.upperCoverage, null);
    now = instant(f.q50 + 2);
    const mature = await report(f.client, f.goal);
    assert.equal(mature.forecasts[0]!.p50State, 'UNKNOWN');
    assert.equal(mature.summary.p50.lowerCoverage, 0);
    assert.equal(mature.summary.p50.upperCoverage, 1);
  });
  await t.test('complete recorded window with small actual amounts is NOT_REACHED, regardless of the setting', async () => {
    const f = await fixture('not-reached');
    for (let day = 1; day <= f.q80; day++) {
      now = instant(day);
      await record(f.client, f.goal, date(day), day === 1 ? 'DONE' : 'SKIPPED', 1);
    }
    now = instant(f.q80 + 2);
    const result = await report(f.client, f.goal);
    assert.equal(result.forecasts[0]!.p50State, 'NOT_REACHED');
    assert.equal(result.forecasts[0]!.p80State, 'NOT_REACHED');
    assert.equal(result.summary.p50.NOT_REACHED, 1);
    assert.equal(result.summary.p50.lowerCoverage, 0);
    assert.equal(result.summary.p50.upperCoverage, 0);
    assert.equal(result.forecasts[0]!.remainingAmount, 10);
  });
  await t.test('known future actual amount reaches the frozen target once; prior amount is not counted again', async () => {
    const f = await fixture('reached');
    for (let day = 1; day <= f.q80; day++) {
      now = instant(day);
      await record(f.client, f.goal, date(day), day === 1 ? 'DONE' : 'SKIPPED', 10);
    }
    now = instant(f.q80 + 2);
    const result = await report(f.client, f.goal);
    assert.equal(result.forecasts[0]!.p50State, 'REACHED');
    assert.equal(result.forecasts[0]!.p80State, 'REACHED');
    assert.equal(result.summary.p80.lowerCoverage, 1);
    assert.equal(result.summary.p80.upperCoverage, 1);
    assert.equal(result.summary.participantCount, 1);
  });
  await t.test('missing days remain UNKNOWN, but known sufficient amount can still prove REACHED', async () => {
    const f = await fixture('unknown');
    assert.ok(f.q80 > 1, 'actual HIGH prior fixture must leave an earlier missing day');
    now = instant(f.q80);
    await record(f.client, f.goal, date(f.q80), 'DONE', 10);
    now = instant(f.q80 + 2);
    const result = await report(f.client, f.goal);
    assert.equal(result.forecasts[0]!.p80State, 'REACHED');
    if (f.q50 < f.q80) assert.equal(result.forecasts[0]!.p50State, 'UNKNOWN');
  });
});

test('#225 immutable first forecast: same-value replay, input correction and separate context revisions', async t => {
  const { stack } = await setup(t, { now: () => START, evaluation: options });
  await t.test('same raw log values are not a correction; changed input invalidates without replacing the card', async () => {
    const client = await signedInClient(stack.app, 'evaluation-corrected');
    const goal = await create(client, { ...input, questionPrior: { a: 'HIGH', b: 'HIGH' } });
    await participate(client, goal);
    await record(client, goal, goal.today, 'DONE', 17);
    const first = await capture(client, goal);
    assert.equal(first.p50State, 'PENDING');
    await record(client, goal, goal.today, 'DONE', 17);
    assert.equal((await report(client, goal)).forecasts[0]!.p50State, 'PENDING');
    await record(client, goal, goal.today, 'DONE', 18);
    const corrected = await capture(client, goal, 200);
    assert.equal(corrected.id, first.id);
    assert.equal(corrected.remainingAmount, 83);
    assert.equal(corrected.p50Days, first.p50Days);
    assert.equal(corrected.p50State, 'INPUT_CORRECTED');
    assert.equal(corrected.p80State, 'INPUT_CORRECTED');
    const result = await report(client, goal);
    assert.equal(result.summary.p50.INPUT_CORRECTED, 1);
    assert.equal(result.summary.p50.lowerCoverage, null);
    assert.equal(result.summary.p50.upperCoverage, null);
  });
  for (const answerOnly of [false, true]) await t.test(answerOnly ? 'answer-only revision is CONTEXT_CHANGED' : 'setting revision is CONTEXT_CHANGED and stale capture is 409', async () => {
    const client = await signedInClient(stack.app, `evaluation-context-${answerOnly}`);
    const goal = await create(client, { ...input, questionPrior: { a: 'HIGH', b: 'HIGH' } });
    await participate(client, goal);
    await record(client, goal, goal.today, 'SKIPPED');
    const first = await capture(client, goal);
    const changed = check(await client.sendExact('PATCH', `/api/goals/${goal.id}`, {
      expectedGoalSettingsRevision: 0,
      ...(answerOnly ? { questionPrior: { a: 'LOW', b: 'HIGH' }, expectedAnswerRevision: 0 } : { totalRequired: 101 }),
    }), 200).json as unknown as Goal;
    assert.equal(changed.goalSettingsRevision, answerOnly ? 0 : 1);
    const result = await report(client, goal);
    assert.equal(result.forecasts[0]!.id, first.id);
    assert.equal(result.forecasts[0]!.remainingAmount, first.remainingAmount);
    assert.equal(result.forecasts[0]!.p50State, 'CONTEXT_CHANGED');
    assert.equal(result.forecasts[0]!.p80State, 'CONTEXT_CHANGED');
    if (!answerOnly) check(await client.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 409);
    const replay = await capture(client, changed, 200);
    assert.equal(replay.id, first.id);
    assert.equal(replay.goalSettingsRevision, 0);
  });
});

test('#225 NULL and observation-horizon exclusion are not failure coverage', async t => {
  const { stack } = await setup(t, { now: () => START, evaluation: { ...options, observationDays: 1 } });
  for (const available of [false, true]) await t.test(available ? 'finite day outside the observation window' : 'insufficient completion has null quantiles', async () => {
    const client = await signedInClient(stack.app, `evaluation-null-${available}`);
    const goal = await create(client, { ...input, ...(available ? { questionPrior: { a: 'HIGH', b: 'HIGH' } } : {}) });
    await participate(client, goal);
    await record(client, goal, goal.today, 'SKIPPED');
    const issued = await capture(client, goal);
    assert.equal(issued.predictionStatus, available ? 'available' : 'insufficient');
    assert.equal(issued.p50State, available ? 'OUTSIDE_HORIZON' : 'NULL');
    assert.equal(issued.p80State, available ? 'OUTSIDE_HORIZON' : 'NULL');
    const result = await report(client, goal);
    assert.equal(result.summary.issued, 1);
    assert.equal(result.summary.p50.lowerCoverage, null);
    assert.equal(result.summary.p50.upperCoverage, null);
  });
  await t.test('already completed state cannot generate a new forecast', async () => {
    const client = await signedInClient(stack.app, 'evaluation-completed');
    const goal = await create(client, { ...input, initialProgress: 100 });
    await participate(client, goal);
    await record(client, goal, goal.today, 'SKIPPED');
    check(await client.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 409);
    assert.deepEqual((await report(client, goal)).forecasts, []);
  });
});

test('#225 maturation follows frozen Goal timezone across a UTC date boundary', async t => {
  let now = new Date('2026-10-01T00:30:00Z');
  const { stack } = await setup(t, { now: () => now, evaluation: options });
  const client = await signedInClient(stack.app, 'evaluation-timezone');
  const goal = await create(client, { ...input, totalRequired: 15, timezone: 'America/Los_Angeles', questionPrior: { a: 'HIGH', b: 'HIGH' } });
  assert.equal(goal.today, '2026-09-30');
  await participate(client, goal);
  await record(client, goal, goal.today, 'DONE', 5);
  const first = await capture(client, goal);
  assert.equal(first.anchorDate, '2026-09-30');
  assert.equal(first.timezone, goal.timezone);
  assert.ok(first.p50Days !== null);
  const utcMaturity = new Date(Date.UTC(2026, 8, 30 + first.p50Days + 2, 0, 30));
  now = utcMaturity;
  assert.equal((await report(client, goal)).forecasts[0]!.p50State, 'PENDING', 'UTC advanced but Los Angeles is still the preceding day');
  now = new Date(utcMaturity.getTime() + 7 * 3_600_000);
  assert.equal((await report(client, goal)).forecasts[0]!.p50State, 'UNKNOWN', 'Goal local midnight closes the correction window');
});

test('#225 max snapshots retains bounded latest days and same-day replay does not evict', async t => {
  let now = START;
  const { db, stack } = await setup(t, { now: () => now, evaluation: { ...options, maxSnapshots: 2 } });
  const client = await signedInClient(stack.app, 'evaluation-max');
  const goal = await create(client);
  await participate(client, goal);
  const issued: Forecast[] = [];
  for (let day = 0; day < 3; day++) {
    now = instant(day);
    await record(client, goal, date(day), 'SKIPPED');
    const card = await capture(client, goal);
    issued.push(card);
    assert.equal((await capture(client, goal, 200)).id, card.id);
    assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast where goal_id=$1', [goal.id])).rows[0]!.n, Math.min(day + 1, 2));
  }
  const result = await report(client, goal);
  assert.deepEqual(result.forecasts.map(row => row.id).sort(), issued.slice(1).map(row => row.id).sort());
  assert.equal(result.summary.issued, 2);
  assert.equal(result.summary.participantCount, 1, 'daily rows are not separate participants');
});

test('#225 expiry boundary hides stale participation; explicit purge deletes rows and is idempotent', async t => {
  let now = START;
  const { db, stack } = await setup(t, { now: () => now, evaluation: { ...options, retentionDays: 3, observationDays: 1 } });
  const client = await signedInClient(stack.app, 'evaluation-expiry');
  const goal = await create(client);
  await participate(client, goal);
  await record(client, goal, goal.today, 'SKIPPED');
  const first = await capture(client, goal);
  assert.equal(first.expiresAt, instant(3).toISOString());
  now = instant(2);
  await record(client, goal, date(2), 'SKIPPED');
  const later = await capture(client, goal);
  assert.equal(later.expiresAt, first.expiresAt, 'later captures do not extend the participation retention deadline');
  assert.equal(later.issuedAt, instant(2).toISOString());
  now = new Date(instant(3).getTime() - 1);
  assert.equal((await report(client, goal)).participating, true);
  now = instant(3);
  const expired = await report(client, goal);
  assert.equal(expired.participating, false);
  assert.deepEqual(expired.forecasts, []);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast')).rows[0]!.n, 2, 'read hiding is not physical purge');
  check(await client.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 }), 409);
  // Failure is injected only into this helper-owned synthetic DB. Reject the
  // second DELETE so the first DELETE must roll back with its transaction.
  await db.pool.query(`create function evaluation_test_reject_purge() returns trigger language plpgsql as $$
    begin raise exception 'synthetic purge rejection'; end $$`);
  await db.pool.query(`create trigger evaluation_test_reject_purge before delete on evaluation_participation
    for each row execute function evaluation_test_reject_purge()`);
  try {
    await assert.rejects(purgeExpiredEvaluation(db.pool, now, 3), /synthetic purge rejection/);
    assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast')).rows[0]!.n, 2);
    assert.equal((await db.pool.query('select count(*)::int as n from evaluation_participation')).rows[0]!.n, 1);
  } finally {
    await db.pool.query('drop trigger evaluation_test_reject_purge on evaluation_participation');
    await db.pool.query('drop function evaluation_test_reject_purge()');
  }
  assert.deepEqual(await purgeExpiredEvaluation(db.pool, now, 3), { forecasts: 2, participations: 1 });
  assert.deepEqual(await purgeExpiredEvaluation(db.pool, now, 3), { forecasts: 0, participations: 0 });
  await participate(client, goal);
  assert.equal((await report(client, goal)).participating, true);
  assert.deepEqual((await report(client, goal)).forecasts, []);
});

test('#225 Goal DELETE and synthetic user DB DELETE cascade evaluation rows, not other owners', async t => {
  const { db, stack } = await setup(t, { now: () => START, evaluation: options });
  const fixtures: { client: Client; goal: Goal; owner: string }[] = [];
  for (const tag of ['delete-goal', 'delete-user']) {
    const client = await signedInClient(stack.app, `evaluation-${tag}`);
    const goal = await create(client);
    await participate(client, goal);
    await record(client, goal, goal.today, 'SKIPPED');
    await capture(client, goal);
    const owner = (await db.pool.query<{ user_id: string }>('select user_id from goal where id=$1', [goal.id])).rows[0]!.user_id;
    fixtures.push({ client, goal, owner });
  }
  const [a, b] = fixtures;
  assert.ok(a && b);
  check(await a.client.sendExact('DELETE', `/api/goals/${a.goal.id}`), 204);
  check(await a.client.sendExact('GET', path(a.goal)), 404);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast')).rows[0]!.n, 1);
  assert.equal((await report(b.client, b.goal)).forecasts.length, 1);
  // This is owned test DB FK acceptance, not an implemented public withdrawal/account-delete API.
  assert.equal((await db.pool.query('delete from "user" where id=$1', [b.owner])).rowCount, 1);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_participation')).rows[0]!.n, 0);
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast')).rows[0]!.n, 0);
});

test('#225 capture rechecks changed input, context, day and participation after its computation snapshot', async t => {
  let now = START;
  const { db, stack } = await setup(t, { now: () => now, evaluation: options });
  for (const change of ['amount', 'settings', 'answers', 'day', 'withdraw', 'withdraw-rejoin', 'delete', 'same-value'] as const) {
    await t.test(`midphase ${change}`, async () => {
      now = START;
      const client = await signedInClient(stack.app, `evaluation-race-${change}`);
      const goal = await create(client, { ...input, questionPrior: { a: 'HIGH', b: 'HIGH' } });
      await participate(client, goal);
      await record(client, goal, goal.today, 'DONE', 17);
      const before = (await db.pool.query<{ id: string; joined_at: Date }>(
        'select id,joined_at from evaluation_participation where goal_id=$1', [goal.id])).rows[0]!;
      const barrier = pauseSnapshot(db.pool);
      const pending = client.sendExact('POST', `${path(goal)}/forecasts`, { expectedGoalSettingsRevision: 0 });
      let fresh = goal;
      try {
        await barrier.wait();
        if (change === 'amount' || change === 'same-value') await record(client, goal, goal.today, 'DONE', change === 'amount' ? 18 : 17);
        if (change === 'settings' || change === 'answers') fresh = check(await client.sendExact('PATCH', `/api/goals/${goal.id}`, {
          expectedGoalSettingsRevision: 0,
          ...(change === 'settings' ? { totalRequired: 101 } : { questionPrior: { a: 'LOW', b: 'HIGH' }, expectedAnswerRevision: 0 }),
        }), 200).json as unknown as Goal;
        if (change === 'day') {
          now = instant(1);
          fresh = await get(client, goal);
          await record(client, fresh, fresh.today, 'SKIPPED');
        }
        if (change === 'withdraw' || change === 'withdraw-rejoin') {
          check(await client.sendExact('DELETE', `${path(goal)}/participation`), 204);
          if (change === 'withdraw-rejoin') {
            await participate(client, goal);
            const after = (await db.pool.query<{ id: string; joined_at: Date }>(
              'select id,joined_at from evaluation_participation where goal_id=$1', [goal.id])).rows[0]!;
            assert.notEqual(after.id, before.id, 'participation generation must change on withdrawal/rejoin');
            assert.equal(after.joined_at.getTime(), before.joined_at.getTime(), 'same fake instant must not revive an old capture');
          }
        }
        if (change === 'delete') check(await client.sendExact('DELETE', `/api/goals/${goal.id}`), 204);
        barrier.open();
        const response = await pending;
        if (change === 'same-value') {
          check(response, 201);
          assert.equal((response.json as unknown as Forecast).remainingAmount, 83);
        } else {
          check(response, change === 'delete' ? 404 : 409);
          const expected = change === 'settings' ? 'GOAL_SETTINGS_CONFLICT' :
            change === 'withdraw' ? 'EVALUATION_NOT_PARTICIPATING' :
            change === 'withdraw-rejoin' ? 'EVALUATION_PARTICIPATION_CHANGED' : 'EVALUATION_INPUT_CHANGED';
          if (change !== 'delete') assert.equal((response.json!.error as { code: string }).code, expected);
          assert.equal((await db.pool.query('select count(*)::int as n from evaluation_forecast where goal_id=$1', [goal.id])).rows[0]!.n, 0);
          if (change !== 'withdraw' && change !== 'delete') {
            const retry = await capture(client, fresh);
            assert.equal(retry.anchorDate, fresh.today);
            assert.equal(retry.goalSettingsRevision, fresh.goalSettingsRevision);
            assert.equal(retry.remainingAmount, change === 'amount' ? 82 : change === 'settings' ? 84 : 83);
          }
        }
      } finally {
        barrier.restore();
        await pending;
      }
    });
  }
});

test('#225 concurrent opt-ins serialize the per-user one-active-goal limit', async t => {
  const { db, stack } = await setup(t, { now: () => START, evaluation: options });
  const client = await signedInClient(stack.app, 'evaluation-join-race');
  const goals = await Promise.all([create(client), create(client)]);
  const responses = await Promise.all(goals.map(goal => client.sendExact('PUT', `${path(goal)}/participation`, { policyVersion: POLICY })));
  assert.deepEqual(responses.map(response => response.status).sort(), [204, 409]);
  for (const response of responses) assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await db.pool.query('select count(*)::int as n from evaluation_participation')).rows[0]!.n, 1);
  const reports = await Promise.all(goals.map(goal => report(client, goal)));
  assert.equal(reports.filter(result => result.participating).length, 1);
});
