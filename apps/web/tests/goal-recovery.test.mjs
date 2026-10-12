import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
// Load the declared dependency before the hooks below replace its hook exports.
import { QueryClient } from '@tanstack/react-query';

// The actual hook and QueryClient run with a held GET. React lifecycle/session
// inputs are controlled; this is not a DOM or real-auth acceptance test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['react', '@tanstack/react-query', '../../api/goals-http.ts', '../../api/today-http.ts',
      '../../api/session-cache.ts', '../../api/session-draft.ts', '../../auth/client.ts'].includes(specifier)) {
      return { url: 'recovery:stubs', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'recovery:stubs') return { format: 'module', shortCircuit: true, source: `
      export const useQueryClient = () => globalThis.recovery.client;
      export const useMutation = () => globalThis.recovery.mutation;
      export const useMutationState = () => [];
      export const useRef = value => ({current:value});
      export const useState = value => [value, () => {}];
      export const useEffect = callback => {globalThis.recovery.cleanups.push(callback());};
      export const usePrivateEpoch = () => globalThis.recovery.epoch;
      export const getPrivateEpoch = () => globalThis.recovery.epoch;
      export const privateDataReady = epoch => typeof epoch.owner === 'string' && Number.isFinite(epoch.clearedAt);
      export const getDraftGeneration = () => 0;
      export const isDraftOwner = () => true;
      export const authClient = {useSession:()=>({data:{user:{id:globalThis.recovery.epoch.owner}},isPending:false,error:null})};
      export const goalKeys = {all:['goals'], detail:id=>['goals','detail',id,'r11']};
      export const goalsHttp = {getGoal:(id,signal)=>{globalThis.recovery.signal=signal;return globalThis.recovery.deferred;}};
      export const todayHttp = {};
      export const todayKeys = {today:id=>['goals',id,'today'], logs:id=>['goals',id,'logs']};
    ` };
    return nextLoad(url, context);
  },
});
const { ApiError } = await import('../src/api/client.ts');
const { useSaveLog } = await import('../src/features/logs/useSaveLog.ts');
const { goalKeys } = await import('recovery:stubs');

for (const owners of [[], ['B'], ['B', 'A'], ['unmount']]) {
  test(`409回復GET: ${owners.length ? 'A→'+owners.join('→') : '同じowner・世代'}の応答境界`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveGet;
    const deferred = new Promise(resolve => {resolveGet=resolve;});
    const id = '00000000-0000-4000-8000-000000000175';
    const goal = {id,title:'AのGoal',unit:'minutes',timezone:'Asia/Tokyo',goalSettingsRevision:1};
    globalThis.recovery = {client,deferred,epoch:{owner:'A',clearedAt:0},cleanups:[],mutation:{
      isError:true,error:new ApiError(409,{error:{code:'GOAL_SETTINGS_CONFLICT',message:'synthetic'}}),isPending:false,
      variables:{goalId:id,localDate:'2026-10-09',choice:{status:'DONE',amount:10},expectedGoalSettingsRevision:0,unit:'minutes',timezone:'Asia/Tokyo'},
      mutate(){throw Error('No PUT permitted');},reset(){},
    }};
    try {
      const hook = useSaveLog(id,{context:goal});
      const reload = hook.reloadSettings();
      for (const owner of owners) {
        if (owner === 'unmount') {
          for (const cleanup of recovery.cleanups) cleanup?.();
          assert.equal(recovery.signal?.aborted,true,'離脱時に回復GETを中断する');
        } else {
          await client.cancelQueries({queryKey:goalKeys.all});
          await client.resetQueries({queryKey:goalKeys.all});
          recovery.epoch={owner,clearedAt:Date.now()};
        }
      }
      // Deliberately ignore AbortSignal: a late response still needs the generation guard.
      resolveGet(goal);
      await reload;
      assert.deepEqual(client.getQueryData(goalKeys.detail(id)),owners.length ? undefined : goal);
    } finally {client.clear();delete globalThis.recovery;}
  });
}
