import { DEFAULT_CONFIG } from './config.js';
import { calculateWithPrior } from './predict.js';
import type { PriorCalculation } from './predict.js';
import type { PredictionConfig, PredictionInput } from './types.js';

// D-26採択前の内部候補。質問の選択肢・数値写像・保存/API契約ではない。
// aとbの由来を別々に残す。部分回答の補完やsourceの表示ラベルはここで決めない。
export interface BetaPriorCandidate {
  readonly alpha: number;
  readonly beta: number;
  readonly source: string;
  readonly version: string;
}

export interface GoalPriorCandidate {
  readonly a: BetaPriorCandidate;
  readonly b: BetaPriorCandidate;
}

export interface GoalPriorCandidateResult extends PriorCalculation {
  readonly priorSnapshot: GoalPriorCandidate;
}

// 候補の実際のpriorはsnapshotだけで指定する。共通スカラーpriorを二重に受け取らない。
export type GoalPriorCandidateConfig = Omit<PredictionConfig, 'prior'>;

function snapshot(prior: GoalPriorCandidate): GoalPriorCandidate {
  if (prior === null || typeof prior !== 'object') {
    throw new TypeError('Expected a candidate prior snapshot');
  }

  const copy = (name: 'a' | 'b'): BetaPriorCandidate => {
    const value = prior[name];
    if (value === null || typeof value !== 'object') {
      throw new TypeError(`Expected candidate prior ${name}`);
    }
    for (const shape of ['alpha', 'beta'] as const) {
      // 現行BigInt分位点とGamma抽選が扱える範囲。D-26の採択する強度や有効範囲とは区別する。
      if (!Number.isSafeInteger(value[shape]) || value[shape] < 1) {
        throw new RangeError(`Candidate prior ${name}.${shape} must be a positive safe integer`);
      }
    }
    for (const field of ['source', 'version'] as const) {
      if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
        throw new TypeError(`Candidate prior ${name}.${field} must be a nonempty string`);
      }
    }
    return { alpha: value.alpha, beta: value.beta, source: value.source, version: value.version };
  };
  return { a: copy('a'), b: copy('b') };
}

// 実績ログ全量＋初期snapshotから毎回再計算する。前回posteriorを次回のpriorへ渡す運用はしない。
// 達成済み／今日記録済み／実績起点の不足判定を保持し、回答だけで表示を許可するgateは追加しない。
export function evaluateGoalPriorCandidate(
  input: PredictionInput,
  prior: GoalPriorCandidate,
  config: GoalPriorCandidateConfig = DEFAULT_CONFIG,
): GoalPriorCandidateResult {
  const priorSnapshot = snapshot(prior);
  return {
    ...calculateWithPrior(input, { ...config, prior: DEFAULT_CONFIG.prior }, priorSnapshot),
    priorSnapshot,
  };
}
