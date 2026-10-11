import { attachDatabasePool } from '@vercel/functions/db-connections';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { createAuth } from './auth/options.ts';
import { loadAuthConfig, loadConfig } from './config.ts';
import { createAppPool, createAuthPool } from './db/pool.ts';
import { errorBody } from './http/errors.ts';

// Vercelだけの起動境界。常駐serverのlisten/signal処理やmigrationには関与しない。
async function initialize(): Promise<FastifyInstance> {
  // 開発用Secretの自動生成へ落ちない。build/import時には設定もDBも読まない。
  if (process.env.NODE_ENV !== 'production') throw new Error('Vercel runtime requires NODE_ENV=production');
  const config = loadConfig();
  const authConfig = loadAuthConfig(process.env, config);
  const pool = createAppPool({ connectionString: config.databaseUrl });
  let authPool: ReturnType<typeof createAuthPool> | undefined;
  let app: FastifyInstance | undefined;
  try {
    authPool = createAuthPool({ connectionString: config.databaseUrl });
    // 固定版のpg releaseイベントを公式waitUntilのidle猶予へ接続する。接続上限・型・timeoutは既存のまま。
    attachDatabasePool(pool);
    attachDatabasePool(authPool);
    const auth = createAuth({ pool: authPool, secret: authConfig.secret, baseURL: authConfig.baseURL,
      trustedOrigins: authConfig.trustedOrigins, signInMax: authConfig.signInMax, signUpMax: authConfig.signUpMax });
    app = await buildApp({ pool,
      // cwd/ProviderのWEB_DISTに依存せず、配備物内のWebを使う。SPA fallbackはbuildAppの既存実装。
      webDist: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
      logLevel: config.logLevel,
      auth: { instance: auth, baseURL: authConfig.baseURL,
        allowedOrigins: [authConfig.baseURL, ...authConfig.trustedOrigins], trustProxyHops: authConfig.trustProxyHops } });
    await app.ready();
    return app;
  } catch (error) {
    await app?.close().catch(() => undefined);
    await Promise.allSettled([pool.end(), ...(authPool ? [authPool.end()] : [])]);
    throw error;
  }
}

export function createVercelHandler(start: () => Promise<FastifyInstance> = initialize) {
  let pending: Promise<FastifyInstance> | undefined;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      // 同時cold requestも起動を共有し、失敗後の再試行は古い失敗Promiseを保持しない。
      const current = pending ??= Promise.resolve().then(start);
      let app: FastifyInstance;
      try { app = await current; } catch (error) {
        if (pending === current) pending = undefined;
        throw error;
      }
      if (response.destroyed || response.writableEnded) return;
      // raw streamをFastifyへ渡す。body parse/route/auth/serializerを別実装せず、応答終了までFunctionを待たせる。
      await new Promise<void>((resolve, reject) => {
        const finish = () => { response.off('finish', finish); response.off('close', finish); resolve(); };
        response.once('finish', finish);
        response.once('close', finish);
        try { app.server.emit('request', request, response); } catch (error) {
          response.off('finish', finish); response.off('close', finish); reject(error);
        }
      });
    } catch {
      // 起動例外には接続先等が含まれ得る。原文を応答・logへ出さず、私的応答を保存させない。
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent) {
        response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify(errorBody('UNAVAILABLE', 'Server startup unavailable.')));
      } else response.destroy();
    }
  };
}

export default createVercelHandler();
