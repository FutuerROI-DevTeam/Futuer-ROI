import { createAuthClient } from 'better-auth/react';

// 同一originの `/api/auth/*` を使う（baseURL省略）。Cookieはブラウザが同一originで送る。
export const authClient = createAuthClient();

// 429の待ち時間（整数秒）。無効な値は null にして、画面側で既定の待ち時間へ切り替える。
export function retryAfterSeconds(response: Response | undefined): number | null {
  const raw = response?.headers.get('x-retry-after');
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function describeAuthError(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'SIGN_OUT_UNCONFIRMED':
      return 'ログアウトを確認できませんでした。時間をおいて、もう一度ログアウトしてください。';
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'メールアドレスまたはパスワードが正しくありません。';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'このメールアドレスは登録済みです。ログインしてください。';
    case 'PASSWORD_TOO_SHORT':
      return 'パスワードが短すぎます。8文字以上にしてください。';
    case 'INVALID_EMAIL':
      return 'メールアドレスの形式が正しくありません。';
    default:
      return fallback || '処理に失敗しました。時間をおいて再試行してください。';
  }
}
