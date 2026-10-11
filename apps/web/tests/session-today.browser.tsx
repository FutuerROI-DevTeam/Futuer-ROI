import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '../src/auth/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { goalKeys, goalsHttp } from '../src/api/goals-http.ts';
import { todayHttp } from '../src/api/today-http.ts';
import { TodayPage } from '../src/features/today/TodayPage.tsx';

// #190：ウィンドウへ戻るたびの session 再確認で、Today の入力中の状態を作り直さない。
// 固定版の本物の useSession / visibilitychange 再取得を使い、HTTP transport と業務APIだけを合成する。
// 確認中に届いたデータは使わない・確認できるまで送らない・別の人／失敗なら捨てる、を同じ実DOMで確かめる。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transport = (globalThis as typeof globalThis & { __sessionTransport: { owner: string; failure: '503' | 'network' | '429' | null; reads: number; writes: number; hold: boolean; held: (() => void)[] } }).__sessionTransport;
const observed: { owner: string | undefined; refetching: boolean }[] = [];
const id = 'goal';
// ローカルの実APIの応答（未記録・完了の目安あり）を、利用者が分かる title だけ差し替えて使う
const logs = Array.from({ length: 28 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 8, 12 + i)).toISOString().slice(0, 10);
  return i % 2 === 0 ? { localDate: date, status: 'SKIPPED', amount: null } : { localDate: date, status: 'DONE', amount: 30 };
});
const goal = (owner: string) => ({ id, title: `${owner}-PRIVATE-GOAL`, unit: 'minutes', totalRequired: 16600, sessionAmount: 30, initialProgress: 0,
  timezone: 'Asia/Tokyo', recordStartDate: '2026-09-10', hasLogs: true, unitLocked: false, goalSettingsRevision: 0, today: '2026-10-10',
  todayStatus: 'UNRECORDED', progressDone: 420, targetDate: null, schemaVersion: 'r11-v1', questionPrior: { a: null, b: null }, answerRevision: 0 });
const today = { today: '2026-10-10', yesterday: '2026-10-09', todayLog: null, yesterdayMissing: false, schemaVersion: 'r11-v1',
  prediction: { modelVersion: 'm1-question-prior-v1', today: '2026-10-10', todayStatus: 'UNRECORDED', progress: { done: 420, total: 16600, completed: false },
    observations: { nDD: 0, nDS: 13, nSD: 14, nSS: 0, effectiveTransitions: 27, observedDays: 28, recordedDays: 28 },
    posterior: { a: { alpha: 2, beta: 15 }, b: { alpha: 16, beta: 2 } }, coreMetric: { status: 'available', g50: 1, g80: 1 },
    completion: { status: 'available', scenario: 'TODAY_DONE', p50Days: 1070, p80Days: null }, config: { samples: 200, horizonDays: 1095, seed: 20261012 } },
  context: { recordStartDate: '2026-09-10', unit: 'minutes', sessionAmount: 30, goalSettingsRevision: 0, answerRevision: 0, unitLocked: false },
  provenance: { a: 'RECORDS', b: 'RECORDS' }, plan: null };
goalsHttp.getGoal = async () => goal(transport.owner) as never;
todayHttp.getToday = async () => today as never;
todayHttp.listLogs = async () => logs as never;
const puts: string[] = [];
todayHttp.putLog = async (_goalId, localDate, body) => {
  puts.push(`${transport.owner}:${localDate}:${body.status}`);
  return { localDate, status: body.status, amount: body.status === 'DONE' ? 30 : null } as never;
};
const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Screen() {
  const session = authClient.useSession();
  observed.push({ owner: session.data?.user.id, refetching: session.isRefetching });
  return <TodayPage goalId={id} />;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const settle = async () => { for (let i = 0; i < 12; i++) await act(tick); };
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const text = () => host.textContent ?? '';
const amountInput = () => host.querySelector<HTMLInputElement>('.fr-amount input');
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.replace(/\s/g, '').startsWith(label));
const click = async (label: string) => act(async () => { button(label)!.click(); await tick(); });
const typeAmount = async (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amountInput()!, value);
  amountInput()!.dispatchEvent(new Event('input', { bubbles: true })); await tick();
});
// テスト時計だけを進め、固定版の5秒 focus throttle を越える。製品の設定は変更しない。
const realNow = Date.now;
let clockAdvance = 0;
Date.now = () => realNow() + clockAdvance;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
const focus = async () => {
  const before = transport.reads;
  clockAdvance += 6000;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await tick(); });
  await settle();
  ensure(transport.reads > before, 'visibilitychange did not request a real session refetch');
};
const release = async () => { transport.hold = false; transport.held.splice(0).forEach((resolve) => resolve()); await settle(); };

async function run() {
  const results: string[] = [];
  await act(async () => { root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Screen /></QueryClientProvider>); await tick(); });
  await settle();
  ensure(text().includes('A-PRIVATE-GOAL') && button('量を変更'), 'initial A Today did not mount');
  const expectedOrder = window.matchMedia('(min-width: 960px)').matches
    ? 'fr-today__primary,fr-today__records,fr-today__history-chart,fr-today__right'
    : 'fr-today__primary,fr-today__records,fr-today__right,fr-today__history-chart';
  ensure([...host.querySelector('.fr-today__scroll')!.children].map(node => node.className).join(',') === expectedOrder, 'Today reading order differs from P-23 viewport order');

  // 1. 量の入力中に同じ人の確認：入力欄と値を保ち、確認中に届いたデータは表示しない
  await click('量を変更'); await typeAmount('45');
  ensure(amountInput()?.value === '45', 'amount input fixture missing');
  transport.hold = true; await focus();
  ensure(observed.at(-1)?.owner === 'A' && observed.at(-1)?.refetching, 'same-owner check not pending');
  ensure(amountInput()?.value === '45' && text().includes('A-PRIVATE-GOAL'), 'same-owner check unmounted Today input');
  await act(async () => { client.setQueryData(goalKeys.detail(id), goal('B')); await tick(); }); await settle();
  ensure(!text().includes('B-PRIVATE'), 'data received during the check was displayed');
  // 確認後のキャッシュ消去・取り直しの間も、量の入力欄を一度も外さない
  const editor = host.querySelector('.fr-amount');
  await release();
  ensure(editor?.isConnected && amountInput()?.value === '45', 'same-owner recovery lost the amount input');
  ensure(text().includes('A-PRIVATE-GOAL') && !text().includes('B-PRIVATE'), 'same-owner recovery reused data received during checking');
  ensure(puts.length === 0, 'check sent a private write');
  results.push('same-A check keeps amount input; data received during checking is discarded');
  await click('戻る'); await settle();

  // 2. 確認中に押した保存：確認できるまで送らず、同じ人と分かったら1回だけ送る
  transport.hold = true; await focus();
  await click('今日は休む');
  ensure(puts.length === 0, 'save was sent before the owner was confirmed');
  ensure(button('保存中')?.disabled && text().includes('保存が終わるまで'), 'held save did not show the saving state');
  await release();
  ensure(puts.join() === 'A:2026-10-10:SKIPPED', `held save was not sent once after same-A confirmation: ${puts.join()}`);
  results.push('save pressed during same-A check is sent once after confirmation');

  // 3. 確認中に押した保存：別の人と分かったら送らず、前の人の画面を捨てる
  transport.hold = true; await focus();
  await click('今日は休む');
  transport.owner = 'B'; await release();
  ensure(puts.length === 1, 'held save was sent for a different owner');
  ensure(!text().includes('A-PRIVATE') && text().includes('B-PRIVATE-GOAL'), 'A Today remained after switching to B');
  results.push('save pressed during check is dropped when the session turns out to be B; A Today discarded');

  // 4. 確認の失敗：入力中の状態を隠して捨て、回復後は新しい画面から始める
  transport.owner = 'A'; await focus(); await settle();
  ensure(text().includes('A-PRIVATE-GOAL'), 'A recovery missing');
  await click('量を変更'); await typeAmount('45');
  transport.failure = '503'; await focus();
  ensure(!amountInput() && !text().includes('A-PRIVATE'), '503 check left A input mounted');
  transport.failure = null; await focus();
  ensure(text().includes('A-PRIVATE-GOAL') && !amountInput(), 'same-A recovery after failure restored the discarded input');
  ensure(puts.length === 1, 'failure path sent a private write');
  results.push('503 check masks and discards input; recovery opens a fresh Today');

  await act(async () => root.unmount()); client.clear(); Date.now = realNow;
  return { results, puts: puts.length, reads: transport.reads, writes: transport.writes };
}
run().then((result) => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result }); }).catch((error) => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: error.stack ?? String(error) });
});
