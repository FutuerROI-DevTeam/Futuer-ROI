import { completionQuantiles, integratedCompletionCdf, NUMERICAL_MARGIN } from './completion-integrated.js';
import { completionPmf } from './completion.js';
import { samplePosterior } from './random.js';
import type { CompletionComputation, Posterior, PredictionConfig } from './types.js';

export function completionDistributionForFrozenState(posterior: Posterior, initialState: 'DONE' | 'SKIPPED',
  requiredFutureDone: number, config: Pick<PredictionConfig, 'samples' | 'horizonDays' | 'seed' | 'completionMethod'>) {
  const result = completionQuantiles(posterior, initialState, requiredFutureDone, config);
  return { ...result, cdfRepresentation: 'bounded-monotone-roundoff-v1' as const,
    cdf: frozenCompletionCdf({ posterior, initialState, requiredFutureDone, computation: result.computation }) };
}

/** 発行時の実方式を保存用CDFへ展開する補助。標準predict/quantileの経路は変更しない。 */
export function frozenCompletionCdf(input: {
  posterior: Posterior; initialState: 'DONE' | 'SKIPPED'; requiredFutureDone: number;
  computation: CompletionComputation;
}, horizon = 30): number[] {
  const { posterior, initialState, requiredFutureDone: n, computation } = input;
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isInteger(horizon) || horizon < 1 || horizon > 30 ||
    !['DONE', 'SKIPPED'].includes(initialState) ||
    [posterior.a.alpha, posterior.a.beta, posterior.b.alpha, posterior.b.beta]
      .some(x => !Number.isSafeInteger(x) || x < 1)) throw new RangeError('Invalid frozen CDF input');
  if (!['BOUNDARY', 'BETA_BINOMIAL', 'POSTERIOR_SAMPLING'].includes(computation.method)) throw new Error('SOURCE_UNREPLAYABLE');
  if (n === 0) return Array(horizon).fill(1);
  if (n > horizon) return Array(horizon).fill(0);
  let cdf: number[];
  if (computation.method === 'BETA_BINOMIAL') {
    const at = integratedCompletionCdf(posterior, initialState, n, horizon);
    cdf = Array.from({ length: horizon }, (_, i) => at(i + 1));
  } else if (computation.method === 'POSTERIOR_SAMPLING') {
    if (!Number.isSafeInteger(computation.samples) || computation.samples! < 1 ||
      !Number.isInteger(computation.seed) || computation.seed! < 0 || computation.seed! > 0xffffffff) throw new Error('SOURCE_UNREPLAYABLE');
    const pmf = new Float64Array(horizon + 1);
    for (const { a, b } of samplePosterior(posterior, computation.samples!, computation.seed!)) {
      const path = completionPmf({ initialState, requiredFutureDone: n, horizonDays: horizon, a, b });
      for (let d = 1; d <= horizon; d++) pmf[d] = pmf[d]! + path[d]! / computation.samples!;
    }
    let total = 0;
    cdf = Array.from({ length: horizon }, (_, i) => (total += pmf[i + 1]!));
  } else throw new Error('INCOMPATIBLE_BOUNDARY_METHOD');
  let before = 0;
  for (let i = 0; i < cdf.length; i++) {
    const p = cdf[i]!;
    // 既存kernelの丸めbudgetだけを共有する。0/1をepsilon内部へ移してlossを救わない。
    const represented = Math.max(before, Math.min(1, Math.max(0, p)));
    if (!Number.isFinite(p) || Math.abs(represented - p) > NUMERICAL_MARGIN) throw new Error('INVALID_FROZEN_CDF');
    cdf[i] = before = represented;
  }
  return cdf;
}
