import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

// 既存 Vite/React だけで bundle し、Chromium の実DOMで hook を検査する。新しいテスト依存は不要。
// CI ubuntu-latest の Chrome、Windows の既存 Chrome/Edge、または明示した TEST_BROWSER を使う。
async function browserPath() {
  const candidates = [process.env.TEST_BROWSER,
    ...(process.platform === 'win32' ? [
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    ] : process.platform === 'darwin' ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'])].filter(Boolean);
  for (const path of candidates) { try { await access(path); return path; } catch {} }
  throw new Error('Chromium not found: set TEST_BROWSER to an installed Chrome/Edge/Chromium executable (not a skipped PASS)');
}

// Better Auth は client 作成時に fetch を保持するため、bundle 評価前に transport を用意する。
function setupSessionTransport() {
  const state = globalThis.__sessionTransport = { owner: 'A', failure: null, reads: 0, writes: 0, hold: false, held: [] };
  globalThis.fetch = async (request, init) => {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    if (new URL(url, location.href).pathname !== '/api/auth/get-session' || (init?.method && init.method !== 'GET')) {
      state.writes++; throw new Error('unexpected request: ' + url);
    }
    state.reads++;
    if (state.hold) await new Promise((resolve) => state.held.push(resolve));
    if (state.failure === 'network') throw new TypeError('synthetic offline');
    if (state.failure === '503') return Response.json({ code: 'SYNTHETIC_UNAVAILABLE', message: 'synthetic 503' }, { status: 503 });
    if (state.failure === '429') return Response.json({ code: 'RATE_LIMITED', message: 'synthetic 429' }, { status: 429 });
    return Response.json({
      user: { id: state.owner, name: 'Synthetic ' + state.owner, email: state.owner + '@example.invalid', emailVerified: true, createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' },
      session: { id: 'synthetic-' + state.owner, userId: state.owner, token: 'synthetic-test-token', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z' },
    });
  };
}

async function runBrowser(t, entry, mockAuth, realRouter = false) {
  const browser = await browserPath();
  const dir = await mkdtemp(join(tmpdir(), 'futureroi-session-test-'));
  t.after(() => {
    if (!dir.startsWith(join(tmpdir(), 'futureroi-session-test-'))) throw new Error('refusing cleanup outside test temp directory');
    return rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const bundle = await build({
    configFile: false, logLevel: 'silent',
    resolve: { alias: { '@contracts': fileURLToPath(new URL('../../api/src/contracts/index.ts', import.meta.url)), ...(!realRouter && { '@tanstack/react-router': 'test:router' }) }, conditions: ['development'] },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [react(), {
      name: 'isolated-test-router',
      enforce: 'pre',
      resolveId: (id) => id === 'test:router' ? '\0test:router' : mockAuth && id.endsWith('/auth/client.ts') ? '\0test:auth' : null,
      load: (id) => id === '\0test:auth' ? 'export const authClient = {}; export const describeAuthError = (_code, fallback) => fallback;' : id === '\0test:router' ? `import {createElement} from 'react';
        export const Link=({to,params,search,children,...props})=>createElement('a',{href:to,...props},children);
        export const useNavigate=()=>()=>{}; export const useRouter=()=>({subscribe:()=>()=>{}}); export const useLocation=()=>({href:'/goals'});` : null,
    }],
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL(entry, import.meta.url)), formats: ['iife'], name: 'SessionTests' } },
  });
  const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((b) => b.output);
  const code = outputs.filter((out) => out.type === 'chunk').map((out) => out.code).join('\n');
  const page = join(dir, 'index.html');
  const prelude = mockAuth ? '' : '(' + setupSessionTransport.toString() + ')();';
  const html = `<meta charset="utf-8"><div id="app"></div><pre id="result">PENDING</pre><script>${prelude}
    onerror=(message)=>{document.getElementById('result').textContent=JSON.stringify({ok:false,error:String(message)});};
    onunhandledrejection=(event)=>{document.getElementById('result').textContent=JSON.stringify({ok:false,error:String(event.reason)});};
    </script><script>${code.replaceAll('</script', '<\\/script')}</script>`;
  await writeFile(page, html);
  const server = createServer((_, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const { port } = server.address();
  const { stdout, stderr } = await promisify(execFile)(browser, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(dir, 'profile')}`, '--dump-dom', `--virtual-time-budget=${realRouter ? 60000 : 15000}`, `http://127.0.0.1:${port}/`,
  ], { timeout: realRouter ? 120000 : 45000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const text = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(text && text !== 'PENDING', `browser did not finish hook regression: ${stderr.slice(-1500)}`);
  const result = JSON.parse(text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'));
  assert.equal(result.ok, true, result.error);
  return result;
}

test('Issue185: failed Goal saves retain context across a healthy same-owner confirmation', {timeout:180000}, async t => {
  const fingerprint = async () => {
    const files = ['../src/features/goals/GoalFormPage.tsx', '../src/features/goals/navigation/useConfirmedGoalSave.ts',
      '../src/features/goals/navigation/useGoalFormFailure.ts', '../src/copy/goals.ts', './issue185-failure.browser.tsx'];
    const hash = createHash('sha256');
    for (const path of files) hash.update(path).update(await readFile(new URL(path, import.meta.url)));
    return hash.digest('hex');
  };
  const sourceBefore = await fingerprint();
  const result = await runBrowser(t, './issue185-failure.browser.tsx', false, true);
  const sourceAfter = await fingerprint();
  t.diagnostic(JSON.stringify({ ...result, sourceBefore, sourceAfter }));
  assert.equal(sourceBefore, sourceAfter, 'source changed during acceptance run');
  assert.equal(result.results.length,56);
  assert.deepEqual(result.failures,[], 'failure state lost after healthy same-owner confirmation');
});
