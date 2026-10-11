import { calendarOrdinal, observe } from './observations.js';
import type { PredictionInput } from './types.js';
import type { DurationTransition } from './duration-types.js';

export interface DurationRecord {
  readonly localDate: string; readonly status: 'DONE' | 'SKIPPED';
  readonly restDays: number | null; readonly minimumRestDays: number;
  readonly restAgeKnowledge: 'EXACT' | 'CAPPED_LOWER_BOUND' | 'UNKNOWN';
}
/** Each stored adjacent pair exactly once. A missing day resets knowledge, not effort. */
export function observeDuration(input: PredictionInput, capDays: number): {
  records: readonly DurationRecord[]; transitions: readonly DurationTransition[];
} {
  if (!Number.isSafeInteger(capDays) || capDays < 2 || capDays > 30) throw new RangeError('Duration cap must be an integer between 2 and 30');
  observe(input); // shared Gregorian, duplicate, amount/status and future-date validation
  const ordered = [...input.logs].sort((a, b) => a.localDate.localeCompare(b.localDate));
  const records: DurationRecord[] = [];
  const transitions: DurationTransition[] = [];
  for (const log of ordered) {
    const before = records.at(-1);
    const consecutive = before !== undefined && calendarOrdinal(log.localDate, []) === calendarOrdinal(before.localDate, []) + 1;
    if (consecutive) transitions.push({ from: before.status, to: log.status, restDays: before.restDays,
      originDate: before.localDate, outcomeDate: log.localDate });
    if (log.status === 'DONE') records.push({ localDate: log.localDate, status: log.status,
      restDays: 0, minimumRestDays: 0, restAgeKnowledge: 'EXACT' });
    else {
      const minimumRestDays = consecutive && before.status === 'SKIPPED' ? Math.min(capDays, before.minimumRestDays + 1) : 1;
      const exact = consecutive && (before.status === 'DONE' || before.restAgeKnowledge === 'EXACT');
      const restDays = exact ? Math.min(capDays, (before.restDays ?? 0) + 1) : minimumRestDays >= capDays ? capDays : null;
      records.push({ localDate: log.localDate, status: log.status, restDays, minimumRestDays,
        restAgeKnowledge: exact ? 'EXACT' : restDays === null ? 'UNKNOWN' : 'CAPPED_LOWER_BOUND' });
    }
  }
  return { records, transitions };
}
