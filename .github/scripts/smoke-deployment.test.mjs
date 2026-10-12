import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./smoke-deployment.sh', import.meta.url));
const bash = process.env.BASH_EXE ?? (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');

async function smoke(t, handler, seconds = '5') {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(bash, ['--noprofile', '--norc', script.replace(/\\/g, '/'), `http://127.0.0.1:${server.address().port}`], {
      env: { ...process.env, SMOKE_TIMEOUT_SECONDS: seconds, VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass' },
    });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Shell harness deadline')); }, 10000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, output, elapsed: Date.now() - started }); });
  });
  return result;
}

test('real shell and curl verify all three routes with a synthetic bypass', async t => {
  const paths = [];
  const result = await smoke(t, (req, res) => {
    assert.equal(req.headers['x-vercel-protection-bypass'], 'synthetic-bypass');
    paths.push(req.url);
    if (req.url === '/api/health') res.end('{"status":"ok","database":"ok"}');
    else if (req.url === '/') res.end('<title>Future ROI</title>');
    else { res.writeHead(401); res.end('{"code":"UNAUTHENTICATED"}'); }
  });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(paths, ['/api/health', '/', '/api/goals']);
});

test('real curl with partial HTTP 200 and a stalled body fails within the whole smoke budget', async t => {
  const result = await smoke(t, (_req, res) => {
    res.writeHead(200);
    res.write('{"status":"ok","database":"ok"}'); // Valid text; intentionally never end the body.
  }, '1');
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /curl: \(28\)|Smoke deadline exceeded/);
  assert.ok(result.elapsed < 5000, result.output);
  assert.doesNotMatch(result.output, /OK \/api\/health/);
});

test('wrong status uses bounded retries and fails without probing later routes', async t => {
  const paths = [];
  const result = await smoke(t, (req, res) => { paths.push(req.url); res.writeHead(503); res.end('unavailable'); }, '1');
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /NG \/api\/health|Smoke deadline exceeded/);
  assert.deepEqual(paths, ['/api/health']);
  assert.ok(result.elapsed < 5000);
});
