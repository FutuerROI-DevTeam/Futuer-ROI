import { PredictionConfigError } from './errors.js';

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }

  return a;
}

/**
 * SKIPPEDから最初のDONEまでの待ち日数Gを、再開確率bの事後分布で積分した分位点。
 * g50はG自体の中央値であり、DONE開始とSKIPPED開始の完了日中央値の差ではない
 * （Architecture D-21）。完了予測のhorizonによる打切りもここには適用しない。
 */
export function recoveryQuantiles(alpha: number, beta: number): { g50: number; g80: number } {
  if (
    !Number.isSafeInteger(alpha) || alpha < 1 ||
    !Number.isSafeInteger(beta) || beta < 1
  ) {
    throw new RangeError('Recovery posterior shapes must be positive safe integers');
  }

  // shapeの和・積はsafe integerを超えうる。閾値直上の比を丸めないよう、演算前にBigIntへ移す。
  const a = BigInt(alpha);
  const b = BigInt(beta);

  // 小さい整数alphaでは生存確率 (b)_alpha/(b+t)_alpha の短積を使い、長い待ちも厳密に探索する。
  if (alpha <= 32) {
    let numerator = 1n;
    for (let i = 0n; i < a; i++) {
      numerator *= b + i;
    }

    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    const find = (multiplier: bigint): number => {
      const reached = (t: bigint) => {
        let denominator = 1n;
        for (let i = 0n; i < a; i++) {
          denominator *= b + t + i;
        }

        return multiplier * numerator <= denominator;
      };

      let high = 1n;
      while (!reached(high)) {
        if (high === limit) {
          throw new PredictionConfigError(
            'RESOURCE_LIMIT',
            ['coreMetric'],
            'Recovery exceeds safe day range',
          );
        }
        high = high * 2n > limit ? limit : high * 2n;
      }

      let low = 1n;
      while (low < high) {
        const middle = (low + high) / 2n;
        if (reached(middle)) {
          high = middle;
        } else {
          low = middle + 1n;
        }
      }

      return Number(low);
    };

    return { g50: find(2n), g80: find(5n) };
  }

  // 短積は検証済みのalpha<=32に限定する。alpha>32では逐日積の計算量を制限する。
  // 1000日は資源保護であり、gの定義や完了horizonではない。旧方式で計算できた入力も
  // 予算超過ならRESOURCE_LIMITになり、全入力への性能保証はしない。
  // P(G>t)=積_{i=0..t-1}(beta+i)/(alpha+beta+i)。t=0の整数比1から1日ずつ更新する。
  let numerator = 1n;
  let denominator = 1n;
  let g50 = 0;

  for (let t = 1; ; t++) {
    if (!Number.isSafeInteger(t)) {
      throw new RangeError('Recovery quantile exceeds safe integer range');
    }

    // 約分前の桁数も保守的に制限する。計算不能をhorizon打切りの値へ変換しない。
    if (t > 1000 || t * Math.log2(alpha + beta + t) > 32_768) {
      throw new PredictionConfigError(
        'RESOURCE_LIMIT',
        ['coreMetric'],
        'Recovery exceeds exact arithmetic work budget',
      );
    }

    const offset = BigInt(t) - 1n;
    numerator *= b + offset;
    denominator *= a + b + offset;

    // 比を変えずに約分し、整数の桁数を抑える。
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;

    // CDF>=0.5/0.8となる最小日を、生存確率<=1/2・1/5の厳密な交差積で求める。等号も含む。
    if (g50 === 0 && 2n * numerator <= denominator) {
      g50 = t;
    }
    if (5n * numerator <= denominator) {
      return { g50, g80: t };
    }
  }
}
