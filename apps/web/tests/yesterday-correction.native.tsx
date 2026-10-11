import { StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authClient } from '../src/auth/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { goalsHttp } from '../src/api/goals-http.ts';
import { todayHttp } from '../src/api/today-http.ts';
import { TodayPage } from '../src/features/today/TodayPage.tsx';

// 実TodayPageのview/edit key切替と実取得・保存hookをnative操作で検査。
// HTTP応答・利用者だけ合成する。PUTは観測して失敗させ、実API/DBの証跡とは分ける。
let client: QueryClient | undefined;
let generation = 0;
let puts = 0;
const pageErrors: string[] = [];
window.addEventListener('error', event => { pageErrors.push(String(event.error?.stack ?? event.message).slice(0, 3000)); });
export function mountYesterdayCorrection(root: Root, status: 'DONE' | 'SKIPPED') {
  const owner = 'native-yesterday-correction-owner';
  const session = { data: { user: { id: owner } }, isPending: false, isRefetching: false, error: null };
  authClient.useSession = () => session as any;
  const logs = Array.from({ length: 28 }, (_, i) => {
    const localDate = new Date(Date.UTC(2026, 8, 12 + i)).toISOString().slice(0, 10);
    return i % 2 === 0 || (i === 27 && status === 'SKIPPED')
      ? { localDate, status: 'SKIPPED', amount: null }
      : { localDate, status: 'DONE', amount: 30 };
  });
  const done = logs.reduce((sum, log) => sum + (log.amount ?? 0), 0);
  const goal = { id: 'native-yesterday-goal', title: '昨日取消focus回帰', unit: 'minutes', totalRequired: 16600, sessionAmount: 30,
    initialProgress: 0, timezone: 'Asia/Tokyo', recordStartDate: '2026-09-10', hasLogs: true, unitLocked: false,
    goalSettingsRevision: 0, today: '2026-10-10', todayStatus: 'UNRECORDED', progressDone: done, targetDate: null,
    schemaVersion: 'r11-v1', questionPrior: { a: null, b: null }, answerRevision: 0 };
  const today = { today: goal.today, yesterday: '2026-10-09', todayLog: null, yesterdayMissing: false, schemaVersion: 'r11-v1',
    prediction: { modelVersion: 'm1-question-prior-v1', today: goal.today, todayStatus: goal.todayStatus,
      progress: { done, total: goal.totalRequired, completed: false },
      observations: { nDD: 0, nDS: 13, nSD: 14, nSS: 0, effectiveTransitions: 27, observedDays: 28, recordedDays: 28 },
      posterior: { a: { alpha: 2, beta: 15 }, b: { alpha: 16, beta: 2 } }, coreMetric: { status: 'available', g50: 1, g80: 1 },
      completion: { status: 'available', scenario: 'TODAY_DONE', p50Days: 1070, p80Days: null }, config: { samples: 200, horizonDays: 1095, seed: 20261012 } },
    context: { recordStartDate: goal.recordStartDate, unit: goal.unit, sessionAmount: goal.sessionAmount, goalSettingsRevision: 0, answerRevision: 0, unitLocked: false },
    provenance: { a: 'RECORDS', b: 'RECORDS' }, plan: null };
  goalsHttp.getGoal = async () => goal as never;
  todayHttp.getToday = async () => today as never;
  todayHttp.listLogs = async () => logs as never;
  todayHttp.putLog = async () => { puts++; throw new Error('native cancellation must not PUT'); };
  client?.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  puts = 0;
  flushSync(() => root.render(<StrictMode><QueryClientProvider client={client!} key={++generation}>
    <PrivateCacheGuard /><TodayPage goalId={goal.id} />
  </QueryClientProvider></StrictMode>));
}
export function yesterdayCorrectionState(host: HTMLElement) {
  return { correctionVisible: !!host.querySelector('#fr-yesterday-correct-title'),
    correctionSummary: !!host.querySelector('.fr-yesterday--summary button'),
    correctionInput: host.querySelector<HTMLInputElement>('.fr-yesterday input')?.value,
    puts, pageErrors: [...pageErrors], appText: host.textContent?.slice(0, 400) };
}
