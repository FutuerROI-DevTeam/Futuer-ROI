import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '../src/auth/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { goalKeys, goalsHttp } from '../src/api/goals-http.ts';
import { todayHttp } from '../src/api/today-http.ts';
import { GoalCreatePage } from '../src/features/goals/GoalFormPage.tsx';
import { GoalListPage } from '../src/features/goals/GoalListPage.tsx';

// 固定版の本物の useSession / visibilitychange 再取得を使い、HTTP transport だけを合成する。
// Cookie・認証サーバー・DBを使う別タブE2Eではない。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transport = (globalThis as typeof globalThis & { __sessionTransport: { owner: string; failure: '503' | 'network' | '429' | null; reads: number; writes: number; hold: boolean; held: (() => void)[] } }).__sessionTransport;
const observed: { owner: string | undefined; error: boolean; status: number | undefined; pending: boolean; refetching: boolean }[] = [];
let page = 'create';
const goal = (owner: string) => ({ id: owner, title: `${owner}-PRIVATE-GOAL`, unit: 'minutes', totalRequired: 100, sessionAmount: 10, initialProgress: 0, progressDone: 0, today: '2026-10-09', todayStatus: 'UNRECORDED', timezone: 'UTC', recordStartDate: '2026-09-01', hasLogs: false, questionPrior: { a: null, b: null }, answerRevision: 1 });
let resolveGoal: ((data: unknown) => void) | undefined;
let goalHold: Promise<unknown> | undefined;
goalsHttp.listGoals = () => goalHold ?? Promise.resolve([goal(transport.owner)]);
goalsHttp.createGoal = async () => { transport.writes++; throw new Error('unexpected auto-submit'); };
// 履歴はこのGoal form/session fixtureの対象外。足跡を未確認にし、未知のwrite検出は維持する。
todayHttp.listLogs = async () => { throw new TypeError('synthetic history unavailable in session fixture'); };
const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Screen() {
  const session = authClient.useSession();
  observed.push({ owner: session.data?.user.id, error: Boolean(session.error), status: session.error?.status, pending: session.isPending, refetching: session.isRefetching });
  return page === 'create' ? <GoalCreatePage /> : <GoalListPage />;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const settle = async () => { for (let i = 0; i < 10; i++) await act(tick); };
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const input = () => host.querySelector<HTMLInputElement>('#goal-title');
const setTitle = async (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input()!, value);
  input()!.dispatchEvent(new Event('input', { bubbles: true })); await tick();
});
// テスト時計だけを進め、固定版の5秒 focus throttleを越える。製品の設定は変更しない。
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
async function run() {
  await act(async () => { root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Screen /></QueryClientProvider>); await tick(); });
  await settle(); ensure(input(), 'actual Better Auth initial A session did not mount form');
  await setTitle('A-PRIVATE-DRAFT');
  transport.failure = '503'; await focus();
  ensure(observed.at(-1)?.owner === 'A' && observed.at(-1)?.error && !observed.at(-1)?.pending, '503 did not retain A data and expose session error');
  ensure(!input() && !host.textContent?.includes('A-PRIVATE'), '503 left A draft mounted');
  transport.failure = null; await focus();
  ensure(!observed.at(-1)?.error && input()?.value === '', 'same-A recovery restored discarded draft or stayed loading');
  const results = ['real visibility refetch 503 retains session A/error; same-A success opens a fresh form'];
  await setTitle('A-PRIVATE-DRAFT');
  transport.failure = 'network'; await focus();
  ensure(observed.at(-1)?.owner === 'A' && observed.at(-1)?.error && !input(), 'network failure did not mask draft');
  transport.owner = 'B'; transport.failure = null; await focus();
  ensure(observed.at(-1)?.owner === 'B' && !observed.at(-1)?.error && input()?.value === '', 'network failure→B recovery carried A draft');
  results.push('real visibility refetch network failure→B success opens a fresh form; no auto-submit');

  page = 'list';
  await act(async () => { root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Screen /></QueryClientProvider>); await tick(); }); await settle();
  ensure(host.textContent?.includes('B-PRIVATE-GOAL'), 'initial B list missing');
  goalHold = new Promise((resolve) => { resolveGoal = resolve; });
  void client.refetchQueries({ queryKey: goalKeys.all }); await act(tick);
  transport.owner = 'A'; transport.hold = true; transport.failure = '429'; await focus();
  ensure(observed.at(-1)?.owner === 'B' && observed.at(-1)?.refetching && !observed.at(-1)?.pending && !observed.at(-1)?.error, 'fixed client did not retain B while refetching');
  await act(async () => { resolveGoal!([goal('A')]); await tick(); }); await settle();
  ensure(!host.textContent?.includes('-PRIVATE-GOAL'), 'session refetching allowed a fresh foreign Goal response');
  transport.hold = false; transport.held.splice(0).forEach(resolve => resolve()); await settle();
  ensure(observed.at(-1)?.status === 429 && !host.textContent?.includes('-PRIVATE-GOAL'), '429 did not keep the gate closed');
  goalHold = undefined; transport.failure = null; await focus();
  ensure(host.textContent?.includes('A-PRIVATE-GOAL') && !host.textContent?.includes('B-PRIVATE'), '429→A recovery did not use a fresh A query');
  results.push('real visibility refetch retains B/isRefetching; foreign response and 429 masked; A recovery');

  transport.hold = true; await focus();
  ensure(observed.at(-1)?.owner === 'A' && observed.at(-1)?.refetching, 'same-owner check not pending');
  // 確認中の業務応答は所有者が分からない。同じAで回復してもこのcacheを再利用しない。
  await act(async () => { client.setQueryData(goalKeys.list(), [goal('B')]); await tick(); });
  ensure(!host.textContent?.includes('-PRIVATE-GOAL'), 'same-owner pending check exposed unbound data');
  transport.hold = false; transport.held.splice(0).forEach(resolve => resolve()); await settle();
  ensure(host.textContent?.includes('A-PRIVATE-GOAL') && !host.textContent?.includes('B-PRIVATE'), 'same-owner recovery reused data received during checking');
  results.push('same-A refetch masks and discards data received during checking before reopening');
  ensure(transport.writes === 0, 'unexpected private write');
  await act(async () => root.unmount()); client.clear(); Date.now = realNow;
  return { results, reads: transport.reads, writes: transport.writes };
}
run().then((result) => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result }); }).catch((error) => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: error.stack ?? String(error) });
});
