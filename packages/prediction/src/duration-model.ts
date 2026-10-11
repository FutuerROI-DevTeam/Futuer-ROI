import { exactIntegratedReached, integratedCompletionCdf } from './completion-integrated.js';
import { gamma as sampleGamma, seedFor, splitmix32, uniform } from './random.js';
import type { Uint32Source } from './random.js';
import type {
  DurationArtifact, DurationFitOptions, DurationFitResult, DurationForecastInput,
  DurationForecastResult, DurationJointNode, DurationPrior,
  DurationTransition, GammaAtom,
} from './duration-types.js';

const MODEL_VERSION = 'duration-model-v1';
const ORDERS = [16, 32, 64] as const;
const DEFAULT_TOLERANCE = 1e-7;
const MAX_TRANSITIONS = 10_000;
const MAX_ATOMS = 65;
const MAX_CAP = 3650;
const MAX_SAMPLE_PATHS = 65_536;
class NumericalInsufficiency extends Error {}

function positive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function integer(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function requireInput(condition: boolean, message: string): void {
  if (!condition) throw new RangeError(message);
}
function sum(values: Iterable<number>): number {
  let result = 0, correction = 0;
  for (const value of values) {
    const y = value - correction, next = result + y;
    correction = (next - result) - y; result = next;
  }
  return result;
}
function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}
function logAdd(a: number, b: number): number {
  const high = Math.max(a, b);
  return high + Math.log1p(Math.exp(Math.min(a, b) - high));
}
function feature(restDays: number, capDays: number): number {
  return Math.log(Math.min(restDays, capDays)) / Math.log(capDays);
}
function skipProbability(p: number, gamma: number, g: number): number {
  if (p === 0 || p === 1) return p;
  return sigmoid(Math.log(p) - Math.log1p(-p) + gamma * g);
}

/** Beta-weighted Gauss quadrature (Golub-Welsch), including a+b=1.
 * QL rotates only the first eigenvector row, which is all the weights need.
 * Finite moment agreement is tested; it is not a global error certificate. */
export function durationBetaQuadrature(alpha: number, beta: number, order: number):
  { nodes: readonly number[]; weights: readonly number[] } {
  requireInput(positive(alpha) && positive(beta) && alpha + beta <= 1e9 && integer(order, 1, 64),
    'Invalid Beta quadrature parameters');
  const s = alpha + beta;
  const d = Array.from({ length: order }, (_, k) => k === 0 ? alpha / s :
    .5 + (alpha - beta) * (s - 2) / (2 * (2 * k + s - 2) * (2 * k + s)));
  const e = Array<number>(order).fill(0), z = Array<number>(order).fill(0);
  z[0] = 1;
  for (let k = 1; k < order; k++) {
    e[k - 1] = k === 1 ? Math.sqrt(alpha * beta / (s + 1)) / s :
      Math.sqrt(k * (k + alpha - 1) * (k + beta - 1) * (k + s - 2) /
        ((2 * k + s - 3) * (2 * k + s - 1))) / (2 * k + s - 2);
  }
  for (let l = 0; l < order; l++) {
    let iterations = 0;
    for (;;) {
      let m = l;
      while (m < order - 1 && Math.abs(e[m]!) > Number.EPSILON * (Math.abs(d[m]!) + Math.abs(d[m + 1]!))) m++;
      if (m === l) break;
      if (++iterations > 128) throw new NumericalInsufficiency('Jacobi eigensolver did not converge');
      let g = (d[l + 1]! - d[l]!) / (2 * e[l]!);
      const hyp = Math.hypot(g, 1);
      g = d[m]! - d[l]! + e[l]! / (g + (g < 0 ? -hyp : hyp));
      let sine = 1, cosine = 1, shift = 0, interrupted = false;
      for (let i = m - 1; i >= l; i--) {
        const f = sine * e[i]!, b = cosine * e[i]!;
        const r = Math.hypot(f, g); e[i + 1] = r;
        if (r === 0) { d[i + 1] = d[i + 1]! - shift; e[m] = 0; interrupted = true; break; }
        sine = f / r; cosine = g / r;
        g = d[i + 1]! - shift;
        const delta = (d[i]! - g) * sine + 2 * cosine * b;
        shift = sine * delta; d[i + 1] = g + shift; g = cosine * delta - b;
        const next = z[i + 1]!;
        z[i + 1] = sine * z[i]! + cosine * next;
        z[i] = cosine * z[i]! - sine * next;
      }
      if (interrupted) continue;
      d[l] = d[l]! - shift; e[l] = g; e[m] = 0;
    }
  }
  const pairs = d.map((p, i) => ({ p, w: z[i]! ** 2 })).sort((a, b) => a.p - b.p);
  const mass = sum(pairs.map(x => x.w));
  if (!Number.isFinite(mass) || Math.abs(mass - 1) > 1e-12 ||
      pairs.some(x => !Number.isFinite(x.p) || x.p <= 0 || x.p >= 1 || !Number.isFinite(x.w) || x.w < 0)) {
    throw new NumericalInsufficiency('Invalid Beta nodes or weights');
  }
  return { nodes: pairs.map(x => x.p), weights: pairs.map(x => x.w / mass) };
}

// Lanczos log Gamma, used only for the proposal density ratio / log evidence.
function logGamma(x: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7];
  if (x < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  const y = x - 1; let value = .99999999999980993;
  coefficients.forEach((coefficient, i) => { value += coefficient / (y + i + 1); });
  const t = y + 7.5;
  return .5 * Math.log(2 * Math.PI) + (y + .5) * Math.log(t) - t + Math.log(value);
}
function logBeta(a: number, b: number): number { return logGamma(a) + logGamma(b) - logGamma(a + b); }
interface Group { g: number; success: number; failure: number }

function gammaProposal(A: number, B: number, prior: DurationPrior['b'], gamma: number,
  groups: readonly Group[]): { alpha: number; beta: number } {
  // Fixed sparse/tail rule. A proposal is a numerical measure, never the posterior.
  if (Math.min(A, B) < 5 || gamma === 0) return { alpha: A, beta: B };
  const derivative = (z: number): [number, number] => {
    const p = sigmoid(z);
    let score = A - (prior.alpha + prior.beta) * p;
    let slope = -(prior.alpha + prior.beta) * p * (1 - p);
    for (const group of groups) {
      const q = sigmoid(z + gamma * group.g), n = group.success + group.failure;
      score -= n * q; slope -= n * q * (1 - q);
    }
    return [score, slope];
  };
  let low = Math.log(A / B) - 4, high = low + 8;
  for (let k = 0; derivative(low)[0] <= 0 && k < 64; k++) low -= 2 ** (k + 2);
  for (let k = 0; derivative(high)[0] >= 0 && k < 64; k++) high += 2 ** (k + 2);
  if (derivative(low)[0] <= 0 || derivative(high)[0] >= 0) throw new NumericalInsufficiency('Proposal mode bracket');
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (derivative(middle)[0] > 0) low = middle; else high = middle;
  }
  const mode = (low + high) / 2, p = sigmoid(mode);
  const kappa = -derivative(mode)[1] / (p * (1 - p));
  const alpha = kappa * p, beta = kappa * (1 - p);
  if (!positive(alpha) || !positive(beta) || alpha + beta > 1e9) throw new NumericalInsufficiency('Proposal shape');
  return { alpha, beta };
}

function jointPosterior(A: number, B: number, prior: DurationPrior['b'], atoms: readonly GammaAtom[],
  groups: readonly Group[], capDays: number, order: number) {
  const referenceLogBeta = logBeta(A, B), baselineLogEvidence = referenceLogBeta - logBeta(prior.alpha, prior.beta);
  const logs: { p: number; gamma: number; logWeight: number; atom: number }[] = [];
  atoms.forEach((atom, atomIndex) => {
    const proposal = gammaProposal(A, B, prior, atom.gamma, groups);
    const quadrature = durationBetaQuadrature(proposal.alpha, proposal.beta, order);
    const correctionConstant = logBeta(proposal.alpha, proposal.beta) - referenceLogBeta;
    quadrature.nodes.forEach((p, i) => {
      const logP = Math.log(p), logFailure = Math.log1p(-p);
      // Equivalent to gamma*sum(success*g)-sum(N[g]*log1p(p*expm1(gamma*g))).
      // Separate success/failure ratios also avoid large nearly equal terms cancelling.
      const logR = sum(groups.map(x => {
        const t = atom.gamma * x.g;
        return -x.success * logAdd(logP, logFailure - t) -
          x.failure * logAdd(logFailure, logP + t);
      }));
      const ratio = (A - proposal.alpha) * logP + (B - proposal.beta) * logFailure + correctionConstant;
      logs.push({ p, gamma: atom.gamma, atom: atomIndex,
        logWeight: Math.log(atom.mass) + Math.log(quadrature.weights[i]!) + logR + ratio });
    });
  });
  const maximum = Math.max(...logs.map(x => x.logWeight));
  const scale = sum(logs.map(x => Math.exp(x.logWeight - maximum)));
  if (!Number.isFinite(maximum) || !positive(scale)) throw new NumericalInsufficiency('Joint normalization');
  const joint: DurationJointNode[] = logs.map(x => ({ pDoneAfterSkip: x.p, gamma: x.gamma,
    weight: Math.exp(x.logWeight - maximum) / scale }));
  const logEvidence = baselineLogEvidence + maximum + Math.log(scale);
  // Check gamma marginals, joint moments and hazards across the capped age range.
  // These diagnostics are finite convergence evidence, not all-functional guarantees.
  const diagnostics = [logEvidence,
    ...[1, 2, 3, 4].map(k => sum(joint.map(x => x.weight * x.pDoneAfterSkip ** k))),
    sum(joint.map(x => x.weight * x.gamma)),
    sum(joint.map(x => x.weight * x.gamma * x.pDoneAfterSkip))];
  atoms.forEach((_, i) => {
    diagnostics.push(sum(joint.map((x, j) => logs[j]!.atom === i ? x.weight : 0)),
      sum(joint.map((x, j) => logs[j]!.atom === i ? x.weight * x.pDoneAfterSkip : 0)));
  });
  for (let r = 1; r <= capDays; r++) {
    const g = feature(r, capDays);
    diagnostics.push(sum(joint.map(x => x.weight * skipProbability(x.pDoneAfterSkip, x.gamma, g))));
  }
  if (diagnostics.some(x => !Number.isFinite(x))) throw new NumericalInsufficiency('Joint moments');
  return { joint, diagnostics, logEvidence };
}

/** No records, clock, IO, RNG or mutable cross-request cache. Canonical transitions are C-owned. */
export function fitDurationModel(transitions: readonly DurationTransition[], prior: DurationPrior,
  options: DurationFitOptions): DurationFitResult {
  requireInput(Array.isArray(transitions) && transitions.length <= MAX_TRANSITIONS, 'Too many transitions');
  requireInput([prior.a.alpha, prior.a.beta, prior.b.alpha, prior.b.beta].every(positive) &&
    prior.a.alpha + prior.a.beta <= 1e9 && prior.b.alpha + prior.b.beta <= 1e9, 'Invalid duration prior');
  requireInput(integer(options.capDays, 2, MAX_CAP), 'Invalid rest cap');
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  requireInput(positive(tolerance) && tolerance <= 1e-3, 'Invalid integration tolerance');
  requireInput(Array.isArray(options.gammaPrior) && integer(options.gammaPrior.length, 1, MAX_ATOMS), 'Invalid gamma prior');
  const seenGamma = new Set<number>();
  for (const atom of options.gammaPrior) {
    requireInput(Number.isFinite(atom.gamma) && Number.isFinite(atom.mass) && atom.mass >= 0 && !seenGamma.has(atom.gamma),
      'Invalid or duplicate gamma atom'); seenGamma.add(atom.gamma);
  }
  const positiveAtoms = options.gammaPrior.filter(x => x.mass > 0);
  const maxMass = Math.max(...positiveAtoms.map(x => x.mass));
  requireInput(positive(maxMass), 'Gamma prior has no mass');
  const denominator = sum(positiveAtoms.map(x => x.mass / maxMass));
  const atoms = positiveAtoms.map(x => ({ gamma: x.gamma, mass: (x.mass / maxMass) / denominator }));
  const training = { doneOrigins: 0, skipOrigins: 0, excludedUnknownDuration: 0 };
  let nDD = 0, nDS = 0, success = 0, failure = 0;
  const grouped = new Map<number, { success: number; failure: number }>(), seen = new Set<string>();
  for (const transition of transitions) {
    requireInput(['DONE', 'SKIPPED'].includes(transition.from) && ['DONE', 'SKIPPED'].includes(transition.to) &&
      typeof transition.originDate === 'string' && typeof transition.outcomeDate === 'string' &&
      transition.originDate.length > 0 && transition.outcomeDate.length > 0, 'Invalid transition');
    // Canonical extractor guarantees adjacency; refuse duplicate origins defensively.
    requireInput(!seen.has(transition.originDate), 'Duplicate transition origin'); seen.add(transition.originDate);
    if (transition.from === 'DONE') {
      training.doneOrigins++; if (transition.to === 'DONE') nDD++; else nDS++;
    } else if (transition.restDays === null) training.excludedUnknownDuration++;
    else {
      requireInput(integer(transition.restDays, 1, Number.MAX_SAFE_INTEGER), 'Invalid known rest duration');
      training.skipOrigins++;
      const age = Math.min(transition.restDays, options.capDays), group = grouped.get(age) ?? { success: 0, failure: 0 };
      if (transition.to === 'DONE') { success++; group.success++; } else { failure++; group.failure++; }
      grouped.set(age, group);
    }
  }
  const insufficient = (reason: 'NO_DONE_ORIGIN_TRANSITION' | 'NO_SKIP_ORIGIN_TRANSITION' | 'NUMERICAL_INSUFFICIENCY'):
    DurationFitResult => ({ status: 'insufficient', reason, training });
  if (training.doneOrigins === 0) return insufficient('NO_DONE_ORIGIN_TRANSITION');
  if (training.skipOrigins === 0) return insufficient('NO_SKIP_ORIGIN_TRANSITION');
  const a = { alpha: prior.a.alpha + nDD, beta: prior.a.beta + nDS };
  const b = { alpha: prior.b.alpha + success, beta: prior.b.beta + failure };
  if (atoms.length === 1 && atoms[0]!.gamma === 0) {
    return { status: 'available', artifact: { kind: 'BETA_BASELINE_V1', modelVersion: MODEL_VERSION,
      capDays: options.capDays, posterior: { a, b }, training } };
  }
  const groups = [...grouped].sort((left, right) => left[0] - right[0])
    .map(([age, group]) => ({ ...group, g: feature(age, options.capDays) }));
  try {
    let previous: ReturnType<typeof jointPosterior> | undefined;
    let maximumDifference = 0;
    let final: ReturnType<typeof jointPosterior> | undefined;
    for (const order of ORDERS) {
      const result = jointPosterior(b.alpha, b.beta, prior.b, atoms, groups, options.capDays, order);
      if (previous) maximumDifference = Math.max(maximumDifference,
        ...result.diagnostics.map((value, i) => Math.abs(value - previous!.diagnostics[i]!)));
      previous = result; final = result;
    }
    if (!final || maximumDifference > tolerance) return insufficient('NUMERICAL_INSUFFICIENCY');
    return { status: 'available', artifact: { kind: 'DURATION_JOINT_V1', modelVersion: MODEL_VERSION,
      capDays: options.capDays, donePosterior: a, skipReferencePosterior: b, joint: final.joint,
      gammaPrior: atoms, training,
      integration: { order: 64, converged: true, maxDifference: maximumDifference, logEvidence: final.logEvidence } } };
  } catch (error) {
    if (!(error instanceof NumericalInsufficiency)) throw error;
    return insufficient('NUMERICAL_INSUFFICIENCY');
  }
}

export interface DurationConditionalInput {
  readonly pDoneAfterDone: number; readonly pDoneAfterSkip: number; readonly gamma: number;
  readonly capDays: number; readonly initialState: 'DONE' | 'SKIPPED'; readonly initialRestDays: number | null;
  readonly requiredFutureDone: number; readonly horizonDays: number;
}
/** Conditional fixed-parameter DP. Used by independent short-horizon path oracles;
 * the public learned forecast below samples parameters once for each entire path. */
export function durationConditionalCdf(input: DurationConditionalInput): readonly number[] {
  const { pDoneAfterDone: p1, pDoneAfterSkip: p0, gamma, capDays: cap, horizonDays: H, requiredFutureDone: N } = input;
  requireInput([p1, p0].every(p => Number.isFinite(p) && p >= 0 && p <= 1) && Number.isFinite(gamma) &&
    integer(cap, 2, MAX_CAP) && integer(H, 0, 10_000) && integer(N, 0, Number.MAX_SAFE_INTEGER) &&
    ['DONE', 'SKIPPED'].includes(input.initialState), 'Invalid conditional forecast');
  requireInput(input.initialState === 'DONE' || (input.initialRestDays !== null &&
    integer(input.initialRestDays, 1, Number.MAX_SAFE_INTEGER)), 'Unknown conditional duration');
  const cdf = Array<number>(H + 1).fill(N === 0 ? 1 : 0);
  if (N === 0 || N > H) return cdf;
  const stride = cap + 1;
  requireInput(BigInt(H) * BigInt(N) * BigInt(stride) <= 20_000_000n, 'Conditional DP work budget');
  let current = new Float64Array(N * stride), next = new Float64Array(N * stride);
  current[input.initialState === 'DONE' ? 0 : Math.min(input.initialRestDays!, cap)] = 1;
  const hazards = Array.from({ length: stride }, (_, r) => r === 0 ? p1 : skipProbability(p0, gamma, feature(r, cap)));
  for (let day = 1; day <= H; day++) {
    next.fill(0); let reached = 0;
    for (let count = 0; count < N; count++) for (let age = 0; age <= cap; age++) {
      const probability = current[count * stride + age]!;
      if (probability === 0) continue;
      const done = probability * hazards[age]!;
      if (count + 1 === N) reached += done; else next[(count + 1) * stride] = next[(count + 1) * stride]! + done;
      const skipIndex = count * stride + (age === 0 ? 1 : Math.min(age + 1, cap));
      next[skipIndex] = next[skipIndex]! + probability * (1 - hazards[age]!);
    }
    cdf[day] = cdf[day - 1]! + reached;
    [current, next] = [next, current];
  }
  return cdf;
}

function betaSample(alpha: number, beta: number, random: Uint32Source): number {
  // Existing Gamma sampler supports shape>=1; this log transform also supports sparse priors.
  const logDraw = (shape: number) => shape < 1 ?
    Math.log(sampleGamma(shape + 1, random)) + Math.log(uniform(random)) / shape : Math.log(sampleGamma(shape, random));
  return sigmoid(logDraw(alpha) - logDraw(beta));
}
function quantile(cdf: readonly number[], q: number): number | null {
  const day = cdf.findIndex(value => value >= q - 1e-12); return day < 0 ? null : day;
}

/** Deterministic given input+seed. Joint p0/gamma and independent p1 are fixed per path.
 * Horizon tail mass remains missing, never re-normalized into a finite completion date. */
export function forecastDurationModel(artifact: DurationArtifact, input: DurationForecastInput): DurationForecastResult {
  const H = input.horizonDays;
  requireInput(integer(H, 0, 10_000) && integer(input.samples, 1, MAX_SAMPLE_PATHS) && integer(input.seed, 0, 0xffff_ffff) &&
    integer(input.remainingAmount, 0, Number.MAX_SAFE_INTEGER) && integer(input.sessionAmount, 1, Number.MAX_SAFE_INTEGER) &&
    ['DONE', 'SKIPPED'].includes(input.initialState), 'Invalid duration forecast input');
  requireInput(integer(artifact.capDays, 2, MAX_CAP), 'Invalid artifact cap');
  const a = artifact.kind === 'BETA_BASELINE_V1' ? artifact.posterior.a : artifact.donePosterior;
  requireInput(positive(a.alpha) && positive(a.beta) && a.alpha + a.beta <= 1e9, 'Invalid DONE posterior');
  const N = Math.ceil(input.remainingAmount / input.sessionAmount);
  const exact = artifact.kind === 'BETA_BASELINE_V1';
  const computation = exact ? { method: 'EXACT_BETA' as const, samples: null, seed: null } :
    { method: 'POSTERIOR_PATHS' as const, samples: input.samples, seed: input.seed };
  if (N === 0) return { status: 'available', cdf: Array<number>(H + 1).fill(1), p50Days: 0, p80Days: 0, computation };
  if (!exact && input.initialState === 'SKIPPED' && input.initialRestDays === null) {
    return { status: 'insufficient', reason: 'UNKNOWN_CURRENT_DURATION' };
  }
  if (!exact && input.initialState === 'SKIPPED') requireInput(integer(input.initialRestDays!, 1, Number.MAX_SAFE_INTEGER), 'Invalid origin age');
  if (N > H) return { status: 'available', cdf: Array<number>(H + 1).fill(0), p50Days: null, p80Days: null, computation };
  if (artifact.kind === 'BETA_BASELINE_V1') {
    try {
      const valueAt = integratedCompletionCdf(artifact.posterior, input.initialState, N, H);
      const cdf = Array.from({ length: H + 1 }, (_, day) => valueAt(day));
      const exactQuantile = (q: .5 | .8) => {
        const day = cdf.findIndex((value, i) => Math.abs(value - (q - 1e-12)) <= 1e-10 ?
          exactIntegratedReached(artifact.posterior, input.initialState, N, i, q) : value >= q - 1e-12);
        return day < 0 ? null : day;
      };
      return { status: 'available', cdf, p50Days: exactQuantile(.5), p80Days: exactQuantile(.8), computation };
    } catch (error) {
      // The analytic helper has a private numerical Error type and finite domain.
      // Preserve an unavailable forecast across bundling, without inspecting class names.
      if (!(error instanceof Error)) throw error;
      return { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' };
    }
  }
  requireInput(artifact.kind === 'DURATION_JOINT_V1' && artifact.integration.converged &&
    integer(artifact.joint.length, 1, MAX_ATOMS * 64), 'Invalid joint artifact');
  requireInput(artifact.joint.every(node => Number.isFinite(node.pDoneAfterSkip) && node.pDoneAfterSkip > 0 &&
    node.pDoneAfterSkip < 1 && Number.isFinite(node.gamma) && Number.isFinite(node.weight) && node.weight >= 0), 'Invalid joint node');
  const mass = sum(artifact.joint.map(node => node.weight));
  requireInput(Math.abs(mass - 1) <= 1e-10, 'Joint artifact is not normalized');
  if (BigInt(input.samples) * BigInt(H) > 100_000_000n ||
    BigInt(artifact.joint.length) * BigInt(artifact.capDays + 1) > 1_000_000n) {
    return { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' };
  }
  const cumulative: number[] = []; let accumulated = 0;
  artifact.joint.forEach(node => { accumulated += node.weight; cumulative.push(accumulated); });
  cumulative[cumulative.length - 1] = 1;
  const hits = Array<number>(H + 1).fill(0), hazardCache = new Map<number, readonly number[]>();
  for (let path = 0; path < input.samples; path++) {
    const random = splitmix32(seedFor(input.seed, path));
    const p1 = betaSample(a.alpha, a.beta, random), u = uniform(random);
    if (!Number.isFinite(p1)) return { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' };
    let low = 0, high = cumulative.length - 1;
    while (low < high) { const middle = (low + high) >>> 1; if (u < cumulative[middle]!) high = middle; else low = middle + 1; }
    const node = artifact.joint[low]!;
    let hazards = hazardCache.get(low);
    if (!hazards) {
      hazards = Array.from({ length: artifact.capDays + 1 }, (_, r) => r === 0 ? 0 :
        skipProbability(node.pDoneAfterSkip, node.gamma, feature(r, artifact.capDays)));
      hazardCache.set(low, hazards);
    }
    let age = input.initialState === 'DONE' ? 0 : Math.min(input.initialRestDays!, artifact.capDays), done = 0;
    for (let day = 1; day <= H; day++) {
      if (uniform(random) < (age === 0 ? p1 : hazards[age]!)) {
        age = 0;
        if (++done === N) { hits[day] = hits[day]! + 1; break; }
      } else age = age === 0 ? 1 : Math.min(age + 1, artifact.capDays);
    }
  }
  let finished = 0;
  const cdf = hits.map(count => { finished += count; return finished / input.samples; });
  return { status: 'available', cdf, p50Days: quantile(cdf, .5), p80Days: quantile(cdf, .8), computation };
}
