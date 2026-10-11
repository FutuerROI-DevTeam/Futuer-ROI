import test from 'node:test';
import assert from 'node:assert/strict';
import { predict, DEFAULT_CONFIG } from '../dist/src/index.js';
import { observe } from '../dist/src/observations.js';
import { samplePosterior } from '../dist/src/random.js';
import { mixtureCompletionQuantiles } from '../dist/src/completion.js';
import { unknownGapInput, unknownGapExpected, todayDoneInput } from '../dist/tests/fixtures.js';

// 従来のseeded数値回帰は明示sampledで保持し、autoは独立oracleで検証する。
const smallConfig = { ...DEFAULT_CONFIG, samples: 24, horizonDays: 60, completionMethod: 'sampled' };
const copy = value => structuredClone(value);
const goal = { totalRequired: 20, initialProgress: 0, sessionAmount: 1 };
const log = (localDate, status, amount = status === 'DONE' ? 1 : null) => ({ localDate, status, amount });

test('T-01: actual observations exclude both pairs around UNKNOWN; input order is irrelevant', () => {
  const before = copy(unknownGapInput);
  const observed = observe(unknownGapInput);
  assert.deepEqual(observed.counts, unknownGapExpected);
  assert.equal(observed.actualDone, 60);
  assert.equal(observed.todayStatus, 'UNRECORDED');
  assert.deepEqual(observe({ ...before, logs: before.logs.toReversed() }), observed);
  assert.deepEqual(unknownGapInput, before);
  const result = predict(before, smallConfig);
  assert.deepEqual(result.observations, { ...unknownGapExpected, effectiveTransitions: 4,
    observedDays: 7, recordedDays: 6 });
  assert.deepEqual(result.posterior, { a: { alpha: 3, beta: 3 }, b: { alpha: 3, beta: 3 } });
  assert.ok(result.observations.observedDays > result.observations.recordedDays);
});

test('T-01: Gregorian adjacency includes leap/year boundaries and excludes missing days', () => {
  for (const [before, after] of [
    ['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'],
    ['2025-02-28', '2025-03-01'], ['2000-02-28', '2000-02-29'],
    ['1900-02-28', '1900-03-01'], ['2025-12-31', '2026-01-01'],
  ]) {
    assert.equal(observe({ goal, today: after, logs: [log(before, 'SKIPPED'), log(after, 'DONE')] }).counts.nSD, 1);
  }
  assert.equal(observe({ goal, today: '2024-03-01',
    logs: [log('2024-02-28', 'SKIPPED'), log('2024-03-01', 'DONE')] }).counts.nSD, 0);
});

test('T-04: core depends only on SKIPPED-origin counts, independent of DONE-origin and goal quantities', () => {
  const input = { goal, today: '2026-10-05', logs: [
    log('2026-10-02', 'DONE'), log('2026-10-03', 'SKIPPED'), log('2026-10-04', 'DONE'),
  ] };
  const expected = predict(input, smallConfig).coreMetric;
  assert.equal(expected.status, 'available');
  for (const totalRequired of [20, 40, 100]) {
    for (const initialProgress of [0, 1, 5]) {
      for (const sessionAmount of [1, 2, 7]) {
        const changed = predict({ ...input, goal: { totalRequired, initialProgress, sessionAmount },
          logs: [log('2026-10-01', 'DONE'), ...input.logs] }, smallConfig);
        assert.deepEqual(changed.coreMetric, expected);
        assert.notDeepEqual(changed.posterior.a, predict(input, smallConfig).posterior.a);
      }
    }
  }
});

test('T-07: identical input/config is exactly deterministic and does not mutate caller data', () => {
  const input = copy(unknownGapInput);
  const before = copy(input);
  const config = copy(smallConfig);
  const result = predict(input, config);
  assert.deepEqual(predict(input, config), result);
  assert.deepEqual(input, before);
  assert.deepEqual(config, smallConfig);
  result.posterior.a.alpha = 999;
  assert.notEqual(predict(input, config).posterior.a.alpha, 999);
});

test('T-08/T-12: today actual amount is counted once; CURRENT_STATE counts only future DONEs', () => {
  const result = predict(todayDoneInput, smallConfig);
  assert.equal(result.progress.done, 7);
  assert.deepEqual(result.coreMetric, { status: 'not_applicable', reason: 'TODAY_RECORDED' });
  const samples = samplePosterior(result.posterior, smallConfig.samples, smallConfig.seed);
  assert.deepEqual(completionValues(result.completion), { status: 'available', scenario: 'CURRENT_STATE',
    ...mixtureCompletionQuantiles(samples, 'DONE', 2, smallConfig.horizonDays) });
  const wrongDoubleCount = mixtureCompletionQuantiles(samples, 'DONE', 1, smallConfig.horizonDays);
  assert.notEqual(result.completion.p50Days, wrongDoubleCount.p50Days);
});

test('T-08: unrecorded today uses one hypothetical session; remaining one gives0, two gives future need1', () => {
  const input = { ...todayDoneInput, today: '2026-10-04' };
  const done = 7;
  const one = predict({ ...input, goal: { ...input.goal, totalRequired: done + 10 } }, smallConfig);
  assert.deepEqual(completionValues(one.completion), { status: 'available', scenario: 'TODAY_DONE', p50Days: 0, p80Days: 0 });
  const two = predict({ ...input, goal: { ...input.goal, totalRequired: done + 20 } }, smallConfig);
  const samples = samplePosterior(two.posterior, smallConfig.samples, smallConfig.seed);
  // DONE起点から最初の将来DONEへ到達する確率を、独立した閉形式で求める。
  const quantile = q => {
    for (let day = 1; day <= smallConfig.horizonDays; day++) {
      const cdf = 1 - samples.reduce((sum, s) => sum + (1 - s.a) * (1 - s.b) ** (day - 1), 0) / samples.length;
      if (cdf >= q - 1e-12) return day;
    }
    return null;
  };
  assert.deepEqual(completionValues(two.completion), { status: 'available', scenario: 'TODAY_DONE',
    p50Days: quantile(.5), p80Days: quantile(.8) });
  assert.equal(two.progress.done, done);
});

test('T-09/T-10: goal monotonicity and horizon nulls with fixed posterior draws', () => {
  const input = { ...todayDoneInput, today: '2026-10-04' };
  const order = value => value === null ? Infinity : value;
  let previous = { p50Days: 0, p80Days: 0 };
  for (const totalRequired of [8, 17, 27, 47, 97, 607, 617]) {
    const result = predict({ ...input, goal: { ...input.goal, totalRequired } }, smallConfig).completion;
    assert.equal(result.status, 'available');
    assert.ok(order(result.p50Days) >= order(previous.p50Days));
    assert.ok(order(result.p80Days) >= order(previous.p80Days));
    assert.ok(order(result.p80Days) >= order(result.p50Days));
    previous = result;
  }
  assert.equal(previous.p50Days, null);
  assert.equal(previous.p80Days, null);
  previous = { p50Days: null, p80Days: null };
  for (const initialProgress of [0, 10, 20, 30, 40]) {
    const result = predict({ ...input, goal: { ...input.goal, totalRequired: 100, initialProgress } }, smallConfig).completion;
    assert.equal(result.status, 'available');
    assert.ok(order(result.p50Days) <= order(previous.p50Days));
    assert.ok(order(result.p80Days) <= order(previous.p80Days));
    previous = result;
  }
});

test('T-12: CURRENT_STATE first-future-DONE quantiles match an independent closed CDF', () => {
  for (const status of ['DONE', 'SKIPPED']) {
    const input = { ...todayDoneInput, logs: [
      ...todayDoneInput.logs.slice(0, -1), log(todayDoneInput.today, status, status === 'DONE' ? 3 : null),
    ] };
    input.goal = { ...input.goal, totalRequired: status === 'DONE' ? 17 : 14 };
    const result = predict(input, smallConfig);
    const samples = samplePosterior(result.posterior, smallConfig.samples, smallConfig.seed);
    const quantile = q => {
      for (let day = 1; day <= smallConfig.horizonDays; day++) {
        const tail = samples.reduce((sum, s) =>
          sum + (1 - (status === 'DONE' ? s.a : s.b)) * (1 - s.b) ** (day - 1), 0) / samples.length;
        if (1 - tail >= q - 1e-12) return day;
      }
      return null;
    };
    assert.deepEqual(completionValues(result.completion), { status: 'available', scenario: 'CURRENT_STATE',
      p50Days: quantile(.5), p80Days: quantile(.8) });
  }
});

test('T-11/T-12: priority completed > today recorded > insufficient; never publish prior-only completion', () => {
  const empty = { goal, logs: [], today: '2026-10-03' };
  const cases = [
    [empty, 'insufficient', 'NO_DONE_ORIGIN_TRANSITION'],
    [{ ...empty, logs: [log(empty.today, 'SKIPPED')] }, 'not_applicable', 'NO_DONE_ORIGIN_TRANSITION'],
    [{ ...empty, logs: [log('2026-10-01', 'DONE'), log('2026-10-02', 'DONE')] }, 'insufficient', 'NO_SKIP_ORIGIN_TRANSITION'],
    [{ ...empty, logs: [log('2026-10-01', 'SKIPPED'), log('2026-10-02', 'SKIPPED')] }, 'available', 'NO_DONE_ORIGIN_TRANSITION'],
  ];
  for (const [input, coreStatus, completionReason] of cases) {
    const result = predict(input, smallConfig);
    assert.equal(result.coreMetric.status, coreStatus);
    assert.deepEqual(result.completion, { status: 'insufficient', reason: completionReason });
  }
  for (const status of ['UNRECORDED', 'DONE', 'SKIPPED']) {
    const input = { ...empty, goal: { ...goal, initialProgress: 20 },
      logs: status === 'UNRECORDED' ? [] : [log(empty.today, status)] };
    const result = predict(input, smallConfig);
    assert.deepEqual(result.coreMetric, { status: 'not_applicable', reason: 'COMPLETED' });
    assert.deepEqual(result.completion, { status: 'completed' });
  }
  const todaySkipped = predict({ ...todayDoneInput, logs: [
    ...todayDoneInput.logs.slice(0, -1), log(todayDoneInput.today, 'SKIPPED'),
  ] }, smallConfig);
  assert.equal(todaySkipped.completion.scenario, 'CURRENT_STATE');
  const samples = samplePosterior(todaySkipped.posterior, smallConfig.samples, smallConfig.seed);
  assert.deepEqual(completionValues(todaySkipped.completion), { status: 'available', scenario: 'CURRENT_STATE',
    ...mixtureCompletionQuantiles(samples, 'SKIPPED', 2, smallConfig.horizonDays) });
});

test('T-13: future and duplicate errors precede completed; invalid quantities/calendar/status reject', () => {
  const completed = { goal: { ...goal, initialProgress: 20 }, today: '2026-10-03', logs: [] };
  for (const logs of [
    [log('2026-10-04', 'DONE')], [log('2026-10-03', 'DONE'), log('2026-10-03', 'SKIPPED')],
    [log('2026-02-29', 'DONE')], [log('1900-02-29', 'DONE')], [log('0000-01-01', 'DONE')],
    [log('2026-13-01', 'DONE')], [log('2026-10-00', 'DONE')], [log('2026-1-01', 'DONE')],
    [log('2026-10-01', 'DONE', null)], [log('2026-10-01', 'DONE', 0)],
    [log('2026-10-01', 'SKIPPED', 1)], [log('2026-10-01', 'UNKNOWN', null)],
  ]) assert.throws(() => predict({ ...completed, logs }, smallConfig), RangeError);
  for (const field of ['totalRequired', 'initialProgress', 'sessionAmount']) {
    for (const value of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => predict({ ...completed, goal: { ...completed.goal, [field]: value } }, smallConfig), RangeError);
    }
  }
  assert.throws(() => predict({ ...completed, goal: { ...goal, initialProgress: Number.MAX_SAFE_INTEGER },
    logs: [log('2026-10-03', 'DONE')] }, smallConfig), RangeError);
});

test('integer ceil and technical config errors remain separate from HTTP error mapping', () => {
  const input = { ...todayDoneInput, goal: { totalRequired: Number.MAX_SAFE_INTEGER, initialProgress: 2,
    sessionAmount: 4503599627370494 } };
  const result = predict(input, { ...smallConfig, horizonDays: 1 });
  assert.equal(result.completion.p50Days, null); // 上限H=1日の間に将来DONE2回は実行できない。
  for (const changed of [
    { prior: 1.5 }, { samples: 0 }, { horizonDays: 0 }, { seed: -1 }, { seed: 2 ** 32 },
    { modelVersion: 'unimplemented-model' },
  ]) assert.throws(() => predict(todayDoneInput, { ...smallConfig, ...changed }), RangeError);
  assert.equal(predict(todayDoneInput, { ...smallConfig, prior: 1 }).posterior.a.alpha, 1);
});

// 新しい方式metadataは専用契約テストで検査し、既存の日数・状態の期待値を保持する。
function completionValues({ computation, ...values }) { return values; }
