import { Type, type Static } from '@sinclair/typebox';
import { GoalSettingsRevision, LocalDate } from './goal.ts';
import { AnswerRevision } from './question.ts';
import { TodayR11 } from './r11.ts';
const strict = { additionalProperties: false } as const;
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const nullableString = Type.Union([Type.String(), Type.Null()]);
const days = Type.Union([Type.Integer({ minimum: 0, maximum: 1095 }), Type.Null()]);
export const LearningArtifactPurpose = Type.Union([Type.Literal('QUALIFICATION'), Type.Literal('EXPERIMENTAL')]);
export type LearningArtifactPurpose = Static<typeof LearningArtifactPurpose>;
export const LearningPolicy = Type.Object({ enabled: Type.Boolean(), policyVersion: Type.Literal('self-learning-v1'),
  retentionDays: Type.Integer({ minimum: 3, maximum: 90 }), maxArtifacts: Type.Integer({ minimum: 1, maximum: 5 }),
  observationDays: Type.Integer({ minimum: 1, maximum: 30 }), capDays: Type.Integer({ minimum: 2, maximum: 30 }) }, strict);
export type LearningPolicy = Static<typeof LearningPolicy>;
export const LearningGate = Type.Object({ status: Type.Union([Type.Literal('ADOPTABLE'), Type.Literal('REJECTED'), Type.Literal('INSUFFICIENT')]),
  reasons: Type.Array(Type.String(), { maxItems: 16 }), trainTransitions: revision, validationOrigins: revision, testOrigins: revision,
  appliedOrigins: revision, fallbackOrigins: revision, excludedOrigins: revision,
  validationEffectiveBlocks: revision, testEffectiveBlocks: revision,
  baselineRps: nullableNumber, candidateRps: nullableNumber, baselineP80Overconfidence: nullableNumber,
  candidateP80Overconfidence: nullableNumber, baselineFiniteRate: nullableNumber, candidateFiniteRate: nullableNumber }, strict);
export type LearningGate = Static<typeof LearningGate>;
export const LearningArtifactSummary = Type.Object({ id: Type.String(), hash: Type.String(), modelVersion: Type.String(),
  purpose: Type.Optional(LearningArtifactPurpose),
  createdAt: Type.String(), expiresAt: Type.String(), trainingCutoff: LocalDate,
  goalSettingsRevision: GoalSettingsRevision, answerRevision: AnswerRevision, eligible: Type.Boolean(),
  eligibilityReason: nullableString, gate: LearningGate }, strict);
export type LearningArtifactSummary = Static<typeof LearningArtifactSummary>;
export const LearningReport = Type.Object({ policy: LearningPolicy, goalSettingsRevision: GoalSettingsRevision, answerRevision: AnswerRevision,
  participation: Type.Union([Type.Object({ id: Type.String(), expiresAt: Type.String(), fitGeneration: revision }, strict), Type.Null()]),
  activeRevision: revision, activeArtifactId: nullableString,
  artifacts: Type.Array(LearningArtifactSummary, { maxItems: 5 }) }, strict);
export type LearningReport = Static<typeof LearningReport>;
export const LearningParticipation = Type.Object({ policyVersion: Type.Literal('self-learning-v1') }, strict);
export type LearningParticipation = Static<typeof LearningParticipation>;
export const LearningFit = Type.Object({ expectedGoalSettingsRevision: GoalSettingsRevision, expectedAnswerRevision: AnswerRevision,
  expectedParticipationId: Type.String(), expectedActiveRevision: revision }, strict);
export type LearningFit = Static<typeof LearningFit>;
export const LearningActivate = Type.Object({ artifactId: Type.String(), artifactHash: Type.String(), expectedParticipationId: Type.String(),
  expectedActiveRevision: revision }, strict);
export type LearningActivate = Static<typeof LearningActivate>;
export const LearningRollback = Type.Object({ expectedParticipationId: Type.String(), expectedActiveRevision: revision }, strict);
export type LearningRollback = Static<typeof LearningRollback>;
export const LearningWithdraw = Type.Object({ expectedParticipationId: Type.String() }, strict);
export type LearningWithdraw = Static<typeof LearningWithdraw>;
export const LearningTodayQuery = Type.Object({ amount: Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,9})$' })) }, strict);
export const LearningCompareQuery = Type.Object({
  artifactId: Type.String({ format: 'uuid', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }),
  artifactHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  amount: Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,9})$' })),
}, strict);
export type LearningCompareQuery = Static<typeof LearningCompareQuery>;
export const LearningSelectedForecast = Type.Object({ source: Type.Union([Type.Literal('BASELINE'), Type.Literal('LEARNED')]),
  artifactId: nullableString, artifactHash: nullableString, activeRevision: revision,
  status: Type.Union([Type.Literal('available'), Type.Literal('insufficient'), Type.Literal('completed')]),
  reason: nullableString, p50Days: days, p80Days: days, horizonDays: Type.Integer({ minimum: 1, maximum: 1095 }),
  reachProbability: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  todayAmount: Type.Union([Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]), hypothetical: Type.Boolean() }, strict);
export type LearningSelectedForecast = Static<typeof LearningSelectedForecast>;
export const TodayLearning = Type.Object({ schemaVersion: Type.Literal('learning-today-v1'), baseline: TodayR11,
  selectedForecast: LearningSelectedForecast }, strict);
export type TodayLearning = Static<typeof TodayLearning>;

const comparisonForecastFields = {
  status: Type.Union([Type.Literal('available'), Type.Literal('insufficient'), Type.Literal('completed')]),
  reason: nullableString, p50Days: days, p80Days: days, horizonDays: Type.Integer({ minimum: 1, maximum: 30 }),
  reachProbability: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  todayAmount: Type.Union([Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]), hypothetical: Type.Boolean(),
};
export const LearningReferenceForecast = Type.Object({ source: Type.Literal('BASELINE'), ...comparisonForecastFields }, strict);
export type LearningReferenceForecast = Static<typeof LearningReferenceForecast>;
export const LearningExperimentalForecast = Type.Object({ source: Type.Literal('EXPERIMENTAL'),
  artifactId: Type.String(), artifactHash: Type.String(), ...comparisonForecastFields }, strict);
export type LearningExperimentalForecast = Static<typeof LearningExperimentalForecast>;
export const LearningComparison = Type.Object({ schemaVersion: Type.Literal('learning-comparison-v1'),
  baseline: TodayR11, reference: LearningReferenceForecast, experiment: LearningExperimentalForecast,
  goalSettingsRevision: GoalSettingsRevision, answerRevision: AnswerRevision, activeRevision: revision,
}, strict);
export type LearningComparison = Static<typeof LearningComparison>;
