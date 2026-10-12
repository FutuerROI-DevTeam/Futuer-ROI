import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/api/client.ts';
import { CreateRecoveryError } from '../src/features/goals/create-attempt.ts';
import { valuesFromGoal } from '../src/features/goals/goal-form.ts';
import {
  isCreateBlocked,
  isCreateResultDeleted,
  isEditConflict,
  loadRecovery,
  rejectedCreateOperation,
  restoreFormDraft,
} from '../src/features/goals/form/form-recovery.ts';

const goal = {
  id: 'g1',
  title: '合成Goal',
  unit: 'minutes',
  totalRequired: 100,
  sessionAmount: 10,
  initialProgress: 0,
  timezone: 'Asia/Tokyo',
  recordStartDate: '2026-10-01',
  hasLogs: false,
  unitLocked: false,
  goalSettingsRevision: 7,
  questionPrior: { a: 'HIGH', b: null },
  answerRevision: 3,
  today: '2026-10-12',
  todayStatus: 'UNRECORDED',
  targetDate: null,
};
const draft = (sourceGoal = undefined) => ({
  values: { ...valuesFromGoal(goal), title: '未保存の入力' },
  baseline: sourceGoal,
  sourceGoal,
  submitted: true,
  priorOpen: true,
  priorChosen: { a: true, b: true },
  latestAnswers: goal.questionPrior,
});
const apiError = (status, code) => new ApiError(status, { error: { code, message: 'synthetic' } });
const healthy = { attempt: null, error: null, knownRejected: false };
const failure = (operation = null, sourceGoal = undefined) => ({
  ...draft(sourceGoal),
  error: apiError(422, 'VALIDATION_ERROR'),
  serverErrors: { title: 'synthetic' },
  operation,
});
const operation = (key, overrides = {}) => {
  const snapshot = {
    owner: 'A',
    key,
    body: { title: '合成Goal', unit: 'minutes', totalRequired: 100, sessionAmount: 10, timezone: 'Asia/Tokyo' },
    ...overrides,
  };
  return { ...snapshot, raw: JSON.stringify(snapshot) };
};
const key1 = '00000000-0000-4000-8000-000000000274';
const key2 = '00000000-0000-4000-8000-000000000275';

function withStorage(storage, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else delete globalThis.sessionStorage;
  }
}

test('未確定作成の元bodyを優先し、回復情報が読めない場合は通常draftも失敗snapshotも戻さない', () => {
  const input = draft();
  const sent = operation(key1);
  const rejected = failure(sent);
  assert.equal(restoreFormDraft('create', undefined, input, undefined, healthy, null).restored, input);
  assert.deepEqual(restoreFormDraft('create', undefined, input, undefined, healthy, sent), {
    recoveredFailure: undefined,
    restored: undefined,
  });
  assert.deepEqual(restoreFormDraft('create', undefined, input, rejected, {
    attempt: sent,
    error: new CreateRecoveryError(),
    knownRejected: false,
  }, sent), { recoveredFailure: undefined, restored: undefined });
});

test('K1の失敗表示は同じrawだけに戻し、K2への置換後は採用しない', () => {
  const first = operation(key1);
  const second = operation(key2);
  const rejected = failure(first);
  const recovered = restoreFormDraft('create', undefined, draft(), rejected, healthy, first);
  assert.equal(recovered.recoveredFailure, rejected);
  assert.equal(recovered.restored, rejected);
  assert.deepEqual(restoreFormDraft('create', undefined, draft(), rejected, healthy, second), {
    recoveredFailure: undefined,
    restored: undefined,
  });
});

test('編集の失敗入力は同Goalだけに戻し、更新済み設定との比較元を勝手に置き換えない', () => {
  const rejected = failure(null, goal);
  const latest = { ...goal, title: '他画面の更新', goalSettingsRevision: 8, answerRevision: 4 };
  const recovered = restoreFormDraft('edit', latest, undefined, rejected, healthy, null);
  assert.equal(recovered.recoveredFailure, rejected);
  assert.equal(recovered.restored.baseline, goal);
  assert.equal(recovered.restored.values.title, '未保存の入力');
  for (const sourceGoal of [undefined, { ...goal, id: 'g2' }]) {
    assert.deepEqual(restoreFormDraft('edit', goal, undefined, failure(null, sourceGoal), healthy, null), {
      recoveredFailure: undefined,
      restored: undefined,
    });
  }
});

test('通常の編集draftはGoal・設定版・回答版・記録有無・編集可能値が一致する場合だけ戻す', () => {
  const input = draft(goal);
  assert.equal(restoreFormDraft('edit', structuredClone(goal), input, undefined, healthy, null).restored, input);
  for (const changed of [
    { id: 'g2' },
    { goalSettingsRevision: 8 },
    { goalSettingsRevision: undefined },
    { answerRevision: 4 },
    { hasLogs: true },
    { title: '更新名' },
    { sessionAmount: 11 },
    { timezone: 'UTC' },
    { questionPrior: { a: 'LOW', b: null } },
  ]) {
    assert.equal(restoreFormDraft('edit', { ...goal, ...changed }, input, undefined, healthy, null).restored, undefined,
      JSON.stringify(changed));
  }
  assert.equal(restoreFormDraft('edit', goal, draft(), undefined, healthy, null).restored, undefined);
});

test('回復情報はownerなしなら読まず、正常な実送信snapshotは読取だけで復元する', () => {
  let reads = 0;
  const sent = operation(key1);
  withStorage({
    getItem(key) {
      reads++;
      assert.equal(key, 'future-roi:create-attempt:A');
      return sent.raw;
    },
    setItem() { assert.fail('読込で書込しない'); },
    removeItem() { assert.fail('読込で削除しない'); },
  }, () => {
    assert.deepEqual(loadRecovery(undefined, undefined), healthy);
    assert.equal(reads, 0);
    assert.deepEqual(loadRecovery('A', undefined), { ...healthy, attempt: sent });
    assert.equal(reads, 1);
  });
});

test('既知422の同rawだけを破損回復情報の表示に使い、保存禁止errorと原文を残す', () => {
  const sent = operation(key1, {
    body: { title: 'NUL\u0000入り', unit: 'minutes', totalRequired: 100, sessionAmount: 10, timezone: 'Asia/Tokyo' },
  });
  const rejected = failure(sent);
  withStorage({
    getItem: () => sent.raw,
    setItem() { assert.fail('破損原文を書き換えない'); },
    removeItem() { assert.fail('破損原文を削除しない'); },
  }, () => {
    const recovery = loadRecovery('A', rejected);
    assert.equal(recovery.attempt, sent);
    assert.equal(recovery.knownRejected, true);
    assert.ok(recovery.error instanceof CreateRecoveryError);
    const restored = restoreFormDraft('create', undefined, draft(), rejected, recovery, sent);
    assert.equal(restored.recoveredFailure, rejected);
    assert.equal(restored.restored, rejected);
    assert.equal(sessionStorage.getItem('future-roi:create-attempt:A'), sent.raw);

    const otherOwner = loadRecovery('B', rejected);
    assert.equal(otherOwner.knownRejected, false);
    assert.equal(otherOwner.attempt, null);
    assert.ok(otherOwner.error instanceof CreateRecoveryError);
  });
});

test('破損rawの不一致・読取例外では既知422があっても復元を拒否する', () => {
  const rejected = failure(operation(key1));
  for (const getItem of [() => '{', () => { throw new Error('synthetic storage failure'); }]) {
    withStorage({ getItem }, () => {
      const recovery = loadRecovery('A', rejected);
      assert.equal(recovery.attempt, null);
      assert.equal(recovery.knownRejected, false);
      assert.ok(recovery.error instanceof CreateRecoveryError);
    });
  }
});

test('復旧actionの分類はowner・HTTP status・error codeをすべて照合する', () => {
  const sent = operation(key1);
  assert.equal(rejectedCreateOperation(apiError(422, 'VALIDATION_ERROR'), sent, 'A'), sent);
  for (const [error, owner] of [
    [apiError(422, 'VALIDATION_ERROR'), 'B'],
    [apiError(422, 'VALIDATION_ERROR'), undefined],
    [apiError(422, 'GOAL_HAS_LOGS'), 'A'],
    [apiError(409, 'VALIDATION_ERROR'), 'A'],
    [new TypeError('synthetic offline'), 'A'],
  ]) {
    assert.equal(rejectedCreateOperation(error, sent, owner), null);
  }
  assert.equal(isEditConflict(apiError(409, 'ANSWER_CONFLICT')), true);
  assert.equal(isEditConflict(apiError(409, 'GOAL_SETTINGS_CONFLICT')), true);
  assert.equal(isEditConflict(apiError(422, 'ANSWER_CONFLICT')), false);
  assert.equal(isEditConflict(apiError(409, 'IDEMPOTENCY_CONFLICT')), false);
  assert.equal(isCreateBlocked(apiError(409, 'IDEMPOTENCY_CONFLICT')), true);
  assert.equal(isCreateBlocked(apiError(410, 'CREATE_RESULT_DELETED')), true);
  assert.equal(isCreateBlocked(apiError(409, 'CREATE_OWNER_CHANGED')), false);
  assert.equal(isCreateResultDeleted(apiError(410, 'CREATE_RESULT_DELETED')), true);
  assert.equal(isCreateResultDeleted(apiError(409, 'CREATE_RESULT_DELETED')), false);
});
