// 日付の表示。基準日は API が返す today（Goal の timezone での暦日 YYYY-MM-DD）で、ブラウザの時計は使わない。
// 暦日だけを扱うので、UTC の日付として計算して時差の影響を受けないようにする。

/** 1日のミリ秒。暦日の差や日数の加算に使う。 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 曜日の表示（getUTCDay の順＝日曜始まり）。 */
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError(`Invalid local date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** today に days 日を足した日。Engine の日数は「明日が1日目」。 */
export function addDays(today: string, days: number): Date {
  return new Date(parseLocalDate(today).getTime() + days * DAY_MS);
}

/** その日を含む週の月曜日。 */
export function mondayOf(date: Date): Date {
  const offset = (date.getUTCDay() + 6) % 7; // 月曜＝0
  return new Date(date.getTime() - offset * DAY_MS);
}

/**
 * 日数が null なら日付を補わない。年付きの到達予定日と取り違えないよう、
 * 週の月曜日が予測の today と違う年なら年を付ける（#278）。
 */
export function weekLabel(today: string, days: number | null): string | null {
  if (days === null) return null;
  const monday = mondayOf(addDays(today, days));
  const year = monday.getUTCFullYear() === parseLocalDate(today).getUTCFullYear()
    ? ''
    : `${monday.getUTCFullYear()}年`;
  return `${year}${monday.getUTCMonth() + 1}月${monday.getUTCDate()}日の週`;
}

/** 「10/5」。図の短いラベル用。 */
export function shortDate(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

/** 「10月5日（月）」。 */
export function longDate(value: string): string {
  const date = parseLocalDate(value);
  const weekday = WEEKDAY_LABELS[date.getUTCDay()] ?? '';
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekday}）`;
}

/** 「2026年10月5日」。達成済みの記録開始日・届いた日など、年をまたぐ日付に使う。 */
export function fullDate(value: string): string {
  const date = parseLocalDate(value);
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / DAY_MS);
}

export { parseLocalDate };
