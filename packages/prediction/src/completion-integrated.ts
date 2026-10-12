import { PredictionConfigError } from './errors.js';
import { mixtureCompletionQuantiles } from './completion.js';
import { samplePosterior } from './random.js';
import type { CompletionComputation, Posterior, PredictionConfig } from './types.js';

// 既存比較の有限fixtureで観測したCDF誤差<=5.77e-15より広い近傍幅。
// 全域の誤差上界の証明ではない。MAX_CLOSED_*や漸化式を変える場合は
// 独立oracle・閾値境界・数値gateを再検証する（#203の検証資料）。
export const NUMERICAL_MARGIN = 1e-10;
const QUANTILE_TOLERANCE = 1e-12;
const MAX_CLOSED_HORIZON = 1095;
const MAX_CLOSED_SHAPE = 1_000_000;

class NumericalUncertainty extends Error {}

function compensatedSum(values: Iterable<number>): number {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = value - correction;
    const total = sum + next;
    correction = (total - sum) - next;
    sum = total;
  }

  return sum;
}

// 小さい失敗確率の1への丸めと、大きい成功確率のlog1p(-1)を避ける。
function logFailure(alpha: number, beta: number): number {
  return alpha <= beta
    ? Math.log1p(-alpha / (alpha + beta))
    : Math.log(beta / (alpha + beta));
}

function logZero(n: number, alpha: number, beta: number): number {
  const terms = Array.from({ length: n }, (_, i) => logFailure(alpha, beta + i));
  return compensatedSum(terms);
}

// 閾値の近傍だけ整数Beta-binomialの共通分母で比較する。次数はday<=1095、
// shape<=1e6なので閾値との交差積も32768bit以内。一般精度計算や全体cacheは持たない。
function integerMasses(n: number, alpha: number, beta: number) {
  const a = BigInt(alpha);
  const b = BigInt(beta);
  let denominator = 1n;
  let term = 1n;
  for (let i = 0n; i < BigInt(n); i++) {
    denominator *= a + b + i;
    term *= b + i;
  }

  const masses = [term];
  for (let k = 1; k <= n; k++) {
    const dividend = term * BigInt(n - k + 1) * (a + BigInt(k) - 1n);
    const divisor = BigInt(k) * (b + BigInt(n - k));
    if (dividend % divisor !== 0n) {
      throw new NumericalUncertainty();
    }
    term = dividend / divisor;
    masses.push(term);
  }

  if (masses.reduce((sum, value) => sum + value, 0n) !== denominator) {
    throw new NumericalUncertainty();
  }
  return { masses, denominator };
}

export function exactIntegratedReached(
  posterior: Posterior,
  initialState: 'DONE' | 'SKIPPED',
  N: number,
  day: number,
  q: .5 | .8,
): boolean {
  if (
    !Number.isSafeInteger(N) || N < 0 ||
    !Number.isSafeInteger(day) || day < 0 || day > MAX_CLOSED_HORIZON ||
    !['DONE', 'SKIPPED'].includes(initialState) || ![.5, .8].includes(q) ||
    [posterior.a.alpha, posterior.a.beta, posterior.b.alpha, posterior.b.beta]
      .some(value => !Number.isSafeInteger(value) || value < 1 || value > MAX_CLOSED_SHAPE)
  ) {
    throw new RangeError('Outside exact completion comparison domain');
  }

  const bitBound = Math.ceil(day * Math.log2(2 * MAX_CLOSED_SHAPE + MAX_CLOSED_HORIZON)) + 41;
  if (bitBound > 32768) {
    throw new NumericalUncertainty();
  }
  if (N === 0) {
    return true;
  }
  if (day < N) {
    return false;
  }

  // I=開始SKIPPEDの1回、m=N-IはDONE起点の試行数。離脱Rと再開数の分布を整数比で持つ。
  const initialSkipCount = Number(initialState === 'SKIPPED');
  const doneOriginTrials = N - initialSkipCount;
  const departures = integerMasses(doneOriginTrials, posterior.a.beta, posterior.a.alpha);
  const resumptions = integerMasses(day - doneOriginTrials, posterior.b.alpha, posterior.b.beta);
  const resumptionTail: bigint[] = Array<bigint>(resumptions.masses.length + 1).fill(0n);
  for (let k = resumptions.masses.length - 1; k >= 0; k--) {
    resumptionTail[k] = resumptionTail[k + 1]! + resumptions.masses[k]!;
  }

  // d日以内の完了条件は再開数>=R+I。分母を共有したまま、各Rの尾を加重する。
  let numerator = 0n;
  for (let r = 0; r < departures.masses.length; r++) {
    numerator += departures.masses[r]! * (resumptionTail[r + initialSkipCount] ?? 0n);
  }
  const denominator = departures.denominator * resumptions.denominator;
  if (numerator < 0n || numerator > denominator) {
    throw new NumericalUncertainty();
  }

  const threshold = (q === .5 ? 500_000_000_000n : 800_000_000_000n) - 1n;
  const left = numerator * 1_000_000_000_000n;
  const right = denominator * threshold;
  if (Math.max(left.toString(2).length, right.toString(2).length) > bitBound) {
    throw new NumericalUncertainty();
  }

  return left >= right;
}

/**
 * 同じ固定a,bのMarkov連鎖を独立Beta posteriorで積分する。
 * I=開始SKIPPED、m=N-I。DONE間の休みへの離脱数RはBB(m,a.beta,a.alpha)。
 * d日以内完了はBB(d-m,b.alpha,b.beta)>=R+I。尾を再正規化しない。
 * 公開設定の全域を倍精度で保証する境界ではなく、検証した有限領域の数値部品。
 */
export function integratedCompletionCdf(
  posterior: Posterior,
  initialState: 'DONE' | 'SKIPPED',
  requiredFutureDone: number,
  horizonDays: number,
): (day: number) => number {
  const N = requiredFutureDone;
  const H = horizonDays;
  if (
    !Number.isSafeInteger(N) || N < 1 ||
    !Number.isSafeInteger(H) || N > H || H > MAX_CLOSED_HORIZON ||
    !['DONE', 'SKIPPED'].includes(initialState) ||
    [posterior.a.alpha, posterior.a.beta, posterior.b.alpha, posterior.b.beta]
      .some(value => !Number.isSafeInteger(value) || value < 1 || value > MAX_CLOSED_SHAPE)
  ) {
    throw new RangeError('Outside integrated completion domain');
  }

  const { a, b } = posterior;
  const initialSkipCount = Number(initialState === 'SKIPPED');
  const doneOriginTrials = N - initialSkipCount;

  // DONE起点m=N-I回で離脱する回数RのBeta-binomial質量。再開側の尾へ掛ける重みになる。
  const departureWeights = new Float64Array(doneOriginTrials + 1);
  let logWeight = logZero(doneOriginTrials, a.beta, a.alpha);
  departureWeights[0] = Math.exp(logWeight);
  for (let r = 1; r <= doneOriginTrials; r++) {
    logWeight += Math.log((doneOriginTrials - r + 1) / r) +
      Math.log((a.beta + r - 1) / (a.alpha + doneOriginTrials - r));
    departureWeights[r] = Math.exp(logWeight);
  }
  const mass = compensatedSum(departureWeights);
  if (!Number.isFinite(mass) || Math.abs(mass - 1) > NUMERICAL_MARGIN) {
    throw new NumericalUncertainty();
  }

  // L=d-m回のSKIPPED起点試行で再開0回となるlog質量と、次の質量への漸化式係数。
  const logNoResumptions = new Float64Array(H - doneOriginTrials + 1);
  const resumptionLogCoefficient = new Float64Array(N);
  let sum = 0;
  let correction = 0;
  for (let skipOriginTrials = 1; skipOriginTrials < logNoResumptions.length; skipOriginTrials++) {
    const next = logFailure(b.alpha, b.beta + skipOriginTrials - 1) - correction;
    const total = sum + next;
    correction = (total - sum) - next;
    sum = total;
    logNoResumptions[skipOriginTrials] = sum;
  }
  for (let j = 1; j < resumptionLogCoefficient.length; j++) {
    resumptionLogCoefficient[j] = Math.log((b.alpha + j - 1) / j);
  }

  // この要求のP50/P80だけで共有する。ownerを跨ぐ状態や全体cacheは持たない。
  const cache = new Map<number, number>();
  return day => {
    if (!Number.isSafeInteger(day) || day < 0 || day > H) {
      throw new RangeError('Invalid completion CDF day');
    }
    const cached = cache.get(day);
    if (cached !== undefined) {
      return cached;
    }
    if (day < N) {
      return 0;
    }

    const skipOriginTrials = day - doneOriginTrials;
    let logResumptionMass = logNoResumptions[skipOriginTrials]!;
    let lowerResumptionCdf = 0;
    let lowerResumptionCorrection = 0;
    let cdf = initialSkipCount ? 0 : departureWeights[0]!;
    let cdfCorrection = 0;
    for (let k = 1; k <= Math.min(N, skipOriginTrials); k++) {
      const j = k - 1;
      if (j > 0) {
        logResumptionMass += resumptionLogCoefficient[j]! +
          Math.log((skipOriginTrials - j + 1) / (b.beta + skipOriginTrials - j));
      }
      const next = Math.exp(logResumptionMass) - lowerResumptionCorrection;
      const total = lowerResumptionCdf + next;
      lowerResumptionCorrection = (total - lowerResumptionCdf) - next;
      lowerResumptionCdf = total;

      // k=R+I回以上の再開を要する離脱経路へ、再開分布の尾を掛ける。
      const weighted = departureWeights[k - initialSkipCount]! *
        (1 - lowerResumptionCdf) - cdfCorrection;
      const updated = cdf + weighted;
      cdfCorrection = (updated - cdf) - weighted;
      cdf = updated;
    }
    if (!Number.isFinite(cdf) || cdf < -NUMERICAL_MARGIN || cdf > 1 + NUMERICAL_MARGIN) {
      throw new NumericalUncertainty();
    }
    // binary searchの単調性が計算誤差で壊れた場合も、確定した分位点に見せない。
    for (const [previousDay, previous] of cache) {
      if (
        (previousDay < day && previous > cdf + NUMERICAL_MARGIN) ||
        (previousDay > day && previous < cdf - NUMERICAL_MARGIN)
      ) {
        throw new NumericalUncertainty();
      }
    }
    cache.set(day, cdf);
    return cdf;
  };
}

function integratedQuantiles(
  cdf: (day: number) => number,
  N: number,
  H: number,
  exact: (day: number, q: .5 | .8) => boolean,
) {
  const decisions = new Map<string, boolean>();
  const reached = (day: number, q: .5 | .8) => {
    const key = `${day}/${q}`;
    const cached = decisions.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = cdf(day);
    const threshold = q - QUANTILE_TOLERANCE;
    // H、探索途中、最終境界すべての近傍比較へ適用し、samplingへ曖昧に戻さない。
    const result = Math.abs(value - threshold) <= NUMERICAL_MARGIN
      ? exact(day, q)
      : value >= threshold;
    decisions.set(key, result);
    return result;
  };

  const find = (q: .5 | .8): number | null => {
    if (!reached(H, q)) {
      return null;
    }

    let low = N;
    let high = H;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (reached(middle, q)) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    if (!reached(low, q) || (low > N && reached(low - 1, q))) {
      throw new NumericalUncertainty();
    }

    return low;
  };

  const p50Days = find(.5);
  const p80Days = find(.8);
  if ((p50Days ?? Infinity) > (p80Days ?? Infinity)) {
    throw new NumericalUncertainty();
  }

  return { p50Days, p80Days };
}

export function completionQuantiles(
  posterior: Posterior,
  initialState: 'DONE' | 'SKIPPED',
  N: number,
  config: Pick<PredictionConfig, 'samples' | 'horizonDays' | 'seed' | 'completionMethod'>,
): { p50Days: number | null; p80Days: number | null; computation: CompletionComputation } {
  const H = config.horizonDays;
  const noSampling = (method: 'BOUNDARY' | 'BETA_BINOMIAL'): CompletionComputation =>
    ({ method, samples: null, seed: null, fallbackReason: null });

  // 計算の材料ありの分岐でのみ呼ばれる。完了・不足の判定は呼び出し側に保つ。
  if (N === 0) {
    return { p50Days: 0, p80Days: 0, computation: noSampling('BOUNDARY') };
  }
  if (N > H) {
    return { p50Days: null, p80Days: null, computation: noSampling('BOUNDARY') };
  }

  let fallbackReason: CompletionComputation['fallbackReason'] = null;
  if (config.completionMethod !== 'sampled') {
    if (H > MAX_CLOSED_HORIZON) {
      fallbackReason = 'HORIZON_OUT_OF_RANGE';
    } else if (
      [posterior.a.alpha, posterior.a.beta, posterior.b.alpha, posterior.b.beta]
        .some(shape => shape > MAX_CLOSED_SHAPE)
    ) {
      fallbackReason = 'SHAPE_OUT_OF_RANGE';
    } else {
      try {
        const cdf = integratedCompletionCdf(posterior, initialState, N, H);
        return {
          ...integratedQuantiles(
            cdf,
            N,
            H,
            (day, q) => exactIntegratedReached(posterior, initialState, N, day, q),
          ),
          computation: noSampling('BETA_BINOMIAL'),
        };
      } catch (error) {
        if (!(error instanceof NumericalUncertainty)) {
          throw error;
        }
        fallbackReason = 'NUMERICAL_UNCERTAINTY';
      }
    }
  }

  // 既存のsampled計算を残すが、巨大な公開設定を配列確保前に拒否する。
  // これは有限workの保護であって500msやHTTP応答時間の保証ではない。
  if (
    H > 10_000 || config.samples > 12_800 ||
    BigInt(config.samples) * BigInt(N) * BigInt(H) > 1_000_000_000n
  ) {
    throw new PredictionConfigError(
      'RESOURCE_LIMIT',
      ['completion'],
      'Sampled completion exceeds work budget',
    );
  }

  const result = mixtureCompletionQuantiles(
    samplePosterior(posterior, config.samples, config.seed),
    initialState,
    N,
    H,
  );
  return {
    ...result,
    computation: {
      method: 'POSTERIOR_SAMPLING',
      samples: config.samples,
      seed: config.seed,
      fallbackReason,
    },
  };
}
