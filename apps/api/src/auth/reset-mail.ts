// パスワード再設定メールの日本語文面。Better Authには文面・テンプレートが無いため、ここで持つ。
// 純粋関数にして、送信手段（Resend／ログ）と切り離してテストする。

export const APP_NAME = 'Future ROI';

export type ResetMailInput = {
  /** Better Authが組み立てた再設定URL（`/api/auth/reset-password/<token>?callbackURL=...`）。 */
  url: string;
  /** トークンの有効期間（分）。 */
  expiresInMinutes: number;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function expiry(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}時間` : `${minutes}分`;
}

export function resetPasswordMail(input: ResetMailInput): { subject: string; text: string; html: string } {
  const subject = `【${APP_NAME}】パスワード再設定のご案内`;
  const lines = [
    `${APP_NAME}のパスワード再設定の要求を受け付けました。`,
    '',
    '次のリンクを開いて、新しいパスワードを設定してください。',
    input.url,
    '',
    `このリンクは${expiry(input.expiresInMinutes)}で無効になります。期限が切れた場合は、ログイン画面の「パスワードを忘れた方」からもう一度やり直してください。`,
    '',
    'この要求に覚えがない場合は、このメールを無視してください。パスワードは変更されません。',
    '',
    `${APP_NAME}`,
  ];
  const text = lines.join('\n');
  const url = escapeHtml(input.url);
  const html = [
    '<!doctype html><html lang="ja"><body style="font-family: sans-serif; line-height: 1.7; color: #222;">',
    `<p>${escapeHtml(lines[0]!)}</p>`,
    '<p>次のリンクを開いて、新しいパスワードを設定してください。</p>',
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(lines[5]!)}</p>`,
    `<p>${escapeHtml(lines[7]!)}</p>`,
    `<p>${APP_NAME}</p>`,
    '</body></html>',
  ].join('');
  return { subject, text, html };
}
