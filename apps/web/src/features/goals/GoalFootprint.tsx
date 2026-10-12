import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { longDate, shortDate, parseLocalDate } from '../../copy/date.ts';
import { Button } from '../../ui/components/Button.tsx';
import { buildFootprint, type FootprintSource } from './footprint.ts';

/** 日の種類 → 読み上げ・選択日の表示に使う文言。 */
const DAY_KIND_LABELS = { done: '実施', rest: '休みの記録あり', unrecorded: '実施の記録なし', unconfirmed: '未確認', 'before-start': '記録開始前' } as const;
/** 矢印キーで動く日数。上下は2週間（帯は2段で表示するため）。 */
const ARROW_KEY_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -14, ArrowDown: 14 };

/** 一覧上部に一つだけ置く全Goal共通の足跡。取得・保存はPageが担う。 */
export function GoalFootprint({ sources, onRefresh }: { sources: readonly FootprintSource[]; onRefresh: () => void }) {
  const footprint = buildFootprint(sources);
  const [selected, setSelected] = useState<string | null>(null);
  const date = footprint.days.some(day => day.date === selected) ? selected : footprint.today;
  const active = footprint.days.find(day => day.date === date);
  const scroller = useRef<HTMLDivElement>(null);
  const keyboardFocus = useRef(false);
  const selectedButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [footprint.today]);
  useEffect(() => {
    if (keyboardFocus.current) {
      keyboardFocus.current = false;
      selectedButton.current?.focus();
    }
  }, [date]);
  if (!footprint.today) return null;
  return <section className="fr-footprint" aria-labelledby="fr-footprint-title">
    <header className="fr-footprint__head">
      <h2 id="fr-footprint-title">取り組みの足跡 <span>最近4週間</span></h2>
      <span className="fr-footprint__streak">{footprint.streak === null ? '連続実施は確認中' : `連続実施 ${footprint.streak}日`}</span>
    </header>
    <div className="fr-footprint__scroll" ref={scroller}>
      <div className="fr-footprint__days" aria-label="日付を選ぶと取り組んだGoalが表示されます">
        {footprint.days.map((day, index) => <button key={day.date} type="button"
          ref={day.date === date ? selectedButton : undefined} className={`fr-footprint__day fr-footprint__day--${day.kind}`}
          aria-label={`${longDate(day.date)} ${DAY_KIND_LABELS[day.kind]}${day.goals.length ? ` ${day.goals.length}Goal` : ''}${!day.complete ? ' 一部未確認' : ''}`}
          aria-pressed={day.date === date} tabIndex={day.date === date ? 0 : -1}
          onClick={() => setSelected(day.date)} onKeyDown={event => {
            const move = ARROW_KEY_STEPS[event.key];
            const next = event.key === 'Home' ? 0
              : event.key === 'End' ? footprint.days.length - 1
              : move !== undefined ? index + move : null;
            if (next === null) return;
            event.preventDefault();
            const target = footprint.days[Math.max(0, Math.min(footprint.days.length - 1, next))];
            if (target) {
              keyboardFocus.current = true;
              setSelected(target.date);
            }
          }}>
          <span className="fr-footprint__mark" aria-hidden="true">{day.kind === 'done' ? '✓' : day.kind === 'rest' ? '休' : day.kind === 'unconfirmed' ? '?' : ''}</span>
          <span>{shortDate(parseLocalDate(day.date))}</span>
        </button>)}
      </div>
    </div>
    <div className="fr-footprint__selection" aria-live="polite" aria-atomic="true">
      <span>{date ? longDate(date) : ''}：</span>
      {active?.goals.length ? active.goals.map(goal => <Link key={goal.id} to="/goals/$goalId" params={{ goalId: goal.id }}>{goal.title}</Link>) :
        <span>{active ? DAY_KIND_LABELS[active.kind] : '確認中'}</span>}
      {active && !active.complete && active.goals.length > 0 ? <span>ほかのGoalは未確認</span> : null}
    </div>
    <p className="fr-footprint__note">✓ 実施 · 休 休みの記録 · ? 未確認。各Goalの記録日で集計し、量は合算しません。削除したGoalは含みません。</p>
    {!footprint.sameToday ? <p className="fr-footprint__note">Goalによって今日の日付が異なるため、連続日数は保留しています。</p> : null}
    {!footprint.complete ? <Button variant="text" onClick={onRefresh}>足跡を再読み込み</Button> : null}
  </section>;
}
