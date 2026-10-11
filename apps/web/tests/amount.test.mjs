import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountFormat, hoursMinutes, isRecordAmount, RECORD_AMOUNT_MAX, recordStep, stepRecordAmount } from '../src/copy/amount.ts';

test('分のGoalの累計・総量・残量は、整数分を正確な時間＋分で書く（P-18の固定例）', () => {
  const cases = [
    [0, '0時間0分'],
    [1, '0時間1分'],
    [59, '0時間59分'],
    [60, '1時間0分'],
    [61, '1時間1分'],
    [1240, '20時間40分'],
  ];
  for (const [minutes, text] of cases) assert.equal(hoursMinutes(minutes), text, String(minutes));
  // 総量3000分に対する実績2999分：小数へ丸めず、残り1分の差が見える
  const fmt = amountFormat({ unit: 'minutes' });
  assert.deepEqual([fmt.total(2999), fmt.total(3000), fmt.total(3000 - 2999)], ['49時間59分', '50時間0分', '0時間1分']);
  // 大きい時間は桁区切りを付ける
  assert.equal(hoursMinutes(60_000 * 6 + 5), '6,000時間5分');
});

test('記録の量はDONE契約の整数範囲で、±は刻みの倍数にそろえ、刻み1つ分より下・上限より上へ行かない', () => {
  for (const value of [null, 0, -1, 1.5, NaN, Infinity, RECORD_AMOUNT_MAX + 1]) assert.equal(isRecordAmount(value), false);
  for (const value of [1, 37, RECORD_AMOUNT_MAX]) assert.equal(isRecordAmount(value), true);
  assert.equal(stepRecordAmount(20, 5, 1), 25);
  assert.equal(stepRecordAmount(20, 5, -1), 15);
  // 刻みの倍数でない値は倍数へそろえる
  assert.equal(stepRecordAmount(23, 5, 1), 25);
  assert.equal(stepRecordAmount(23, 5, -1), 20);
  // 刻み1つ分より下には減らさない（減らせないときは元の値のまま）
  assert.equal(stepRecordAmount(5, 5, -1), 5);
  assert.equal(stepRecordAmount(3, 5, -1), 3);
  assert.equal(stepRecordAmount(3, 5, 1), 5);
  assert.equal(stepRecordAmount(1, 1, -1), 1);
  assert.equal(stepRecordAmount(RECORD_AMOUNT_MAX - 1, 30, 1), RECORD_AMOUNT_MAX);
});

test('刻みは1回の量に合わせたきりのよい幅（分：30分まで5分・90分まで15分・それより大は30分／回：10回まで1回・50回まで5回・それより大は10回）', () => {
  const cases = [
    ['minutes', 10, 5], ['minutes', 20, 5], ['minutes', 30, 5], ['minutes', 31, 15], ['minutes', 60, 15], ['minutes', 90, 15], ['minutes', 91, 30], ['minutes', 180, 30],
    ['sessions', 1, 1], ['sessions', 10, 1], ['sessions', 11, 5], ['sessions', 20, 5], ['sessions', 50, 5], ['sessions', 51, 10],
  ];
  for (const [unit, session, step] of cases) assert.equal(recordStep(unit, session), step, `${unit} ${session}`);
  // 例：1回の量20分は 20→25→30、60分は 60→75→90、20回は 20→25
  assert.equal(stepRecordAmount(60, recordStep('minutes', 60), 1), 75);
  assert.equal(stepRecordAmount(20, recordStep('sessions', 20), 1), 25);
  assert.equal(amountFormat({ unit: 'minutes' }).recordStep(20), 5);
  assert.equal(amountFormat({ unit: 'sessions' }).recordStep(1), 1);
});

test('1回の量・日々の記録は分のまま、回のGoalはすべて回で書く', () => {
  const minutes = amountFormat({ unit: 'minutes' });
  assert.deepEqual([minutes.record(20), minutes.record(1500), minutes.recordUnit], ['20分', '1,500分', '分']);
  const count = amountFormat({ unit: 'sessions' });
  assert.deepEqual([count.total(38), count.record(20), count.recordUnit], ['38回', '20回', '回']);
});

test('積み上げの図の目盛り：3時間以上の分のGoalは1時間刻みで時間の数、短いGoalと回のGoalはそのままの数', () => {
  const long = amountFormat({ unit: 'minutes' }).axis(3000);
  assert.deepEqual([long.unit, long.gridUnit, long.label(1020)], ['時間', 60, '17']);
  const short = amountFormat({ unit: 'minutes' }).axis(120);
  assert.deepEqual([short.unit, short.gridUnit, short.label(40)], ['分', 1, '40']);
  const count = amountFormat({ unit: 'sessions' }).axis(100);
  assert.deepEqual([count.unit, count.gridUnit, count.label(33)], ['回', 1, '33']);
});
