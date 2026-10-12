/** バーは100%まで。数値は実比率を小数2桁で示し、超過量と差引きの関係を保つ。 */
export function progressPercent(done: number, total: number): number {
  return Math.max(0, Math.min(100, done / total * 100));
}

export function progressPercentLabel(done: number, total: number): string {
  const percent = Math.max(0, done / total * 100);
  if (percent === 0) return '0';
  const rounded = Number(percent.toFixed(2));
  if (rounded === 0) return '<0.01';
  if (done < total && rounded === 100) return '<100';
  return rounded.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}
