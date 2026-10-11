import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { completionFromValidatedState } from '../../../packages/prediction/dist/src/completion-scenario.js';
import type { Goal } from '../src/contracts/goal.ts';
import type { EvaluationForecast, EvaluationReport } from '../src/contracts/evaluation.ts';
import type { SavedEvaluation } from '../src/evaluation/assessment.ts';
import { Client, setup, signedInClient } from './helpers/stack.ts';

test('#225 frozen inputs reproduce issued quantiles after origin correction and session amount change', async t => {
  const { db, stack } = await setup(t, { now: () => new Date('2026-10-01T12:00:00Z'),
    evaluation: { enabled: true, buildVersion: 'synthetic-evaluation-replay' } });
  const check = (res: Awaited<ReturnType<Client['sendExact']>>, status: number) => {
    assert.equal(res.status, status, res.body);
    assert.equal(res.headers['cache-control'], 'no-store');
    return res;
  };
  for (const status of ['DONE', 'SKIPPED'] as const) await t.test(`issued ${status}`, async () => {
    const client = await signedInClient(stack.app, `evaluation-replay-${status}`);
    const goal = check(await client.sendExact('POST', '/api/goals', { title: 'synthetic replay', unit: 'minutes',
      totalRequired: 100, initialProgress: 0, sessionAmount: 10, timezone: 'UTC',
      questionPrior: { a: 'HIGH', b: 'HIGH' } }, { 'idempotency-key': randomUUID() }), 201).json as unknown as Goal;
    const base = `/api/goals/${goal.id}/evaluation`;
    check(await client.sendExact('PUT', `${base}/participation`, { policyVersion: 'self-evaluation-v1' }), 204);
    check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, {
      expectedGoalSettingsRevision: 0, status, ...(status === 'DONE' ? { amount: 17 } : {}),
    }), 200);
    const issued = check(await client.sendExact('POST', `${base}/forecasts`, {
      expectedGoalSettingsRevision: 0,
    }), 201).json as unknown as EvaluationForecast;
    assert.equal(issued.predictionStatus, 'available');
    const readSaved = async () => (await db.pool.query<{ payload: SavedEvaluation }>(
      'select payload from evaluation_forecast where id=$1', [issued.id])).rows[0]!.payload;
    const saved = await readSaved();
    assert.equal(saved.sessionAmount, 10);
    assert.equal(saved.issuedTodayStatus, status);
    assert.equal(saved.remainingAmount, status === 'DONE' ? 83 : 100);
    // Call the actual existing Engine adapter with only frozen inputs. No current
    // Goal, log, answer or caller-created substitute quantile enters this replay.
    const replay = () => completionFromValidatedState({ totalRequired: saved.remainingAmount,
      initialProgress: 0, sessionAmount: saved.sessionAmount }, 0, saved.issuedTodayStatus, saved.posterior, saved.config);
    const assertReplay = () => {
      const completion = replay();
      assert.equal(completion.p50Days, issued.p50Days);
      assert.equal(completion.p80Days, issued.p80Days);
      assert.deepEqual(completion.computation, saved.computation);
    };
    assertReplay();
    check(await client.sendExact('PUT', `/api/goals/${goal.id}/logs/${goal.today}`, {
      expectedGoalSettingsRevision: 0, status: status === 'DONE' ? 'SKIPPED' : 'DONE',
      ...(status === 'SKIPPED' ? { amount: 19 } : {}),
    }), 200);
    const corrected = check(await client.sendExact('GET', base), 200).json as unknown as EvaluationReport;
    assert.equal(corrected.forecasts[0]!.p50State, 'INPUT_CORRECTED');
    assert.deepEqual(await readSaved(), saved);
    assertReplay();
    const changed = check(await client.sendExact('PATCH', `/api/goals/${goal.id}`, {
      expectedGoalSettingsRevision: 0, sessionAmount: 20,
    }), 200).json as unknown as Goal;
    assert.equal(changed.sessionAmount, 20);
    assert.equal(changed.goalSettingsRevision, 1);
    const report = check(await client.sendExact('GET', base), 200).json as unknown as EvaluationReport;
    assert.equal(report.forecasts[0]!.p50State, 'CONTEXT_CHANGED');
    assert.equal(report.forecasts[0]!.p50Days, issued.p50Days);
    assert.equal(report.forecasts[0]!.p80Days, issued.p80Days);
    assert.equal(report.summary.p50.lowerCoverage, null);
    assert.equal(report.summary.p80.upperCoverage, null);
    assert.deepEqual(await readSaved(), saved);
    assertReplay();
    const differentInput = completionFromValidatedState({ totalRequired: saved.remainingAmount,
      initialProgress: 0, sessionAmount: changed.sessionAmount }, 0,
      saved.issuedTodayStatus === 'DONE' ? 'SKIPPED' : 'DONE', saved.posterior, saved.config);
    assert.notDeepEqual([differentInput.p50Days, differentInput.p80Days], [issued.p50Days, issued.p80Days],
      'fixture must distinguish changed amount/origin from the frozen inputs');
  });
});
