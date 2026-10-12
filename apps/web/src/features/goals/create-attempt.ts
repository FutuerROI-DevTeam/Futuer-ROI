import { GoalCreate as GoalCreateSchema, type GoalCreate } from '@contracts';
import { FormatRegistry } from '@sinclair/typebox';
import { isValidTimezone } from '../../calendar.ts';
import { Value } from '@sinclair/typebox/value';
import { ApiError } from '../../api/client.ts';

export class CreateRecoveryError extends Error {
  constructor() {
    super('作成の回復情報を読めません。Goal一覧で作成結果を確認してください。');
  }
}

/** 送信結果が確定した競合・所有者変更・削除と、回復情報の破損を通信失敗から分ける。 */
export function createFailureKind(error: unknown): 'recovery' | 'conflict' | 'owner' | 'deleted' | null {
  if (error instanceof CreateRecoveryError) {
    return 'recovery';
  }
  if (!(error instanceof ApiError)) {
    return null;
  }
  if (error.status === 409 && error.body?.error.code === 'IDEMPOTENCY_CONFLICT') {
    return 'conflict';
  }
  if (error.status === 409 && error.body?.error.code === 'CREATE_OWNER_CHANGED') {
    return 'owner';
  }
  if (error.status === 410 && error.body?.error.code === 'CREATE_RESULT_DELETED') {
    return 'deleted';
  }
  return null;
}

export type CreateAttempt = {
  owner: string;
  key: string;
  body: GoalCreate;
  readonly raw: string;
};
export type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// GoalCreateのcustom formatをFEの同じtimezone検証で登録する。
FormatRegistry.Set('iana-timezone', isValidTimezone);
const storageKey = (owner: string) => `future-roi:create-attempt:${owner}`;
// 一般の下書きではなく「送信済みかもしれない作成操作」。token/passwordは保存しない。
export function loadCreateAttempt(owner: string, storage: AttemptStorage): CreateAttempt | null {
  try {
    const text = storage.getItem(storageKey(owner));
    if (text === null) {
      return null;
    }
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') {
      throw new CreateRecoveryError();
    }
    const attempt = value as CreateAttempt;
    if (attempt.owner !== owner
      || typeof attempt.key !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt.key)
      || !Value.Check(GoalCreateSchema, attempt.body)) {
      throw new CreateRecoveryError();
    }
    return { owner: attempt.owner, key: attempt.key, body: attempt.body, raw: text };
  } catch {
    throw new CreateRecoveryError();
  }
}

export function prepareCreateAttempt(
  owner: string,
  body: GoalCreate,
  storage: AttemptStorage,
  key: () => string = () => crypto.randomUUID(),
): CreateAttempt {
  const previous = loadCreateAttempt(owner, storage);
  if (previous) {
    return previous;
  }
  const attempt = { owner, key: key(), body: JSON.parse(JSON.stringify(body)) as GoalCreate };
  // 永続化できない場合は送らない。応答不明後に新しいkeyで増殖させないため。
  const raw = JSON.stringify(attempt);
  storage.setItem(storageKey(owner), raw);
  return { ...attempt, raw };
}
// 確定した実送信snapshotだけを終了する。APIに拒否されたbodyを再検証せず、
// owner/key/rawの一致で遅延応答によるK2や別bodyの削除を防ぐ。初回ロードは上の厳密検証を使う。
export function clearCreateAttempt(operation: CreateAttempt, storage: AttemptStorage): boolean {
  try {
    const raw = storage.getItem(storageKey(operation.owner));
    if (raw === null) {
      return true;
    }
    if (raw !== operation.raw) {
      return false;
    }
    const stored = JSON.parse(raw) as { owner?: unknown; key?: unknown } | null;
    if (stored?.owner !== operation.owner || stored?.key !== operation.key) {
      return false;
    }
    storage.removeItem(storageKey(operation.owner));
    return true;
  } catch {
    throw new CreateRecoveryError();
  }
}
