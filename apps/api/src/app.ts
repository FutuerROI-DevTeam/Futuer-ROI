import fastifyStatic from '@fastify/static';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply } from 'fastify';
import { resolve, sep } from 'node:path';
import type { Pool } from 'pg';
import { registerAuthBridge } from './auth/bridge.ts';
import type { Auth } from './auth/options.ts';
import { Health } from './contracts/index.ts';
import { registerGoalRoutes } from './goals/routes.ts';
import { isValidTimeZone } from './goals/local-date.ts';
import { apiBoundary } from './http/api-boundary.ts';
import { errorBody } from './http/errors.ts';
import { registerApiGuards } from './http/guards.ts';
import { registerLogRoutes } from './logs/routes.ts';
import { PredictionFailed } from './prediction/engine.ts';
import { registerTodayRoute } from './prediction/routes.ts';
import { registerEvaluationRoutes } from './evaluation/routes.ts';
import type { EvaluationOptions } from './evaluation/policy.ts';
import { registerMilestoneRoutes } from './milestone/routes.ts';
import type { MilestoneOptions } from './milestone/policy.ts';

export type AppOptions = {
  pool: Pool;
  /** ビルド済みSPAのディレクトリ。指定時は同一originで配信する。 */
  webDist?: string | undefined;
  /** false でログを止める（テスト用）。 */
  logger?: boolean;
  logLevel?: string;
  /** 認証。未指定なら`/api/auth/*`と保護hookを登録しない（配信・healthだけのテスト用）。 */
  auth?: {
    instance: Auth;
    /** `/api/auth/*`のbase URL（Cookie属性とURL組み立てに使う）。 */
    baseURL: string;
    /** 状態を変える`/api/*`要求に許すOrigin。 */
    allowedOrigins: readonly string[];
    /** 信頼するproxyのhop数。0なら直接接続のpeerをclient IPとする。 */
    trustProxyHops: number;
  };
  /** 現在時刻。Goalのtimezoneでの「今日」の判定に使う。テストでは固定した時刻を渡す。 */
  now?: () => Date;
  /** 本人の明示操作による評価保存。省略時OFF、本番有効化は別途判断。 */
  evaluation?: EvaluationOptions;
  /** 本人の別opt-inによる途中到達補助。省略時OFF、標準Todayへ自動適用しない。 */
  milestoneCalibration?: MilestoneOptions;
};

type PgError = FastifyError & { code?: string };

const JSON_404 = errorBody('NOT_FOUND', 'No such route.');

export async function buildApp(o: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      o.logger === false
        ? false
        : {
            level: o.logLevel ?? 'info',
            // 認証情報・Cookieはログへ出さない（障害調査に必要な最小ログに留める）。
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
          },
    // 契約違反を黙って受理しない: 未知の項目を削らず、型を変換せず、違反をすべて報告する。
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true, formats: { 'iana-timezone': isValidTimeZone } } },
    // 信頼するhop数ぶんだけX-Forwarded-Forを遡ってclient IPを決める（回数制限の鍵）。
    trustProxy: o.auth && o.auth.trustProxyHops > 0 ? (_address: string, hop: number) => hop < o.auth!.trustProxyHops : false,
    // routerが拒否する要求（不正なpercent-encoding等）もsetErrorHandlerを通らないため、ここで共通のJSON形式に揃える。
    frameworkErrors(error, request, reply) {
      // routerで拒否された要求にも、通常のAPI応答と同じ保存禁止を適用する。
      if (apiBoundary(undefined, request.url ?? '') === 'protected') reply.header('cache-control', 'no-store');
      // route未確定のためreplyの応答型が汎用になっている。送るのは共通エラー形式だけ。
      (reply as FastifyReply).code(error.statusCode ?? 400).send(errorBody('BAD_REQUEST', error.message));
    },
  });

  // idle中の接続がDB側・network側から切られると、poolは'error'イベントで知らせる。listenerがないとNodeは
  // 未処理のerrorとしてプロセスを終了する。poolが該当clientを自動で破棄するため、ここでは記録だけ行う。
  o.pool.on('error', (error) => {
    app.log.warn({ err: error }, 'db: idle connection lost; the pool discarded it');
  });

  // 終了処理中に完了した応答がkeep-alive接続を維持しないようにし、処理中の要求を完了させてから閉じる。
  app.addHook('onSend', async (request, reply, payload) => {
    // 私的APIは成功・失敗とも保存させない。healthとSPA/assetsの既存方針は維持する。
    const boundary = apiBoundary(request.routeOptions.url, request.url);
    if (boundary === 'protected' || boundary === 'auth') reply.header('cache-control', 'no-store');
    if (!app.server.listening) reply.header('connection', 'close');
    return payload;
  });

  app.setErrorHandler((error: PgError, request, reply) => {
    if (error.validation) {
      // 違反した項目をすべて返す。同じ項目に複数の規則（長さとpattern、unionの各候補）が当たる場合は最初の1件にまとめる。
      const fields = new Map<string, string>();
      for (const v of error.validation) {
        const params = v.params as { additionalProperty?: string; missingProperty?: string };
        const extra = params.additionalProperty ?? params.missingProperty;
        const path = `${error.validationContext ?? 'body'}${v.instancePath}${extra ? `/${extra}` : ''}`;
        if (!fields.has(path)) fields.set(path, v.message ?? 'invalid');
      }
      return reply.code(422).send(
        errorBody(
          'VALIDATION_ERROR',
          'Request does not match the contract.',
          [...fields].map(([path, message]) => ({ path, message })),
        ),
      );
    }
    // PostgreSQLの制約違反（一意: 23505、CHECK: 23514）も契約違反として422で返す。
    if (error.code === '23505' || error.code === '23514') {
      return reply.code(422).send(errorBody('CONSTRAINT_VIOLATION', 'Rejected by a database constraint.'));
    }
    if (error instanceof PredictionFailed) {
      // 保存済みデータから作った入力をEngineが拒否した。利用者の操作では直せないため原因だけ記録して500。
      request.log.error({ name: error.failureName, kind: error.kind, reason: error.reason, path: error.path }, 'prediction: engine rejected stored input');
      return reply.code(500).send(errorBody('PREDICTION_FAILED', 'Prediction could not be computed.'));
    }
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.code(error.statusCode).send(errorBody('BAD_REQUEST', error.message));
    }
    request.log.error(error);
    return reply.code(500).send(errorBody('INTERNAL', 'Internal error.'));
  });

  if (o.auth) {
    registerApiGuards(app, o.auth.instance, o.auth.allowedOrigins);
    registerAuthBridge(app, o.auth.instance, o.auth.baseURL);
    // 業務APIは保護hookの内側にだけ置く（認証なしの構成ではGoal・記録・Today APIを公開しない）。
    const deps = { pool: o.pool, now: o.now ?? (() => new Date()) };
    await registerGoalRoutes(app, deps);
    await registerLogRoutes(app, deps);
    await registerTodayRoute(app, deps);
    await registerEvaluationRoutes(app, { ...deps, options: o.evaluation });
    await registerMilestoneRoutes(app, { ...deps, options: o.milestoneCalibration });
  }

  // Type Providerはpluginごとに適用する（Fastifyのカプセル化により外側の指定は継承されない）。
  await app.register(async (instance) => {
    const api = instance.withTypeProvider<TypeBoxTypeProvider>();
    api.get('/api/health', { schema: { response: { 200: Health, 503: Health } } }, async (request, reply) => {
      try {
        await o.pool.query('select 1');
        return { status: 'ok', database: 'ok' } as const;
      } catch (error) {
        request.log.warn({ err: error }, 'health: database unreachable');
        return reply.code(503).send({ status: 'error', database: 'unreachable' });
      }
    });
  });

  if (o.webDist) {
    const root = resolve(o.webDist);
    await app.register(fastifyStatic, {
      root,
      wildcard: false,
      cacheControl: false,
      setHeaders(reply, pathName) {
        // Viteのassetsはファイル名にhashを含むため長期キャッシュ、index.htmlは毎回再検証する。
        reply.header('cache-control', pathName.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) => {
      // 判定はpercent-encodingを解いたpathで行う（`/api%2Fnope`や`/assets/old%2Ejs`を画面URLと誤認しない）。
      let path: string;
      try {
        path = decodeURIComponent(request.url.split('?')[0] ?? '');
      } catch {
        return reply.code(404).send(JSON_404); // 不正なpercent-encoding
      }
      const lastSegment = path.slice(path.lastIndexOf('/') + 1);
      const isApiNamespace = path === '/api' || path.startsWith('/api/');
      const isAssetRequest = path.startsWith('/assets/') || lastSegment.includes('.');
      // API namespace、対象外のmethod、存在しないasset・拡張子付きのファイル要求にはSPAのHTMLを返さない。
      if (isApiNamespace || (request.method !== 'GET' && request.method !== 'HEAD') || isAssetRequest) {
        return reply.code(404).send(JSON_404);
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send(JSON_404));
  }

  return app;
}
