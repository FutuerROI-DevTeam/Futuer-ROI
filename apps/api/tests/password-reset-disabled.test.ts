import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { APIError } from 'better-auth/api';
import { createLogMailer } from '../src/auth/mailer.ts';
import { createMailer } from '../src/auth/mail-transport.ts';
import { PASSWORD_RESET_ENABLED, PASSWORD_RESET_UNAVAILABLE_MESSAGE } from '../src/auth/password-reset-policy.ts';
import { loadMailConfig } from '../src/config.ts';
import { Client, credentials, setup, startStack } from './helpers/stack.ts';

const origin = 'http://127.0.0.1:3000';
const resetPage = `${origin}/reset-password`;
const disabledError = (error: unknown) => error instanceof APIError && error.statusCode === 503 && error.body?.code === 'RESET_PASSWORD_DISABLED';

test('停止中のメール設定は本番でも資格情報を要求せず、log/resendや環境変数で再開しない', async () => {
  assert.equal(PASSWORD_RESET_ENABLED, false);
  for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'production', MAIL_TRANSPORT: 'log' },
    { NODE_ENV: 'production', MAIL_TRANSPORT: 'resend' }, { MAIL_TRANSPORT: 'smtp', PASSWORD_RESET_ENABLED: '1' }]) {
    assert.deepEqual(loadMailConfig(env), { transport: 'disabled' });
  }
  const unreadable = new Proxy({}, { get: () => { throw new Error('mail configuration must not be read'); } });
  assert.deepEqual(loadMailConfig(unreadable), { transport: 'disabled' });
  await assert.rejects(createMailer(loadMailConfig({}))({ to: 'synthetic@example.test', subject: 'synthetic', text: 'synthetic', html: 'synthetic' }), /unavailable/);
});

test('直HTTPとSDK全再設定経路を停止し、既発行token・password・sessionを変更せず列挙も送信も行わない', async (t) => {
  const mailLines: string[] = [];
  const requestLines: string[] = [];
  const { db, stack } = await setup(t, {
    mailer: createLogMailer((line) => mailLines.push(line)),
    logStream: { write: (line) => requestLines.push(line) },
  });
  const client = new Client(stack.app, origin);
  const cred = credentials('paused');
  assert.equal((await client.call('POST', '/api/auth/sign-up/email', cred)).status, 200);
  assert.equal((await client.call('GET', '/api/auth/get-session')).status, 200);

  // 隔離DB/捕捉mailerで停止前に発行した実SDK tokenを用意する。本番データ/メールログは使わない。
  const active = await startStack(db, { passwordResetEnabled: true });
  let token: string;
  try {
    const oldClient = new Client(active.app, origin);
    assert.equal((await oldClient.call('POST', '/api/auth/request-password-reset', { email: cred.email, redirectTo: resetPage })).status, 200);
    await active.settle();
    const link = /https?:\/\/\S+/.exec(active.mails[0]!.text)![0];
    const url = new URL(link);
    const callback = await oldClient.rawCall('GET', url.pathname + url.search);
    assert.equal(callback.status, 302, 'preexisting token was valid before the pause');
    token = new URL(String(callback.headers.location)).searchParams.get('token')!;
    assert.ok(token);
  } finally { await active.close(); }

  const snapshot = async () => (await db.pool.query(`select
    (select jsonb_agg(to_jsonb(a) order by id) from account a) as accounts,
    (select jsonb_agg(to_jsonb(s) order by id) from session s) as sessions,
    (select jsonb_agg(to_jsonb(v) order by id) from verification v) as verifications`)).rows;
  const before = await snapshot();
  const context = await stack.auth.$context;
  const adapter = context.internalAdapter;
  const methods = ['findUserByEmail', 'findVerificationValue', 'createVerificationValue', 'consumeVerificationValue'] as const;
  const originals = methods.map((name) => Object.getOwnPropertyDescriptor(adapter, name)!);
  let resetDbCalls = 0;
  for (const name of methods) Object.defineProperty(adapter, name, { configurable: true, value: () => {
    resetDbCalls++; throw new Error('disabled reset must stop before user or token access');
  } });
  try {
    const registered = await client.call('POST', '/api/auth/request-password-reset', { email: cred.email, redirectTo: resetPage });
    const unknown = await client.call('POST', '/api/auth/request-password-reset', { email: 'absent@example.test', redirectTo: resetPage });
    assert.equal(registered.status, 503);
    assert.equal(registered.body, unknown.body, 'registration status has identical response');
    assert.equal(registered.json?.code, 'RESET_PASSWORD_DISABLED');
    assert.equal(registered.json?.message, PASSWORD_RESET_UNAVAILABLE_MESSAGE);
    assert.equal(registered.headers['cache-control'], 'no-store');
    assert.equal(registered.setCookie.length, 0);

    const callback = await client.rawCall('GET', `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(resetPage)}`);
    assert.equal(callback.status, 503);
    assert.equal(callback.headers.location, undefined, 'old token is not forwarded to the page');
    for (const tokenValue of [token, 'synthetic-invalid-token']) {
      for (const inQuery of [false, true]) {
        const result = await client.call('POST', `/api/auth/reset-password${inQuery ? `?token=${tokenValue}` : ''}`,
          { newPassword: `${cred.password}-reset`, ...(inQuery ? {} : { token: tokenValue }) });
        assert.equal(result.status, 503);
        assert.equal(result.json?.code, 'RESET_PASSWORD_DISABLED');
        assert.equal(result.headers['cache-control'], 'no-store');
        assert.equal(result.setCookie.length, 0);
      }
    }

    // 正規化やmethodの違いがhookを回避しても、実endpointを実行できてはいけない。
    for (const url of ['/api/auth/reset-password/', '/api/auth/%72eset-password', '/api/auth//reset-password',
      '/api/auth/x/../reset-password', '/api/auth/request-password-reset/', '/api/auth/%72equest-password-reset']) {
      const result = await client.rawCall('POST', url, { email: cred.email, redirectTo: resetPage, token, newPassword: `${cred.password}-reset` });
      assert.ok(result.status >= 400, 'alternate URL cannot reset');
    }
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const result = await stack.app.inject({ method, url: `/api/auth/reset-password?token=${token}`,
        headers: { origin, cookie: client.cookieHeader() } });
      assert.ok(result.statusCode >= 400, 'alternate method cannot reset');
    }

    const headers = new Headers({ origin });
    await assert.rejects(stack.auth.api.requestPasswordReset({ headers, body: { email: cred.email, redirectTo: resetPage } }), disabledError);
    await assert.rejects(stack.auth.api.requestPasswordReset({ headers, body: { email: 'absent@example.test', redirectTo: resetPage } }), disabledError);
    await assert.rejects(stack.auth.api.requestPasswordResetCallback({ headers, params: { token }, query: { callbackURL: resetPage } }), disabledError);
    await assert.rejects(stack.auth.api.resetPassword({ headers, body: { newPassword: `${cred.password}-reset`, token } }), disabledError);
    await assert.rejects(stack.auth.api.resetPassword({ headers, query: { token }, body: { newPassword: `${cred.password}-reset` } }), disabledError);
    assert.equal(resetDbCalls, 0, 'no user search or token operation, including direct SDK');
  } finally {
    methods.forEach((name, i) => Object.defineProperty(adapter, name, originals[i]!));
  }
  await stack.settle();
  assert.equal(mailLines.length, 0, 'no reset mail log was emitted');
  assert.ok(!requestLines.some((line) => line.includes(token)), 'request logs redact the synthetic old token');
  assert.ok(isDeepStrictEqual(before, await snapshot()), 'account/session/token rows are unchanged; do not print secrets on failure');

  // 認証済みの通常パスワード変更とserver-only APIは、再設定停止hookの対象外。
  const next = `${cred.password}-changed`;
  assert.equal((await client.call('POST', '/api/auth/change-password', { currentPassword: cred.password, newPassword: next, revokeOtherSessions: false })).status, 200);
  assert.equal((await client.call('GET', '/api/goals')).status, 200, 'existing session remains usable');
  await assert.rejects(stack.auth.api.setPassword({ headers: new Headers({ origin, cookie: client.cookieHeader() }), body: { newPassword: next } }),
    (error: unknown) => error instanceof APIError && error.body?.code === 'PASSWORD_ALREADY_SET');
  assert.equal((await client.call('POST', '/api/auth/sign-out', {})).status, 200);
  assert.equal((await client.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: cred.password })).status, 401);
  assert.equal((await client.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: next })).status, 200);
});
