import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGoalAmount, parseInteger, toCreateBody, toPatchBody, rebaseValues, valuesFromGoal, validate } from '../src/features/goals/goal-form.ts';
import { confirmedSaveFeedback } from '../src/features/logs/save-feedback.ts';
import { cumulativeChart } from '../src/features/today/chart-geometry.ts';

test('時間＋分を丸めず整数分へ変換し、不正な途中入力を拒否する', () => {
  const parts = (h, m) => '@hm:' + JSON.stringify([h, m]);
  assert.equal(parseGoalAmount(parts('200', '0')), 12000);
  assert.equal(parseGoalAmount(parts('20', '40')), 1240);
  assert.equal(parseGoalAmount('1,240'), 1240);
  assert.equal(parseGoalAmount(parts('０', '５９')), 59);
  for (const [h, m] of [['', '0'], ['-1', '0'], ['1.5', '0'], ['0', '60'], ['1', ''], ['x', '0']]) {
    assert.equal(parseGoalAmount(parts(h, m)), null);
  }
  assert.equal(parseInteger(parts('1', '0')), null, '日々の記録の整数入力契約を変えない');
});

const date = '2026-10-11';
function snapshot(logs, settings = {}) {
  const todayLog = logs.find(l => l.localDate === date) ?? null;
  const done = logs.filter(l => l.status === 'DONE').reduce((n, l) => n + l.amount, 0);
  const goal = { id: 'g', title: '合成 Goal', unit: 'minutes', totalRequired: 12000, sessionAmount: 30,
    initialProgress: 0, timezone: 'UTC', recordStartDate: '2026-10-10', today: date,
    goalSettingsRevision: 0, answerRevision: 0, unitLocked: false, progressDone: done,
    todayStatus: todayLog?.status ?? 'UNRECORDED', ...settings };
  const today = { today: date, yesterday: '2026-10-10', todayLog,
    yesterdayMissing: !logs.some(l => l.localDate === '2026-10-10'),
    prediction: { today: date, todayStatus: goal.todayStatus, progress: { done, total: goal.totalRequired } },
    context: { goalSettingsRevision: goal.goalSettingsRevision, answerRevision: goal.answerRevision,
      unitLocked: goal.unitLocked, unit: goal.unit, sessionAmount: goal.sessionAmount, recordStartDate: goal.recordStartDate } };
  return { goal, today, logs };
}
const done = amount => ({ localDate: date, status: 'DONE', amount });
const skip = { localDate: date, status: 'SKIPPED', amount: null };
test('時間表示から同じbodyを作り、未変更PATCHを出さず、不正なdraftをrebaseで消さない', () => {
  const g = { ...snapshot([]).goal, initialProgress: 1240, hasLogs: false, questionPrior: { a: null, b: null } };
  const values = { ...valuesFromGoal(g), totalRequired: '@hm:["200","0"]', initialProgress: '@hm:["20","40"]' };
  assert.equal(toCreateBody(values).totalRequired, 12000);
  assert.equal(toCreateBody(values).initialProgress, 1240);
  assert.equal(toPatchBody(values, g), null);
  const invalid = { ...values, initialProgress: '@hm:["20","60"]' };
  assert.equal(rebaseValues(invalid, g, { ...g, initialProgress: 1200 }).initialProgress, invalid.initialProgress);
  const edited = { ...values, totalRequired: '@hm:["2","3"]' };
  const counts = rebaseValues(edited, g, { ...g, unit: 'sessions', totalRequired: 150 });
  assert.equal(counts.unit, 'sessions');
  assert.equal(counts.totalRequired, '123', '有効な旧時間入力の内部表現を回数欄へ露出しない');
  assert.deepEqual(validate(values), {});
  assert.ok(validate({ ...values, unit: 'sessions' }).totalRequired, '回数へ時間＋分の内部表現を送らない');
  assert.ok(validate({ ...values, sessionAmount: '@hm:["0","30"]' }).sessionAmount, '1回の量は整数分の入力契約を保つ');
});
test('200時間へ30分保存は+0.25ポイント、30→20分の訂正は−10分', () => {
  assert.deepEqual(confirmedSaveFeedback(snapshot([]), snapshot([done(30)]), done(30)),
    { amount: 30, points: .25, unit: 'minutes', localDate: date });
  assert.equal(confirmedSaveFeedback(snapshot([done(30)]), snapshot([done(20)]), done(20)).amount, -10);
  assert.equal(confirmedSaveFeedback(snapshot([done(30)]), snapshot([skip]), skip).amount, -30);
});
test('ゼロ増分・不整合・設定変更・他日更新には増分を出さない', () => {
  assert.equal(confirmedSaveFeedback(snapshot([]), snapshot([skip]), skip), null);
  assert.equal(confirmedSaveFeedback(snapshot([done(30)]), snapshot([done(30)]), done(30)), null);
  for (const settings of [{ totalRequired: 6000 }, { goalSettingsRevision: 1 }, { answerRevision: 1 }, { sessionAmount: 20 }, { timezone: 'Asia/Tokyo' }]) {
    assert.equal(confirmedSaveFeedback(snapshot([]), snapshot([done(30)], settings), done(30)), null);
  }
  assert.equal(confirmedSaveFeedback(snapshot([]), snapshot([done(30), { localDate: '2026-10-10', status: 'DONE', amount: 10 }]), done(30)), null);
  const stale = snapshot([done(30)]); stale.goal.progressDone = 0;
  assert.equal(confirmedSaveFeedback(snapshot([]), stale, done(30)), null);
  assert.equal(confirmedSaveFeedback(snapshot([]), snapshot([done(20)]), done(30)), null);
});
test('積み上げ軸は0起点の実績尺度で超過を保持し、初日に架空の未来点を作らない', () => {
  const chart = cumulativeChart([done(125)], 0, 100, date, date, 350, 1);
  assert.equal(chart.points.length, 1);
  assert.equal(chart.singleDay, true);
  assert.ok(chart.maxValue > 125);
  assert.ok(chart.points[0].y < chart.targetY, '超過実績は目標線より上');
  const short = cumulativeChart([], 1, 12000, date, date, 350, 60);
  assert.equal(short.targetY, null, '大きな目標で小さい実績をつぶさない');
  const future = cumulativeChart([{ ...done(1000), localDate: '2026-10-12' }], 0, 100, date, date, 350, 1);
  assert.equal(future.last, 0);
  assert.equal(future.points[0].y, future.zeroY);
});
