import { Type, type Static } from '@sinclair/typebox';
import { GoalSettingsRevision, GoalUnit, LocalDate } from './goal.ts';
import { AnswerRevision } from './question.ts';

const strict = { additionalProperties: false } as const;
export const EvaluationPolicy = Type.Object({
  enabled: Type.Boolean(), policyVersion: Type.Literal('self-evaluation-v1'),
  retentionDays: Type.Integer({ minimum: 3, maximum: 90 }),
  maxSnapshots: Type.Integer({ minimum: 1, maximum: 90 }),
  observationDays: Type.Integer({ minimum: 1, maximum: 30 }),
}, strict);
export type EvaluationPolicy = Static<typeof EvaluationPolicy>;
export const EvaluationState = Type.Union([Type.Literal('REACHED'), Type.Literal('NOT_REACHED'), Type.Literal('UNKNOWN'),
  Type.Literal('PENDING'), Type.Literal('NULL'), Type.Literal('OUTSIDE_HORIZON'), Type.Literal('INPUT_CORRECTED'), Type.Literal('CONTEXT_CHANGED')]);
export type EvaluationState = Static<typeof EvaluationState>;
const instant = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' });
const days = Type.Union([Type.Integer({ minimum: 0, maximum: 1095 }), Type.Null()]);
export const EvaluationForecast = Type.Object({
  id: Type.String(), issuedAt: instant, expiresAt: instant, anchorDate: LocalDate,
  timezone: Type.String(), unit: GoalUnit, remainingAmount: Type.Integer({ minimum: 1 }),
  goalSettingsRevision: GoalSettingsRevision, answerRevision: AnswerRevision,
  modelVersion: Type.String(), buildVersion: Type.String(),
  predictionStatus: Type.Union([Type.Literal('available'), Type.Literal('insufficient')]),
  predictionReason: Type.Union([Type.String(), Type.Null()]), p50Days: days, p80Days: days,
  p50State: EvaluationState, p80State: EvaluationState,
}, strict);
export type EvaluationForecast = Static<typeof EvaluationForecast>;
const count = Type.Integer({ minimum: 0, maximum: 90 });
export const EvaluationQuantileCounts = Type.Object({
  REACHED: count, NOT_REACHED: count, UNKNOWN: count, PENDING: count, NULL: count,
  OUTSIDE_HORIZON: count, INPUT_CORRECTED: count, CONTEXT_CHANGED: count,
  lowerCoverage: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
  upperCoverage: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
}, strict);
export type EvaluationQuantileCounts = Static<typeof EvaluationQuantileCounts>;
export const EvaluationReport = Type.Object({
  policy: EvaluationPolicy, participating: Type.Boolean(), goalSettingsRevision: GoalSettingsRevision,
  forecasts: Type.Array(EvaluationForecast, { maxItems: 90 }),
  summary: Type.Object({ issued: count, participantCount: Type.Union([Type.Literal(0), Type.Literal(1)]),
    p50: EvaluationQuantileCounts, p80: EvaluationQuantileCounts }, strict),
}, strict);
export type EvaluationReport = Static<typeof EvaluationReport>;
export const EvaluationParticipation = Type.Object({ policyVersion: Type.Literal('self-evaluation-v1') }, strict);
export type EvaluationParticipation = Static<typeof EvaluationParticipation>;
export const EvaluationCapture = Type.Object({ expectedGoalSettingsRevision: GoalSettingsRevision,
  displayedForecast: Type.Optional(Type.Literal('BASELINE')) }, strict);
export type EvaluationCapture = Static<typeof EvaluationCapture>;
