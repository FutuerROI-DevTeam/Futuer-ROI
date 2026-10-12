import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { buildApp } from '../src/app.ts';
import { createBackgroundTasks } from '../src/auth/background.ts';
import { createAuth } from '../src/auth/options.ts';
import { migrate } from '../src/db/migrate.ts';
import { createAuthPool } from '../src/db/pool.ts';
import { createTestDatabase } from './helpers/database.ts';
import { Client, credentials, type Stack } from './helpers/stack.ts';

const origin = 'http://127.0.0.1:3000';
// 採択済みの既定値（各endpoint/IPにつき60秒で5回）。本番設定は変更しない。
const max = 5;
const windowMs = 60_000;
const ip = '198.51.100.10';
const signIn = '/api/auth/sign-in/email';
const signUp = '/api/auth/sign-up/email';
type Response = Awaited<ReturnType<Client['call']>>;

function assertBurst(responses: Response[]) {
  assert.equal(responses.filter((r) => r.status === 200).length, max, '上限まで受理する');
  assert.equal(responses.filter((r) => r.status === 429).length, responses.length - max, '超過分は全て429');
  for (const r of responses) {
    if (r.status === 200) {
      assert.ok(r.setCookie.length > 0, '成功した認証はsession Cookieを返す');
    } else {
      const retry = String(r.headers['x-retry-after'] ?? '');
      assert.match(retry, /^\d+$/, '待ち時間は整数秒');
      assert.ok(Number(retry) >= 1 && Number(retry) <= windowMs / 1_000, '待ち時間は採択済みの窓内');
      assert.equal(r.setCookie.length, 0, '拒否した認証ではCookieを作らない');
    }
  }
}

test('DB保存の認証制限は2instanceへの並列sign-in/sign-up・再起動・期限切れ窓でも上限と隔離を保つ', async (t) => {
  const db = await createTestDatabase();
  const stacks: Stack[] = [];
  t.after(async () => {
    try {
      await Promise.all(stacks.map((s) => s.close()));
    } finally {
      await db.close();
    }
  });
  await migrate(db.pool);
  // 同一配置を模してDB/secretを共有し、auth poolとアプリは各instanceが別に持つ。
  // Secretはこの合成テスト専用の乱数で、外部環境・開発用設定を参照しない。
  const secret = randomBytes(32).toString('base64url');
  async function start(): Promise<Stack> {
    const authPool = createAuthPool({ connectionString: db.connectionString, max: 2 });
    try {
      const background = createBackgroundTasks();
      const auth = createAuth({ pool: authPool, secret, baseURL: origin, signInMax: max, signUpMax: max, resetMax: max, mailer: async () => {}, background: background.run });
      const app = await buildApp({
        pool: db.pool, logger: false,
        auth: { instance: auth, baseURL: origin, allowedOrigins: [origin], trustProxyHops: 1 },
      });
      const stack = { app, auth, mails: [], settle: background.drain,
        close: async () => { try { await app.close(); await background.drain(); } finally { await authPool.end(); } } };
      stacks.push(stack);
      return stack;
    } catch (error) {
      await authPool.end();
      throw error;
    }
  }
  await start();
  await start();
  const attempt = (index: number, endpoint: string, body: unknown, address = ip) =>
    new Client(stacks[index % stacks.length]!.app, origin).call('POST', endpoint, body, { 'x-forwarded-for': address });
  const counts = async () => (await db.pool.query<{ users: number; accounts: number; sessions: number }>(`
    select (select count(*)::int from "user") as users,
           (select count(*)::int from account) as accounts,
           (select count(*)::int from session) as sessions
  `)).rows[0]!;
  const storedAuth = async () => (await db.pool.query(`
    select (select jsonb_agg(to_jsonb(u) order by u.id) from "user" u) as users,
           (select jsonb_agg(to_jsonb(a) order by a.id) from account a) as accounts,
           (select jsonb_agg(to_jsonb(s) order by s.id) from session s) as sessions
  `)).rows[0]!;
  const limits = async () => (await db.pool.query<{ key: string; count: number; lastRequest: string }>(
    'select * from "rateLimit" where key = any($1::text[]) order by key',
    [[`${ip}|/sign-in/email`, `${ip}|/sign-up/email`]],
  )).rows;
  const assertLimits = async () => {
    const rows = await limits();
    assert.equal(rows.length, 2, 'endpointごとに共有DBのbucketが1つずつ存在する');
    assert.deepEqual(rows.map((r) => r.count), [max, max]);
  };

  const cred = credentials('parallel-login');
  const registered = new Client(stacks[0]!.app, origin);
  assert.equal((await registered.call('POST', signUp, cred)).status, 200);
  assert.equal((await registered.call('POST', '/api/auth/sign-out', {})).status, 200);
  const login = { email: cred.email, password: cred.password };

  await t.test('未作成bucketへ2instanceから並列sign-inし、200件数と保存sessionが一致する', async () => {
    const before = await counts();
    const responses = await Promise.all(Array.from({ length: 16 }, (_, i) => attempt(i, signIn, login)));
    assertBurst(responses);
    assert.deepEqual(await counts(), { ...before, sessions: before.sessions + max });
    const rows = await limits();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.count, max);

    // 正常に作成されたsessionは、同じsecretを使う両instanceで認証できる。
    const accepted = responses.find((r) => r.status === 200)!;
    const cookie = accepted.setCookie.map((line) => line.split(';')[0]).join('; ');
    for (const stack of stacks) {
      const res = await stack.app.inject({ method: 'GET', url: '/api/goals', headers: { cookie } });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), []);
    }
    assert.equal((await attempt(0, signIn, login, '198.51.100.11')).status, 200, '別IPのsign-inは受理する');
    assert.deepEqual(await counts(), { ...before, sessions: before.sessions + max + 1 });
  });

  await t.test('同じIPのsign-upは独立bucketで5件まで受理し、拒否分はuser/account/sessionを作らない', async () => {
    const before = await counts();
    const responses = await Promise.all(Array.from({ length: 16 }, (_, i) => attempt(i, signUp, credentials(`parallel-register-${i}`))));
    assertBurst(responses);
    assert.deepEqual(await counts(), {
      users: before.users + max, accounts: before.accounts + max, sessions: before.sessions + max,
    });
    const ids = responses.filter((r) => r.status === 200).map((r) => (r.json?.user as { id: string }).id);
    assert.equal(new Set(ids).size, max, '各成功要求は別の合成userを作る');
    await assertLimits();
    assert.equal((await attempt(1, signUp, credentials('other-ip'), '198.51.100.12')).status, 200, '別IPのsign-upは受理する');
    assert.deepEqual(await counts(), {
      users: before.users + max + 1, accounts: before.accounts + max + 1, sessions: before.sessions + max + 1,
    });
  });

  await t.test('instanceを再起動しても両endpointの拒否と保存状態を維持する', async () => {
    const old = stacks.shift()!;
    await old.close();
    await start();
    const before = await counts();
    const savedAuth = await storedAuth();
    const savedLimits = await limits();
    for (let i = 0; i < stacks.length; i++) {
      for (const [endpoint, body] of [[signIn, login], [signUp, credentials(`blocked-${i}`)]] as const) {
        const response = await attempt(i, endpoint, body);
        assert.equal(response.status, 429);
        assert.match(String(response.headers['x-retry-after'] ?? ''), /^\d+$/);
        assert.ok(Number(response.headers['x-retry-after']) >= 1 && Number(response.headers['x-retry-after']) <= 60);
        assert.equal(response.setCookie.length, 0, '拒否した認証ではCookieを作らない');
      }
    }
    assert.deepEqual(await counts(), before);
    // 件数が同じまま既存行を書き換える退行も検出する。Cookie/token等を失敗ログへ出さない。
    assert.ok(isDeepStrictEqual(await storedAuth(), savedAuth), '拒否要求ではuser/account/sessionの全行・全列を変えない');
    assert.deepEqual(await limits(), savedLimits, '拒否要求ではcountも窓も延長しない');
  });

  await t.test('期限切れの既存bucketへ並列に入り直してもリセットを重ねず各5件だけ受理する', async () => {
    const before = await counts();
    // 実時間を待たず、専用合成DBの2bucketだけを明確に期限切れへ移す。
    await db.pool.query('update "rateLimit" set "lastRequest" = $1 where key = any($2::text[])', [
      Date.now() - windowMs - 1_000, [`${ip}|/sign-in/email`, `${ip}|/sign-up/email`],
    ]);
    const startedAt = Date.now();
    const [logins, registrations] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, (_, i) => attempt(i, signIn, login))),
      Promise.all(Array.from({ length: 12 }, (_, i) => attempt(i, signUp, credentials(`expired-${i}`)))),
    ]);
    assertBurst(logins);
    assertBurst(registrations);
    assert.deepEqual(await counts(), {
      users: before.users + max, accounts: before.accounts + max, sessions: before.sessions + 2 * max,
    });
    await assertLimits();
    for (const row of await limits()) {
      assert.ok(Number(row.lastRequest) >= startedAt && Number(row.lastRequest) <= Date.now(), '新しい窓の保存時刻');
    }
  });
});
