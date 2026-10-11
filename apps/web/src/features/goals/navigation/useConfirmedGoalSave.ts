import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { privateDataReady, type PrivateEpoch } from '../../../api/session-cache.ts';
import { isDraftOwner } from '../../../api/session-draft.ts';

/** Formが確認中にunmountされても、確定成功だけは同じページの親へ伝える。
 * 親routeが所有する訪問を照合し、該当操作の終了とnavigationを同じ境界で行う。
 */
export function useConfirmedGoalSave(current: PrivateEpoch, generation: number, scope: string) {
  const navigate = useNavigate();
  const router = useRouter();
  const instance = useId();
  const mounted = useRef(false);
  const activeScope = useRef(scope);
  const visit = useRef({ scope, token: {}, generation: 0 });
  if (visit.current.scope !== scope) visit.current = { scope, token: {}, generation: visit.current.generation + 1 };
  activeScope.current = scope;
  const token = visit.current.token;
  const [saved, setSaved] = useState<{ owner: string; generation: number; scope: string; token: object; complete?: () => boolean }>();
  const [failedCompletion, setFailedCompletion] = useState<{ receipt: typeof saved; error: unknown }>();
  const delivered = useRef<typeof saved>(undefined);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // 同routeのGoal1→Goal2→Goal1でも親は再利用される。commit前の離脱開始も旧訪問を失効させる。
  useLayoutEffect(() => router.subscribe('onBeforeNavigate', ({ pathChanged }) => {
    if (pathChanged) visit.current = { ...visit.current, token: {}, generation: visit.current.generation + 1 };
  }), [router]);
  const owner = current.owner;
  // 成功と失敗表示の受理に同じ訪問境界を使う。通常session確認中も連続ownerだけを受け入れる。
  const acceptsVisit = useCallback(() => mounted.current && visit.current.token === token && typeof owner === 'string' &&
    activeScope.current === scope && window.location.pathname === scope && isDraftOwner(owner, generation), [owner, generation, scope, token]);
  const onSaved = useCallback((complete?: () => boolean) => {
    if (typeof owner === 'string' && acceptsVisit()) setSaved({ owner, generation, scope, token, ...(complete ? { complete } : {}) });
  }, [owner, generation, scope, token, acceptsVisit]);
  const confirmed = saved !== undefined && saved.token === visit.current.token && saved.scope === scope && window.location.pathname === scope && saved.generation === generation &&
    isDraftOwner(saved.owner, saved.generation) && current.owner === saved.owner && privateDataReady(current);
  const error = confirmed && failedCompletion?.receipt === saved ? failedCompletion.error : null;
  useEffect(() => {
    if (confirmed && !error && saved?.token === visit.current.token && window.location.pathname === scope && isDraftOwner(saved.owner, saved.generation) && delivered.current !== saved) {
      // 確認中の一時unmountでも、この訪問の確定成功を採用するときは該当操作を終了する。
      // 離脱/owner変更後の旧成功では呼ばない。K2へ置換済みならK2を残してそのフォームへ戻す。
      try {
        if (saved.complete && !saved.complete()) { setSaved(undefined); return; }
      } catch (error) { setFailedCompletion({ receipt: saved, error }); return; }
      delivered.current = saved;
      void navigate({ to: '/goals' });
    }
  }, [confirmed, error, saved, scope, navigate]);
  return { onSaved, confirmed, error, acceptsVisit, operationVisit: [instance, visit.current.generation] as const };
}
