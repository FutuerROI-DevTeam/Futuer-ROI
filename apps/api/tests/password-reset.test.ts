import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, credentials, setup } from './helpers/stack.ts';

const origin = 'http://127.0.0.1:3000';
const resetPage = `${origin}/reset-password`;

// メール本文のURL（/api/auth/reset-password/<token>?callbackURL=...）を開き、画面へのredirect先からtokenを取り出す
async function openMailLink(client: Client, url: string) {
  const res = await client.rawCall('GET', new URL(url).pathname + new URL(url).search);
  assert.equal(res.status, 302, `mail link redirects: ${res.body}`);
  return new URL(String(res.headers.location), origin);
}

test('登録済みメールで再設定を要求すると日本語の案内メールが送られ、リンクから新パスワードを設定できる', async (t) => {
  const { stack } = await setup(t);
  const client = new Client(stack.app, origin);
  const cred = credentials('reset');
  assert.equal((await client.call('POST', '/api/auth/sign-up/email', cred)).status, 200);
  await client.call('POST', '/api/auth/sign-out', {});

  const requested = await client.call('POST', '/api/auth/request-password-reset', { email: cred.email, redirectTo: resetPage });
  assert.equal(requested.status, 200, requested.body);
  assert.equal(requested.headers['cache-control'], 'no-store');
  assert.equal(stack.mails.length, 1, '1通だけ送る');
  const mail = stack.mails[0]!;
  assert.equal(mail.to, cred.email);
  assert.equal(mail.subject, '【Future ROI】パスワード再設定のご案内');
  assert.match(mail.text, /新しいパスワードを設定してください/);
  assert.match(mail.text, /1時間で無効/);
  assert.match(mail.text, /覚えがない場合は、このメールを無視してください/);
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0];
  assert.ok(link, 'mail text contains the reset URL');
  assert.ok(link.startsWith(`${origin}/api/auth/reset-password/`), link);
  assert.ok(mail.html.includes(`href="${link.replaceAll('&', '&amp;')}"`), 'html carries the same link');

  const landing = await openMailLink(client, link);
  assert.equal(landing.origin + landing.pathname, resetPage);
  const token = landing.searchParams.get('token');
  assert.ok(token, 'redirect carries the token');
  assert.equal(landing.searchParams.get('error'), null);

  const newPassword = `${cred.password}-new`;
  const reset = await client.call('POST', '/api/auth/reset-password', { newPassword, token });
  assert.equal(reset.status, 200, reset.body);

  const oldLogin = await client.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: cred.password });
  assert.equal(oldLogin.status, 401, '旧パスワードは拒否される');
  const newLogin = await client.call('POST', '/api/auth/sign-in/email', { email: cred.email, password: newPassword });
  assert.equal(newLogin.status, 200, '新パスワードでログインできる');

  // 使い終わったトークンは2度使えない
  const reuse = await client.call('POST', '/api/auth/reset-password', { newPassword: `${newPassword}-again`, token });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json?.code, 'INVALID_TOKEN');
});

test('未登録メールでも同じ応答を返し、メールは送らない（登録の有無を応答で漏らさない）', async (t) => {
  const { stack } = await setup(t);
  const client = new Client(stack.app, origin);
  const res = await client.call('POST', '/api/auth/request-password-reset', { email: 'nobody@example.test', redirectTo: resetPage });
  assert.equal(res.status, 200);
  assert.equal(stack.mails.length, 0);
  assert.equal(typeof res.json?.message, 'string');
});

test('無効なトークンは画面へerror付きで戻し、短いパスワードや偽トークンの保存は400にする', async (t) => {
  const { stack } = await setup(t);
  const client = new Client(stack.app, origin);
  const bad = await client.rawCall('GET', `/api/auth/reset-password/not-a-real-token?callbackURL=${encodeURIComponent(resetPage)}`);
  assert.equal(bad.status, 302);
  const landing = new URL(String(bad.headers.location), origin);
  assert.equal(landing.origin + landing.pathname, resetPage);
  assert.equal(landing.searchParams.get('error'), 'INVALID_TOKEN');
  assert.equal(landing.searchParams.get('token'), null);

  const forged = await client.call('POST', '/api/auth/reset-password', { newPassword: 'long-enough-password', token: 'not-a-real-token' });
  assert.equal(forged.status, 400);
  assert.equal(forged.json?.code, 'INVALID_TOKEN');

  const cred = credentials('short');
  assert.equal((await client.call('POST', '/api/auth/sign-up/email', cred)).status, 200);
  await client.call('POST', '/api/auth/request-password-reset', { email: cred.email, redirectTo: resetPage });
  const link = /https?:\/\/\S+/.exec(stack.mails[0]!.text)![0];
  const token = (await openMailLink(client, link)).searchParams.get('token')!;
  const short = await client.call('POST', '/api/auth/reset-password', { newPassword: 'short', token });
  assert.equal(short.status, 400);
  assert.equal(short.json?.code, 'PASSWORD_TOO_SHORT');
  // 失敗してもトークンは残り、正しい長さで保存できる
  assert.equal((await client.call('POST', '/api/auth/reset-password', { newPassword: 'long-enough-password', token })).status, 200);
});

test('再設定の要求は1 IPあたり60秒の上限で429になり、X-Retry-Afterを返す', async (t) => {
  const { stack } = await setup(t, { resetMax: 2 });
  const client = new Client(stack.app, origin);
  const statuses: number[] = [];
  let retry = '';
  for (let i = 0; i < 3; i++) {
    const res = await client.call('POST', '/api/auth/request-password-reset', { email: `limit-${i}@example.test`, redirectTo: resetPage });
    statuses.push(res.status);
    if (res.status === 429) retry = String(res.headers['x-retry-after'] ?? '');
  }
  assert.deepEqual(statuses, [200, 200, 429]);
  assert.match(retry, /^\d+$/);
  assert.equal(stack.mails.length, 0, '未登録メールなので送信は無い');
});

test('メール送信の失敗は固定版SDKがlogへ記録して握りつぶし、応答は未登録と同じ200で原文を含めない（利用者には見えない）', async (t) => {
  const { stack } = await setup(t, { mailer: async () => { throw new Error('synthetic delivery failure'); } });
  const client = new Client(stack.app, origin);
  const cred = credentials('fail');
  assert.equal((await client.call('POST', '/api/auth/sign-up/email', cred)).status, 200);
  const res = await client.call('POST', '/api/auth/request-password-reset', { email: cred.email, redirectTo: resetPage });
  assert.equal(res.status, 200, '1.7.7のrunInBackgroundOrAwaitは完了を待つが、送信例外を応答へ変えない');
  assert.ok(!res.body.includes('synthetic delivery failure'), '例外の原文を応答へ出さない');
  // 送信できなくても再要求は可能（トークンは作られているが、利用者には届かない）
  assert.equal((await client.call('POST', '/api/auth/request-password-reset', { email: cred.email, redirectTo: resetPage })).status, 200);
});
