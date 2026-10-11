import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { launchBrowser } from './browser-startup.mjs';

const endpoint = 'ws://127.0.0.1:9222/devtools/browser/synthetic';
const page = 'ws://127.0.0.1:9222/devtools/page/synthetic';
const absent = () => Promise.reject(Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' }));
const stalled = () => new Promise(() => {});

test('startup: a pre-aborted test cannot spawn a new process', () => {
  const controller = new AbortController();
  controller.abort(new Error('synthetic already-aborted test'));
  let spawns = 0;
  assert.throws(() => launchBrowser({ browser: 'synthetic', args: [], profile: '/synthetic/profile',
    signal: controller.signal, adapters: { spawn: () => { spawns++; throw new Error('spawn must not be reached'); } },
  }), /synthetic already-aborted test/);
  assert.equal(spawns, 0);
});

test('startup: late responsive build after cleanup cannot create a server or spawn', { timeout: 5000 }, async t => {
  // 実際のharness本文を別Nodeで実行。buildだけをゲートで遅らせ、timeout後にafterが先行する順序を再現する。
  // HTTP/Chromeは合成adapterに置換し、副作用の呼出し数を検査する（DB・実Chromeなし）。
  const harness = new URL('./responsive-details.browser-check.mjs', import.meta.url).href;
  const script = `
    import { registerHooks } from 'node:module';
    const state = { after: [], servers: 0, spawns: 0, events: [] };
    globalThis.__abortFixture = state;
    const enteredBuild = new Promise(resolve => state.entered = resolve);
    state.build = new Promise(resolve => state.release = resolve);
    const sources = {
      test: 'export function test(_name, options, fn) { if(options.timeout !== 180000) throw new Error("test timeout changed"); globalThis.__abortFixture.fn = fn; }',
      vite: 'export function build() { const s = globalThis.__abortFixture; s.events.push("build-start"); s.entered(); return s.build; }',
      react: 'export default function react() { return {}; }',
      http: 'export function createServer() { const s = globalThis.__abortFixture; s.servers++; return { once() {}, listen(_p, _h, done) { done(); }, address() { return { port: 12345 }; } }; }',
      browser: 'export function launchBrowser() { const s = globalThis.__abortFixture; s.spawns++; return { ready: async () => { throw new Error("late spawn reached"); } }; }',
    };
    registerHooks({
      resolve(specifier, context, next) {
        const name = specifier === 'node:test' ? 'test' : specifier === 'vite' ? 'vite'
          : specifier === '@vitejs/plugin-react' ? 'react' : specifier === 'node:http' ? 'http'
          : specifier === './browser-startup.mjs' && context.parentURL === ${JSON.stringify(harness)} ? 'browser' : null;
        return name ? { url: 'synthetic:' + name, shortCircuit: true } : next(specifier, context);
      },
      load(url, context, next) {
        return url.startsWith('synthetic:') ? { format: 'module', source: sources[url.slice(10)], shortCircuit: true } : next(url, context);
      },
    });
    await import(${JSON.stringify(harness)});
    const controller = new AbortController();
    const running = state.fn({ signal: controller.signal, after: fn => state.after.push(fn), diagnostic() {} });
    await enteredBuild;
    controller.abort(new Error('synthetic timeout during build'));
    for (const after of state.after) await after();
    state.events.push('after-complete');
    state.release({ output: [{ type: 'chunk', code: '' }] });
    let error;
    try { await running; } catch (failure) { error = failure.message; }
    console.log(JSON.stringify({ servers: state.servers, spawns: state.spawns, events: state.events, error }));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    windowsHide: true, env: { ...process.env, TEST_BROWSER: process.execPath }, stdio: ['ignore', 'pipe', 'pipe'],
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout.trim());
  t.diagnostic(JSON.stringify({ lateBuildRegression: result }));
  assert.deepEqual(result.events, ['build-start', 'after-complete']);
  assert.equal(result.error, 'synthetic timeout during build');
  assert.equal(result.servers, 0, 'HTTP server was created after cleanup had already run');
  assert.equal(result.spawns, 0, 'Chrome was spawned after cleanup had already run');
});

function fixture(t, options = {}) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, stderr: new PassThrough() });
  const observations = [], sockets = [], kills = [], timers = new Set();
  let spawns = 0, fetchSignal;
  const later = (fn, ms = 1) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; };
  const exit = (code, signal) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.exitCode = code; child.signalCode = signal; child.emit('exit', code, signal);
  };
  child.kill = signal => {
    kills.push(signal);
    if (options.killError === signal) throw Object.assign(new Error('synthetic kill failure'), { code: 'EPERM' });
    if (!options.neverExit && !(options.ignoreTerm && signal === 'SIGTERM')) later(() => exit(null, signal));
    return true;
  };
  class Socket extends EventTarget {
    constructor(url) {
      super(); this.url = url; this.closed = false; this.opened = false; sockets.push(this);
      if (!options.stallSocket) later(() => {
        this.opened = !options.socketError;
        this.dispatchEvent(new Event(options.socketError ? 'error' : 'open'));
      }, options.socketDelay);
    }
    send(contents) {
      if (!this.opened) throw new Error('synthetic socket is not open');
      const { id, method } = JSON.parse(contents);
      if (options.stallCdp || (method === 'Browser.close' && options.stallClose)) return;
      later(() => {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: {
          product: 'Synthetic/1', protocolVersion: '1.3',
        } }) }));
        if (method === 'Browser.close' && !options.neverExit && !options.ignoreTerm) exit(0, null);
      }, options.cdpDelay);
    }
    close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  }
  const session = launchBrowser({ browser: 'synthetic', args: [], profile: '/synthetic/profile',
    signal: options.signal, diagnostic: value => observations.push(value), startupBudgetMs: options.budget ?? 400,
    diagnosticAfterMs: options.soft ?? 80, cleanupGraceMs: 40,
    adapters: { spawn: () => {
      spawns++;
      if (options.spawnError) later(() => { child.pid = undefined; child.emit('error', Object.assign(new Error('synthetic spawn error'), { code: 'ENOENT' })); });
      else if (options.earlyExit) later(() => exit(7, null));
      else if (!options.noEndpoint && !options.profile) later(() => child.stderr.write('DevTools listening on ' + (options.endpoint ?? endpoint) + '\n'), options.endpointDelay);
      return child;
    }, readFile: options.stallFile ? stalled : options.profile ? async () => '9222\n/devtools/browser/synthetic\n' : absent,
    fetch: async (_url, { signal, redirect }) => {
      fetchSignal = signal; assert.equal(redirect, 'error');
      if (options.stallHttp) return stalled();
      if (options.fetchDelay) await delay(options.fetchDelay, undefined, { signal });
      if (options.noPage) return Response.json([]);
      if (options.stallBody) return { ok: true, json: stalled };
      return Response.json([{ type: 'page', webSocketDebuggerUrl: options.page ?? page }]);
    }, WebSocket: Socket, ...options.adapters },
  });
  t.after(async () => {
    // 残存を合成するfixtureだけはcleanup失敗をテスト本文で検査する。
    if (!options.neverExit) await session.stop();
    for (const timer of timers) clearTimeout(timer);
  });
  return { session, observations, sockets, child, kills, get spawns() { return spawns; }, get fetchSignal() { return fetchSignal; } };
}

test('startup: soft diagnostic precedes delayed success of the same process', async t => {
  const f = fixture(t, { endpointDelay: 150 });
  const first = f.session.ready(); assert.equal(f.session.ready(), first);
  await first;
  assert.equal(f.spawns, 1);
  assert.deepEqual(f.observations.map(x => x.browserStartup), ['still-waiting', 'ready']);
  assert.equal(f.observations[0].stage, 'endpoint'); assert.equal(f.observations[0].child.alive, true);
  assert.equal(f.session.diagnostics().endpointSource, 'stderr');
  await f.session.stop();
  assert.equal(f.observations.at(-1).browserCleanup, 'exited');
  assert.equal(f.child.exitCode, 0); assert.equal(f.sockets[0].closed, true);
});

test('startup: profile fallback does not require stderr', async t => {
  const f = fixture(t, { profile: true }); await f.session.ready();
  assert.equal(f.session.diagnostics().endpointSource, 'profile');
  assert.equal(f.session.diagnostics().stderrBytes, 0);
});

for (const [name, options, expectedStage] of [
  ['endpoint absent', { noEndpoint: true }, 'endpoint'],
  ['profile read stalled', { stallFile: true }, 'endpoint'],
  ['HTTP stalled', { stallHttp: true }, 'http'],
  ['HTTP body stalled', { stallBody: true }, 'http'],
  ['page absent', { noPage: true }, 'http'],
  ['WebSocket open stalled', { stallSocket: true }, 'websocket'],
  ['first CDP response stalled', { stallCdp: true }, 'cdp'],
]) {
  test('startup deadline: ' + name, async t => {
    const f = fixture(t, { ...options, budget: 200 });
    const started = performance.now();
    await assert.rejects(f.session.ready(), /startup deadline exceeded/);
    assert.ok(performance.now() - started < 1200, 'startup did not stop within bounded slack');
    assert.equal(f.spawns, 1); assert.equal(f.session.diagnostics().stage, expectedStage);
    if (f.fetchSignal) assert.equal(f.fetchSignal.aborted, true);
    await f.session.stop();
    assert.equal(f.child.signalCode, 'SIGTERM');
    if (f.sockets.length) assert.equal(f.sockets[0].closed, true);
  });
}

test('startup: endpoint/HTTP/WS/CDP consume one shared budget', async t => {
  const f = fixture(t, { endpointDelay: 80, fetchDelay: 80, socketDelay: 80, cdpDelay: 500, budget: 600 });
  await assert.rejects(f.session.ready(), /startup deadline exceeded/);
  assert.equal(f.session.diagnostics().stage, 'cdp');
  assert.ok(f.session.diagnostics().timings.cdp >= 240);
  assert.equal(f.spawns, 1);
});

for (const [name, options, message] of [
  ['spawn error', { spawnError: true }, /Chrome process error: ENOENT/],
  ['early process exit', { earlyExit: true }, /Chrome exited.*code=7/],
  ['WebSocket error', { socketError: true }, /WebSocket open failed/],
  ['foreign target', { page: 'ws://example.invalid:9222/devtools/page/synthetic' }, /outside the owned debug endpoint/],
]) {
  test('startup rejects: ' + name, async t => {
    const f = fixture(t, options); await assert.rejects(f.session.ready(), message);
    assert.equal(f.spawns, 1);
  });
}

test('test abort: stalled startup HTTP is aborted and the owned child is stopped', async t => {
  const controller = new AbortController(), f = fixture(t, { stallHttp: true, signal: controller.signal });
  const ready = f.session.ready();
  await delay(40); controller.abort(new Error('synthetic test abort'));
  await assert.rejects(ready, /synthetic test abort/);
  assert.equal(f.fetchSignal.aborted, true);
  await f.session.stop(); assert.equal(f.child.signalCode, 'SIGTERM');
});

test('test abort: commands after readiness reject instead of leaving pending CDP', async t => {
  const controller = new AbortController(), f = fixture(t, { signal: controller.signal });
  const cdp = await f.session.ready();
  f.sockets[0].send = () => {};
  const command = cdp.send('Runtime.evaluate'); controller.abort(new Error('synthetic test abort'));
  await assert.rejects(command, /synthetic test abort/);
  await f.session.stop(); assert.equal(f.sockets[0].closed, true);
});

test('cleanup: stalled Browser.close and ignored SIGTERM escalate only the owned child', async t => {
  const f = fixture(t, { stallClose: true, ignoreTerm: true }); await f.session.ready();
  const stop = f.session.stop(); assert.equal(f.session.stop(), stop); await stop;
  assert.deepEqual(f.kills, ['SIGTERM', 'SIGKILL']); assert.equal(f.child.signalCode, 'SIGKILL');
  assert.match(f.session.diagnostics().cleanup[0].result, /deadline|timeout/);
});

test('cleanup: kill error still reaches forced exit and preserves diagnostics', async t => {
  const f = fixture(t, { noEndpoint: true, killError: 'SIGTERM', budget: 30 });
  await assert.rejects(f.session.ready()); await f.session.stop();
  assert.deepEqual(f.kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(f.session.diagnostics().cleanup[0].error, 'EPERM');
});

test('cleanup: remaining child is a hard failure and its profile is retained', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'futureroi-startup-regression-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture(t, { noEndpoint: true, neverExit: true, budget: 30 });
  await assert.rejects(f.session.ready());
  const cleanupProfile = async () => { await f.session.stop(); await rm(dir, { recursive: true, force: true }); };
  await assert.rejects(cleanupProfile(), /remained alive after cleanup/);
  await access(dir); assert.equal(f.session.diagnostics().child.alive, true);
  assert.equal(f.observations.at(-1).browserCleanup, 'still-alive');
  assert.deepEqual(f.kills, ['SIGTERM', 'SIGKILL']);
});

test('startup: actual fake process emits a delayed endpoint and exits after cleanup', { timeout: 10000 }, async t => {
  let actualChild, spawns = 0;
  const observations = [];
  const session = launchBrowser({ browser: process.execPath,
    args: ['-e', `setTimeout(() => process.stderr.write('DevTools listening on ${endpoint}\\n'), 1200); setInterval(() => {}, 1000);`],
    profile: '/synthetic/profile', startupBudgetMs: 5000, diagnosticAfterMs: 500, cleanupGraceMs: 1000,
    diagnostic: value => observations.push(value),
    adapters: { spawn: (...args) => { spawns++; actualChild = spawn(...args); return actualChild; }, readFile: absent,
      fetch: async () => Response.json([{ type: 'page', webSocketDebuggerUrl: page }]),
      WebSocket: class extends EventTarget {
        constructor() { super(); setTimeout(() => this.dispatchEvent(new Event('open')), 1); }
        send(contents) { const { id } = JSON.parse(contents); queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result: { product: 'Synthetic/1' } }) }))); }
        close() {}
      } },
  });
  t.after(() => session.stop());
  await session.ready(); await session.stop();
  assert.equal(spawns, 1); assert.deepEqual(observations.filter(x => x.browserStartup).map(x => x.browserStartup), ['still-waiting', 'ready']);
  assert.equal(observations.at(-1).child.alive, false);
  assert.ok(actualChild.exitCode !== null || actualChild.signalCode !== null);
});

for (const stage of ['HTTP', 'WebSocket']) {
  test('startup: real loopback ' + stage + ' that never completes is cancelled', { timeout: 5000 }, async t => {
    let port, lastOperation = null;
    const connections = new Set(), upgrades = new Set();
    const server = createServer((req, res) => {
      lastOperation = req.url;
      if (stage === 'WebSocket') res.end(JSON.stringify([{ type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/synthetic` }]));
    });
    server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
    server.on('upgrade', (_req, socket) => {
      lastOperation = 'upgrade'; upgrades.add(socket); socket.on('close', () => upgrades.delete(socket));
      // upgrade後はHTTP serverがread/FIN処理を引き継がないためfixture自身が受け取る。
      socket.on('end', () => socket.destroy()); socket.resume();
    }); // handshakeを完了しない故障
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
    t.after(async () => {
      for (const socket of connections) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    });
    const f = fixture(t, { endpoint: `ws://127.0.0.1:${port}/devtools/browser/synthetic`, budget: 350,
      adapters: { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket } });
    await assert.rejects(f.session.ready(), /startup deadline exceeded/);
    assert.equal(f.session.diagnostics().stage, stage === 'HTTP' ? 'http' : 'websocket');
    assert.equal(lastOperation, stage === 'HTTP' ? '/json/list' : 'upgrade');
    await f.session.stop(); assert.equal(f.child.signalCode, 'SIGTERM');
    await delay(50);
    assert.equal(stage === 'HTTP' ? connections.size : upgrades.size, 0, 'cancelled I/O left its request socket connected');
  });
}
