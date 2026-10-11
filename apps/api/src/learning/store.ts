import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { LearningActivate, LearningFit, LearningPolicy, LearningReport, LearningRollback, LearningWithdraw } from '../contracts/learning.ts';
import type { Log } from '../contracts/log.ts';
import { prefixFingerprint } from '../evaluation/assessment.ts';
import { isGoalId } from '../goals/goal-id.ts';
import { localDateIn } from '../goals/local-date.ts';
import type { TodaySnapshot } from '../prediction/store.ts';
import { answerRevision } from '../questions/snapshot.ts';
import { compareLearningModel, computeLearningExperiment, computeLearningFit, learningArtifactEligibility, planLearningFit, selectLearningToday } from './service.ts';
import type { LearningReadState, StoredLearningArtifact } from './types.ts';

export class LearningConflict extends Error {
  readonly code: string;
  constructor(code: string) { super('Learning state changed; review and explicitly retry.'); this.code = code; }
}
type Participation = { id: string; goal_id: string; joined_at: Date; expires_at: Date; fit_generation: string; active_revision: string };
type GoalRow = { total_required: number; initial_progress: number; session_amount: number; timezone: string;
  record_start_date: string; unit: 'minutes' | 'sessions'; goal_settings_revision: number; unit_history_locked: boolean } & TodaySnapshot['question'];
type State = LearningReadState & { participantGoalId: string | null };
type ArtifactPayload = Omit<StoredLearningArtifact, 'id' | 'hash' | 'createdAt' | 'expiresAt'>;
type ArtifactRow = { id: string; artifact_hash: string; created_at: Date; expires_at: Date; payload: ArtifactPayload };
const ageBoundary = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);
const expiry = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000);
const revision = (raw: string) => {
  if (!/^(0|[1-9]\d*)$/.test(raw) || BigInt(raw) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid learning revision');
  return Number(raw);
};

export async function readLearningStateInTransaction(client: PoolClient, userId: string, goalId: string, now: () => Date, policy: LearningPolicy, lock: boolean): Promise<State | null> {
  const goal = (await client.query<GoalRow>(`select total_required,initial_progress,session_amount,timezone,
    record_start_date::text as record_start_date,unit,goal_settings_revision,unit_history_locked,
    question_prior,answer_revision::text as answer_revision,question_prior_snapshot from goal
    where id=$1 and user_id=$2${lock ? ' for update' : ''}`, [goalId, userId])).rows[0];
  if (!goal) return null;
  // First SELECT establishes the repeatable-read snapshot; the clock follows it.
  const instant = now();
  const logs = (await client.query<{ local_date: string; status: Log['status']; amount: number | null }>(
    'select local_date::text as local_date,status,amount from action_log where goal_id=$1 order by local_date', [goalId])).rows;
  const participant = (await client.query<Participation>(`select id,goal_id,joined_at,expires_at,
    fit_generation::text as fit_generation,active_revision::text as active_revision from learning_participation
    where user_id=$1 and expires_at>$2 and joined_at>$3`, [userId, instant, ageBoundary(instant, policy.retentionDays)])).rows[0];
  const own = participant?.goal_id === goalId;
  const receipt = (await client.query<{ through_date: string }>('select through_date::text as through_date from learning_holdout_receipt where goal_id=$1 and user_id=$2',
    [goalId, userId])).rows[0];
  const active = own ? (await client.query<{ artifact_id: string }>(
    'select artifact_id from learning_activation where participation_id=$1 and user_id=$2 and goal_id=$3', [participant.id, userId, goalId])).rows[0] : undefined;
  const rows = own ? (await client.query<ArtifactRow>(`select id,artifact_hash,created_at,expires_at,payload from learning_artifact
    where participation_id=$1 and user_id=$2 and goal_id=$3 and expires_at>$4 and created_at>$5
    order by (id=$7::uuid) desc nulls last,fit_generation desc,id limit $6`,
    [participant.id, userId, goalId, instant, ageBoundary(instant, policy.retentionDays), policy.maxArtifacts, active?.artifact_id ?? null])).rows : [];
  return { snapshot: { now: instant, goal: { totalRequired: goal.total_required, initialProgress: goal.initial_progress,
    sessionAmount: goal.session_amount, timezone: goal.timezone, recordStartDate: goal.record_start_date, unit: goal.unit,
    goalSettingsRevision: goal.goal_settings_revision, unitLocked: goal.unit_history_locked || goal.initial_progress > 0 },
    question: { question_prior: goal.question_prior, answer_revision: goal.answer_revision, question_prior_snapshot: goal.question_prior_snapshot },
    logs: logs.map(log => ({ localDate: log.local_date, status: log.status, amount: log.amount })) },
    participantGoalId: participant?.goal_id ?? null, participationId: own ? participant.id : null,
    participationExpiresAt: own ? participant.expires_at : null, participationJoinedAt: own ? participant.joined_at : null,
    fitGeneration: own ? revision(participant.fit_generation) : 0,
    activeRevision: own ? revision(participant.active_revision) : 0, activeArtifactId: active?.artifact_id ?? null,
    holdoutThrough: receipt?.through_date ?? null,
    artifacts: rows.map(row => ({ ...row.payload, id: row.id, hash: row.artifact_hash, createdAt: row.created_at, expiresAt: row.expires_at })) };
}
async function transaction<T>(pool: Pool, userId: string, goalId: string, now: () => Date, policy: LearningPolicy,
  write: boolean, work: (client: PoolClient, state: State) => Promise<T>): Promise<T | null> {
  if (!isGoalId(goalId)) return null;
  const client = await pool.connect();
  try {
    await client.query(write ? 'begin' : 'begin isolation level repeatable read read only');
    // All owner mutations follow the established user -> Goal lock order.
    if (write) await client.query('select id from "user" where id=$1 for update', [userId]);
    const state = await readLearningStateInTransaction(client, userId, goalId, now, policy, write);
    const result = state ? await work(client, state) : null;
    await client.query('commit');
    return result;
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}
export async function loadLearningState(pool: Pool, userId: string, goalId: string, now: () => Date, policy: LearningPolicy): Promise<LearningReadState | null> {
  if (!policy.enabled) throw new Error('Learning state cannot be read while disabled');
  return transaction(pool, userId, goalId, now, policy, false, async (_client, state) => state);
}
function reportFrom(state: LearningReadState, policy: LearningPolicy): LearningReport {
  return { policy, goalSettingsRevision: state.snapshot.goal.goalSettingsRevision, answerRevision: answerRevision(state.snapshot.question.answer_revision),
    participation: state.participationId ? { id: state.participationId, expiresAt: state.participationExpiresAt!.toISOString(), fitGeneration: state.fitGeneration } : null,
    activeRevision: state.activeRevision, activeArtifactId: state.activeArtifactId,
    artifacts: state.artifacts.map(artifact => { const reason = learningArtifactEligibility(artifact, state, policy);
      return { id: artifact.id, hash: artifact.hash, modelVersion: artifact.modelVersion, purpose: artifact.purpose ?? 'QUALIFICATION', createdAt: artifact.createdAt.toISOString(),
        expiresAt: artifact.expiresAt.toISOString(), trainingCutoff: artifact.trainingCutoff,
        goalSettingsRevision: artifact.goalSettingsRevision, answerRevision: artifact.answerRevision,
        eligible: reason === null, eligibilityReason: reason, gate: artifact.gate }; }) };
}
export async function learningReport(pool: Pool, userId: string, goalId: string, now: () => Date, policy: LearningPolicy) {
  const state = await loadLearningState(pool, userId, goalId, now, policy);
  return state ? reportFrom(state, policy) : null;
}
function participationReady(state: State, expectedId: string) {
  if (!state.participationId) throw new LearningConflict('LEARNING_NOT_PARTICIPATING');
  if (state.participationId !== expectedId) throw new LearningConflict('LEARNING_PARTICIPATION_CHANGED');
}
function activationReady(state: State, expectedId: string, expectedRevision: number) {
  participationReady(state, expectedId);
  if (state.activeRevision !== expectedRevision) throw new LearningConflict('LEARNING_ACTIVE_CONFLICT');
}
async function removeDerived(client: PoolClient, userId: string, goalId: string) {
  // Learned forecast rows are derived data; ordinary logs and baseline forecasts remain.
  await client.query(`delete from evaluation_forecast where goal_id=$1 and payload->>'learningArtifactId' is not null
    and exists(select 1 from goal where id=$1 and user_id=$2)`, [goalId, userId]);
}
export async function joinLearning(pool: Pool, userId: string, goalId: string, now: () => Date, policy: LearningPolicy) {
  return transaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    if (state.participantGoalId && state.participantGoalId !== goalId) throw new LearningConflict('LEARNING_OTHER_GOAL');
    if (!state.participationId) {
      // Delete expired participation and its derived rows without reviving a prior UUID.
      const old = (await client.query<{ goal_id: string }>('select goal_id from learning_participation where user_id=$1', [userId])).rows[0];
      if (old) await removeDerived(client, userId, old.goal_id);
      await client.query('delete from learning_participation where user_id=$1', [userId]);
      await client.query('insert into learning_participation(user_id,goal_id,policy_version,joined_at,expires_at) values($1,$2,$3,$4,$5)',
        [userId, goalId, policy.policyVersion, state.snapshot.now, expiry(state.snapshot.now, policy.retentionDays)]);
    }
    return true;
  });
}
export async function withdrawLearning(pool: Pool, userId: string, goalId: string, request: LearningWithdraw, now: () => Date, policy: LearningPolicy) {
  return transaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    participationReady(state, request.expectedParticipationId);
    await removeDerived(client, userId, goalId);
    await client.query('delete from learning_participation where id=$1 and user_id=$2 and goal_id=$3', [state.participationId, userId, goalId]);
    return true;
  });
}
export async function fitLearning(pool: Pool, userId: string, goalId: string, request: LearningFit, now: () => Date, policy: LearningPolicy) {
  return fitArtifact(pool, userId, goalId, request, now, policy, false);
}
export async function fitLearningExperiment(pool: Pool, userId: string, goalId: string, request: LearningFit, now: () => Date, policy: LearningPolicy) {
  return fitArtifact(pool, userId, goalId, request, now, policy, true);
}
async function fitArtifact(pool: Pool, userId: string, goalId: string, request: LearningFit, now: () => Date, policy: LearningPolicy, experimental: boolean) {
  const reservation = await transaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    activationReady(state, request.expectedParticipationId, request.expectedActiveRevision);
    if (state.snapshot.goal.goalSettingsRevision !== request.expectedGoalSettingsRevision) throw new LearningConflict('GOAL_SETTINGS_CONFLICT');
    if (answerRevision(state.snapshot.question.answer_revision) !== request.expectedAnswerRevision) throw new LearningConflict('ANSWER_REVISION_CONFLICT');
    if (state.fitGeneration === Number.MAX_SAFE_INTEGER) throw new LearningConflict('LEARNING_GENERATION_LIMIT');
    if (policy.maxArtifacts === 1 && state.activeArtifactId) throw new LearningConflict('LEARNING_ARTIFACT_LIMIT');
    const anchor = localDateIn(state.snapshot.now, state.snapshot.goal.timezone);
    const plan = experimental ? null : planLearningFit(state.snapshot, policy, state.holdoutThrough);
    if (plan?.holdoutThrough != null && (plan.holdoutThrough > anchor ||
      (state.holdoutThrough !== null && plan.holdoutThrough <= state.holdoutThrough))) throw new LearningConflict('LEARNING_HOLDOUT_CONFLICT');
    // Consume unseen labels before computation. Rejected/numerically failed fits cannot reuse them.
    await client.query('update learning_participation set fit_generation=fit_generation+1 where id=$1', [state.participationId]);
    if (plan?.holdoutThrough != null) await client.query(`insert into learning_holdout_receipt(goal_id,user_id,through_date) values($1,$2,$3)
      on conflict(goal_id) do update set through_date=greatest(learning_holdout_receipt.through_date,excluded.through_date)`, [goalId, userId, plan.holdoutThrough]);
    return { state, plan, generation: state.fitGeneration + 1, anchor, prefix: prefixFingerprint(state.snapshot.logs, anchor) };
  });
  if (!reservation) return null;
  // No connection/owner lock is held while fitting or scoring synthetic/consented records.
  const computed = experimental ? computeLearningExperiment(reservation.state.snapshot, policy) :
    computeLearningFit(reservation.state.snapshot, policy, reservation.plan!);
  const payload: ArtifactPayload = { ...computed, purpose: experimental ? 'EXPERIMENTAL' : 'QUALIFICATION',
    goalSettingsRevision: request.expectedGoalSettingsRevision, answerRevision: request.expectedAnswerRevision };
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded) > 1_900_000) throw new LearningConflict('LEARNING_ARTIFACT_LIMIT');
  const hash = createHash('sha256').update(encoded).digest('hex');
  return transaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    activationReady(state, request.expectedParticipationId, request.expectedActiveRevision);
    if (state.fitGeneration !== reservation.generation) throw new LearningConflict('LEARNING_FIT_SUPERSEDED');
    if (state.snapshot.goal.goalSettingsRevision !== request.expectedGoalSettingsRevision ||
      answerRevision(state.snapshot.question.answer_revision) !== request.expectedAnswerRevision ||
      localDateIn(state.snapshot.now, state.snapshot.goal.timezone) !== reservation.anchor ||
      prefixFingerprint(state.snapshot.logs, reservation.anchor) !== reservation.prefix ||
      prefixFingerprint(state.snapshot.logs, computed.trainingCutoff) !== computed.inputHash) throw new LearningConflict('LEARNING_INPUT_CHANGED');
    const id = randomUUID();
    await client.query(`insert into learning_artifact(id,participation_id,user_id,goal_id,created_at,expires_at,artifact_hash,payload,fit_generation)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, state.participationId, userId, goalId, state.snapshot.now,
      new Date(Math.min(state.participationExpiresAt!.getTime(), expiry(state.participationJoinedAt!, policy.retentionDays).getTime())), hash, payload, reservation.generation]);
    // Keep at most maxArtifacts including the active artifact. Never evict the active pointer.
    await client.query(`delete from learning_artifact where participation_id=$1 and id<>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      and id not in (select id from learning_artifact where participation_id=$1
      and id<>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid) order by fit_generation desc,id desc limit $3)`,
      [state.participationId, state.activeArtifactId, policy.maxArtifacts - (state.activeArtifactId ? 1 : 0)]);
    // Serialization of this successful write uses the final CAS instant, not a later clock sample.
    const updated = await readLearningStateInTransaction(client, userId, goalId, () => state.snapshot.now, policy, false);
    return reportFrom(updated!, policy).artifacts.find(artifact => artifact.id === id)!;
  });
}
export async function activateLearning(pool: Pool, userId: string, goalId: string, request: LearningActivate, now: () => Date, policy: LearningPolicy) {
  return transaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    activationReady(state, request.expectedParticipationId, request.expectedActiveRevision);
    const artifact = state.artifacts.find(item => item.id === request.artifactId && item.hash === request.artifactHash);
    if (!artifact) throw new LearningConflict('LEARNING_ARTIFACT_CHANGED');
    const reason = learningArtifactEligibility(artifact, state, policy);
    if (artifact.numeric === null || artifact.gate.status !== 'ADOPTABLE' || reason !== null) throw new LearningConflict(reason ?? 'LEARNING_NOT_ADOPTABLE');
    if (state.activeRevision === Number.MAX_SAFE_INTEGER) throw new LearningConflict('LEARNING_REVISION_LIMIT');
    await client.query(`insert into learning_activation(participation_id,user_id,goal_id,artifact_id) values($1,$2,$3,$4)
      on conflict(participation_id) do update set artifact_id=excluded.artifact_id`, [state.participationId, userId, goalId, artifact.id]);
    await client.query('update learning_participation set active_revision=active_revision+1 where id=$1', [state.participationId]);
    return true;
  });
}
export async function rollbackLearning(pool: Pool, userId: string, goalId: string, request: LearningRollback, now: () => Date, policy: LearningPolicy) {
  return transaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    activationReady(state, request.expectedParticipationId, request.expectedActiveRevision);
    if (state.activeRevision === Number.MAX_SAFE_INTEGER) throw new LearningConflict('LEARNING_REVISION_LIMIT');
    await client.query('delete from learning_activation where participation_id=$1', [state.participationId]);
    await client.query('update learning_participation set active_revision=active_revision+1 where id=$1', [state.participationId]);
    return true;
  });
}
export async function learningToday(pool: Pool, userId: string, goalId: string, now: () => Date, policy: LearningPolicy, amount?: number) {
  const state = await loadLearningState(pool, userId, goalId, now, policy);
  return state ? selectLearningToday(state, policy, amount) : null;
}
export async function learningCompare(pool: Pool, userId: string, goalId: string, artifactId: string, artifactHash: string,
  now: () => Date, policy: LearningPolicy, amount?: number) {
  const state = await transaction(pool, userId, goalId, now, policy, false, async (client, state) => {
    // Explicit owner-only lookup includes expired models so usability can explain
    // expiry without forecasting them; it does not broaden the bounded report.
    const row = (await client.query<ArtifactRow>(`select id,artifact_hash,created_at,expires_at,payload from learning_artifact
      where id=$1 and user_id=$2 and goal_id=$3`, [artifactId, userId, goalId])).rows[0];
    if (!row) return null;
    if (row.artifact_hash !== artifactHash) throw new LearningConflict('LEARNING_ARTIFACT_CHANGED');
    return { ...state, artifacts: [{ ...row.payload, id: row.id, hash: row.artifact_hash,
      createdAt: row.created_at, expiresAt: row.expires_at }] };
  });
  // Forecasting runs after the shared RR snapshot connection has been released.
  return state ? compareLearningModel(state, policy, artifactId, artifactHash, amount) : null;
}
export async function purgeExpiredLearning(pool: Pool, now: Date, retentionDays = 90) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 3 || retentionDays > 90) throw new Error('Invalid learning retention');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const args = [now, ageBoundary(now, retentionDays)];
    // Serialize removal with reserve/activation/withdraw in the same user -> Goal order.
    await client.query(`select id from "user" where id in (select user_id from learning_participation where expires_at<=$1 or joined_at<=$2
      union select user_id from learning_artifact where expires_at<=$1 or created_at<=$2
      union select g.user_id from goal g join evaluation_forecast e on e.goal_id=g.id where e.payload->>'learningArtifactId' is not null and
        case when e.payload->>'learningRetentionAnchor' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
        then (e.payload->>'learningRetentionAnchor')::timestamptz <= $2 else true end) order by id for update`, args);
    await client.query(`select id from goal where id in (select goal_id from learning_participation where expires_at<=$1 or joined_at<=$2
      union select goal_id from learning_artifact where expires_at<=$1 or created_at<=$2
      union select goal_id from evaluation_forecast where payload->>'learningArtifactId' is not null and
        case when payload->>'learningRetentionAnchor' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
        then (payload->>'learningRetentionAnchor')::timestamptz <= $2 else true end) order by id for update`, args);
    const forecasts = await client.query(`delete from evaluation_forecast where payload->>'learningArtifactId' is not null and
      (case when payload->>'learningRetentionAnchor' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
        then (payload->>'learningRetentionAnchor')::timestamptz <= $2 else true end or
      goal_id in (select goal_id from learning_participation where expires_at<=$1 or joined_at<=$2) or payload->>'learningArtifactId' in
      (select id::text from learning_artifact where expires_at<=$1 or created_at<=$2 or participation_id in
      (select id from learning_participation where expires_at<=$1 or joined_at<=$2)))`, args);
    const artifacts = await client.query('delete from learning_artifact where expires_at<=$1 or created_at<=$2', args);
    const participations = await client.query('delete from learning_participation where expires_at<=$1 or joined_at<=$2', args);
    await client.query('commit');
    return { forecasts: forecasts.rowCount ?? 0, artifacts: artifacts.rowCount ?? 0, participations: participations.rowCount ?? 0 };
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}
