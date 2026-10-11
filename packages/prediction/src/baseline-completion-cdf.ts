import { integratedCompletionCdf } from './completion-integrated.js';
import type { Posterior } from './types.js';
/** Current independent-Beta baseline, with the same target/state as the comparison. */
export function baselineCompletionCdf(posterior: Posterior, initialState: 'DONE' | 'SKIPPED', remainingAmount: number,
  sessionAmount: number, horizonDays: number): readonly number[] {
  if (!Number.isSafeInteger(remainingAmount) || remainingAmount < 0 || !Number.isSafeInteger(sessionAmount) || sessionAmount < 1 ||
      !Number.isSafeInteger(horizonDays) || horizonDays < 1 || horizonDays > 1095) throw new RangeError('Invalid baseline forecast input');
  if (remainingAmount === 0) return Array.from({length:horizonDays+1},()=>1);
  const n=Number((BigInt(remainingAmount)+BigInt(sessionAmount)-1n)/BigInt(sessionAmount));
  if(n>horizonDays)return Array.from({length:horizonDays+1},()=>0);
  const cdf=integratedCompletionCdf(posterior,initialState,n,horizonDays);
  return Array.from({length:horizonDays+1},(_,day)=>cdf(day));
}
