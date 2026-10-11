import assert from 'node:assert/strict';
import test from 'node:test';
import { runQuestionPrediction, PredictionFailed } from '../src/prediction/engine.ts';

test('資源保護の計算エラーはAPI境界でPredictionFailedになり、成功・材料不足・horizon-nullにしない', () => {
  // HTTPは保存済みstrength4 mappingだけを許す。公開Engineの巨大mappingを
  // HTTPへ渡す経路を追加せず、transport境界の型付き分類を検証する。
  assert.throws(() => runQuestionPrediction({
    prediction: { goal: { totalRequired: 10, initialProgress: 0, sessionAmount: 1 },
      logs: [], today: '2026-10-10' },
    answers: { a: 'HIGH', b: 'HIGH' },
    mapping: { version: 'synthetic-boundary-only', values: {
      LOW: { alpha: 1, beta: 3 }, MID: { alpha: 2, beta: 2 }, HIGH: { alpha: 33, beta: 1_000_000 },
    } },
  }), error => error instanceof PredictionFailed && error.reason === 'RESOURCE_LIMIT' &&
    error.failureName === 'PredictionConfigError' && error.path[0] === 'coreMetric');
});
