import assert from 'node:assert/strict';
import test from 'node:test';
import { runAuthAction } from '../src/auth/action.ts';
import { describeAuthError } from '../src/auth/client.ts';

for (const [name, action, successful] of [
  ['success', async () => ({ error: null }), true],
  ['API error', async () => ({ error: { code: 'UNAVAILABLE', message: 'retry' } }), false],
  ['network rejection', async () => { throw new TypeError('offline'); }, false],
]) {
  test(`auth action releases busy and only navigates on ${name}`, async () => {
    const busy = [];
    const failures = [];
    let navigations = 0;
    await runAuthAction(action, {
      setBusy: (value) => busy.push(value),
      onError: (error) => failures.push(error),
      onSuccess: async () => { navigations++; },
    });
    assert.deepEqual(busy, [true, false]);
    assert.equal(navigations, successful ? 1 : 0);
    assert.equal(failures.length, successful ? 0 : 1);
    if (name === 'network rejection') assert.equal(failures[0].code, 'NETWORK_ERROR');
  });
}

test('unconfirmed logout keeps the failure visible and permits an explicit second attempt', async () => {
  const busy = [];
  const failures = [];
  let attempts = 0;
  let navigations = 0;
  const action = async () => ++attempts === 1 ? { error: { code: 'SIGN_OUT_UNCONFIRMED', message: 'SDK error' } } : { error: null };
  const callbacks = {
    setBusy: (value) => busy.push(value),
    onError: (error) => failures.push(describeAuthError(error.code, error.message)),
    onSuccess: async () => { navigations++; },
  };
  await runAuthAction(action, callbacks);
  assert.equal(navigations, 0);
  assert.equal(attempts, 1);
  assert.match(failures[0], /ログアウトを確認できませんでした/);
  assert.deepEqual(busy, [true, false]);
  await runAuthAction(action, callbacks);
  assert.equal(navigations, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(busy, [true, false, true, false]);
});
