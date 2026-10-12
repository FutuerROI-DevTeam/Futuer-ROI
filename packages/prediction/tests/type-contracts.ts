import { predict, PredictionInputError, PredictionConfigError } from '../src/index.js';
import type {
  CoreMetric,
  LocalDate,
  PredictionInput,
  Completion,
  PredictionCalculation,
  PredictionResult,
} from '../src/index.js';
import type {
  QuestionPriorPredictionInput,
  QuestionPriorPredictionConfig,
  QuestionPriorPredictionResult,
} from '../src/index.js';

// @ts-expect-error rawのa/bは両方必要で、片方省略をUNKNOWNへ読み替えない。
const partialQuestion: QuestionPriorPredictionInput['answers'] = { a: 'LOW' };
// @ts-expect-error 内部Betaをraw回答に持たせない。
const betaAsAnswer: QuestionPriorPredictionInput['answers'] = { a: { alpha: 1, beta: 3 }, b: null };
// @ts-expect-error R-11 configは保存snapshotで分布を渡すためスカラーpriorを受け取らない。
const scalarQuestionConfig: QuestionPriorPredictionConfig = { modelVersion: 'behavior-persistence-m1-v1', samples: 200, horizonDays: 1095, seed: 20261012, prior: 2 };
function questionResultContract(result: QuestionPriorPredictionResult): void {
  // @ts-expect-error 回答由来の結果を旧スカラーpriorの結果へ偽装できない。
  const legacyResult: PredictionResult = result;
  void legacyResult;
}
void partialQuestion;
void betaAsAnswer;
void scalarQuestionConfig;
void questionResultContract;

const callerDate: LocalDate = '2026-10-03';
const input: PredictionInput = {
  goal: { totalRequired: 20, initialProgress: 2, sessionAmount: 10 },
  logs: [{ localDate: callerDate, status: 'SKIPPED', amount: null }],
  today: callerDate,
};
void input;

function waitingDays(metric: CoreMetric): number | undefined {
  switch (metric.status) {
    case 'available':
      return metric.g50;
    case 'insufficient':
    case 'not_applicable':
      return undefined;
  }
}
void waitingDays;

// @ts-expect-error 計算できない指標に数値の待ち日数を持たせない。
const unavailableWithDelay: CoreMetric = { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION', g50: 0 };
// @ts-expect-error UNKNOWNは記録のない暦日であり、保存するActionLogのstatusではない。
const unknownLog: PredictionInput['logs'][number] = { localDate: callerDate, status: 'UNKNOWN', amount: null };
// @ts-expect-error reasonは状態を区別するstatusと一致しなければならない。
const wrongReason: CoreMetric = { status: 'not_applicable', reason: 'NO_SKIP_ORIGIN_TRANSITION' };
void unavailableWithDelay;
void unknownLog;
void wrongReason;

const partialHorizon: Completion = { status: 'available', scenario: 'CURRENT_STATE', p50Days: 1, p80Days: null };
// @ts-expect-error 上限日数内で分位点へ届かなければnullにし、特別な文字列で代用しない。
const badTail: Completion = { status: 'available', scenario: 'TODAY_DONE', p50Days: 'unreachable', p80Days: null };
// @ts-expect-error 達成済みの結果に、未達成向けの完了日数見込みを持たせない。
const completedWithDays: Completion = { status: 'completed', p50Days: 0 };
function pendingMetadata(result: PredictionCalculation): void {
  // @ts-expect-error 内部計算だけの型には、Resultに必須の日数metadataがない。
  void result.observations.observedDays;
  // @ts-expect-error 内部計算の型には、採択済みの必須metadata2項目がない。
  const incomplete: PredictionResult = result;
  // 不完全な数値計算用の型を、完全なResultとして渡せない。
  const complete: PredictionResult = { ...result,
    observations: { ...result.observations, observedDays: 1, recordedDays: 1 } };
  void incomplete;
  void complete;
}
void partialHorizon;
void badTail;
void completedWithDays;
void pendingMetadata;

const publicResult: PredictionResult = predict(input);
const publicCalendarDays: number = publicResult.observations.observedDays;
const publicRecordedDays: number = publicResult.observations.recordedDays;
function classifiedError(error: unknown): readonly (string | number)[] | undefined {
  if (error instanceof PredictionInputError || error instanceof PredictionConfigError) {
    // @ts-expect-error 利用側からpathを書き換えられない。
    error.path.push('changed');
    return error.path;
  }
  return undefined;
}
void publicCalendarDays;
void publicRecordedDays;
void classifiedError;

// D-26未採択の候補は内部importに隔離し、公開Engine契約への昇格を型でも防ぐ。
import * as publicEngine from '../src/index.js';
import { evaluateGoalPriorCandidate } from '../src/goal-prior-candidate.js';
import type { GoalPriorCandidate } from '../src/goal-prior-candidate.js';
const candidatePrior: GoalPriorCandidate = {
  a: { alpha: 3, beta: 7, source: 'synthetic-test', version: 'fixture-v1' },
  b: { alpha: 5, beta: 11, source: 'synthetic-test', version: 'fixture-v1' },
};
const candidateResult = evaluateGoalPriorCandidate(input, candidatePrior);
// @ts-expect-error 候補入口はindex.tsの公開APIに含めない。
void publicEngine.evaluateGoalPriorCandidate;
// @ts-expect-error 候補結果は共通スカラーpriorを説明する既存Resultと別の型。
const prematurePublicResult: PredictionResult = candidateResult;
// @ts-expect-error priorは過去の結果へ加算せず、readonlyの元snapshotとして受け取る。
candidatePrior.a.alpha = 9;
// @ts-expect-error aとbの双方を明示する。部分回答の補完規則はD-26で採択する。
const partialCandidate: GoalPriorCandidate = { a: candidatePrior.a };
void prematurePublicResult;
void partialCandidate;
// @ts-expect-error 候補の初期分布をconfig.priorとsnapshotで二重指定する公開契約にはしない。
evaluateGoalPriorCandidate(input, candidatePrior, { modelVersion: 'behavior-persistence-m1-v1', samples: 200, horizonDays: 1095, seed: 20261012, prior: 2 });

import { evaluateQuestionPriorAdapterCandidate } from '../src/question-prior-adapter-candidate.js';
import type { QuestionPriorAdapterInputCandidate } from '../src/question-prior-adapter-candidate.js';
const adapterInput: QuestionPriorAdapterInputCandidate = { prediction: input, answers: { a: null, b: 'UNKNOWN' },
  mapping: { version: 'candidate-only', values: { LOW: { alpha: 1, beta: 3 }, MID: { alpha: 2, beta: 2 }, HIGH: { alpha: 3, beta: 1 } } } };
const adapterResult = evaluateQuestionPriorAdapterCandidate(adapterInput);
// @ts-expect-error この候補入口を公開indexの確定APIへ追加しない。
void publicEngine.evaluateQuestionPriorAdapterCandidate;
// @ts-expect-error rawの未定義文字列を数値回答へ推測しない。
const wrongRaw: QuestionPriorAdapterInputCandidate['answers'] = { a: 'CERTAIN', b: null };
// @ts-expect-error 片キー省略をPATCHの保持/削除へ推測しない。外側で両キーを解決する。
const partialRaw: QuestionPriorAdapterInputCandidate['answers'] = { a: null };
// @ts-expect-error 数値結果が同じでもsource付き候補Resultは既存公開Resultではない。
const adapterAsPublic: PredictionResult = adapterResult;
void wrongRaw;
void partialRaw;
void adapterAsPublic;
const conditionalSessions: number = adapterResult.conditionalPlan.remainingSessions;
// @ts-expect-error 条件付き計画も候補結果のreadonly値として渡す。
adapterResult.conditionalPlan.lastSessionAmount = 0;
// @ts-expect-error 公開predictの確定DTOへ候補の回数計画を追加しない。
void publicResult.conditionalPlan;
void conditionalSessions;

// 型の所有を移しても既存のpublic/indexとCandidate deep importの構造・readonlyを保つ。
import type { QuestionPriorAnswer, QuestionPriorAnswers, QuestionPriorMapping, QuestionPriorEvidenceSource,
  QuestionPriorEvaluation } from '../src/question-prior.js';
import { QuestionPriorError } from '../src/question-prior.js';
import { QuestionPriorAdapterCandidateError } from '../src/question-prior-adapter-candidate.js';
import type { NumericAnswerCandidate, RawAnswerCandidate, EvidenceSourceCandidate,
  QuestionPriorMappingCandidate } from '../src/question-prior-adapter-candidate.js';
import type { QuestionPriorValidationCause } from '../src/question-prior-types.js';
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type StableAnswer = Assert<Same<QuestionPriorAnswer, RawAnswerCandidate>>;
type StableNumeric = Assert<Same<Exclude<QuestionPriorAnswer, 'UNKNOWN' | null>, NumericAnswerCandidate>>;
type StableSource = Assert<Same<QuestionPriorEvidenceSource, EvidenceSourceCandidate>>;
type StableMapping = Assert<Same<QuestionPriorMapping, QuestionPriorMappingCandidate>>;
type StableInput = Assert<Same<QuestionPriorPredictionInput, QuestionPriorAdapterInputCandidate>>;
type StableAnswers = Assert<Same<QuestionPriorAnswers, QuestionPriorAdapterInputCandidate['answers']>>;
type StableCause = Assert<Same<QuestionPriorValidationCause, QuestionPriorAdapterCandidateError>>;
type StableConstructor = Assert<Same<ConstructorParameters<typeof QuestionPriorError>[0], QuestionPriorAdapterCandidateError>>;
void (null as unknown as StableAnswer);
void (null as unknown as StableNumeric);
void (null as unknown as StableSource);
void (null as unknown as StableMapping);
void (null as unknown as StableInput);
void (null as unknown as StableAnswers);
void (null as unknown as StableCause);
void (null as unknown as StableConstructor);
function readonlyPublicContract(value: QuestionPriorPredictionInput, result: QuestionPriorEvaluation): void {
  // @ts-expect-error inputのa/bは従来どおりreadonly。
  value.answers.a = null;
  // @ts-expect-error 保存mappingのBetaは従来どおりreadonly。
  value.mapping.values.LOW.alpha = 9;
  const legacyInput: QuestionPriorAdapterInputCandidate = value;
  const stableInput: QuestionPriorPredictionInput = legacyInput;
  const evaluation: import('../src/index.js').QuestionPriorEvaluation = result;
  void stableInput;
  void evaluation;
}
void readonlyPublicContract;
