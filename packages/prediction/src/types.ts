// Architectureに基づく計算用の契約。HTTP等の外部データ形式の検証とは分ける。
// 呼び出し側がGoalのtimezoneでYYYY-MM-DDを渡す。Engineは現在時計を読まない。
export type LocalDate = string;

export interface PredictionInput {
  goal: { totalRequired: number; initialProgress: number; sessionAmount: number };
  // 量はGoalと同じ単位。DONEは実際の記録量を使い、sessionAmountへ置き換えない。
  logs: { localDate: LocalDate; status: 'DONE' | 'SKIPPED'; amount: number | null }[];
  today: LocalDate;
}

export interface TransitionCounts {
  nDD: number;
  nDS: number;
  nSD: number;
  nSS: number;
}

export interface Posterior {
  a: { alpha: number; beta: number };
  b: { alpha: number; beta: number };
}

// statusで計算できない状態と、計算結果が0日の状態を区別する。
// g50/g80は整数の待ち日数。分位点の閾値をBigIntで厳密に比較する。
export type CoreMetric =
  | { status: 'available'; g50: number; g80: number }
  | { status: 'insufficient'; reason: 'NO_SKIP_ORIGIN_TRANSITION' }
  | { status: 'not_applicable'; reason: 'TODAY_RECORDED' | 'COMPLETED' };

export interface PredictionConfig {
  modelVersion: string;
  prior: number;
  // sampling経路へ要求する設定。実使用はcompletion.computationで区別する。
  samples: number;
  horizonDays: number;
  seed: number;
  // 省略はauto。sampledは従来の固定seedによる比較・互換計算を明示する。
  completionMethod?: 'auto' | 'sampled';
}

export interface CompletionComputation {
  method: 'BOUNDARY' | 'BETA_BINOMIAL' | 'POSTERIOR_SAMPLING';
  samples: number | null;
  seed: number | null;
  fallbackReason: 'HORIZON_OUT_OF_RANGE' | 'SHAPE_OUT_OF_RANGE' | 'NUMERICAL_UNCERTAINTY' | null;
}

export type Completion =
  | { status: 'available'; scenario: 'TODAY_DONE' | 'CURRENT_STATE';
      p50Days: number | null; p80Days: number | null;
      // Engine内部の診断情報。HTTP serializerは既存DTOだけを返し、この項目を公開しない。
      // 旧保存fixtureの読取互換のため任意だが、新しいavailable結果は常に実方式を返す。
      computation?: CompletionComputation }
  | { status: 'insufficient'; reason: 'NO_DONE_ORIGIN_TRANSITION' | 'NO_SKIP_ORIGIN_TRANSITION' }
  | { status: 'completed' };

// 数値部品と、不完全なResultを拒否する型検査に使う内部計算用の型。
export interface PredictionCalculation {
  modelVersion: string;
  today: LocalDate;
  todayStatus: 'DONE' | 'SKIPPED' | 'UNRECORDED';
  progress: { done: number; total: number; completed: boolean };
  observations: TransitionCounts & { effectiveTransitions: number };
  posterior: Posterior;
  coreMetric: CoreMetric;
  completion: Completion;
  config: Omit<PredictionConfig, 'modelVersion'>;
}

// 採択済みmetadataは既存の観測窓を説明する。
// observedDaysはstep1の暦日数（UNKNOWNを含む）、recordedDaysは保存された明示ログ件数。
// 履歴が空なら観測開始日も明示ログもないため、両方0にする。
export interface PredictionResult extends Omit<PredictionCalculation, 'observations'> {
  observations: PredictionCalculation['observations'] & { observedDays: number; recordedDays: number };
}
