// #248: 途中到達のepisode尤度。旧3完全H30窓の累積BCE helperとは別契約。
export const MILESTONE_PROTOCOL = Object.freeze({
  version: 'session-milestone-survival-v1', horizon: 30, correctionDays: 2,
  requiredEpisodes: 3, penalty: 1, bound: Math.log(1.25), iterations: 100, tolerance: 1e-12,
});
export type Scope = { ownerId: string; goalId: string; participationId: string; contextKey: string };
export type Observation = { kind: 'EVENT' | 'INTERVAL'; lower: number; upper: number } |
  { kind: 'CENSOR'; lower: number; upper: number };
export type FitEpisode = {
  id: string;
  origin: string;
  scope: Scope;
  cdf: number[];
  observation: Observation;
  labelHash: string;
};
export type OffsetFit = {
  status: 'FIT' | 'IDENTITY' | 'FAILED';
  reason: string | null;
  u: number;
  episodes: number;
  duplicates: number;
  objective: number | null;
  gradient: number | null;
  iterations: number;
  kktResidual: number | null;
};

export const sameScope = (a: Scope, b: Scope) => a.ownerId === b.ownerId && a.goalId === b.goalId &&
  a.participationId === b.participationId && a.contextKey === b.contextKey;

export function validateCdf(cdf: readonly number[]): void {
  if (cdf.length !== 30) throw new RangeError('H30_CDF_REQUIRED');
  let previous = 0;
  for (const p of cdf) {
    if (!Number.isFinite(p) || p < previous || p > 1) throw new RangeError('INVALID_CDF');
    previous = p;
  }
}

export function shiftProbability(p: number, u: number): number {
  if (
    !Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(u) ||
    Math.abs(u) > MILESTONE_PROTOCOL.bound
  ) {
    throw new RangeError('INVALID_OFFSET');
  }
  if (p === 0 || p === 1 || u === 0) return p;
  const z = Math.log(p) - Math.log1p(-p) + u;
  const r = Math.exp(z >= 0 ? -z : z);
  return z >= 0 ? 1 - r / (1 + r) : r / (1 + r);
}

const logDen = (p: number, u: number) => p === 1 ? u : Math.log1p(p * Math.expm1(u));

export function observationLoss(
  cdf: readonly number[],
  observation: Observation,
  u: number,
): { loss: number; gradient: number } {
  validateCdf(cdf);
  if (!Number.isFinite(u) || Math.abs(u) > MILESTONE_PROTOCOL.bound) throw new RangeError('INVALID_OFFSET');
  const { lower, upper } = observation;
  if (
    !['EVENT', 'INTERVAL', 'CENSOR'].includes(observation.kind) ||
    !Number.isInteger(lower) || !Number.isInteger(upper) || lower < 0 || upper < 1 || upper > 30 ||
    (observation.kind === 'CENSOR' ? lower !== upper : lower >= upper) ||
    (observation.kind === 'EVENT' && upper !== lower + 1)
  ) {
    throw new RangeError('INVALID_OBSERVATION');
  }
  const at = (d: number) => d === 0 ? 0 : cdf[d - 1]!;
  if (observation.kind === 'CENSOR') {
    const p = at(upper);
    return p === 1 ? { loss: Infinity, gradient: NaN } :
      { loss: logDen(p, u) - Math.log1p(-p), gradient: shiftProbability(p, u) };
  }
  const a = at(lower), b = at(upper);
  return b === a ? { loss: Infinity, gradient: NaN } :
    { loss: logDen(a, u) + logDen(b, u) - u - Math.log(b - a),
      gradient: shiftProbability(a, u) + shiftProbability(b, u) - 1 };
}

export function offsetObjective(
  episodes: readonly FitEpisode[],
  u: number,
): { objective: number; gradient: number } {
  if (!episodes.length) throw new RangeError('EPISODES_REQUIRED');
  let objective = u * u / 2, gradient = u;
  for (const episode of episodes) {
    const score = observationLoss(episode.cdf, episode.observation, u);
    objective += score.loss / episodes.length;
    gradient += score.gradient / episodes.length;
  }
  return { objective, gradient };
}

export function identityFit(reason: string, episodes = 0, duplicates = 0): OffsetFit {
  return { status: 'IDENTITY', reason, u: 0, episodes, duplicates, objective: null, gradient: null, iterations: 0, kktResidual: null };
}

export function fitMilestoneOffset(input: readonly FitEpisode[], scope: Scope): OffsetFit {
  const unique = new Map<string, FitEpisode>();
  let duplicates = 0;
  for (const row of input) {
    if (!sameScope(row.scope, scope)) throw new Error('EPISODE_SCOPE_MISMATCH');
    validateCdf(row.cdf);
    const prior = unique.get(row.id);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(row)) throw new Error('CONFLICTING_DUPLICATE');
      duplicates++;
    } else {
      unique.set(row.id, row);
    }
  }
  const rows = [...unique.values()].sort((a, b) => b.origin.localeCompare(a.origin) || b.id.localeCompare(a.id));
  if (new Set(rows.map(row => row.origin)).size !== rows.length) throw new Error('DUPLICATE_ORIGIN');
  if (rows.length < 3) return identityFit('INSUFFICIENT_EPISODES', rows.length, duplicates);
  // 同じ本人内の依存を独立人数と扱わない。選択は日付だけで固定し、欠けた窓の差替えは外側でも禁止。
  const selected = rows.slice(0, 3);
  let lo = -MILESTONE_PROTOCOL.bound, hi = MILESTONE_PROTOCOL.bound, iterations = 0;
  const left = offsetObjective(selected, lo), right = offsetObjective(selected, hi);
  if (!Number.isFinite(left.objective) || !Number.isFinite(right.objective)) {
    return {
      ...identityFit('INCOMPATIBLE_STRUCTURAL_SUPPORT', 3, duplicates), status: 'FAILED',
    };
  }
  let u: number;
  if (left.gradient >= 0) {
    u = lo;
  } else if (right.gradient <= 0) {
    u = hi;
  } else if (offsetObjective(selected, 0).gradient === 0) {
    u = 0;
  } else {
    while (iterations < MILESTONE_PROTOCOL.iterations && hi - lo > MILESTONE_PROTOCOL.tolerance) {
      const mid = (lo + hi) / 2, g = offsetObjective(selected, mid).gradient;
      iterations++;
      if (g === 0) {
        lo = hi = mid;
        break;
      }
      if (g > 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    if (hi - lo > MILESTONE_PROTOCOL.tolerance) {
      return { ...identityFit('NONCONVERGENCE', 3, duplicates), status: 'FAILED' };
    }
    u = (lo + hi) / 2;
  }
  const result = offsetObjective(selected, u);
  const projected = Math.max(-MILESTONE_PROTOCOL.bound, Math.min(MILESTONE_PROTOCOL.bound, u - result.gradient));
  return { status: 'FIT', reason: u === 0 ? 'FIT_ZERO' : null, u, episodes: 3, duplicates,
    ...result, iterations, kktResidual: Math.abs(u - projected) };
}

export function applyOffset(cdf: readonly number[], fit: OffsetFit) {
  validateCdf(cdf);
  const u = fit.status === 'FIT' ? fit.u : 0;
  const shifted = cdf.map(p => shiftProbability(p, u));
  return { cdf: shifted, pmf: shifted.map((p, i) => p - (i ? shifted[i - 1]! : 0)),
    tail: 1 - shifted[29]!, u, oddsMultiplier: Math.exp(u),
    changed: shifted.some((p, i) => p !== cdf[i]), appliedToStandard: false as const };
}
