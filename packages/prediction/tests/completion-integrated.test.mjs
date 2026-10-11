import assert from 'node:assert/strict';
import test from 'node:test';
import { predict, predictWithQuestionPrior, DEFAULT_CONFIG, PredictionConfigError } from '../dist/src/index.js';
import { integratedCompletionCdf, completionQuantiles, exactIntegratedReached } from '../dist/src/completion-integrated.js';
import { recoveryQuantiles } from '../dist/src/recovery.js';

// Beta-binomial recurrenceとは別の全Markov経路と独立Beta整数moments。
// 小さいhorizonだけに限定し、閾値・開始状態・巨大shapeをBigIntで照合する。
function moment(alpha, beta, successes, failures) {
  let numerator = 1n, denominator = 1n;
  for (let i = 0; i < successes; i++) numerator *= BigInt(alpha) + BigInt(i);
  for (let i = 0; i < failures; i++) numerator *= BigInt(beta) + BigInt(i);
  for (let i = 0; i < successes + failures; i++) denominator *= BigInt(alpha) + BigInt(beta) + BigInt(i);
  return Number(numerator) / Number(denominator);
}
function pathOracle(posterior, state, N, H) {
  let cdf = 0;
  function visit(day, previous, done, dd, ds, sd, ss) {
    if (day === H) {
      if (done >= N) cdf += moment(posterior.a.alpha, posterior.a.beta, dd, ds) *
        moment(posterior.b.alpha, posterior.b.beta, sd, ss);
      return;
    }
    visit(day + 1, 'DONE', done + 1, dd + Number(previous === 'DONE'), ds,
      sd + Number(previous === 'SKIPPED'), ss);
    visit(day + 1, 'SKIPPED', done, dd, ds + Number(previous === 'DONE'), sd,
      ss + Number(previous === 'SKIPPED'));
  }
  visit(0, state, 0, 0, 0, 0, 0);
  return cdf;
}
const posterior = { a: { alpha: 2, beta: 5 }, b: { alpha: 3, beta: 7 } };
const config = { ...DEFAULT_CONFIG, horizonDays: 9 };

test('integrated CDF: independent full paths cover both states, integer shapes and concentrated/skewed extremes', () => {
  for (const [aa, ab, ba, bb] of [[2,5,3,7], [1,1,1,1], [1,1e6,1e6,1], [1e6,1,1,1e6],
    [1e6,1e6,1e6,1e6], [3,999999,999999,3]]) {
    const p = { a: { alpha: aa, beta: ab }, b: { alpha: ba, beta: bb } };
    for (const state of ['DONE', 'SKIPPED']) for (const N of [1,2,4,9]) {
      const cdf = integratedCompletionCdf(p, state, N, 9);
      let previous = 0;
      for (let day = 0; day <= 9; day++) {
        const actual = cdf(day), expected = pathOracle(p, state, N, day);
        assert.ok(Math.abs(actual - expected) < 1e-10, `${aa},${ab},${ba},${bb}/${state}/${N}/${day}`);
        assert.ok(actual >= previous - 1e-10 && actual >= -1e-10 && actual <= 1 + 1e-10);
        previous = actual;
      }
    }
  }
});

test('auto: actual metadata and days are independent of requested samples/seed; R11 takes the same available branch', () => {
  const input = { goal: { totalRequired: 20, initialProgress: 0, sessionAmount: 3 }, today: '2026-10-05', logs: [
    { localDate: '2026-10-01', status: 'DONE', amount: 1 },
    { localDate: '2026-10-02', status: 'SKIPPED', amount: null },
    { localDate: '2026-10-03', status: 'SKIPPED', amount: null },
    { localDate: '2026-10-04', status: 'DONE', amount: 2 },
  ] };
  const expected = predict(input, config);
  assert.deepEqual(expected.completion.computation,
    { method: 'BETA_BINOMIAL', samples: null, seed: null, fallbackReason: null });
  for (const samples of [1,200,Number.MAX_SAFE_INTEGER]) for (const seed of [0,1,0xffffffff]) {
    const result = predict(input, { ...config, samples, seed });
    assert.deepEqual(result.completion, expected.completion);
    assert.deepEqual(result.coreMetric, expected.coreMetric);
    assert.equal(result.config.samples, samples); assert.equal(result.config.seed, seed);
  }
  const mapping = { version: 'synthetic-v1', values: {
    LOW: { alpha: 1, beta: 3 }, MID: { alpha: 2, beta: 2 }, HIGH: { alpha: 3, beta: 1 } } };
  const r11 = predictWithQuestionPrior({ prediction: { ...input, logs: [] },
    answers: { a: 'HIGH', b: 'HIGH' }, mapping }, config);
  assert.equal(r11.prediction.completion.status, 'available');
  assert.ok(r11.prediction.completion.computation);
  assert.equal(r11.plan, null);
});

test('explicit sampled and domain fallbacks expose actual draws; threshold ties use bounded exact comparisons', () => {
  const sampled = completionQuantiles(posterior, 'DONE', 2, { ...config, completionMethod: 'sampled' });
  assert.deepEqual(sampled.computation, { method: 'POSTERIOR_SAMPLING', samples: 200, seed: 20261012, fallbackReason: null });
  const threshold = completionQuantiles({ a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } }, 'DONE', 1, { ...config, horizonDays: 1 });
  assert.deepEqual([threshold.p50Days, threshold.p80Days, threshold.computation.method], [1,null,'BETA_BINOMIAL']);
  assert.equal(threshold.computation.samples, null);
  assert.equal(exactIntegratedReached({ a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } }, 'DONE', 1, 1, .5), true);
  assert.equal(exactIntegratedReached({ a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } }, 'DONE', 1, 1, .8), false);
  const symmetric = completionQuantiles({ a: { alpha: 1, beta: 1 }, b: { alpha: 1, beta: 1 } }, 'DONE', 548,
    { ...config, samples: 1, horizonDays: 1095 });
  assert.deepEqual([symmetric.p50Days, symmetric.p80Days, symmetric.computation.method], [1095,null,'BETA_BINOMIAL']);
  // 動機fixture: horizonの1日差でP80だけが範囲内になる。sampled fallbackで隠さない。
  const motivating = { a: { alpha: 16, beta: 3 }, b: { alpha: 2, beta: 16 } };
  for (const [horizonDays, p80Days] of [[192,null], [193,193]]) {
    const result = completionQuantiles(motivating, 'DONE', 44, { ...config, horizonDays });
    assert.deepEqual(result, { p50Days: 105, p80Days,
      computation: { method: 'BETA_BINOMIAL', samples: null, seed: null, fallbackReason: null } });
  }
  assert.throws(() => exactIntegratedReached({ a: { alpha: .5, beta: 1 }, b: { alpha: 1, beta: 1 } }, 'DONE', 1, 0, .5), RangeError);
  const horizon = completionQuantiles(posterior, 'DONE', 1, { ...config, horizonDays: 1096 });
  assert.equal(horizon.computation.fallbackReason, 'HORIZON_OUT_OF_RANGE');
  const shape = completionQuantiles({ ...posterior, a: { alpha: 1_000_001, beta: 2 } }, 'DONE', 1, config);
  assert.equal(shape.computation.fallbackReason, 'SHAPE_OUT_OF_RANGE');
  for (const result of [horizon,shape]) assert.deepEqual(
    [result.computation.method,result.computation.samples,result.computation.seed], ['POSTERIOR_SAMPLING',200,20261012]);
});

test('work budgets reject before huge sampled allocations; trivial completion retains no-draw paths', () => {
  const limited = changes => assert.throws(() => completionQuantiles(posterior, 'DONE', 1, { ...config, ...changes }),
    error => error instanceof PredictionConfigError && error.reason === 'RESOURCE_LIMIT' && error.path[0] === 'completion');
  limited({ horizonDays: Number.MAX_SAFE_INTEGER });
  limited({ samples: Number.MAX_SAFE_INTEGER, completionMethod: 'sampled' });
  // H/Kの単体上限内でもK*N*H=1.001e9を拒否し、積guard単独の欠落を検出する。
  assert.throws(() => completionQuantiles(posterior, 'DONE', 100,
    { ...config, horizonDays: 10_000, samples: 1001, completionMethod: 'sampled' }),
    error => error instanceof PredictionConfigError && error.reason === 'RESOURCE_LIMIT' && error.path[0] === 'completion');
  for (const N of [0,Number.MAX_SAFE_INTEGER]) {
    const result = completionQuantiles(posterior, 'DONE', N, { ...config, samples: Number.MAX_SAFE_INTEGER });
    assert.deepEqual(result.computation, { method: 'BOUNDARY', samples: null, seed: null, fallbackReason: null });
  }
  assert.throws(() => recoveryQuantiles(33,1_000_000), error => error instanceof PredictionConfigError && error.reason === 'RESOURCE_LIMIT');
  assert.throws(() => recoveryQuantiles(1,Number.MAX_SAFE_INTEGER), error => error instanceof PredictionConfigError && error.reason === 'RESOURCE_LIMIT');
  assert.deepEqual(recoveryQuantiles(1,1_000_000), { g50: 1_000_000, g80: 4_000_000 });
  assert.ok(recoveryQuantiles(2,10000).g80 > 1095);
  assert.throws(() => predict({ goal: { totalRequired: 1, initialProgress: 1, sessionAmount: 1 }, logs: [], today: '2026-10-10' },
    { ...config, completionMethod: 'unknown' }), error => error.reason === 'UNSUPPORTED_METHOD');
});
