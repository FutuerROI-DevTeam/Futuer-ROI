import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAuthError } from '../src/auth/client.ts';
import { resetRedirectTarget, resetSearch, validateNewPassword, validateResetRequest } from '../src/auth/reset.ts';

test('メールのリンクから戻った状態：空でないtokenだけを受け取り、error=INVALID_TOKENと壊れたtokenは「使えないリンク」にする', () => {
  assert.deepEqual(resetSearch({ token: 'abc123' }), { token: 'abc123' });
  assert.deepEqual(resetSearch({ error: 'INVALID_TOKEN' }), { error: 'INVALID_TOKEN' });
  // tokenがあればerrorより優先（両方付くことは無いが、入力フォームを出す側に倒す）
  assert.deepEqual(resetSearch({ token: 'abc123', error: 'INVALID_TOKEN' }), { token: 'abc123' });
  for (const token of ['', '   ', 42, null]) assert.deepEqual(resetSearch({ token }), { error: 'INVALID_TOKEN' });
  // 直接URLを開いた（何も付いていない）ときも、フォームは出さない
  assert.deepEqual(resetSearch({}), {});
  assert.deepEqual(resetSearch({ error: 'SOMETHING_ELSE' }), {});
});

test('戻り先は今開いているoriginの絶対URL（APIのorigin検査を通す）', () => {
  assert.equal(resetRedirectTarget('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/reset-password');
  assert.equal(resetRedirectTarget('https://example.test'), 'https://example.test/reset-password');
});

test('再設定の要求前の検査はログインと同じメールアドレスの見方をする', () => {
  assert.deepEqual(validateResetRequest(' a@example.com '), {});
  assert.match(validateResetRequest('').email, /入力してください/);
  assert.match(validateResetRequest('name@example').email, /形式/);
});

test('新しいパスワードは8文字以上と確認入力の一致を求め、項目ごとに返す', () => {
  assert.deepEqual(validateNewPassword('longenough', 'longenough'), {});
  assert.deepEqual(Object.keys(validateNewPassword('', '')), ['password', 'confirm']);
  assert.match(validateNewPassword('short', 'short').password, /8文字以上/);
  assert.match(validateNewPassword('longenough', 'different1').confirm, /一致しません/);
  assert.match(validateNewPassword('longenough', '').confirm, /もう一度/);
  // パスワード自体が不正なら、不一致は重ねて出さない
  assert.deepEqual(Object.keys(validateNewPassword('short', 'other')), ['password']);
});

test('再設定の失敗コードを日本語にする', () => {
  assert.match(describeAuthError('INVALID_TOKEN', undefined), /有効期限/);
  assert.match(describeAuthError('RESET_PASSWORD_DISABLED', undefined), /利用できません/);
  assert.match(describeAuthError('PASSWORD_TOO_SHORT', undefined), /8文字以上/);
});
