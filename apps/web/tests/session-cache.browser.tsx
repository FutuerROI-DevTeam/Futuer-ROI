import { act, useLayoutEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '../src/auth/client.ts';
import { ApiError } from '../src/api/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { goalKeys, goalsHttp } from '../src/api/goals-http.ts';
import { todayKeys, todayHttp } from '../src/api/today-http.ts';
import { GoalListPage } from '../src/features/goals/GoalListPage.tsx';
import { GoalCreatePage, GoalEditPage } from '../src/features/goals/GoalFormPage.tsx';
import { TodayPage } from '../src/features/today/TodayPage.tsx';
import { HistoryPage } from '../src/features/history/HistoryPage.tsx';

// 認証の transport だけを制御する。製品の guard・画面・hook・QueryClient を実DOMで動かす。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let simulateMissing = false;
let missingReads = 0;
const refetch = async () => {
  if (!simulateMissing) return;
  missingReads++;
  if (missingReads > 3) return; // 未修正のループでもrunnerを止め、回数のassertを失敗させる。
  publish(null, false, true);
  await tick();
  publish(null);
};
let session = { data: { user: { id: 'A', email: 'A@example.invalid' } }, isPending: false, isRefetching: false, error: null, refetch };
const listeners = new Set<() => void>();
authClient.useSession = () => useSyncExternalStore((fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
}, () => session);
const publish = (owner: string | null, error = false, pending = false, refetching = false) => {
  session = { data: owner ? { user: { id: owner, email: `${owner}@example.invalid` } } : null, isPending: pending, isRefetching: refetching, error: error ? new Error('synthetic session failure') : null, refetch };
  listeners.forEach((fn) => fn());
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const goal = (owner: string) => ({
  id: 'shared-test-id', title: `${owner}-PRIVATE-GOAL`, unit: 'minutes', totalRequired: 100, sessionAmount: 10,
  initialProgress: 0, progressDone: 0, timezone: 'UTC', recordStartDate: '2026-09-01', hasLogs: false,
  today: '2026-10-09', todayStatus: 'UNRECORDED', questionPrior: owner === 'A' ? { a: 'HIGH', b: 'LOW' } : { a: null, b: null }, answerRevision: 1,
});
let listHold: ReturnType<typeof deferred> | null = null;
let detailHold: ReturnType<typeof deferred> | null = null;
let logsHold: ReturnType<typeof deferred> | null = null;
let foreignGoal = false;
const writes: unknown[] = [];
function deferred() {
  let resolve!: (value: unknown) => void;
  return { promise: new Promise((r) => { resolve = r; }), resolve, aborted: false };
}
function read(hold: ReturnType<typeof deferred> | null, value: unknown, signal?: AbortSignal) {
  if (!hold) return Promise.resolve(value);
  // 敢えて応答を abort 後にも解放する。Query 側の cancel で結果が破棄されることも確認する。
  signal?.addEventListener('abort', () => { hold.aborted = true; });
  return hold.promise;
}
goalsHttp.listGoals = (signal) => read(session.data?.user.id === 'A' ? listHold : null, [goal(session.data?.user.id ?? 'NONE')], signal);
goalsHttp.getGoal = (_, signal) => foreignGoal && session.data?.user.id === 'B'
  ? Promise.reject(new ApiError(404, { error: { code: 'NOT_FOUND', message: 'synthetic foreign goal' } }))
  : read(session.data?.user.id === 'A' ? detailHold : null, goal(session.data?.user.id ?? 'NONE'), signal);
goalsHttp.createGoal = async (body) => { writes.push(body); return goal(session.data?.user.id ?? 'NONE'); };
// Today は失敗時の Goal fallback も私的データを持つため、その表示・操作を実際に通す。
todayHttp.getToday = async () => { throw new Error('synthetic Today failure'); };
const historyLogs = (owner: string) => [{ goalId: 'shared-test-id', localDate: '2026-10-09', status: owner === 'A' ? 'DONE' : 'SKIPPED', amount: owner === 'A' ? 11 : null }];
todayHttp.listLogs = (_, signal) => read(session.data?.user.id === 'A' ? logsHold : null, page === 'history' ? historyLogs(session.data?.user.id ?? 'NONE') : [], signal);
todayHttp.putLog = async (...args) => { writes.push(args); throw new Error('unexpected auto-submit'); };

const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const commits: { owner: string | null; text: string; input: string | undefined; calendar: string | undefined; title: string }[] = [];
const observe = (owner: string | null) => commits.push({ owner, text: host.textContent ?? '', input: host.querySelector<HTMLInputElement>('#goal-title')?.value,
  calendar: host.querySelector('.fr-history__cal li[aria-label^="10月9日"]')?.getAttribute('aria-label') ?? undefined, title: document.title });
const mutations = new MutationObserver(() => {
  observe(document.getElementById('owner')?.textContent ?? null);
});
mutations.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
let page = 'list';
function Screen() {
  const current = authClient.useSession();
  useLayoutEffect(() => {
    observe(current.data?.user.id ?? null);
  });
  return <><output id="owner">{current.data?.user.id ?? 'NONE'}</output>{page === 'list' ? <GoalListPage /> : page === 'edit' ? <GoalEditPage goalId="shared-test-id" /> : page === 'create' ? <GoalCreatePage /> : page === 'history' ? <HistoryPage goalId="shared-test-id" /> : <TodayPage goalId="shared-test-id" />}</>;
}
const render = async () => act(async () => {
  root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Screen /></QueryClientProvider>);
  await tick();
});
const settle = async () => { for (let i = 0; i < 4; i++) await act(tick); };
const change = async (owner: string | null, error = false, pending = false) => {
  await act(async () => {
    publish(owner, error, pending);
    await tick();
  });
  await settle();
};
const input = () => host.querySelector<HTMLInputElement>('#goal-title');
const setTitle = async (value: string) => act(async () => {
  const target = input()!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, value);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
});
const noA = (label: string, from: number) => {
  for (const commit of commits.slice(from)) {
    if (commit.owner === 'B') ensure(!commit.text.includes('A-PRIVATE') && !commit.input?.includes('A-PRIVATE'), `${label}: B commit contains A data/draft`);
  }
  ensure(!host.textContent?.includes('A-PRIVATE') && !input()?.value.includes('A-PRIVATE'), `${label}: A remains in DOM`);
};

async function run() {
  const results: string[] = [];
  await render(); await settle();
  ensure(host.textContent?.includes('A-PRIVATE-GOAL'), 'list fixture was not displayed');
  const heldList = listHold = deferred();
  void client.refetchQueries({ queryKey: goalKeys.list() }); await act(tick);
  let from = commits.length;
  await change('B'); noA('direct switch/list', from);
  listHold = null;
  heldList.resolve([goal('A')]);
  await settle();
  noA('late A/list', from); ensure(heldList.aborted, 'list A request was not cancelled');
  ensure(host.textContent?.includes('B-PRIVATE-GOAL'), 'B list did not recover');
  results.push('direct session A→B: every commit + late A list response');

  await change('A');
  page = 'edit';
  await render();
  await settle();
  ensure(input()?.value === 'A-PRIVATE-GOAL', 'edit fixture was not initialized');
  ensure([...host.querySelectorAll<HTMLInputElement>('.r11-qp input:checked')].map((el) => el.value).join(',') === 'HIGH,LOW', 'A answers fixture missing');
  await setTitle('A-PRIVATE-DRAFT'); ensure(input()?.value === 'A-PRIVATE-DRAFT', 'edit draft missing');
  const heldDetail = detailHold = deferred();
  void client.refetchQueries({ queryKey: goalKeys.detail('shared-test-id') }); await act(tick);
  from = commits.length;
  await change('B'); noA('direct switch/edit', from);
  detailHold = null;
  heldDetail.resolve(goal('A'));
  await settle();
  noA('late A/edit', from); ensure(heldDetail.aborted, 'detail A request was not cancelled');
  ensure(input()?.value === 'B-PRIVATE-GOAL', 'B edit initialized from stale data');
  ensure([...host.querySelectorAll<HTMLInputElement>('.r11-qp input:checked')].every((el) => el.value === ''), 'B edit retained A answers');
  ensure(writes.length === 0, 'switch auto-submitted a draft');
  results.push('edit baseline/answers/draft reset + late A detail response; no auto-submit');

  page = 'create';
  await render();
  await setTitle('A-PRIVATE-CREATE-DRAFT');
  await change(null); ensure(!input(), 'logout retained create form');
  ensure(host.querySelector('a[href="/login"]') && !host.querySelector('[role="status"]'), 'logout/create never reached sign-in UI');
  await change('B'); ensure(input()?.value === '', 'logout→B carried create draft');
  results.push('explicit logout→B: create draft discarded and sign-in UI displayed');

  for (const mountedPage of ['list', 'edit', 'today', 'history']) {
    page = mountedPage;
    await render();
    await settle();
    await change('A'); await change(null);
    ensure(!input() && !host.textContent?.includes('A-PRIVATE'), `logout/${page} exposed A`);
    ensure(host.querySelector('a[href="/login"]') && !host.querySelector('[role="status"]'), `logout/${page} never reached sign-in UI`);
    await change('B'); await settle();
    ensure(host.textContent?.includes('B-PRIVATE-GOAL') || input()?.value === 'B-PRIVATE-GOAL', `logout/${page}→B did not recover`);
  }
  results.push('mounted list/edit/Today/history logout: sign-in UI without disabled-query loading; B recovery');
  page = 'create'; await render();

  await change('A');
  await setTitle('A-PRIVATE-CREATE-DRAFT');
  from = commits.length;
  await change('B');
  noA('same-tab/create', from);
  ensure(input()?.value === '', 'direct switch carried create draft');
  results.push('same-tab owner change: create draft discarded');

  page = 'today';
  await render();
  await settle();
  await change('A'); await settle();
  ensure(host.textContent?.includes('A-PRIVATE-GOAL'), 'Today error fallback fixture missing');
  from = commits.length;
  await change('B');
  noA('Today fallback', from);
  ensure(host.textContent?.includes('B-PRIVATE-GOAL'), 'Today B fallback missing');
  results.push('Today error fallback never displays previous owner');

  page = 'history';
  await change('A');
  await render();
  await settle();
  const aMark = host.querySelector('.fr-history__cal li[aria-label^="10月9日"]')?.getAttribute('aria-label');
  ensure(aMark?.includes('やった'), 'history A log fixture missing');
  await act(async () => { (host.querySelector('button[aria-label="前の月"]') as HTMLButtonElement).click(); await tick(); }); await settle();
  ensure(host.querySelector('h1')?.textContent?.includes('9月'), 'history month selection missing');
  const historyDetail = detailHold = deferred(); const historyLog = logsHold = deferred();
  void client.refetchQueries({ queryKey: goalKeys.detail('shared-test-id') });
  void client.refetchQueries({ queryKey: todayKeys.logs('shared-test-id') }); await act(tick);
  from = commits.length;
  await change('B');
  noA('history switch', from);
  detailHold = null;
  logsHold = null;
  historyDetail.resolve(goal('A'));
  historyLog.resolve(historyLogs('A'));
  await settle();
  noA('history late A goal/logs', from);
  ensure(historyDetail.aborted && historyLog.aborted, 'history A reads were not cancelled');
  ensure(host.querySelector('h1')?.textContent?.includes('10月'), 'history retained A selected month');
  for (const commit of commits.slice(from).filter(c => c.owner === 'B')) ensure(!commit.calendar?.includes('やった'), 'B calendar displayed A DONE log');
  ensure(host.querySelector('.fr-history__cal li[aria-label^="10月9日"]')?.getAttribute('aria-label')?.includes('休んだ'), 'history B logs missing');
  ensure(!document.title.includes('A-PRIVATE'), 'history document title retained A');
  results.push('history: late A detail/logs discarded, B marks/title and owner-specific month');

  await change('A');
  await change('A', true);
  ensure(!host.querySelector('.fr-history__cal'), 'history session error exposed calendar');
  await change('B'); ensure(host.querySelector('.fr-history__cal'), 'history session recovery failed');
  foreignGoal = true;
  await change('A');
  await change('B');
  await settle();
  ensure(!host.querySelector('.fr-history__cal') && !host.textContent?.includes('A-PRIVATE'), 'foreign goal kept A history');
  ensure(host.textContent?.includes('このGoalは開けません'), 'foreign history did not show 404');
  foreignGoal = false;
  await change('A');
  await change('B');
  await settle();
  results.push('history: session failure masking, B recovery, foreign Goal 404');

  page = 'edit';
  await render();
  await settle();
  await change('A'); ensure(input()?.value === 'A-PRIVATE-GOAL', 'session recovery fixture missing');
  await change('A', true); ensure(!input() && !host.textContent?.includes('A-PRIVATE'), 'session failure exposed private state');
  from = commits.length;
  await change('B');
  noA('session failure recovery', from);
  ensure(input()?.value === 'B-PRIVATE-GOAL', 'session failure→B did not recover');
  results.push('session transport failure→B recovery: private form masked');

  await change('A', false, true); ensure(!input(), 'pending session exposed form');
  await change('B'); ensure(input()?.value === 'B-PRIVATE-GOAL', 'pending→B did not recover');
  results.push('pending→B blocks old state');

  // 2つの cancel 完了を逆順に解放し、古い A→B の完了で A→B→A の gate を開かない。
  const originalCancel = client.cancelQueries.bind(client);
  const cancelHolds: ReturnType<typeof deferred>[] = [];
  client.cancelQueries = (...args) => {
    void originalCancel(...args);
    const hold = deferred();
    cancelHolds.push(hold);
    return hold.promise;
  };
  await change('A');
  await change('B');
  await change('A');
  ensure(!input(), 'rapid switches opened gate before latest cancellation');
  await act(async () => { cancelHolds[0].resolve(undefined); await tick(); });
  ensure(!input(), 'stale cancellation completion opened gate');
  await act(async () => { cancelHolds.at(-1)!.resolve(undefined); await tick(); }); await settle();
  ensure(input()?.value === 'A-PRIVATE-GOAL', 'latest cancellation did not recover A');
  client.cancelQueries = originalCancel;
  cancelHolds.forEach((hold) => hold.resolve(undefined));
  ensure(writes.length === 0, 'owner transitions sent private writes');
  results.push('A→B→A: outdated cancellation cannot reopen gate');

  page = 'list';
  await render();
  await change('B');
  await settle();
  simulateMissing = true;
  await change(null);
  await settle();
  ensure(missingReads === 1, 'AccountMenu retried null→pending→null more than once');
  await change('B');
  await change(null);
  await settle();
  ensure(missingReads === 2, 'new signed-in→missing episode did not retry exactly once');
  simulateMissing = false;
  results.push('AccountMenu: missing session recovery once per episode; no null/pending loop');

  await act(async () => root.unmount());
  client.clear();
  mutations.disconnect();
  return { results, commits: commits.length, writes: writes.length };
}
run().then((result) => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result });
}).catch((error) => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: error.stack ?? String(error) });
});
