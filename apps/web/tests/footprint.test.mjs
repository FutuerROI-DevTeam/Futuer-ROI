import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFootprint } from '../src/features/goals/footprint.ts';

const today = '2026-10-12';
const done = (date, amount = 1) => ({ localDate: date, status: 'DONE', amount });
const rest = date => ({ localDate: date, status: 'SKIPPED', amount: null });
function source(id, logs, settings = {}) {
  const date = settings.today ?? today;
  return { goal: { id, title: id, unit: 'minutes', timezone: 'UTC', recordStartDate: '2026-09-01', today: date,
    todayStatus: logs?.find(log => log.localDate === date)?.status ?? 'UNRECORDED', initialProgress: 0,
    progressDone: (logs ?? []).filter(log => log.status === 'DONE').reduce((sum, log) => sum + log.amount, 0), ...settings }, logs };
}
const cell = (result, date) => result.days.find(day => day.date === date);

test('全Goalの実施日を一つにまとめ、分と回の量を合算せず日を選んだGoalを保つ', () => {
  const sources = [source('英語', [done('2026-10-10', 120), done('2026-10-12', 120)]),
    source('読書', [done('2026-10-11', 2), done('2026-10-12', 3)], { unit: 'sessions' })];
  const before = JSON.stringify(sources), result = buildFootprint(sources);
  assert.equal(result.days.length, 28);
  assert.equal(result.streak, 3);
  assert.deepEqual(cell(result, today).goals.map(goal => goal.id), ['英語', '読書']);
  assert.equal(cell(result, today).kind, 'done');
  assert.equal(Object.hasOwn(cell(result, today), 'amount'), false);
  assert.equal(JSON.stringify(sources), before);
});
test('今日未記録なら昨日までの連続を残し、全Goalの明示休みだけは実施連続を区切る', () => {
  const past = [done('2026-10-10'), done('2026-10-11')];
  assert.equal(buildFootprint([source('a', past)]).streak, 2);
  const oneRest = source('a', [...past, rest(today)]);
  assert.equal(buildFootprint([oneRest, source('b', [])]).streak, 2, '別Goalの今日の実施余地を残す');
  assert.equal(buildFootprint([oneRest, source('b', [rest(today)])]).streak, 0);
  assert.equal(oneRest.goal.progressDone, 2, '休んでも過去の累計は消えない');
  assert.equal(cell(buildFootprint([oneRest]), today).kind, 'rest');
});
test('未取得・失敗・不整合を未記録や連続0にせず、確認できた実施は部分確認として保持する', () => {
  const missing = source('未取得', null);
  assert.equal(buildFootprint([missing]).streak, null);
  assert.equal(cell(buildFootprint([missing]), today).kind, 'unconfirmed');
  const result = buildFootprint([missing, source('確認済み', [done(today)])]);
  assert.equal(cell(result, today).kind, 'done');
  assert.equal(cell(result, today).complete, false);
  assert.deepEqual(cell(result, today).goals.map(goal => goal.id), ['確認済み']);
  const changed = source('不整合', [done(today)], { progressDone: 2 });
  assert.equal(cell(buildFootprint([changed]), today).kind, 'unconfirmed');
});
test('異なるGoal日付をUTCへ勝手に変換せず、時差のある今日の連続は保留する', () => {
  const utc = source('UTC', [], { today: '2026-10-11', timezone: 'UTC' });
  const japan = source('日本', [done(today)], { timezone: 'Asia/Tokyo' });
  const result = buildFootprint([utc, japan]);
  assert.equal(result.today, today);
  assert.equal(result.sameToday, false);
  assert.equal(result.streak, null);
  assert.equal(cell(result, today).kind, 'done');
  assert.equal(cell(result, today).complete, false);
});
test('同じGoal/日の重複を増やさず、矛盾した重複・範囲外の行は未確認にする', () => {
  const s = source('a', [done(today)]);
  assert.equal(cell(buildFootprint([s, s]), today).goals.length, 1);
  const identical = { ...s, logs: [done(today), done(today)] };
  assert.equal(cell(buildFootprint([identical]), today).goals.length, 1);
  const conflict = { ...s, logs: [done(today), rest(today)] };
  assert.equal(cell(buildFootprint([conflict]), today).kind, 'unconfirmed');
  assert.equal(buildFootprint([source('future', [done('2026-10-13')])]).streak, null);
});
test('訂正とGoal削除を最新の一覧/履歴から反映し、初期累計から実施日を捏造しない', () => {
  const a = source('削除前', [done(today)]), b = source('残るGoal', []);
  assert.equal(cell(buildFootprint([a, b]), today).kind, 'done');
  assert.equal(cell(buildFootprint([b]), today).kind, 'unrecorded');
  assert.equal(cell(buildFootprint([source('訂正後', [rest(today)]), b]), today).kind, 'rest');
  const initial = source('初期量', [], { initialProgress: 120, progressDone: 120, recordStartDate: today });
  const result = buildFootprint([initial]);
  assert.equal(result.streak, 0);
  assert.equal(cell(result, '2026-10-11').kind, 'before-start');
  assert.equal(cell(result, today).kind, 'unrecorded');
});
test('年/閏日の境界で暦日を一度ずつ扱い、表示窓外の連続も全取得からだけ数える', () => {
  const newYear = source('年越し', [done('2026-12-31'), done('2027-01-01')], { today: '2027-01-01' });
  assert.equal(buildFootprint([newYear]).streak, 2);
  const leap = source('閏年', [done('2028-02-28'), done('2028-02-29'), done('2028-03-01')], { today: '2028-03-01' });
  assert.equal(buildFootprint([leap]).streak, 3);
  assert.equal(new Set(buildFootprint([leap]).days.map(day => day.date)).size, 28);
});
