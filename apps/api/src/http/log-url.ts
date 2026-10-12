// 要求ログへ出すURLから、パスワード再設定トークンを除く。トークンは有効期間（1時間）中は
// それだけでパスワードを変えられるbearer tokenなので、ログを読める人へ渡さない。
//
// トークンが現れる場所（Better Auth 1.7.7の経路と、Webの再設定画面）:
//   GET  /api/auth/reset-password/<token>?callbackURL=...   メールのリンク
//   GET  /reset-password?token=<token>                      リンクのredirect先（SPA）
//   POST /api/auth/reset-password?token=<token>             SDKはbodyでも受けるが、queryも受理する
export const REDACTED = '[REDACTED]';

function decodedKey(key: string): string {
  try { return decodeURIComponent(key.replaceAll('+', ' ')).toLowerCase(); } catch { return key.toLowerCase(); }
}

export function redactLogUrl(url: string): string {
  const queryAt = url.indexOf('?');
  const path = (queryAt < 0 ? url : url.slice(0, queryAt)).replace(/(\/reset-password\/)[^/]*/gi, `$1${REDACTED}`);
  if (queryAt < 0) return path;
  // `%74oken=`のような符号化したキーもSDKは`token`として受理するため、復号したキー名で判定する
  const query = url.slice(queryAt + 1).split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    return decodedKey(key) === 'token' ? `${key}=${REDACTED}` : pair;
  });
  return `${path}?${query.join('&')}`;
}
