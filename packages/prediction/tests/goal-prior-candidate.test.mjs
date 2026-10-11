import test from 'node:test';
import assert from 'node:assert/strict';
import * as publicEngine from '../dist/src/index.js';
import { evaluateGoalPriorCandidate } from '../dist/src/goal-prior-candidate.js';
import { samplePosterior } from '../dist/src/random.js';
import { mixtureCompletionQuantiles } from '../dist/src/completion.js';
import { unknownGapInput, todayDoneInput } from '../dist/tests/fixtures.js';
import { cases } from '../examples/recalculate.mjs';

const { predict, DEFAULT_CONFIG, PredictionConfigError } = publicEngine;
// 従来のseeded数値回帰は明示sampledで保持し、autoは独立oracleで検証する。
const smallConfig = { ...DEFAULT_CONFIG, samples: 24, horizonDays: 60, completionMethod: 'sampled' };
const parameter = (alpha, beta, source = 'synthetic-test', version = 'fixture-v1') => ({ alpha, beta, source, version });
const prior = () => ({ a: parameter(3, 7), b: parameter(5, 11) });
const log = (day, status, amount = status === 'DONE' ? 1 : null) => ({
  localDate: `2026-10-${String(day).padStart(2, '0')}`, status, amount,
});

test('candidate: symmetric default prior reproduces all 11 existing connection calculations', () => {
  for (const { input } of cases) {
    const snapshot = { a: parameter(2, 2), b: parameter(2, 2) };
    const { priorSnapshot, ...calculation } = evaluateGoalPriorCandidate(input, snapshot);
    assert.deepEqual({ ...calculation, config: { prior: 2, ...calculation.config } }, predict(input));
    assert.deepEqual(priorSnapshot, snapshot);
  }
  assert.equal(DEFAULT_CONFIG.prior, 2);
  assert.equal('evaluateGoalPriorCandidate' in publicEngine, false);
  for (const scalar of [1, 3, 7]) {
    const config = { ...smallConfig, prior: scalar };
    const { priorSnapshot, ...calculation } = evaluateGoalPriorCandidate(unknownGapInput,
      { a: parameter(scalar, scalar), b: parameter(scalar, scalar) }, config);
    assert.deepEqual({ ...calculation, config: { prior: scalar, ...calculation.config } }, predict(unknownGapInput, config));
    assert.equal(priorSnapshot.a.alpha, scalar);
  }
});

test('candidate: DD/DS update a and SD/SS update b independently; UNKNOWN adds no pairs or prior observations', () => {
  const result = evaluateGoalPriorCandidate(unknownGapInput, prior(), smallConfig);
  assert.deepEqual(result.posterior, { a: { alpha: 4, beta: 8 }, b: { alpha: 6, beta: 12 } });
  assert.deepEqual(result.observations, { nDD: 1, nDS: 1, nSD: 1, nSS: 1,
    effectiveTransitions: 4, observedDays: 7, recordedDays: 6 });
  assert.deepEqual(result.progress, predict(unknownGapInput, smallConfig).progress);
});

test('candidate: prior-only and one-origin histories keep existing insufficient and terminal precedence', () => {
  for (const { input } of cases) {
    const result = evaluateGoalPriorCandidate(input, prior(), smallConfig);
    const legacy = predict(input, smallConfig);
    assert.deepEqual(result.progress, legacy.progress);
    assert.deepEqual(result.observations, legacy.observations);
    assert.equal(result.coreMetric.status, legacy.coreMetric.status);
    assert.equal(result.completion.status, legacy.completion.status);
    if (legacy.coreMetric.status !== 'available') assert.deepEqual(result.coreMetric, legacy.coreMetric);
    if (legacy.completion.status !== 'available') assert.deepEqual(result.completion, legacy.completion);
  }
  // 未回答の数値対応を新設せず、候補を渡さない既存入口の共通priorと実績起点を固定する。
  const empty = { ...unknownGapInput, logs: [] };
  const unanswered = predict(empty, smallConfig);
  assert.deepEqual(unanswered.posterior, { a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } });
  assert.equal(unanswered.observations.recordedDays, 0);
  assert.equal(unanswered.observations.effectiveTransitions, 0);
  assert.equal('priorSnapshot' in unanswered, false);
  assert.deepEqual(unanswered.coreMetric, { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' });
  assert.deepEqual(unanswered.completion, { status: 'insufficient', reason: 'NO_DONE_ORIGIN_TRANSITION' });
});

test('candidate: backfill/correction recomputes from the original snapshot without accumulation', () => {
  const input = { goal: { totalRequired: 100, initialProgress: 0, sessionAmount: 10 },
    today: '2026-10-04', logs: [log(1, 'DONE', 10), log(3, 'SKIPPED')] };
  const snapshot = prior();
  const original = evaluateGoalPriorCandidate(input, snapshot, smallConfig);
  assert.deepEqual(original.posterior, { a: { alpha: 3, beta: 7 }, b: { alpha: 5, beta: 11 } });
  const backfill = { ...input, logs: [...input.logs, log(2, 'DONE', 20)] };
  const coldLegacy = predict(backfill, smallConfig);
  const filled = evaluateGoalPriorCandidate(backfill, snapshot, smallConfig);
  assert.deepEqual(filled.posterior.a, { alpha: 4, beta: 8 });
  assert.equal(filled.progress.done, 30);
  assert.deepEqual(evaluateGoalPriorCandidate(backfill, snapshot, smallConfig), filled);
  const corrected = evaluateGoalPriorCandidate({ ...input, logs: [...input.logs, log(2, 'SKIPPED')] }, snapshot, smallConfig);
  assert.deepEqual(corrected.posterior, { a: { alpha: 3, beta: 8 }, b: { alpha: 5, beta: 12 } });
  assert.equal(corrected.progress.done, 10);
  assert.deepEqual(evaluateGoalPriorCandidate(input, snapshot, smallConfig), original);
  const edited = { ...snapshot, a: parameter(9, 2, 'edited-synthetic', 'fixture-v2') };
  assert.deepEqual(evaluateGoalPriorCandidate(backfill, edited, smallConfig).posterior.a, { alpha: 10, beta: 3 });
  assert.deepEqual(evaluateGoalPriorCandidate(backfill, snapshot, smallConfig), filled);
  // 候補計算後も元の公開入口へ戻れる。回答の削除APIや表示条件をここで採択しない。
  assert.deepEqual(predict(backfill, smallConfig), coldLegacy);
  assert.deepEqual(coldLegacy.posterior, { a: { alpha: 3, beta: 3 }, b: { alpha: 2, beta: 2 } });
});

test('candidate: recorded today actual amount stays 7; DP begins with zero future DONEs', () => {
  const result = evaluateGoalPriorCandidate(todayDoneInput, prior(), smallConfig);
  assert.equal(result.progress.done, 7);
  assert.deepEqual(result.coreMetric, { status: 'not_applicable', reason: 'TODAY_RECORDED' });
  const samples = samplePosterior(result.posterior, smallConfig.samples, smallConfig.seed);
  assert.deepEqual(completionValues(result.completion), { status: 'available', scenario: 'CURRENT_STATE',
    ...mixtureCompletionQuantiles(samples, 'DONE', 2, smallConfig.horizonDays) });
  assert.notEqual(result.completion.p50Days,
    mixtureCompletionQuantiles(samples, 'DONE', 1, smallConfig.horizonDays).p50Days);
});

test('candidate: asymmetric recovery boundaries match an independent integer-alpha survival identity', () => {
  // P(G>t)=Π_{j<alpha}(beta+j)/(beta+t+j)。productionのt方向の漸化式とは別の式で照合する。
  const quantiles = (alpha, beta) => {
    const first = factor => {
      for (let t = 1; ; t++) {
        let numerator = 1n, denominator = 1n;
        for (let j = 0; j < alpha; j++) {
          numerator *= BigInt(beta + j); denominator *= BigInt(beta + t + j);
        }
        if (factor * numerator <= denominator) return t;
      }
    };
    return { status: 'available', g50: first(2n), g80: first(5n) };
  };
  const input = { goal: { totalRequired: 100, initialProgress: 0, sessionAmount: 1 },
    today: '2026-10-03', logs: [log(1, 'SKIPPED'), log(2, 'DONE')] };
  for (const alpha of [1, 2, 3, 4, 7]) for (const beta of [1, 2, 4, 5, 8, 12]) {
    const result = evaluateGoalPriorCandidate(input, { a: parameter(2, 2), b: parameter(alpha, beta) }, smallConfig);
    assert.deepEqual(result.coreMetric, quantiles(alpha + 1, beta));
  }
  const result = evaluateGoalPriorCandidate(input, { a: parameter(2, 2), b: parameter(4, 5) }, smallConfig);
  assert.equal(result.coreMetric.g50, 1);
});

test('candidate: source/version are detached provenance and do not alter counts or seeded draws', () => {
  const snapshot = prior(), before = structuredClone(snapshot), input = structuredClone(unknownGapInput);
  const result = evaluateGoalPriorCandidate(input, snapshot, smallConfig);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(input, unknownGapInput);
  assert.deepEqual(evaluateGoalPriorCandidate(input, snapshot, smallConfig), result);
  const relabel = { a: { ...snapshot.a, source: 'another-label', version: 'fixture-v9' }, b: snapshot.b };
  const changed = evaluateGoalPriorCandidate(input, relabel, smallConfig);
  assert.deepEqual(changed.posterior, result.posterior);
  assert.deepEqual(changed.coreMetric, result.coreMetric);
  assert.deepEqual(changed.completion, result.completion);
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  const frozenPrior = freeze(structuredClone(snapshot));
  const frozenInput = freeze(structuredClone(input));
  const frozenConfig = freeze(structuredClone(smallConfig));
  assert.deepEqual(evaluateGoalPriorCandidate(frozenInput, frozenPrior, frozenConfig), result);
  for (const seed of [0, 1, 0xffffffff]) {
    const config = { ...smallConfig, seed };
    const first = evaluateGoalPriorCandidate(frozenInput, frozenPrior, config);
    evaluateGoalPriorCandidate(frozenInput, { a: parameter(20, 1), b: parameter(2, 8) }, config);
    assert.deepEqual(evaluateGoalPriorCandidate(frozenInput, frozenPrior, config), first);
    const samples = samplePosterior(first.posterior, config.samples, seed);
    assert.deepEqual(completionValues(first.completion), { status: 'available', scenario: 'TODAY_DONE',
      ...mixtureCompletionQuantiles(samples, 'DONE', 3, config.horizonDays) });
    assert.equal(first.config.seed, seed);
  }
  assert.notDeepEqual(samplePosterior(result.posterior, 3, 0), samplePosterior(result.posterior, 3, 0xffffffff));
  result.priorSnapshot.a.alpha = 999;
  result.priorSnapshot.b.source = 'mutated-output';
  assert.deepEqual(snapshot, before);
  assert.deepEqual(evaluateGoalPriorCandidate(input, snapshot, smallConfig).priorSnapshot, before);
  assert.equal('prior' in changed.config, false);
});

test('candidate: unsupported shape domain, missing parameters and incomplete provenance fail explicitly', () => {
  for (const name of ['a', 'b']) for (const shape of ['alpha', 'beta']) {
    for (const invalid of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) {
      const snapshot = prior(); snapshot[name][shape] = invalid;
      assert.throws(() => evaluateGoalPriorCandidate(unknownGapInput, snapshot, smallConfig), RangeError);
    }
  }
  for (const invalid of [undefined, null, {}, { a: prior().a }, { b: prior().b }, { ...prior(), b: null }]) {
    assert.throws(() => evaluateGoalPriorCandidate(unknownGapInput, invalid, smallConfig), TypeError);
  }
  for (const name of ['a', 'b']) for (const field of ['source', 'version']) {
    for (const invalid of ['', '  ', undefined, 2]) {
      const snapshot = prior(); snapshot[name][field] = invalid;
      assert.throws(() => evaluateGoalPriorCandidate(unknownGapInput, snapshot, smallConfig), TypeError);
    }
  }
  assert.throws(() => evaluateGoalPriorCandidate(unknownGapInput,
    { ...prior(), a: parameter(Number.MAX_SAFE_INTEGER, 2) }, smallConfig),
  error => error instanceof PredictionConfigError && error.reason === 'UNSAFE_POSTERIOR');
  for (const name of ['a', 'b']) for (const shape of ['alpha', 'beta']) {
    const snapshot = prior(); snapshot[name][shape] = Number.MAX_SAFE_INTEGER;
    const zeroCounts = evaluateGoalPriorCandidate({ ...unknownGapInput, logs: [] }, snapshot, smallConfig);
    assert.equal(zeroCounts.posterior[name][shape], Number.MAX_SAFE_INTEGER);
    assert.throws(() => evaluateGoalPriorCandidate(unknownGapInput, snapshot, smallConfig),
      error => error instanceof PredictionConfigError && error.reason === 'UNSAFE_POSTERIOR' &&
        JSON.stringify(error.path) === JSON.stringify(['posterior', name, shape]));
  }
});

test('candidate: independent a changes completion but not b-driven core; source remains actual snapshot', () => {
  const snapshot = prior();
  const one = evaluateGoalPriorCandidate(unknownGapInput, snapshot, smallConfig);
  const two = evaluateGoalPriorCandidate(unknownGapInput, { ...snapshot, a: parameter(20, 1) }, smallConfig);
  assert.deepEqual(two.coreMetric, one.coreMetric);
  assert.notDeepEqual(two.completion, one.completion);
  assert.deepEqual(two.posterior.b, one.posterior.b);
});

// 新しい方式metadataは専用契約テストで検査し、既存の日数・状態の期待値を保持する。
function completionValues({ computation, ...values }) { return values; }
