/** Goalの暦日とIANA timezoneの共通変換。保存・日付切替・予測の状態判断はcallerが持つ。 */
export function isValidTimezone(timezone: string): boolean {
  if (timezone.length === 0 || timezone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function localDateIn(timezone: string, at: Date): string | null {
  try {
    // en-CA は YYYY-MM-DD の並びで出る
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return null;
  }
}

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
