import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogMailer, createResendMailer, MailDeliveryError, RESEND_ENDPOINT, type MailMessage } from '../src/auth/mailer.ts';
import { resetPasswordMail } from '../src/auth/reset-mail.ts';
import { loadMailConfig } from '../src/config.ts';

const message: MailMessage = { to: 'user@example.test', subject: '件名', text: '本文 https://example.test/x?a=1&b=2', html: '<p>本文</p>' };

test('再設定メールの文面は日本語で、URL・有効期間・無視してよい旨を含み、HTMLではURLをescapeする', () => {
  const url = 'http://127.0.0.1:3000/api/auth/reset-password/abc?callbackURL=http%3A%2F%2F127.0.0.1%3A3000%2Freset-password&x=<y>';
  const mail = resetPasswordMail({ url, expiresInMinutes: 60 });
  assert.equal(mail.subject, '【Future ROI】パスワード再設定のご案内');
  assert.ok(mail.text.includes(url));
  assert.match(mail.text, /1時間で無効/);
  assert.match(mail.text, /覚えがない場合/);
  assert.ok(!mail.html.includes('<y>'), 'HTMLに生のURL文字を入れない');
  assert.ok(mail.html.includes('&lt;y&gt;') && mail.html.includes('&amp;x='));
  assert.match(mail.html, /^<!doctype html><html lang="ja">/);
  assert.match(resetPasswordMail({ url, expiresInMinutes: 30 }).text, /30分で無効/);
});

test('Resend送信はBearer認証でPOST /emailsへ送り、失敗は応答本文を含めない例外にする', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = createResendMailer({
    apiKey: 'synthetic-key',
    from: 'Future ROI <no-reply@example.test>',
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return new Response('{"id":"x"}', { status: 200 }); }) as typeof fetch,
  });
  await ok(message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, RESEND_ENDPOINT);
  assert.equal(calls[0]!.init.method, 'POST');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer synthetic-key');
  assert.equal(headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    from: 'Future ROI <no-reply@example.test>', to: ['user@example.test'], subject: '件名', text: message.text, html: message.html,
  });

  const rejected = createResendMailer({
    apiKey: 'synthetic-key', from: 'a@example.test',
    fetch: (async () => new Response('{"message":"private detail user@example.test"}', { status: 422 })) as typeof fetch,
  });
  await assert.rejects(rejected(message), (error: unknown) => {
    assert.ok(error instanceof MailDeliveryError);
    assert.equal(error.status, 422);
    assert.ok(!error.message.includes('private detail'));
    return true;
  });

  const offline = createResendMailer({ apiKey: 'k', from: 'a@example.test', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
  await assert.rejects(offline(message), (error: unknown) => error instanceof MailDeliveryError && error.status === undefined);
});

test('ログ送信は外部へ送らず、宛先・件名・本文（URL）をJSON 1行で出す', async () => {
  const lines: string[] = [];
  await createLogMailer((line) => lines.push(line))(message);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.to, 'user@example.test');
  assert.equal(parsed.subject, '件名');
  assert.ok(String(parsed.text).includes('https://example.test/x?a=1&b=2'));
  assert.equal(parsed.level, 30);
});

test('送信設定：開発は既定でlog、本番は既定でresendでキーと送信元を必須にし、実値をエラーへ出さない', () => {
  assert.deepEqual(loadMailConfig({}), { transport: 'log' });
  assert.deepEqual(loadMailConfig({ NODE_ENV: 'production', MAIL_TRANSPORT: 'log' }), { transport: 'log' });
  assert.throws(() => loadMailConfig({ NODE_ENV: 'production' }), /RESEND_API_KEY/);
  assert.throws(() => loadMailConfig({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'secret-value-x' }), (e: Error) => /MAIL_FROM/.test(e.message) && !e.message.includes('secret-value-x'));
  assert.throws(() => loadMailConfig({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'not an address' }), /MAIL_FROM/);
  assert.throws(() => loadMailConfig({ MAIL_TRANSPORT: 'smtp' }), /MAIL_TRANSPORT/);
  assert.deepEqual(loadMailConfig({ NODE_ENV: 'production', RESEND_API_KEY: 'k', MAIL_FROM: ' Future ROI <no-reply@example.test> ' }),
    { transport: 'resend', apiKey: 'k', from: 'Future ROI <no-reply@example.test>' });
  assert.deepEqual(loadMailConfig({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k', MAIL_FROM: 'no-reply@example.test' }),
    { transport: 'resend', apiKey: 'k', from: 'no-reply@example.test' });
});
