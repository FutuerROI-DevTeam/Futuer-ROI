import { act, useLayoutEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GoalR11, TodayR11, LearningReport, LearningArtifactSummary, TodayLearning } from '@contracts';
import { authClient } from '../src/auth/client.ts';
import { PrivateCacheGuard } from '../src/api/session-cache.ts';
import { learningKeys } from '../src/api/learning-http.ts';
import { LearningToday } from '../src/features/learning/LearningToday.tsx';

// Real React/QueryClient/guard/component/HTTP strict reader. Only auth state and
// HTTP transport are synthetic. ADOPTABLE is an injected UI fixture, not a math certificate.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
const listeners = new Set<() => void>();
const refetch = async () => {};
let session = { data: { user: { id: 'A', email: 'A@example.invalid' } }, isPending: false, isRefetching: false, error: null, refetch };
Object.assign(authClient, { useSession: () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => session),
  $store: { atoms: { session: { get: () => session, listen: (fn: (value: typeof session) => void) => {
    const listener = () => fn(session); listeners.add(listener); return () => listeners.delete(listener);
  } } } } });
function publish(owner: string, checking = false) {
  session = { ...session, data: { user: { id: owner, email: `${owner}@example.invalid` } }, isRefetching: checking };
  listeners.forEach(fn => fn());
}
const ensure = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const policy = { enabled: true, policyVersion: 'self-learning-v1' as const, retentionDays: 90, maxArtifacts: 5, observationDays: 30, capDays: 14 };
function goal(owner: string): GoalR11 {
  return { id: 'synthetic-goal', title: `${owner}-PRIVATE-GOAL`, schemaVersion: 'r11-v1', unit: 'minutes', totalRequired: 150,
    sessionAmount: 15, initialProgress: 0, progressDone: 0, timezone: 'UTC', recordStartDate: '2026-10-11', hasLogs: false,
    unitLocked: false, goalSettingsRevision: 4, today: '2026-10-11', todayStatus: 'UNRECORDED', targetDate: null,
    questionPrior: { a: null, b: null }, answerRevision: 7 };
}
function baseline(owner: string): TodayR11 {
  const g = goal(owner);
  return { schemaVersion: 'r11-v1', today: g.today, yesterday: '2026-10-10', todayLog: null, yesterdayMissing: false,
    context: { unit: g.unit, sessionAmount: g.sessionAmount, recordStartDate: g.recordStartDate,
      goalSettingsRevision: g.goalSettingsRevision, answerRevision: g.answerRevision, unitLocked: false },
    provenance: { a: 'NONE', b: 'NONE' }, plan: null,
    prediction: { modelVersion: 'behavior-persistence-m1-v1', today: g.today, todayStatus: 'UNRECORDED',
      progress: { done: 0, total: 150, completed: false }, observations: { nDD: 0, nDS: 0, nSD: 0, nSS: 0, effectiveTransitions: 0, observedDays: 0, recordedDays: 0 },
      posterior: { a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } },
      coreMetric: { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' },
      completion: { status: 'insufficient', reason: 'NO_DONE_ORIGIN_TRANSITION' },
      config: { samples: 200, horizonDays: 1095, seed: 20261011 } } };
}
function artifact(owner: string, status: 'REJECTED' | 'ADOPTABLE'): LearningArtifactSummary {
  return { id: `${owner}-${status}`, hash: `${owner}-${status}-exact-hash`, modelVersion: 'duration-model-v1',
    createdAt: `${owner}-PRIVATE-CANDIDATE-${status}`, expiresAt: '2027-01-01T00:00:00Z', trainingCutoff: '2026-10-10',
    goalSettingsRevision: 4, answerRevision: 7, eligible: status === 'ADOPTABLE', eligibilityReason: status === 'REJECTED' ? 'GATE_NOT_ADOPTABLE' : null,
    gate: { status, reasons: status === 'REJECTED' ? ['SYNTHETIC_UI_REJECTED'] : [], trainTransitions: 80, validationOrigins: 16,
      testOrigins: 16, appliedOrigins: 32, fallbackOrigins: 0, excludedOrigins: 0, validationEffectiveBlocks: 3, testEffectiveBlocks: 3,
      baselineRps: .3, candidateRps: status === 'REJECTED' ? .31 : .2, baselineP80Overconfidence: 0, candidateP80Overconfidence: 0,
      baselineFiniteRate: 1, candidateFiniteRate: 1 } };
}
type Store = { participating: boolean; activeRevision: number; active: LearningArtifactSummary | null; artifacts: LearningArtifactSummary[] };
const stores: Record<string, Store> = { A: { participating: false, activeRevision: 0, active: null, artifacts: [] }, B: { participating: false, activeRevision: 0, active: null, artifacts: [] } };
function report(owner: string): LearningReport {
  const s = stores[owner]!;
  return { policy, goalSettingsRevision: 4, answerRevision: 7, participation: s.participating ? { id: `${owner}-participation`, expiresAt: '2027-01-01T00:00:00Z', fitGeneration: s.artifacts.length } : null,
    activeRevision: s.activeRevision, activeArtifactId: s.active?.id ?? null, artifacts: s.artifacts };
}
function selected(owner: string, amount?: number): TodayLearning {
  const s = stores[owner]!, learned = s.active !== null;
  return { schemaVersion: 'learning-today-v1', baseline: baseline(owner), selectedForecast: {
    source: learned ? 'LEARNED' : 'BASELINE', artifactId: s.active?.id ?? null, artifactHash: s.active?.hash ?? null,
    activeRevision: s.activeRevision, status: learned ? 'available' : 'insufficient', reason: learned ? `${owner}-PRIVATE-LEARNED` : 'NO_ELIGIBLE_ACTIVE_ARTIFACT',
    p50Days: learned ? amount === 0 ? 18 : amount === 30 ? 8 : 12 : null, p80Days: learned ? 25 : null,
    horizonDays: 30, reachProbability: learned ? amount === 0 ? .61 : amount === 30 ? .9 : .83 : null,
    todayAmount: amount ?? 15, hypothetical: true } };
}
const writes: { owner: string; method: string; path: string; body: unknown }[] = [];
const previews: number[] = []; const comparisons: number[] = [];
let nextGate: 'REJECTED' | 'ADOPTABLE' = 'REJECTED';
let lostResponse: 'rollback' | 'withdraw' | null = null;
const failRead = { report: false, today: false };
type Held = { owner: string; kind: 'report' | 'today'; value: unknown; release: () => void; aborted: boolean };
let holdOwner: string | null = null;
const held: Held[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  const method = init?.method ?? 'GET', owner = session.data.user.id, s = stores[owner]!;
  if (url.pathname === '/api/learning' && method === 'GET') return Response.json(policy);
  const prefix = '/api/goals/synthetic-goal/learning';
  ensure(url.pathname.startsWith(prefix), `unexpected network request: ${method} ${url.pathname}`);
  if (method === 'GET') {
    if(url.pathname===prefix+'/compare') {
      const a=s.artifacts.find(a=>a.id===url.searchParams.get('artifactId')&&a.hash===url.searchParams.get('artifactHash')&&a.purpose==='EXPERIMENTAL');ensure(a,'unknown comparison artifact');
      const amount=Number(url.searchParams.get('amount'));comparisons.push(amount);
      const v={status:'available',reason:null,p50Days:amount===0?18:amount===30?8:12,p80Days:null,horizonDays:30,reachProbability:amount===0?.6:amount===30?.9:.7,todayAmount:amount,hypothetical:true};
      return Response.json({schemaVersion:'learning-comparison-v1',baseline:baseline(owner),reference:{...v,source:'BASELINE'},experiment:{...v,source:'EXPERIMENTAL',artifactId:a!.id,artifactHash:a!.hash},goalSettingsRevision:4,answerRevision:7,activeRevision:s.activeRevision});
    }
    const kind = url.pathname === prefix ? 'report' : url.pathname === `${prefix}/today` ? 'today' : null;
    ensure(kind, 'unexpected GET');
    if (failRead[kind!]) return Response.json({ code: 'SYNTHETIC_UNAVAILABLE', message: 'synthetic read failure' }, { status: 500 });
    const amount = url.searchParams.has('amount') ? Number(url.searchParams.get('amount')) : undefined;
    if (amount !== undefined) previews.push(amount);
    const value = kind === 'report' ? report(owner) : selected(owner, amount);
    if (holdOwner === owner && amount === undefined) await new Promise<void>(release => {
      const h: Held = { owner, kind: kind!, value: structuredClone(value), release, aborted: false }; held.push(h);
      init?.signal?.addEventListener('abort', () => { h.aborted = true; });
    }); // Intentionally ignore abort, so production guard/cancellation must reject the late reply.
    return Response.json(value);
  }
  const body = JSON.parse(String(init?.body ?? '{}'));
  writes.push({ owner, method, path: url.pathname, body });
  if (url.pathname === `${prefix}/participation` && method === 'PUT') {
    ensure(body.policyVersion === policy.policyVersion, 'wrong consent version'); s.participating = true;
  } else if (url.pathname === `${prefix}/fits` && method === 'POST') {
    ensure(body.expectedParticipationId === `${owner}-participation` && body.expectedActiveRevision === s.activeRevision && body.expectedGoalSettingsRevision === 4 && body.expectedAnswerRevision === 7, 'fit context/CAS mismatch');
    const value = artifact(owner, nextGate); s.artifacts = [value, ...s.artifacts]; return Response.json(value, { status: 201 });
   } else if (url.pathname === prefix+'/experiments' && method === 'POST') {
    ensure(body.expectedParticipationId===owner+'-participation'&&body.expectedActiveRevision===s.activeRevision&&body.expectedGoalSettingsRevision===4&&body.expectedAnswerRevision===7,'experiment CAS mismatch');
    const value={...artifact(owner,'REJECTED'),id:owner==='A'?'10000000-0000-4000-8000-000000000001':'10000000-0000-4000-8000-000000000002',hash:(owner==='A'?'a':'b').repeat(64),purpose:'EXPERIMENTAL' as const,createdAt:owner+'-PRIVATE-EXPERIMENT',gate:{...artifact(owner,'REJECTED').gate,status:'INSUFFICIENT' as const,reasons:['EXPERIMENTAL_NOT_QUALIFIED']}};
    s.artifacts=[value,...s.artifacts];return Response.json(value,{status:201});
  } else if (url.pathname === `${prefix}/active` && method === 'PUT') {
    ensure(body.expectedParticipationId === `${owner}-participation` && body.expectedActiveRevision === s.activeRevision, 'activation CAS mismatch');
    const value = s.artifacts.find(a => a.id === body.artifactId && a.hash === body.artifactHash && a.gate.status === 'ADOPTABLE');
    ensure(value, 'adoption forced a rejected/hash mismatch artifact'); s.active = value!; s.activeRevision++;
  } else if (url.pathname === `${prefix}/active` && method === 'DELETE') {
    ensure(body.expectedParticipationId === `${owner}-participation` && body.expectedActiveRevision === s.activeRevision, 'rollback CAS mismatch'); s.active = null; s.activeRevision++;
    if (lostResponse === 'rollback') { lostResponse = null; return Response.json({ code: 'SYNTHETIC_RESPONSE_LOST', message: 'committed rollback, response unavailable' }, { status: 500 }); }
  } else if (url.pathname === `${prefix}/participation` && method === 'DELETE') {
    ensure(body.expectedParticipationId === `${owner}-participation`, 'withdraw participation mismatch'); s.active = null; s.artifacts = []; s.participating = false; s.activeRevision++;
    if (lostResponse === 'withdraw') { lostResponse = null; return Response.json({ code: 'SYNTHETIC_RESPONSE_LOST', message: 'committed withdrawal, response unavailable' }, { status: 500 }); }
  } else throw Error('unexpected mutation');
  return new Response(null, { status: 204 });
};
const host = document.getElementById('app')!, root = createRoot(host);
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const commits: { owner: string; text: string }[] = [];
const observe = () => { commits.push({ owner: host.querySelector('#owner')?.textContent ?? '', text: host.textContent ?? '' }); };
const observer = new MutationObserver(observe); observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
function Screen() {
  const current = authClient.useSession(), owner = current.data?.user.id ?? 'NONE';
  useLayoutEffect(observe);
  return <><output id="owner">{owner}</output><LearningToday goal={goal(owner)} today={baseline(owner)} logs={[]} changing={false} locked={false}>
    <h1>{owner}-BASELINE-MAIN</h1>
  </LearningToday></>;
}
const settle = async () => { for (let n = 0; n < 8; n++) await act(tick); };
async function click(text: string, within: ParentNode = host) {
  const button = [...within.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text);
  ensure(button && !button.disabled, `missing/enabled button: ${text}; ${host.textContent}`);
  try { await act(async () => { const details=button!.closest('details');if(details&&!details.open)details.querySelector('summary')!.click();button!.click(); await tick(); }); await settle(); }
  catch (error) { throw new Error(`click ${text}: ${failureText(error)}`); }
}
const primary = () => host.querySelector('[data-applied="true"]');
async function run() {
  const results: string[] = [];
  await act(async () => { root.render(<QueryClientProvider client={client}><PrivateCacheGuard /><Screen /></QueryClientProvider>); await tick(); }); await settle();
  ensure(host.querySelector('h1')?.textContent === 'A-BASELINE-MAIN' && writes.length === 0, 'initial report auto-wrote or main missing');
  const checkbox = host.querySelector<HTMLInputElement>('.fr-learning__accept input')!;
  ensure(host.querySelector<HTMLButtonElement>('.fr-learning__accept + button')?.disabled, `consent was not required: ${host.textContent}; cache ${JSON.stringify(client.getQueryState(learningKeys.report('synthetic-goal')))}`);
  await act(async () => { checkbox.click(); await tick(); });
  await click('この目標の学習に参加');
  ensure(writes.length === 1 && !primary(), 'participation auto-fitted/adopted'); results.push('separate consent/participation, no auto fit/adoption');
  await click('実績から実験モデルを作る');
  ensure(writes.length===2&&stores.A!.active===null&&stores.A!.artifacts[0]?.purpose==='EXPERIMENTAL'&&comparisons.length===0&&host.querySelector('h1')?.textContent==='A-BASELINE-MAIN','experiment auto compared/activated or replaced primary');
  await click('このモデルと比較');
  let cmp=host.querySelector('[aria-label="標準モデルと実験モデルの未保存比較"]');
  ensure(cmp?.textContent?.includes('実験モデル（改善未確認）')&&cmp.textContent.includes('30日以内')&&host.textContent?.includes('1095日'),`comparison sources/horizons missing: ${host.textContent}; counts ${JSON.stringify(comparisons)}`);
  const expInput=host.querySelector<HTMLInputElement>('#learning-experiment-amount')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(expInput,'30');expInput.dispatchEvent(new Event('input',{bubbles:true}));await tick();});
  await click('選んだモデルでこの量を比較（未保存）');
  cmp=host.querySelector('[aria-label="標準モデルと実験モデルの未保存比較"]');ensure(cmp?.textContent?.includes('今日の量 30（未保存）'),'positive experiment preview missing');
  await click('選んだモデルで休む場合を比較（未保存）');cmp=host.querySelector('[aria-label="標準モデルと実験モデルの未保存比較"]');
  ensure(cmp?.textContent?.includes('休む場合（未保存）')&&writes.length===2&&stores.A!.active===null&&host.querySelector('h1')?.textContent==='A-BASELINE-MAIN','comparison wrote or zero scenario missing');
  results.push('explicit synthetic experiment result + GET-only matched positive/zero comparison; standard primary and active pointer unchanged (not real fit certification)');
  await click('候補を学習して比較');
  const rejected = [...host.querySelectorAll('li')].find(li => li.textContent?.includes('A-PRIVATE-CANDIDATE-REJECTED'))!;
  ensure(rejected.querySelector<HTMLButtonElement>('button')?.disabled && !primary(), 'rejected gate allowed adoption');
  nextGate = 'ADOPTABLE'; await click('候補を学習して比較');
  ensure(!primary(), 'fit silently adopted candidate');
  const adoptable = [...host.querySelectorAll('li')].find(li => li.textContent?.includes('A-PRIVATE-CANDIDATE-ADOPTABLE'))!;
  await click('この候補を明示採用', adoptable);
  ensure(primary() && host.querySelector('h1')?.textContent === 'A-BASELINE-MAIN' && !host.querySelector('[aria-label="採用した予測の主表示"]'), 'qualified pointer replaced standard primary');
  results.push('REJECTED disabled; injected ADOPTABLE explicit hash/CAS remains audit; standard primary retained (not math certification)');
  const input = host.querySelector<HTMLInputElement>('#learning-amount')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '30'); input.dispatchEvent(new Event('input', { bubbles: true })); await tick(); });
  const beforePreviewWrites = writes.length;
  await click('この量で比較（未保存）');
  let card = host.querySelector('[aria-label="未保存の量比較"]');
  ensure(card?.textContent?.includes('今日30分やる場合（未保存）') && card.textContent.includes('8日') && host.querySelector('h1')?.textContent === 'A-BASELINE-MAIN', 'positive preview replaced primary or missing');
  await click('休む場合を比較（未保存）'); card = host.querySelector('[aria-label="未保存の量比較"]');
  ensure(card?.textContent?.includes('休む場合（未保存）') && card.textContent.includes('18日'), 'zero skip scenario missing');
  ensure(writes.length === beforePreviewWrites && previews.join(',') === '30,0', 'preview wrote records or auto requested'); results.push('positive GET-only unsaved subcard, separate zero skip; primary unchanged');
  holdOwner = 'A';
  void client.refetchQueries({ queryKey: learningKeys.report('synthetic-goal'), exact: true });
  void client.refetchQueries({ queryKey: learningKeys.today('synthetic-goal'), exact: true });await act(tick);await settle();
  ensure(!primary() && !host.querySelector('[aria-label="未保存の量比較"]'), 'external recheck left a learned primary/preview visible');
  holdOwner = null;await act(async()=>{held.splice(0).forEach(h=>h.release());await tick();});await settle();
  ensure(primary() && host.querySelector('[aria-label="未保存の量比較"]'), 'matching fresh pair did not recover the same-revision preview');
  await click('従来モデルへ戻す');
  const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
  ensure(dialog.open && document.activeElement?.textContent === '取り消す', 'real rollback modal/focus missing');
  ensure(stores.A!.active !== null, 'opening modal rolled back without confirmation');
  await click('従来モデルへ戻す', dialog);
  ensure(!primary() && host.querySelector('h1')?.textContent === 'A-BASELINE-MAIN', 'rollback did not restore baseline'); results.push('real ConfirmDialog rollback requires explicit confirmation, restores baseline');
  const adoptableAgain = [...host.querySelectorAll('li')].find(li => li.textContent?.includes('A-PRIVATE-CANDIDATE-ADOPTABLE'))!;
  await click('この候補を明示採用', adoptableAgain);
  lostResponse = 'rollback'; failRead.report = true; failRead.today = true;
  await click('従来モデルへ戻す'); await click('従来モデルへ戻す', host.querySelector('dialog')!);
  const afterLostRollback = writes.length;
  ensure(stores.A!.active === null && !primary() && host.textContent?.includes('書き込み結果を確認できていません'), 'committed rollback with lost response reused learned primary');
  ensure([...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '候補を学習して比較')?.disabled, 'unknown rollback allowed a write');
  await click('学習状態を再確認'); ensure(!primary() && writes.length === afterLostRollback, 'failed refresh restored learned primary or resent write');
  await act(async()=>{publish('A',true);await tick();});await settle();
  ensure(!host.querySelector('.fr-learning'), 'same-owner checking exposed uncertain panel');
  await act(async()=>{publish('A');await tick();});await settle();
  ensure(!primary() && host.textContent?.includes('書き込み結果を確認できていません'), 'same-owner auth reset erased uncertain write metadata');
  failRead.report = false; await act(async () => { await client.refetchQueries({ queryKey: learningKeys.report('synthetic-goal'), exact: true }); }); await settle();
  ensure(!primary() && host.textContent?.includes('書き込み結果を確認できていません'), 'report-only recovery cleared uncertain write');
  failRead.today = false; await act(async () => { await client.refetchQueries({ queryKey: learningKeys.today('synthetic-goal'), exact: true }); }); await settle();
  ensure(!primary() && !host.textContent?.includes('書き込み結果を確認できていません') && writes.length === afterLostRollback, 'both reads failed to confirm rollback or auto resent write');
  results.push('committed rollback response500 and failed reads: same-owner auth reset/remount retains uncertainty; report-only cannot unlock, first both GETs recover');
  await click('この候補を明示採用', [...host.querySelectorAll('li')].find(li => li.textContent?.includes('A-PRIVATE-CANDIDATE-ADOPTABLE'))!);
  holdOwner = 'A';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await tick(); }); await settle();
  ensure(held.some(h => h.kind === 'report') && held.some(h => h.kind === 'today'), 'visibility did not recheck both reads');
  ensure(!primary() && host.querySelector<HTMLButtonElement>('.fr-learning__actions button')?.disabled, 'pending same-owner recheck left learned main/actions enabled');
  const beforeCheckingWrites = writes.length;
  await act(async () => { publish('A', true); await tick(); }); await settle();
  ensure(!primary() && !host.querySelector('.fr-learning') && host.textContent?.includes('認証状態を確認しています'), 'same-owner session check exposed learned panel/actions');
  holdOwner = null; await act(async () => { held.splice(0).forEach(h => h.release()); publish('A'); await tick(); }); await settle();
  ensure(writes.length === beforeCheckingWrites, 'same-owner confirmation dispatched a write');
  ensure(primary(), 'same-owner recheck failed to recover learned main'); results.push('same-owner visibility recheck masks learned main and locks writes until both GETs settle');
  holdOwner = 'A';
  void client.refetchQueries({ queryKey: learningKeys.report('synthetic-goal') });
  void client.refetchQueries({ queryKey: learningKeys.today('synthetic-goal') }); await act(tick); await settle();
  const from = commits.length;
  await act(async () => { publish('B'); await tick(); }); await settle();
  ensure(host.querySelector('h1')?.textContent === 'B-BASELINE-MAIN', 'B did not receive clean baseline');
  const aHeld = held.splice(0); ensure(aHeld.length === 2 && aHeld.every(h => h.aborted), 'owner change did not abort held A reads');
  holdOwner = null; await act(async () => { aHeld.forEach(h => h.release()); await tick(); }); await settle();
  for (const commit of commits.slice(from).filter(c => c.owner === 'B')) ensure(!commit.text.includes('A-PRIVATE') && !commit.text.includes('A-BASELINE'), 'MutationObserver/commit detected A content with B session');
  ensure(!host.textContent?.includes('A-PRIVATE') && !primary(), 'late A learned DTO leaked into B DOM');
  ensure(writes.every(w => w.owner === 'A'), 'owner switch auto wrote B'); results.push('A→B plus abort-ignored late A report/today: every observed B DOM commit excludes A');
  await act(async () => { publish('A'); await tick(); }); await settle(); ensure(primary(), 'A recovery did not re-read active state');
  await click('学習参加を解除・候補を削除');
  const withdrawal = host.querySelector<HTMLDialogElement>('dialog')!;
  ensure(withdrawal.open && withdrawal.textContent?.includes('比較済みの最終日だけ目標削除まで残します'), 'withdrawal modal/disclosure missing');
  lostResponse = 'withdraw'; failRead.report = true; failRead.today = true;
  await click('解除して候補を削除', withdrawal);
  const afterLostWithdraw = writes.length;
  ensure(!primary() && host.textContent?.includes('書き込み結果を確認できていません'), 'committed withdrawal response loss kept learned primary');
  failRead.report = false; await act(async () => { await client.refetchQueries({ queryKey: learningKeys.report('synthetic-goal'), exact: true }); }); await settle();
  ensure(!primary() && host.textContent?.includes('書き込み結果を確認できていません') && host.querySelector<HTMLButtonElement>('.fr-learning__accept + button')?.disabled, 'report-only withdrawal confirmation allowed participation');
  failRead.today = false; await click('学習状態を再確認');
  ensure(!host.textContent?.includes('書き込み結果を確認できていません') && writes.length === afterLostWithdraw, 'withdrawal recovery auto wrote or stayed blocked');
  ensure(stores.A!.artifacts.length === 0 && !stores.A!.participating && !primary(), 'withdraw failed to clear candidate/main');
  ensure(!host.textContent?.includes('A-PRIVATE-CANDIDATE') && client.getQueryData<LearningReport>(learningKeys.report('synthetic-goal'))?.artifacts.length === 0, 'withdrawn candidates remain DOM/cache');
  results.push('real withdrawal commit/response500 masks old main; report-only cannot unlock, both GETs clear participation/artifacts/cache without resend');
  await act(async () => root.unmount()); client.clear(); observer.disconnect();
  return { results, commits: commits.length, writes, previews, comparisons, syntheticOnly: true, adoptableFixtureIsNotMathCertificate: true };
}
run().then(value => { document.getElementById('result')!.textContent = JSON.stringify({ ok: true, ...value }); })
  .catch(error => { document.getElementById('result')!.textContent = JSON.stringify({ ok: false, error: failureText(error) }); });
function failureText(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(failureText).join('\n');
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
