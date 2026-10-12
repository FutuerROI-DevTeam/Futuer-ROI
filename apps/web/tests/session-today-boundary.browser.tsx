import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '../src/auth/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { goalKeys, goalsHttp } from '../src/api/goals-http.ts';
import { todayHttp } from '../src/api/today-http.ts';
import { RouterProvider } from '@tanstack/react-router';
import { router } from '../src/router.tsx';
import { getDraftGeneration } from '../src/api/session-draft.ts';
import { ApiError } from '../src/api/client.ts';
import { todayKeys } from '../src/api/today-http.ts';

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
let apiDate = '2026-10-10';
let holdGoal = false;
let holdToday = false;
let failToday = false;
const todayWaiters: (() => void)[] = [];
const goalWaiters: (() => void)[] = [];
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
goalsHttp.getGoal = async () => { if (holdGoal) await new Promise<void>(resolve => goalWaiters.push(resolve)); return goal(transport.owner) as never; };
todayHttp.getToday = async () => {
  if (holdToday) await new Promise<void>(resolve => todayWaiters.push(resolve));
  if (failToday) throw new ApiError(503, { error: { code: 'SYNTHETIC_UNAVAILABLE', message: 'synthetic Today503' } });
  return { ...today, today: apiDate, prediction: { ...today.prediction, today: apiDate } } as never;
};
todayHttp.listLogs = async () => logs as never;
const puts: { owner: string; localDate: string; body: unknown }[] = [];
let failPut = false;
todayHttp.putLog = async (_goalId, localDate, body) => {
  puts.push({ owner: transport.owner, localDate, body: { ...body } });
  if (failPut) throw new ApiError(503, { error: { code: 'SYNTHETIC_UNAVAILABLE', message: 'synthetic 503' } });
  return { localDate, status: body.status, amount: body.status === 'DONE' ? body.amount : null } as never;
};
const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Screen() {
  const session = authClient.useSession();
  observed.push({ owner: session.data?.user.id, refetching: session.isRefetching });
  return <RouterProvider router={router} />;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const settle = async () => { for (let i = 0; i < 12; i++) await act(tick); };
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const text = () => host.textContent ?? '';
const amountInput = () => host.querySelector<HTMLInputElement>('.fr-amount input');
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.replace(/\s/g, '').startsWith(label));
const click = async (label: string) => act(async () => {
  ensure(button(label), 'missing button: ' + label);
  button(label)!.click();
  await tick();
});
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
const release = async () => {
  transport.hold = false;
  transport.held.splice(0).forEach((resolve) => resolve());
  await settle();
};


const navigate = async (to: string) => { await act(async () => { void router.navigate({ to }); await tick(); }); await settle(); };
const releaseGoal = async () => {
  holdGoal = false;
  goalWaiters.splice(0).forEach(resolve => resolve());
  await settle();
};
const releaseToday = async () => {
  holdToday = false;
  todayWaiters.splice(0).forEach(resolve => resolve());
  await settle();
};
async function prepare() {
  await releaseGoal();
  await releaseToday();
  await release();
  transport.owner = 'A';
  transport.failure = null;
  failPut = false;
  failToday = false;
  apiDate = '2026-10-10';
  await navigate('/');
  client.clear();
  puts.length = 0;
  await navigate('/goals/goal');
  await focus();
  await settle();
  ensure(text().includes('A-PRIVATE-GOAL') && button('量を変更'), 'initial Today not ready: ' + text());
  await click('量を変更'); await typeAmount('45');
  ensure(amountInput()?.value === '45', 'amount fixture missing');
}
async function run() {
  const results: string[] = [], failures: string[] = [];
  const check = async (label: string, fn: () => Promise<void>) => {
    try {
      await prepare();
      await fn();
      results.push(label);
    }
    catch (error) { failures.push(label + ': ' + String(error)); }
  };
  await act(async () => {
    root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Screen /></QueryClientProvider>);
    await tick();
  });
  await settle();
  await check('Today arrives first on same date: held 45 waits for Goal and sends once', async () => {
    transport.hold = true;
    await focus();
    await click('この量で記録');
    ensure(puts.length === 0, 'sent while owner checking');
    holdGoal = true; await release();
    ensure(goalWaiters.length > 0 && client.getQueryData(goalKeys.detail(id)) === undefined &&
      (client.getQueryData(todayKeys.today(id)) as typeof today)?.today === apiDate, 'response-half-arrival fixture not reached');
    ensure(amountInput()?.value === '45' && !text().includes('日付が変わりました') && puts.length === 0,
      'same-date Today alone lost input/held save: ' + text());
    await releaseGoal();
    ensure(puts.length === 1 && (puts[0]!.body as any).amount === 45, 'held 45 did not send once: ' + JSON.stringify(puts));
  });
  await check('Explicit reselect cancels a failed retry held during checking', async () => {
    failPut = true;
    await click('この量で記録');
    await settle();
    ensure(puts.length === 1 && text().includes('保存できませんでした'), '503 save fixture missing');
    transport.hold = true;
    await focus();
    await click('もう一度保存');
    ensure(puts.length === 1, 'retry sent while checking');
    await click('選び直す');
    failPut = false;
    await release();
    ensure(puts.length === 1, 'cancelled held retry sent: ' + JSON.stringify(puts));
    ensure(amountInput()?.value === '30' && !text().includes('保存できませんでした'), 'reselect did not open a fresh amount editor');
    await typeAmount('46');
    await click('この量で記録');
    await settle();
    ensure(puts.length === 2 && (puts[1]!.body as any).amount === 46, 'explicit replacement did not send 46 once');
  });
  await check('Today503 fallback input survives healthy same-A check and pending retry', async () => {
    await navigate('/');
    client.clear();
    failToday = true;
    await navigate('/goals/goal');
    ensure(button('量を変更') && text().includes('A-PRIVATE-GOAL'), '503 Goal fallback fixture missing');
    await click('量を変更'); await typeAmount('45');
    const editor = host.querySelector('.fr-amount');
    transport.hold = true; await focus();
    ensure(editor?.isConnected && amountInput()?.value === '45', 'checking lost fallback input');
    holdToday = true; await release();
    ensure(todayWaiters.length > 0 && client.getQueryState(todayKeys.today(id))?.status === 'pending', 'pending Today reset fixture missing');
    ensure(editor?.isConnected && amountInput()?.value === '45', 'pending retry unmounted fallback input');
    await releaseToday();
    ensure(editor?.isConnected && amountInput()?.value === '45' && puts.length === 0, '503 retry lost fallback input');
    failToday = false;
    await act(async () => { void client.invalidateQueries({ queryKey: goalKeys.all }); await tick(); }); await settle();
    ensure(editor?.isConnected && amountInput()?.value === '45', 'healthy Today recovery lost fallback input');
  });
  await check('Unaccepted different-date cache during same-A check cannot replace amount editor', async () => {
    const editor = host.querySelector('.fr-amount');
    transport.hold = true; await focus();
    await act(async () => {
      client.setQueryData(goalKeys.detail(id), { ...goal('A'), today: '2026-10-11' });
      client.setQueryData(todayKeys.today(id), { ...today, today: '2026-10-11' });
      await tick();
    });
    await settle();
    ensure(editor?.isConnected && amountInput()?.value === '45' && !text().includes('日付が変わりました'), 'unaccepted cache replaced the editor');
    await release();
    ensure(editor?.isConnected && amountInput()?.value === '45' && puts.length === 0, 'same-date accepted recovery lost input');
  });
  const atom = authClient.$store.atoms.session;
  for (const boundary of ['A-B-A', 'error-A', 'signedout-A', 'auth-signal', 'storage-session']) {
    await check(boundary + ' discards Today input despite final healthy A', async () => {
      const stable = atom.get(), generation = getDraftGeneration(), editor = host.querySelector('.fr-amount');
      await act(async () => {
        if (boundary === 'A-B-A') atom.set({ ...stable, data: { ...stable.data!, user: { ...stable.data!.user, id: 'B' } } });
        if (boundary === 'error-A') atom.set({ ...stable, error: { status: 503, message: 'synthetic' } as any });
        if (boundary === 'signedout-A') atom.set({ ...stable, data: null });
        if (boundary === 'auth-signal') authClient.$store.notify('$sessionSignal');
        if (boundary === 'storage-session') window.dispatchEvent(new StorageEvent('storage', { key: 'better-auth.message', newValue: JSON.stringify({ event: 'session', data: { trigger: 'signout' } }) }));
        if (['A-B-A', 'error-A', 'signedout-A'].includes(boundary)) atom.set(stable);
        await tick();
      }); await settle();
      ensure(getDraftGeneration() > generation, 'continuity boundary fixture not reached');
      ensure(!editor?.isConnected && !amountInput() && text().includes('A-PRIVATE-GOAL'), 'old Today input retained across boundary: ' + text());
      ensure(puts.length === 0, 'boundary sent a write');
    });
  }
  await check('Batched continuity boundary discards failed 45 context', async () => {
    failPut = true;
    await click('この量で記録');
    await settle();
    ensure(puts.length === 1 && button('もう一度保存'), 'failed 45 fixture missing');
    const stable = atom.get();
    await act(async () => {
      atom.set({ ...stable, error: { status: 503, message: 'synthetic' } as any });
      atom.set(stable);
      await tick();
    }); await settle();
    ensure(!button('もう一度保存') && !amountInput() && button('量を変更'), 'failed save context survived continuity boundary');
    ensure(puts.length === 1, 'discarded failure replayed');
  });
  await check('Held 45 across batched A-B-A never sends', async () => {
    transport.hold = true;
    await focus();
    await click('この量で記録');
    ensure(puts.length === 0, 'held fixture already sent');
    const stable = atom.get();
    await act(async () => {
      atom.set({ ...stable, data: { ...stable.data!, user: { ...stable.data!.user, id: 'B' } } });
      atom.set(stable);
      await tick();
    });
    await settle();
    await release();
    ensure(puts.length === 0 && !amountInput(), 'held old input replayed across continuity boundary');
  });
  await check('Batched healthy same-A check preserves 45 and editor', async () => {
    const stable = atom.get(), generation = getDraftGeneration(), editor = host.querySelector('.fr-amount');
    await act(async () => {
      atom.set({ ...stable, isRefetching: true });
      atom.set(stable);
      await tick();
    }); await settle();
    ensure(getDraftGeneration() === generation && editor?.isConnected && amountInput()?.value === '45', 'ordinary check discarded input');
    ensure(puts.length === 0, 'ordinary check sent a write');
  });
  await check('Known newer Today rejects old held date while Goal is missing', async () => {
    transport.hold = true;
    await focus();
    await click('この量で記録');
    apiDate = '2026-10-11';
    holdGoal = true;
    await release();
    ensure(goalWaiters.length > 0 && client.getQueryData(goalKeys.detail(id)) === undefined, 'missing Goal fixture not reached');
    ensure(text().includes('日付が変わりました') && puts.length === 0, 'known stale date sent or did not warn');
    await releaseGoal(); ensure(puts.length === 0, 'old held date sent after Goal caught up');
  });
  await releaseGoal(); await release();
  await act(async () => root.unmount());
  client.clear();
  Date.now = realNow;
  if (failures.length) throw new Error(JSON.stringify({ results, failures }));
  return { results, reads: transport.reads, writes: transport.writes };
}
run().then(result => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result }); }).catch(error => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: error.stack ?? String(error) });
});
