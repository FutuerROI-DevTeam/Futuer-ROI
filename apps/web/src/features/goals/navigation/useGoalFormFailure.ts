import { useCallback, useEffect, useReducer, useRef } from 'react';
import { privateDataReady, type PrivateEpoch } from '../../../api/session-cache.ts';

/** 失敗したフォームの表示だけを同owner・同訪問へ退避する。mutation/自動再送/成功遷移は復元しない。 */
export function useGoalFormFailure<T>(current: PrivateEpoch, acceptsVisit: () => boolean) {
  const held = useRef<{ value: T; accepts: () => boolean; complete?: () => boolean; error?: unknown } | undefined>(undefined);
  const [version, notify] = useReducer(value => value + 1, 0);
  // このreceiptが生成された訪問の関数で判定する。確認中のowner=undefinedだけでは捨てない。
  if (held.current && !held.current.accepts()) held.current = undefined;
  const remember = useCallback((value: T | undefined, complete?: () => boolean, changed = false) => {
    if (!acceptsVisit()) return;
    held.current = value === undefined ? undefined : { value, accepts: acceptsVisit, ...(complete ? { complete } : {}) };
    if (changed) notify();
  }, [acceptsVisit]);
  const receipt = held.current;
  const ready = privateDataReady(current) && receipt?.accepts() === true;
  useEffect(() => {
    // 確認中に返った作成422も、同じ訪問の同key/rawだけを確定終了する。別owner/訪問/K2を消さない。
    if (!ready || !receipt?.complete || held.current !== receipt || !receipt.accepts()) return;
    try {
      if (!receipt.complete()) held.current = undefined;
      else delete receipt.complete;
    } catch (error) { receipt.error = error; delete receipt.complete; }
    notify();
  }, [ready, receipt, version]);
  return { remember, restored: ready && !receipt?.complete ? receipt?.value : undefined,
    pending: ready && Boolean(receipt?.complete), error: ready ? receipt?.error : undefined };
}
