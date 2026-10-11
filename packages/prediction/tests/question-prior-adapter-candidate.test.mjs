import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as publicEngine from '../dist/src/index.js';
import { evaluateQuestionPriorAdapterCandidate as rawEvaluateQuestionPriorAdapterCandidate, QuestionPriorAdapterCandidateError } from '../dist/src/question-prior-adapter-candidate.js';
import { evaluateGoalPriorCandidate } from '../dist/src/goal-prior-candidate.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures-pr118.json', import.meta.url), 'utf8'));
// PR118の固定seed数値を保持する比較経路。autoは別の独立oracleで検証する。
const evaluateQuestionPriorAdapterCandidate = (input, config = publicEngine.DEFAULT_CONFIG) =>
  rawEvaluateQuestionPriorAdapterCandidate(input, { ...config, completionMethod: 'sampled' });
const mapping = { version: fixtures.mappingCandidate.version, values: fixtures.mappingCandidate.values };
const request = fixture => ({ prediction: structuredClone(fixture.input), answers: structuredClone(fixture.answers), mapping: structuredClone(mapping) });
const evaluate = fixture => evaluateQuestionPriorAdapterCandidate(request(fixture), fixture.config);
const byId = id => fixtures.calculationExamples.find(x => x.id === id);

test('adapter candidate: all 18 PR118 examples connect raw input through posterior and evidence metadata', () => {
  for (const fixture of fixtures.calculationExamples) {
    const input = request(fixture), before = structuredClone(input);
    const result = evaluateQuestionPriorAdapterCandidate(input, fixture.config);
    for (const field of ['todayStatus', 'progress', 'observations', 'posterior', 'evidenceSource', 'eligible', 'coreMetric', 'conditionalPlan']) {
      assert.deepEqual(result[field], fixture.expected[field], `${fixture.id} ${field}`);
    }
    for (const field of ['status', 'reason', 'scenario', 'p50Days', 'p80Days']) {
      if (Object.hasOwn(fixture.expected.completion, field)) assert.deepEqual(result.completion[field], fixture.expected.completion[field]);
    }
    assert.deepEqual(result.rawAnswers, fixture.answers);
    assert.equal(result.mappingVersion, mapping.version);
    assert.deepEqual(input, before);
  }
  assert.equal('evaluateQuestionPriorAdapterCandidate' in publicEngine, false);
});

test('adapter candidate: 13 previously different gates have concrete center and completion expectations', () => {
  const center = (g50, g80) => ({ status: 'available', g50, g80 });
  const insufficient = reason => ({ status: 'insufficient', reason });
  const done = (p50Days, p80Days) => ({ status: 'available', scenario: 'TODAY_DONE', p50Days, p80Days });
  const noSkip = 'NO_SKIP_ORIGIN_TRANSITION', noDone = 'NO_DONE_ORIGIN_TRANSITION';
  const target = {
    F03: [center(1, 3), done(3, 6)], F04: [center(3, 12), insufficient(noDone)],
    F05: [insufficient(noSkip), insufficient(noSkip)], F06: [center(1, 2), done(4, 5)],
    F07: [center(3, 12), done(3, 11)], F08: [center(1, 2), done(2, 4)],
    F09: [center(2, 5), done(2, 4)], F10: [center(1, 1), done(2, 3)], F11: [center(1, 2), done(6, 7)],
    F14: [{ status: 'not_applicable', reason: 'TODAY_RECORDED' },
      { status: 'available', scenario: 'CURRENT_STATE', p50Days: 2, p80Days: 2 }],
    F15: [{ status: 'not_applicable', reason: 'TODAY_RECORDED' }, insufficient(noSkip)],
    F17: [center(1, 3), done(0, 0)], F18: [center(1, 2), done(null, null)],
  };
  for (const [id, expected] of Object.entries(target)) {
    const result = evaluate(byId(id));
    assert.deepEqual([result.coreMetric, completionValues(result.completion)], expected, id);
    const baseline = evaluateGoalPriorCandidate(byId(id).input, result.priorSnapshot, { ...byId(id).config, completionMethod: 'sampled' });
    assert.notDeepEqual([baseline.coreMetric, completionValues(baseline.completion)], expected, `${id} must retain the old independent entry`);
  }
  assert.deepEqual(completionValues(evaluate(byId('F13')).completion), done(4, 5));
});

test('adapter candidate: missing/UNKNOWN are not MID; material is determined per actual origin', () => {
  const empty = evaluate(byId('F01')), unknown = evaluate(byId('F02')), mid = evaluate(byId('F03'));
  assert.deepEqual(empty.posterior, mid.posterior);
  assert.deepEqual(empty.evidenceSource, { a: 'NONE', b: 'NONE' });
  assert.deepEqual(unknown.eligible, { a: false, b: false });
  assert.deepEqual(mid.evidenceSource, { a: 'QUESTION', b: 'QUESTION' });
  assert.deepEqual(mid.observations, empty.observations);
  assert.deepEqual(evaluate(byId('F07')).evidenceSource, { a: 'RECORDS', b: 'QUESTION' });
  assert.deepEqual(evaluate(byId('F09')).evidenceSource, { a: 'QUESTION', b: 'QUESTION_AND_RECORDS' });
  assert.deepEqual(evaluate(byId('F11')).observations.effectiveTransitions, 0);
  assert.deepEqual(evaluate(byId('F16')).completion, { status: 'completed' });
  // 未回答でも候補を一度呼ぶ案の根拠。出所・回数以外の既存計算はlegacyと同じ。
  for (const fixture of fixtures.calculationExamples) for (const raw of [null, 'UNKNOWN']) {
    const input = request(fixture); input.answers = { a: raw, b: raw };
    const candidate = evaluateQuestionPriorAdapterCandidate(input, fixture.config);
    const legacy = publicEngine.predict(input.prediction, { ...fixture.config, completionMethod: 'sampled' });
    for (const field of ['progress', 'todayStatus', 'observations', 'posterior', 'coreMetric', 'completion']) {
      assert.deepEqual(candidate[field], legacy[field], `${fixture.id} ${raw} ${field}`);
    }
  }
  assert.deepEqual(evaluate(byId('F15')).conditionalPlan, { remainingAmount: 40, remainingSessions: 3, lastSessionAmount: 10 });
  assert.equal(evaluate(byId('F17')).conditionalPlan.remainingSessions, 1);
  assert.equal(evaluate(byId('F17')).completion.p50Days, 0);
  for (const [goal, expected] of [
    [{ totalRequired: 100, initialProgress: 60, sessionAmount: 15 }, { remainingAmount: 40, remainingSessions: 3, lastSessionAmount: 10 }],
    [{ totalRequired: 100, initialProgress: 110, sessionAmount: 15 }, { remainingAmount: 0, remainingSessions: 0, lastSessionAmount: 0 }],
    [{ totalRequired: Number.MAX_SAFE_INTEGER, initialProgress: 0, sessionAmount: Number.MAX_SAFE_INTEGER - 1 },
      { remainingAmount: Number.MAX_SAFE_INTEGER, remainingSessions: 2, lastSessionAmount: 1 }],
  ]) {
    const input = request(byId('F01')); input.prediction.goal = goal;
    const result = evaluateQuestionPriorAdapterCandidate(input);
    assert.deepEqual(result.conditionalPlan, expected);
    assert.equal('conditionalPlan' in publicEngine.predict(input.prediction), false);
  }
});

test('adapter candidate: raw/mapping/real-log failures are classified without success fallback or HTTP decisions', () => {
  for (const [answers, reason, path] of [
    [null, 'INVALID_ANSWERS', ['answers']], [{}, 'INVALID_ANSWER', ['answers', 'a']],
    [{ a: null }, 'INVALID_ANSWER', ['answers', 'b']],
    [{ a: 'CERTAIN', b: 'LOW' }, 'INVALID_ANSWER', ['answers', 'a']],
    [{ a: undefined, b: null }, 'INVALID_ANSWER', ['answers', 'a']],
  ]) {
    assert.throws(() => evaluateQuestionPriorAdapterCandidate({ ...request(byId('F01')), answers }),
      error => error instanceof QuestionPriorAdapterCandidateError && error.kind === 'input' &&
        error.reason === reason && JSON.stringify(error.path) === JSON.stringify(path) && Object.isFrozen(error.path));
  }
  for (const [invalid, path] of [[null, ['mapping']], [{ version: '', values: mapping.values }, ['mapping']],
    [{ version: 'candidate', values: {} }, ['mapping', 'values', 'LOW']]]) {
    assert.throws(() => evaluateQuestionPriorAdapterCandidate({ ...request(byId('F01')), mapping: invalid }),
      error => error instanceof QuestionPriorAdapterCandidateError && error.kind === 'config' &&
        error.reason === 'INVALID_MAPPING' && JSON.stringify(error.path) === JSON.stringify(path));
  }
  for (const shape of ['alpha', 'beta']) for (const value of [0, -1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(mapping); invalid.values.LOW[shape] = value;
    // 未回答でも保存mappingの破損を成功fallbackへ変換しない。
    for (const id of ['F01', 'F04']) {
      assert.throws(() => evaluateQuestionPriorAdapterCandidate({ ...request(byId(id)), mapping: invalid }),
        error => error instanceof publicEngine.PredictionConfigError && error.reason === 'INVALID_INTEGER' &&
          JSON.stringify(error.path) === JSON.stringify(['mapping', 'values', 'LOW', shape]));
    }
  }
  const future = fixtures.negativeExamples.find(x => x.id === 'N03');
  assert.throws(() => evaluateQuestionPriorAdapterCandidate({ ...request(byId('F01')), prediction: future.input }), publicEngine.PredictionInputError);
});

test('adapter candidate: correction, clear, frozen input, output mutation and seed replay do not retain state', () => {
  const original = request(byId('F09')), corrected = { ...structuredClone(original), answers: { a: 'HIGH', b: 'HIGH' } };
  const first = evaluateQuestionPriorAdapterCandidate(original);
  assert.deepEqual(completionValues(evaluateQuestionPriorAdapterCandidate(corrected).completion), { status: 'available', scenario: 'TODAY_DONE', p50Days: 2, p80Days: 3 });
  assert.deepEqual(evaluateQuestionPriorAdapterCandidate(original), first);
  const clear = { ...structuredClone(original), answers: { a: null, b: null } };
  const cleared = evaluateQuestionPriorAdapterCandidate(clear);
  assert.deepEqual(cleared.eligible, { a: false, b: true });
  assert.deepEqual(cleared.evidenceSource, { a: 'NONE', b: 'RECORDS' });
  assert.deepEqual(cleared.progress, first.progress);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  assert.deepEqual(evaluateQuestionPriorAdapterCandidate(freeze(structuredClone(original))), first);
  first.rawAnswers.b = 'UNKNOWN'; first.priorSnapshot.b.alpha = 999;
  assert.equal(original.answers.b, 'LOW');
  assert.equal(evaluateQuestionPriorAdapterCandidate(original).priorSnapshot.b.alpha, 1);
  for (const seed of [0, 1, 0xffffffff]) {
    const config = { ...fixtures.configUnchanged, seed };
    const cold = evaluateQuestionPriorAdapterCandidate(original, config);
    evaluateQuestionPriorAdapterCandidate(corrected, config);
    assert.deepEqual(evaluateQuestionPriorAdapterCandidate(original, config), cold);
  }
});

// 新しい方式metadataは専用契約テストで検査し、既存の日数・状態の期待値を保持する。
function completionValues({ computation, ...values }) { return values; }
