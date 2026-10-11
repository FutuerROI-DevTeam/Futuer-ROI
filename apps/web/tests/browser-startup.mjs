import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { availableParallelism, freemem, loadavg } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseDevToolsEndpoint, parseDevToolsActivePort } from './browser-debug-endpoint.mjs';

// Promise.raceだけでは停止したI/Oを解除できない。各I/Oにも同じsignalを渡す。
function bounded(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function deadline(ms, message) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

// 起動処理だけを抽出。UIのuntil/assert/180秒test timeoutやChrome sandboxは変えない。
export function launchBrowser({ browser, args, profile, signal, diagnostic = () => {},
  startupBudgetMs = 30000, diagnosticAfterMs = 10000, cleanupGraceMs = 2000, adapters = {} }) {
  const io = { spawn, readFile, fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, ...adapters };
  const started = performance.now(), lifecycle = new AbortController();
  const timings = {}, cleanup = [];
  let stage = 'spawn', lastIO = null, stderr = '', stderrBytes = 0, stderrEndpoint = null;
  let endpointSource = null, activePortReadError = null, launchError = null, terminated = false;
  let cdp, readyPromise, stopPromise;
  const elapsed = () => Math.round(performance.now() - started);
  const mark = name => { stage = name; timings[name] ??= elapsed(); };
  const noteIO = (operation, result) => { lastIO = { operation, result, atMs: elapsed() }; };
  // testのafterが先に済んだ非同期継続から、新しいprocessを所有してはならない。
  signal?.throwIfAborted();
  const child = io.spawn(browser, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(resolve => {
    child.once('exit', (code, exitSignal) => {
      terminated = true; noteIO('process', 'exit');
      lifecycle.abort(new Error(`Chrome exited before completion (code=${code}, signal=${exitSignal})`));
      resolve();
    });
    child.on('error', error => {
      launchError = { code: error.code, message: error.message.slice(0, 400) };
      // spawn失敗にはexitイベントがない。kill等のerrorだけで生存processを終了済みにしない。
      if (!child.pid) { terminated = true; resolve(); }
      noteIO('process', 'error'); lifecycle.abort(new Error('Chrome process error: ' + error.code));
    });
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    const combined = stderr + chunk;
    stderrEndpoint ??= parseDevToolsEndpoint(combined);
    stderr = combined.slice(-4000); noteIO('stderr', 'data');
  });
  const diagnostics = () => ({ stage, elapsedMs: elapsed(), timings: { ...timings }, lastIO,
    endpointSource, activePortReadError, launchError, stderrBytes, stderr,
    child: { pid: child.pid, alive: !terminated, exitCode: child.exitCode, signalCode: child.signalCode },
    host: { parallelism: availableParallelism(), load: loadavg(), freeMemoryBytes: freemem() },
    cleanup: [...cleanup] });

  function connection(url) {
    const socket = new io.WebSocket(url), pending = new Map();
    let id = 0, disposed = false;
    const failPending = error => {
      for (const command of pending.values()) command.reject(error);
      pending.clear();
    };
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data)), command = pending.get(message.id);
        if (!command) return;
        noteIO('CDP', 'response');
        if (message.error) command.reject(new Error(JSON.stringify(message.error)));
        else command.resolve(message.result);
      } catch (error) { failPending(error); }
    });
    socket.addEventListener('close', () => failPending(new Error('CDP socket closed')));
    socket.addEventListener('error', () => failPending(new Error('CDP socket error')));
    return { socket,
      open(openSignal) {
        return bounded(() => new Promise((resolve, reject) => {
          const dispose = () => {
            socket.removeEventListener('open', opened); socket.removeEventListener('error', failed);
            socket.removeEventListener('close', closed); openSignal.removeEventListener('abort', aborted);
          };
          const opened = () => { dispose(); noteIO('WebSocket', 'open'); resolve(); };
          const failed = () => { dispose(); reject(new Error('CDP WebSocket open failed')); };
          const closed = () => { dispose(); reject(new Error('CDP WebSocket closed before open')); };
          const aborted = () => { dispose(); reject(openSignal.reason); };
          socket.addEventListener('open', opened, { once: true });
          socket.addEventListener('error', failed, { once: true });
          socket.addEventListener('close', closed, { once: true });
          openSignal.addEventListener('abort', aborted, { once: true });
          if (openSignal.aborted) aborted();
        }), openSignal);
      },
      async send(method, params = {}, { signal: commandSignal, timeoutMs = 10000 } = {}) {
        if (disposed) throw new Error('CDP connection disposed');
        const limit = deadline(timeoutMs, 'CDP timeout: ' + method);
        const sendSignal = AbortSignal.any([limit.signal, ...(commandSignal ? [commandSignal] : [lifecycle.signal, ...(signal ? [signal] : [])])]);
        const commandId = ++id;
        try {
          return await bounded(() => new Promise((resolve, reject) => {
            pending.set(commandId, { resolve, reject });
            noteIO('CDP', 'send ' + method);
            socket.send(JSON.stringify({ id: commandId, method, params }));
          }), sendSignal);
        } finally { limit.dispose(); pending.delete(commandId); }
      },
      close() {
        disposed = true; failPending(new Error('CDP connection disposed'));
        socket.close();
      },
    };
  }

  const budget = deadline(Math.max(1, startupBudgetMs - (performance.now() - started)),
    `Chrome startup deadline exceeded (${startupBudgetMs} ms)`);
  const startupSignal = AbortSignal.any([budget.signal, lifecycle.signal, ...(signal ? [signal] : [])]);
  const slowTimer = setTimeout(() => diagnostic({ browserStartup: 'still-waiting', ...diagnostics() }), diagnosticAfterMs);

  async function prepare() {
    try {
      mark('endpoint');
      let endpoint;
      while (!endpoint) {
        startupSignal.throwIfAborted();
        if (stderrEndpoint) { endpoint = stderrEndpoint; endpointSource = 'stderr'; break; }
        try {
          const contents = await bounded(() => io.readFile(join(profile, 'DevToolsActivePort'),
            { encoding: 'utf8', signal: startupSignal }), startupSignal);
          startupSignal.throwIfAborted();
          endpoint = parseDevToolsActivePort(contents);
          activePortReadError = endpoint ? null : { code: 'INVALID_CONTENT' };
          noteIO('DevToolsActivePort', endpoint ? 'endpoint' : 'invalid');
          if (endpoint) endpointSource = 'profile';
        } catch (error) {
          startupSignal.throwIfAborted();
          activePortReadError = { code: error.code ?? 'READ_ERROR' }; noteIO('DevToolsActivePort', activePortReadError.code);
        }
        if (!endpoint) await delay(20, undefined, { signal: startupSignal });
      }
      mark('http');
      const origin = new URL(endpoint); origin.protocol = 'http:';
      let target;
      while (!target) {
        const response = await bounded(() => io.fetch(new URL('/json/list', origin), { signal: startupSignal, redirect: 'error' }), startupSignal);
        if (!response.ok) throw new Error('Chrome target HTTP status: ' + response.status);
        const pages = await bounded(() => response.json(), startupSignal);
        if (!Array.isArray(pages)) throw new Error('Chrome target response is not an array');
        target = pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl);
        noteIO('/json/list', target ? 'page' : 'no-page');
        if (!target) await delay(20, undefined, { signal: startupSignal });
      }
      // owned endpointと同じloopback portだけ。redirectや外部targetへ診断通信を広げない。
      const targetURL = new URL(target.webSocketDebuggerUrl), browserURL = new URL(endpoint);
      if (targetURL.origin !== browserURL.origin || !targetURL.pathname.startsWith('/devtools/page/')
        || targetURL.username || targetURL.password || targetURL.search || targetURL.hash) {
        throw new Error('Chrome page endpoint is outside the owned debug endpoint');
      }
      mark('websocket'); cdp = connection(targetURL.href); await cdp.open(startupSignal);
      mark('cdp');
      const version = await cdp.send('Browser.getVersion', {}, { signal: startupSignal,
        timeoutMs: Math.max(1, startupBudgetMs - (performance.now() - started)) });
      startupSignal.throwIfAborted();
      if (performance.now() - started >= startupBudgetMs) throw new Error(`Chrome startup deadline exceeded (${startupBudgetMs} ms)`);
      mark('ready');
      diagnostic({ browserStartup: 'ready', ...diagnostics(), product: version.product, protocolVersion: version.protocolVersion });
      return cdp;
    } catch (error) {
      const cause = startupSignal.aborted ? startupSignal.reason : error;
      diagnostic({ browserStartup: 'failed', ...diagnostics() });
      throw new Error('Chrome startup failed: ' + cause.message + ': ' + JSON.stringify(diagnostics()), { cause });
    } finally { budget.dispose(); clearTimeout(slowTimer); }
  }

  function ready() { readyPromise ??= prepare(); return readyPromise; }

  function stop() {
    stopPromise ??= (async () => {
      budget.dispose(); clearTimeout(slowTimer);
      lifecycle.abort(new Error('Chrome session stopped'));
      try {
        if (cdp) {
          const closeLimit = deadline(cleanupGraceMs, 'Browser.close cleanup deadline');
          try {
            await cdp.send('Browser.close', {}, { signal: closeLimit.signal, timeoutMs: cleanupGraceMs });
            cleanup.push({ action: 'Browser.close', result: 'acknowledged' });
            // 応答とprocess exitは別イベント。正常shutdownの猶予中にSIGTERMを割り込ませない。
            await bounded(() => exited, closeLimit.signal);
          }
          catch (error) { cleanup.push({ action: 'Browser.close', result: error.message.slice(0, 200) }); }
          finally {
            closeLimit.dispose();
            try { cdp.close(); } catch (error) { cleanup.push({ action: 'WebSocket.close', error: error.message.slice(0, 200) }); }
          }
        }
      } finally {
        for (const exitSignal of ['SIGTERM', 'SIGKILL']) {
          if (terminated) break;
          try { cleanup.push({ action: exitSignal, sent: child.kill(exitSignal) }); }
          catch (error) { cleanup.push({ action: exitSignal, error: error.code ?? error.message.slice(0, 200) }); }
          const exitLimit = deadline(cleanupGraceMs, 'Chrome cleanup exit deadline');
          try { await bounded(() => exited, exitLimit.signal); }
          catch { /* 次の強制終了または最終の残存判定へ。 */ }
          finally { exitLimit.dispose(); }
        }
        lifecycle.abort(new Error('Chrome session stopped'));
        diagnostic({ browserCleanup: terminated ? 'exited' : 'still-alive', ...diagnostics() });
        if (!terminated) throw new Error('Chrome remained alive after cleanup: ' + JSON.stringify(diagnostics()));
      }
    })();
    return stopPromise;
  }
  return { ready, stop, diagnostics };
}
