import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, predict } from '@futureroi/prediction';
import type { Goal } from '../src/contracts/goal.ts';
import type { Today } from '../src/contracts/log.ts';
import { predictionResultSchemaMatchesEngine } from '../src/prediction/engine.ts';
import { setup, signedInClient } from './helpers/stack.ts';

// Today API（R-05〜R-08、#77）。応答の組み立て、yesterdayMissingの条件、Engineの`predict`との一致、記録後の再計算を確かめる。

const validGoal = { title: '英語 30分', unit: 'minutes', totalRequired: 100, sessionAmount: 10, timezone: 'Asia/Tokyo' } as const;
const tokyo = (day: number, hour = 15, minute = 30) => new Date(Date.UTC(2026, 9, day, hour, minute)); // 15:30Z = 翌日00:30 JST
// 内部computationは公開契約に含めず、日数・観測・設定などの全値を比較する。
function publicPrediction(result: ReturnType<typeof predict>) {
  if (result.completion.status !== 'available') return result;
  const { computation: _internal, ...completion } = result.completion;
  return { ...result, completion };
}

test('契約のPredictionResult schemaとEngineの型は双方向に互換（型検査の固定）', () => {
  assert.deepEqual(predictionResultSchemaMatchesEngine, [true, true]);
});

test('新規Goal: todayLogはnull、開始日が今日ならyesterdayMissingはfalse、予測は材料不足', async (t) => {
  const { stack } = await setup(t, { now: () => tokyo(5) }); // JST 10/6
  const a = await signedInClient(stack.app, 'new');
  const goal = (await a.call('POST', '/api/goals', validGoal)).json as unknown as Goal;
  const res = await a.call('GET', `/api/goals/${goal.id}/today`);
  assert.equal(res.status, 200, res.body);
  const today = res.json as unknown as Today;
  assert.equal(today.today, '2026-10-06');
  assert.equal(today.yesterday, '2026-10-05');
  assert.equal(today.todayLog, null);
  assert.equal(today.yesterdayMissing, false, 'yesterday is before the record start date');
  assert.equal(today.prediction.todayStatus, 'UNRECORDED');
  assert.deepEqual(today.prediction.progress, { done: 0, total: 100, completed: false });
  assert.deepEqual(today.prediction.coreMetric, { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' });
  assert.equal(today.prediction.completion.status, 'insufficient');
  assert.equal(today.prediction.modelVersion, DEFAULT_CONFIG.modelVersion);
  assert.deepEqual(today.prediction.config, { prior: 2, samples: 200, horizonDays: 1095, seed: 20261012 });
  // 直接Engineを呼んだ結果の公開値と完全に一致する（#77の完了条件）
  assert.deepEqual(today.prediction, publicPrediction(predict({ goal: { totalRequired: 100, initialProgress: 0, sessionAmount: 10 }, logs: [], today: '2026-10-06' })));
});

test('記録を重ねると/todayが再計算され、yesterdayMissingは昨日の記録の有無で変わる', async (t) => {
  let now = tokyo(1); // JST 10/2 = 開始日
  const { stack } = await setup(t, { now: () => now });
  const a = await signedInClient(stack.app, 'seq');
  const goal = (await a.call('POST', '/api/goals', { ...validGoal, initialProgress: 20 })).json as unknown as Goal;

  // 10/2 DONE, 10/3 DONE, 10/4 SKIPPED, 10/5 SKIPPED, 10/6 DONE → 10/7（今日・未記録）、10/8 UNKNOWN後の10/9
  const plan: [number, 'DONE' | 'SKIPPED'][] = [[2, 'DONE'], [3, 'DONE'], [4, 'SKIPPED'], [5, 'SKIPPED'], [6, 'DONE']];
  for (const [day, status] of plan) {
    now = tokyo(day - 1);
    assert.equal((await a.call('PUT', `/api/goals/${goal.id}/logs/2026-10-0${day}`, { status })).status, 200);
  }
  now = tokyo(6); // JST 10/7
  let today = (await a.call('GET', `/api/goals/${goal.id}/today`)).json as unknown as Today;
  assert.equal(today.yesterdayMissing, false, '10/6 is recorded');
  assert.equal(today.todayLog, null);
  assert.deepEqual(today.prediction.observations, { nDD: 1, nDS: 1, nSD: 1, nSS: 1, effectiveTransitions: 4, observedDays: 5, recordedDays: 5 });
  assert.equal(today.prediction.progress.done, 50, 'initialProgress 20 + 3 DONE x 10');
  assert.equal(today.prediction.coreMetric.status, 'available');
  assert.equal(today.prediction.completion.status, 'available');
  if (today.prediction.completion.status === 'available') assert.equal(today.prediction.completion.scenario, 'TODAY_DONE');
  const logs = plan.map(([day, status]) => ({ localDate: `2026-10-0${day}`, status, amount: status === 'DONE' ? 10 : null }));
  assert.deepEqual(today.prediction, publicPrediction(predict({ goal: { totalRequired: 100, initialProgress: 20, sessionAmount: 10 }, logs, today: '2026-10-07' })));

  // 今日を記録すると中心指標はnot_applicable、完了はCURRENT_STATE、todayLogが入る
  assert.equal((await a.call('PUT', `/api/goals/${goal.id}/logs/2026-10-07`, { status: 'DONE', amount: 7 })).status, 200);
  today = (await a.call('GET', `/api/goals/${goal.id}/today`)).json as unknown as Today;
  assert.deepEqual(today.todayLog, { localDate: '2026-10-07', status: 'DONE', amount: 7 });
  assert.deepEqual(today.prediction.coreMetric, { status: 'not_applicable', reason: 'TODAY_RECORDED' });
  assert.equal(today.prediction.progress.done, 57, 'today amount counted once');
  if (today.prediction.completion.status === 'available') assert.equal(today.prediction.completion.scenario, 'CURRENT_STATE');

  // 10/8を飛ばして10/9: 昨日（10/8）が未記録なのでyesterdayMissing、10/8はUNKNOWNで遷移に数えない
  now = tokyo(8); // JST 10/9
  today = (await a.call('GET', `/api/goals/${goal.id}/today`)).json as unknown as Today;
  assert.equal(today.yesterday, '2026-10-08');
  assert.equal(today.yesterdayMissing, true);
  assert.equal(today.todayLog, null);
  assert.equal(today.prediction.observations.observedDays, 7, '10/2..10/8 (UNKNOWN day included)');
  assert.equal(today.prediction.observations.recordedDays, 6);
  // 昨日を補完するとyesterdayMissingが消え、遷移が増える
  assert.equal((await a.call('PUT', `/api/goals/${goal.id}/logs/2026-10-08`, { status: 'SKIPPED' })).status, 200);
  today = (await a.call('GET', `/api/goals/${goal.id}/today`)).json as unknown as Today;
  assert.equal(today.yesterdayMissing, false);
  assert.equal(today.prediction.observations.nDS, 2, '10/7 DONE -> 10/8 SKIPPED');
});

test('達成済み: 中心指標はnot_applicable/COMPLETED、完了はcompleted、今日の記録状態によらない', async (t) => {
  const { stack } = await setup(t, { now: () => tokyo(5) });
  const a = await signedInClient(stack.app, 'done');
  const goal = (await a.call('POST', '/api/goals', { ...validGoal, initialProgress: 100 })).json as unknown as Goal;
  const today = (await a.call('GET', `/api/goals/${goal.id}/today`)).json as unknown as Today;
  assert.deepEqual(today.prediction.coreMetric, { status: 'not_applicable', reason: 'COMPLETED' });
  assert.deepEqual(today.prediction.completion, { status: 'completed' });
  assert.deepEqual(today.prediction.progress, { done: 100, total: 100, completed: true });
});

test('所有者チェックと未認証: 他人・存在しないGoalは404、Cookieなしは401', async (t) => {
  const { stack } = await setup(t, { now: () => tokyo(5) });
  const a = await signedInClient(stack.app, 'owner');
  const b = await signedInClient(stack.app, 'other');
  const goal = (await a.call('POST', '/api/goals', validGoal)).json as unknown as Goal;
  assert.equal((await b.call('GET', `/api/goals/${goal.id}/today`)).status, 404);
  assert.equal((await a.call('GET', `/api/goals/00000000-0000-4000-8000-000000000000/today`)).status, 404);
  assert.equal((await a.call('GET', `/api/goals/nope/today`)).status, 404);
  assert.equal((await stack.app.inject({ method: 'GET', url: `/api/goals/${goal.id}/today` })).statusCode, 401);
  assert.equal((await stack.app.inject({ method: 'GET', url: `/%61pi/goals/${goal.id}/today` })).statusCode, 401);
});
