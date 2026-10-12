import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureSave, rebaseSave } from '../src/features/logs/useSaveLog.ts';
import { loadCreateAttempt, prepareCreateAttempt, clearCreateAttempt, CreateRecoveryError, createFailureKind } from '../src/features/goals/create-attempt.ts';
import { ApiError } from '../src/api/client.ts';
import { toLogPut } from '../src/features/logs/record-log.ts';
const context = { id: 'g1', unit: 'minutes', timezone: 'Asia/Tokyo', goalSettingsRevision: 0 };
const body = { title: '合成Goal', unit: 'minutes', totalRequired: 100, sessionAmount: 10, timezone: 'Asia/Tokyo' };
const key = '00000000-0000-4000-8000-000000000148';
const storage = () => {
  const rows = new Map();
  return {
    getItem: k => rows.get(k) ?? null,
    setItem: (k,v) => rows.set(k,v),
    removeItem: k => rows.delete(k),
  };
};
test('F02/F04: 保存操作はGoal・日・量・版を固定し、明示rebaseは版だけを替える', () => {
  const choice = { status: 'DONE', amount: 10 };
  const vars = captureSave(context, '2026-10-09', choice);
  choice.amount = 100;
  assert.deepEqual(vars, { goalId: 'g1', localDate: '2026-10-09', choice: { status: 'DONE', amount: 10 }, expectedGoalSettingsRevision: 0, unit: 'minutes', timezone: 'Asia/Tokyo' });
  const rebased = rebaseSave(vars, { ...context, goalSettingsRevision: 2 });
  assert.deepEqual(rebased, { ...vars, expectedGoalSettingsRevision: 2 });
  assert.deepEqual(toLogPut(rebased.choice, rebased.expectedGoalSettingsRevision), { status: 'DONE', amount: 10, expectedGoalSettingsRevision: 2 });
});
test('F05: Goal/単位/timezone変更は同数値を自動rebaseしない', () => {
  const vars = captureSave(context, '2026-10-09', { status: 'DONE', amount: 10 });
  for (const changed of [{ id: 'g2' }, { unit: 'sessions' }, { timezone: 'UTC' }]) assert.equal(rebaseSave(vars, { ...context, ...changed }), null);
});
test('F06/F07/F08: 未確定createは同ownerのキー・原bodyを復元し、別ownerに持ち越さない', () => {
  const db = storage();
  const a = prepareCreateAttempt('a', body, db, () => key);
  body.title = '入力変更';
  assert.equal(a.body.title, '合成Goal');
  assert.deepEqual(prepareCreateAttempt('a', body, db, () => { throw Error('新keyは禁止'); }), a);
  assert.deepEqual(loadCreateAttempt('a', db), a);
  assert.equal(loadCreateAttempt('b', db), null);
  clearCreateAttempt(a, db);
  assert.equal(loadCreateAttempt('a', db), null);
  assert.equal(prepareCreateAttempt('a', body, db, () => key).body.title, '入力変更');
});
test('回復情報の破損・保存失敗は新keyで送信を進めない', () => {
  assert.throws(() => prepareCreateAttempt('a', body, { getItem: () => '{', setItem() {}, removeItem() {} }, () => key));
  assert.throws(() => prepareCreateAttempt('a', body, { getItem: () => null, setItem() { throw Error('容量'); }, removeItem() {} }, () => key), /容量/);
});

test('確定422: 保存したNUL bodyの再検証でcleanupを止めない', () => {
  const db = storage();
  const rejected = prepareCreateAttempt('a', { ...body, title: 'NUL\u0000入り' }, db, () => key);
  assert.throws(() => loadCreateAttempt('a', db), CreateRecoveryError, '初回ロードの厳密検証は維持する');
  assert.equal(clearCreateAttempt(rejected, db), true);
  assert.equal(db.getItem('future-roi:create-attempt:a'), null);
});


test('F06逆対: 離脱したK1の遅延成功/422で、進行中K2の回復情報を消さない', () => {
  const db = storage();
  const previous = prepareCreateAttempt('a', body, db, () => key);
  clearCreateAttempt(previous, db);
  const key2 = '00000000-0000-4000-8000-000000000249';
  const current = prepareCreateAttempt('a', body, db, () => key2);
  for (const lateResponse of ['success', '422']) {
    assert.equal(clearCreateAttempt(previous, db), false);
    assert.deepEqual(loadCreateAttempt('a', db), current, lateResponse);
  }
  clearCreateAttempt(current, db);
  assert.equal(loadCreateAttempt('a', db), null);
});


test('破損JSON・旧schema・不正ownerの回復原文を保全し、新key・書込・削除を行わない', () => {
  const valid = { owner: 'a', key, body: { ...body, title: '合成Goal' } };
  for (const raw of ['{', 'null', JSON.stringify({ ...valid, body: { ...valid.body, unit: 'legacy' } }), JSON.stringify({ ...valid, owner: 'b' })]) {
    const writes = [];
    const db = { getItem: () => raw, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) };
    assert.throws(() => loadCreateAttempt('a', db), CreateRecoveryError);
    assert.throws(() => prepareCreateAttempt('a', body, db, () => { throw Error('新key禁止'); }), CreateRecoveryError);
    assert.equal(db.getItem(), raw);
    assert.deepEqual(writes, []);
  }
});

test('作成の409競合・owner変更・410削除を、通信失敗・他のHTTP失敗と区別する', () => {
  const error = (status, code) => new ApiError(status, { error: { code, message: 'synthetic' } });
  assert.equal(createFailureKind(error(409, 'IDEMPOTENCY_CONFLICT')), 'conflict');
  assert.equal(createFailureKind(error(409, 'CREATE_OWNER_CHANGED')), 'owner');
  assert.equal(createFailureKind(error(410, 'CREATE_RESULT_DELETED')), 'deleted');
  assert.equal(createFailureKind(new CreateRecoveryError()), 'recovery');
  for (const failure of [new TypeError('通信失敗'), error(500, 'IDEMPOTENCY_CONFLICT'), error(422, 'CREATE_RESULT_DELETED'), new ApiError(409, null)]) assert.equal(createFailureKind(failure), null);
});

test('終端cleanupは同keyのraw変更・別owner・別keyを削除しない', () => {
  for (const change of ['raw', 'owner', 'key']) {
    const db = storage();
    const operation = prepareCreateAttempt('a', body, db, () => key);
    const changed = change === 'raw' ? operation.raw + ' ' : operation.raw;
    db.setItem('future-roi:create-attempt:a', changed);
    const rejected = change === 'owner' ? { ...operation, owner: 'b' } : change === 'key' ? { ...operation, key: '00000000-0000-4000-8000-000000000249' } : operation;
    clearCreateAttempt(rejected, db);
    assert.equal(db.getItem('future-roi:create-attempt:a'), changed, change);
  }
});

test('cleanupのstorage読取/削除例外は回復エラーになり、元rawを保持する', () => {
  const db = storage();
  const operation = prepareCreateAttempt('a', body, db, () => key);
  for (const method of ['getItem', 'removeItem']) {
    const failing = { ...db, [method]: () => { throw Error('storage synthetic'); } };
    assert.throws(() => clearCreateAttempt(operation, failing), CreateRecoveryError);
    assert.equal(db.getItem('future-roi:create-attempt:a'), operation.raw);
  }
});
