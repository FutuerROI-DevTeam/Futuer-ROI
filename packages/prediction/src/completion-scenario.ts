import { completionQuantiles } from './completion-integrated.js';
import type { Completion, Posterior, PredictionConfig, PredictionInput, PredictionResult } from './types.js';

// 入力・config・posteriorは呼び出し側で検証済み、かつ完了の材料ありの場合にだけ使う。
// 旧predictとR-11の公開wrapperが使う内部adapterで、今日の実量／仮実行の扱いを共有する。
export function completionFromValidatedState(goal: PredictionInput['goal'], actualDone: number,
  todayStatus: PredictionResult['todayStatus'], posterior: Posterior,
  config: Pick<PredictionConfig, 'samples' | 'horizonDays' | 'seed' | 'completionMethod'>): Extract<Completion, { status: 'available' }> {
  const scenario = todayStatus === 'UNRECORDED' ? 'TODAY_DONE' : 'CURRENT_STATE';
  // actualDoneは初期進捗と今日までのDONE実量の合計。今日記録済みなら今日の量も
  // 一度だけ含まれているので、sessionAmountをもう一度差し引かない。
  // 未記録時だけ「今日、既定量をやる」と仮定して1回分を引く。実績・posteriorへは加えない。
  const remaining = goal.totalRequired - actualDone - (todayStatus === 'UNRECORDED' ? goal.sessionAmount : 0);
  // 明日以降のDONEは既定量sessionAmountずつ進む仮定。過去・今日の実量を置き換えず、
  // 仮実行を引いた残量から将来の必要回数を切り上げる。仮実行で届く場合は0日。
  const amount = BigInt(goal.sessionAmount);
  const requiredFutureDone = remaining <= 0 ? 0 : Number((BigInt(remaining) + amount - 1n) / amount);
  // DPの開始状態は今日の実状態、または未記録時に仮定したDONE。今日の分は
  // 上の残量へ反映済みで、DPのDONE累計は明日から0回として数える。
  const quantiles = completionQuantiles(posterior, todayStatus === 'SKIPPED' ? 'SKIPPED' : 'DONE',
    requiredFutureDone, config);
  return { status: 'available', scenario, ...quantiles };
}
