import { addDays, daysBetween, mondayOf } from '../../copy/date.ts';

/*
 * 到達予定日とのずれ（#157、Product Spec P-19 のB案）。
 * 完了の目安・余裕をみるならは「○月○日の週」で出しているので、その週の月曜日と到達予定日の差をずれとする。
 * Engine の日数（今日から何日目か）をそのまま使い、FE で予測を計算し直さない（日付の差を数えるだけ）。
 */

export type TargetGap =
  | { kind: 'near' }
  /** weeks か months のどちらか（8週未満は週、それ以上は月で丸める）。 */
  | { kind: 'early' | 'late'; weeks: number; months: number | null };

/** 到達予定日と週の月曜日の差が、この日数以内なら「到達予定日ごろ」とする。 */
const NEAR_DAYS = 3;
/** 週で書く上限（これ以上は月で書く）。 */
const WEEKS_LIMIT = 8;

function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * 到達予定日が今日以前か（#186）。日付はどちらも YYYY-MM-DD（Goal の timezone の今日）なので文字列で比べられる。
 * 今日以前なら、週の月曜日と比べたずれ（「早い」「ごろ」）は意味を持たないため出さない。
 */
export function targetDateState(today: string, targetDate: string): 'past' | 'today' | 'ahead' {
  if (targetDate < today) return 'past';
  return targetDate === today ? 'today' : 'ahead';
}

/** days 日目を含む週の月曜日と到達予定日のずれ。日数なし・今日以前の予定日は null。 */
export function targetGap(today: string, days: number | null, targetDate: string): TargetGap | null {
  if (days === null || targetDateState(today, targetDate) !== 'ahead') return null;
  const monday = isoOf(mondayOf(addDays(today, days)));
  const diff = daysBetween(targetDate, monday); // 正なら到達予定日より後（遅い）
  if (Math.abs(diff) <= NEAR_DAYS) return { kind: 'near' };
  const weeks = Math.round(Math.abs(diff) / 7);
  const months = weeks >= WEEKS_LIMIT ? Math.max(2, Math.round(Math.abs(diff) / 30.44)) : null;
  return { kind: diff > 0 ? 'late' : 'early', weeks, months };
}

/** 「約8週早い」「約3か月遅い」「到達予定日ごろ」。 */
export function targetGapText(gap: TargetGap): string {
  if (gap.kind === 'near') return '到達予定日ごろ';
  const amount = gap.months !== null ? `約${gap.months}か月` : `約${Math.max(1, gap.weeks)}週`;
  return `${amount}${gap.kind === 'early' ? '早い' : '遅い'}`;
}

/** 今日から到達予定日まで何日目か（日付の軸に置くため）。 */
export const daysUntil = (today: string, targetDate: string): number => daysBetween(today, targetDate);
