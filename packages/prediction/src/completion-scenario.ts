import { completionQuantiles } from './completion-integrated.js';
import type { Completion, Posterior, PredictionConfig, PredictionInput, PredictionResult } from './types.js';

// 入力・config・posteriorは呼び出し側で検証済み、かつ完了の材料ありの場合にだけ使う。
// 旧predictとR-11の公開wrapperが使う内部adapterで、今日の実量／仮実行の扱いを共有する。
export function completionFromValidatedState(
  goal: PredictionInput['goal'],
  actualDone: number,
  todayStatus: PredictionResult['todayStatus'],
  posterior: Posterior,
  config: Pick<PredictionConfig, 'samples' | 'horizonDays' | 'seed' | 'completionMethod'>,
): Extract<Completion, { status: 'available' }> {
  const scenario = todayStatus === 'UNRECORDED' ? 'TODAY_DONE' : 'CURRENT_STATE';

  // 量はGoal内の同じ単位（整数分／回）。actualDoneには記録済みの今日量も一度だけ含む。
  // 未記録時だけ今日の既定量を仮定して引き、実績・posteriorには加えない。
  const remaining = goal.totalRequired - actualDone -
    (todayStatus === 'UNRECORDED' ? goal.sessionAmount : 0);

  // 明日以降は設定量ずつ進む仮定で、必要DONE回数を整数で切り上げる。仮実行で届けば0日。
  const sessionAmountBigInt = BigInt(goal.sessionAmount);
  const requiredFutureDone = remaining <= 0
    ? 0
    : Number((BigInt(remaining) + sessionAmountBigInt - 1n) / sessionAmountBigInt);

  // 今日の分は残量へ反映済み。今日の実状態／仮DONEから、明日以降のDONEを0回から数える。
  const quantiles = completionQuantiles(
    posterior,
    todayStatus === 'SKIPPED' ? 'SKIPPED' : 'DONE',
    requiredFutureDone,
    config,
  );
  return { status: 'available', scenario, ...quantiles };
}
