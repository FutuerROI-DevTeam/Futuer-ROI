import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { router } from '../src/router.tsx';
import { goalsHttp } from '../src/api/goals-http.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { appCopy } from '../src/copy/app.ts';
import { NotFoundPage, RouteErrorPage } from '../src/routes/RouteStates.tsx';

// ルートの移動と既定の画面（#146 完了条件②）を、実router・実SDKで検査する。
// ログインの確認（/api/auth/get-session）とGoal一覧の取得だけを合成し、実DB/Cookieの受入とは区別する。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transport = (globalThis as any).__sessionTransport;
const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let listCalls = 0;
goalsHttp.listGoals = async () => { listCalls++; return []; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const settle = async () => { for (let i = 0; i < 20; i++) await act(tick); };
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const path = () => router.state.location.pathname;
const text = () => host.textContent ?? '';
// 読み込みの完了を待つ（ルーターの確認・読込中の表示を挟むため、条件が満たされるまで最大3秒）
const until = async (done: () => boolean) => { for (let i = 0; i < 600 && !done(); i++) await act(tick); };
const go = async (to: string) => { await act(async () => { void router.navigate({ to } as never); await tick(); }); await settle(); };
const results: string[] = [];
const c = appCopy;

async function run() {
  // 未ログイン（get-session が session なしを返す）
  transport.allowSignOut = true;
  transport.owner = null;
  await act(async () => { root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><RouterProvider router={router} /></QueryClientProvider>); await tick(); });
  await settle();
  ensure(path() === '/', 'public top did not render without login');
  await go('/goals/goal-123/history');
  ensure(path() === '/login', 'signed-out user reached a private route: ' + path());
  ensure((router.state.location.search as { redirect?: string }).redirect === '/goals/goal-123/history', 'login did not keep the original URL as the return target');
  ensure(listCalls === 0, 'private data was requested before login');
  results.push('signed-out: private route redirects to login with the original URL and fetches nothing');

  // ログイン済みで /login を開くと、戻り先へ移り、履歴を置き換える（「戻る」でログイン画面へ戻らない）
  transport.owner = 'A';
  await go('/');
  await act(async () => { void router.navigate({ to: '/login', search: { redirect: '/goals' } } as never); await tick(); }); await settle();
  ensure(path() === '/goals', 'signed-in user stayed on login: ' + path());
  ensure(listCalls > 0, 'goal list did not load after redirect');
  await act(async () => { router.history.back(); await tick(); }); await settle();
  ensure(path() === '/', 'back after the login redirect returned to the login page: ' + path());
  results.push('signed-in: /login redirects to the return target with replace (back skips login)');

  // 通信の失敗（例外・503）は未ログインと取り違えず、「接続できませんでした」を出してログインへ送らない
  for (const failure of ['network', '503']) {
    transport.failure = failure;
    await go('/goals/new');
    ensure(path() === '/goals/new', failure + ': unreachable session moved to ' + path());
    ensure(text().includes(c.error.unreachableTitle) && text().includes(c.error.unreachable), failure + ': unreachable message missing');
    ensure(!text().includes(c.error.title), failure + ': generic error shown instead of unreachable');
    // 回復したら「再読み込み」でログインの確認からやり直し、画面が出る
    transport.failure = null;
    const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(c.error.retry));
    ensure(retry, failure + ': retry button missing');
    await act(async () => { retry!.click(); await tick(); });
    await until(() => !text().includes(c.error.unreachableTitle) && !host.querySelector('[role="status"]'));
    ensure(path() === '/goals/new' && !text().includes(c.error.unreachableTitle), failure + ': retry did not recover: ' + path() + ' | reads=' + transport.reads + ' | ' + text().slice(0, 120));
    await go('/');
  }
  results.push('unreachable (network/503): stays on the URL with the connection message and recovers by retry');

  // 定義していないURLは日本語の404（英語の Not Found を出さない）
  await go('/no-such-page');
  ensure(text().includes(c.notFound.title) && text().includes(c.notFound.body), '404 page missing');
  ensure(!/Not Found/.test(text()), 'English Not Found was shown');
  ensure(host.querySelector('a[href="/goals"]'), '404 has no way back to the goal list');
  results.push('unknown URL: Japanese 404 with a link back to the goal list');

  // ルーター全体の既定の画面が、この404・エラーの部品になっている
  ensure(router.options.defaultNotFoundComponent === NotFoundPage && router.options.defaultErrorComponent === RouteErrorPage, 'router defaults are not the app route states');
  // 一般のエラー（ログイン確認以外の失敗）は「接続できませんでした」と区別して表示する
  await act(async () => root.unmount());
  const failing = createRouter({
    routeTree: createRootRoute({ component: () => { throw new Error('synthetic render failure'); } }),
    defaultErrorComponent: RouteErrorPage,
  });
  const root2 = createRoot(host);
  await act(async () => { root2.render(<QueryClientProvider client={client}><RouterProvider router={failing} /></QueryClientProvider>); await tick(); }); await settle();
  ensure(text().includes(c.error.title) && text().includes(c.error.body), 'generic error page missing');
  ensure(!text().includes(c.error.unreachable), 'generic error was shown as unreachable');
  results.push('generic route error: RouteErrorPage shows the general error, distinct from unreachable');
  await act(async () => root2.unmount()); client.clear();
  return { results, reads: transport.reads, writes: transport.writes, listCalls };
}
run().then((result) => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result }); }).catch((error) => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: String(error.stack ?? error) });
});
