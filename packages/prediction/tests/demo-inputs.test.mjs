import test from 'node:test';
import assert from 'node:assert/strict';
import { predict, DEFAULT_CONFIG } from '../dist/src/index.js';
import { demoInputs } from '../examples/demo-inputs.mjs';

test('Demo handoff: two 30-day synthetic inputs isolate resumption patterns with equal actual progress', () => {
  assert.deepEqual(demoInputs.map(row => row.name), ['fast-resumption', 'slow-resumption']);
  const expected = [
    { counts: { nDD: 0, nDS: 15, nSD: 14, nSS: 0 }, g50: 1, g80: 1 },
    { counts: { nDD: 14, nDS: 1, nSD: 0, nSS: 14 }, g50: 7, g80: 21 },
  ];
  const results = demoInputs.map(({ input }, index) => {
    const row = expected[index];
    assert.equal(input.today, '2026-10-01');
    assert.equal(input.logs.length, 30);
    assert.deepEqual(input.logs.map(log => log.localDate),
      Array.from({ length: 30 }, (_, day) => `2026-09-${String(day + 1).padStart(2, '0')}`));
    assert.equal(input.logs.filter(log => log.status === 'DONE').length, 15);
    assert.ok(input.logs.every(log => log.amount === (log.status === 'DONE' ? 1 : null)));
    const result = predict(input);
    for (const [key, value] of Object.entries(row.counts)) {
      assert.equal(result.observations[key], value);
    }
    assert.equal(result.observations.effectiveTransitions, 29);
    assert.equal(result.observations.observedDays, 30);
    assert.equal(result.observations.recordedDays, 30);
    assert.equal(result.todayStatus, 'UNRECORDED');
    assert.deepEqual(result.progress, { done: 15, total: 60, completed: false });
    // fastのb~Beta(16,2)：1日目の累積確率16/18が50%・80%の両閾値を超える。
    // slowのb~Beta(2,16)：尾の確率16*17/((16+t)*(17+t))から、最初の到達日は7日・21日。
    assert.deepEqual(result.coreMetric, { status: 'available', g50: row.g50, g80: row.g80 });
    assert.equal(result.completion.status, 'available');
    assert.equal(result.completion.scenario, 'TODAY_DONE');
    assert.equal(typeof result.completion.p50Days, 'number');
    assert.equal(typeof result.completion.p80Days, 'number');
    assert.deepEqual(result.config, { prior: 2, samples: 200, horizonDays: 1095, seed: 20261012 });
    assert.equal(result.modelVersion, DEFAULT_CONFIG.modelVersion);
    // 内部入力をJSONへ変換して戻したときの再現性を確認する。HTTP DTOの採択ではない。
    assert.deepEqual(predict(JSON.parse(JSON.stringify(input))), result);
    return result;
  });
  assert.deepEqual(demoInputs[0].input.goal, demoInputs[1].input.goal);
  assert.notEqual(results[0].completion.p50Days, results[1].completion.p50Days);
  assert.notEqual(results[0].completion.p80Days, results[1].completion.p80Days);
});
