import { authClient } from './client.ts';

/**
 * 画面を開く前のログインの確認結果。
 * - signed-in：ログインしている
 * - signed-out：ログインしていない（API は 200 で session なしを返す）
 * - unreachable：確認できなかった（通信の失敗・API の 5xx など）。未ログインと取り違えてログイン画面へ送らない
 */
export type SessionCheck = { kind: 'signed-in'; email: string } | { kind: 'signed-out' } | { kind: 'unreachable' };

type SessionResult = { data?: { user?: { email?: string | null } | null } | null; error?: unknown } | null | undefined;

/** getSession の結果を3つに分ける。投げた例外（通信の失敗）は呼ぶ側で unreachable にする。 */
export function classifySession(result: SessionResult): SessionCheck {
  if (!result || result.error) return { kind: 'unreachable' };
  const user = result.data?.user;
  return user ? { kind: 'signed-in', email: user.email ?? '' } : { kind: 'signed-out' };
}

let checking: Promise<SessionCheck> | undefined;

/** ルートと画面で同じ確認結果を使う。並行するルート確認で再取得を互いに中断しない。 */
export function checkSession(): Promise<SessionCheck> {
  return checking ??= confirmSession().finally(() => {
    checking = undefined;
  });
}

async function confirmSession(): Promise<SessionCheck> {
  try {
    // getSession()単独の成功はuseSessionのstoreを更新しない。
    // 新Cookieでルートを開き、旧ownerのstoreで業務応答を表示する間を作らない。
    const session = authClient.$store.atoms.session;
    if (!session) return { kind: 'unreachable' };
    await session.get().refetch();
    // signin通知・focusが途中で新しい確認へ置き換えた場合も、その完了まで待つ。
    const result = await new Promise<ReturnType<typeof session.get>>((resolve) => {
      const settled = (value: ReturnType<typeof session.get>) => {
        if (!value.isPending && !value.isRefetching) {
          stop();
          resolve(value);
        }
      };
      const stop = session.listen(settled);
      settled(session.get());
    });
    return classifySession(result);
  } catch {
    return { kind: 'unreachable' };
  }
}

/** ログインを確認できなかった（通信の失敗）。ルートのエラー画面で「接続できませんでした」として扱う。 */
export class SessionUnreachableError extends Error {
  constructor() {
    super('ログインの状態を確認できませんでした。');
    this.name = 'SessionUnreachableError';
  }
}
