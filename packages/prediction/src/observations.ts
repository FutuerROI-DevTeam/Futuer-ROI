import type { PredictionInput, TransitionCounts } from './types.js';
import { PredictionInputError } from './errors.js';

// Gregorian暦の日数を整数で計算して隣接日を判定する。UTCへの変換や実行環境のtimezoneに依存させない。
function ordinal(localDate: string, path: readonly (string | number)[]): number {
  if (typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new PredictionInputError('INVALID_LOCAL_DATE', path, 'Expected a YYYY-MM-DD calendar date');
  }
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  const day = Number(localDate.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > months[month - 1]!) {
    throw new PredictionInputError('INVALID_LOCAL_DATE', path, 'Invalid Gregorian calendar date');
  }
  const previousYear = year - 1;
  let days = 365 * previousYear + Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) + Math.floor(previousYear / 400) + day;
  for (let index = 0; index < month - 1; index++) {
    days += months[index]!;
  }

  return days;
}

function quantity(value: number, minimum: number, path: readonly (string | number)[]): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new PredictionInputError('INVALID_QUANTITY', path, `Quantity must be a safe integer >= ${minimum}`);
  }
}

export function observe(input: PredictionInput): {
  counts: TransitionCounts;
  actualDone: number;
  todayStatus: 'DONE' | 'SKIPPED' | 'UNRECORDED';
  // Architectureのstep1で使う観測窓の事実を、採択済みResultの日数metadataへ渡す。
  // ログが空なら観測開始日を特定できない。初期進捗だけから日付を推測しない。
  observationWindow: { startOrdinal: number; endOrdinal: number; calendarSlots: number } | null;
  recordedLogCount: number;
} {
  quantity(input.goal.totalRequired, 1, ['goal', 'totalRequired']);
  quantity(input.goal.initialProgress, 0, ['goal', 'initialProgress']);
  quantity(input.goal.sessionAmount, 1, ['goal', 'sessionAmount']);
  const todayOrdinal = ordinal(input.today, ['today']);
  const seen = new Set<number>();
  let actualDone = input.goal.initialProgress;
  let todayStatus: 'DONE' | 'SKIPPED' | 'UNRECORDED' = 'UNRECORDED';
  const logs = input.logs.map((log, index) => {
    const datePath = ['logs', index, 'localDate'];
    const day = ordinal(log.localDate, datePath);
    if (day > todayOrdinal) {
      throw new PredictionInputError('FUTURE_LOG_DATE', datePath, 'Future log date');
    }
    if (seen.has(day)) {
      throw new PredictionInputError('DUPLICATE_LOG_DATE', datePath, 'Duplicate log date');
    }
    seen.add(day);

    if (log.status === 'DONE') {
      if (log.amount === null) {
        throw new PredictionInputError(
          'INVALID_LOG_AMOUNT',
          ['logs', index, 'amount'],
          'DONE requires actual amount',
        );
      }
      quantity(log.amount, 1, ['logs', index, 'amount']);
      actualDone += log.amount;
      if (!Number.isSafeInteger(actualDone)) {
        throw new PredictionInputError(
          'UNSAFE_PROGRESS',
          ['logs', index, 'amount'],
          'Accumulated progress exceeds exact integer range',
        );
      }
    } else if (log.status !== 'SKIPPED') {
      throw new PredictionInputError('INVALID_LOG_STATUS', ['logs', index, 'status'], 'UNKNOWN is not a stored status');
    } else if (log.amount !== null) {
      throw new PredictionInputError('INVALID_LOG_AMOUNT', ['logs', index, 'amount'], 'SKIPPED requires null amount');
    }
    if (day === todayOrdinal) {
      todayStatus = log.status;
    }
    return { day, status: log.status };
  }).sort((left, right) => left.day - right.day);

  const counts: TransitionCounts = { nDD: 0, nDS: 0, nSD: 0, nSS: 0 };
  for (let index = 1; index < logs.length; index++) {
    const before = logs[index - 1]!;
    const after = logs[index]!;
    // 記録のない暦日はUNKNOWN。欠けた日を跨いで前後の記録を隣接ペアにしない。
    if (after.day !== before.day + 1) {
      continue;
    }
    if (before.status === 'DONE') {
      if (after.status === 'DONE') {
        counts.nDD++;
      } else {
        counts.nDS++;
      }
    } else if (after.status === 'DONE') {
      counts.nSD++;
    } else {
      counts.nSS++;
    }
  }

  const first = logs[0];
  const endOrdinal = todayOrdinal - (todayStatus === 'UNRECORDED' ? 1 : 0);
  const observationWindow = first ? {
    startOrdinal: first.day, endOrdinal, calendarSlots: endOrdinal - first.day + 1,
  } : null;
  return { counts, actualDone, todayStatus, observationWindow, recordedLogCount: seen.size };
}
