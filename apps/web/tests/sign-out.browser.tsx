import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from '../src/router.tsx';
import { goalsHttp } from '../src/api/goals-http.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { authClient } from '../src/auth/client.ts';

// 実SDK・AccountMenu・router。HTTP応答だけ合成し、実DB/Cookieの受入とは区別する。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transport = (globalThis as any).__sessionTransport;
const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
goalsHttp.listGoals = async () => [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const settle = async () => { for (let i = 0; i < 15; i++) await act(tick); };
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const logoutButton = () => [...host.querySelectorAll<HTMLButtonElement>('dialog button')].find((button) => button.textContent?.includes('ログアウト'));

async function run() {
  transport.allowSignOut = true;
  transport.signOutFailure = true;
  transport.signOutHold = true;
  await act(async () => { root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><RouterProvider router={router} /></QueryClientProvider>); await tick(); });
  await act(async () => { void router.navigate({ to: '/goals' }); await tick(); }); await settle();
  await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(); await tick(); });
  ensure(logoutButton() && !logoutButton()!.disabled, 'logout must initially be available');
  await act(async () => { logoutButton()!.click(); await tick(); });
  ensure(logoutButton()!.disabled && logoutButton()!.getAttribute('aria-busy') === 'true', 'logout is not busy while pending');
  await act(async () => { logoutButton()!.click(); await tick(); });
  ensure(transport.signOutCalls === 1, 'busy click duplicated the request');
  await act(async () => { transport.signOutHold = false; transport.signOutHeld.splice(0).forEach((release: () => void) => release()); await tick(); }); await settle();
  ensure(router.state.location.pathname === '/goals', '503 navigated as if logout succeeded');
  ensure(host.querySelector('[role="alert"]')?.textContent?.includes('ログアウトを確認できませんでした'), '503 did not show the recovery message');
  ensure(!logoutButton()!.disabled && !logoutButton()!.hasAttribute('aria-busy'), '503 did not release busy for retry');
  ensure(authClient.$store.atoms.session.get().data?.user.id === 'A', '503 cleared the SDK session as if successful');
  ensure(transport.signOutCalls === 1, 'failure was retried automatically');
  transport.signOutFailure = false;
  await act(async () => { logoutButton()!.click(); await tick(); }); await settle();
  ensure(transport.signOutCalls === 2, 'explicit retry did not issue exactly one request');
  ensure(router.state.location.pathname === '/login', 'successful retry did not navigate to login');
  ensure(authClient.$store.atoms.session.get().data === null, 'successful retry kept the SDK session');
  await act(async () => root.unmount()); client.clear();
  return { signOutCalls: transport.signOutCalls, writes: transport.writes, failureKeepsSession: true, explicitRetryNavigates: true };
}
run().then((result) => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result }); }).catch((error) => {
  document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: String(error.stack ?? error) });
});
