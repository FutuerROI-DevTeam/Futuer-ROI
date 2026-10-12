/** バーは100%まで。数値は実比率を小数2桁で示し、超過量と差引きの関係を保つ。 */
export function progressPercent(done: number, total: number): number {
  return Math.max(0, Math.min(100, done / total * 100));
}

/**
 * 進捗率の数字（%は呼び出す側で付ける）。小数2桁で丸める。
 * 0より大きく0.01%を下回るときは「0.01」とし、progressPercentQualifier の「以下」を添える。
 * 未達成で丸めると100になるとき（99.995%以上）は、達成と取り違えないよう「99.99」にする（#255。以前は「<0.01」「<100」）。
 */
export function progressPercentLabel(done: number, total: number): string {
  const percent = Math.max(0, done / total * 100);
  if (percent === 0) return '0';
  const rounded = Number(percent.toFixed(2));
  if (rounded === 0) return '0.01';
  if (done < total && rounded === 100) return '99.99';
  return rounded.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

/** 「%」のあとに添える言葉。0より大きく0.01%を下回るときだけ「以下」（#255）。 */
export function progressPercentQualifier(done: number, total: number): string {
  const percent = Math.max(0, done / total * 100);
  return percent > 0 && Number(percent.toFixed(2)) === 0 ? '以下' : '';
}
