import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '../src/auth/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { goalKeys } from '../src/api/goals-http.ts';
import { TodayPage } from '../src/features/today/TodayPage.tsx';
import { buildR11Today } from '../../api/src/prediction/r11.ts';

// 実TodayPage・取得/保存hook・HTTP/schemaを動かす。owner・clock・transportだけ合成する。
// PUTは送信先を観測して503で止めるため、実DB保存・実認証E2Eとは区別する。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const session = { data: { user: { id: 'yesterday-test-owner' } }, isPending: false, isRefetching: false, error: null };
authClient.useSession = () => session as any;
const RealDate = Date;
let clock = RealDate.parse('2026-10-10T12:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...args: any[]) { super(...(args.length ? args : [clock]) as [any]); }
  static now() { return clock; }
} as DateConstructor;
let day = '2026-10-10';
const id = 'yesterday-test-goal';
const recordStartDate = '2026-10-01';
const goal = () => ({
  id, title: 'Yesterday date boundary', unit: 'minutes', totalRequired: 100,
  sessionAmount: 10, initialProgress: 20, progressDone: 20, timezone: 'UTC',
  recordStartDate, hasLogs: false, unitLocked: true, goalSettingsRevision: 7,
  today: day, todayStatus: 'UNRECORDED', targetDate: null, schemaVersion: 'r11-v1',
  questionPrior: { a: null, b: null }, answerRevision: 0,
});
// 合成DB snapshotを実APIの純粋変換へ渡す。Today契約のfieldsをテスト側で複製しない。
// DB・HTTPは呼ばず、回答なし/実ログなしのEngine入力から現行context・planを得る。
const today = () => buildR11Today({
  goal: { ...goal(), unit: 'minutes' },
  question: { question_prior: { a: null, b: null }, answer_revision: '0', question_prior_snapshot: null },
  logs: [], now: new RealDate(clock),
});
const writes: { path: string; body: any; day: string }[] = [];
const reads: { path: string; day: string }[] = [];
globalThis.fetch = async (request, init) => {
  const raw = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  const url = new URL(raw, location.href);
  const method = init?.method ?? 'GET';
  if (method === 'PUT' && url.pathname.startsWith(`/api/goals/${id}/logs/`)) {
    writes.push({ path: url.pathname, body: JSON.parse(String(init?.body)), day });
    return Response.json({ error: { code: 'SYNTHETIC_TRANSPORT_STOP', message: 'capture only' } }, { status: 503 });
  }
  if (method !== 'GET') throw new Error(`unexpected write: ${method} ${url.pathname}`);
  reads.push({ path: url.pathname, day });
  if (url.pathname === `/api/goals/${id}`) return Response.json(goal());
  if (url.pathname === `/api/goals/${id}/today`) return Response.json(today());
  if (url.pathname === `/api/goals/${id}/logs`) return Response.json([]);
  throw new Error(`unexpected GET: ${url.pathname}`);
};
const host = document.getElementById('app')!;
const root = createRoot(host);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const settle = async () => { for (let i = 0; i < 10; i++) await act(tick); };
const ensure = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const area = () => host.querySelector('.fr-yesterday');
const input = () => area()?.querySelector<HTMLInputElement>('input');
const view = () => ({ date: area()?.querySelector('.fr-yesterday__date')?.textContent, amount: input()?.value ?? null, day });
const clickText = async (text: string) => act(async () => {
  const button = [...(area()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(b => b.textContent?.trim() === text);
  ensure(button, `button absent: ${text}`);
  button!.click(); await tick();
});
const enterAmount = async (amount: string) => act(async () => {
  const target = input(); ensure(target, 'amount editor absent');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, amount);
  target!.dispatchEvent(new Event('input', { bubbles: true })); await tick();
});
let client: QueryClient;
const prepare = async () => {
  await act(async () => { root.render(null); await tick(); });
  if (client) client.clear();
  day = '2026-10-10'; clock = RealDate.parse(day + 'T12:00:00Z');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><TodayPage goalId={id} /></QueryClientProvider>);
    await tick();
  });
  await settle(); ensure(area(), 'YesterdayPrompt absent');
  await clickText('量を変更'); await settle();
  ensure(input()?.value === '10', 'initial amount must equal sessionAmount10');
  await enterAmount('37'); ensure(input()?.value === '37', '37 draft not entered');
};
const refetch = async () => {
  await act(async () => { await client.invalidateQueries({ queryKey: goalKeys.all }); await tick(); });
  await settle();
};
const results: unknown[] = [];
async function run() {
  await prepare();
  const sameDayBefore = view(), sameInput = input(), readsBefore = reads.length;
  clock += 1_000; await refetch();
  ensure(reads.length === readsBefore + 3, 'same-day control must refetch Goal/Today/logs');
  ensure(input() === sameInput && input()?.value === '37', 'same-day refetch lost draft');
  await clickText('この量で記録'); await settle();
  ensure(writes.length === 1 && writes[0].path.endsWith('/2026-10-09') && writes[0].body.amount === 37, 'same-day save changed date or amount');
  results.push({ name: 'same-day refetch preserves draft', before: sameDayBefore, request: writes[0] });

  await prepare();
  const rolloverBefore = view(), oldInput = input(), beforeWrites = writes.length, beforeReads = reads.length;
  day = '2026-10-11';
  clock = RealDate.parse(day + 'T12:00:00Z');
  await refetch();
  const rolloverAfter = view();
  ensure(reads.length === beforeReads + 3, 'next-day control must refetch Goal/Today/logs');
  ensure(rolloverAfter.date?.includes('10日'), 'new yesterday header absent');
  ensure(!input(), 'date change retained old amount: ' + JSON.stringify({ before: rolloverBefore, after: rolloverAfter }));
  ensure(!oldInput?.isConnected, 'old draft input remains attached');
  ensure(writes.length === beforeWrites, 'date change automatically saved draft');
  results.push({ name: 'date change discards old draft without writing', before: rolloverBefore, after: rolloverAfter });

  await clickText('量を変更'); await settle();
  ensure(input()?.value === '10', 'new yesterday reused37 instead of initial10');
  await enterAmount('41');
  await clickText('この量で記録');
  await settle();
  const request = writes.at(-1)!;
  ensure(writes.length === beforeWrites + 1 && request.path.endsWith('/2026-10-10') && request.body.amount === 41 && request.body.expectedGoalSettingsRevision === 7, 'explicit new-day input sent wrong payload');
  results.push({ name: 'new yesterday saves only explicitly entered amount', request });
  await act(async () => { root.unmount(); await tick(); }); client.clear();
  document.getElementById('result')!.textContent = JSON.stringify({ ok: true, results, writes, reads, recordStartDate });
}
run().catch(error => { document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: String(error?.stack ?? error), results, view: view(), writes, reads }); });
