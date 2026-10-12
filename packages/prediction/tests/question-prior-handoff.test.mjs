import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { evaluateQuestionPriorAdapterCandidate } from '../dist/src/question-prior-adapter-candidate.js';
import { resolvedHandoffFixture, requestFromResolvedFixture } from './examples/question-prior-handoff.mjs';

async function roundtrip(request, config) {
  const worker = new Worker(new URL('./examples/question-prior-worker-copy.mjs', import.meta.url), {
    workerData: { request, config },
  });
  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`Example worker exited before response (${code})`)));
    });
  } finally {
    await worker.terminate();
  }
}

test('handoff example: saved initial mapping and same snapshot context reach adapter without posterior or quantity recomputation', async () => {
  for (const id of ['F09', 'F15']) {
    const fixture = resolvedHandoffFixture(id);
    const before = structuredClone(fixture);
    assert.equal(fixture.storedSnapshot.context.sessionAmount, fixture.prediction.goal.sessionAmount);
    const request = requestFromResolvedFixture(fixture);
    assert.deepEqual(Object.keys(request).sort(), ['answers', 'mapping', 'prediction']);
    assert.equal('unit' in request.prediction.goal, false);
    assert.equal('recordStartDate' in request.prediction.goal, false);
    const result = evaluateQuestionPriorAdapterCandidate(request, fixture.config);
    assert.deepEqual(result.posterior, fixture.expected.posterior);
    assert.deepEqual(result.conditionalPlan, fixture.expected.conditionalPlan);
    fixture.currentMapping.values.LOW = { alpha: 3, beta: 1 };
    fixture.previousPosterior.b.alpha = 99;
    assert.deepEqual(evaluateQuestionPriorAdapterCandidate(requestFromResolvedFixture(fixture), fixture.config), result);
    // metadataは同じ解決済みsnapshotからBEが付加し、FEは名前を変えるだけの例。
    const plan = {
      remainingAmount: result.conditionalPlan.remainingAmount,
      sessions: result.conditionalPlan.remainingSessions,
      lastAmount: result.conditionalPlan.lastSessionAmount,
      sessionAmount: before.storedSnapshot.context.sessionAmount,
      unit: before.storedSnapshot.context.unit,
    };
    if (id === 'F15') {
      assert.deepEqual(plan, { remainingAmount: 40, sessions: 3, lastAmount: 10, sessionAmount: 15, unit: 'minutes' });
    }
    const transported = await roundtrip(requestFromResolvedFixture(before), before.config);
    assert.equal(transported.ok, true);
    assert.deepEqual(transported.result, result);
  }
});

test('handoff example: known candidate and Engine errors retain classification through plain object worker copy', async () => {
  const cases = [
    [input => { delete input.answers.a; }, {
      name: 'QuestionPriorAdapterCandidateError', kind: 'input',
      reason: 'INVALID_ANSWER', path: ['answers', 'a'],
    }],
    [input => { delete input.mapping.values.LOW; }, {
      name: 'QuestionPriorAdapterCandidateError', kind: 'config',
      reason: 'INVALID_MAPPING', path: ['mapping', 'values', 'LOW'],
    }],
    [input => { input.mapping.values.LOW.alpha = 0; }, {
      name: 'PredictionConfigError',
      reason: 'INVALID_INTEGER', path: ['mapping', 'values', 'LOW', 'alpha'],
    }],
    [input => { input.prediction.logs[0].localDate = '2026-10-06'; }, {
      name: 'PredictionInputError',
      reason: 'FUTURE_LOG_DATE', path: ['logs', 0, 'localDate'],
    }],
  ];
  for (const [mutate, expected] of cases) {
    const fixture = resolvedHandoffFixture('F15');
    const request = requestFromResolvedFixture(fixture);
    mutate(request);
    const transported = await roundtrip(request, fixture.config);
    assert.equal(transported.ok, false);
    assert.equal(transported.sourcePathFrozen, true);
    assert.deepEqual(transported.copied, expected);
    assert.equal(Object.getPrototypeOf(transported.copied), Object.prototype);
    for (const field of ['kind', 'reason', 'path']) {
      assert.equal(transported.rawError[field], undefined);
    }
    assert.equal('message' in transported.copied, false);
    assert.equal('stack' in transported.copied, false);
    assert.deepEqual(structuredClone(transported.copied), expected);
  }
});

test('handoff example: an unknown worker failure rejects instead of becoming an input error or successful result', async () => {
  const fixture = resolvedHandoffFixture('F15');
  const request = requestFromResolvedFixture(fixture);
  request.prediction = null;
  await assert.rejects(roundtrip(request, fixture.config), error => error instanceof Error && error.name === 'TypeError');
});
