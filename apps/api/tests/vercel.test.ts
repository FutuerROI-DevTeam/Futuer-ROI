import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { attachDatabasePool } from '@vercel/functions/db-connections';
import { buildApp } from '../src/app.ts';
import { createAppPool, createAuthPool } from '../src/db/pool.ts';
import { createVercelHandler } from '../src/vercel.ts';

async function fixture(t: test.TestContext) {
  // constructorだけ使用する。health/DB queryを呼ばず、実DB・Secretを必要としない。
  const pool = createAppPool({ connectionString: 'postgres://127.0.0.1:1/unused' });
  const app = await buildApp({ pool, logger: false });
  app.post('/api/probe', async req => ({ url: req.url, body: req.body }));
  app.get('/probe', async () => ({ fixture: true }));
  await app.ready();
  t.after(async () => { await app.close(); await pool.end(); });
  return app;
}

async function http(t: test.TestContext, handler: ReturnType<typeof createVercelHandler>) {
  const completed: boolean[] = [];
  const active: Promise<void>[] = [];
  let response: ServerResponse | undefined;
  const server = createServer((req, res) => {
    response = res;
    active.push(handler(req, res).then(() => { completed.push(res.writableFinished || res.destroyed); }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, completed, active,
    response: () => response };
}

test('cold要求は1起動を共有し、raw JSON stream・query・private cache方針を保持する', async t => {
  const app = await fixture(t);
  let starts = 0;
  const gateway = await http(t, createVercelHandler(async () => { starts++; return app; }));
  const results = await Promise.all([1, 2, 3].map(async marker => {
    const res = await fetch(`${gateway.origin}/api/probe?next=%2Fgoals&marker=${marker}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ marker, text: '合成fixture' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { url: `/api/probe?next=%2Fgoals&marker=${marker}`, body: { marker, text: '合成fixture' } });
  }));
  assert.equal(results.length, 3);
  assert.equal(starts, 1);
  await Promise.all(gateway.active);
  assert.deepEqual(gateway.completed, [true, true, true]);
});

test('起動失敗の原文を公開せず503/no-storeにし、次要求で再試行する', async t => {
  const app = await fixture(t);
  let starts = 0;
  const gateway = await http(t, createVercelHandler(async () => {
    if (++starts === 1) throw Error('synthetic internal diagnostic must stay private');
    return app;
  }));
  const first = await fetch(`${gateway.origin}/probe`);
  assert.equal(first.status, 503);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { error: { code: 'UNAVAILABLE', message: 'Server startup unavailable.' } });
  const second = await fetch(`${gateway.origin}/probe`);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { fixture: true });
  assert.equal(starts, 2);
});

test('cold起動待ち中の切断でもFunction promiseを完了する', { timeout: 3000 }, async t => {
  const app = await fixture(t);
  let unblock!: (value: typeof app) => void;
  let started!: () => void;
  const beginning = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<typeof app>(resolve => { unblock = resolve; });
  const gateway = await http(t, createVercelHandler(() => { started(); return pending; }));
  const client = request(`${gateway.origin}/probe`);
  client.on('error', () => undefined);
  client.end();
  await beginning;
  const closed = once(gateway.response()!, 'close');
  client.destroy();
  await closed;
  unblock(app);
  await Promise.all(gateway.active);
  assert.deepEqual(gateway.completed, [true]);
});

test('公式pool hookは既存app/auth pool双方へ接続でき、上限・timeout・型を変えない', async () => {
  const pools = [createAppPool({ connectionString: 'postgres://127.0.0.1:1/unused' }),
    createAuthPool({ connectionString: 'postgres://127.0.0.1:1/unused' })];
  try {
    for (const [index, pool] of pools.entries()) {
      const before = { ...pool.options };
      attachDatabasePool(pool);
      assert.equal(pool.listenerCount('release'), 1);
      assert.deepEqual(pool.options, before);
      assert.equal(pool.options.max, index === 0 ? 5 : 2);
      assert.equal(pool.options.connectionTimeoutMillis, 5000);
      assert.equal(pool.options.idleTimeoutMillis, 10000);
    }
  } finally { await Promise.all(pools.map(pool => pool.end())); }
});

test('固定版hookはpg releaseをrequest-context waitUntilへ渡す（休止実機検証ではない）', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    import { attachDatabasePool } from '@vercel/functions/db-connections';
    const promises=[];
    globalThis[Symbol.for('@vercel/request-context')]={get:()=>({waitUntil:p=>promises.push(p)})};
    const pools=[new EventEmitter(),new EventEmitter()];
    for(const pool of pools){pool.options={idleTimeoutMillis:20};attachDatabasePool(pool);pool.emit('release');}
    assert.equal(promises.length,2);
    await Promise.all([...promises,new Promise(r=>setTimeout(r,160))]);
    console.log('waitUntil: two pools completed');
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, VERCEL_URL: 'fixture.invalid', VERCEL_REGION: 'fixture' } });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /two pools completed/);
});
