import test from 'node:test';
import assert from 'node:assert/strict';
import { observe } from '../dist/src/observations.js';
import { predict, DEFAULT_CONFIG, PredictionInputError, PredictionConfigError } from '../dist/src/index.js';

const goal = { totalRequired: 100, initialProgress: 0, sessionAmount: 10 };
const today = '2026-10-10';
const done = day => ({ localDate: `2026-10-${String(day).padStart(2, '0')}`, status: 'DONE', amount: 1 });
const skipped = day => ({ ...done(day), status: 'SKIPPED', amount: null });
const config = { ...DEFAULT_CONFIG, samples: 10, horizonDays: 20 };
// 固定UTCの日付変換はテスト用の独立参照だけで使う。Engine本体は整数演算で、環境依存の日付処理を使わない。
const ordinalOracle = date => Date.parse(`${date}T00:00:00Z`) / 86400000 + 719163;

test('window facts cover empty, today, yesterday, UNKNOWN, reverse order and initial-only progress', () => {
  const cases = [
    { logs: [], start: null, end: null, slots: null, count: 0, initial: 0 },
    { logs: [done(10)], start: 10, end: 10, slots: 1, count: 1, initial: 0 },
    { logs: [skipped(10)], start: 10, end: 10, slots: 1, count: 1, initial: 0 },
    { logs: [done(9)], start: 9, end: 9, slots: 1, count: 1, initial: 0 },
    { logs: [done(7), skipped(8), done(9)], start: 7, end: 9, slots: 3, count: 3, initial: 0 },
    { logs: [done(3), skipped(9)], start: 3, end: 9, slots: 7, count: 2, initial: 0 },
    { logs: [done(3)], start: 3, end: 9, slots: 7, count: 1, initial: 0 },
    { logs: [done(9), skipped(3), done(5)], start: 3, end: 9, slots: 7, count: 3, initial: 0 },
    { logs: [], start: null, end: null, slots: null, count: 0, initial: 12 },
    { logs: [], start: null, end: null, slots: null, count: 0, initial: 100 },
    { logs: [done(3), skipped(9)], start: 3, end: 9, slots: 7, count: 2, initial: 100 },
  ];
  for (const row of cases) {
    const input = { goal: { ...goal, initialProgress: row.initial }, today, logs: row.logs };
    const before = structuredClone(input);
    const facts = observe(input);
    assert.equal(facts.recordedLogCount, row.count);
    assert.equal(facts.observationWindow?.calendarSlots ?? null, row.slots);
    if (row.start === null) {
      assert.equal(facts.observationWindow, null);
    } else {
      assert.equal(facts.observationWindow.startOrdinal, ordinalOracle(done(row.start).localDate));
      assert.equal(facts.observationWindow.endOrdinal, ordinalOracle(done(row.end).localDate));
    }
    assert.deepEqual(input, before);
    const result = predict(input, config);
    assert.equal(result.observations.observedDays, row.slots ?? 0);
    assert.equal(result.observations.recordedDays, row.count);
    if (row.initial >= goal.totalRequired) {
      assert.equal(result.completion.status, 'completed');
    }
  }
});

test('window facts include leap days and do not turn gaps into transitions', () => {
  const input = { goal, today: '2024-03-02', logs: [
    { localDate: '2024-02-28', status: 'DONE', amount: 1 },
    { localDate: '2024-03-01', status: 'SKIPPED', amount: null },
  ] };
  const facts = observe(input);
  assert.equal(facts.observationWindow.calendarSlots, 3);
  assert.equal(facts.recordedLogCount, 2);
  assert.deepEqual(facts.counts, { nDD: 0, nDS: 0, nSD: 0, nSS: 0 });
});

test('input errors preserve original field paths and reject invalid facts before completed', () => {
  const input = { goal: { ...goal, initialProgress: 100 }, today, logs: [] };
  const cases = [
    [{ ...input, logs: [done(11)] }, 'FUTURE_LOG_DATE', ['logs', 0, 'localDate']],
    [{ ...input, logs: [done(9), skipped(9)] }, 'DUPLICATE_LOG_DATE', ['logs', 1, 'localDate']],
    [{ ...input, today: '2026-02-29' }, 'INVALID_LOCAL_DATE', ['today']],
    [{ ...input, logs: [{ ...done(9), localDate: '2026-02-29' }] }, 'INVALID_LOCAL_DATE', ['logs', 0, 'localDate']],
    [{ ...input, goal: { ...goal, sessionAmount: 0 } }, 'INVALID_QUANTITY', ['goal', 'sessionAmount']],
    [{ ...input, logs: [{ ...done(9), amount: null }] }, 'INVALID_LOG_AMOUNT', ['logs', 0, 'amount']],
    [{ ...input, logs: [{ ...skipped(9), amount: 1 }] }, 'INVALID_LOG_AMOUNT', ['logs', 0, 'amount']],
    [{ ...input, logs: [{ ...done(9), status: 'UNKNOWN' }] }, 'INVALID_LOG_STATUS', ['logs', 0, 'status']],
    [{ ...input, goal: { ...goal, initialProgress: Number.MAX_SAFE_INTEGER }, logs: [done(9)] }, 'UNSAFE_PROGRESS', ['logs', 0, 'amount']],
  ];
  for (const [bad, reason, path] of cases) {
    for (const call of [() => observe(bad), () => predict(bad, config)]) {
      assert.throws(call, error => {
        assert.ok(error instanceof PredictionInputError && error instanceof RangeError);
        assert.equal(error.reason, reason);
        assert.deepEqual(error.path, path);
        assert.ok(Object.isFrozen(error.path));
        assert.equal('statusCode' in error, false);
        assert.equal('code' in error, false);
        return true;
      });
    }
  }
});

test('config errors are separate from caller data errors and carry no HTTP mapping', () => {
  const input = { goal, today, logs: [done(7), skipped(8), done(9)] };
  for (const [changed, reason, path] of [
    [{ prior: 1.5 }, 'INVALID_INTEGER', ['prior']],
    [{ samples: 0 }, 'INVALID_INTEGER', ['samples']],
    [{ seed: -1 }, 'INVALID_SEED', ['seed']],
    [{ modelVersion: 'unimplemented' }, 'UNSUPPORTED_MODEL', ['modelVersion']],
    [{ prior: Number.MAX_SAFE_INTEGER }, 'UNSAFE_POSTERIOR', ['posterior', 'a', 'beta']],
  ]) {
    assert.throws(() => predict(input, { ...config, ...changed }), error => {
      assert.ok(error instanceof PredictionConfigError && error instanceof RangeError);
      assert.equal(error instanceof PredictionInputError, false);
      assert.equal(error.reason, reason);
      assert.deepEqual(error.path, path);
      assert.equal('statusCode' in error, false);
      assert.equal('code' in error, false);
      return true;
    });
  }
});
