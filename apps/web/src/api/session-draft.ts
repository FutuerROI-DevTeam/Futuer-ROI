import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { authClient } from '../auth/client.ts';
import type { PrivateEpoch } from './session-cache.ts';

type SessionState = { data: { user: { id: string } } | null; error: unknown; isPending: boolean; isRefetching: boolean };
type Continuity = { owner: string | null | undefined; generation: number; queryGeneration: number };
let continuity: Continuity = { owner: undefined, generation: 0, queryGeneration: 0 };
let failed = false;
let checking = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => continuity;
export const getPrivateGeneration = () => continuity.queryGeneration;
/** 通常確認を越える確定結果も、owner/連続性が変わった後は別画面へ持ち越さない。 */
export const isDraftOwner = (owner: string, generation: number) => continuity.owner === owner && continuity.generation === generation;
/** 入力者の連続性の世代。認証操作・owner変更・確認失敗で進み、正常な同一owner確認では進まない。 */
export const getDraftGeneration = () => continuity.generation;
export const useDraftGeneration = () => useSyncExternalStore(subscribe, snapshot).generation;
export const usePrivateGeneration = () => useSyncExternalStore(subscribe, snapshot).queryGeneration;
function invalidate(owner = continuity.owner) {
  continuity = {
    owner,
    generation: continuity.generation + 1,
    queryGeneration: continuity.queryGeneration + 1,
  };
  listeners.forEach(listener => listener());
}
function observe(session: SessionState) {
  const owner = session.data?.user.id ?? (session.isPending || session.isRefetching ? undefined : null);
  if (owner !== continuity.owner || (session.error && !failed)) {
    invalidate(owner);
  } else if ((session.isPending || session.isRefetching) && !checking) {
    // 正常確認でもqueryは破棄する。Reactが短い確認中の描画を省いても記録を残す。
    continuity = { ...continuity, queryGeneration: continuity.queryGeneration + 1 };
    listeners.forEach(listener => listener());
  }
  failed = Boolean(session.error);
  checking = session.isPending || session.isRefetching;
}

/** Query epochとは別に、入力者の連続性を追う。短い中間owner/errorもatom更新で無効にする。 */
export function useDraftContinuityTracking(session: SessionState) {
  const generation = usePrivateGeneration();
  useLayoutEffect(() => {
    const store = authClient.$store;
    const atom = store?.atoms?.session;
    const stopSession = atom?.listen(observe);
    if (atom) observe(atom.get());
    // 認証操作は、結果のownerが同じでも保存済みdraftの自動復元対象にしない。
    const stopSignal = store?.atoms?.$sessionSignal?.listen(() => invalidate());
    const storage = (event: StorageEvent) => {
      if (event.key !== 'better-auth.message') return;
      try {
        if (JSON.parse(event.newValue ?? '{}').event === 'session') {
          invalidate();
        }
      } catch { /* invalid notification */ }
    };
    window.addEventListener('storage', storage);
    return () => {
      stopSession?.();
      stopSignal?.();
      window.removeEventListener('storage', storage);
    };
  }, []);
  // 合成sessionや初回mountにも対応。確認中の旧dataだけでは連続性を壊さない。
  useLayoutEffect(() => {
    if (!authClient.$store?.atoms?.session) observe(session);
  }, [session.data?.user.id, session.error, session.isPending, session.isRefetching]);
  return generation;
}

/** DOM・query応答を保持せず、正常な同一owner確認だけを越えられる画面内メモリ。 */
export function useMemoryDraft<T>(current: PrivateEpoch, scope: string) {
  const boundary = useSyncExternalStore(subscribe, snapshot);
  const session = authClient.useSession();
  const held = useRef<{ owner: string; generation: number; scope: string; value: T } | undefined>(undefined);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  if (held.current && (
    session.error
    || held.current.scope !== scope
    || held.current.generation !== boundary.generation
    || (session.data?.user.id !== undefined && held.current.owner !== session.data.user.id)
  )) {
    held.current = undefined;
  }
  const owner = current.owner;
  const ready = typeof owner === 'string' && Number.isFinite(current.clearedAt) && boundary.owner === owner;
  const restored = ready && held.current?.owner === owner ? held.current.value : undefined;
  const remember = useCallback((value: T | undefined) => {
    // 旧childのlayout/callbackで、新しいownerやGoalのsnapshotを書き換えない。
    if (
      typeof owner !== 'string'
      || continuity.owner !== owner
      || continuity.generation !== boundary.generation
      || activeScope.current !== scope
    ) {
      return;
    }
    held.current = value === undefined ? undefined : { owner, generation: boundary.generation, scope, value };
  }, [owner, boundary.generation, scope]);
  return { restored, remember, generation: boundary.generation };
}
