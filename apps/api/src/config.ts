import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type ApiConfig = {
  host: string;
  port: number;
  databaseUrl: string;
  webDist: string | undefined;
  logLevel: string;
  shutdownTimeoutMs: number;
};

export type AuthConfig = {
  secret: string;
  baseURL: string;
  /** baseURL以外に許すorigin（開発時のVite等）。本番では空。 */
  trustedOrigins: string[];
  /** 信頼するproxyのhop数。client IP（回数制限の鍵）の決定に使う。 */
  trustProxyHops: number;
  signInMax: number;
  signUpMax: number;
  resetMax: number;
};

/** パスワード再設定メールの送信手段。本番の既定はResend、開発・Compose・smoke testはログ出力。 */
export type MailConfig = { transport: 'log' } | { transport: 'resend'; apiKey: string; from: string };

function integer(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`環境変数 ${name} は ${min}〜${max} の整数で指定してください。`);
  }
  return n;
}

// 環境変数からAPIの設定を組み立てる。値（特にDATABASE_URL）はエラーやログに出さない。
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('環境変数 DATABASE_URL が未設定です。.env.example を参照して接続先を設定してください。');
  }
  return {
    host: env.HOST || '127.0.0.1',
    port: integer('PORT', env.PORT, 3000, 1, 65_535),
    databaseUrl,
    webDist: env.WEB_DIST || undefined,
    logLevel: env.LOG_LEVEL || 'info',
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', env.SHUTDOWN_TIMEOUT_MS, 10_000, 1_000, 120_000),
  };
}

const MIN_SECRET_LENGTH = 32;

// 開発専用: BETTER_AUTH_SECRET未設定なら apps/api/.local/auth-secret（Git除外）に1度だけ生成して使い回す。
function localDevelopmentSecret(): string {
  const file = fileURLToPath(new URL('../.local/auth-secret', import.meta.url));
  if (!existsSync(file)) {
    mkdirSync(fileURLToPath(new URL('../.local/', import.meta.url)), { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 });
  }
  return readFileSync(file, 'utf8').trim();
}

// 認証の設定。本番（NODE_ENV=production）ではSecretと公開HTTPS base URLを必須にする。
export function loadAuthConfig(env: NodeJS.ProcessEnv, api: Pick<ApiConfig, 'port'>): AuthConfig {
  const production = env.NODE_ENV === 'production';
  let secret = env.BETTER_AUTH_SECRET || '';
  if (!secret) {
    if (production) throw new Error('環境変数 BETTER_AUTH_SECRET が未設定です（本番では必須）。');
    secret = localDevelopmentSecret();
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`環境変数 BETTER_AUTH_SECRET は ${MIN_SECRET_LENGTH} 文字以上にしてください。`);
  }

  let baseURL = env.BETTER_AUTH_URL || '';
  if (!baseURL) {
    if (production) throw new Error('環境変数 BETTER_AUTH_URL が未設定です（本番では公開URLが必須）。');
    baseURL = `http://127.0.0.1:${api.port}`;
  }
  let origin: string;
  try {
    origin = new URL(baseURL).origin;
  } catch {
    throw new Error('環境変数 BETTER_AUTH_URL はURLの形式で指定してください。');
  }
  if (production && !origin.startsWith('https://') && env.BETTER_AUTH_ALLOW_HTTP !== '1') {
    throw new Error('本番の BETTER_AUTH_URL はhttpsにしてください（Cookieの Secure 属性に必要）。ローカルのコンテナ確認だけ BETTER_AUTH_ALLOW_HTTP=1 で許可できます。');
  }

  const extra = (env.AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
  // 開発時はViteのdev server（/apiをproxy）と、localhost／127.0.0.1の表記違いも同じアプリとして扱う。
  const developmentOrigins = production ? [] : [`http://localhost:${api.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];

  return {
    secret,
    baseURL: origin,
    trustedOrigins: [...new Set([...developmentOrigins, ...extra].filter((o) => o !== origin))],
    trustProxyHops: integer('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, 0, 0, 10),
    signInMax: integer('AUTH_SIGN_IN_MAX', env.AUTH_SIGN_IN_MAX, 5, 1, 1_000),
    signUpMax: integer('AUTH_SIGN_UP_MAX', env.AUTH_SIGN_UP_MAX, 5, 1, 1_000),
    resetMax: integer('AUTH_RESET_MAX', env.AUTH_RESET_MAX, 5, 1, 1_000),
  };
}

// `Name <local@domain>` かアドレスだけ。送信元の形式ミスをResendの応答ではなく起動時に止める。
const MAIL_FROM_PATTERN = /^(?:[^<>@\n]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

// メール送信の設定。実値（APIキー）はエラーやログに出さない。
export function loadMailConfig(env: NodeJS.ProcessEnv): MailConfig {
  const production = env.NODE_ENV === 'production';
  const transport = env.MAIL_TRANSPORT || (production ? 'resend' : 'log');
  if (transport === 'log') return { transport: 'log' };
  if (transport !== 'resend') throw new Error('環境変数 MAIL_TRANSPORT は resend か log を指定してください。');
  const apiKey = env.RESEND_API_KEY || '';
  if (!apiKey) throw new Error('環境変数 RESEND_API_KEY が未設定です（MAIL_TRANSPORT=resend では必須。開発環境では MAIL_TRANSPORT=log でログ出力にできます）。');
  const from = (env.MAIL_FROM || '').trim();
  if (!from) throw new Error('環境変数 MAIL_FROM が未設定です（MAIL_TRANSPORT=resend では必須。例: Future ROI <no-reply@example.com>）。');
  if (!MAIL_FROM_PATTERN.test(from)) throw new Error('環境変数 MAIL_FROM は「表示名 <アドレス>」かアドレスだけの形式で指定してください。');
  return { transport: 'resend', apiKey, from };
}
