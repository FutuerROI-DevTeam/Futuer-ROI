import { authCopy } from '../copy/app.ts';

/**
 * パスワード再設定の画面が使う純粋な判定（/forgot-password・/reset-password）。
 * APIはBetter Authの `/api/auth/request-password-reset` と `/api/auth/reset-password`。
 * メールのリンクはAPIを経由し、`/reset-password?token=…`（有効）か `/reset-password?error=INVALID_TOKEN`（無効・期限切れ）へ戻ってくる。
 */

export type ResetSearch = { token?: string; error?: 'INVALID_TOKEN' };

const c = authCopy.reset;

/** メールのリンクから戻った状態。tokenは空でない文字列だけを受け取り、errorは既知の値だけを残す。 */
export function resetSearch(search: Record<string, unknown>): ResetSearch {
  const token = typeof search.token === 'string' && search.token.trim() !== '' ? search.token : undefined;
  if (token) return { token };
  return search.error === 'INVALID_TOKEN' || search.token !== undefined ? { error: 'INVALID_TOKEN' } : {};
}

/** メールのリンクを開いた後に戻る画面。APIのorigin検査を通るよう、今開いているoriginの絶対URLにする。 */
export function resetRedirectTarget(origin: string): string {
  return `${origin}/reset-password`;
}

/** 再設定を要求する前の検査（ログインと同じ形式の見方）。 */
export function validateResetRequest(email: string): { email?: string } {
  const trimmed = email.trim();
  if (trimmed === '') return { email: authCopy.emailRequired };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { email: authCopy.emailInvalid };
  return {};
}

export type NewPasswordErrors = { password?: string; confirm?: string };

/** 新しいパスワードの検査。APIと同じ下限（8文字）と、確認入力の一致。 */
export function validateNewPassword(password: string, confirm: string): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  if (password === '') errors.password = authCopy.passwordRequired;
  else if (password.length < 8) errors.password = authCopy.passwordShort;
  if (confirm === '') errors.confirm = c.confirmRequired;
  else if (!errors.password && confirm !== password) errors.confirm = c.confirmMismatch;
  return errors;
}
