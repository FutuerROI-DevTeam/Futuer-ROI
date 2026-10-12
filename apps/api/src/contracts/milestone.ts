import { Type, type Static } from '@sinclair/typebox';
import { GoalSettingsRevision, GoalUnit, LocalDate } from './goal.ts';
import { AnswerRevision } from './question.ts';
const strict = { additionalProperties: false } as const;
const uuid = Type.String({ format: 'uuid' });
const hash = Type.String({ pattern: '^[0-9a-f]{64}$' });
const instant = Type.String();
const nullableNumber = Type.Union([Type.Number(), Type.Null()]);
const nullableString = Type.Union([Type.String(), Type.Null()]);
const cdf = Type.Array(Type.Number({ minimum: 0, maximum: 1 }), { minItems: 30, maxItems: 30 });
export const MilestonePolicy = Type.Object({ enabled: Type.Boolean(), policyVersion: Type.Literal('session-milestone-opt-in-v1'),
  retentionDays: Type.Literal(90), observationDays: Type.Literal(30), correctionDays: Type.Literal(2), requiredEpisodes: Type.Literal(3),
  standardAutoApply: Type.Literal(false), evidenceScope: Type.Literal('milestone') }, strict);
export const MilestoneFit = Type.Object({ status: Type.Union([Type.Literal('FIT'), Type.Literal('IDENTITY'), Type.Literal('FAILED')]),
  reason: nullableString, u: Type.Number({ minimum: -Math.log(1.25), maximum: Math.log(1.25) }),
  episodes: Type.Integer({ minimum: 0, maximum: 3 }), duplicates: Type.Integer({ minimum: 0 }), objective: nullableNumber,
  gradient: nullableNumber, iterations: Type.Integer({ minimum: 0, maximum: 100 }), kktResidual: nullableNumber }, strict);
export const MilestoneArtifact = Type.Object({ id: uuid, hash, valid: Type.Boolean(), expiresAt: instant, fit: MilestoneFit }, strict);
export const MilestoneComparison = Type.Object({ artifactId: Type.Union([uuid, Type.Null()]), artifactHash: Type.Union([hash, Type.Null()]),
  u: Type.Number(), milestoneCdf: cdf, finalCdf: cdf, status: Type.Union([Type.Literal('FIT'), Type.Literal('IDENTITY'), Type.Literal('FAILED')]),
  reason: nullableString, appliedToStandard: Type.Literal(false), finalExtrapolation: Type.Literal(true), evidenceScope: Type.Literal('milestone') }, strict);
const observation = Type.Union([Type.Object({ kind: Type.Union([Type.Literal('EVENT'), Type.Literal('INTERVAL'), Type.Literal('CENSOR')]),
  lower: Type.Integer({ minimum: 0, maximum: 30 }), upper: Type.Integer({ minimum: 1, maximum: 30 }) }, strict), Type.Null()]);
const state = Type.Union([Type.Literal('EVENT'), Type.Literal('INTERVAL'), Type.Literal('CENSOR'),
  Type.Literal('PENDING'), Type.Literal('UNKNOWN'), Type.Literal('INVALID'), Type.Literal('EXPIRED')]);
const score = Type.Object({ baseline: nullableNumber, candidate: nullableNumber }, strict);
const quantiles = Type.Object({ p50Days: nullableNumber, p80Days: nullableNumber }, strict);
export const MilestoneForecast = Type.Object({ id: uuid, issuedAt: instant, expiresAt: instant, origin: LocalDate,
  q: Type.Integer({ minimum: 1 }), threshold: Type.Integer({ minimum: 1 }), unit: GoalUnit,
  state, reason: nullableString, observation, closed: Type.Boolean(), comparison: MilestoneComparison,
  baselineMilestoneCdf: cdf, baselineFinalCdf: cdf, milestoneScore: score,
  finalScore: Type.Object({ baseline: nullableNumber, candidate: nullableNumber, state, extrapolation: Type.Literal(true) }, strict),
  baselineEngineQuantiles: quantiles, candidateMilestoneQuantiles: quantiles }, strict);
export const MilestoneReport = Type.Object({ participating: Type.Boolean(), participationId: Type.Union([uuid, Type.Null()]),
  participationExpiresAt: Type.Union([instant, Type.Null()]), goalSettingsRevision: GoalSettingsRevision, answerRevision: AnswerRevision,
  consentRevision: GoalSettingsRevision, fitGeneration: Type.Integer({ minimum: 0 }), forecasts: Type.Array(MilestoneForecast, { maxItems: 90 }),
  artifact: Type.Union([MilestoneArtifact, Type.Null()]) }, strict);
export type MilestoneReport = Static<typeof MilestoneReport>;
export type MilestoneForecast = Static<typeof MilestoneForecast>;
export const MilestoneJoin = Type.Object({ policyVersion: Type.Literal('session-milestone-opt-in-v1'), expectedGoalSettingsRevision: GoalSettingsRevision, expectedConsentRevision: GoalSettingsRevision }, strict);
export const MilestoneWithdraw = Type.Object({ expectedParticipationId: uuid }, strict);
const expected = { expectedGoalSettingsRevision: GoalSettingsRevision, expectedAnswerRevision: AnswerRevision, expectedParticipationId: uuid };
export const MilestoneCapture = Type.Object({ ...expected, artifactId: Type.Optional(uuid), artifactHash: Type.Optional(hash) }, strict);
export const MilestoneFitRequest = Type.Object({ ...expected, expectedFitGeneration: Type.Integer({ minimum: 0, maximum: 2147483647 }) }, strict);
export const MilestonePreviewQuery = Type.Object({ artifactId: uuid, artifactHash: hash }, strict);
export const MilestonePreview = Type.Object({ origin: LocalDate, comparison: MilestoneComparison,
  baselineMilestoneCdf: cdf, baselineFinalCdf: cdf, baselineEngineQuantiles: quantiles }, strict);
