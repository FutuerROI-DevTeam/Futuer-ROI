import { memoryAdapter } from 'better-auth/adapters/memory';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuthBridge } from '../../src/auth/bridge.ts';
import { createAuth } from '../../src/auth/options.ts';
import { registerApiGuards } from '../../src/http/guards.ts';

// SDK・署名Cookie・bridge・guardは実装を使い、DB I/OだけをSDK付属のmemory adapterへ置換する。
// Poolを作らず、DATABASE_URLも読まない。故障はsession操作だけに注入する。
export async function signOutFixture(baseURL = 'http://app.test') {
  const db: Record<string, Record<string, unknown>[]> = { user: [], account: [], session: [], rateLimit: [], verification: [] };
  const state = {
    deleteFailure: false,
    lostDeleteReply: false,
    readFailure: false,
    deleteLookupFailure: false,
    beforeDelete: undefined as (() => Promise<void>) | undefined,
    deletes: 0,
    lookups: 0,
  };
  const makeAdapter = memoryAdapter(db);
  const database: typeof makeAdapter = (options) => {
    const adapter = makeAdapter(options);
    const remove = adapter.delete.bind(adapter);
    const findOne = adapter.findOne.bind(adapter);
    const findMany = adapter.findMany.bind(adapter);
    adapter.delete = async (input) => {
      if (input.model === 'session') {
        // 他sessionまで消せる曖昧な条件をfixture側でも受理しない。
        if (input.where.length !== 1 || input.where[0]?.field !== 'token' || (input.where[0].operator ?? 'eq') !== 'eq') {
          throw new Error('Expected deletion of exactly the signed session token.');
        }
        state.deletes++;
        await state.beforeDelete?.();
        if (state.deleteFailure) throw new Error('synthetic session DELETE failure');
      }
      const result = await remove(input);
      if (input.model === 'session' && state.lostDeleteReply) throw new Error('synthetic DELETE acknowledgement lost');
      return result;
    };
    adapter.findOne = async (input) => {
      if (input.model === 'session') {
        state.lookups++;
        if (state.readFailure) throw new Error('synthetic session read failure');
      }
      return findOne(input);
    };
    adapter.findMany = async (input) => {
      if (input.model === 'session' && state.deleteLookupFailure) throw new Error('synthetic deletion lookup failure');
      return findMany(input);
    };
    return adapter;
  };
  // createAuthの設定は現行通り。テストのDB I/O factoryだけをPoolの位置へ渡す。
  const auth = createAuth({ pool: database as unknown as Pool, secret: 'synthetic-test-only-secret-at-least-32-characters', baseURL, signInMax: 100, signUpMax: 100 });
  const context = await auth.$context;
  // 故障時のSDKログにCookieやDB実値を出さない。SDKの制御フローは変えない。
  context.logger.error = () => {};
  const app = Fastify({ logger: false });
  registerApiGuards(app, auth, [baseURL]);
  registerAuthBridge(app, auth, baseURL);
  app.get('/api/protected', (request) => ({ userId: request.userId }));
  const signUp = async (email = 'synthetic-a@example.test') => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', headers: { origin: baseURL }, payload: { name: 'fixture', email, password: 'synthetic-password-only' } });
    if (response.statusCode !== 200) throw new Error(`Fixture sign-up failed (${response.statusCode}).`);
    const raw = response.headers['set-cookie'];
    const lines = typeof raw === 'string' ? [raw] : raw ?? [];
    return lines.map((line) => line.split(';')[0]).join('; ');
  };
  const signOut = (cookie: string, headers: Record<string, string> = {}, payload: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { origin: baseURL, cookie, ...headers }, payload });
  const replay = (cookie: string) => app.inject({ method: 'GET', url: '/api/protected', headers: { cookie } });
  return { app, auth, db, state, baseURL, signUp, signOut, replay };
}
