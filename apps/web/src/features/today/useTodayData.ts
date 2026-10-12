import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { GoalR11, Log, TodayR11 } from '@contracts';
import { goalKeys, goalsHttp } from '../../api/goals-http.ts';
import { todayHttp, todayKeys } from '../../api/today-http.ts';
import { shouldRefetchForNewDay } from './day-rollover.ts';
import { fetchPolicy } from './fetch-policy.ts';
import { isSameSnapshot } from './snapshot.ts';

export type TodaySnapshot = { goal: GoalR11; today: TodayR11; logs: Log[] };

/** 食い違いの再取得上限。超えたら再読み込みの案内を出す。 */
const MAX_RESYNC = 3;
/** Goal の timezone で日付の切り替わりを確かめる間隔。 */
const DAY_CHECK_MS = 30_000;

/**
 * Goal・Today・記録の取得と、整合した snapshot の採用を所有する。
 * - 食い違う間は最後の整合 snapshot を保持し、新しい見出しと古い見通しを混ぜない。
 * - Goal の timezone で日付が変わったら、API の「今日」が進むまで再取得する。取得中は重ねない。
 * - notBefore 以下の応答は採用しない。owner 再確認中は ∞ を渡す（D-30）。
 */
export function useTodayData(goalId: string, notBefore = 0) {
  const goalQuery = useQuery({
    queryKey: goalKeys.detail(goalId),
    queryFn: ({ signal }) => goalsHttp.getGoal(goalId, signal),
    ...fetchPolicy,
  });
  const todayQuery = useQuery({
    queryKey: todayKeys.today(goalId),
    queryFn: ({ signal }) => todayHttp.getToday(goalId, signal),
    ...fetchPolicy,
  });
  const logsQuery = useQuery({
    queryKey: todayKeys.logs(goalId),
    queryFn: ({ signal }) => todayHttp.listLogs(goalId, signal),
    ...fetchPolicy,
  });
  const refresh = () => void Promise.all([goalQuery.refetch(), todayQuery.refetch(), logsQuery.refetch()]);

  const goal = goalQuery.data;
  const today = todayQuery.data;
  const logs = logsQuery.data;
  const fetching = goalQuery.isFetching || todayQuery.isFetching || logsQuery.isFetching;
  // 利用者が替わった後の取得で届いたものだけを材料にする
  const fresh = [goalQuery, todayQuery, logsQuery].every((q) => q.dataUpdatedAt > notBefore);
  const lastGood = useRef<TodaySnapshot | undefined>(undefined);
  // Today 失敗時の記録に使う Goal も、owner 再確認中には更新しない。
  const acceptedGoal = useRef<GoalR11 | undefined>(undefined);
  if (goal && goalQuery.dataUpdatedAt > notBefore) {
    acceptedGoal.current = goal;
  }

  // 予測に使った設定も含め、応答の値だけで照合する。
  const consistent = goal && today && logs && fresh ? isSameSnapshot(goal, today, logs) : null;
  if (goal && today && logs && consistent) {
    lastGood.current = { goal, today, logs };
  }

  // 食い違いを取り直す。取得中は待ち、そろったら数え直す
  const [resyncs, setResyncs] = useState(0);
  useEffect(() => {
    if (consistent === true && resyncs !== 0) {
      setResyncs(0);
    }
    if (consistent === false && !fetching && resyncs < MAX_RESYNC) {
      setResyncs((n) => n + 1);
      refresh();
    }
    // refresh の関数参照は変わるが、再取得の契機はこの3値だけに限定する。
  }, [consistent, fetching, resyncs]);

  const fetchingRef = useRef(fetching);
  fetchingRef.current = fetching;
  const shown = lastGood.current;
  useEffect(() => {
    if (!shown) {
      return undefined;
    }
    const check = () => {
      if (fetchingRef.current) {
        return;
      }
      if (shouldRefetchForNewDay(shown.goal.timezone, shown.today.today, new Date())) {
        refresh();
      }
    };
    const timer = setInterval(check, DAY_CHECK_MS);
    return () => clearInterval(timer);
    // 表示している Goal の timezone と「今日」が変わったときだけ、確かめ方を作り直す
  }, [shown?.goal.timezone, shown?.today.today]);

  return {
    goalQuery,
    todayQuery,
    logsQuery,
    /** 同じ時点の材料だとそろっている組み合わせ（まだ一度もそろっていなければ undefined）。 */
    snapshot: lastGood.current,
    /** notBefore より後に届いた最新の Goal（Today の取得失敗時の記録に使う）。 */
    goal: acceptedGoal.current,
    /** 取り直しても食い違いが解けなかった。 */
    resyncFailed: consistent === false && !fetching && resyncs >= MAX_RESYNC,
    refresh,
    retryResync: () => {
      setResyncs(0);
      refresh();
    },
  };
}
