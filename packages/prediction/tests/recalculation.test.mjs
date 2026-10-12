import test from 'node:test';
import assert from 'node:assert/strict';
import { predict, DEFAULT_CONFIG } from '../dist/src/index.js';

const config = Object.freeze({ ...DEFAULT_CONFIG, samples: 8, horizonDays: 64 });
const log = (day, status, amount = status === 'DONE' ? 10 : null) => ({
  localDate: `2026-10-${String(day).padStart(2, '0')}`, status, amount,
});
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
const counts = (nDD, nDS, nSD, nSS, observedDays = 0, recordedDays = 0) => ({ nDD, nDS, nSD, nSS,
  effectiveTransitions: nDD + nDS + nSD + nSS, observedDays, recordedDays });

test('backfill then correction rebuilds both adjacent pairs and actual progress from each full snapshot', () => {
  const before = freeze({ goal: { totalRequired: 100, initialProgress: 0, sessionAmount: 10 },
    logs: [log(1, 'DONE'), log(3, 'SKIPPED')], today: '2026-10-04' });
  const filled = freeze({ ...before, logs: [before.logs[0], log(2, 'DONE', 20), before.logs[1]] });
  const corrected = freeze({ ...before, logs: [before.logs[0], log(2, 'SKIPPED'), before.logs[1]] });
  const snapshots = [before, filled, corrected];
  const untouched = structuredClone(snapshots);
  const results = snapshots.map(input => predict(input, config));
  assert.deepEqual(results.map(r => r.observations), [counts(0, 0, 0, 0, 3, 2), counts(1, 1, 0, 0, 3, 3), counts(0, 1, 0, 1, 3, 3)]);
  assert.deepEqual(results.map(r => r.progress.done), [10, 30, 10]);
  assert.deepEqual(results.map(r => r.posterior), [
    { a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } },
    { a: { alpha: 3, beta: 3 }, b: { alpha: 2, beta: 2 } },
    { a: { alpha: 2, beta: 3 }, b: { alpha: 2, beta: 3 } },
  ]);
  assert.deepEqual(results.map(r => r.coreMetric), [
    { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' },
    { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' },
    { status: 'available', g50: 2, g80: 5 },
  ]);
  for (let i = snapshots.length - 1; i >= 0; i--) {
    assert.deepEqual(predict(snapshots[i], config), results[i]);
  }
  assert.deepEqual(snapshots, untouched);
});

test('today amount correction and later session edits do not rewrite actual historical amounts', () => {
  const before = freeze({ goal: { totalRequired: 100, initialProgress: 2, sessionAmount: 10 },
    logs: [log(1, 'DONE', 2), log(2, 'SKIPPED'), log(3, 'DONE', 3)], today: '2026-10-03' });
  const corrected = freeze({ ...before, logs: [before.logs[0], before.logs[1], log(3, 'DONE', 9)] });
  const edited = freeze({ ...corrected, goal: { ...corrected.goal, sessionAmount: 20 } });
  const results = [before, corrected, edited].map(input => predict(input, config));
  assert.deepEqual(results.map(r => r.progress.done), [7, 13, 13]);
  for (const r of results) {
    assert.deepEqual(r.observations, counts(0, 1, 1, 0, 3, 3));
    assert.deepEqual(r.posterior, { a: { alpha: 2, beta: 3 }, b: { alpha: 3, beta: 2 } });
    assert.equal(r.todayStatus, 'DONE');
    assert.deepEqual(r.coreMetric, { status: 'not_applicable', reason: 'TODAY_RECORDED' });
    assert.equal(r.completion.scenario, 'CURRENT_STATE');
  }
  assert.deepEqual(predict(before, config), results[0]);
});

test('a late actual-log correction can enter and leave COMPLETED without stale state', () => {
  const base = freeze({ goal: { totalRequired: 25, initialProgress: 5, sessionAmount: 10 },
    logs: [log(1, 'DONE', 10), log(2, 'SKIPPED'), log(3, 'DONE', 5)], today: '2026-10-04' });
  const complete = freeze({ ...base, logs: [base.logs[0], base.logs[1], log(3, 'DONE', 10)] });
  const initial = predict(base, config);
  assert.equal(initial.completion.status, 'available');
  const result = predict(complete, config);
  assert.deepEqual(result.progress, { done: 25, total: 25, completed: true });
  assert.deepEqual(result.coreMetric, { status: 'not_applicable', reason: 'COMPLETED' });
  assert.deepEqual(result.completion, { status: 'completed' });
  assert.deepEqual(result.observations, initial.observations);
  assert.deepEqual(predict(base, config), initial);
});

// UNKNOWNも含めて全暦日を走査する独立参照。
// 疎なログの整列や、本体の観測集計・乱数関数を流用しない。
test('120 reproducible generated histories agree with a dense calendar oracle and preserve frozen inputs', () => {
  let state = 0x71c0ffee;
  const next = max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
  for (let caseIndex = 0; caseIndex < 120; caseIndex++) {
    const calendar = Array.from({ length: 21 }, (_, index) => {
      const choice = next(3);
      return choice === 0 ? null : log(index + 1, choice === 1 ? 'DONE' : 'SKIPPED', choice === 1 ? next(17) + 1 : null);
    });
    const expected = counts(0, 0, 0, 0);
    let actual = 0;
    let observationStarted = false;
    for (let i = 0; i < calendar.length; i++) {
      const row = calendar[i];
      if (row) {
        observationStarted = true;
        expected.recordedDays++;
      }
      if (observationStarted && (i < 20 || calendar[20])) {
        expected.observedDays++;
      }
      if (row?.status === 'DONE') {
        actual += row.amount;
      }
      const previous = calendar[i - 1];
      if (previous && row) {
        const key = `n${previous.status === 'DONE' ? 'D' : 'S'}${row.status === 'DONE' ? 'D' : 'S'}`;
        expected[key]++;
        expected.effectiveTransitions++;
      }
    }
    const initialProgress = next(11);
    const sessionAmount = next(5) + 1;
    const logs = calendar.filter(Boolean);
    for (let i = logs.length - 1; i > 0; i--) {
      const j = next(i + 1);
      [logs[i], logs[j]] = [logs[j], logs[i]];
    }
    const input = freeze({ goal: { initialProgress, sessionAmount,
      totalRequired: initialProgress + actual + 3 * sessionAmount + 17 }, logs, today: '2026-10-21' });
    const unchanged = structuredClone(input);
    const message = `generator seed=0x71c0ffee case=${caseIndex}`;
    const result = predict(input, config);
    assert.deepEqual(result.observations, expected, message);
    assert.equal(result.progress.done, initialProgress + actual, message);
    assert.equal(result.todayStatus, calendar[20]?.status ?? 'UNRECORDED', message);
    assert.deepEqual(result.posterior, {
      a: { alpha: 2 + expected.nDD, beta: 2 + expected.nDS },
      b: { alpha: 2 + expected.nSD, beta: 2 + expected.nSS },
    }, message);
    predict({ ...input, logs: input.logs.toReversed() }, { ...config, seed: 17 });
    assert.deepEqual(predict(input, config), result, message);
    assert.deepEqual(input, unchanged, message);
  }
});

test('rejecting frozen duplicate snapshots does not mutate inputs or contaminate the next calculation', () => {
  const valid = freeze({ goal: { totalRequired: 100, initialProgress: 0, sessionAmount: 10 },
    logs: [log(1, 'DONE'), log(2, 'SKIPPED'), log(3, 'DONE')], today: '2026-10-04' });
  const expected = predict(valid, config);
  const invalid = freeze({ ...valid, logs: [...valid.logs, log(2, 'DONE', 20)] });
  const unchanged = structuredClone(invalid);
  assert.throws(() => predict(invalid, config), RangeError);
  assert.deepEqual(invalid, unchanged);
  assert.deepEqual(predict(valid, config), expected);
});
