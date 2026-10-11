import { APIError, createAuthMiddleware } from 'better-auth/api';

// 1.7.7のsignOutは削除例外（削除前lookupの例外も）を捕捉してCookieを消す。
// HTTP routerのOrigin/CSRF検査後、SDK署名で確かめたtokenだけを先に削除する。
// 現設定はDB sessionのみ（secondary storage・session delete hooksなし）。追加時はこの境界を再検討する。
export const confirmSignOut = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-out') return;
  const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
  if (!token) return; // 未ログイン・不正署名のCookie処理はSDKに委ねる。
  try {
    // internalAdapter.deleteSessionの読み取り失敗によるno-opを避ける。
    // tokenはunique。0行でも既に失効済みとして明示再試行を成功にできる。
    await ctx.context.adapter.delete({ model: 'session', where: [{ field: 'token', value: token }] });
  } catch {
    // DB削除結果が不明な場合もCookieを保持。失効保証ではなく、明示再試行のための失敗契約。
    throw new APIError('SERVICE_UNAVAILABLE', {
      code: 'SIGN_OUT_UNCONFIRMED',
      message: 'Sign-out could not be confirmed. Please retry.',
    });
  }
});
