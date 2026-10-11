import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { LearningArtifactSummary, TodayLearning, LearningComparison } from '@contracts';
import { goalKeys } from '../../api/goals-http.ts';
import { learningHttp, learningKeys } from '../../api/learning-http.ts';
import { getPrivateEpoch, privateDataReady, usePrivateEpoch } from '../../api/session-cache.ts';
import { getDraftGeneration, getPrivateGeneration, isDraftOwner } from '../../api/session-draft.ts';
import { isNotFound, isUnauthenticated } from '../../api/http.ts';
import { authClient } from '../../auth/client.ts';
import { adoptable } from './presentation.ts';

export class LearningBoundaryError extends Error {
  constructor() { super('認証・目標・採用状態を確認してから操作してください。'); }
}
function boundary(owner: string | null | undefined, generation: number) {
  const epoch = getPrivateEpoch(), queryGeneration = getPrivateGeneration();
  return () => typeof owner === 'string' && epoch.owner === owner && privateDataReady(epoch) &&
    getPrivateEpoch() === epoch && getPrivateGeneration() === queryGeneration && isDraftOwner(owner, generation);
}
const readPolicy = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
type ReadCheckpoint = { query: unknown; count: number };
type Confirmation = { report: ReadCheckpoint; today: ReadCheckpoint };
type ConfirmationMetadata = { owner: string | null | undefined; pending: Confirmation | null };
type LearningClient = ReturnType<typeof useQueryClient>;
const confirmationControllers = new WeakMap<LearningClient, WeakMap<object, () => void>>();
function confirmationMetadata(query: { meta: Record<string, unknown> | undefined }): ConfirmationMetadata | undefined {
  return query.meta?.learningConfirmation as ConfirmationMetadata | undefined;
}
/** Nanostore ownership is authoritative; checking/errors must not erase an uncertain write. */
function watchConfirmationOwner(client: LearningClient) {
  const atom = authClient.$store?.atoms?.session;
  if (!atom) return;
  let byAtom = confirmationControllers.get(client);
  if (!byAtom) { byAtom = new WeakMap(); confirmationControllers.set(client, byAtom); }
  if (byAtom.has(atom)) return;
  const cache = client.getQueryCache();
  let stopSession = () => {}, stopCache = () => {};
  let released = false;
  const release = () => { if (released) return; released = true; stopSession(); stopCache(); if (byAtom!.get(atom) === release) byAtom!.delete(atom); };
  byAtom.set(atom, release);
  const pending = () => cache.getAll().filter(query => confirmationMetadata(query)?.pending);
  const inspectOwner = () => {
    const session = atom.get();
    if (session.isPending || session.isRefetching || session.error) return;
    const owner = session.data?.user.id ?? null;
    for (const query of pending()) if (confirmationMetadata(query)?.owner !== owner) client.removeQueries({ queryKey: query.queryKey, exact: true });
    if (pending().length === 0) release();
  };
  stopCache = cache.subscribe(event => {
    if (event.type === 'removed') {
      const metadata = confirmationMetadata(event.query); if (metadata) metadata.pending = null;
    }
    // resetQueries preserves meta but resets successful-read counts to zero.
    if (event.type === 'updated' && event.action.type === 'setState' && event.query.state.data === undefined) {
      for (const query of pending()) for (const previous of Object.values(confirmationMetadata(query)!.pending!)) {
        if (previous.query === event.query) previous.count = event.query.state.dataUpdateCount;
      }
    }
    if (pending().length === 0) release();
  });
  stopSession = atom.listen(inspectOwner);
  inspectOwner();
}
async function guarded<T>(operation: () => Promise<T>, valid: () => boolean) {
  if (!valid()) throw new LearningBoundaryError();
  const value = await operation();
  if (!valid()) throw new LearningBoundaryError();
  return value;
}
export function useLearningCapability() {
  const current = usePrivateEpoch(), generation = getDraftGeneration();
  const query = useQuery({ queryKey: learningKeys.capability(), enabled: privateDataReady(current), ...readPolicy,
    queryFn: ({ signal }) => guarded(() => learningHttp.capability(signal), boundary(current.owner, generation)) });
  return { ...query, data: privateDataReady(current) && query.dataUpdatedAt > current.clearedAt ? query.data : undefined };
}

export function useLearning(goalId: string, enabled: boolean, scope: string) {
  const current = usePrivateEpoch(), generation = getDraftGeneration(), client = useQueryClient();
  const readGeneration = useRef(0), request = useRef<AbortController | null>(null), previewRequest = useRef<AbortController | null>(null);
  const alive = useRef(true), activeScope = useRef(scope); activeScope.current = scope;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; query: unknown; count: number } | null>(null);
  const [preview, setPreview] = useState<TodayLearning | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const comparisonRequest = useRef<AbortController | null>(null);
  const comparisonGeneration = useRef(0);
  const comparisonValid = useRef<(() => boolean) | null>(null);
  const [comparison, setComparison] = useState<LearningComparison | null>(null), [comparisonError, setComparisonError] = useState<unknown>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); previewRequest.current?.abort(); comparisonRequest.current?.abort(); }; }, []);
  useEffect(() => { previewRequest.current?.abort(); setPreview(null); setPreviewError(null); clearComparison(); }, [scope]);
  useEffect(() => client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || !['success', 'invalidate', 'setState'].includes(event.action.type)) return;
    const key = event.query.queryKey;
    if (JSON.stringify(key) !== JSON.stringify(learningKeys.report(goalId)) && JSON.stringify(key) !== JSON.stringify(learningKeys.today(goalId))) return;
    // Counts can return to their original value after reset (1 -> 0 -> 1).
    comparisonGeneration.current++; clearComparison();
  }), [client, goalId]);
  function read<T>(operation: () => Promise<T>, signal: AbortSignal) {
    const owned = boundary(current.owner, generation), started = readGeneration.current, atScope = scope;
    return guarded(operation, () => !signal.aborted && request.current === null && started === readGeneration.current && activeScope.current === atScope && owned());
  }
  const reportQuery = useQuery({ queryKey: learningKeys.report(goalId), enabled: enabled && !busy && privateDataReady(current), ...readPolicy,
    queryFn: ({ signal }) => read(() => learningHttp.report(goalId, signal), signal) });
  const todayQuery = useQuery({ queryKey: learningKeys.today(goalId), enabled: enabled && !busy && privateDataReady(current), ...readPolicy,
    queryFn: ({ signal }) => read(() => learningHttp.today(goalId, undefined, signal), signal) });
  // Keep an uncertain write masked across remounts, until both independent reads confirm it.
  // This marker shares the owner's private cache boundary and never causes a request.
  const confirmationKey = learningKeys.confirmation(goalId);
  const confirmationCache = client.getQueryCache().find({ queryKey: confirmationKey, exact: true });
  // Reuse this exact meta object when the observer reapplies options or remounts.
  const previousMetadata = confirmationCache && confirmationMetadata(confirmationCache);
  const metadata = previousMetadata && previousMetadata.owner === current.owner ? previousMetadata : { owner: current.owner, pending: null };
  if (previousMetadata && previousMetadata !== metadata) previousMetadata.pending = null;
  useQuery<boolean>({ queryKey: confirmationKey, enabled: false, gcTime: Infinity, queryFn: async () => false,
    meta: { ...confirmationCache?.meta, learningConfirmation: metadata } });
  const confirmation = metadata.pending;
  function setConfirmation(value: Confirmation | null) {
    const query = client.getQueryCache().find({ queryKey: confirmationKey, exact: true });
    const live = query && confirmationMetadata(query);
    if (!live || live.owner !== current.owner) return;
    live.pending = value;
    if (value) watchConfirmationOwner(client);
    client.setQueryData(confirmationKey, Boolean(value));
  }
  const pendingConfirmation = () => {
    const query = client.getQueryCache().find({ queryKey: confirmationKey, exact: true });
    return query && confirmationMetadata(query)?.pending;
  };
  useEffect(() => { if (metadata.pending) watchConfirmationOwner(client); }, [client, metadata]);
  const checkpoint = (kind: 'report' | 'today'): ReadCheckpoint => {
    const query = client.getQueryCache().find({ queryKey: learningKeys[kind](goalId), exact: true });
    return { query, count: query?.state.dataUpdateCount ?? 0 };
  };
  const advanced = (kind: 'report' | 'today', previous: ReadCheckpoint) => {
    const next = checkpoint(kind); return next.query !== previous.query || next.count > previous.count;
  };
  const confirmationRecovered = Boolean(confirmation && reportQuery.isSuccess && todayQuery.isSuccess &&
    reportQuery.data && todayQuery.data && reportQuery.dataUpdatedAt > current.clearedAt && todayQuery.dataUpdatedAt > current.clearedAt &&
    advanced('report', confirmation.report) && advanced('today', confirmation.today) &&
    reportQuery.data.activeRevision === todayQuery.data.selectedForecast.activeRevision);
  const awaitingConfirmation = Boolean(confirmation && !confirmationRecovered);
  useEffect(() => { if (confirmationRecovered) setConfirmation(null); }, [client, confirmationRecovered, goalId]);
  useEffect(() => {
    if (typeof document === 'undefined' || !enabled) return;
    const owned = boundary(current.owner, generation);
    const resume = () => {
      if (document.visibilityState !== 'visible' || request.current || !owned()) return;
      readGeneration.current++; previewRequest.current?.abort(); setPreview(null); setPreviewError(null); clearComparison();
      void (async () => {
        const keys = [learningKeys.report(goalId), learningKeys.today(goalId)];
        await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey, exact: true })));
        if (!alive.current || activeScope.current !== scope || !owned() || request.current) return;
        await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey, exact: true })));
      })();
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [client, current, enabled, generation, goalId, scope]);
  const cached = client.getQueryCache().find({ queryKey: learningKeys.report(goalId), exact: true });
  const recovered = failure !== null && reportQuery.data !== undefined &&
    (cached !== failure.query || (cached?.state.dataUpdateCount ?? 0) > failure.count);
  const error = recovered ? null : failure?.error ?? null;
  const usable = privateDataReady(current) && ![error, reportQuery.error, todayQuery.error].some(item => isNotFound(item) || isUnauthenticated(item));
  const report = usable && reportQuery.dataUpdatedAt > current.clearedAt ? reportQuery.data : undefined;
  const rechecking = reportQuery.isFetching || todayQuery.isFetching;
  const selected = usable && !busy && !rechecking && !awaitingConfirmation && todayQuery.dataUpdatedAt > current.clearedAt ? todayQuery.data : undefined;
  function validRender() {
    const owned = boundary(current.owner, generation), atScope = scope;
    return () => alive.current && activeScope.current === atScope && owned();
  }
  async function action(kind: 'participate' | 'fit' | 'experiment' | 'activate' | 'rollback' | 'withdraw' | 'refresh', artifact?: LearningArtifactSummary) {
    if (!enabled || !report || request.current || !alive.current || (rechecking && kind !== 'refresh')) return;
    if (kind !== 'refresh' && pendingConfirmation()) return;
    if (kind !== 'participate' && kind !== 'refresh' && !report.participation) return;
    if (kind === 'activate' && (!artifact || !adoptable(artifact) || !report.artifacts.some(item => item.id === artifact.id && item.hash === artifact.hash && adoptable(item)))) return;
    const owned = validRender(); if (!owned()) return;
    const controller = new AbortController(); request.current = controller; readGeneration.current++;
    if (kind !== 'refresh') setConfirmation({ report: checkpoint('report'), today: checkpoint('today') });
    previewRequest.current?.abort(); setPreview(null); setPreviewError(null); clearComparison(); setBusy(true); setFailure(null); setNotice(null);
    const valid = () => !controller.signal.aborted && owned();
    try {
      await client.cancelQueries({ queryKey: goalKeys.all });
      await client.invalidateQueries({ queryKey: goalKeys.all, refetchType: 'none' });
      if (!valid()) return;
      const participation = report.participation;
      if (kind === 'participate') await learningHttp.participate(goalId, { policyVersion: report.policy.policyVersion }, controller.signal);
      if (kind === 'fit' && participation) await learningHttp.fit(goalId, { expectedParticipationId: participation.id,
        expectedGoalSettingsRevision: report.goalSettingsRevision, expectedAnswerRevision: report.answerRevision, expectedActiveRevision: report.activeRevision }, controller.signal);
      if (kind === 'experiment' && participation) await learningHttp.experiment(goalId, { expectedParticipationId: participation.id,
        expectedGoalSettingsRevision: report.goalSettingsRevision, expectedAnswerRevision: report.answerRevision, expectedActiveRevision: report.activeRevision }, controller.signal);
      if (kind === 'activate' && participation && artifact) await learningHttp.activate(goalId, { artifactId: artifact.id, artifactHash: artifact.hash,
        expectedParticipationId: participation.id, expectedActiveRevision: report.activeRevision }, controller.signal);
      if (kind === 'rollback' && participation) await learningHttp.rollback(goalId, { expectedParticipationId: participation.id, expectedActiveRevision: report.activeRevision }, controller.signal);
      if (kind === 'withdraw' && participation) await learningHttp.withdraw(goalId, { expectedParticipationId: participation.id }, controller.signal);
      if (!valid()) return;
      client.removeQueries({ queryKey: learningKeys.today(goalId), exact: true });
      if (kind === 'withdraw') client.setQueryData(learningKeys.report(goalId), { ...report, participation: null, artifacts: [], activeArtifactId: null });
      const fresh = await learningHttp.report(goalId, controller.signal); if (!valid()) return;
      const forecast = await learningHttp.today(goalId, undefined, controller.signal); if (!valid()) return;
      if (forecast.selectedForecast.activeRevision !== fresh.activeRevision) throw new LearningBoundaryError();
      client.setQueryData(learningKeys.report(goalId), fresh); client.setQueryData(learningKeys.today(goalId), forecast);
      setConfirmation(null);
      await client.invalidateQueries({ queryKey: goalKeys.all, predicate: query => !query.queryKey.includes('learning') });
      if (valid()) setNotice(kind === 'withdraw' ? '学習参加を解除し、学習候補を削除しました。' : kind === 'activate' ? '選択した候補を採用しました。' :
        kind === 'rollback' ? '従来モデルへ戻しました。' : kind === 'experiment' ? '実験用の結果を保存しました。モデルの計算可否は比較で確認してください。精度改善は未確認です。' : kind === 'fit' ? '候補の評価結果を更新しました。採用は別の操作です。' : '学習状態を確認しました。');
    } catch (error) {
      if (valid()) {
        if (isNotFound(error) || isUnauthenticated(error)) { client.removeQueries({ queryKey: learningKeys.report(goalId), exact: true }); client.removeQueries({ queryKey: learningKeys.today(goalId), exact: true }); }
        const query = client.getQueryCache().find({ queryKey: learningKeys.report(goalId), exact: true });
        setFailure({ error, query, count: query?.state.dataUpdateCount ?? 0 });
      }
    } finally { if (request.current === controller) request.current = null; if (valid()) setBusy(false); }
  }
  async function requestPreview(amount: number) {
    if (!enabled || !report || busy || rechecking || pendingConfirmation() || request.current || !Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) return;
    const owned = validRender(); if (!owned()) return;
    previewRequest.current?.abort(); const controller = new AbortController(); previewRequest.current = controller;
    const started = readGeneration.current, revision = report.activeRevision;
    const valid = () => !controller.signal.aborted && previewRequest.current === controller && started === readGeneration.current && owned();
    setPreview(null); setPreviewError(null);
    try {
      const result = await guarded(() => learningHttp.today(goalId, amount, controller.signal), valid);
      if (result.selectedForecast.activeRevision !== revision || result.selectedForecast.todayAmount !== amount || !result.selectedForecast.hypothetical) throw new LearningBoundaryError();
      if (valid()) setPreview(result);
    } catch (error) { if (valid()) setPreviewError(error); }
  }
  function clearPreview() { previewRequest.current?.abort(); setPreview(null); setPreviewError(null); }
  function clearComparison() { comparisonRequest.current?.abort(); comparisonValid.current = null; setComparison(null); setComparisonError(null); }
  async function requestComparison(artifact: LearningArtifactSummary, amount: number) {
    if (!enabled || !report?.participation || busy || rechecking || pendingConfirmation() || request.current || !Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647) return;
    if (artifact.purpose !== 'EXPERIMENTAL' || artifact.goalSettingsRevision !== report.goalSettingsRevision || artifact.answerRevision !== report.answerRevision ||
      !report.artifacts.some(item => item.id === artifact.id && item.hash === artifact.hash && item.purpose === 'EXPERIMENTAL')) return;
    const owned = validRender(); if (!owned()) return;
    comparisonRequest.current?.abort(); const controller = new AbortController(); comparisonRequest.current = controller;
    const started = readGeneration.current, revision = report.activeRevision;
    const reports = checkpoint('report'), todays = checkpoint('today');
    const comparisonStarted = comparisonGeneration.current;
    const unchanged = (kind: 'report' | 'today', previous: ReadCheckpoint) => {
      const query = client.getQueryCache().find({ queryKey: learningKeys[kind](goalId), exact: true });
      return query === previous.query && query?.state.dataUpdateCount === previous.count && !query.state.isInvalidated && query.state.fetchStatus === 'idle';
    };
    // Log corrections need not increment goal/answer/active revisions.
    const valid = () => !controller.signal.aborted && comparisonRequest.current === controller && started === readGeneration.current &&
      comparisonStarted === comparisonGeneration.current && unchanged('report', reports) && unchanged('today', todays) && owned();
    setComparison(null); setComparisonError(null);
    try {
      const result = await guarded(() => learningHttp.compare(goalId, artifact.id, artifact.hash, amount, controller.signal), valid);
      if (result.activeRevision !== revision || result.goalSettingsRevision !== report.goalSettingsRevision || result.answerRevision !== report.answerRevision ||
        result.experiment.source !== 'EXPERIMENTAL' || result.experiment.artifactId !== artifact.id || result.experiment.artifactHash !== artifact.hash ||
        result.reference.source !== 'BASELINE' || result.reference.horizonDays !== report.policy.observationDays || result.experiment.horizonDays !== result.reference.horizonDays ||
        result.experiment.todayAmount !== amount || result.reference.todayAmount !== amount || !result.reference.hypothetical || !result.experiment.hypothetical) throw new LearningBoundaryError();
      if (valid()) { comparisonValid.current = valid; setComparison(result); }
    } catch (error) { if (valid()) setComparisonError(error); }
  }
  return { reportQuery, todayQuery, report, selected, busy: busy || rechecking, awaitingConfirmation, error, notice, action,
    preview: usable && !busy && !rechecking && !awaitingConfirmation && reportQuery.isSuccess && todayQuery.isSuccess &&
      preview?.selectedForecast.activeRevision === report?.activeRevision && todayQuery.data?.selectedForecast.activeRevision === report?.activeRevision ? preview : null,
    previewError, requestPreview, clearPreview, comparison: usable && !busy && !rechecking && !awaitingConfirmation && reportQuery.isSuccess && todayQuery.isSuccess &&
      comparison?.activeRevision === report?.activeRevision && comparisonValid.current?.() ? comparison : null, comparisonError, requestComparison, clearComparison };
}
