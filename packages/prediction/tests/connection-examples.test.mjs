import test from 'node:test';
import assert from 'node:assert/strict';
import { predict } from '../dist/src/index.js';
import { cases } from '../examples/recalculate.mjs';

test('Published connection examples distinguish UNKNOWN, recorded, insufficient, completed, null and zero', () => {
  const before = structuredClone(cases);
  const results = Object.fromEntries(cases.map(({ name, input }) => [name, predict(input)]));
  assert.equal(cases.length, 11);
  assert.equal(Object.keys(results).length, cases.length);
  assert.deepEqual(cases, before);
  const gap = results['unknown-gap'];
  assert.equal(gap.todayStatus, 'UNRECORDED');
  assert.equal(gap.observations.effectiveTransitions, 4);
  assert.equal(gap.observations.observedDays, 7);
  assert.equal(gap.observations.recordedDays, 6);
  assert.equal(gap.progress.done, 60);
  assert.equal(results.backfill.progress.done, 75);
  assert.equal(results.backfill.observations.effectiveTransitions, 6);
  assert.equal(results['correct-backfill'].progress.done, 60);
  for (const name of ['today-actual', 'today-skipped']) {
    assert.deepEqual(results[name].coreMetric, { status: 'not_applicable', reason: 'TODAY_RECORDED' });
    assert.equal(results[name].completion.scenario, 'CURRENT_STATE');
  }
  assert.equal(results['today-actual'].progress.done, 63);
  assert.equal(results['today-skipped'].progress.done, 60);
  assert.deepEqual(results.completed.completion, { status: 'completed' });
  assert.deepEqual(results.completed.coreMetric, { status: 'not_applicable', reason: 'COMPLETED' });
  assert.deepEqual(results['empty-history'].completion, { status: 'insufficient', reason: 'NO_DONE_ORIGIN_TRANSITION' });
  assert.deepEqual(results['done-origin-only'].completion, { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' });
  assert.deepEqual(results['skip-origin-only'].completion, { status: 'insufficient', reason: 'NO_DONE_ORIGIN_TRANSITION' });
  assert.equal(results['skip-origin-only'].coreMetric.status, 'available');
  assert.deepEqual(completionValues(results['available-null'].completion), {
    status: 'available', scenario: 'TODAY_DONE', p50Days: null, p80Days: null,
  });
  assert.deepEqual(completionValues(results['available-zero'].completion), {
    status: 'available', scenario: 'TODAY_DONE', p50Days: 0, p80Days: 0,
  });
  assert.equal(results['available-zero'].progress.completed, false);
  assert.equal(results['available-zero'].progress.done, 60);
});

// 新しい方式metadataは専用契約テストで検査し、既存の日数・状態の期待値を保持する。
function completionValues({ computation, ...values }) { return values; }
