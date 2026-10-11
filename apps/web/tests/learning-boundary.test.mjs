import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { QueryClient } from '@tanstack/react-query';

// Production hook + real QueryClient. React lifecycle/session are controlled;
// browser integration and the learner's statistical gate are checked separately.
registerHooks({resolve(specifier,context,next){
  if(['react','@tanstack/react-query','../../api/learning-http.ts','../../api/session-cache.ts','../../api/session-draft.ts','../../auth/client.ts'].includes(specifier))return{url:'learning:stub',shortCircuit:true};
  return next(specifier,context);
},load(url,context,next){if(url!=='learning:stub')return next(url,context);return{format:'module',shortCircuit:true,source:`
export const useQueryClient=()=>globalThis.lr.client;
export const useQuery=options=>{globalThis.lr.options.set(JSON.stringify(options.queryKey),options);if(options.meta){const q=lr.client.getQueryCache().build(lr.client,lr.client.defaultQueryOptions(options));q.setOptions(lr.client.defaultQueryOptions(options));}return globalThis.lr.queries.get(JSON.stringify(options.queryKey))??{dataUpdatedAt:0};};
export const useRef=value=>{const index=lr.refIndex++;return lr.refs[index]??=({current:value});};
export const useState=value=>{const index=lr.stateIndex++;return[index in lr.states?lr.states[index]:value,next=>{lr.updates.push(next);lr.states[index]=next;}];};
export const useEffect=(callback,deps)=>{const index=lr.effectIndex++;if(!lr.effects[index]||deps.some((x,i)=>x!==lr.effects[index].deps[i])){lr.effects[index]?.cleanup?.();lr.effects[index]={deps,cleanup:callback()};}};
export const usePrivateEpoch=()=>lr.epoch;export const getPrivateEpoch=()=>lr.epoch;
export const privateDataReady=epoch=>typeof epoch.owner==='string'&&Number.isFinite(epoch.clearedAt);
export const getDraftGeneration=()=>lr.generation;export const getPrivateGeneration=()=>lr.queryGeneration;
export const isDraftOwner=(owner,generation)=>owner===lr.epoch.owner&&generation===lr.generation;
export const authClient={$store:{atoms:{get session(){return lr.atom;}}}};
export const learningKeys={capability:()=>['goals','learning','capability'],report:id=>['goals','learning',id,'report'],today:id=>['goals','learning',id,'today'],confirmation:id=>['goals','learning',id,'confirmation']};
export const learningHttp={capability:()=>lr.capability(),report:()=>lr.read('report'),today:(_id,amount)=>lr.read('today',amount),
participate:(_id,body)=>lr.write('participate',body),fit:(_id,body)=>lr.write('fit',body),experiment:(_id,body)=>lr.write('experiment',body),compare:(_id,id,hash,amount)=>lr.compare(id,hash,amount),activate:(_id,body)=>lr.write('activate',body),rollback:(_id,body)=>lr.write('rollback',body),withdraw:(_id,body)=>lr.write('withdraw',body)};
`};}});
const {useLearning,useLearningCapability,LearningBoundaryError}=await import('../src/features/learning/useLearning.ts');
const {ApiError}=await import('../src/api/client.ts');
const key=kind=>['goals','learning','goal',kind];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const artifact={id:'artifact',hash:'exact-hash',eligible:true,gate:{status:'ADOPTABLE'}};
 const report={policy:{enabled:true,policyVersion:'self-learning-v1',observationDays:30},goalSettingsRevision:4,answerRevision:'answer-7',participation:{id:'participation'},activeRevision:2,activeArtifactId:'artifact',artifacts:[artifact]};
 const selected={selectedForecast:{activeRevision:2,source:'LEARNED',artifactId:'artifact',artifactHash:'exact-hash',hypothetical:false,todayAmount:null}};
 globalThis.lr={client:new QueryClient(),epoch:{owner:'A',clearedAt:0},generation:1,queryGeneration:1,
 refs:[],states:[],effects:[],options:new Map(),queries:new Map(),writes:[],reads:[],updates:[],
 ownerListeners:new Set(),session:{data:{user:{id:'A'}},isPending:false,isRefetching:false,error:null},
 capability:async()=>({enabled:true}),read:async(kind,amount)=>{lr.reads.push([kind,amount]);return kind==='report'?report:{...selected,selectedForecast:{...selected.selectedForecast,hypothetical:amount!==undefined,todayAmount:amount??null}};},
 write:async(kind,body)=>lr.writes.push([kind,body]),report,selected,artifact};
 lr.atom={get:()=>lr.session,listen:fn=>{const listeners=lr.ownerListeners;listeners.add(fn);return()=>listeners.delete(fn);}};
 lr.client.setQueryData(key('report'),report);lr.client.setQueryData(key('today'),selected);sync();return render();
}
function sync(){for(const kind of ['report','today','confirmation']){const s=lr.client.getQueryState(key(kind));lr.queries.set(JSON.stringify(key(kind)),s?{data:s.data,dataUpdatedAt:s.dataUpdatedAt,error:s.error,isSuccess:s.status==='success',isFetching:s.fetchStatus==='fetching'}:{dataUpdatedAt:0});}}
function render(enabled=true,scope='goal:day:4:answer-7'){lr.stateIndex=0;lr.refIndex=0;lr.effectIndex=0;return useLearning('goal',enabled,scope);}
function cleanup(){for(const e of lr.effects)e.cleanup?.();lr.client.clear();assert.equal(lr.ownerListeners.size,0,'cache disposal leaves no confirmation listener');delete globalThis.lr;}
for(const change of ['owner','roundtrip','checking','unmount','day'])test(`held fit cannot publish cache or dispatch fresh reads after ${change}`,async()=>{
 const hook=setup();let release;lr.write=(kind,body)=>{lr.writes.push([kind,body]);return new Promise(done=>release=done);};
 try{const work=hook.action('fit');await tick();assert.equal(lr.writes.length,1);
 if(change==='owner'){lr.epoch={owner:'B',clearedAt:0};lr.generation++;lr.queryGeneration++;}
 if(change==='roundtrip'){lr.generation+=2;lr.queryGeneration+=2;}
 if(change==='checking')lr.queryGeneration++;
 if(change==='unmount')lr.effects.forEach(e=>e.cleanup?.());
 if(change==='day')render(true,'goal:nextday:4:answer-7');
 const before=lr.updates.length;release();await work;assert.equal(lr.reads.length,0);assert.equal(lr.updates.length,before);
 }finally{cleanup();}
});
test('activation sends the exact artifact hash, participation and active CAS revision',async()=>{const hook=setup();try{await hook.action('activate',lr.artifact);assert.deepEqual(lr.writes,[['activate',{artifactId:'artifact',artifactHash:'exact-hash',expectedParticipationId:'participation',expectedActiveRevision:2}]]);assert.deepEqual(lr.reads,[['report',undefined],['today',undefined]]);}finally{cleanup();}});
test('rejected cached gate cannot be forced with a forged adoptable artifact or mismatched hash',async()=>{setup();try{lr.report.artifacts=[{...lr.artifact,gate:{status:'REJECTED'}}];const hook=render();await hook.action('activate',lr.artifact);await hook.action('activate',{...lr.artifact,hash:'wrong'});assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('old-owner handler and default-off hook dispatch no write',async()=>{const hook=setup();try{await render(false).action('fit');assert.equal(lr.options.get(JSON.stringify(key('report'))).enabled,false);lr.epoch={owner:'B',clearedAt:0};lr.generation++;await hook.action('fit');assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('fit failure is one explicit write without automatic retry or activation',async()=>{const hook=setup();try{lr.write=async(kind,body)=>{lr.writes.push([kind,body]);throw new ApiError(409,null);};await hook.action('fit');assert.deepEqual(lr.writes.map(([kind])=>kind),['fit']);assert.deepEqual(lr.reads,[]);}finally{cleanup();}});
for(const kind of ['report','today'])test(`withdrawal cancels real QueryClient held ${kind}, even if transport ignores abort`,async()=>{
 const hook=setup();let release;let first=true;const empty={...lr.report,participation:null,artifacts:[],activeArtifactId:null,activeRevision:3};
 const baseline={selectedForecast:{...lr.selected.selectedForecast,source:'BASELINE',artifactId:null,artifactHash:null,activeRevision:3}};
 lr.read=async(type)=>{lr.reads.push([type]);if(type===kind&&first){first=false;return new Promise(done=>release=done);}return type==='report'?empty:baseline;};
 try{const pending=lr.client.fetchQuery({...lr.options.get(JSON.stringify(key(kind))),staleTime:0}).catch(e=>e);await tick();await hook.action('withdraw');assert.deepEqual(lr.client.getQueryData(key('report')),empty);assert.deepEqual(lr.client.getQueryData(key('today')),baseline);release(kind==='report'?lr.report:lr.selected);await pending;await tick();assert.deepEqual(lr.client.getQueryData(key('report')),empty);assert.deepEqual(lr.client.getQueryData(key('today')),baseline);}finally{cleanup();}
});
test('withdrawal clears artifacts and learned today even when fresh GET fails',async()=>{const hook=setup();try{lr.read=async()=>{throw Error('network');};await hook.action('withdraw');assert.deepEqual(lr.client.getQueryData(key('report')).artifacts,[]);assert.equal(lr.client.getQueryData(key('report')).participation,null);assert.equal(lr.client.getQueryData(key('today')),undefined);}finally{cleanup();}});
test('pending fit blocks concurrent report reads and duplicate writes',async()=>{const hook=setup();let release;lr.write=(kind,body)=>{lr.writes.push([kind,body]);return new Promise(done=>release=done);};try{const work=hook.action('fit');await tick();await hook.action('withdraw');await assert.rejects(lr.client.fetchQuery(lr.options.get(JSON.stringify(key('report')))),LearningBoundaryError);assert.equal(lr.reads.length,0);assert.equal(lr.writes.length,1);release();await work;}finally{cleanup();}});
test('positive amount preview and separate zero preview are GET only; newest reply wins',async()=>{const hook=setup();const releases=[];lr.read=(kind,amount)=>{lr.reads.push([kind,amount]);return new Promise(done=>releases.push({done,amount}));};try{const old=hook.requestPreview(15),latest=hook.requestPreview(0);releases[1].done({selectedForecast:{activeRevision:2,hypothetical:true,todayAmount:0}});await latest;releases[0].done({selectedForecast:{activeRevision:2,hypothetical:true,todayAmount:15}});await old;assert.deepEqual(lr.reads,[['today',15],['today',0]]);assert.equal(render().preview.selectedForecast.todayAmount,0);assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('invalid amount or mismatched active revision/amount never displays preview',async()=>{const hook=setup();try{for(const n of [-1,1.2,2147483648,NaN])await hook.requestPreview(n);assert.deepEqual(lr.reads,[]);lr.read=async()=>({selectedForecast:{activeRevision:3,hypothetical:true,todayAmount:15}});await hook.requestPreview(15);assert.equal(render().preview,null);assert.ok(render().previewError instanceof LearningBoundaryError);}finally{cleanup();}});
for(const status of [401,404])test(`HTTP${status} action is permanently superseded by successful real GET even after later500`,async()=>{const hook=setup();try{lr.read=async()=>{throw new ApiError(status,null);};await hook.action('refresh');sync();assert.equal(render().report,undefined);assert.equal(render().error.status,status);lr.read=async()=>lr.report;await lr.client.fetchQuery(lr.options.get(JSON.stringify(key('report'))));sync();assert.equal(render().error,null);assert.equal(render().report,lr.report);lr.read=async()=>{throw new ApiError(500,null);};await assert.rejects(lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('report'))),staleTime:0}),ApiError);sync();assert.equal(render().error,null);assert.equal(render().report,lr.report);}finally{cleanup();}});
test('capability rejects stale ownership even if transport ignores abort',async()=>{setup();let release;lr.capability=()=>new Promise(done=>release=done);try{useLearningCapability();const options=lr.options.get(JSON.stringify(['goals','learning','capability']));const work=options.queryFn({signal:new AbortController().signal});lr.queryGeneration++;release({enabled:true});await assert.rejects(work,LearningBoundaryError);assert.equal(options.retry,false);}finally{cleanup();}});
test('rechecking same-owner active state hides cached learned selection and blocks mutation/preview',async()=>{setup();try{const previous=lr.queries.get(JSON.stringify(key('report')));lr.queries.set(JSON.stringify(key('report')),{...previous,isFetching:true});const hook=render();assert.equal(hook.selected,undefined);assert.equal(hook.busy,true);await hook.action('fit');await hook.requestPreview(15);assert.deepEqual(lr.writes,[]);assert.deepEqual(lr.reads,[]);}finally{cleanup();}});
for(const change of ['owner','day','active'])test(`held amount preview is discarded after ${change} context drift`,async()=>{const hook=setup();let release;lr.read=()=>new Promise(done=>release=done);try{const work=hook.requestPreview(15);if(change==='owner'){lr.epoch={owner:'B',clearedAt:0};lr.generation++;lr.queryGeneration++;}if(change==='day')render(true,'goal:nextday:4:answer-7');release({selectedForecast:{activeRevision:change==='active'?3:2,hypothetical:true,todayAmount:15}});await work;assert.equal(render().preview,null);assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('visible-tab resume cancels real pending report and makes both learning reads stale without writes',async()=>{
 const listeners=new Map();globalThis.document={visibilityState:'hidden',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 setup();let release;lr.read=()=>new Promise(done=>release=done);
 try{const work=lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('report'))),staleTime:0}).catch(e=>e);await tick();listeners.get('visibilitychange')();assert.equal(lr.client.getQueryState(key('report')).fetchStatus,'fetching');document.visibilityState='visible';listeners.get('visibilitychange')();await tick();assert.equal(lr.client.getQueryState(key('report')).fetchStatus,'idle');assert.equal(lr.client.getQueryState(key('report')).isInvalidated,true);assert.equal(lr.client.getQueryState(key('today')).isInvalidated,true);release(lr.report);await work;assert.deepEqual(lr.writes,[]);}finally{cleanup();delete globalThis.document;}
});
test('preview GET accepts INT4 maximum and rejects maximum plus one before transport',async()=>{const hook=setup();try{await hook.requestPreview(2147483647);assert.deepEqual(lr.reads,[['today',2147483647]]);assert.equal(render().preview.selectedForecast.todayAmount,2147483647);await hook.requestPreview(2147483648);assert.equal(lr.reads.length,1);assert.deepEqual(lr.writes,[]);}finally{cleanup();}});

for(const kind of ['rollback','withdraw'])for(const committed of [false,true])test(`${kind} response lost (committed=${committed}): both fresh reads required, remount stays masked, no automatic write`,async()=>{
 const hook=setup();const old=lr.selected;let serverReport=lr.report,serverToday=lr.selected;
 lr.write=async(type,body)=>{lr.writes.push([type,body]);if(committed){serverReport={...lr.report,activeRevision:3,activeArtifactId:null,...(kind==='withdraw'?{participation:null,artifacts:[]}:{} )};serverToday={selectedForecast:{...old.selectedForecast,activeRevision:3,source:'BASELINE',artifactId:null,artifactHash:null}};}throw new ApiError(500,null);};
 lr.read=async()=>{throw new ApiError(500,null);};
 try{
  await hook.action(kind);sync();assert.equal(render().selected,undefined);assert.equal(render().awaitingConfirmation,true);
  // Actual QueryClient error settlement preserves cached LEARNED data, which must stay hidden.
  for(const part of ['report','today'])await assert.rejects(lr.client.fetchQuery({...lr.options.get(JSON.stringify(key(part))),staleTime:0}),ApiError);
  sync();assert.equal(lr.client.getQueryData(key('today')),old);assert.equal(render().selected,undefined);
  lr.effects.forEach(e=>e.cleanup?.());lr.refs=[];lr.states=[];lr.effects=[];sync();assert.equal(render().selected,undefined);assert.equal(render().awaitingConfirmation,true);
  await render().action('fit');await render().requestPreview(15);assert.equal(lr.writes.length,1);
  lr.read=async(part)=>part==='report'?serverReport:serverToday;
  await lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('report'))),staleTime:0});sync();assert.equal(render().selected,undefined);assert.equal(render().awaitingConfirmation,true);
  await lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('today'))),staleTime:0});sync();assert.equal(render().awaitingConfirmation,false);assert.deepEqual(render().selected,serverToday);
  sync();lr.read=async()=>{throw new ApiError(500,null);};for(const part of ['report','today'])await assert.rejects(lr.client.fetchQuery({...lr.options.get(JSON.stringify(key(part))),staleTime:0}),ApiError);
  sync();assert.equal(render().awaitingConfirmation,false);assert.deepEqual(render().selected,serverToday);assert.equal(lr.writes.length,1);
 }finally{cleanup();}
});
test('uncertain rollback can explicitly refresh reads without resending the write, and rejects mismatched revisions',async()=>{
 const hook=setup();try{lr.write=async(kind,body)=>{lr.writes.push([kind,body]);throw new ApiError(500,null);};await hook.action('rollback');sync();
 lr.read=async(part)=>part==='report'?{...lr.report,activeRevision:3}:lr.selected;await render().action('refresh');sync();assert.equal(render().selected,undefined);assert.equal(render().awaitingConfirmation,true);
 lr.read=async(part)=>part==='report'?{...lr.report,activeRevision:3}:{selectedForecast:{...lr.selected.selectedForecast,activeRevision:3,source:'BASELINE'}};await render().action('refresh');sync();assert.equal(render().awaitingConfirmation,false);assert.equal(render().selected.selectedForecast.source,'BASELINE');assert.equal(lr.writes.length,1);
 }finally{cleanup();}
});
function publishSession(owner,changes={}){lr.session={...lr.session,data:owner===null?null:{user:{id:owner}},isPending:false,isRefetching:false,error:null,...changes};for(const fn of [...lr.ownerListeners])fn();}
for(const kind of ['rollback','withdraw'])test(`${kind}: same-owner auth reset preserves metadata through StrictMode/remount, then first two fresh GETs release`,async()=>{
 const hook=setup();try{
  // Counts greater than one before reset expose an incorrect old-count comparison.
  for(let n=0;n<3;n++)for(const part of ['report','today'])lr.client.setQueryData(key(part),{...lr.client.getQueryData(key(part))});sync();
  lr.write=async(type,body)=>{lr.writes.push([type,body]);throw new ApiError(500,null);};await hook.action(kind);sync();assert.equal(render().awaitingConfirmation,true);assert.equal(lr.ownerListeners.size,1);
  const metadata=lr.client.getQueryCache().find({queryKey:key('confirmation')}).meta.learningConfirmation;
  publishSession('A',{isRefetching:true});publishSession('A',{error:new ApiError(401,null)});assert.equal(metadata.pending!==null,true,'checking/error with old owner is not confirmed logout');
  await lr.client.cancelQueries({queryKey:['goals']});await lr.client.resetQueries({queryKey:['goals']});lr.epoch={owner:'A',clearedAt:0};lr.queryGeneration++;publishSession('A');sync();
  assert.equal(lr.client.getQueryData(key('confirmation')),undefined);assert.equal(metadata.pending.report.count,0);assert.equal(metadata.pending.today.count,0);
  for(let n=0;n<2;n++){lr.effects.forEach(e=>e.cleanup?.());lr.refs=[];lr.states=[];lr.effects=[];sync();assert.equal(render().awaitingConfirmation,true);assert.equal(render().selected,undefined);assert.equal(lr.ownerListeners.size,1);assert.equal(lr.client.getQueryCache().find({queryKey:key('confirmation')}).meta.learningConfirmation,metadata);}
  lr.read=async(part)=>{if(part==='today')throw new ApiError(500,null);return lr.report;};await lr.client.fetchQuery(lr.options.get(JSON.stringify(key('report'))));await assert.rejects(lr.client.fetchQuery(lr.options.get(JSON.stringify(key('today')))),ApiError);sync();
  assert.equal(lr.client.getQueryState(key('report')).dataUpdateCount,1);assert.equal(render().awaitingConfirmation,true);await render().action('fit');await render().requestPreview(15);assert.equal(lr.writes.length,1);
  lr.read=async()=>lr.selected;await lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('today'))),staleTime:0});sync();assert.equal(render().awaitingConfirmation,false);assert.deepEqual(render().selected,lr.selected);assert.equal(lr.ownerListeners.size,0,'confirmed pair releases orphan session listener');
 }finally{cleanup();}
});
for(const destination of [null,'B'])test(`confirmed ${destination===null?'logout':'cross-owner'} removes metadata, A return does not revive it`,async()=>{
 const hook=setup();try{lr.write=async()=>{throw new ApiError(500,null);};await hook.action('rollback');const old=lr.client.getQueryCache().find({queryKey:key('confirmation')}).meta.learningConfirmation;assert.equal(lr.ownerListeners.size,1);
  publishSession(destination);lr.epoch={owner:destination,clearedAt:0};lr.generation++;lr.queryGeneration++;await lr.client.resetQueries({queryKey:['goals']});assert.equal(old.pending,null);assert.equal(lr.client.getQueryState(key('confirmation')),undefined);assert.equal(lr.ownerListeners.size,0);
  publishSession('A');lr.epoch={owner:'A',clearedAt:0};lr.generation++;lr.queryGeneration++;lr.effects.forEach(e=>e.cleanup?.());lr.refs=[];lr.states=[];lr.effects=[];sync();assert.equal(render().awaitingConfirmation,false);assert.equal(render().selected,undefined);
 }finally{cleanup();}
});
test('confirmed owner roundtrip during held mutation removes old marker and suppresses late completion',async()=>{
 const hook=setup();let release;try{lr.write=(kind,body)=>{lr.writes.push([kind,body]);return new Promise(done=>release=done);};const work=hook.action('rollback');await tick();assert.equal(lr.ownerListeners.size,1);
  publishSession('B');lr.epoch={owner:'B',clearedAt:0};lr.generation++;lr.queryGeneration++;publishSession('A');lr.epoch={owner:'A',clearedAt:0};lr.generation++;lr.queryGeneration++;await lr.client.resetQueries({queryKey:['goals']});release();await work;sync();assert.equal(render().awaitingConfirmation,false);assert.equal(render().selected,undefined);assert.equal(lr.reads.length,0);assert.equal(lr.writes.length,1);assert.equal(lr.ownerListeners.size,0);
 }finally{cleanup();}
});
test('ordinary external refetch masks an existing preview while the real QueryClient read is pending',async()=>{
 const hook=setup();let release;try{await hook.requestPreview(15);assert.ok(render().preview);lr.read=()=>new Promise(done=>release=done);const work=lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('report'))),staleTime:0});await tick();sync();assert.equal(render().preview,null);assert.equal(render().busy,true);release(lr.report);await work;sync();assert.ok(render().preview);}finally{cleanup();}
});

function experimentFixture(){const a={...lr.artifact,purpose:'EXPERIMENTAL',goalSettingsRevision:4,answerRevision:'answer-7'};lr.report.artifacts=[a];return a;}
function comparisonFixture(a,amount=15){const v={status:'available',reason:null,p50Days:12,p80Days:null,horizonDays:30,reachProbability:.7,todayAmount:amount,hypothetical:true};return{baseline:{},reference:{...v,source:'BASELINE'},experiment:{...v,source:'EXPERIMENTAL',artifactId:a.id,artifactHash:a.hash},goalSettingsRevision:4,answerRevision:'answer-7',activeRevision:2};}
test('explicit experiment fit sends one exact CAS POST and refreshes both reads without activation',async()=>{const hook=setup();try{await hook.action('experiment');assert.deepEqual(lr.writes,[['experiment',{expectedParticipationId:'participation',expectedGoalSettingsRevision:4,expectedAnswerRevision:'answer-7',expectedActiveRevision:2}]]);assert.deepEqual(lr.reads,[['report',undefined],['today',undefined]]);}finally{cleanup();}});
test('EXPERIMENTAL purpose cannot activate even with forged qualified gate',async()=>{setup();try{const a=experimentFixture();await render().action('activate',a);assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('comparison is explicit GET only, newest amount/zero request wins with no active write',async()=>{setup();const a=experimentFixture(),releases=[];lr.compare=(id,hash,amount)=>new Promise(done=>releases.push({id,hash,amount,done}));try{const hook=render(),old=hook.requestComparison(a,15),latest=hook.requestComparison(a,0);releases[1].done(comparisonFixture(a,0));await latest;releases[0].done(comparisonFixture(a,15));await old;assert.equal(render().comparison.experiment.todayAmount,0);assert.deepEqual(lr.writes,[]);assert.deepEqual(releases.map(({id,hash,amount})=>[id,hash,amount]),[['artifact','exact-hash',15],['artifact','exact-hash',0]]);}finally{cleanup();}});
for(const drift of ['owner','roundtrip','day','corrected-report','corrected-today','active','hash','horizon','source'])test('held experimental comparison rejects '+drift+' change',async()=>{setup();const a=experimentFixture();let release;lr.compare=()=>new Promise(done=>release=done);try{const work=render().requestComparison(a,15),c=comparisonFixture(a);if(drift==='owner'){lr.epoch={owner:'B',clearedAt:0};lr.generation++;lr.queryGeneration++;}if(drift==='roundtrip'){lr.generation+=2;lr.queryGeneration+=2;}if(drift==='day')render(true,'next-day');if(drift==='corrected-report')lr.client.setQueryData(key('report'),{...lr.report});if(drift==='corrected-today')lr.client.setQueryData(key('today'),{...lr.selected});if(drift==='active')c.activeRevision++;if(drift==='hash')c.experiment.artifactHash='wrong';if(drift==='horizon')c.experiment.horizonDays=29;if(drift==='source')c.experiment.source='BASELINE';release(c);await work;sync();assert.equal(render().comparison,null);assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('uncertain write and external refetch suppress experiment comparison and dispatch no extra GET',async()=>{setup();const a=experimentFixture();let calls=0;lr.compare=async()=>{calls++;return comparisonFixture(a);};try{await render().requestComparison(a,15);assert.ok(render().comparison);const previous=lr.queries.get(JSON.stringify(key('today')));lr.queries.set(JSON.stringify(key('today')),{...previous,isFetching:true});assert.equal(render().comparison,null);await render().requestComparison(a,15);assert.equal(calls,1);sync();lr.write=async()=>{throw new ApiError(500,null);};await render().action('experiment');sync();await render().requestComparison(a,15);assert.equal(render().comparison,null);assert.equal(calls,1);}finally{cleanup();}});
test('comparison rejects invalid INT4 amount, nonmember and stale settings before transport',async()=>{setup();const a=experimentFixture();let calls=0;lr.compare=async()=>{calls++;return comparisonFixture(a);};try{const hook=render();for(const amount of [-1,1.2,2147483648])await hook.requestComparison(a,amount);await hook.requestComparison({...a,hash:'other'},15);await hook.requestComparison({...a,goalSettingsRevision:5},15);assert.equal(calls,0);}finally{cleanup();}});
test('already displayed comparison stays hidden after same-revision history refetch completes',async()=>{setup();const a=experimentFixture();lr.compare=async()=>comparisonFixture(a);try{await render().requestComparison(a,15);assert.ok(render().comparison);lr.client.setQueryData(key('report'),{...lr.report});lr.client.setQueryData(key('today'),{...lr.selected});sync();assert.equal(render().comparison,null);await render().requestComparison(a,15);assert.ok(render().comparison);}finally{cleanup();}});
test('query reset ABA invalidates a held comparison even when identity and successful counts return to original values',async()=>{setup();const a=experimentFixture();let release;lr.compare=()=>new Promise(done=>release=done);try{const work=render().requestComparison(a,15);await lr.client.resetQueries({queryKey:['goals']});lr.client.setQueryData(key('report'),lr.report);lr.client.setQueryData(key('today'),lr.selected);release(comparisonFixture(a));await work;sync();assert.equal(render().comparison,null);assert.deepEqual(lr.writes,[]);}finally{cleanup();}});
test('parallel production report/Today QueryClient reads both succeed; comparison-only success invalidation does not reject the slower read',async()=>{setup();let reportRelease,todayRelease;lr.read=kind=>new Promise(done=>{if(kind==='report')reportRelease=done;else todayRelease=done;});try{const report=lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('report'))),staleTime:0}),today=lr.client.fetchQuery({...lr.options.get(JSON.stringify(key('today'))),staleTime:0});await tick();reportRelease(lr.report);await report;todayRelease(lr.selected);await today;sync();assert.equal(render().reportQuery.isSuccess,true);assert.equal(render().todayQuery.isSuccess,true);}finally{cleanup();}});
