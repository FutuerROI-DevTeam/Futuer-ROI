import type { Log } from '@contracts';
import { addDays, parseLocalDate } from '../../copy/date.ts';

/**
 * 日ごとの記録の状態（デザイン F1・P1）。記録の一覧をそのまま見るだけで、予測の計算はしない。
 * - done・rest：その日の記録（やった・休んだ）
 * - unrecorded：記録開始日から今日までのうち記録がない日（休んだとは別。R-04 の UNKNOWN）
 * - outside：記録開始日より前、または今日より後（印を出さない）
 */
export type DayState = 'done' | 'rest' | 'unrecorded' | 'outside';

export function dayState(date: string, logs: readonly Log[], recordStartDate: string, today: string): DayState {
  // YYYY-MM-DD どうしなので文字列の比較で日付の前後が分かる
  if (date < recordStartDate || date > today) return 'outside';
  const log = logs.find((l) => l.localDate === date);
  if (!log) return 'unrecorded';
  return log.status === 'DONE' ? 'done' : 'rest';
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 今日までの直近7日（古い順。デザイン P1 の帯）。 */
export function recentDays(today: string, count = 7): string[] {
  return Array.from({ length: count }, (_, i) => iso(addDays(today, i - (count - 1))));
}

/** 「YYYY-MM」の月の、月曜始まりのカレンダーの升目。月の前の空きは null。 */
export function monthCells(month: string): (string | null)[] {
  const first = parseLocalDate(`${month}-01`);
  const lead = (first.getUTCDay() + 6) % 7; // 月曜＝0
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
}

/** 前後の月（「YYYY-MM」）。 */
export function shiftMonth(month: string, delta: number): string {
  const d = parseLocalDate(`${month}-01`);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
  return iso(next).slice(0, 7);
}
