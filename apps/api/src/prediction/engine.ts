import { PredictionConfigError, PredictionInputError, QuestionPriorError, predict, predictWithQuestionPrior,
  type PredictionInput, type PredictionResult, type QuestionPriorPredictionInput, type QuestionPriorEvaluation, type QuestionPriorPredictionResult } from '@futureroi/prediction';
import type { Static } from '@sinclair/typebox';
import type { PredictionResultSchema } from '../contracts/log.ts';
import type { PredictionR11 } from '../contracts/r11.ts';

// Engine（packages/prediction、純粋関数）との境界。DB・HTTP・時計はここに持ち込まない。
// MVPの同期実行とworker再検討条件はdocs/architecture.mdのD-28で採択済み。公開runtimeの計測は別の残件。
// 呼び出しをこの関数に閉じ込め、実行方式を再検討するときの差分と回帰を追跡できるようにする。

type SchemaResult = Static<typeof PredictionResultSchema>;
// schemaとEngineの型の双方向の代入互換を検査する。
// 任意項目の追加などは両方向に代入できるため、項目集合まで完全一致を保証する検査ではない。
export const predictionResultSchemaMatchesEngine: [SchemaResult extends PredictionResult ? true : false, PredictionResult extends SchemaResult ? true : false] = [true, true];
type R11SchemaResult = Static<typeof PredictionR11>;
export const questionPredictionSchemaMatchesEngine: [R11SchemaResult extends QuestionPriorPredictionResult ? true : false, QuestionPriorPredictionResult extends R11SchemaResult ? true : false] = [true, true];

export class PredictionFailed extends Error {
  readonly reason: string;
  readonly path: readonly (string | number)[];
  readonly failureName: string;
  readonly kind: 'input' | 'config' | undefined;
  constructor(cause: { name: string; reason: string; path: readonly (string | number)[]; kind?: 'input' | 'config' }) {
    super(`prediction failed: ${cause.name} ${cause.reason}`);
    this.name = 'PredictionFailed';
    this.reason = cause.reason;
    this.path = cause.path;
    this.failureName = cause.name;
    this.kind = cause.kind;
  }
}

// 実方式は純粋Engineの診断に保持する。既存strict HTTP DTO／union選択へ
// 余分なfieldを渡さず、公開p50/p80と要求configは変更しない。
export function toPublicCompletion(completion: PredictionResult['completion']): PredictionResult['completion'] {
  if (completion.status !== 'available') return completion;
  const { computation: _computation, ...publicCompletion } = completion;
  return publicCompletion;
}

export function runPrediction(input: PredictionInput): PredictionResult {
  try {
    const result = predict(input);
    return { ...result, completion: toPublicCompletion(result.completion) };
  } catch (error) {
    // 保存済みデータから組み立てた入力の不正（未来日付・重複等）は利用者が直せないため、原因を記録して500にする。
    if (error instanceof PredictionInputError || error instanceof PredictionConfigError) throw new PredictionFailed(error);
    throw error;
  }
}

export function runQuestionPrediction(input: QuestionPriorPredictionInput): QuestionPriorEvaluation {
  try {
    const result = predictWithQuestionPrior(input);
    return { ...result, prediction: { ...result.prediction, completion: toPublicCompletion(result.prediction.completion) } };
  } catch (error) {
    if (error instanceof PredictionInputError || error instanceof PredictionConfigError || error instanceof QuestionPriorError) throw new PredictionFailed(error);
    throw error;
  }
}
