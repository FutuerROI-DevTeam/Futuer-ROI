import { buildApp } from './app.ts';
import { createBackgroundTasks } from './auth/background.ts';
import { createMailer } from './auth/mail-transport.ts';
import { createAuth } from './auth/options.ts';
import { loadAuthConfig, loadConfig, loadMailConfig } from './config.ts';
import { createAppPool, createAuthPool } from './db/pool.ts';
import { loadEvaluationOptions } from './evaluation/policy.ts';
import { loadMilestoneOptions } from './milestone/policy.ts';

const config = loadConfig();
const authConfig = loadAuthConfig(process.env, config);
const mailConfig = loadMailConfig(process.env);
const pool = createAppPool({ connectionString: config.databaseUrl });
// 認証は専用pool（int8を数値で読む）。接続数はアプリ用5＋認証用2を合算してDB側の上限と比べる。
const authPool = createAuthPool({ connectionString: config.databaseUrl });
// 再設定メールの送信は応答と切り離して走らせ、終了時に完了を待つ。
const background = createBackgroundTasks();
const auth = createAuth({
  pool: authPool,
  secret: authConfig.secret,
  baseURL: authConfig.baseURL,
  trustedOrigins: authConfig.trustedOrigins,
  signInMax: authConfig.signInMax,
  signUpMax: authConfig.signUpMax,
  resetMax: authConfig.resetMax,
  mailer: createMailer(mailConfig),
  background: background.run,
});
const app = await buildApp({
  pool,
  webDist: config.webDist,
  logLevel: config.logLevel,
  evaluation: loadEvaluationOptions(),
  milestoneCalibration: loadMilestoneOptions(),
  auth: {
    instance: auth,
    baseURL: authConfig.baseURL,
    allowedOrigins: [authConfig.baseURL, ...authConfig.trustedOrigins],
    trustProxyHops: authConfig.trustProxyHops,
  },
});

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutdown: stop accepting connections');
  // 処理中の要求が終わらない場合でも、猶予時間を過ぎたら異常終了として打ち切る。
  const deadline = setTimeout(() => {
    app.log.error({ timeoutMs: config.shutdownTimeoutMs }, 'shutdown: timed out');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  deadline.unref();
  try {
    await app.close(); // listenerを閉じ、処理中の要求を完了させる
    await background.drain(); // 応答後に預かったメール送信を終えてから
    await pool.end(); // その後にDB接続を返す
    await authPool.end();
    app.log.info({ signal }, 'shutdown: complete');
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown: failed');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
app.log.info({ baseURL: authConfig.baseURL, trustProxyHops: authConfig.trustProxyHops, mailTransport: mailConfig.transport }, 'auth: configured');
