import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineCompletionCdf, forecastDurationModel, predictWithQuestionPrior } from '@futureroi/prediction';
import { baselineAt, completionLabels, compareLearningModel, computeLearningExperiment, computeLearningFit, learningArtifactEligibility, learningArtifactUsability, learningInputHash, planLearningFit, selectLearningToday, R11_COMPARISON_PRIORS } from '../src/learning/service.ts';
import { completionRps, assessLearningGate, assessLearningGateFamily, emptyLearningGate } from '../src/learning/gates.ts';
import { learningPolicy } from '../src/learning/policy.ts';
import { shiftLocalDate } from '../src/goals/local-date.ts';
import { QUESTION_MAPPING, makeQuestionSnapshot } from '../src/questions/snapshot.ts';
import type { TodaySnapshot } from '../src/prediction/store.ts';
import type { LearningReadState, StoredLearningArtifact } from '../src/learning/types.ts';
const policy=learningPolicy({enabled:true});
function snapshot(n=500):TodaySnapshot {const start='2025-01-01';return {now:new Date(shiftLocalDate(start,n)+'T12:00:00Z'),
 goal:{totalRequired:10000,initialProgress:0,sessionAmount:10,timezone:'UTC',recordStartDate:start,unit:'minutes',goalSettingsRevision:0,unitLocked:true},
 question:{question_prior:{a:null,b:null},answer_revision:'0',question_prior_snapshot:null},
 logs:Array.from({length:n},(_,i)=>({localDate:shiftLocalDate(start,i),status:i%3===0?'DONE' as const:'SKIPPED' as const,amount:i%3===0?10:null}))};}
function state(s:TodaySnapshot):LearningReadState{return {snapshot:s,participationId:'synthetic-participant',participationExpiresAt:new Date(s.now.getTime()+86400000),participationJoinedAt:new Date(s.now),
 holdoutThrough:null,fitGeneration:1,activeRevision:0,activeArtifactId:null,artifacts:[]};}
test('RPS includes the after-horizon outcome without renormalizing finite mass',()=>{
 assert.equal(completionRps([0,.25,.5],[0,0,0]),(.25**2+.5**2)/2);
 assert.equal(completionRps([0,.25,.5],[0,0,1]),(.25**2+(.5-1)**2)/2);
 assert.throws(()=>completionRps([0,.5,.4],[0,0,1]),RangeError);
});
test('mature labels exclude missing days before completion, preserve explicit skip and actual amount',()=>{
 const logs=[{localDate:'2026-01-02',status:'DONE' as const,amount:3},{localDate:'2026-01-03',status:'SKIPPED' as const,amount:null},
 {localDate:'2026-01-04',status:'DONE' as const,amount:7}];
 assert.deepEqual(completionLabels(logs,'2026-01-01',10,5),[0,0,0,1,1,1]);
 assert.equal(completionLabels(logs.filter(r=>r.localDate!=='2026-01-03'),'2026-01-01',10,5),null);
 assert.deepEqual(completionLabels(logs,'2026-01-01',3,5),[0,1,1,1,1,1]);
});
test('fixed chronological partition never observes train future or validation labels crossing test',()=>{
 const s=snapshot(),p=planLearningFit(s,policy,null);assert.equal(p.reason,null);
 assert.equal(p.trainingCutoff,s.logs[299]!.localDate);assert.equal(p.validationAnchors.length,16);assert.equal(p.testAnchors.length,16);
 assert.ok(p.validationAnchors.every(d=>d>p.trainingCutoff&&shiftLocalDate(d,32)<p.testAnchors[0]!));
 assert.ok(p.testAnchors.every(d=>shiftLocalDate(d,32)<=s.now.toISOString().slice(0,10)));
 assert.equal(planLearningFit(s,policy,p.holdoutThrough).reason,'HOLDOUT_ALREADY_USED');
});
test('full-prefix comparator includes unknown-duration skip origins and matches current R11 posterior',()=>{
 const s=snapshot(10);s.logs.splice(3,1);const anchor=s.logs.at(-1)!.localDate;
 const engine=predictWithQuestionPrior({prediction:{goal:s.goal,logs:s.logs,today:anchor},answers:s.question.question_prior,mapping:QUESTION_MAPPING});
 const actual=baselineAt(s,anchor,'DONE',20,30)!;
 assert.deepEqual(actual,baselineCompletionCdf(engine.prediction.posterior,'DONE',20,10,30));
 const q=(threshold:number)=>actual.findIndex(v=>v>=threshold);
 // Recorded snapshot uses exactly the same remaining amount and current state.
 s.goal.totalRequired=engine.prediction.progress.done+20;s.logs[s.logs.length-1]={...s.logs.at(-1)!,status:'DONE',amount:10};
 const direct=predictWithQuestionPrior({prediction:{goal:s.goal,logs:s.logs,today:anchor},answers:s.question.question_prior,mapping:QUESTION_MAPPING});
 if(direct.prediction.completion.status==='available'){
 const cdf=baselineAt(s,anchor,'DONE',s.goal.totalRequired-direct.prediction.progress.done,30)!;
 assert.equal(cdf.findIndex(v=>v>=.5),direct.prediction.completion.p50Days);assert.equal(cdf.findIndex(v=>v>=.8),direct.prediction.completion.p80Days);}
 assert.ok(q(.5)>0);
});
test('gate requires certified finite-approximation score improvement in both untouched partitions',()=>{
 const rows=Array.from({length:16},(_,i)=>({anchor:shiftLocalDate('2025-01-01',i*5),labels:[0,1,1] as (0|1)[],baseline:[0,.5,.9],candidate:[0,.9,1],candidateError:.01,applied:true}));
 assert.equal(assessLearningGate(rows,rows,2,100,0).status,'ADOPTABLE');
 assert.equal(assessLearningGate(rows,rows.map(r=>({...r,candidateError:.6})),2,100,0).status,'REJECTED');
 assert.equal(assessLearningGate(rows.slice(0,15),rows,2,100,0).status,'INSUFFICIENT');
 assert.equal(assessLearningGate(rows.map(r=>({...r,applied:false})),rows,2,100,0).status,'INSUFFICIENT');
});
test('the fixed comparator family includes all nine real R11 priors and any failure prevents adoption',()=>{
 assert.equal(R11_COMPARISON_PRIORS.length,9);
 const s=snapshot(10),anchor=s.logs.at(-1)!.localDate;
 for(const a of ['LOW','MID','HIGH'] as const)for(const b of ['LOW','MID','HIGH'] as const){
   const prior={a:QUESTION_MAPPING.values[a],b:QUESTION_MAPPING.values[b]};
   assert.ok(R11_COMPARISON_PRIORS.some(p=>p.a===prior.a&&p.b===prior.b));
   const r11=predictWithQuestionPrior({prediction:{goal:s.goal,logs:s.logs,today:anchor},answers:{a,b},mapping:QUESTION_MAPPING});
   assert.deepEqual(baselineAt(s,anchor,'DONE',20,30,prior),baselineCompletionCdf(r11.prediction.posterior,'DONE',20,10,30));
 }
 const passed={...emptyLearningGate(''),status:'ADOPTABLE' as const,reasons:[],baselineRps:.2,candidateRps:.1};
 const failed={...passed,status:'REJECTED' as const,reasons:['TEST_RPS_NOT_CERTIFIED_BETTER'],baselineRps:.1,candidateRps:.1};
 assert.equal(assessLearningGateFamily(Array(9).fill(passed)).status,'ADOPTABLE');
 const family=assessLearningGateFamily([...Array(8).fill(passed),failed]);
 assert.equal(family.status,'REJECTED');assert.equal(family.baselineRps,.1);assert.deepEqual(family.reasons,failed.reasons);
 assert.throws(()=>assessLearningGateFamily([]),RangeError);
});
test('answers changed after the historical cutoff cannot change the learned fit or its gate',()=>{
 const s=snapshot();s.goal.totalRequired=1700;
 const context={unit:s.goal.unit,sessionAmount:s.goal.sessionAmount,recordStartDate:s.goal.recordStartDate};
 const before=structuredClone(s),after=structuredClone(s);
 before.question={question_prior:{a:'LOW',b:'HIGH'},answer_revision:'8',question_prior_snapshot:makeQuestionSnapshot({a:'LOW',b:'HIGH'},context)};
 after.question={question_prior:{a:'HIGH',b:'LOW'},answer_revision:'9',question_prior_snapshot:makeQuestionSnapshot({a:'HIGH',b:'LOW'},context)};
 const first=computeLearningFit(before,policy),second=computeLearningFit(after,policy);
 assert.notEqual(first.numeric,null);assert.equal(first.comparison.protocolVersion,'duration-chronological-v2');
 assert.deepEqual(first.numeric,second.numeric);assert.deepEqual(first.gate,second.gate);
 const anchor=s.logs.at(-1)!.localDate;
 assert.notDeepEqual(baselineAt(before,anchor,'DONE',20,30),baselineAt(after,anchor,'DONE',20,30));
});
test('gate cannot improve score by replacing finite baseline with null quantiles',()=>{
 const rows=Array.from({length:16},(_,i)=>({anchor:shiftLocalDate('2025-01-01',i*5),labels:[0,0,0] as (0|1)[],baseline:[0,.5,.9],candidate:[0,.1,.2],candidateError:0,applied:true}));
 const gate=assessLearningGate(rows,rows,2,100,0);assert.equal(gate.status,'REJECTED');assert.ok(gate.reasons.includes('TEST_P80_FINITE_WORSENED_OR_UNCERTAIN'));
});
test('insufficient history remains an insufficient artifact, with no fitted model',()=>{
 const s=snapshot(2),fit=computeLearningFit(s,policy);assert.equal(fit.numeric,null);assert.equal(fit.gate.status,'INSUFFICIENT');
});
test('unreachable holdout goals do not count exact zero CDFs as learned application',()=>{
 const s=snapshot(),fit=computeLearningFit(s,policy);
 assert.notEqual(fit.numeric,null);assert.equal(fit.gate.validationOrigins,16);assert.equal(fit.gate.testOrigins,16);
 assert.equal(fit.gate.appliedOrigins,0);assert.equal(fit.gate.fallbackOrigins,32);
 assert.equal(fit.gate.status,'INSUFFICIENT');
});
test('eligibility freezes both training input and holdout evidence; append preserves them',()=>{
 const s=snapshot(),plan=planLearningFit(s,policy);const st=state(s);
 const artifact:StoredLearningArtifact={id:'a',hash:'h',modelVersion:'duration-model-v1',createdAt:new Date(s.now),expiresAt:new Date(s.now.getTime()+86400000),
 trainingCutoff:plan.trainingCutoff,goalSettingsRevision:0,answerRevision:0,inputHash:learningInputHash(s,plan.trainingCutoff),evidenceHash:learningInputHash(s,plan.holdoutThrough!),comparison:plan,
 numeric:{kind:'BETA_BASELINE_V1',modelVersion:'duration-model-v1',capDays:14,posterior:{a:{alpha:2,beta:2},b:{alpha:2,beta:2}},training:{doneOrigins:40,skipOrigins:40,excludedUnknownDuration:0}},gate:{...emptyLearningGate(''),status:'ADOPTABLE',reasons:[]}};
 assert.equal(learningArtifactEligibility(artifact,st,policy),null);
 assert.equal(learningArtifactEligibility(artifact,st,{...policy,observationDays:1}),'MODEL_CONTEXT_CHANGED');
 s.logs.push({localDate:s.now.toISOString().slice(0,10),status:'SKIPPED',amount:null});assert.equal(learningArtifactEligibility(artifact,st,policy),null);
 const held=s.logs.find(r=>r.localDate===plan.testAnchors[0])!;held.status='DONE';held.amount=999;
 assert.equal(learningArtifactEligibility(artifact,st,policy),'EVIDENCE_CORRECTED');
});
test('today quantity substitutes once and never mutates recorded logs',()=>{
 const s=snapshot(10);s.now=new Date(s.logs.at(-1)!.localDate+'T12:00:00Z');s.goal.totalRequired=50;const before=structuredClone(s.logs);
 const st=state(s);const result=selectLearningToday(st,policy,20);assert.equal(result.selectedForecast.status,'completed');
 assert.equal(result.selectedForecast.todayAmount,20);assert.equal(result.selectedForecast.hypothetical,true);assert.deepEqual(s.logs,before);
 const zero=selectLearningToday(st,policy,0);assert.equal(zero.selectedForecast.status,'available');assert.equal(zero.selectedForecast.source,'BASELINE');
});
test('an active model cannot replace the real R11 main forecast with unreachable H-day zero CDFs',()=>{
 const s=snapshot(),st=state(s);s.goal.totalRequired=s.logs.reduce((sum,row)=>sum+(row.amount??0),0)+790;
 const fit=computeLearningFit(s,policy);assert.notEqual(fit.numeric,null);assert.equal(fit.gate.status,'INSUFFICIENT');
 // Qualification is stubbed solely to exercise the selector boundary; this is not adoption evidence.
 const artifact:StoredLearningArtifact={id:'boundary-stub',hash:'boundary-stub-hash',modelVersion:fit.modelVersion,
  createdAt:new Date(s.now),expiresAt:new Date(s.now.getTime()+86400000),trainingCutoff:fit.trainingCutoff,
  goalSettingsRevision:0,answerRevision:0,inputHash:fit.inputHash,evidenceHash:fit.evidenceHash,comparison:fit.comparison,
  numeric:fit.numeric,gate:{...fit.gate,status:'ADOPTABLE',reasons:[]}};
 st.artifacts=[artifact];st.activeArtifactId=artifact.id;
 const main=selectLearningToday(st,policy);assert.equal(main.selectedForecast.source,'BASELINE');
 assert.equal(main.selectedForecast.reason,'BEYOND_LEARNING_HORIZON');
 assert.equal(main.selectedForecast.horizonDays,main.baseline.prediction.config.horizonDays);
 assert.equal(main.baseline.prediction.completion.status,'available');
 if(main.baseline.prediction.completion.status==='available'){
  assert.notEqual(main.baseline.prediction.completion.p80Days,null);
  assert.equal(main.selectedForecast.p50Days,main.baseline.prediction.completion.p50Days);
  assert.equal(main.selectedForecast.p80Days,main.baseline.prediction.completion.p80Days);
 }
 const preview=selectLearningToday(st,policy,0);assert.equal(preview.selectedForecast.source,'BASELINE');
 assert.equal(preview.selectedForecast.reason,'BEYOND_LEARNING_HORIZON');assert.equal(preview.selectedForecast.reachProbability,0);
 for(const status of ['DONE','SKIPPED'] as const){
  s.logs=s.logs.filter(row=>row.localDate!==s.now.toISOString().slice(0,10));
  s.logs.push({localDate:s.now.toISOString().slice(0,10),status,amount:status==='DONE'?10:null});
  const recorded=selectLearningToday(st,policy);assert.equal(recorded.selectedForecast.source,'BASELINE');
  assert.equal(recorded.selectedForecast.reason,'BEYOND_LEARNING_HORIZON');
  assert.equal(recorded.selectedForecast.todayAmount,null);assert.equal(recorded.selectedForecast.hypothetical,false);
  if(recorded.baseline.prediction.completion.status==='available'){
   assert.equal(recorded.selectedForecast.p80Days,recorded.baseline.prediction.completion.p80Days);
  }
 }
});
test('real history fits an unqualified experiment and compares the same quantity without changing the main selection',()=>{
 const s=snapshot(12);s.goal.totalRequired=s.logs.reduce((sum,row)=>sum+(row.amount??0),0)+30;
 const st=state(s),fit=computeLearningExperiment(s,policy);
 assert.equal(fit.purpose,'EXPERIMENTAL');assert.equal(fit.gate.status,'INSUFFICIENT');
 assert.deepEqual(fit.gate.reasons,['EXPERIMENTAL_NOT_QUALIFIED']);assert.notEqual(fit.numeric,null);
 assert.equal(fit.comparison.protocolVersion,'duration-experimental-v1');assert.equal(fit.comparison.holdoutThrough,null);
 assert.equal(fit.trainingCutoff,s.logs.at(-1)!.localDate);
 const artifact:StoredLearningArtifact={id:'real-experiment',hash:'real-experiment-hash',purpose:'EXPERIMENTAL',
  modelVersion:fit.modelVersion,createdAt:new Date(s.now),expiresAt:new Date(s.now.getTime()+30*86400000),
  trainingCutoff:fit.trainingCutoff,goalSettingsRevision:0,answerRevision:0,inputHash:fit.inputHash,evidenceHash:fit.evidenceHash,
  comparison:fit.comparison,numeric:fit.numeric,gate:fit.gate};
 st.artifacts=[artifact];st.participationExpiresAt=new Date(s.now.getTime()+90*86400000);
 assert.equal(learningArtifactUsability(artifact,st,policy),null);assert.notEqual(learningArtifactEligibility(artifact,st,policy),null);
 const before=structuredClone(st),view=compareLearningModel(st,policy,artifact.id,artifact.hash,10);
 assert.equal(view.experiment.source,'EXPERIMENTAL');assert.equal(view.experiment.status,'available');
 assert.equal(view.reference.source,'BASELINE');assert.equal(view.reference.todayAmount,10);assert.equal(view.experiment.todayAmount,10);
 const direct=forecastDurationModel(fit.numeric!,{initialState:'DONE',initialRestDays:0,remainingAmount:20,sessionAmount:10,
  horizonDays:30,samples:8192,seed:20261011});assert.equal(direct.status,'available');
 if(direct.status==='available'){
  assert.equal(view.experiment.p50Days,direct.p50Days);assert.equal(view.experiment.p80Days,direct.p80Days);
  assert.equal(view.experiment.reachProbability,direct.cdf[30]);
 }
 assert.equal(selectLearningToday(st,policy).selectedForecast.source,'BASELINE');assert.deepEqual(st,before);
 s.logs.push({localDate:s.now.toISOString().slice(0,10),status:'DONE',amount:10});
 assert.equal(learningArtifactUsability(artifact,st,policy),null,'new records after the observed cutoff preserve the frozen model');
 // Future missing calendar days make rest age unknown, without correcting the training prefix.
 s.now=new Date(shiftLocalDate(s.now.toISOString().slice(0,10),8)+'T12:00:00Z');
 const unknown=compareLearningModel(st,policy,artifact.id,artifact.hash,0);
 assert.equal(unknown.reference.status,'available');assert.equal(unknown.experiment.status,'insufficient');
 assert.equal(unknown.experiment.reason,'UNKNOWN_CURRENT_DURATION');
 assert.equal(unknown.experiment.p50Days,null);assert.equal(unknown.experiment.p80Days,null);assert.equal(unknown.experiment.reachProbability,null);
 s.logs[0]!.amount=11;
 assert.equal(compareLearningModel(st,policy,artifact.id,artifact.hash,10).experiment.reason,'INPUT_CORRECTED');
});
test('experiment fitting preserves mathematical insufficiency and the record work limit',()=>{
 const missing=computeLearningExperiment(snapshot(2),policy);assert.equal(missing.numeric,null);
 assert.deepEqual(missing.gate.reasons,['NO_SKIP_ORIGIN_TRANSITION']);assert.equal(missing.gate.status,'INSUFFICIENT');
 const bounded=computeLearningExperiment(snapshot(1096),policy);assert.equal(bounded.numeric,null);
 assert.deepEqual(bounded.gate.reasons,['RECORD_WORK_LIMIT']);
});
