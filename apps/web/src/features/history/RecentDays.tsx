import type { Log } from '@contracts';
import { longDate, WEEKDAY_LABELS } from '../../copy/date.ts';
import { todayCopy } from '../../copy/today.ts';
import { dayState, recentDays } from './calendar.ts';
import { DayMark } from './DayMark.tsx';
import './history.css';

/**
 * 直近7日の帯（デザイン P1）。問いの上に置き、日付ごとの記録を印で見せる。
 * 記録を変えられるのは今日と昨日だけ（R-03・R-04）なので、押せるのはその2日だけにする：
 * 昨日＝記録済みなら訂正を始める、今日＝記録済みなら選び直しを始める。それ以外の日は見るだけ。
 */
export function RecentDays({
  today,
  yesterday,
  recordStartDate,
  logs,
  onYesterday,
  onToday,
}: {
  today: string;
  yesterday: string;
  recordStartDate: string;
  logs: readonly Log[];
  onYesterday?: (() => void) | undefined;
  onToday?: (() => void) | undefined;
}) {
  return (
    <ul className="fr-recent" aria-label={todayCopy.recentDays}>
      {recentDays(today).map((date) => {
        const state = dayState(date, logs, recordStartDate, today);
        const weekday = WEEKDAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
        const isToday = date === today;
        const action = isToday ? onToday : date === yesterday ? onYesterday : undefined;
        const label = `${longDate(date)}${isToday ? `・${todayCopy.recentToday}` : ''}${state === 'outside' ? '' : ` ${todayCopy.dayStateLabel[state]}`}`;
        const body = (
          <>
            <span aria-hidden="true">{weekday}</span>
            <DayMark state={state} size={28} />
            <span aria-hidden="true">{Number(date.slice(8, 10))}</span>
          </>
        );
        return (
          <li key={date}>
            {action ? (
              <button type="button" className={`fr-recent__day${isToday ? ' fr-recent__day--today' : ''}`} aria-label={label} onClick={action}>
                {body}
              </button>
            ) : (
              <span className={`fr-recent__day${isToday ? ' fr-recent__day--today' : ''}`} aria-label={label} role="img">
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
