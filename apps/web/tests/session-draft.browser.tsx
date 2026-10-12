import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from '../src/router.tsx';
import { authClient } from '../src/auth/client.ts';
import { getPrivateEpoch, PrivateCacheGuard, usePrivateEpoch } from '../src/api/session-cache.ts';
import { goalKeys, goalsHttp } from '../src/api/goals-http.ts';
import { todayHttp } from '../src/api/today-http.ts';
import { ApiError } from '../src/api/client.ts';

// 実SDK・実routerと画面を使う。HTTP/event/時計だけ制御し、実認証E2Eと区別する。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const transport = (globalThis as any).__sessionTransport;
const goal = (owner = transport.owner, revision = 1) => ({ id: 'goal', title: `${owner}-PRIVATE-GOAL`, unit: 'minutes', totalRequired: 100, sessionAmount: 10, initialProgress: 0, progressDone: 0, today: '2026-10-09', todayStatus: 'UNRECORDED', timezone: 'UTC', recordStartDate: '2026-09-01', hasLogs: false, questionPrior: { a: null, b: null }, answerRevision: revision, goalSettingsRevision: settingsRevision });
let revision = 1;
let settingsRevision = 1;
let saved: unknown[] = [];
const createWrites: { body: unknown; key: string; owner?: string }[] = [];
const recordCreate = (body: unknown, key: string, owner?: string) => { saved.push(body); createWrites.push({ body, key, owner }); };
let finishSave: ((data: any) => void) | undefined;
goalsHttp.listGoals = async () => [goal()];
goalsHttp.getGoal = async id => ({ ...goal(transport.owner, revision), id, ...(id !== 'goal' && { title: `${transport.owner}-PRIVATE-${id}` }) });
goalsHttp.createGoal = async (body, key, owner) => { recordCreate(body, key, owner); return new Promise(resolve => { finishSave = resolve; }); };
goalsHttp.updateGoal = async (_id, body) => { saved.push(body); return goal(); };
todayHttp.listLogs = async () => [{ goalId: 'goal', localDate: '2026-09-01', status: 'DONE', amount: 11 }, { goalId: 'goal', localDate: '2026-10-09', status: 'SKIPPED', amount: null }];
const host = document.getElementById('app')!;
const root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const captures: { checking: boolean; input: string | null; owner: string | undefined; text: string }[] = [];
let current: any;
function Diagnostic() {
  const session = authClient.useSession();
  const epoch = usePrivateEpoch();
  current = { owner: session.data?.user.id, error: session.error, pending: session.isPending, refetching: session.isRefetching, epoch };
  useLayoutEffect(() => { captures.push({ owner: current.owner, checking: current.pending || current.refetching || !!current.error,
    input: host.querySelector<HTMLInputElement>('#goal-title')?.value ?? null, text: host.textContent ?? '' }); });
  return null;
}
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const settle = async () => { for (let i = 0; i < 15; i++) await act(tick); };
const input = () => host.querySelector<HTMLInputElement>('#goal-title');
const totalMinutes = () => {
  const hours = host.querySelector<HTMLInputElement>('#goal-totalRequired');
  const minutes = host.querySelector<HTMLInputElement>('#goal-totalRequired-minutes');
  return minutes ? String(Number(hours?.value) * 60 + Number(minutes.value)) : hours?.value;
};
const values = () => ({ title: input()?.value, total: totalMinutes(), amount: host.querySelector<HTMLInputElement>('#goal-sessionAmount')?.value, month: host.querySelector('h1')?.textContent });
const set = async (selector: string, value: string) => act(async () => {
  const parts = selector === '#goal-totalRequired' && host.querySelector<HTMLInputElement>(selector + '-minutes');
  for (const [id, raw] of parts ? [[selector, String(Math.floor(Number(value) / 60))], [selector + '-minutes', String(Number(value) % 60)]] : [[selector, value]]) {
    const target = host.querySelector<HTMLInputElement>(id!)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, raw);
    target.dispatchEvent(new Event('input', { bubbles: true })); await tick();
  }
});
const navigate = async (to: string) => { await act(async () => { void router.navigate({ to }); await tick(); }); await settle(); };
// 初期質問は必須（#259）。両問で「回答しない」を選ぶ（押せない間は何もしない）
const choosePrior = async () => act(async () => {
  host.querySelectorAll<HTMLInputElement>('.r11-qp fieldset input[value=""]').forEach(radio => radio.click());
  await tick();
});
const click = async (selector: string) => act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); await tick(); });
const realNow = Date.now;
let advance = 0;
let visibility = 'visible';
Date.now = () => realNow() + advance;
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const visible = async (seconds: number) => act(async () => {
  advance += seconds * 1000;
  visibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await tick();
});
const release = async () => {
  transport.hold = false;
  transport.held.splice(0).forEach((resolve: () => void) => resolve());
  await settle();
};
async function prepare(page = 'create') {
  await act(async () => { window.dispatchEvent(new Event('online')); await tick(); }); await settle();
  const path = page === 'create' ? '/goals/new' : `/goals/goal/${page}`;
  await navigate(path);
  await visible(6);
  await settle();
  if (page === 'history') { await click('button[aria-label="前の月"]'); ensure(values().month?.includes('9月'), 'September not selected'); }
  else {
    ensure(input(), 'form not ready');
    await set('#goal-title', 'A-PRIVATE-UX-DRAFT');
    await set('#goal-totalRequired', '123');
    await set('#goal-sessionAmount', '17');
    await choosePrior();
    input()!.focus();
  }
  return path;
}
async function operation(label: string, action: (path: string) => Promise<unknown>, page = 'create') {
  const path = await prepare(page), before = values(), reads = transport.reads;
  transport.hold = true;
  await action(path);
  await settle();
  const didCheck = transport.reads > reads;
  if (didCheck) ensure(!input() && !host.querySelector('.fr-history__cal'), label + ': private DOM remained during check');
  await release(); const after = values();
  ensure(JSON.stringify(before) === JSON.stringify(after), label + ': same-owner draft/month lost');
  return { label, page, reads: transport.reads - reads, privateDomRemoved: didCheck };
}
async function run() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Diagnostic /><RouterProvider router={router} /></QueryClientProvider>);
    await tick();
  });
  await settle();
  const operations = [];
  operations.push(await operation('window focus without visibility change', async () => {
    advance += 6000;
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      await tick();
    });
  }));
  operations.push(await operation('hidden only', async () => {
    advance += 6000;
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await tick();
    });
  }));
  visibility = 'visible';
  operations.push(await operation('visible return within 5s', () => visible(0)));
  operations.push(await operation('visible return after 6s', () => visible(6)));
  operations.push(await operation('offline only', async () => act(async () => { window.dispatchEvent(new Event('offline')); await tick(); })));
  operations.push(await operation('online within 5s', async () => act(async () => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await tick();
  })));
  operations.push(await operation('online after 6s', async () => act(async () => {
    advance += 6000;
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await tick();
  })));
  operations.push(await operation('same path navigation', navigate));
  operations.push(await operation('search-only navigation', path => navigate(path + '?ux=1')));
  operations.push(await operation('router invalidate', async () => { await act(async () => { void router.invalidate(); await tick(); }); }));
  operations.push(await operation('edit visible return', () => visible(6), 'edit'));
  operations.push(await operation('history visible return', () => visible(6), 'history'));
  operations.push(await operation('edit same path navigation', navigate, 'edit'));
  operations.push(await operation('history same path navigation', navigate, 'history'));
  await prepare();
  await navigate('/');
  ensure(!input(), 'route leave did not unmount');
  await navigate('/goals/new');
  ensure(input()?.value === '', 'real route leave restored old draft');
  operations.push({ label: 'public route leave and return discards draft', page: 'create', reads: 1, privateDomRemoved: true });
  const safety = [];
  await prepare();
  transport.failure = '503';
  await visible(6);
  await settle();
  ensure(!input(), '503 exposed input');
  transport.failure = null;
  await visible(6);
  await settle();
  ensure(input()?.value === '', 'failure→A restored draft');
  safety.push('503→A loses old draft');
  await prepare('edit');
  const atom = authClient.$store.atoms.session!;
  const a = atom.get();
  await act(async () => {
    atom.set({ ...a, data: { ...a.data!, user: { ...a.data!.user, id: 'B' } } });
    client.setQueryData(goalKeys.detail('goal'), goal('B'));
    atom.set(a);
    await tick();
  });
  await settle();
  ensure(input()?.value === 'A-PRIVATE-GOAL' && !host.textContent?.includes('B-PRIVATE'), 'batched A→B→A restored draft or foreign query');
  safety.push('batched atom A→B→A invalidates draft and foreign query');
  await prepare('edit'); const stable = atom.get(), startedEpoch = getPrivateEpoch();
  await act(async () => {
    atom.set({ ...stable, isRefetching: true });
    ensure(getPrivateEpoch() !== startedEpoch, 'direct GET epoch remained valid during checking');
    client.setQueryData(goalKeys.detail('goal'), goal('B'));
    atom.set(stable);
    await tick();
  });
  await settle();
  ensure(input()?.value === 'A-PRIVATE-UX-DRAFT' && !host.textContent?.includes('B-PRIVATE'), 'batched normal confirmation lost draft or reused foreign query');
  safety.push('batched normal check keeps draft but resets foreign query/direct GET epoch');
  await prepare();
  const healthy = atom.get();
  await act(async () => {
    atom.set({ ...healthy, error: { status: 429, message: 'test' } as any });
    atom.set(healthy);
    await tick();
  });
  await settle();
  ensure(input()?.value === '', 'batched error→A restored draft');
  safety.push('batched 429→A invalidates draft');
  await prepare();
  await act(async () => {
    authClient.$store.notify('$sessionSignal');
    await tick();
  });
  await settle();
  ensure(input()?.value === '', 'auth signal restored draft');
  safety.push('auth operation signal invalidates same-owner draft');
  await prepare();
  const signedIn = atom.get();
  await act(async () => {
    atom.set({ ...signedIn, data: null });
    atom.set(signedIn);
    await tick();
  });
  await settle();
  ensure(input()?.value === '', 'batched signed-out→A restored draft');
  safety.push('batched signed-out→A invalidates draft');
  await prepare();
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'better-auth.message', newValue: JSON.stringify({ event: 'session', data: { trigger: 'signout' } }) }));
    await tick();
  });
  await settle();
  ensure(input()?.value === '', 'cross-tab notification restored draft');
  safety.push('cross-tab auth notification invalidates same-owner draft');
  await prepare('edit');
  revision = 2;
  transport.hold = true;
  await visible(6);
  await settle();
  await release();
  ensure(input()?.value === 'A-PRIVATE-GOAL' && values().total === '100' && host.textContent?.includes('未保存の入力は復元していません'), 'changed edit revision reused old draft/baseline or had no notice');
  safety.push('changed edit revision discards snapshot with notice');
  revision = 1;
  await prepare('edit');
  settingsRevision = 2;
  transport.hold = true;
  await visible(6);
  await settle();
  await release();
  ensure(input()?.value === 'A-PRIVATE-GOAL' && host.textContent?.includes('未保存の入力は復元していません'), 'changed settings revision reused old snapshot');
  safety.push('settings revision change discards snapshot even if values match');
  settingsRevision = 1;
  const pendingCreate = goalsHttp.createGoal;
  const recoverAttempt = async () => {
    const raw = sessionStorage.getItem('future-roi:create-attempt:A'); ensure(raw, 'explicit recovery has no A operation');
    const previous = JSON.parse(raw!); const before = saved.length;
    goalsHttp.createGoal = pendingCreate;
    ensure(input()?.disabled, 'unconfirmed operation was restored as an editable draft');
    await click('button[type="submit"]');
    await settle();
    ensure(saved.length === before + 1, 'explicit retry did not send once');
    const sent = createWrites.at(-1)!;
    ensure(sent.key === previous.key && sent.owner === previous.owner && JSON.stringify(sent.body) === JSON.stringify(previous.body), 'recovery changed operation key/body/owner');
    await act(async () => { finishSave!(goal()); await tick(); }); await settle();
    ensure(location.pathname === '/goals' && sessionStorage.getItem('future-roi:create-attempt:A') === null, 'confirmed explicit recovery did not end exactly A operation');
  };
  goalsHttp.createGoal = async (body, key, owner) => {
    recordCreate(body, key, owner);
    throw new ApiError(422, { error: { code: 'VALIDATION_ERROR', message: 'synthetic pre-commit rejection', fields: [{ path: 'body/title', message: 'invalid' }] } });
  };
  await prepare();
  await click('button[type="submit"]');
  await settle();
  await set('#goal-title', 'A-PRIVATE-CORRECTED');
  transport.hold = true;
  await visible(6);
  await settle();
  await release();
  ensure(input()?.value === 'A-PRIVATE-CORRECTED', 'corrected input after definitive 422 was lost');
  safety.push('definitive validation 422 then correction preserves idle input');
  goalsHttp.createGoal = async (body, key, owner) => { recordCreate(body, key, owner); throw new TypeError('synthetic unknown result'); };
  await prepare();
  await click('button[type="submit"]');
  await settle();
  await set('#goal-title', 'A-PRIVATE-UNKNOWN-CORRECTION');
  transport.hold = true;
  await visible(6);
  await settle();
  await release();
  ensure(input()?.value === 'A-PRIVATE-UX-DRAFT' && input()?.disabled, '175 result-unknown attempt was not frozen separately');
  safety.push('175 result-unknown attempt remains separate from normal draft');
  await recoverAttempt();
  await navigate('/');
  let failSave: ((reason: unknown) => void) | undefined;
  goalsHttp.createGoal = async (body, key, owner) => { recordCreate(body, key, owner); return new Promise((_resolve, reject) => { failSave = reject; }); };
  await prepare();
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await visible(6);
  await settle();
  await release();
  ensure(!input(), 'pending failure opened duplicate form');
  await act(async () => {
    failSave!(new TypeError('synthetic lost response'));
    await tick();
  });
  await settle();
  ensure(input()?.value === 'A-PRIVATE-UX-DRAFT' && input()?.disabled, '175 pending failure lost its separate attempt');
  safety.push('175 pending failure retains attempt without automatic replay');
  await recoverAttempt();
  await navigate('/');
  goalsHttp.createGoal = pendingCreate;
  await prepare();
  await click('button[type="submit"]');
  await settle();
  ensure(saved.length === 6 && input(), 'ordinary save unmounted or did not submit once');
  transport.hold = true;
  await visible(6);
  await settle();
  ensure(!input(), 'pending save visible during checking');
  await act(async () => {
    finishSave!(goal());
    await tick();
  });
  await settle();
  ensure(location.pathname === '/goals/new' && !input(), 'success navigated before same-owner confirmation');
  await release();
  ensure(location.pathname === '/goals' && !input() && saved.length === 6, 'confirmed success during checking returned a duplicate empty form');
  safety.push('confirmed create success during checking navigates once after same-owner recovery');
  ensure(sessionStorage.getItem('future-roi:create-attempt:A') === null, 'confirmed same-visit success retained completed operation');
  await navigate('/goals/new'); ensure(input()?.value === '' && !input()?.disabled && saved.length === 6, 'next new Goal reused completed operation');
  safety.push('confirmed success ends its operation and next new Goal is editable without storage reset');
  await prepare('edit');
  await click('button[type="submit"]');
  await settle();
  ensure(saved.length === 7, 'edit did not save once');
  const patch = saved[6] as any;
  ensure(patch.title === 'A-PRIVATE-UX-DRAFT' && patch.totalRequired === 123 && patch.sessionAmount === 17 && patch.expectedGoalSettingsRevision === 1 && patch.answerRevision === undefined, 'normal restored edit produced wrong patch');
  safety.push('explicit edit save uses original baseline and changed fields');
  const immediateEdit = goalsHttp.updateGoal; let finishEdit: ((data: any) => void) | undefined;
  goalsHttp.updateGoal = async (_id, body) => { saved.push(body); return new Promise(resolve => { finishEdit = resolve; }); };
  await prepare('edit');
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await visible(6);
  await settle();
  await act(async () => {
    finishEdit!(goal());
    await tick();
  });
  await settle();
  ensure(location.pathname === '/goals/goal/edit' && !input(), 'edit success navigated while checking');
  await release();
  ensure(location.pathname === '/goals', 'confirmed edit success was lost');
  safety.push('confirmed edit success during checking navigates after same-owner recovery');
  goalsHttp.updateGoal = immediateEdit;
  await prepare();
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await visible(6);
  await settle();
  await act(async () => {
    finishSave!(goal());
    await tick();
  });
  await settle();
  const beforeForeign = atom.get();
  await act(async () => {
    atom.set({ ...beforeForeign, data: { ...beforeForeign.data!, user: { ...beforeForeign.data!.user, id: 'B' } } });
    atom.set(beforeForeign);
    await tick();
  });
  await release();
  ensure(location.pathname === '/goals/new' && input()?.value === 'A-PRIVATE-UX-DRAFT' && input()?.disabled, 'A→B→A adopted old success or lost separate A operation');
  safety.push('batched A→B→A discards confirmed-success navigation and retains explicit A recovery');
  await recoverAttempt();
  await prepare();
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await visible(6);
  await settle();
  await act(async () => {
    finishSave!(goal());
    await tick();
  });
  await settle();
  transport.owner = 'B';
  await release();
  ensure(location.pathname === '/goals/new' && input()?.value === '', 'A success navigated B form');
  safety.push('foreign owner recovery never receives old success navigation');
  transport.owner = 'A';
  await visible(6);
  await settle();
  ensure(input()?.value === 'A-PRIVATE-UX-DRAFT' && input()?.disabled, 'A operation was lost during foreign owner recovery');
  await recoverAttempt();
  await prepare();
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await visible(6);
  await settle();
  await act(async () => {
    finishSave!(goal());
    await tick();
  });
  await settle();
  transport.failure = '429';
  await release();
  ensure(!input(), 'success bypassed failed session');
  transport.failure = null;
  await visible(6);
  await settle();
  ensure(location.pathname === '/goals/new' && input()?.value === 'A-PRIVATE-UX-DRAFT' && input()?.disabled, 'failed confirmation adopted success or lost separate operation');
  safety.push('session failure discards confirmed-success navigation and retains explicit recovery');
  await recoverAttempt();
  await prepare();
  await click('button[type="submit"]');
  await settle();
  await navigate('/');
  await act(async () => {
    finishSave!(goal());
    await tick();
  });
  await settle();
  ensure(location.pathname === '/', 'late success navigated after real page leave');
  await navigate('/goals/new');
  ensure(input()?.value === 'A-PRIVATE-UX-DRAFT' && input()?.disabled, 'page leave adopted outcome as a draft or lost operation');
  safety.push('real page leave discards late successful callback and retains explicit recovery');
  await recoverAttempt();
  await prepare();
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await act(async () => {
    void router.navigate({ to: '/goals/goal/history' });
    await tick();
  });
  await settle();
  ensure(location.pathname === '/goals/goal/history' && !input(), 'protected route leave did not begin checking');
  await act(async () => {
    finishSave!(goal());
    await tick();
  });
  await settle();
  await release();
  ensure(location.pathname === '/goals/goal/history' && !!host.querySelector('.fr-history__cal'), 'late success overrode pending protected navigation');
  safety.push('pending protected page leave cannot be overridden by old success');
  await navigate('/goals/new');
  await recoverAttempt();
  goalsHttp.updateGoal = async (_id, body) => { saved.push(body); return new Promise(resolve => { finishEdit = resolve; }); };
  await prepare('edit');
  await click('button[type="submit"]');
  await settle();
  await navigate('/goals/goal2/edit');
  ensure(location.pathname === '/goals/goal2/edit' && router.state.matches.at(-1)?.params.goalId === 'goal2', 'second Goal edit route did not commit');
  await navigate('/goals/goal/edit'); ensure(location.pathname === '/goals/goal/edit' && !input(), 'return did not wait for original pending edit');
  await act(async () => { finishEdit!(goal()); await tick(); }); await settle();
  ensure(location.pathname === '/goals/goal/edit' && input()?.value === 'A-PRIVATE-GOAL', 'Goal1→Goal2→Goal1 adopted old visit successful callback');
  safety.push('same-owner Goal1→Goal2→Goal1 discards old visit successful callback');
  await prepare('edit');
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await navigate('/goals/goal2/edit'); ensure(router.state.matches.at(-1)?.params.goalId === 'goal', 'held route unexpectedly committed second Goal');
  await navigate('/goals/goal/edit');
  await release();
  ensure(!input(), 'return while pending edit reopened a form');
  await act(async () => { finishEdit!(goal()); await tick(); }); await settle();
  ensure(location.pathname === '/goals/goal/edit' && input()?.value === 'A-PRIVATE-GOAL', 'uncommitted Goal1→Goal2→Goal1 reused old successful callback');
  safety.push('pending Goal2 navigation then Goal1 return discards old visit callback before param commit'); goalsHttp.updateGoal = immediateEdit;

  // These cases continue in the same browser session; no direct storage reset.
  await prepare();
  await click('button[type="submit"]');
  await settle();
  transport.hold = true;
  await visible(6);
  await settle();
  const k1 = JSON.parse(sessionStorage.getItem('future-roi:create-attempt:A')!);
  const k2 = { ...k1, key: crypto.randomUUID(), body: { ...k1.body, title: 'A-PRIVATE-K2' } }; const k2raw = JSON.stringify(k2);
  const other = JSON.stringify({ ...k1, owner: 'B', key: crypto.randomUUID(), body: { ...k1.body, title: 'B-PRIVATE-UNKNOWN' } });
  sessionStorage.setItem('future-roi:create-attempt:A', k2raw); sessionStorage.setItem('future-roi:create-attempt:B', other);
  const beforeLate = saved.length;
  await act(async () => { finishSave!(goal()); await tick(); });
  await settle();
  await release();
  ensure(location.pathname === '/goals/new' && input()?.value === 'A-PRIVATE-K2' && input()?.disabled, 'K1 receipt navigated or destroyed replaced K2');
  ensure(sessionStorage.getItem('future-roi:create-attempt:A') === k2raw && sessionStorage.getItem('future-roi:create-attempt:B') === other && saved.length === beforeLate, 'K1 receipt altered K2/foreign raw or auto-sent');
  await recoverAttempt(); ensure(sessionStorage.getItem('future-roi:create-attempt:B') === other, 'A completion deleted B operation');
  safety.push('same-visit K1 receipt preserves replaced K2 and unrelated B operation; K2 ends only on explicit confirmation');
  for (const method of ['getItem', 'removeItem'] as const) {
    await prepare();
    await click('button[type="submit"]');
    await settle();
    const raw = sessionStorage.getItem('future-roi:create-attempt:A'); const count = saved.length;
    transport.hold = true;
    await visible(6);
    await settle();
    const original = Storage.prototype[method];
    Storage.prototype[method] = function(key: string) {
      if(this === sessionStorage && key === 'future-roi:create-attempt:A') throw new Error('synthetic completion storage failure');
      return original.call(this,key);
    } as any;
    await act(async () => { finishSave!(goal()); await tick(); });
    await settle();
    await release();
    ensure(location.pathname === '/goals/new' && host.textContent?.includes('作成の回復情報を確認できません') && !input() && saved.length === count, 'completion storage failure navigated, exposed a new form or auto-sent');
    Storage.prototype[method] = original;
    ensure(sessionStorage.getItem('future-roi:create-attempt:A') === raw && sessionStorage.getItem('future-roi:create-attempt:B') === other, 'failed completion changed current/foreign raw');
    await navigate('/goals');
    await navigate('/goals/new');
    await recoverAttempt();
    safety.push('success receipt '+method+' failure preserves raw and requires explicit recovery');
  }
  // K1の別訪問での明示確認が先に成功しても、元応答は保留のまま残せる。
  // 次の作成の通常確認が、この旧mutationの終了待ちにならないことを検査する。
  await prepare();
  await click('button[type="submit"]');
  await settle();
  const oldFinish = finishSave!;
  const heldRaw = sessionStorage.getItem('future-roi:create-attempt:A'); ensure(heldRaw, 'K1 operation missing before revisit');
  await navigate('/goals');
  await navigate('/goals/new');
  ensure(input()?.disabled, 'pending K1 reentered as editable draft');
  await recoverAttempt(); await prepare();
  ensure(input()?.value === 'A-PRIVATE-UX-DRAFT' && !input()?.disabled, 'new visit waited for already-confirmed previous-visit mutation');
  await click('button[type="submit"]');
  await settle();
  const k2Finish = finishSave!;
  const latestRaw = sessionStorage.getItem('future-roi:create-attempt:A');
  ensure(latestRaw && latestRaw !== heldRaw, 'next explicit create did not prepare distinct K2');
  await act(async () => { oldFinish(goal()); await tick(); }); await settle();
  ensure(location.pathname === '/goals/new' && sessionStorage.getItem('future-roi:create-attempt:A') === latestRaw, 'old confirmed K1 adopted current visit or deleted K2');
  await act(async () => { k2Finish(goal()); await tick(); }); await settle();
  ensure(location.pathname === '/goals' && sessionStorage.getItem('future-roi:create-attempt:A') === null && sessionStorage.getItem('future-roi:create-attempt:B') === other, 'K2 completion failed or changed B raw');
  safety.push('confirmed replay ends K1 while original response held; next-visit session check and K2 proceed; old K1 cannot affect K2/B');
  ensure(!captures.some(c => c.checking && (c.input !== null || c.text.includes('-PRIVATE'))), 'private DOM observed while checking');
  ensure(transport.writes === 0, 'unexpected auth/private network write');
  await act(async () => root.unmount());
  client.clear();
  Date.now = realNow;
  ensure(saved.length === 29, 'unexpected automatic or duplicate save');
  return { operations, safety, writes: saved.length, observations: captures.length };
}
run().then(result => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...result }); }).catch(error => { document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: error.stack ?? String(error) }); });
