import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toTodaySnapshot,
  type SnapshotGoalRow,
  type SnapshotLogRow,
} from '../src/prediction/snapshot.ts';

const goalRow = (overrides: Partial<SnapshotGoalRow> = {}): SnapshotGoalRow => ({
  total_required: 2147483647,
  initial_progress: 0,
  session_amount: 25,
  timezone: 'Asia/Tokyo',
  record_start_date: '2026-10-01',
  unit: 'minutes',
  goal_settings_revision: 7,
  unit_history_locked: false,
  question_prior: { a: 'HIGH', b: null },
  answer_revision: '9',
  question_prior_snapshot: null,
  ...overrides,
});

test('Goal行の変換は全設定・記録順・0/nullを保ち、入力を変更しない', () => {
  const answers = Object.freeze({ a: 'HIGH' as const, b: null });
  const savedQuestion = Object.freeze({ version: 'synthetic-unknown', payload: Object.freeze([1, 2]) });
  const goal = Object.freeze(goalRow({
    initial_progress: 3,
    question_prior: answers,
    question_prior_snapshot: savedQuestion,
  }));
  // 順序の決定はSQL、値の検証は呼出側の責務。変換でsortや丸めを足さない。
  const logs: readonly SnapshotLogRow[] = Object.freeze([
    Object.freeze({ local_date: '2026-10-03', status: 'DONE' as const, amount: 12.5 }),
    Object.freeze({ local_date: '2026-10-01', status: 'SKIPPED' as const, amount: null }),
    Object.freeze({ local_date: '2026-10-02', status: 'DONE' as const, amount: 0 }),
  ]);
  const now = new Date('2026-10-12T15:00:00.123Z');
  const before = structuredClone({ goal, logs });
  const result = toTodaySnapshot(goal, logs, now);

  assert.deepEqual(result, {
    now,
    goal: {
      totalRequired: 2147483647,
      initialProgress: 3,
      sessionAmount: 25,
      timezone: 'Asia/Tokyo',
      recordStartDate: '2026-10-01',
      unit: 'minutes',
      goalSettingsRevision: 7,
      unitLocked: true,
    },
    question: {
      question_prior: answers,
      answer_revision: '9',
      question_prior_snapshot: savedQuestion,
    },
    logs: [
      { localDate: '2026-10-03', status: 'DONE', amount: 12.5 },
      { localDate: '2026-10-01', status: 'SKIPPED', amount: null },
      { localDate: '2026-10-02', status: 'DONE', amount: 0 },
    ],
  });
  assert.equal(result.now, now);
  assert.equal(result.question.question_prior, answers);
  assert.equal(result.question.question_prior_snapshot, savedQuestion);
  assert.notEqual(result.logs, logs);
  assert.notEqual(result.logs[0], logs[0]);
  assert.deepEqual({ goal, logs }, before);
  assert.equal(now.toISOString(), '2026-10-12T15:00:00.123Z');
});

test('単位固定は履歴lockか正の開始進捗がある場合だけ有効になる', () => {
  for (const [initialProgress, historyLocked, expected] of [
    [0, false, false],
    [1, false, true],
    [0, true, true],
    [1, true, true],
  ] as const) {
    const result = toTodaySnapshot(goalRow({
      initial_progress: initialProgress,
      unit_history_locked: historyLocked,
      unit: 'sessions',
    }), [], new Date('2026-10-12T00:00:00Z'));
    assert.equal(result.goal.unitLocked, expected, `${initialProgress}/${historyLocked}`);
    assert.equal(result.goal.unit, 'sessions');
  }
});

test('answer_revisionは安全整数境界の前後もstringのまま渡し、検証や補完をしない', () => {
  for (const revision of ['0', '9007199254740991', '9007199254740992']) {
    const result = toTodaySnapshot(goalRow({ answer_revision: revision }), [], new Date(0));
    assert.equal(result.question.answer_revision, revision);
    assert.equal(typeof result.question.answer_revision, 'string');
    assert.equal(result.question.question_prior_snapshot, null);
    assert.deepEqual(result.logs, []);
  }
});
