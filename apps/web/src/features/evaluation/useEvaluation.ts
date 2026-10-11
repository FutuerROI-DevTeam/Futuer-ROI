import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { evaluationHttp, evaluationKeys } from '../../api/evaluation-http.ts';
import { isNotFound, isUnauthenticated } from '../../api/http.ts';
import { getPrivateEpoch, privateDataReady, usePrivateEpoch } from '../../api/session-cache.ts';
import { getDraftGeneration, getPrivateGeneration, isDraftOwner } from '../../api/session-draft.ts';

/** Both atom continuity and epoch identity matter: even A→B→A must reject A's held reply. */
function boundary(expectedOwner: string | null | undefined, expectedGeneration: number) {
  const epoch = getPrivateEpoch();
  const generation = getDraftGeneration();
  const queryGeneration = getPrivateGeneration();
  const owner = epoch.owner;
  return () => typeof owner === 'string' && owner === expectedOwner && generation === expectedGeneration && privateDataReady(epoch) &&
    getPrivateEpoch() === epoch && getPrivateGeneration() === queryGeneration && isDraftOwner(owner, generation);
}
export class EvaluationBoundaryError extends Error {
  constructor() { super('認証状態を確認してから、もう一度操作してください。'); }
}
async function guardedRead<T>(read: () => Promise<T>, owner: string | null | undefined, generation: number,
  active: () => boolean = () => true) {
  const current = boundary(owner, generation);
  if (!current() || !active()) throw new EvaluationBoundaryError();
  const result = await read();
  if (!current() || !active()) throw new EvaluationBoundaryError();
  return result;
}
// Opening/focusing the screen never issues a forecast or retries a failed write.
const readPolicy = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
export function useEvaluationCapability() {
  const current = usePrivateEpoch();
  const generation = getDraftGeneration();
  const query = useQuery({ queryKey: evaluationKeys.capability(),
    queryFn: ({ signal }) => guardedRead(() => evaluationHttp.capability(signal), current.owner, generation),
    enabled: privateDataReady(current), ...readPolicy });
  const data = privateDataReady(current) && query.dataUpdatedAt > current.clearedAt ? query.data : undefined;
  return { ...query, data };
}

export function useEvaluation(goalId: string, enabled: boolean) {
  const current = usePrivateEpoch();
  const generation = getDraftGeneration();
  const client = useQueryClient();
  const request = useRef<AbortController | null>(null);
  const readGeneration = useRef(0);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [reportedError, setReportedError] = useState<{ failure: unknown; dataUpdateCount: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  const query = useQuery({ queryKey: evaluationKeys.report(goalId),
    queryFn: ({ signal }) => {
      const started = readGeneration.current;
      return guardedRead(() => evaluationHttp.report(goalId, signal), current.owner, generation,
        () => !signal?.aborted && request.current === null && started === readGeneration.current);
    },
    enabled: enabled && !busy && privateDataReady(current), ...readPolicy });
  // A successful report revision supersedes the action failure. Wall-clock
  // timestamps alone can coincide in one millisecond, so use Query's revision.
  const recovered = reportedError !== null &&
    (client.getQueryState(evaluationKeys.report(goalId))?.dataUpdateCount ?? 0) > reportedError.dataUpdateCount;
  const error = recovered ? null : reportedError?.failure ?? null;
  const unavailable = isNotFound(query.error) || isUnauthenticated(query.error) || isNotFound(error) || isUnauthenticated(error);
  const data = !unavailable && privateDataReady(current) && query.dataUpdatedAt > current.clearedAt ? query.data : undefined;

  async function action(kind: 'participate' | 'withdraw' | 'capture' | 'assess') {
    if (!enabled || !data || request.current || !alive.current) return;
    const owned = boundary(current.owner, generation);
    if (!owned()) return;
    const controller = new AbortController();
    request.current = controller;
    readGeneration.current++;
    setBusy(true); setReportedError(null); setNotice(null);
    const valid = () => alive.current && !controller.signal.aborted && owned();
    try {
      // A remount may already be refreshing a cached report. Cancel it before a
      // write, then reject its transport reply even if AbortSignal is ignored.
      await client.cancelQueries({ queryKey: evaluationKeys.report(goalId), exact: true });
      // Guard again immediately before dispatch; handlers can outlive the rendered owner.
      if (!valid()) return;
      if (kind === 'participate') await evaluationHttp.participate(goalId, { policyVersion: data.policy.policyVersion }, controller.signal);
      if (kind === 'withdraw') await evaluationHttp.withdraw(goalId, controller.signal);
      if (kind === 'capture') await evaluationHttp.capture(goalId, { expectedGoalSettingsRevision: data.goalSettingsRevision }, controller.signal);
      if (!valid()) return;
      if (kind === 'withdraw') {
        const empty = { REACHED: 0, NOT_REACHED: 0, UNKNOWN: 0, PENDING: 0, NULL: 0,
          OUTSIDE_HORIZON: 0, INPUT_CORRECTED: 0, CONTEXT_CHANGED: 0, lowerCoverage: null, upperCoverage: null };
        // Once DELETE succeeds, a failed follow-up GET must not keep deleted forecasts visible.
        client.setQueryData(evaluationKeys.report(goalId), { ...data, participating: false, forecasts: [],
          summary: { issued: 0, participantCount: 0, p50: empty, p80: empty } });
      }
      // A server response may be lost after a committed write. Never replay a write automatically.
      const report = await evaluationHttp.report(goalId, controller.signal);
      if (!valid()) return;
      client.setQueryData(evaluationKeys.report(goalId), report);
      setNotice(kind === 'withdraw' ? '参加を解除し、評価用の保存記録を削除しました。' :
        kind === 'capture' ? '評価用予測を記録しました。同じ日の再操作では最初の記録を表示します。' :
        kind === 'participate' ? 'この目標の評価に参加しました。予測の保存は下のボタンで行います。' : '現在の記録と照合しました。');
    } catch (failure) {
      if (valid()) {
        if (isNotFound(failure) || isUnauthenticated(failure)) client.removeQueries({ queryKey: evaluationKeys.report(goalId), exact: true });
        setReportedError({ failure, dataUpdateCount: client.getQueryState(evaluationKeys.report(goalId))?.dataUpdateCount ?? 0 });
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (valid()) setBusy(false);
    }
  }
  return { query, data, busy, error, notice, action };
}
