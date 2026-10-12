import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Pool } from 'pg';
import type { Mailer } from './mailer.ts';
import { resetPasswordMail } from './reset-mail.ts';
import { confirmSignOut } from './sign-out.ts';

// 認証テーブルの形を決めるBetter Authの設定。migration（db:migrate:auth）と実行時の認証設定が
// 同じ関数を使うことで、作成されるテーブルと実際に使う機能のずれを防ぐ。
// 回数制限はDBへ保存する（再起動・複数instanceをまたいで効かせる。Architecture「実装時に必要な対策」）。
// 版は固定（better-auth 1.7.7、lockfile）。`@latest`のCLIは使わない。
export function authSchemaOptions(pool: Pool) {
  return {
    database: pool,
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100 },
  } satisfies BetterAuthOptions;
}

// Fastify側が信頼できるclient IPを1つだけ入れて渡すheader。client送信分はbridgeで必ず上書きする。
export const TRUSTED_IP_HEADER = 'x-futureroi-client-ip';

// 再設定トークンの有効期間。メール本文の「1時間で無効」と同じ値を使う。
export const RESET_TOKEN_TTL_SECONDS = 3600;

export type AuthSettings = {
  pool: Pool;
  secret: string;
  /** 公開base URL。Cookieの`Secure`はこのURLのschemeで決まる。 */
  baseURL: string;
  /** baseURL以外に認証endpointへの要求を許すorigin（開発時のViteなど）。 */
  trustedOrigins?: string[];
  /** 1 IPあたり60秒の試行上限。 */
  signInMax: number;
  signUpMax: number;
  /** パスワード再設定の要求・実行の、1 IPあたり60秒の上限。 */
  resetMax: number;
  /** パスワード再設定メールの送信手段（[mailer.ts](./mailer.ts)）。 */
  mailer: Mailer;
};

export function createAuth(s: AuthSettings) {
  const schema = authSchemaOptions(s.pool);
  return betterAuth({
    ...schema,
    emailAndPassword: {
      ...schema.emailAndPassword,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      // 1.7.7はこの関数が無いと`/request-password-reset`を400 RESET_PASSWORD_DISABLEDで拒否する。
      // SDKのrunInBackgroundOrAwaitは（backgroundTasks.handler未設定の現設定では）この関数の完了を待ち、
      // 例外は自身のloggerへERRORで記録して応答は200のまま返す（登録の有無をstatusで漏らさないため）。
      // 送信失敗は利用者へは見えず、サーバーログで気付く。完了を待つのでVercel Functionでも送信が途中で切れない。
      sendResetPassword: async ({ user, url }) => {
        await s.mailer({ to: user.email, ...resetPasswordMail({ url, expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60 }) });
      },
    },
    secret: s.secret,
    baseURL: s.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [s.baseURL, ...(s.trustedOrigins ?? [])],
    rateLimit: {
      ...schema.rateLimit,
      customRules: {
        '/sign-in/email': { window: 60, max: s.signInMax },
        '/sign-up/email': { window: 60, max: s.signUpMax },
        '/request-password-reset': { window: 60, max: s.resetMax },
        '/reset-password': { window: 60, max: s.resetMax },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: [TRUSTED_IP_HEADER] } },
    hooks: { before: confirmSignOut },
  });
}

export type Auth = ReturnType<typeof createAuth>;
