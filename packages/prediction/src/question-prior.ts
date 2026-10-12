import { DEFAULT_CONFIG } from './config.js';
import {
  evaluateQuestionPriorAdapterCandidate,
  QuestionPriorAdapterCandidateError,
} from './question-prior-adapter-candidate.js';
import type {
  QuestionPriorPredictionInput,
  QuestionPriorPredictionConfig,
  QuestionPriorPredictionResult,
  QuestionPriorEvaluation,
  QuestionPriorValidationCause,
} from './question-prior-types.js';

// #133: 依頼者承認されたR-11の公開境界。数値核と旧predictはそのまま使う。
// mappingは保存時snapshotからserverが渡す。HTTP clientからBetaを受け取らない。
export type {
  QuestionPriorAnswer,
  QuestionPriorAnswers,
  QuestionPriorMapping,
  QuestionPriorPredictionInput,
  QuestionPriorPredictionConfig,
  QuestionPriorEvidenceSource,
  QuestionPriorPredictionResult,
  QuestionPriorEvaluation,
} from './question-prior-types.js';

export class QuestionPriorError extends TypeError {
  readonly kind: 'input' | 'config';
  readonly reason: string;
  readonly path: readonly (string | number)[];
  constructor(cause: QuestionPriorValidationCause) {
    super('Invalid question prior');
    this.name = 'QuestionPriorError';
    this.kind = cause.kind;
    this.reason = cause.reason;
    this.path = cause.path;
  }
}

export function predictWithQuestionPrior(
  input: QuestionPriorPredictionInput,
  config: QuestionPriorPredictionConfig = DEFAULT_CONFIG,
): QuestionPriorEvaluation {
  try {
    // adapterは両方の材料がある場合も完了予測を二重に計算しない。
    const adapterResult = evaluateQuestionPriorAdapterCandidate(input, config);
    // 内部結果へ項目が増えても公開結果に伝播させない。既存のkey順とネスト値を保持する。
    const prediction: QuestionPriorPredictionResult = {
      modelVersion: 'm1-question-prior-v1',
      today: adapterResult.today,
      todayStatus: adapterResult.todayStatus,
      progress: adapterResult.progress,
      observations: adapterResult.observations,
      posterior: adapterResult.posterior,
      coreMetric: adapterResult.coreMetric,
      completion: adapterResult.completion,
      config: adapterResult.config,
    };
    return {
      prediction,
      provenance: adapterResult.evidenceSource,
      plan: !prediction.progress.completed && prediction.completion.status === 'insufficient'
        ? adapterResult.conditionalPlan
        : null,
    };
  } catch (error) {
    if (error instanceof QuestionPriorAdapterCandidateError) {
      throw new QuestionPriorError(error);
    }
    throw error;
  }
}
