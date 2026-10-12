import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { QueryClient } from '@tanstack/react-query';

// Run the production hook and real QueryClient with held transport replies. React
// lifecycle and session inputs are controlled; actual DOM/SDK coverage is separate.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['react', '@tanstack/react-query', '../../api/evaluation-http.ts',
      '../../api/session-cache.ts', '../../api/session-draft.ts'].includes(specifier)) {
      return { url: 'evaluation:stubs', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'evaluation:stubs') return { format: 'module', shortCircuit: true, source: `
      export const useQueryClient = () => globalThis.ev.client;
      export const useQuery = options => { globalThis.ev.options=options;return globalThis.ev.query; };
      export const useRef = value => ({current:value});
      export const useState = value => {
        const index=globalThis.ev.stateIndex++;
        return [globalThis.ev.persistState && index in globalThis.ev.states ? globalThis.ev.states[index] : value,
          next => {globalThis.ev.updates.push(next);if(globalThis.ev.persistState)globalThis.ev.states[index]=next;}];
      };
      export const useEffect = callback => globalThis.ev.cleanups.push(callback());
      export const usePrivateEpoch = () => globalThis.ev.epoch;
      export const getPrivateEpoch = () => globalThis.ev.epoch;
      export const privateDataReady = epoch => typeof epoch.owner === 'string' && Number.isFinite(epoch.clearedAt);
      export const getDraftGeneration = () => globalThis.ev.generation;
      export const getPrivateGeneration = () => globalThis.ev.queryGeneration;
      export const isDraftOwner = (owner,generation) => owner===globalThis.ev.epoch.owner && generation===globalThis.ev.generation;
      export const evaluationKeys = {capability:()=>['goals','evaluation','capability'],report:id=>['goals','evaluation',id]};
      export const evaluationHttp = {
        capability:()=>globalThis.ev.read(),report:()=>globalThis.ev.read(),
        participate:()=>globalThis.ev.write('participate'),withdraw:()=>globalThis.ev.write('withdraw'),capture:()=>globalThis.ev.write('capture')
      };
    ` };
    return nextLoad(url, context);
  },
});
const { useEvaluation, useEvaluationCapability, EvaluationBoundaryError } = await import('../src/features/evaluation/useEvaluation.ts');
const { ApiError } = await import('../src/api/client.ts');
function setup() {
  const report = { policy: { enabled: true, policyVersion: 'self-evaluation-v1' }, goalSettingsRevision: 1, participating: true, forecasts: [] };
  globalThis.ev = { client: new QueryClient(), epoch: { owner: 'A', clearedAt: 0 }, generation: 1, queryGeneration: 1,
    query: { data: report, dataUpdatedAt: 1 }, updates: [], cleanups: [], writes: [], reads: 0,
    stateIndex:0,states:[],persistState:false,
    write: async kind => { ev.writes.push(kind); }, read: async () => { ev.reads++; return report; } };
  return useEvaluation('goal', true);
}
function cleanup() {
  ev.cleanups.forEach(callback => callback?.());
  ev.client.clear();
  delete globalThis.ev;
}
const dispatched = () => new Promise(resolve => setImmediate(resolve));
for (const change of ['owner', 'roundtrip', 'checking', 'unmount']) {
  test(`held capture response cannot write evaluation cache after ${change}`, async () => {
    const hook = setup();
    let resolve;
    ev.write = kind => { ev.writes.push(kind); return new Promise(done => { resolve=done; }); };
    try {
      const work = hook.action('capture');
      await dispatched();
      assert.deepEqual(ev.writes, ['capture']);
      if (change === 'owner') {
        ev.epoch={owner:'B',clearedAt:2};
        ev.generation++;
        ev.queryGeneration++;
      }
      if (change === 'roundtrip') { ev.generation+=2;ev.queryGeneration+=2; }
      if (change === 'checking') { ev.queryGeneration++; }
      if (change === 'unmount') ev.cleanups.forEach(callback=>callback?.());
      const before = ev.updates.length;
      resolve({ id: 'A-PRIVATE' }); await work;
      assert.equal(ev.reads, 0, 'stale mutation must not dispatch recovery GET');
      assert.equal(ev.client.getQueryData(['goals','evaluation','goal']), undefined);
      assert.equal(ev.updates.length, before, 'no stale completion notice/error/state');
    } finally { cleanup(); }
  });
}
test('handler from previous owner is blocked before dispatch', async () => {
  const hook=setup();try {
    ev.epoch={owner:'B',clearedAt:0};
    ev.generation++;
    ev.queryGeneration++;
    await hook.action('capture');
    assert.equal(ev.writes.length,0);
    assert.equal(ev.reads,0);
  } finally { cleanup(); }
});
test('one pending operation prevents double-click and competing withdrawal', async () => {
  const hook=setup();
  let resolve;
  ev.write=kind=>{ev.writes.push(kind);return new Promise(done=>resolve=done);};
  try {
    const work=hook.action('capture');
    await hook.action('capture');
    await hook.action('withdraw');
    await dispatched();
    assert.deepEqual(ev.writes,['capture']);
    resolve();
    await work;
    assert.equal(ev.reads,1);assert.equal(ev.client.getQueryData(['goals','evaluation','goal']),ev.query.data);
  } finally { cleanup(); }
});
test('held assessment GET cannot resurrect withdrawn-owner data after A→B→A', async () => {
  const hook=setup();
  let resolve;
  ev.read=()=>{ev.reads++;return new Promise(done=>resolve=done);};
  try {
    const work=hook.action('assess');
    await dispatched();
    ev.generation+=2;
    ev.queryGeneration+=2;
    resolve({forecasts:[{id:'A-PRIVATE'}]});await work;
    assert.equal(ev.client.getQueryData(['goals','evaluation','goal']),undefined);assert.deepEqual(ev.writes,[]);
  } finally { cleanup(); }
});
test('capability and report reads reject late replies even if transport ignores AbortSignal', async () => {
  setup();
  let resolve;
  ev.read=()=>new Promise(done=>resolve=done);
  try {
    useEvaluationCapability();
    const read=ev.options.queryFn({});
    ev.queryGeneration++;
    resolve({enabled:true});await assert.rejects(read,EvaluationBoundaryError);
    useEvaluation('goal',true);
    const report=ev.options.queryFn({});
    ev.generation++;
    resolve({forecasts:[{id:'A-PRIVATE'}]});await assert.rejects(report,EvaluationBoundaryError);
    assert.equal(ev.options.retry,false);assert.equal(ev.options.refetchOnWindowFocus,false);
  } finally { cleanup(); }
});
test('default-off report is disabled and no write retry occurs after failure', async () => {
  setup();try {
    const hook=useEvaluation('goal',false);assert.equal(ev.options.enabled,false);
    await hook.action('capture');assert.equal(ev.writes.length,0);
    const active=useEvaluation('goal',true);ev.write=async kind=>{ev.writes.push(kind);throw Error('network');};
    await active.action('capture');
    assert.deepEqual(ev.writes,['capture']);
    assert.equal(ev.reads,0);
  } finally { cleanup(); }
});
test('successful withdrawal clears displayed data even if follow-up GET fails', async () => {
  const hook=setup();try {
    ev.read=async()=>{throw Error('network');};
    await hook.action('withdraw');
    const report=ev.client.getQueryData(['goals','evaluation','goal']);
    assert.deepEqual(report.forecasts,[]);assert.equal(report.participating,false);
    assert.equal(report.summary.issued,0);assert.equal(report.summary.participantCount,0);
    assert.deepEqual(ev.writes,['withdraw']);
  } finally { cleanup(); }
});
test('same-owner withdrawal cancels a real QueryClient pending report and rejects its late transport', async () => {
  const hook=setup();
  let release;
  const previous={...ev.query.data,forecasts:[{id:'SAME-OWNER-OLD'}]};
  const empty={...ev.query.data,participating:false,forecasts:[],summary:{issued:0,participantCount:0}};
  const key=['goals','evaluation','goal'];
  ev.client.setQueryData(key,previous);
  let reads=0;
  ev.read=()=>++reads===1 ? new Promise(resolve=>release=resolve) : Promise.resolve(empty);
  try {
    const pending=ev.client.fetchQuery({...ev.options,staleTime:0}).catch(error=>error);
    await dispatched();assert.equal(reads,1);
    await hook.action('withdraw');
    assert.deepEqual(ev.writes,['withdraw']);assert.equal(reads,2);
    assert.deepEqual(ev.client.getQueryData(key),empty);
    release(previous);
    await pending;
    await dispatched();
    assert.deepEqual(ev.client.getQueryData(key),empty,'cancelled automatic GET must not resurrect prior participation');
  } finally { cleanup(); }
});
test('report transport cannot start during a pending withdrawal even through fetchQuery', async () => {
  const hook=setup();let release;
  ev.write=kind=>{ev.writes.push(kind);return new Promise(resolve=>release=resolve);};
  try {
    const work=hook.action('withdraw');await dispatched();
    await assert.rejects(ev.client.fetchQuery(ev.options),EvaluationBoundaryError);
    assert.equal(ev.reads,0,'a concurrent report must be blocked before transport');
    release();await work;
    assert.deepEqual(ev.writes,['withdraw']);
  } finally { cleanup(); }
});
for (const status of [404, 500]) {
  test(`real QueryClient cached report after HTTP ${status} ${status===404?'is hidden':'remains a transient error snapshot'}`, async () => {
    setup();
    const key=['goals','evaluation','goal'];
    const previous={...ev.query.data,forecasts:[{id:'OLD'}]};
    ev.client.setQueryData(key,previous);ev.read=async()=>{throw new ApiError(status,null);};
    try {
      await assert.rejects(ev.client.fetchQuery(ev.options),ApiError);
      const state=ev.client.getQueryState(key);
      assert.equal(state.data,previous,'QueryClient intentionally preserves data after failed refresh');
      ev.query={data:state.data,dataUpdatedAt:state.dataUpdatedAt,error:state.error,isError:true};
      const hook=useEvaluation('goal',true);
      assert.equal(hook.data,status===404?undefined:previous);
    } finally { cleanup(); }
  });
}
test('manual assessment authoritative404 removes old report cache', async () => {
  const hook=setup();const key=['goals','evaluation','goal'];
  ev.client.setQueryData(key,ev.query.data);ev.read=async()=>{throw new ApiError(404,null);};
  try {
    await hook.action('assess');assert.equal(ev.client.getQueryData(key),undefined);
    assert.ok(ev.updates.some(value=>value?.failure instanceof ApiError&&value.failure.status===404));
  } finally { cleanup(); }
});
for(const status of [401,404]) {
  test(`action HTTP${status} is superseded by a successful real report GET, including same-millisecond recovery`,async()=>{
    setup();
    ev.persistState=true;
    ev.stateIndex=0;
    const clock=Date.now,instant=clock();Date.now=()=>instant;
    const hook=useEvaluation('goal',true),key=['goals','evaluation','goal'];
    ev.client.setQueryData(key,ev.query.data);
    ev.read=async()=>{throw new ApiError(status,null);};
    try {
      await hook.action('assess');
      ev.stateIndex=0;const blocked=useEvaluation('goal',true);
      assert.equal(blocked.data,undefined);assert.equal(blocked.error.status,status);
      const fresh={...ev.query.data,forecasts:[{id:'RECOVERED'}]};ev.read=async()=>fresh;
      // Use the actual queryFn and QueryClient, not a mocked cache setter. The
      // hook state survives the rerender, as it does while the page remains mounted.
      await ev.client.fetchQuery(ev.options);
      const state=ev.client.getQueryState(key);
      ev.query={data:state.data,dataUpdatedAt:state.dataUpdatedAt,error:state.error,isSuccess:state.status==='success'};
      ev.stateIndex=0;const recovered=useEvaluation('goal',true);
      assert.equal(recovered.error,null);assert.equal(recovered.data,fresh);
      await recovered.action('capture');assert.deepEqual(ev.writes,['capture'],'recovered report permits a fresh action');
    } finally {Date.now=clock;cleanup();}
  });
}
for(const status of [401,404]) {
  test(`action HTTP${status} remains superseded after recovery followed by a transient500`,async()=>{
    setup();
    ev.persistState=true;
    ev.stateIndex=0;
    const hook=useEvaluation('goal',true),key=['goals','evaluation','goal'];
    ev.client.setQueryData(key,ev.query.data);ev.read=async()=>{throw new ApiError(status,null);};
    try {
      await hook.action('assess');
      ev.stateIndex=0;const blocked=useEvaluation('goal',true);
      assert.equal(blocked.error.status,status);assert.equal(blocked.data,undefined);
      const fresh={...ev.query.data,forecasts:[{id:'RECOVERED'}]};ev.read=async()=>fresh;
      await ev.client.fetchQuery(ev.options);
      let state=ev.client.getQueryState(key);
      ev.query={data:state.data,dataUpdatedAt:state.dataUpdatedAt,error:state.error,isSuccess:true};
      ev.stateIndex=0;const recovered=useEvaluation('goal',true);
      assert.equal(recovered.error,null);assert.equal(recovered.data,fresh);
      // No intervening action may clear the stored error: exercise the exact
      // success→failed automatic-refresh sequence against the same cache query.
      ev.read=async()=>{throw new ApiError(500,null);};
      await assert.rejects(ev.client.fetchQuery({...ev.options,staleTime:0}),ApiError);
      state=ev.client.getQueryState(key);
      ev.query={data:state.data,dataUpdatedAt:state.dataUpdatedAt,error:state.error,isSuccess:false,isError:true};
      ev.stateIndex=0;const temporaryFailure=useEvaluation('goal',true);
      assert.equal(temporaryFailure.error,null,'the old401/404 must remain superseded');
      assert.equal(temporaryFailure.data,fresh,'transient500 preserves the recovered report');
      assert.equal(temporaryFailure.query.error.status,500);
    } finally {cleanup();}
  });
}
