import assert from 'node:assert/strict';
import test from 'node:test';
import { predict, predictWithQuestionPrior, QuestionPriorError } from '../dist/src/index.js';

const mapping = { version: 'r11-strength4-v1', values: { LOW: { alpha: 1, beta: 3 }, MID: { alpha: 2, beta: 2 }, HIGH: { alpha: 3, beta: 1 } } };
const prediction = { goal: { totalRequired: 100, initialProgress: 0, sessionAmount: 10 }, logs: [], today: '2026-10-07' };

test('公開R-11: 未回答とUNKNOWNは材料ではなく、MIDは同じBetaでも材料になる', () => {
  const empty = predictWithQuestionPrior({ prediction, answers: { a: null, b: 'UNKNOWN' }, mapping });
  assert.deepEqual(empty.provenance, { a: 'NONE', b: 'NONE' });
  assert.equal(empty.prediction.completion.status, 'insufficient');
  assert.deepEqual(empty.plan, { remainingAmount: 100, remainingSessions: 10, lastSessionAmount: 10 });
  const answered = predictWithQuestionPrior({ prediction, answers: { a: 'MID', b: 'MID' }, mapping });
  assert.deepEqual(answered.prediction.posterior, empty.prediction.posterior);
  assert.deepEqual(answered.provenance, { a: 'QUESTION', b: 'QUESTION' });
  assert.equal(answered.prediction.completion.status, 'available');
  assert.equal(answered.plan, null);
  assert.equal(answered.prediction.modelVersion, 'm1-question-prior-v1');
  assert.ok(!Object.hasOwn(answered.prediction.config, 'prior'));
  for (const key of ['rawAnswers', 'mappingVersion', 'priorSnapshot']) assert.ok(!Object.hasOwn(answered.prediction, key));
  assert.equal(predict(prediction).completion.status, 'insufficient', '旧predictの材料条件は変えない');
});

test('公開R-11: 実記録の遷移を一度だけ足し、回答と記録の由来を別々に示す', () => {
  const logs = [
    { localDate: '2026-10-02', status: 'DONE', amount: 7 },
    { localDate: '2026-10-03', status: 'DONE', amount: 9 },
    { localDate: '2026-10-04', status: 'SKIPPED', amount: null },
    { localDate: '2026-10-05', status: 'SKIPPED', amount: null },
    { localDate: '2026-10-06', status: 'DONE', amount: 13 },
  ];
  const result = predictWithQuestionPrior({ prediction: { ...prediction, logs }, answers: { a: 'HIGH', b: 'UNKNOWN' }, mapping });
  assert.deepEqual(result.provenance, { a: 'QUESTION_AND_RECORDS', b: 'RECORDS' });
  assert.deepEqual(result.prediction.posterior, { a: { alpha: 4, beta: 2 }, b: { alpha: 3, beta: 3 } });
  assert.equal(result.prediction.progress.done, 29);
  assert.equal(result.plan, null);
  assert.deepEqual(result, predictWithQuestionPrior({ prediction: { ...prediction, logs }, answers: { a: 'HIGH', b: 'UNKNOWN' }, mapping }), '再計算でposteriorをpriorへ戻さない');
});

test('公開R-11: 達成と今日記録済みの優先順位、残量のPlanを保つ', () => {
  const completed = predictWithQuestionPrior({ prediction: { ...prediction, goal: { ...prediction.goal, initialProgress: 100 } }, answers: { a: 'HIGH', b: 'HIGH' }, mapping });
  assert.deepEqual(completed.prediction.coreMetric, { status: 'not_applicable', reason: 'COMPLETED' });
  assert.equal(completed.plan, null);
  const recorded = predictWithQuestionPrior({ prediction: { ...prediction, logs: [{ localDate: prediction.today, status: 'DONE', amount: 13 }] }, answers: { a: null, b: 'LOW' }, mapping });
  assert.deepEqual(recorded.prediction.coreMetric, { status: 'not_applicable', reason: 'TODAY_RECORDED' });
  assert.deepEqual(recorded.provenance, { a: 'NONE', b: 'QUESTION' });
  assert.deepEqual(recorded.plan, { remainingAmount: 87, remainingSessions: 9, lastSessionAmount: 7 });
});

test('公開R-11: rawの不正は構造化した公開例外で失敗する', () => {
  assert.throws(() => predictWithQuestionPrior({ prediction, answers: { a: 'INVALID', b: null }, mapping }), error =>
    error instanceof QuestionPriorError && error.kind === 'input' && error.reason === 'INVALID_ANSWER' && error.path.join('/') === 'answers/a');
});

test('公開R-11: 公開key順と状態別の形を固定し、内部候補の追加項目を公開しない', () => {
  const config = { modelVersion: 'behavior-persistence-m1-v1', samples: 8, horizonDays: 20, seed: 20261012 };
  for (const [answers, source] of [
    [{ a: null, b: 'UNKNOWN' }, { a: 'NONE', b: 'NONE' }],
    [{ a: 'HIGH', b: 'MID' }, { a: 'QUESTION', b: 'QUESTION' }],
  ]) {
    for (const input of [prediction,
      { ...prediction, goal: { ...prediction.goal, initialProgress: 100 } },
      { ...prediction, logs: [{ localDate: prediction.today, status: 'DONE', amount: 13 }] }]) {
      const result = predictWithQuestionPrior({ prediction: input, answers, mapping }, config);
      assert.deepEqual(Object.keys(result), ['prediction', 'provenance', 'plan']);
      assert.deepEqual(Object.keys(result.prediction), ['modelVersion', 'today', 'todayStatus', 'progress',
        'observations', 'posterior', 'coreMetric', 'completion', 'config']);
      assert.deepEqual(Object.keys(result.prediction.config), ['samples', 'horizonDays', 'seed']);
      assert.deepEqual(result.provenance, source);
      assert.deepEqual(Object.keys(result.prediction.completion), result.prediction.completion.status === 'available'
        ? ['status', 'scenario', 'p50Days', 'p80Days', 'computation']
        : result.prediction.completion.status === 'completed' ? ['status'] : ['status', 'reason']);
      if (result.plan !== null) {
        assert.deepEqual(Object.keys(result.plan), ['remainingAmount', 'remainingSessions', 'lastSessionAmount']);
      }
    }
  }
});
