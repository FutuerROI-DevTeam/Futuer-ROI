import { PredictionConfigError } from './errors.js';

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/**
 * SKIPPEDから最初のDONEまでの待ち日数Gを、再開確率bの事後分布で積分した分位点。
 * g50はG自体の中央値であり、DONE開始とSKIPPED開始の完了日中央値の差ではない
 * （Architecture D-21）。完了予測のhorizonによる打切りもここには適用しない。
 */
export function recoveryQuantiles(alpha: number, beta: number): { g50: number; g80: number } {
  if (!Number.isSafeInteger(alpha) || alpha < 1 ||
      !Number.isSafeInteger(beta) || beta < 1) {
    throw new RangeError('Recovery posterior shapes must be positive safe integers');
  }
  // 入力の各形状がsafe integerでも、alpha+betaや累積積はその範囲を超えうる。
  // 浮動小数の比では閾値の直上が0.5へ丸められるため、加算・乗算の前にBigIntへ移す。
  const a = BigInt(alpha);
  const b = BigInt(beta);
  // 整数alphaが小さいときは同じ生存確率 (b)_alpha/(b+t)_alpha を使う。
  // 長い待ち日数を1日ずつ回さず、既存のg（horizon外を含む）を厳密に保つ。
  if (alpha <= 32) {
    let numerator = 1n;
    for (let i = 0n; i < a; i++) numerator *= b + i;
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    const find = (multiplier: bigint): number => {
      const reached = (t: bigint) => {
        let denominator = 1n;
        for (let i = 0n; i < a; i++) denominator *= b + t + i;
        return multiplier * numerator <= denominator;
      };
      let high = 1n;
      while (!reached(high)) {
        if (high === limit) throw new PredictionConfigError('RESOURCE_LIMIT', ['coreMetric'], 'Recovery exceeds safe day range');
        high = high * 2n > limit ? limit : high * 2n;
      }
      let low = 1n;
      while (low < high) {
        const middle = (low + high) / 2n;
        if (reached(middle)) high = middle; else low = middle + 1n;
      }
      return Number(low);
    };
    return { g50: find(2n), g80: find(5n) };
  }
  // 短積を全alphaへ広げるとalpha個のBigInt積が必要になるため、この版は
  // 検証したalpha<=32だけを短積にし、alpha>32は逐日積のworkを有限に保つ。
  // 旧方式で値が出る入力も予算超過でRESOURCE_LIMITになりうる。1000日は
  // gの定義や完了horizonではなく資源保護で、全入力への性能保証ではない。
  // t日後の生存確率P(G>t)=積_{i=0..t-1}(beta+i)/(alpha+beta+i)を整数比で保持する。
  // t=0ではまだ再開していない確率が1で、下のループで1日分ずつ更新する。
  let numerator = 1n;
  let denominator = 1n;
  let g50 = 0;
  for (let t = 1; ; t++) {
    if (!Number.isSafeInteger(t)) throw new RangeError('Recovery quantile exceeds safe integer range');
    // gを完了horizonで打ち切らず、計算不能はエラーとして返す。約分前の桁数も
    // 保守的に制限し、巨大shapeを受けた際の無制限BigInt処理を防ぐ。
    if (t > 1000 || t * Math.log2(alpha + beta + t) > 32_768) {
      throw new PredictionConfigError('RESOURCE_LIMIT', ['coreMetric'], 'Recovery exceeds exact arithmetic work budget');
    }
    const offset = BigInt(t) - 1n;
    numerator *= b + offset;
    denominator *= a + b + offset;
    // 約分して整数の桁数を抑える。生存確率の厳密な比較と、閾値への一致を含む境界は変えない。
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    // CDF=1-生存確率。g50はCDF>=0.5、g80はCDF>=0.8を満たす最小の日。
    // それぞれ生存確率<=1/2、<=1/5を交差乗算で比較し、等号の日も到達に含める。
    if (g50 === 0 && 2n * numerator <= denominator) g50 = t;
    if (5n * numerator <= denominator) return { g50, g80: t };
  }
}
