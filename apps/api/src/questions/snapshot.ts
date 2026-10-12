import type { QuestionPriorAnswers, QuestionPriorMapping } from '@futureroi/prediction';
import { PredictionFailed } from '../prediction/engine.ts';

export const EMPTY_ANSWERS: QuestionPriorAnswers = Object.freeze({ a: null, b: null });
export const QUESTION_MAPPING: QuestionPriorMapping = Object.freeze({
  version: 'r11-strength4-v1',
  values: Object.freeze({
    LOW: Object.freeze({ alpha: 1, beta: 3 }),
    MID: Object.freeze({ alpha: 2, beta: 2 }),
    HIGH: Object.freeze({ alpha: 3, beta: 1 }),
  }),
});
export type AnswerContext = { unit: 'minutes' | 'sessions'; sessionAmount: number; recordStartDate: string };
export type SavedQuestionSnapshot = {
  schemaVersion: 'r11-prior-v1';
  mapping: QuestionPriorMapping;
  context: AnswerContext;
  prior: { a: { alpha: number; beta: number }; b: { alpha: number; beta: number } };
};
export type QuestionRow = { question_prior: QuestionPriorAnswers; answer_revision: string; question_prior_snapshot: unknown };

export const isEmpty = (a: QuestionPriorAnswers): boolean => a.a === null && a.b === null;
export const sameAnswers = (a: QuestionPriorAnswers, b: QuestionPriorAnswers): boolean => a.a === b.a && a.b === b.b;

export function makeQuestionSnapshot(answers: QuestionPriorAnswers, context: AnswerContext): SavedQuestionSnapshot | null {
  if (isEmpty(answers)) return null;
  const beta = (answer: QuestionPriorAnswers['a']) => ({
    ...(answer === null || answer === 'UNKNOWN'
      ? QUESTION_MAPPING.values.MID
      : QUESTION_MAPPING.values[answer]),
  });
  return {
    schemaVersion: 'r11-prior-v1',
    mapping: QUESTION_MAPPING,
    context: { ...context },
    prior: { a: beta(answers.a), b: beta(answers.b) },
  };
}

function invalid(path: string): never {
  throw new PredictionFailed({ name: 'QuestionSnapshotError', kind: 'config', reason: 'INVALID_SAVED_QUESTION', path: [path] });
}

// pgはint8をstringで返す。変換前に範囲を確認し、丸め・wrap・版のresetをしない。
export function answerRevision(value: string): number {
  if (
    typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    invalid('answerRevision');
  }
  return Number(value);
}

export function validateSavedQuestion(
  row: QuestionRow,
  context: AnswerContext,
): { answers: QuestionPriorAnswers; revision: number; mapping: QuestionPriorMapping } {
  const answers = row.question_prior;
  if (
    !answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== 2 ||
    !Object.hasOwn(answers, 'a') || !Object.hasOwn(answers, 'b') ||
    ![null, 'UNKNOWN', 'LOW', 'MID', 'HIGH'].includes(answers.a) ||
    ![null, 'UNKNOWN', 'LOW', 'MID', 'HIGH'].includes(answers.b)
  ) {
    invalid('questionPrior');
  }
  const revision = answerRevision(row.answer_revision);
  if (isEmpty(answers)) {
    if (row.question_prior_snapshot !== null) invalid('questionPriorSnapshot');
    return { answers: { ...answers }, revision, mapping: QUESTION_MAPPING };
  }
  // 保存形式・mappingを厳密に検証し、未知の版を最新mappingへ読み替えない。
  const expected = makeQuestionSnapshot(answers, context)!;
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (
      !a || !b || typeof a !== 'object' || typeof b !== 'object' ||
      Array.isArray(a) || Array.isArray(b)
    ) {
      return false;
    }
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    return Object.keys(left).length === Object.keys(right).length &&
      Object.keys(right).every(k => Object.hasOwn(left, k) && equal(left[k], right[k]));
  };
  if (!equal(row.question_prior_snapshot, expected)) invalid('questionPriorSnapshot');
  return { answers: { ...answers }, revision, mapping: (row.question_prior_snapshot as SavedQuestionSnapshot).mapping };
}
