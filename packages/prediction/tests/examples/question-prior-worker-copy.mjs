import { parentPort, workerData } from 'node:worker_threads';
import {
  evaluateQuestionPriorAdapterCandidate,
  QuestionPriorAdapterCandidateError,
} from '../../dist/src/question-prior-adapter-candidate.js';
import { PredictionInputError, PredictionConfigError } from '../../dist/src/index.js';

// 契約テスト用の一回限りのworker例。API route／worker pool／Production wire DTOではない。
try {
  const result = evaluateQuestionPriorAdapterCandidate(workerData.request, workerData.config);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  // 未知の不具合を入力不正や成功値へ変換しない。詰め替えは既知classの分類だけを例示する。
  if (!(
    error instanceof QuestionPriorAdapterCandidateError ||
    error instanceof PredictionInputError ||
    error instanceof PredictionConfigError
  )) {
    throw error;
  }

  const copied = {
    name: error.name,
    reason: error.reason,
    path: [...error.path],
    ...(error instanceof QuestionPriorAdapterCandidateError ? { kind: error.kind } : {}),
  };
  // rawErrorとsourcePathFrozenはtransportの差を測るテスト診断だけ。実APIへ渡す項目ではない。
  parentPort.postMessage({ ok: false, rawError: error, copied, sourcePathFrozen: Object.isFrozen(error.path) });
}
