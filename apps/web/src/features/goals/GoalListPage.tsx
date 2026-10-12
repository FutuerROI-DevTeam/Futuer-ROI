import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import type { Goal } from '@contracts';
import { goalKeys, goalsHttp } from '../../api/goals-http.ts';
import { privateDataReady, usePrivateEpoch } from '../../api/session-cache.ts';
import { appCopy } from '../../copy/app.ts';
import { goalsCopy } from '../../copy/goals.ts';
import { longDate } from '../../copy/date.ts';
import { amountFormat } from '../../copy/amount.ts';
import { progressPercent, progressPercentLabel, progressPercentQualifier } from '../../copy/progress.ts';
import { todayHttp, todayKeys } from '../../api/today-http.ts';
import { GoalFootprint } from './GoalFootprint.tsx';
import { AppBar } from '../../ui/components/AppBar.tsx';
import { Icon } from '../../ui/components/Icon.tsx';
import { PageTitle } from '../../ui/components/PageTitle.tsx';
import { StatusBadge } from '../../ui/components/StatusBadge.tsx';
import { Band } from '../../ui/components/Section.tsx';
import { AccountMenu } from '../account/AccountMenu.tsx';
import { fetchPolicy } from '../today/fetch-policy.ts';
import { shouldRefetchForNewDay } from '../today/day-rollover.ts';
import { useEvaluationCapability } from '../evaluation/useEvaluation.ts';
import '../evaluation/evaluation.css';
import { LoadErrorPanel, SignedOutPanel } from './GoalStates.tsx';
import '../../ui/tokens.css';
import '../../ui/page.css';
import '../../ui/components/Button.css';
import './goals.css';

const c = goalsCopy;
/** API の今日の記録状態 → StatusBadge の種類。 */
const TODAY_STATUS_BADGE = { DONE: 'done', SKIPPED: 'rest', UNRECORDED: 'unrecorded' } as const;

/** 端末の今日（YYYY-MM-DD）。一覧の日付の見出しだけに使う（各Goalの「今日」は API が Goal の timezone で返す）。 */
function browserToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Goal 一覧（R-02、#78）。/goals */
export function GoalListPage() {
  const current = usePrivateEpoch();
  const capability = useEvaluationCapability();
  const ready = privateDataReady(current);
  const query = useQuery({
    queryKey: goalKeys.list(),
    queryFn: ({ signal }) => goalsHttp.listGoals(signal),
    enabled: ready,
    ...fetchPolicy,
  });
  const fresh = ready && query.dataUpdatedAt > current.clearedAt;
  const footprintGoals = [...new Map((fresh && !query.isError ? query.data ?? [] : []).map(goal => [goal.id, goal] as const)).values()];
  const histories = useQueries({
    queries: footprintGoals.map(goal => ({
      queryKey: todayKeys.logs(goal.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => todayHttp.listLogs(goal.id, signal),
      enabled: ready,
      ...fetchPolicy,
    })),
  });
  const footprintSources = footprintGoals.map((goal, index) => {
    const history = histories[index];
    return {
      goal,
      logs: history && !history.isError && !history.isFetching && !query.isFetching
        && history.dataUpdatedAt > current.clearedAt ? history.data ?? null : null,
    };
  });
  useEffect(() => {
    if (!fresh || !query.data || query.isFetching) return;
    const goals = query.data;
    const timer = setInterval(() => {
      if (goals.some(goal => shouldRefetchForNewDay(goal.timezone, goal.today, new Date()))) {
        void query.refetch();
        for (const history of histories) void history.refetch();
      }
    }, 30_000);
    return () => clearInterval(timer);
    // Goal一覧/取得状態の変更時に、その一覧の履歴observerへ付け替える。
  }, [fresh, query.data, query.isFetching]);

  return (
    <div className="fr fr-page fr-page--list">
      <PageTitle title={c.listTitle} />
      {/* 上のバー：アプリ名とアカウント（デザイン B-home・B-account） */}
      <AppBar title={appCopy.name} trailing={<AccountMenu />} />
      <div className="fr-goals__head">
        <section className="fr-goals__top">
          <p className="fr-goals__date">{longDate(browserToday())}</p>
          <h1 className="fr-goals__heading">{c.listTitle}</h1>
          <p className="fr-goals__intro">{c.listIntro}</p>
        </section>
        {/* Goal があるときは見出しのそばに作成への導線を置く。 */}
        {fresh && query.data && query.data.length > 0 ? (
          <Link to="/goals/new" className="fr-btn fr-btn--secondary fr-goals__add-top">
            <Icon name="plus" size={18} />
            {c.add}
          </Link>
        ) : null}
      </div>

      {footprintGoals.length > 0 ? <GoalFootprint sources={footprintSources} onRefresh={() => {
        void query.refetch();
        for (const history of histories) void history.refetch();
      }} /> : null}

      {current.owner === null ? (
        <div className="fr-goals__pad"><SignedOutPanel /></div>
      ) : !ready || query.isPending || (query.data !== undefined && !fresh) ? (
        <ListLoading />
      ) : query.isError ? (
        <div className="fr-goals__pad">
          <LoadErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        </div>
      ) : query.data.length === 0 ? (
        <EmptyGoals />
      ) : (
        <ul className="fr-goals__list">
          {query.data.map((goal) => (
            <GoalRow key={goal.id} goal={goal} evaluationEnabled={capability.data?.enabled === true} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 一覧の1行（デザイン B-home）。行全体で Today を開く。編集は Today の上のバーから。
 * 累計は API の progressDone（Today の予測の累計と同じ数え方）をそのまま出し、FE で計算しない。
 * 進捗バーは総量を超えたら満杯で止める（数字は超えた値のまま出す、R-08）。
 */
function GoalRow({ goal, evaluationEnabled }: { goal: Goal; evaluationEnabled: boolean }) {
  // 累計と総量（分のGoalは時間＋分、P-18）
  const fmt = amountFormat(goal);
  const percent = progressPercent(goal.progressDone, goal.totalRequired);
  const achieved = goal.progressDone >= goal.totalRequired;
  return (
    <li className="fr-goals__row">
      <Link to="/goals/$goalId" params={{ goalId: goal.id }} className="fr-goals__open">
        <span className="fr-goals__row-top">
          <span className="fr-goals__title">{goal.title}</span>
          <span className="fr-goals__row-end">
            {achieved ? <span className="fr-goals__achieved">達成</span> : <StatusBadge status={TODAY_STATUS_BADGE[goal.todayStatus]} />}
          </span>
        </span>
        <span className="fr-goals__row-sub">
          <span className="fr-goals__amount">
            {fmt.total(goal.progressDone)}{' '}
          </span>
          <span className="fr-goals__amount-total">目標 {fmt.total(goal.totalRequired)} · {progressPercentLabel(goal.progressDone, goal.totalRequired)}%{progressPercentQualifier(goal.progressDone, goal.totalRequired)}</span>
          {goal.initialProgress > 0 ? <span className="fr-goals__initial">記録開始前の {fmt.total(goal.initialProgress)} を含む</span> : null}
        </span>
        <span
          className="fr-goals__track"
          role="progressbar"
          aria-label={c.progressLabel(goal.title)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="fr-goals__fill" style={{ width: `${percent}%` }} />
        </span>
        <span className="fr-goals__row-foot">
          <span>{achieved ? '決めた総量に届きました' : c.todayStatus[goal.todayStatus]}</span>
          <span className="fr-goals__next">
            {achieved ? '積み上げを見る' : goal.todayStatus === 'UNRECORDED' ? '今日を記録する' : '今日の記録を見る'}
            <Icon name="chevronRight" size={18} />
          </span>
        </span>
      </Link>
      {evaluationEnabled ? <Link to="/goals/$goalId/evaluation" params={{ goalId: goal.id }} className="fr-evaluation__nav">予測と実績の記録</Link> : null}
    </li>
  );
}

function EmptyGoals() {
  return (
    <Band labelledBy="fr-goals-empty">
      <h2 className="fr-goals__band-title" id="fr-goals-empty">
        {c.empty.title}
      </h2>
      <p className="fr-goals__body">{c.empty.body}</p>
      <p className="fr-goals__help">{c.empty.examples}</p>
      <Link to="/goals/new" className="fr-btn fr-btn--primary fr-btn--block">
        <Icon name="plus" size={18} />
        {c.empty.action}
      </Link>
    </Band>
  );
}

function ListLoading() {
  return (
    <>
      <p className="fr-sr-only" role="status">
        {c.loading}
      </p>
      <ul className="fr-goals__list" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="fr-goals__row fr-goals__row--skeleton">
            <span className="fr-skel fr-skel--title" />
            <span className="fr-skel fr-skel--line" />
          </li>
        ))}
      </ul>
    </>
  );
}
