import { useEffect, useRef } from 'react';
import type { Log } from '@contracts';
import { StatusBadge } from '../../ui/components/StatusBadge.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { Icon } from '../../ui/components/Icon.tsx';
import { recordDisplay, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { Link } from '@tanstack/react-router';
import { fullDate, longDate, parseLocalDate, shortDate } from '../../copy/date.ts';
import { choiceFromLog, describeChoice } from '../logs/record-log.ts';

/** 記録済みの日は中心指標を出さず、記録内容と選び直す入口を出す（R-07・#79）。 */
export function RecordedSummary({ todayLog, fmt, onChange, changeDisabled = false }: {
  todayLog: Log;
  fmt: AmountFormat;
  onChange: () => void;
  /** 昨日との同時編集を止める。 */
  changeDisabled?: boolean;
}) {
  return (
    <section className="fr-today__top" aria-labelledby="fr-recorded-title">
      <h1 id="fr-recorded-title" className="fr-today__question" tabIndex={-1}>
        {todayCopy.recordedTitle}
      </h1>
      <div className="fr-recorded">
        <div className="fr-recorded__value">
          <StatusBadge status={todayLog.status === 'DONE' ? 'done' : 'rest'} large />
          {todayLog.status === 'DONE' && todayLog.amount !== null ? (
            <span className="fr-recorded__amount">
              {recordDisplay(fmt, todayLog.amount)}
            </span>
          ) : null}
        </div>
        <Button icon="edit" disabled={changeDisabled} onClick={onChange}>
          {todayCopy.changeRecord}
        </Button>
      </div>
    </section>
  );
}

/** 達成済み（R-08、デザイン D6）。予測は出さない。累計（総量を超えることがある）と総量を出す。 */
export function AchievedPanel({ done, total, fmt }: { done: number; total: number; fmt: AmountFormat }) {
  // 累計と総量（分のGoalは時間＋分、P-18）
  const amount = fmt.total;
  return (
    <section className="fr-today__top fr-achieved" aria-labelledby="fr-achieved-title">
      <span className="fr-achieved__emblem" aria-hidden="true">
        <Icon name="check" size={36} strokeWidth={2.2} />
      </span>
      <h1 id="fr-achieved-title" className="fr-today__question" tabIndex={-1}>
        {todayCopy.achievedTitle}
      </h1>
      <p className="fr-today__summary">
        {todayCopy.achievedAmount(amount(done), amount(total))}
        {todayCopy.achievedBody}
      </p>
    </section>
  );
}

/** 達成済みの記録開始日・届いた日と、一覧へ戻る（デザイン D6 の下部）。 */
export function AchievedFacts({
  goalId,
  recordStartDate,
  reached,
}: {
  goalId: string;
  recordStartDate: string;
  /** 届いた日。null は記録開始前（初期量）で届いていた、undefined は記録からたどれなかった。 */
  reached: string | null | undefined;
}) {
  return (
    <section className="fr-achieved-facts" aria-label={todayCopy.achievedTitle}>
      <dl className="fr-achieved-facts__list">
        <div>
          <dt>{todayCopy.achievedStart}</dt>
          <dd>{fullDate(recordStartDate)}</dd>
        </div>
        {reached !== undefined ? (
          <div>
            <dt>{todayCopy.achievedReached}</dt>
            <dd>{reached === null ? todayCopy.achievedBeforeStart : fullDate(reached)}</dd>
          </div>
        ) : null}
      </dl>
      <Link to="/goals/$goalId/history" params={{ goalId }} className="fr-btn fr-btn--text">
        <Icon name="calendar" size={18} />
        {todayCopy.historyLink}
      </Link>
      <Link to="/goals" className="fr-btn fr-btn--secondary fr-btn--block">
        {todayCopy.backToList}
      </Link>
    </section>
  );
}

/**
 * 今日の記録を選び直している間の上部（デザイン D5-change）。いまの記録を見せる。
 * 「変更をやめる」はスクロールしても押せるよう、下の記録の欄（RecordChoiceBar）に置く（#221）。
 */
export function ChangeHeader({ log, sessionAmount, fmt }: { log: Log; sessionAmount: number; fmt: AmountFormat }) {
  const record = describeChoice(choiceFromLog(log), sessionAmount, (n) => recordDisplay(fmt, n), todayCopy.recordedRest);
  // 「記録を変更」を押すとそのボタンが消えるので、この見出しへフォーカスを移す
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section className="fr-today__top" aria-labelledby="fr-change-title">
      <h1 id="fr-change-title" className="fr-today__question" tabIndex={-1} ref={headingRef}>
        {todayCopy.changeTitle}
      </h1>
      <p className="fr-today__summary">{todayCopy.changeCurrent(record)}</p>
    </section>
  );
}

/**
 * 達成済みの画面で、今日の記録を直す入口（R-03・R-08）。誤った量で達成済みになっても、正しい量や「休んだ」へ直せるようにする。
 * 押すと下の記録の2択が選び直しの状態になる。記録済みの昨日の要約行と同じ形にそろえる。
 */
export function TodayRecordLine({ log, today, sessionAmount, fmt, onChange, changeDisabled = false }: {
  log: Log;
  today: string;
  sessionAmount: number;
  fmt: AmountFormat;
  onChange: () => void;
  changeDisabled?: boolean;
}) {
  const record = describeChoice(choiceFromLog(log), sessionAmount, (n) => recordDisplay(fmt, n), todayCopy.recordedRest);
  return (
    <section className="fr-yesterday fr-yesterday--summary" aria-label={todayCopy.recordedTitle}>
      <p className="fr-yesterday__summary">{todayCopy.todaySummary(shortDate(parseLocalDate(today)), record)}</p>
      <Button variant="text" icon="edit" aria-label={todayCopy.todayChangeLabel(longDate(today))} disabled={changeDisabled} onClick={onChange}>
        {todayCopy.yesterdayChange}
      </Button>
    </section>
  );
}
