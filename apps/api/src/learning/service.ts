import { createHash } from 'node:crypto';
import { baselineCompletionCdf, fitDurationModel, forecastDurationModel, observeDuration,
  type DurationArtifact, type DurationPrior, type PredictionInput } from '@futureroi/prediction';
import type { LearningComparison, LearningPolicy, LearningReferenceForecast, TodayLearning } from '../contracts/learning.ts';
import type { Log } from '../contracts/log.ts';
import { localDateIn, shiftLocalDate } from '../goals/local-date.ts';
import { buildR11Today } from '../prediction/r11.ts';
import type { TodaySnapshot } from '../prediction/store.ts';
import { answerRevision, validateSavedQuestion, QUESTION_MAPPING } from '../questions/snapshot.ts';
import { assessLearningGate, assessLearningGateFamily, completionQuantile, emptyLearningGate, LEARNING_PROTOCOL, type ComparisonOrigin } from './gates.ts';
import type { LearningFitComputation, LearningFitPlan, LearningReadState, StoredLearningArtifact } from './types.ts';

// Server-owned, fixed before seeing holdout labels. No client tuning or automatic adoption.
export const DURATION_GAMMA_PRIOR = Object.freeze(Array.from({length:17},(_,i)=>({gamma:(i-8)/2,mass:Math.exp(-0.5*(((i-8)/2)/1.5)**2)})));
export const FIXED_LEARNING_PRIOR:DurationPrior = Object.freeze({a:QUESTION_MAPPING.values.MID,b:QUESTION_MAPPING.values.MID});
// The entire nine-prior family is fixed before labels; current answers never choose a historical comparator.
export const R11_COMPARISON_PRIORS:readonly DurationPrior[] = Object.freeze(Object.values(QUESTION_MAPPING.values)
  .flatMap(a=>Object.values(QUESTION_MAPPING.values).map(b=>Object.freeze({a,b}))));
function today(snapshot:TodaySnapshot){return localDateIn(snapshot.now,snapshot.goal.timezone);}
function input(snapshot:TodaySnapshot,anchor:string):PredictionInput {
  return {goal:snapshot.goal,logs:snapshot.logs.filter(log=>log.localDate<=anchor),today:anchor};
}
function prior(snapshot:TodaySnapshot):DurationPrior {
  const saved=validateSavedQuestion(snapshot.question,{unit:snapshot.goal.unit,sessionAmount:snapshot.goal.sessionAmount,recordStartDate:snapshot.goal.recordStartDate});
  const shape=(answer:typeof saved.answers.a)=>({...saved.mapping.values[answer===null||answer==='UNKNOWN'?'MID':answer]});
  return {a:shape(saved.answers.a),b:shape(saved.answers.b)};
}
export function learningInputHash(snapshot:TodaySnapshot,cutoff:string):string {
  return createHash('sha256').update(JSON.stringify(snapshot.logs.filter(log=>log.localDate<=cutoff)
    .map(log=>[log.localDate,log.status,log.amount]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex');
}
function fixedAnchors(dates:string[]):string[]{
  const n=LEARNING_PROTOCOL.originsPerPartition;if(dates.length<n)return dates;
  return Array.from({length:n},(_,i)=>dates[Math.floor(i*(dates.length-1)/(n-1))]!);
}
export function planLearningFit(snapshot:TodaySnapshot,policy:LearningPolicy,previousHoldoutThrough:string|null=null):LearningFitPlan {
  const dates=snapshot.logs.map(log=>log.localDate).sort();const last=today(snapshot),H=policy.observationDays;
  const blank:LearningFitPlan={protocolVersion:LEARNING_PROTOCOL.version,horizonDays:H,trainingCutoff:dates[0]??last,validationAnchors:[],testAnchors:[],holdoutThrough:null,reason:null};
  if(dates.length>LEARNING_PROTOCOL.maxRecords)return {...blank,reason:'RECORD_WORK_LIMIT'};
  if(dates.length<3)return {...blank,reason:'HISTORY_INSUFFICIENT'};
  const fresh=previousHoldoutThrough===null?dates:dates.filter(date=>date>previousHoldoutThrough);
  if(fresh.length<2)return {...blank,trainingCutoff:previousHoldoutThrough??blank.trainingCutoff,reason:'HOLDOUT_ALREADY_USED'};
  const trainEnd=previousHoldoutThrough??dates[Math.max(0,Math.floor(dates.length*.6)-1)]!;
  const testStart=previousHoldoutThrough===null?dates[Math.floor(dates.length*.8)]!:fresh[Math.floor(fresh.length/2)]!;
  const validation=fixedAnchors(dates.filter(date=>date>trainEnd&&shiftLocalDate(date,H+2)<testStart));
  const test=fixedAnchors(dates.filter(date=>date>=testStart&&shiftLocalDate(date,H+2)<=last));
  if(validation.length<LEARNING_PROTOCOL.originsPerPartition||test.length<LEARNING_PROTOCOL.originsPerPartition)
    return {...blank,trainingCutoff:trainEnd,reason:previousHoldoutThrough?'FRESH_HOLDOUT_INSUFFICIENT':'HOLDOUT_INSUFFICIENT'};
  return {...blank,trainingCutoff:trainEnd,validationAnchors:validation,testAnchors:test,holdoutThrough:shiftLocalDate(test.at(-1)!,H)};
}
export function baselineAt(snapshot:TodaySnapshot,anchor:string,state:'DONE'|'SKIPPED',remaining:number,H:number,comparisonPrior?:DurationPrior){
  const observed=observeDuration(input(snapshot,anchor),2);const initial=comparisonPrior??prior(snapshot);const p={a:{...initial.a},b:{...initial.b}};
  let done=0,skip=0;for(const row of observed.transitions){if(row.from==='DONE'){done++;if(row.to==='DONE')p.a.alpha++;else p.a.beta++;}
    else {skip++;if(row.to==='DONE')p.b.alpha++;else p.b.beta++;}}
  if(done===0||skip===0)return null;
  return baselineCompletionCdf(p,state,remaining,snapshot.goal.sessionAmount,H);
}
/** Full H-day labels. Missing days before known completion exclude the origin from both models. */
export function completionLabels(logs:readonly Log[],anchor:string,remaining:number,H:number):(0|1)[]|null {
  if(remaining<=0)return null;const byDate=new Map(logs.map(log=>[log.localDate,log]));const labels:(0|1)[]=[0];let sum=0;
  for(let d=1;d<=H;d++){if(sum>=remaining){labels.push(1);continue;}const log=byDate.get(shiftLocalDate(anchor,d));if(!log)return null;
    if(log.status==='DONE')sum+=log.amount!;labels.push(sum>=remaining?1:0);}
  return labels;
}
function remainingAt(snapshot:TodaySnapshot,anchor:string){return snapshot.goal.totalRequired-snapshot.goal.initialProgress-
  snapshot.logs.filter(log=>log.localDate<=anchor&&log.status==='DONE').reduce((sum,log)=>sum+log.amount!,0);}
function comparisonRow(snapshot:TodaySnapshot,artifact:DurationArtifact,policy:LearningPolicy,anchor:string):ComparisonOrigin|null {
  const records=observeDuration(input(snapshot,anchor),policy.capDays).records;const current=records.at(-1);
  if(!current||current.localDate!==anchor)return null;const remaining=remainingAt(snapshot,anchor),H=policy.observationDays;
  const labels=completionLabels(snapshot.logs,anchor,remaining,H);if(!labels)return null;
  const baseline=baselineAt(snapshot,anchor,current.status,remaining,H,FIXED_LEARNING_PRIOR);if(!baseline)return null;
  // An unreachable goal has the same exact zero CDF for both models; it is not evidence of learned usefulness.
  if(BigInt(remaining)>BigInt(H)*BigInt(snapshot.goal.sessionAmount))
    return {anchor,labels,baseline,candidate:baseline,candidateError:0,applied:false};
  const prediction=forecastDurationModel(artifact,{initialState:current.status,initialRestDays:current.restDays,
    remainingAmount:remaining,sessionAmount:snapshot.goal.sessionAmount,horizonDays:H,samples:LEARNING_PROTOCOL.samples,seed:LEARNING_PROTOCOL.seed});
  if(prediction.status!=='available')return {anchor,labels,baseline,candidate:baseline,candidateError:0,applied:false};
  // Hoeffding union bound addresses path sampling only. Quadrature refinement is a diagnostic, not an all-CDF error proof.
  const error=prediction.computation.method==='POSTERIOR_PATHS'?Math.sqrt(Math.log(2*32*H/LEARNING_PROTOCOL.familyErrorProbability)/(2*LEARNING_PROTOCOL.samples)):0;
  return {anchor,labels,baseline,candidate:prediction.cdf,candidateError:error,applied:true};
}
export function computeLearningFit(snapshot:TodaySnapshot,policy:LearningPolicy,plan:LearningFitPlan=planLearningFit(snapshot,policy)):LearningFitComputation {
  const result:LearningFitComputation={numeric:null,gate:emptyLearningGate(plan.reason??'TRAINING_INSUFFICIENT'),
    trainingCutoff:plan.trainingCutoff,inputHash:learningInputHash(snapshot,plan.trainingCutoff),modelVersion:'duration-model-v1',comparison:plan,
    evidenceHash:learningInputHash(snapshot,plan.holdoutThrough??plan.trainingCutoff)};
  if(plan.reason)return result;
  const transitions=observeDuration(input(snapshot,plan.trainingCutoff),policy.capDays).transitions;
  const d=transitions.filter(row=>row.from==='DONE').length,s=transitions.filter(row=>row.from==='SKIPPED'&&row.restDays!==null).length;
  if(d<LEARNING_PROTOCOL.minDoneOrigins||s<LEARNING_PROTOCOL.minSkipOrigins||d+s<LEARNING_PROTOCOL.minTrainTransitions){result.gate=emptyLearningGate('TRAINING_INSUFFICIENT',d+s);return result;}
  // Validate current metadata, but never let a later answer affect fitting or historical scoring.
  prior(snapshot);
  const fit=fitDurationModel(transitions,FIXED_LEARNING_PRIOR,{capDays:policy.capDays,gammaPrior:DURATION_GAMMA_PRIOR,tolerance:1e-7});
  if(fit.status!=='available'){result.gate=emptyLearningGate(fit.reason,d+s);return result;}result.numeric=fit.artifact;
  let excluded=0;const rows=(anchors:string[])=>anchors.flatMap(anchor=>{const row=comparisonRow(snapshot,fit.artifact,policy,anchor);if(!row){excluded++;return [];}return [row];});
  const validation=rows(plan.validationAnchors),test=rows(plan.testAnchors);
  const withPrior=(origins:ComparisonOrigin[],comparisonPrior:DurationPrior)=>origins.map(row=>{
    const current=observeDuration(input(snapshot,row.anchor),policy.capDays).records.at(-1)!;
    const baseline=baselineAt(snapshot,row.anchor,current.status,remainingAt(snapshot,row.anchor),policy.observationDays,comparisonPrior)!;
    return {...row,baseline,candidate:row.applied?row.candidate:baseline};
  });
  result.gate=assessLearningGateFamily(R11_COMPARISON_PRIORS.map(comparisonPrior=>assessLearningGate(
    withPrior(validation,comparisonPrior),withPrior(test,comparisonPrior),policy.observationDays,d+s,excluded)));return result;
}
/** Fit observed history for an explicit experiment, without consuming quality holdout labels. */
export function computeLearningExperiment(snapshot:TodaySnapshot,policy:LearningPolicy):LearningFitComputation {
  const observed=input(snapshot,today(snapshot));
  const cutoff=observed.logs.map(row=>row.localDate).sort().at(-1)??today(snapshot);
  const comparison:LearningFitPlan={protocolVersion:'duration-experimental-v1',horizonDays:policy.observationDays,
    trainingCutoff:cutoff,validationAnchors:[],testAnchors:[],holdoutThrough:null,reason:'EXPERIMENTAL_NOT_QUALIFIED'};
  const result:LearningFitComputation={purpose:'EXPERIMENTAL',numeric:null,gate:emptyLearningGate('EXPERIMENTAL_NOT_QUALIFIED'),
    trainingCutoff:cutoff,inputHash:learningInputHash(snapshot,cutoff),modelVersion:'duration-model-v1',comparison,
    evidenceHash:learningInputHash(snapshot,cutoff)};
  if(observed.logs.length>LEARNING_PROTOCOL.maxRecords){result.gate=emptyLearningGate('RECORD_WORK_LIMIT');return result;}
  const transitions=observeDuration(observed,policy.capDays).transitions;
  const fit=fitDurationModel(transitions,prior(snapshot),{capDays:policy.capDays,gammaPrior:DURATION_GAMMA_PRIOR,tolerance:1e-7});
  const training=fit.status==='available'?fit.artifact.training:fit.training;
  const known=training.doneOrigins+training.skipOrigins;
  result.gate=emptyLearningGate(fit.status==='available'?'EXPERIMENTAL_NOT_QUALIFIED':fit.reason,known);
  if(fit.status==='available')result.numeric=fit.artifact;
  return result;
}
/** Numerical use is distinct from evidence that authorizes a qualified adoption. */
export function learningArtifactUsability(artifact:StoredLearningArtifact,state:LearningReadState,policy:LearningPolicy):string|null {
  if(!policy.enabled||!state.participationId||!state.participationExpiresAt||state.participationExpiresAt<=state.snapshot.now)return 'NOT_PARTICIPATING';
  if(artifact.expiresAt<=state.snapshot.now||artifact.createdAt.getTime()<=state.snapshot.now.getTime()-policy.retentionDays*86400000||
    (state.participationJoinedAt!==null&&state.participationJoinedAt.getTime()<=state.snapshot.now.getTime()-policy.retentionDays*86400000))return 'EXPIRED';
  if(!artifact.numeric)return artifact.gate.reasons[0]??'MODEL_UNAVAILABLE';
  if(artifact.modelVersion!=='duration-model-v1'||artifact.numeric.capDays!==policy.capDays)return 'MODEL_CONTEXT_CHANGED';
  if(artifact.goalSettingsRevision!==state.snapshot.goal.goalSettingsRevision||artifact.answerRevision!==answerRevision(state.snapshot.question.answer_revision))return 'CONTEXT_CHANGED';
  if(artifact.inputHash!==learningInputHash(state.snapshot,artifact.trainingCutoff))return 'INPUT_CORRECTED';
  return null;
}
/** Read-only, same-input comparison. An unavailable experiment never borrows baseline values. */
export function compareLearningModel(state:LearningReadState,policy:LearningPolicy,artifactId:string,artifactHash:string,amount?:number):LearningComparison {
  if(amount!==undefined&&(!Number.isSafeInteger(amount)||amount<0))throw new RangeError('Invalid today amount');
  const artifact=state.artifacts.find(row=>row.id===artifactId);
  if(!artifact||artifact.hash!==artifactHash)throw new RangeError('Unknown comparison artifact');
  const snapshot=state.snapshot,baseline=buildR11Today(snapshot),date=baseline.today,H=policy.observationDays;
  const recorded=baseline.todayLog,hypothetical=amount!==undefined||recorded===null,chosen=amount??(recorded?null:snapshot.goal.sessionAmount);
  const logs=hypothetical?[...snapshot.logs.filter(row=>row.localDate!==date),{localDate:date,status:chosen===0?'SKIPPED' as const:'DONE' as const,amount:chosen===0?null:chosen!}]:snapshot.logs;
  const projected={...snapshot,logs},remaining=remainingAt(projected,date),current=observeDuration(input(projected,date),policy.capDays).records.at(-1)!;
  const fields={status:'insufficient' as const,reason:null as string|null,p50Days:null as number|null,p80Days:null as number|null,
    horizonDays:H,reachProbability:null as number|null,todayAmount:chosen,hypothetical};
  const reference:LearningReferenceForecast={source:'BASELINE',...fields};
  const experiment:LearningComparison['experiment']={source:'EXPERIMENTAL',artifactId:artifact.id,artifactHash:artifact.hash,...fields};
  if(remaining<=0)Object.assign(reference,{status:'completed',p50Days:0,p80Days:0,reachProbability:1});
  else {const cdf=baselineAt(projected,date,current.status,remaining,H);
    if(cdf)Object.assign(reference,{status:'available',p50Days:completionQuantile(cdf,.5),p80Days:completionQuantile(cdf,.8),reachProbability:cdf[H]!});
    else reference.reason='NO_BASELINE_TRANSITIONS';}
  const unusable=learningArtifactUsability(artifact,state,policy);
  if(unusable)experiment.reason=unusable;
  else if(remaining<=0)Object.assign(experiment,{status:'completed',p50Days:0,p80Days:0,reachProbability:1});
  else if(BigInt(remaining)>BigInt(H)*BigInt(snapshot.goal.sessionAmount))experiment.reason='BEYOND_LEARNING_HORIZON';
  else {const forecast=forecastDurationModel(artifact.numeric!,{initialState:current.status,initialRestDays:current.restDays,
    remainingAmount:remaining,sessionAmount:snapshot.goal.sessionAmount,horizonDays:H,samples:LEARNING_PROTOCOL.primarySamples,seed:LEARNING_PROTOCOL.seed});
    if(forecast.status==='available')Object.assign(experiment,{status:'available',p50Days:forecast.p50Days,p80Days:forecast.p80Days,reachProbability:forecast.cdf[H]!});
    else experiment.reason=forecast.reason;}
  return {schemaVersion:'learning-comparison-v1',baseline,reference,experiment,goalSettingsRevision:snapshot.goal.goalSettingsRevision,
    answerRevision:answerRevision(snapshot.question.answer_revision),activeRevision:state.activeRevision};
}
export function learningArtifactEligibility(artifact:StoredLearningArtifact,state:LearningReadState,policy:LearningPolicy):string|null {
  if(!policy.enabled||!state.participationId||!state.participationExpiresAt||state.participationExpiresAt<=state.snapshot.now)return 'NOT_PARTICIPATING';
  if(artifact.expiresAt<=state.snapshot.now||artifact.createdAt.getTime()<=state.snapshot.now.getTime()-policy.retentionDays*86400000)return 'EXPIRED';
  if(artifact.modelVersion!=='duration-model-v1'||!artifact.numeric||artifact.numeric.capDays!==policy.capDays)return 'MODEL_CONTEXT_CHANGED';
  if(artifact.comparison?.protocolVersion!==LEARNING_PROTOCOL.version||artifact.comparison.horizonDays!==policy.observationDays)return 'MODEL_CONTEXT_CHANGED';
  if(artifact.goalSettingsRevision!==state.snapshot.goal.goalSettingsRevision||artifact.answerRevision!==answerRevision(state.snapshot.question.answer_revision))return 'CONTEXT_CHANGED';
  if(artifact.inputHash!==learningInputHash(state.snapshot,artifact.trainingCutoff))return 'INPUT_CORRECTED';
  if(!artifact.comparison?.holdoutThrough||!artifact.evidenceHash||artifact.evidenceHash!==learningInputHash(state.snapshot,artifact.comparison.holdoutThrough))return 'EVIDENCE_CORRECTED';
  if(artifact.gate.status!=='ADOPTABLE')return 'GATE_NOT_ADOPTABLE';
  return null;
}
export function selectLearningToday(state:LearningReadState,policy:LearningPolicy,amount?:number):TodayLearning {
  const snapshot=state.snapshot,baseline=buildR11Today(snapshot),date=baseline.today,H=policy.observationDays;
  if(amount!==undefined&&(!Number.isSafeInteger(amount)||amount<0))throw new RangeError('Invalid today amount');
  const recorded=baseline.todayLog;const hypothetical=amount!==undefined||recorded===null;
  const chosen=amount??(recorded?null:snapshot.goal.sessionAmount);
  const logs=hypothetical?[...snapshot.logs.filter(log=>log.localDate!==date),{localDate:date,status:chosen===0?'SKIPPED' as const:'DONE' as const,amount:chosen===0?null:chosen!}]:snapshot.logs;
  const projected={...snapshot,logs};const remaining=remainingAt(projected,date);
  const current=observeDuration(input(projected,date),policy.capDays).records.at(-1)!;
  const selected:TodayLearning['selectedForecast']={source:'BASELINE',artifactId:null,artifactHash:null,activeRevision:state.activeRevision,
    status:'insufficient',reason:null,p50Days:null,p80Days:null,horizonDays:H,reachProbability:null,todayAmount:chosen,hypothetical};
  if(remaining<=0){return {schemaVersion:'learning-today-v1',baseline,selectedForecast:{...selected,status:'completed',p50Days:0,p80Days:0,reachProbability:1}};}
  const active=state.artifacts.find(row=>row.id===state.activeArtifactId);
  const ineligible=active?learningArtifactEligibility(active,state,policy):'NO_ACTIVE_ARTIFACT';
  if(active&&!ineligible&&BigInt(remaining)>BigInt(H)*BigInt(snapshot.goal.sessionAmount)){
    // Match the comparison policy: exact-zero unreachable forecasts are not learned application.
    selected.reason='BEYOND_LEARNING_HORIZON';
  }else if(active&&!ineligible){const forecast=forecastDurationModel(active.numeric!,{initialState:current.status,initialRestDays:current.restDays,
    remainingAmount:remaining,sessionAmount:snapshot.goal.sessionAmount,horizonDays:H,samples:LEARNING_PROTOCOL.primarySamples,seed:LEARNING_PROTOCOL.seed});
    if(forecast.status==='available')return {schemaVersion:'learning-today-v1',baseline,selectedForecast:{...selected,source:'LEARNED',
      artifactId:active.id,artifactHash:active.hash,status:'available',p50Days:forecast.p50Days,p80Days:forecast.p80Days,reachProbability:forecast.cdf[H]!}};
    selected.reason=forecast.reason;
  }else selected.reason=ineligible;
  // The BASELINE main screen uses the actual R11 scenario and horizon. Explicit
  // unsaved quantity previews use the comparison horizon below.
  if(amount===undefined){const completion=baseline.prediction.completion;
    selected.status=completion.status;selected.horizonDays=baseline.prediction.config.horizonDays;
    if(completion.status==='available'){selected.p50Days=completion.p50Days;selected.p80Days=completion.p80Days;}
    else if(completion.status==='insufficient')selected.reason=completion.reason;
    return {schemaVersion:'learning-today-v1',baseline,selectedForecast:selected};}
  const cdf=baselineAt(projected,date,current.status,remaining,H);
  if(cdf){selected.status='available';selected.p50Days=completionQuantile(cdf,.5);selected.p80Days=completionQuantile(cdf,.8);selected.reachProbability=cdf[H]!;}
  return {schemaVersion:'learning-today-v1',baseline,selectedForecast:selected};
}
