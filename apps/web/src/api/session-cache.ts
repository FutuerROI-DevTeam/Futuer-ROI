import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { authClient } from '../auth/client.ts';
import { goalKeys } from './goals-http.ts';
import { getPrivateGeneration, useDraftContinuityTracking, usePrivateGeneration } from './session-draft.ts';

/**
 * ログインしている人の識別。undefined はまだ分からない（session の読み込み中）、null は未ログイン。
 * 前の値が分かっていて、次の値と違うとき（ログアウト・別の人でのログイン）だけ true。
 */
export function sessionChanged(prev: string | null | undefined, next: string | null | undefined): boolean {
  if (prev === undefined || next === undefined) return false;
  return prev !== next;
}

/**
 * QueryClient 外の画面状態も破棄できるよう、owner と取得の採用下限（clearedAt）を共有する。
 * 旧取得の中断・cache 消去が終わるまでは Infinity で全応答を拒否する。
 * 画面は owner ごとに作り直し、clearedAt 以下のデータを使わない。
 */
export type PrivateEpoch = { owner: string | null | undefined; clearedAt: number };

/** 利用者の識別が分かったときの次の状態。最初に分かったときは、すでにあるデータをそのまま使ってよい。 */
export function nextEpoch(prev: PrivateEpoch, userId: string | null | undefined): PrivateEpoch {
  if (userId === undefined || userId === prev.owner) return prev;
  if (prev.owner === undefined) return { owner: userId, clearedAt: 0 };
  return { owner: userId, clearedAt: Number.POSITIVE_INFINITY };
}

let epoch: PrivateEpoch = { owner: undefined, clearedAt: 0 };
let clearedGeneration = 0;
const waitingEpoch: PrivateEpoch = { owner: undefined, clearedAt: Number.POSITIVE_INFINITY };
/** 非query回復GET向けの境界。現時点の製品callerはなく、#175併用候補と実hook回帰用。確認/owner変更は描画前にも無効にする。 */
export function getPrivateEpoch(): PrivateEpoch {
  const session = authClient.$store?.atoms?.session?.get();
  if (
    getPrivateGeneration() !== clearedGeneration
    || session?.isPending
    || session?.isRefetching
    || session?.error
    || (session && (session.data?.user.id ?? null) !== epoch.owner)
  ) {
    return waitingEpoch;
  }
  return epoch;
}
const listeners = new Set<() => void>();
function setEpoch(next: PrivateEpoch) {
  if (next === epoch) return;
  epoch = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** いまの利用者と、その利用者のデータとして使ってよい取得の下限時刻。 */
export function usePrivateEpoch(): PrivateEpoch {
  const stored = useSyncExternalStore(subscribe, () => epoch);
  const generation = usePrivateGeneration();
  const session = authClient.useSession();
  // effect の消去を待つ前の描画でも、いま認識している session と照合する。
  // 取得失敗は未ログインと取り違えず、私的な表示・入力だけを停止する。
  // 再取得中は旧 data が残り isPending=false でも、Cookie の所有者と一致するとは限らない。
  if (session.isPending || session.isRefetching || session.error || generation !== clearedGeneration) {
    return { owner: undefined, clearedAt: Number.POSITIVE_INFINITY };
  }
  return nextEpoch(stored, session.data?.user.id ?? null);
}

/** 取得・フォームを使えるのは、所有者が確定し、旧取得の中断と消去が終わったときだけ。 */
export function privateDataReady(current: PrivateEpoch): boolean {
  return typeof current.owner === 'string' && Number.isFinite(current.clearedAt);
}

/**
 * 正常な同一 owner 再確認中は Today の入力を保つ（D-30）。失敗・初回読込は除外する。
 * 確認後の中断・cache 消去待ち（clearedAt=∞）も含むが、新しい応答の採用と送信は止める。
 */
export function checkingSameOwner(
  shown: string | undefined,
  current: PrivateEpoch,
  session: { data: { user: { id: string } } | null; error: unknown; isPending: boolean },
): shown is string {
  return shown !== undefined && (current.owner === undefined || current.owner === shown)
    && !session.error && !session.isPending && session.data?.user.id === shown;
}

/**
 * SPA で共有される私的 cache を、owner 変更・確認時に中断して消去する。
 * API の owner 検査だけでは旧 cache の表示を防げないため、画面用の PrivateEpoch も更新する。
 */
export function PrivateCacheGuard() {
  const session = authClient.useSession();
  const generation = useDraftContinuityTracking(session);
  const queryClient = useQueryClient();
  const last = useRef<string | null | undefined>(undefined);
  const needsReset = useRef(false);
  const userId = session.isPending || session.isRefetching || session.error ? undefined : (session.data?.user.id ?? null);

  useEffect(() => {
    if (userId === undefined) {
      if (epoch.owner !== undefined) {
        // 確認中に届く業務応答を旧 session の所有物と見なさない。
        // 古い cancel 完了も無効にし、同じ owner で回復した場合にも cache を消す。
        needsReset.current = true;
        setEpoch({ owner: epoch.owner, clearedAt: Number.POSITIVE_INFINITY });
      }
      return;
    }
    const resetNeeded = needsReset.current || generation !== clearedGeneration;
    const transition = resetNeeded
      ? { owner: userId, clearedAt: Number.POSITIVE_INFINITY }
      : nextEpoch(epoch, userId);
    setEpoch(transition);
    if (resetNeeded || sessionChanged(last.current, userId)) {
      needsReset.current = false;
      const owner = userId;
      void queryClient.cancelQueries({ queryKey: goalKeys.all }).then(() => {
        // 前の人の取得が止まった後なら、ここから先に届くデータは新しい利用者のもの
        // A→B→A のような連続切替でも、古い中断完了で新しい境界を開かない。
        if (epoch !== transition || getPrivateGeneration() !== generation) {
          return;
        }
        // 先に消去する。時刻を公開してから reset すると、間に旧 cache を読めてしまう。
        const reset = queryClient.resetQueries({ queryKey: goalKeys.all });
        clearedGeneration = generation;
        // cache はすでに空。同じ millisecond に成功した新取得も許可する。
        setEpoch({ owner, clearedAt: Date.now() - 1 });
        return reset;
      });
    }
    if (userId !== undefined) last.current = userId;
  }, [userId, queryClient, generation]);

  return null;
}
