import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

// 製品moduleそのものを読み、transport/storeだけを差し替える。独立HTTP確認は行わない。
const authClient = { $store: { atoms: {} } };
globalThis.__sessionConfirmClient = authClient;
const sessionUrl = new URL('../src/auth/session.ts', import.meta.url).href;
const clientUrl = new URL('../src/auth/client.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (context.parentURL === sessionUrl && resolved.url === clientUrl) {
      return { url: 'data:text/javascript,export const authClient = globalThis.__sessionConfirmClient;', shortCircuit: true };
    }
    return resolved;
  },
});
let checkSession;
try {
  ({ checkSession } = await import(sessionUrl));
} finally {
  hooks.deregister();
  delete globalThis.__sessionConfirmClient;
}

test('router confirmation shares the hook store and waits for a replacing refresh', async () => {
  const original = authClient.$store.atoms.session;
  const listeners = new Set();
  let release;
  let reads = 0;
  let value = { data: { user: { email: 'A@example.invalid' } }, error: null, isPending: false, isRefetching: false, refetch };
  function publish(next) {
    value = { ...value, ...next };
    for (const fn of listeners) fn(value);
  }
  function refetch() {
    reads++;
    publish({ isRefetching: true });
    return new Promise(resolve => { release = resolve; });
  }
  authClient.$store.atoms.session = {
    get: () => value,
    listen: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  try {
    const first = checkSession();
    const second = checkSession();
    assert.equal(first, second);
    assert.equal(reads, 1);
    let finished = false;
    first.then(() => { finished = true; });
    // 最初のfetchはfocusによる新しい確認に置き換えられた。旧Aを確定扱いしない。
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    publish({ data: { user: { email: 'B@example.invalid' } }, isRefetching: false });
    assert.deepEqual(await first, { kind: 'signed-in', email: 'B@example.invalid' });
    assert.equal(listeners.size, 0);

    const signedOut = checkSession(); release();
    publish({ data: null, isPending: false, isRefetching: false });
    assert.deepEqual(await signedOut, { kind: 'signed-out' });

    const failed = checkSession(); release();
    publish({ data: { user: { email: 'B@example.invalid' } }, error: { status: 429 }, isRefetching: false });
    assert.deepEqual(await failed, { kind: 'unreachable' });
  } finally { authClient.$store.atoms.session = original; }
});
