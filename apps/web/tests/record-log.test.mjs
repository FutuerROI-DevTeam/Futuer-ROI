import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { isSaveFor, saveLogKey } from '../src/features/logs/useSaveLog.ts';
import { ApiError } from '../src/api/client.ts';
import { amountFormat } from '../src/copy/amount.ts';
import {
  choiceFromLog,
  classifySaveError,
  describeChoice,
  editLocks,
  reachedDate,
  isCurrentToday,
  TodayDateChangedError,
  toLogPut,
  unlessLocked,
  yesterdayRecord,
} from '../src/features/logs/record-log.ts';

test('DONEは表示量と設定版を明示し、SKIPPEDは設定版だけを送る', () => {
  assert.deepEqual(toLogPut({ status: 'DONE', amount: 20 }, 3), { status: 'DONE', amount: 20, expectedGoalSettingsRevision: 3 });
  assert.deepEqual(toLogPut({ status: 'DONE', amount: 35 }, 3), { status: 'DONE', amount: 35, expectedGoalSettingsRevision: 3 });
  assert.deepEqual(toLogPut({ status: 'SKIPPED', amount: null }, 3), { status: 'SKIPPED', expectedGoalSettingsRevision: 3 });
});

test('保存できなかった記録を「やった・20分」「休んだ」と書く（量を変えていなければ1回の量）', () => {
  assert.equal(describeChoice({ status: 'DONE', amount: 20 }, 20, amountFormat({unit:'minutes'}).record, '休んだ'), 'やった・20分');
  assert.equal(describeChoice({ status: 'DONE', amount: 90 }, 60, amountFormat({unit:'minutes'}).record, '休んだ'), 'やった・90分');
  assert.equal(describeChoice({ status: 'DONE', amount: 1500 }, 20, amountFormat({ unit: 'minutes' }).record, '休んだ'), 'やった・1,500分');
  assert.equal(describeChoice({ status: 'SKIPPED', amount: null }, 20, amountFormat({unit:'sessions'}).record, '休んだ'), '休んだ');
});

test('保存の失敗を、ログイン切れ・記録できない日・それ以外（再試行できる）に分ける', () => {
  const body = (code) => ({ error: { code, message: 'x', fields: [{ path: 'params/localDate', message: 'x' }] } });
  assert.equal(classifySaveError(new ApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })), 'signed-out');
  assert.equal(classifySaveError(new ApiError(422, body('LOG_DATE_OUT_OF_WINDOW'))), 'date');
  assert.equal(classifySaveError(new ApiError(422, body('LOG_DATE_BEFORE_START'))), 'date');
  assert.equal(classifySaveError(new ApiError(422, body('VALIDATION_ERROR'))), 'failed');
  assert.equal(classifySaveError(new ApiError(500, null)), 'failed');
  assert.equal(classifySaveError(new TypeError('Failed to fetch')), 'failed');
});

test('昨日は、記録開始日より前なら何も出さず、未記録なら補完、記録済みなら訂正の対象にする', () => {
  const logs = [
    { localDate: '2026-10-06', status: 'DONE', amount: 20 },
    { localDate: '2026-10-07', status: 'SKIPPED', amount: null },
  ];
  assert.deepEqual(yesterdayRecord('2026-10-06', '2026-10-07', logs), { kind: 'before-start' });
  assert.deepEqual(yesterdayRecord('2026-10-05', '2026-10-01', logs), { kind: 'missing' });
  assert.deepEqual(yesterdayRecord('2026-10-06', '2026-10-01', logs), { kind: 'recorded', log: logs[0] });
  // 開始日の当日は記録できる
  assert.deepEqual(yesterdayRecord('2026-10-06', '2026-10-06', logs), { kind: 'recorded', log: logs[0] });
});

test('訂正の初期値は保存済みの記録（DONEは保存済みの量のまま、今の1回の量に置き換えない）', () => {
  assert.deepEqual(choiceFromLog({ localDate: '2026-10-06', status: 'DONE', amount: 20 }), { status: 'DONE', amount: 20 });
  assert.deepEqual(choiceFromLog({ localDate: '2026-10-06', status: 'SKIPPED', amount: null }), { status: 'SKIPPED', amount: null });
  // 保存済みの量で要約する（1回の量が30分に変わっていても「20分」）
  assert.equal(describeChoice(choiceFromLog({ localDate: '2026-10-06', status: 'DONE', amount: 20 }), 30, amountFormat({ unit: 'minutes' }).record, '休んだ'), 'やった・20分');
});
test('作り直す前の画面の保存が終わるまで、新しい画面から同じ日の保存は送らない（別の日は送れる）', async () => {
  const client = new QueryClient();
  let finish;
  // 一覧へ戻る前の画面で始めた、今日の「やった」の保存（まだ届いていない）
  const before = new MutationObserver(client, { mutationKey: saveLogKey('g'), mutationFn: () => new Promise((r) => (finish = r)) });
  const pending = before.mutate({ localDate: '2026-10-07', choice: { status: 'DONE', amount: 20 } }).catch(() => {});
  while (!finish) await new Promise((r) => setTimeout(r, 1));

  // 開き直した新しい画面（useSaveLog の save と同じ確かめ方）
  const busy = (localDate) => client.isMutating({ mutationKey: saveLogKey('g'), predicate: (m) => isSaveFor(localDate, m.state.variables) }) > 0;
  assert.equal(busy('2026-10-07'), true);
  assert.equal(busy('2026-10-06'), false);
  assert.equal(client.isMutating({ mutationKey: saveLogKey('other'), predicate: (m) => isSaveFor('2026-10-07', m.state.variables) }), 0);

  finish({ localDate: '2026-10-07', status: 'DONE', amount: 20 });
  await pending;
  assert.equal(busy('2026-10-07'), false);
  client.clear();
});

test('今日の量の入力を開いた後は昨日の変更を始められず、昨日の訂正中は今日を送れない（今日と昨日を同時に編集しない）', () => {
  const idle = { changingToday: false, todayAmountEditing: false, todayChoicesShown: true, todaySaving: false, yesterdayEditing: false };
  assert.deepEqual(editLocks(idle), { todayAmountEditing: false, yesterdayLocked: false, todayLocked: false, cancelChangeLocked: false });
  // 今日が未記録・昨日が記録済み：今日の「量を変更」を開くと、昨日の［変更］は押せない
  assert.equal(editLocks({ ...idle, todayAmountEditing: true }).yesterdayLocked, true);
  // 昨日の訂正中は、今日の2択・量の入力から送らない
  assert.equal(editLocks({ ...idle, yesterdayEditing: true }).todayLocked, true);
  // 記録済みの今日を選び直している間・今日を保存している間も、昨日は始めない
  assert.equal(editLocks({ ...idle, changingToday: true }).yesterdayLocked, true);
  assert.equal(editLocks({ ...idle, todaySaving: true }).yesterdayLocked, true);
  // 別のタブで今日が記録されて2択が消えたら、量の入力は閉じたものとして昨日を止めたままにしない
  assert.deepEqual(editLocks({ ...idle, todayAmountEditing: true, todayChoicesShown: false }), {
    todayAmountEditing: false,
    yesterdayLocked: false,
    todayLocked: false,
    cancelChangeLocked: false,
  });
});

test('今日の記録を選び直して保存している間は「変更をやめる」で閉じず、遅れて届いた失敗と再試行を見失わない（#146）', async () => {
  const client = new QueryClient();
  let reject;
  const pending = new Promise((_, r) => { reject = r; });
  const observer = new MutationObserver(client, { mutationFn: () => pending });
  const choosing = { changingToday: true, todayAmountEditing: false, todayChoicesShown: true, todaySaving: false, yesterdayEditing: false };
  const resets = [];
  const cancel = (locks) => unlessLocked(locks.cancelChangeLocked, () => { resets.push('reset'); observer.reset(); })();
  try {
    // 保存を始める前は、選び直しをやめられる
    assert.equal(editLocks(choosing).cancelChangeLocked, false);
    const saving = observer.mutate().catch(() => {});
    assert.equal(observer.getCurrentResult().isPending, true);
    // 保存の応答待ち：「変更をやめる」は押せず、押されても保存の状態を消さない
    const whileSaving = editLocks({ ...choosing, todaySaving: true });
    assert.equal(whileSaving.cancelChangeLocked, true);
    cancel(whileSaving);
    assert.deepEqual(resets, []);
    // 遅れて失敗が届いても、保存の失敗として残り、再試行を出せる
    reject(new ApiError(503, null));
    await saving;
    assert.equal(observer.getCurrentResult().isError, true);
    assert.equal(observer.getCurrentResult().error.status, 503);
    // 保存が終われば、やめられる
    assert.equal(editLocks(choosing).cancelChangeLocked, false);
  } finally {
    client.clear();
  }
});

test('今日の保存が失敗した後に昨日の訂正を始めたら、今日の「もう一度保存」からも送らない（#88）', () => {
  const sent = [];
  const retryToday = () => sent.push('today');
  // 今日は未記録・昨日は記録済み。今日の保存が通信／サーバー失敗（保存中ではない）→ 昨日の訂正を始める
  const failedToday = { changingToday: false, todayAmountEditing: false, todayChoicesShown: true, todaySaving: false, yesterdayEditing: false };
  assert.equal(editLocks(failedToday).yesterdayLocked, false);
  const locks = editLocks({ ...failedToday, yesterdayEditing: true });
  // 「もう一度保存」を押しても今日の PUT を送らない
  unlessLocked(locks.todayLocked, retryToday)();
  assert.deepEqual(sent, []);
  // 昨日の訂正を終えれば、再試行できる
  unlessLocked(editLocks(failedToday).todayLocked, retryToday)();
  assert.deepEqual(sent, ['today']);
});

test('今日の保存は API の今日だけ。Goal/Todayの到着順・初回Today失敗・翌日へ更新後の旧日retryを区別する', () => {
  const d = '2026-10-07', next = '2026-10-08';
  assert.equal(isCurrentToday(d, d, d), true);
  assert.equal(isCurrentToday(d, next, d), false); // Goal先着・古いlastGoodの通常保存／量入力
  assert.equal(isCurrentToday(d, d, next), false); // Today先着
  assert.equal(isCurrentToday(d, next, next), false); // 全取得成功後でも失敗した旧日のretryは禁止
  assert.equal(isCurrentToday(next, next, next), true);
  assert.equal(isCurrentToday(next, next, undefined), true); // 初回Today失敗時のGoal fallback
  assert.equal(isCurrentToday(d, undefined, d), false);
  assert.equal(classifySaveError(new TodayDateChangedError()), 'day-changed');
});

test('達成済みの「届いた日」は、初期量にDONEの量を日付順に足して総量に届いた最初の日（初期量だけなら記録開始前）', () => {
  const logs = [
    { localDate: '2026-10-07', status: 'DONE', amount: 30 },
    { localDate: '2026-10-05', status: 'DONE', amount: 50 },
    { localDate: '2026-10-06', status: 'SKIPPED', amount: null },
  ];
  // 20＋50（10/5）＝70、＋30（10/7）＝100 で届く。並びが日付順でなくても日付順にたどる
  assert.equal(reachedDate(20, 100, logs), '2026-10-07');
  assert.equal(reachedDate(20, 70, logs), '2026-10-05');
  // 初期量だけで届いていた
  assert.equal(reachedDate(100, 100, logs), null);
  // 記録から届いた日をたどれない（総量を下げて達成済みになったなど）
  assert.equal(reachedDate(0, 1000, logs), undefined);
});
