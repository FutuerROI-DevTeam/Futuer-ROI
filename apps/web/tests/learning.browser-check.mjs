import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

// Same isolated native Chromium strategy as session-cache.browser-check.mjs.
// No SDK, DB, learner fitting, credentials, dependency install or user profile.
test('#227 actual React/QueryClient/LearningToday consent, main, previews, rollback, withdrawal and owner boundaries', { timeout: 180000 }, async t => {
  const candidates = [process.env.TEST_BROWSER, ...(process.platform === 'win32' ? [
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'])].filter(Boolean);
  let browser; for (const path of candidates) { try { await access(path); browser = path; break; } catch {} }
  assert.ok(browser, 'Chromium missing; set TEST_BROWSER (not a skipped PASS)');
  const prefix = join(tmpdir(), 'futureroi-learning-test-'), dir = await mkdtemp(prefix);
  let server;
  t.after(async () => {
    if (server) await new Promise(done => { server.closeAllConnections(); server.close(done); });
    const target = resolve(dir), expected = resolve(prefix);
    assert.ok(target.startsWith(expected) && target !== resolve(tmpdir()), 'refusing cleanup outside owned test directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await assert.rejects(access(target));
    t.diagnostic(JSON.stringify({ ownedTemporaryDirectoryRemoved: true, directory: target, userProfileUntouched: true }));
  });
  const bundle = await build({ configFile: false, logLevel: 'silent',
    resolve: { alias: { '@contracts': fileURLToPath(new URL('../../api/src/contracts/index.ts', import.meta.url)) }, conditions: ['development'] },
    define: { 'process.env.NODE_ENV': '"development"' }, plugins: [react(), {
      name: 'synthetic-auth-only', enforce: 'pre',
      resolveId: id => id.endsWith('/auth/client.ts') ? '\0learning:auth' : null,
      load: id => id === '\0learning:auth' ? 'export const authClient={}; export const describeAuthError=(_code,fallback)=>fallback;' : null,
    }], build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./learning.browser.tsx', import.meta.url)), formats: ['iife'], name: 'LearningBrowserTests' } },
  });
  const code = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(b => b.output).filter(out => out.type === 'chunk').map(out => out.code).join('\n');
  const html = `<meta charset="utf-8"><div id="app"></div><pre id="result">PENDING</pre><script>
    onerror=message=>{document.getElementById('result').textContent=JSON.stringify({ok:false,error:String(message)});};
    onunhandledrejection=event=>{document.getElementById('result').textContent=JSON.stringify({ok:false,error:String(event.reason)});};
    </script><script>${code.replaceAll('</script', '<\\/script')}</script>`;
  await writeFile(join(dir, 'index.html'), html);
  server = createServer((_, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const { stdout, stderr } = await promisify(execFile)(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(dir, 'profile')}`, '--dump-dom', '--virtual-time-budget=30000', `http://127.0.0.1:${server.address().port}/`],
    { timeout: 90000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const output = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(output && output !== 'PENDING', `Chrome regression did not finish: ${stderr.slice(-1500)}`);
  const result = JSON.parse(output.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.results.length, 9);
  assert.equal(result.writes.length, 10);
  assert.deepEqual(result.previews, [30, 0]);
  assert.deepEqual(result.comparisons, [15,30,0]);
  assert.equal(result.adoptableFixtureIsNotMathCertificate, true);
  t.diagnostic(JSON.stringify(result));
});
