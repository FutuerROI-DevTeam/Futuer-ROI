import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../api/src/app.ts';
import { createAuth } from '../../api/src/auth/options.ts';
import { createAuthPool } from '../../api/src/db/pool.ts';
import { migrate } from '../../api/src/db/migrate.ts';
import { createTestDatabase } from '../../api/tests/helpers/database.ts';
import { signedInClient } from '../../api/tests/helpers/stack.ts';
import { launchBrowser } from './browser-startup.mjs';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(read, accept, message) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const result = await read();
    if (accept(result)) return result;
    await delay(30);
  }
  throw new Error(message);
}

test('#225 actual SPA + authenticated API + isolated synthetic DB: opt-in/capture/assessment/withdrawal/OFF', { timeout: 240000 }, async t => {
  // 外部/既存管理DBへテストを当てない。設定がある場合は実行前に明示的に除外する。
  assert.equal(process.env.DATABASE_URL, undefined, 'clear DATABASE_URL for isolated embedded test');
  const browser = process.env.TEST_BROWSER ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
  await access(browser);
  const db = await createTestDatabase();
  let app, disabledApp, authPool, session;
  const profileRoot = await mkdtemp(join(tmpdir(), 'futureroi-evaluation-browser-'));
  t.after(async () => {
    try { await session?.stop(); }
    finally {
      await app?.close();
      await disabledApp?.close();
      await authPool?.end();
      await db.close();
    }
    assert.equal(dirname(resolve(profileRoot)), resolve(tmpdir()));
    assert.ok(basename(profileRoot).startsWith('futureroi-evaluation-browser-'));
    await rm(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  await migrate(db.pool);
  authPool = createAuthPool({ connectionString: db.connectionString });
  const secret = randomBytes(32).toString('base64url');
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  let now = new Date('2026-10-01T12:00:00Z');
  const auth = createAuth({ pool: authPool, secret, baseURL: origin, signInMax: 50, signUpMax: 50 });
  const shared = { pool: db.pool, logger: false, now: () => now,
    webDist: fileURLToPath(new URL('../dist/', import.meta.url)),
    auth: { instance: auth, baseURL: origin, allowedOrigins: [origin], trustProxyHops: 0 } };
  app = await buildApp({ ...shared, evaluation: { enabled: true, buildVersion: 'synthetic-browser-test' } });
  await app.listen({ host: '127.0.0.1', port });
  const a = await signedInClient(app, 'evaluation-browser-a', origin);
  const b = await signedInClient(app, 'evaluation-browser-b', origin);
  const goal = (await a.call('POST', '/api/goals', { title: 'Synthetic evaluation goal', unit: 'minutes',
    totalRequired: 20, sessionAmount: 10, timezone: 'UTC', questionPrior: { a: 'HIGH', b: 'HIGH' } })).json;
  assert.equal((await a.call('PUT', `/api/goals/${goal.id}/logs/2026-10-01`, { status: 'DONE', amount: 10 })).status, 200);
  const profile = join(profileRoot, 'profile');
  session = launchBrowser({ browser, profile, signal: t.signal,
    args: ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], diagnostic: value => t.diagnostic(JSON.stringify(value)) });
  const cdp = await session.ready();
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('Browser evaluation failed');
    return result.result.value;
  };
  const text = () => evaluate('document.body.innerText');
  const cookie = async client => {
    for (const [name, value] of client.cookies) assert.equal((await cdp.send('Network.setCookie', { name, value, url: origin, path: '/' })).success, true);
  };
  const click = async label => {
    const rect = await evaluate(`(() => {const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    assert.ok(rect, `enabled button: ${label}`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
  };
  const snapshot = async name => {
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
    assert.equal(overflow, false, `no page horizontal overflow: ${name}`);
    if (process.env.EVALUATION_BROWSER_ARTIFACTS) {
      await mkdir(process.env.EVALUATION_BROWSER_ARTIFACTS, { recursive: true });
      const shot = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: true });
      await writeFile(join(process.env.EVALUATION_BROWSER_ARTIFACTS, `${name}.png`), Buffer.from(shot.data, 'base64'));
    }
  };
  await cookie(a);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${origin}/goals/${goal.id}/evaluation` });
  await until(text, value => value.includes('この目標で参加する'), 'opt-in page did not load');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="この目標で参加する").disabled'), true);
  assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast')).rows[0].n, 0);
  await snapshot('390-opt-in');
  const check = await evaluate('(() => {const e=document.querySelector("input[type=checkbox]");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...check, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...check, button: 'left', clickCount: 1 });
  await click('この目標で参加する');
  await until(text, value => value.includes('評価用予測を記録'), 'participation did not complete');
  await click('評価用予測を記録');
  await until(text, value => value.includes('保存した予測（1件）'), 'forecast did not save');
  await click('評価用予測を記録');
  await until(text, value => value.includes('同じ日の再操作'), 'forecast replay did not complete');
  assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast')).rows[0].n, 1);
  await snapshot('390-saved-pending');
  now = new Date('2026-10-02T12:00:00Z');
  assert.equal((await a.call('PUT', `/api/goals/${goal.id}/logs/2026-10-02`, { status: 'DONE', amount: 7 })).status, 200);
  now = new Date('2026-10-03T12:00:00Z');
  assert.equal((await a.call('PUT', `/api/goals/${goal.id}/logs/2026-10-03`, { status: 'DONE', amount: 3 })).status, 200);
  now = new Date('2026-10-05T12:00:00Z');
  await click('結果を照合');
  await until(text, value => value.includes('現在の記録と照合しました。'), 'assessment did not complete');
  const report = (await a.call('GET', `/api/goals/${goal.id}/evaluation`)).json;
  assert.equal(report.forecasts[0].remainingAmount, 10);
  assert.equal(report.forecasts[0].p50Days, 1);
  assert.equal(report.forecasts[0].p80Days, 2);
  assert.equal(report.forecasts[0].p50State, 'NOT_REACHED');
  assert.equal(report.forecasts[0].p80State, 'REACHED');
  assert.ok((await text()).includes('P50: 期限までに未到達'));
  assert.ok((await text()).includes('P80: 期限までに到達'));
  await snapshot('390-assessed');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await snapshot('1280-assessed');
  await click('参加解除・評価記録を削除');
  await until(text, value => value.includes('参加を解除しますか？'), 'confirmation did not open');
  await click('解除して評価記録を削除');
  await until(text, value => value.includes('この目標で参加する') && value.includes('保存した予測（0件）'), 'withdrawal did not clear');
  assert.equal((await db.pool.query('select count(*)::int n from evaluation_forecast')).rows[0].n, 0);
  assert.equal((await db.pool.query('select count(*)::int n from action_log where goal_id=$1', [goal.id])).rows[0].n, 3);
  await snapshot('1280-withdrawn');
  await cookie(b);
  await cdp.send('Page.reload', { ignoreCache: true });
  await until(text, value => value.includes('このGoalは開けません'), 'other-owner goal did not become not-found');
  assert.equal((await text()).includes('保存した予測'), false);
  await snapshot('1280-other-owner');
  // 実際の起動既定OFFを別appで確認。同じ合成認証/DBだけを使用する。
  const disabledPort = await freePort();
  disabledApp = await buildApp(shared);
  await disabledApp.listen({ host: '127.0.0.1', port: disabledPort });
  await cookie(a);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${disabledPort}/goals/${goal.id}/evaluation` });
  await until(text, value => value.includes('この機能は現在利用できません'), 'default OFF page did not render');
  assert.equal((await text()).includes('この目標で参加する'), false);
  await snapshot('1280-default-off');
  t.diagnostic('Actual SPA/HTTP/DB/native Chrome checks passed; synthetic accounts/data only. Account-switch check is fresh navigation, not a pixel claim about held session responses.');
});
