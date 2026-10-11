import type { LearningGate } from '../contracts/learning.ts';
import { shiftLocalDate } from '../goals/local-date.ts';

// Fixed before fitting. Not client-controlled and never relaxed for a demo.
export const LEARNING_PROTOCOL = Object.freeze({ version: 'duration-chronological-v2',
  priorPolicy: 'fixed-mid-vs-all-r11-strength4-priors-v1',
  maxRecords: 1095, minTrainTransitions: 80, minDoneOrigins: 40, minSkipOrigins: 40,
  originsPerPartition: 16, minEffectiveBlocks: 3, minAppliedPerPartition: 8,
  samples: 65536, primarySamples: 8192, seed: 20261011,
  familyErrorProbability: 0.01, requiredRpsImprovement: 0.01 } as const);
export interface ComparisonOrigin { anchor: string; labels: readonly (0 | 1)[];
  baseline: readonly number[]; candidate: readonly number[]; candidateError: number; applied: boolean; }
function checkCdf(cdf: readonly number[], horizon: number) {
  if(cdf.length!==horizon+1 || cdf.some((value,i)=>!Number.isFinite(value)||value<0||value>1||(i>0&&value<cdf[i-1]!))) throw new RangeError('Invalid completion CDF');
}
function first(cdf: readonly number[], threshold: number, offset=0): number|null {
  for(let day=0;day<cdf.length;day++)if(cdf[day]!+offset>=threshold)return day;
  return null;
}
export function completionQuantile(cdf: readonly number[], threshold: number): number|null { return first(cdf,threshold); }
/** RPS for H+1 ordered outcomes (1..H and after H): includes the unrenormalized tail. */
export function completionRps(cdf: readonly number[], labels: readonly (0|1)[]): number {
  const horizon=labels.length-1;checkCdf(cdf,horizon);
  if(horizon<1||labels[0]!==0||labels.some((value,i)=>![0,1].includes(value)||(i>0&&value<labels[i-1]!)))throw new RangeError('Invalid completion labels');
  let score=0;for(let day=1;day<=horizon;day++)score+=(cdf[day]!-labels[day]!)**2;
  return score/horizon;
}
export function emptyLearningGate(reason: string, trainTransitions=0): LearningGate {
  return { status:'INSUFFICIENT',reasons:[reason],trainTransitions,validationOrigins:0,testOrigins:0,
    appliedOrigins:0,fallbackOrigins:0,excludedOrigins:0,validationEffectiveBlocks:0,testEffectiveBlocks:0,
    baselineRps:null,candidateRps:null,baselineP80Overconfidence:null,candidateP80Overconfidence:null,
    baselineFiniteRate:null,candidateFiniteRate:null };
}
function metrics(origins: readonly ComparisonOrigin[], horizon: number) {
  let baselineRps=0,candidateRps=0,candidateRpsUpper=0,baselineFinite50=0,baselineFinite80=0,
    candidateFinite50=0,candidateFinite80=0,candidateCertain50=0,candidateCertain80=0,
    baselineSuccess80=0,candidateSuccess80=0,candidatePossible80=0,candidateCertainSuccess80=0;
  for(const row of origins){
    checkCdf(row.candidate,horizon);if(row.candidateError<0||!Number.isFinite(row.candidateError))throw new RangeError('Invalid CDF error');
    baselineRps+=completionRps(row.baseline,row.labels);candidateRps+=completionRps(row.candidate,row.labels);
    let upper=0;for(let day=1;day<=horizon;day++){
      const lo=Math.max(0,row.candidate[day]!-row.candidateError),hi=Math.min(1,row.candidate[day]!+row.candidateError);
      upper+=Math.max((lo-row.labels[day]!)**2,(hi-row.labels[day]!)**2);
    }candidateRpsUpper+=upper/horizon;
    const b50=first(row.baseline,.5),b80=first(row.baseline,.8),c50=first(row.candidate,.5),c80=first(row.candidate,.8);
    if(b50!==null)baselineFinite50++;if(b80!==null){baselineFinite80++;baselineSuccess80+=row.labels[b80]!;}
    if(c50!==null)candidateFinite50++;if(c80!==null){candidateFinite80++;candidateSuccess80+=row.labels[c80]!;}
    if(row.candidate[horizon]!-row.candidateError>=.5)candidateCertain50++;
    const certain80=row.candidate[horizon]!-row.candidateError>=.8;
    if(certain80)candidateCertain80++;
    if(row.candidate[horizon]!+row.candidateError>=.8)candidatePossible80++;
    const earliest80=first(row.candidate,.8,row.candidateError);
    if(certain80&&earliest80!==null)candidateCertainSuccess80+=row.labels[earliest80]!;
  }
  const n=origins.length;
  const baselineOver=baselineFinite80?Math.max(0,.8-baselineSuccess80/baselineFinite80):0;
  const candidateOver=candidateFinite80?Math.max(0,.8-candidateSuccess80/candidateFinite80):0;
  const candidateOverUpper=candidatePossible80?Math.max(0,.8-candidateCertainSuccess80/candidatePossible80):0;
  const anchors=origins.map(r=>r.anchor).sort();let blocks=0,next='0001-01-01';
  for(const anchor of anchors)if(anchor>=next){blocks++;next=shiftLocalDate(anchor,horizon+2);}
  return {baselineRps:n?baselineRps/n:null,candidateRps:n?candidateRps/n:null,
    candidateRpsUpper:n?candidateRpsUpper/n:null,baselineOver,candidateOver,candidateOverUpper,
    baselineFiniteRate:n?(baselineFinite50+baselineFinite80)/(2*n):null,
    candidateFiniteRate:n?(candidateFinite50+candidateFinite80)/(2*n):null,
    baselineFinite50,baselineFinite80,candidateCertain50,candidateCertain80,blocks};
}
export function assessLearningGate(validation: readonly ComparisonOrigin[], test: readonly ComparisonOrigin[],
  horizon: number, trainTransitions: number, excludedOrigins: number): LearningGate {
  const v=metrics(validation,horizon),t=metrics(test,horizon),reasons:string[]=[];
  for(const [label,rows,m] of [['VALIDATION',validation,v],['TEST',test,t]] as const){
    if(rows.length<LEARNING_PROTOCOL.originsPerPartition)reasons.push(label+'_ORIGINS_INSUFFICIENT');
    if(m.blocks<LEARNING_PROTOCOL.minEffectiveBlocks)reasons.push(label+'_BLOCKS_INSUFFICIENT');
    if(rows.filter(row=>row.applied).length<LEARNING_PROTOCOL.minAppliedPerPartition)reasons.push(label+'_APPLICATION_INSUFFICIENT');
  }
  const insufficient=reasons.length>0;
  if(!insufficient)for(const [label,m] of [['VALIDATION',v],['TEST',t]] as const){
    if(m.candidateRpsUpper!>m.baselineRps!-LEARNING_PROTOCOL.requiredRpsImprovement)reasons.push(label+'_RPS_NOT_CERTIFIED_BETTER');
    if(m.candidateOverUpper>m.baselineOver+1e-12)reasons.push(label+'_P80_OVERCONFIDENCE_WORSENED_OR_UNCERTAIN');
    if(m.candidateCertain50<m.baselineFinite50)reasons.push(label+'_P50_FINITE_WORSENED_OR_UNCERTAIN');
    if(m.candidateCertain80<m.baselineFinite80)reasons.push(label+'_P80_FINITE_WORSENED_OR_UNCERTAIN');
  }
  return {status:insufficient?'INSUFFICIENT':reasons.length?'REJECTED':'ADOPTABLE',reasons,
    trainTransitions,validationOrigins:validation.length,testOrigins:test.length,
    appliedOrigins:[...validation,...test].filter(r=>r.applied).length,
    fallbackOrigins:[...validation,...test].filter(r=>!r.applied).length,excludedOrigins,
    validationEffectiveBlocks:v.blocks,testEffectiveBlocks:t.blocks,
    baselineRps:t.baselineRps,candidateRps:t.candidateRps,baselineP80Overconfidence:t.baselineRps===null?null:t.baselineOver,
    candidateP80Overconfidence:t.candidateRps===null?null:t.candidateOver,
    baselineFiniteRate:t.baselineFiniteRate,candidateFiniteRate:t.candidateFiniteRate};
}

/** Every predeclared comparator must pass. Summary uses the smallest test RPS gain, not a tuned prior. */
export function assessLearningGateFamily(gates: readonly LearningGate[]): LearningGate {
  if(gates.length===0)throw new RangeError('Empty baseline comparator family');
  const gain=(gate:LearningGate)=>gate.baselineRps===null||gate.candidateRps===null?Number.NEGATIVE_INFINITY:gate.baselineRps-gate.candidateRps;
  const summary=gates.reduce((worst,gate)=>gain(gate)<gain(worst)?gate:worst);
  return {...summary,status:gates.some(g=>g.status==='INSUFFICIENT')?'INSUFFICIENT':gates.some(g=>g.status==='REJECTED')?'REJECTED':'ADOPTABLE',
    reasons:[...new Set(gates.flatMap(g=>g.reasons))].slice(0,16)};
}
