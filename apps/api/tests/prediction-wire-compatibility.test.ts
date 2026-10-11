import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Value } from '@sinclair/typebox/value';
import { Type } from '@sinclair/typebox';
import { predict, DEFAULT_CONFIG } from '@futureroi/prediction';
import { Today } from '../src/contracts/log.ts';
import { TodayR11 } from '../src/contracts/r11.ts';
import { toPublicCompletion } from '../src/prediction/engine.ts';

test('旧strict公開DTOは閉形式・sampling・fallbackを受理し、実方式metadataを内部だけに保つ', async () => {
  const input = { goal: { totalRequired: 10, initialProgress: 0, sessionAmount: 1 }, today: '2026-10-07',
    logs: ['DONE','DONE','SKIPPED','SKIPPED','DONE','SKIPPED'].map((status, i) => ({
      localDate: `2026-10-0${i + 1}`, status: status as 'DONE' | 'SKIPPED', amount: status === 'DONE' ? 1 : null,
    })) };
  for (const mode of ['auto','sampled','fallback'] as const) {
    const config = { ...DEFAULT_CONFIG, samples: 8, seed: 123, horizonDays: mode === 'fallback' ? 1096 : 30,
      completionMethod: mode === 'sampled' ? 'sampled' as const : 'auto' as const };
    const result = predict(input, config);
    assert.equal(result.completion.status, 'available');
    if (result.completion.status !== 'available') throw new Error('Expected synthetic available result');
    assert.deepEqual(result.completion.computation, mode === 'auto'
      ? { method: 'BETA_BINOMIAL', samples: null, seed: null, fallbackReason: null }
      : { method: 'POSTERIOR_SAMPLING', samples: 8, seed: 123,
          fallbackReason: mode === 'fallback' ? 'HORIZON_OUT_OF_RANGE' : null });
    const publicResult = { ...result, completion: toPublicCompletion(result.completion) };
    const today = { today: input.today, yesterday: '2026-10-06', todayLog: null, yesterdayMissing: false, prediction: publicResult };
    const { prior: _prior, ...r11Config } = result.config;
    const r11 = { ...today, schemaVersion: 'r11-v1', prediction: { ...publicResult, config: r11Config },
      context: { recordStartDate: '2026-10-01', unit: 'sessions', sessionAmount: 1, goalSettingsRevision: 0,
        answerRevision: 0, unitLocked: true }, provenance: { a: 'RECORDS', b: 'RECORDS' }, plan: null };
    const app = Fastify();
    try {
      app.get('/legacy', { schema: { response: { 200: Today } } }, () => today);
      app.get('/r11', { schema: { response: { 200: TodayR11 } } }, () => r11);
      const union = Type.Union([TodayR11, Today]);
      app.get('/legacy-union', { schema: { response: { 200: union } } }, () => today);
      app.get('/r11-union', { schema: { response: { 200: union } } }, () => r11);
      for (const [path, schema] of [['/legacy', Today], ['/r11', TodayR11], ['/legacy-union', Today], ['/r11-union', TodayR11]] as const) {
        const response = await app.inject({ method: 'GET', url: path });
        assert.equal(response.statusCode, 200);
        const dto = response.json();
        assert.ok(Value.Check(schema, dto), `${mode}/${path}: legacy strict schema`);
        if (dto.prediction.completion.status !== 'available') throw new Error('Expected available wire branch');
        assert.deepEqual(Object.keys(dto.prediction.completion).sort(), ['p50Days','p80Days','scenario','status']);
        assert.deepEqual([dto.prediction.completion.p50Days, dto.prediction.completion.p80Days],
          [result.completion.p50Days, result.completion.p80Days]);
        // 要求設定のechoは抽出の実使用証明ではない。実使用値は上で別に検査した。
        assert.equal(dto.prediction.config.samples, 8); assert.equal(dto.prediction.config.seed, 123);
      }
    } finally { await app.close(); }
  }
});
