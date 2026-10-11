import assert from 'node:assert/strict';
import test from 'node:test';
import { signOutFixture } from './helpers/sign-out-fixture.ts';

test('DELETE故障は503/Cookie保持、明示再試行の成功後だけ旧Cookieを拒否する', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  assert.equal((await f.replay(cookie)).statusCode, 200);
  f.state.deleteFailure = true;
  const failed = await f.signOut(cookie);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json().code, 'SIGN_OUT_UNCONFIRMED');
  assert.equal(failed.headers['set-cookie'], undefined, 'keep the signed cookie for explicit retry');
  assert.equal(f.db.session!.length, 1);
  assert.equal((await f.replay(cookie)).statusCode, 200, '503 does not promise revocation');
  assert.equal(f.state.deletes, 1, 'no automatic retry');
  f.state.deleteFailure = false;
  const success = await f.signOut(cookie);
  assert.equal(success.statusCode, 200);
  assert.deepEqual(success.json(), { success: true });
  assert.ok(success.headers['set-cookie']);
  assert.equal(f.db.session!.length, 0);
  assert.equal((await f.replay(cookie)).statusCode, 401);
  assert.equal(f.state.deletes, 2, 'one DB deletion for each explicit attempt');
});

test('削除前lookupの故障が削除を飛ばして成功に見えない', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  f.state.deleteLookupFailure = true;
  const response = await f.signOut(cookie);
  assert.equal(response.statusCode, 200);
  assert.equal(f.state.deletes, 1, 'the deletion must not depend on a swallowed lookup');
  assert.equal((await f.replay(cookie)).statusCode, 401);
});

for (const headers of [
  { origin: 'http://evil.example' },
  { origin: 'http://app.test:4000' },
  { origin: '' },
  { origin: '', referer: 'http://evil.example/path' },
]) {
  test(`拒否するOrigin/RefererはhookのDELETEにも到達しない ${JSON.stringify(headers)}`, async (t) => {
    const f = await signOutFixture(); t.after(() => f.app.close());
    const cookie = await f.signUp();
    f.state.deleteFailure = true;
    const response = await f.signOut(cookie, headers);
    assert.equal(response.statusCode, 403);
    assert.equal(f.state.deletes, 0);
    assert.equal(f.db.session!.length, 1);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal((await f.replay(cookie)).statusCode, 200);
  });
}

test('不正callbackURLも削除前に拒否し、GET sign-outは削除しない', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  assert.equal((await f.signOut(cookie, {}, { callbackURL: 'http://evil.example' })).statusCode, 403);
  assert.equal((await f.signOut(cookie, {}, { callbackURL: 123 })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'GET', url: '/api/auth/sign-out', headers: { cookie } })).statusCode, 404);
  assert.equal(f.state.deletes, 0);
  assert.equal((await f.replay(cookie)).statusCode, 200);
});

test('不許可media typeと壊れたJSONは署名Cookie付きでも削除前に拒否する', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  for (const [contentType, payload] of [['text/plain', '{}'], ['application/json', '{']] as const) {
    const response = await f.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { origin: f.baseURL, cookie, 'content-type': contentType }, payload });
    assert.ok(response.statusCode >= 400 && response.statusCode < 500);
  }
  assert.equal(f.state.deletes, 0);
  assert.equal((await f.replay(cookie)).statusCode, 200);
});

test('署名改ざん・Cookieなしは保存済みsessionを削除しない', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  const tampered = cookie.replace(/(session_token=)[^;]+/, '$1invalid.unsigned');
  assert.notEqual(tampered, cookie);
  assert.equal((await f.signOut(tampered)).statusCode, 200);
  assert.equal((await f.signOut('')).statusCode, 200);
  assert.equal(f.state.deletes, 0);
  assert.equal(f.db.session!.length, 1);
  assert.equal((await f.replay(cookie)).statusCode, 200);
});

test('https署名Cookieでも対象sessionだけを削除し、既削除tokenの再試行は冪等', async (t) => {
  const f = await signOutFixture('https://app.test'); t.after(() => f.app.close());
  const a = await f.signUp(); const b = await f.signUp('synthetic-b@example.test');
  assert.ok(a.includes('__Secure-better-auth.session_token='));
  assert.equal((await f.signOut(a)).statusCode, 200);
  assert.equal((await f.signOut(a)).statusCode, 200);
  assert.equal(f.state.deletes, 2, 'one DELETE per attempt, including a zero-row retry');
  assert.equal(f.db.session!.length, 1);
  assert.equal((await f.replay(a)).statusCode, 401);
  assert.equal((await f.replay(b)).statusCode, 200);
});

test('同じuserの別ログインsessionも対象token以外は保持する', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const a = await f.signUp();
  const second = await f.app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: f.baseURL }, payload: { email: 'synthetic-a@example.test', password: 'synthetic-password-only' } });
  assert.equal(second.statusCode, 200);
  const raw = second.headers['set-cookie'];
  const b = (typeof raw === 'string' ? [raw] : raw ?? []).map((line) => line.split(';')[0]).join('; ');
  assert.notEqual(a, b);
  assert.equal(f.db.session!.length, 2);
  assert.equal((await f.signOut(a)).statusCode, 200);
  assert.equal(f.db.session!.length, 1);
  assert.equal((await f.replay(a)).statusCode, 401);
  assert.equal((await f.replay(b)).statusCode, 200);
});

test('削除の応答喪失は503/Cookie保持、削除済みなら再試行で成功に収束する', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  f.state.lostDeleteReply = true;
  const uncertain = await f.signOut(cookie);
  assert.equal(uncertain.statusCode, 503);
  assert.equal(uncertain.headers['set-cookie'], undefined);
  assert.equal(f.db.session!.length, 0, 'the statement took effect before its acknowledgement was lost');
  assert.equal((await f.replay(cookie)).statusCode, 401);
  f.state.lostDeleteReply = false;
  assert.equal((await f.signOut(cookie)).statusCode, 200);
  assert.equal(f.state.deletes, 2);
});

test('session読取も故障すると保護APIは500、DB復帰後に明示再試行する', async (t) => {
  const f = await signOutFixture(); t.after(() => f.app.close());
  const cookie = await f.signUp();
  f.state.deleteFailure = true; f.state.readFailure = true;
  const failure = await f.signOut(cookie);
  assert.equal(failure.statusCode, 503);
  assert.equal(failure.headers['set-cookie'], undefined);
  assert.equal((await f.replay(cookie)).statusCode, 500, 'DB read failure must not authorize');
  f.state.readFailure = false;
  assert.equal((await f.replay(cookie)).statusCode, 200, 'no claim of revocation during failure');
  f.state.deleteFailure = false;
  assert.equal((await f.signOut(cookie)).statusCode, 200);
  assert.equal((await f.replay(cookie)).statusCode, 401);
});

test('削除応答までCookieを消さず、同じtokenの同時sign-outも成功後に失効する', { timeout: 10000 }, async (t) => {
  const f = await signOutFixture();
  const cookie = await f.signUp();
  let release!: () => void; let bothEntered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { bothEntered = resolve; });
  f.state.beforeDelete = async () => { if (f.state.deletes === 2) bothEntered(); await gate; };
  t.after(() => { release(); return f.app.close(); });
  let completed = 0;
  const first = f.signOut(cookie).then((response) => { completed++; return response; });
  const second = f.signOut(cookie).then((response) => { completed++; return response; });
  await entered;
  assert.equal(completed, 0);
  assert.equal((await f.replay(cookie)).statusCode, 200, 'a request authenticated before deletion can still succeed');
  release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.statusCode), [200, 200]);
  assert.ok(responses.every((response) => response.headers['set-cookie']));
  assert.equal(f.state.deletes, 2, 'SDK sign-out does not issue another DELETE once the row is gone');
  assert.equal((await f.replay(cookie)).statusCode, 401);
});
