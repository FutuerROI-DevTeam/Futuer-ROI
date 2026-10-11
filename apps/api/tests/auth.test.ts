import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { Client, cookieShape, credentials, setup, startStack } from './helpers/stack.ts';

test('PostgreSQL session: DELETE故障の503はno-store、Cookie保持、明示再試行後に旧Cookie401', async (t) => {
  let failing = false;
  let deletes = 0;
  const { db, stack } = await setup(t, {}, {
    startStack: (database, options) => startStack(database, options, {
      buildApp: async (appOptions) => {
        const context = await appOptions.auth!.instance.$context;
        const remove = context.adapter.delete.bind(context.adapter);
        // PostgreSQLと実createAuth/bridge/guard/appを使用し、DELETE故障だけを合成する。
        context.adapter.delete = async (input) => {
          if (input.model === 'session') {
            deletes++;
            if (failing) throw new Error('synthetic session DELETE failure');
          }
          return remove(input);
        };
        return buildApp(appOptions);
      },
    }),
  });
  const a = new Client(stack.app, 'http://127.0.0.1:3000');
  assert.equal((await a.call('POST', '/api/auth/sign-up/email', credentials('logout-failure'))).status, 200);
  const cookie = a.cookieHeader();
  failing = true;
  const failure = await a.call('POST', '/api/auth/sign-out', {});
  assert.equal(failure.status, 503);
  assert.equal(failure.json?.code, 'SIGN_OUT_UNCONFIRMED');
  assert.equal(failure.headers['cache-control'], 'no-store');
  assert.deepEqual(failure.setCookie, []);
  assert.equal(a.cookieHeader(), cookie);
  assert.equal((await db.pool.query('select id from session')).rowCount, 1);
  assert.equal((await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } })).statusCode, 200);
  failing = false;
  assert.equal((await a.call('POST', '/api/auth/sign-out', {})).status, 200);
  assert.equal(a.cookies.size, 0);
  assert.equal((await db.pool.query('select id from session')).rowCount, 0);
  assert.equal((await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } })).statusCode, 401);
  assert.equal(deletes, 2);
});

test('未ログインでは /api/goals を含む /api/* が401、/api/health だけ公開', async (t) => {
  const { stack } = await setup(t);
  const anon = new Client(stack.app, 'http://127.0.0.1:3000');
  for (const [method, url, body] of [
    ['GET', '/api/goals'],
    ['POST', '/api/goals', { title: 'x' }],
    ['GET', '/api/goals/00000000-0000-4000-8000-000000000000/today'],
    ['PUT', '/api/goals/00000000-0000-4000-8000-000000000000/logs/2026-10-05', { status: 'SKIPPED' }],
  ] as const) {
    const res = await anon.call(method, url, body);
    assert.equal(res.status, 401, `${method} ${url}`);
    assert.deepEqual(res.json, { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } });
  }
  assert.equal((await anon.call('GET', '/api/health')).status, 200);
});

test('登録→セッション→再読み込み→ログアウト→古いCookieは401', async (t) => {
  const { stack } = await setup(t);
  const origin = 'http://127.0.0.1:3000';
  const a = new Client(stack.app, origin);
  const cred = credentials('a');

  const signUp = await a.call('POST', '/api/auth/sign-up/email', cred);
  assert.equal(signUp.status, 200);
  const session = signUp.setCookie.map(cookieShape).find((c) => c.name.endsWith('session_token'));
  assert.ok(session, 'session cookie set');
  assert.ok(session.attributes.includes('httponly') && session.attributes.includes('samesite=lax') && session.attributes.includes('path=/'));
  assert.ok(!session.attributes.includes('secure'), 'plain http base URL has no Secure flag');

  const me = await a.call('GET', '/api/auth/get-session');
  assert.equal(me.status, 200);
  assert.equal((me.json?.user as { email: string }).email, cred.email);

  // 再読み込み: Cookieだけを持つ新しい要求でも保護APIを通過する（Goalはまだないので空の一覧）
  const reload = await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie: a.cookieHeader() } });
  assert.equal(reload.statusCode, 200);
  assert.deepEqual(reload.json(), []);

  const oldCookie = a.cookieHeader();
  const signOut = await a.call('POST', '/api/auth/sign-out', {});
  assert.equal(signOut.status, 200);
  assert.ok(signOut.setCookie.length >= 1, 'sign-out clears cookies');
  assert.equal(a.cookies.size, 0);
  const replay = await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie: oldCookie } });
  assert.equal(replay.statusCode, 401, 'revoked session cookie is rejected');

  const wrong = await a.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: cred.password + 'x' });
  assert.equal(wrong.status, 401);
  const again = await a.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: cred.password });
  assert.equal(again.status, 200);
  assert.ok(a.cookies.size > 0);
});

test('通常の保護API利用でsessionを延長し、更新Cookieも返す', async (t) => {
  const { db, stack } = await setup(t);
  const client = new Client(stack.app, 'http://127.0.0.1:3000');
  assert.equal((await client.call('POST', '/api/auth/sign-up/email', credentials('refresh'))).status, 200);
  await db.pool.query(`update session set "expiresAt" = now() + interval '1 day', "updatedAt" = now() - interval '6 days'`);
  const before = await db.pool.query<{ expiresAt: Date }>('select "expiresAt" from session');
  const response = await client.call('GET', '/api/goals');
  assert.equal(response.status, 200, 'authenticated request reaches the Goal list');
  assert.deepEqual(response.json, []);
  const cookie = response.setCookie.map(cookieShape).find((c) => c.name.endsWith('session_token'));
  assert.ok(cookie?.attributes.includes('httponly'), 'refresh cookie reaches the client');
  assert.ok(cookie?.attributes.some((attribute) => attribute.startsWith('max-age=')));
  const after = await db.pool.query<{ expiresAt: Date }>('select "expiresAt" from session');
  assert.ok(after.rows[0]!.expiresAt.valueOf() > before.rows[0]!.expiresAt.valueOf());
});

test('期限切れセッションは401になり、画面側が再ログインへ誘導できる', async (t) => {
  const { db, stack } = await setup(t);
  const a = new Client(stack.app, 'http://127.0.0.1:3000');
  await a.call('POST', '/api/auth/sign-up/email', credentials('exp'));
  assert.equal((await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie: a.cookieHeader() } })).statusCode, 200);
  await db.pool.query(`update session set "expiresAt" = now() - interval '1 minute'`);
  assert.equal((await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie: a.cookieHeader() } })).statusCode, 401);
  assert.equal((await a.call('GET', '/api/auth/get-session')).json, null);
});

test('別originからの認証要求と、Cookie付きの状態変更要求は拒否する', async (t) => {
  const { stack } = await setup(t);
  const origin = 'http://127.0.0.1:3000';
  const a = new Client(stack.app, origin);
  const cred = credentials('csrf');
  await a.call('POST', '/api/auth/sign-up/email', cred);

  const evil = new Client(stack.app, 'http://evil.example');
  assert.equal((await evil.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: cred.password })).status, 403);

  const cookie = a.cookieHeader();
  const foreignAuth = await stack.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, payload: '{}' });
  assert.equal(foreignAuth.statusCode, 403, 'auth endpoint rejects foreign Origin even with a valid cookie');

  const foreignApi = await stack.app.inject({ method: 'POST', url: '/api/goals', headers: { cookie, origin: 'http://evil.example', 'content-type': 'application/json' }, payload: '{}' });
  assert.equal(foreignApi.statusCode, 403);
  assert.equal(foreignApi.json().error.code, 'ORIGIN_REJECTED');
  // same-site別origin（port違い）も拒否
  const sameSite = await stack.app.inject({ method: 'POST', url: '/api/goals', headers: { cookie, origin: 'http://127.0.0.1:5174', 'content-type': 'application/json' }, payload: '{}' });
  assert.equal(sameSite.statusCode, 403);
  // Originなし（非ブラウザ）も状態変更は拒否、読み取りは通す
  assert.equal((await stack.app.inject({ method: 'POST', url: '/api/goals', headers: { cookie, 'content-type': 'application/json' }, payload: '{}' })).statusCode, 403);
  assert.equal((await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } })).statusCode, 200);
  // 正規のoriginなら保護hookを通過し、業務routeの検証（空bodyは422）に届く
  assert.equal((await a.call('POST', '/api/goals', {})).status, 422);
  // セッションはそのまま残っている
  assert.equal((await a.call('GET', '/api/auth/get-session')).status, 200);
});

test('https のbase URLでは session cookie が Secure かつ __Secure- 接頭辞になる', async (t) => {
  const { stack } = await setup(t, { baseURL: 'https://app.example.test' });
  const a = new Client(stack.app, 'https://app.example.test');
  const signUp = await a.call('POST', '/api/auth/sign-up/email', credentials('tls'));
  assert.equal(signUp.status, 200);
  const session = signUp.setCookie.map(cookieShape).find((c) => c.name.endsWith('session_token'));
  assert.ok(session?.attributes.includes('secure'));
  assert.ok(session?.name.startsWith('__Secure-'));
  const plainOrigin = new Client(stack.app, 'http://app.example.test');
  assert.equal((await plainOrigin.call('POST', '/api/auth/sign-in/email', { email: 'x@example.test', password: 'whatever-password' })).status, 403);
});

test('認証の回数制限はDBに保存され、再起動（別instance）後も続き、待ち時間は整数秒で返る', async (t) => {
  const { db, stack } = await setup(t, { signInMax: 3, trustProxyHops: 1 });
  const origin = 'http://127.0.0.1:3000';
  const a = new Client(stack.app, origin);
  const cred = credentials('rl');
  await a.call('POST', '/api/auth/sign-up/email', cred);
  await a.call('POST', '/api/auth/sign-out', {});

  const attempt = (app: FastifyInstance, xff: string, password = 'wrong-password-value') =>
    new Client(app, origin).call('POST', '/api/auth/sign-in/email', { email: cred.email, password }, { 'x-forwarded-for': xff });
  const retryAfter = (r: { headers: Record<string, unknown> }) => String(r.headers['x-retry-after'] ?? '');
  const validRetryAfter = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60;

  const statuses: number[] = [];
  let last: Awaited<ReturnType<typeof attempt>> | undefined;
  for (let i = 0; i < 5; i++) {
    // 偽装した左端のアドレスを変えても、信頼hopで決まる右端（203.0.113.5）が鍵になる
    last = await attempt(stack.app, `9.9.9.${i}, 203.0.113.5`);
    statuses.push(last.status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
  assert.ok(last && validRetryAfter(retryAfter(last)), `X-Retry-After=${last && retryAfter(last)}`);
  const correct = await attempt(stack.app, '203.0.113.5', cred.password);
  assert.equal(correct.status, 429, 'while limited, even the correct password is refused');
  assert.equal(correct.headers['cache-control'], 'no-store');
  const stored = await db.pool.query('select count(*)::int as n from "rateLimit"');
  assert.ok((stored.rows[0]?.n as number) >= 1, 'limit is stored in PostgreSQL');

  // 別のIPは影響を受けない
  assert.equal((await attempt(stack.app, '198.51.100.7')).status, 401);

  // 再起動: 同じDBで新しいinstanceを作っても制限が続く
  const restarted = await startStack(db, { signInMax: 3, trustProxyHops: 1 });
  try {
    const afterRestart = await attempt(restarted.app, '203.0.113.5', cred.password);
    assert.equal(afterRestart.status, 429);
    assert.ok(validRetryAfter(retryAfter(afterRestart)));
    assert.ok(Number(retryAfter(afterRestart)) <= Number(retryAfter(last!)), 'the advertised wait does not grow');
  } finally {
    await restarted.close(); // DBを閉じる前に別instanceを止める
  }
});
