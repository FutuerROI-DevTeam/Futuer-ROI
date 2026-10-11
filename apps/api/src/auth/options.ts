import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Pool } from 'pg';
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
};

export function createAuth(s: AuthSettings) {
  const schema = authSchemaOptions(s.pool);
  return betterAuth({
    ...schema,
    secret: s.secret,
    baseURL: s.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [s.baseURL, ...(s.trustedOrigins ?? [])],
    rateLimit: {
      ...schema.rateLimit,
      customRules: {
        '/sign-in/email': { window: 60, max: s.signInMax },
        '/sign-up/email': { window: 60, max: s.signUpMax },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: [TRUSTED_IP_HEADER] } },
    hooks: { before: confirmSignOut },
  });
}

export type Auth = ReturnType<typeof createAuth>;
