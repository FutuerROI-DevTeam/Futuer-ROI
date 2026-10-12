import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Log } from '../contracts/log.ts';
import type { TodaySnapshot } from '../prediction/store.ts';
import { isGoalId } from '../goals/goal-id.ts';
import { localDateIn } from '../goals/local-date.ts';
import { MILESTONE_POLICY_VERSION } from './policy.ts';
import { assessEpisode, contextKey, episodeView, fingerprint, makeEpisode, type EpisodeRow } from './assessment.ts';
import { fitMilestoneOffset, identityFit, sameScope, type OffsetFit, type Scope } from './core.ts';

export class MilestoneConflict extends Error {
  readonly code: string;
  constructor(code: string) { super('Milestone state changed; review and explicitly retry.'); this.code = code; }
}
type Participation = { id: string; goal_id: string; joined_at: Date; expires_at: Date; fit_generation: number };
type Receipt = { id: string; forecastHash: string; expiresAt: string; observedThrough: string; labelHash: string };
type Artifact = { schemaVersion: 'session-milestone-artifact-v1'; scope: Scope; generation: number; cutoff: string;
  protocol: 'session-milestone-survival-v1'; fit: OffsetFit; receipts: Receipt[] };
type ArtifactRow = { id: string; payload_hash: string; created_at: Date; expires_at: Date; payload: Artifact };
type StoredEpisode = EpisodeRow & { payload_hash: string };
type State = { snapshot: TodaySnapshot; consentRevision: number; participation: Participation | undefined; rows: StoredEpisode[]; artifact: ArtifactRow | undefined; scope: Scope };
type GoalRow = { total_required: number; initial_progress: number; session_amount: number; timezone: string;
  record_start_date: string; unit: 'minutes' | 'sessions'; goal_settings_revision: number; unit_history_locked: boolean; milestone_consent_revision: number } & TodaySnapshot['question'];
const plus90 = (at: Date) => new Date(at.getTime() + 90 * 86_400_000);
const cutoff90 = (at: Date) => new Date(at.getTime() - 90 * 86_400_000);

async function state(client: PoolClient, userId: string, goalId: string, clock: () => Date, build: string, write: boolean): Promise<State | null> {
  const goal = (await client.query<GoalRow>(`select total_required,initial_progress,session_amount,timezone,
    record_start_date::text as record_start_date,unit,goal_settings_revision,unit_history_locked,milestone_consent_revision,
    question_prior,answer_revision::text as answer_revision,question_prior_snapshot
    from goal where id=$1 and user_id=$2${write ? ' for update' : ''}`, [goalId, userId])).rows[0];
  if (!goal) return null;
  const now = clock();
  const logs = (await client.query<{ local_date: string; status: Log['status']; amount: number | null }>(
    'select local_date::text as local_date,status,amount from action_log where goal_id=$1 order by local_date', [goalId])).rows;
  const participation = (await client.query<Participation>(
    'select id,goal_id,joined_at,expires_at,fit_generation from milestone_participation where user_id=$1 and expires_at>$2 and joined_at>$3',
    [userId, now, cutoff90(now)])).rows[0];
  const active = participation?.goal_id === goalId;
  const rows = active ? (await client.query<StoredEpisode>(`select id,issued_at,expires_at,payload,payload_hash from milestone_forecast
    where goal_id=$1 and user_id=$2 and participation_id=$3 and expires_at>$4 and issued_at<=$4 and issued_at>$5 order by origin_date desc,id desc limit 90`,
    [goalId, userId, participation.id, now, cutoff90(now)])).rows : [];
  for (const row of rows) {
    if (fingerprint(row.payload) !== row.payload_hash || row.payload.schemaVersion !== 'session-milestone-forecast-v1' ||
      row.payload.scope.ownerId !== userId || row.payload.scope.goalId !== goalId || row.payload.scope.participationId !== participation!.id) throw new MilestoneConflict('CORRUPTED_SOURCE');
  }
  const artifact = active ? (await client.query<ArtifactRow>(`select id,payload_hash,created_at,expires_at,payload from milestone_artifact
    where goal_id=$1 and user_id=$2 and participation_id=$3 order by generation desc limit 1`, [goalId, userId, participation.id])).rows[0] : undefined;
  const snapshot: TodaySnapshot = { now, goal: { totalRequired: goal.total_required, initialProgress: goal.initial_progress,
    sessionAmount: goal.session_amount, timezone: goal.timezone, recordStartDate: goal.record_start_date, unit: goal.unit,
    goalSettingsRevision: goal.goal_settings_revision, unitLocked: goal.unit_history_locked || goal.initial_progress > 0 },
    question: { question_prior: goal.question_prior, answer_revision: goal.answer_revision, question_prior_snapshot: goal.question_prior_snapshot },
    logs: logs.map(log => ({ localDate: log.local_date, status: log.status, amount: log.amount })) };
  return { snapshot, consentRevision: goal.milestone_consent_revision, participation, rows, artifact,
    scope: { ownerId: userId, goalId, participationId: active ? participation.id : '', contextKey: contextKey(snapshot, build) } };
}
async function owned<T>(pool: Pool, userId: string, goalId: string, clock: () => Date, build: string,
  write: boolean, work: (client: PoolClient, current: State) => Promise<T>): Promise<T | null> {
  if (!isGoalId(goalId)) return null;
  const client = await pool.connect();
  try {
    await client.query(write ? 'begin' : 'begin isolation level repeatable read read only');
    if (write) await client.query('select id from "user" where id=$1 for update', [userId]);
    const current = await state(client, userId, goalId, clock, build, write);
    const result = current ? await work(client, current) : null;
    await client.query('commit');
    return result;
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}
function ready(current: State, goalId: string, expected: { expectedGoalSettingsRevision: number; expectedParticipationId: string; expectedAnswerRevision: number }) {
  if (current.participation?.goal_id !== goalId) throw new MilestoneConflict('NOT_PARTICIPATING');
  if (current.participation.id !== expected.expectedParticipationId) throw new MilestoneConflict('PARTICIPATION_CHANGED');
  if (current.snapshot.goal.goalSettingsRevision !== expected.expectedGoalSettingsRevision ||
    String(expected.expectedAnswerRevision) !== current.snapshot.question.answer_revision) throw new MilestoneConflict('CONTEXT_CHANGED');
}
function receipt(row: StoredEpisode, assessment: ReturnType<typeof assessEpisode>): Receipt {
  return { id: row.id, forecastHash: row.payload_hash, expiresAt: row.expires_at.toISOString(),
    observedThrough: assessment.observedThrough, labelHash: assessment.labelHash };
}
function receiptsMatch(current: State, receipts: Receipt[], build: string) {
  return receipts.every(saved => {
    const source = current.rows.find(row => row.id === saved.id);
    if (!source || source.payload_hash !== saved.forecastHash || source.expires_at.toISOString() !== saved.expiresAt) return false;
    const assessed = assessEpisode(source, current.snapshot, build, saved.observedThrough);
    return assessed.labelHash === saved.labelHash;
  });
}
function candidate(current: State, build: string) {
  const row = current.artifact;
  const fail = (reason: string) => ({ row, valid: false, fit: identityFit(reason) });
  if (!row) return fail('NO_ARTIFACT');
  if (row.created_at > current.snapshot.now) return fail('ARTIFACT_NOT_YET_AVAILABLE');
  if (row.expires_at <= current.snapshot.now || row.created_at <= cutoff90(current.snapshot.now)) return fail('ARTIFACT_EXPIRED');
  if (row.payload.schemaVersion !== 'session-milestone-artifact-v1' || fingerprint(row.payload) !== row.payload_hash ||
    row.payload.protocol !== 'session-milestone-survival-v1' || !sameScope(row.payload.scope, current.scope)) return fail('ARTIFACT_CONTEXT_CHANGED');
  if (row.payload.generation !== current.participation?.fit_generation) return fail('FIT_GENERATION_CHANGED');
  if (!receiptsMatch(current, row.payload.receipts, build)) return fail('TRAINING_INPUT_CHANGED');
  return { row, valid: true, fit: row.payload.fit };
}
export async function milestoneReport(pool: Pool, userId: string, goalId: string, clock: () => Date, build: string) {
  return owned(pool, userId, goalId, clock, build, false, async (_client, current) => {
    const selected = candidate(current, build);
    return { participating: current.participation?.goal_id === goalId,
      participationId: current.participation?.goal_id === goalId ? current.participation.id : null,
      participationExpiresAt: current.participation?.goal_id === goalId ? current.participation.expires_at.toISOString() : null,
      consentRevision: current.consentRevision,
      goalSettingsRevision: current.snapshot.goal.goalSettingsRevision, answerRevision: Number(current.snapshot.question.answer_revision),
      fitGeneration: current.participation?.goal_id === goalId ? current.participation.fit_generation : 0,
      forecasts: current.rows.map(row => episodeView(row, current.snapshot, build)),
      artifact: selected.row ? { id: selected.row.id, hash: selected.row.payload_hash, valid: selected.valid,
        expiresAt: selected.row.expires_at.toISOString(), fit: selected.fit } : null };
  });
}
export async function joinMilestone(pool: Pool, userId: string, goalId: string, expectedRevision: number, expectedConsentRevision: number, clock: () => Date, build: string) {
  return owned(pool, userId, goalId, clock, build, true, async (client, current) => {
    if (current.snapshot.goal.goalSettingsRevision !== expectedRevision) throw new MilestoneConflict('CONTEXT_CHANGED');
    if (current.participation && current.participation.goal_id !== goalId) throw new MilestoneConflict('OTHER_GOAL');
    if (current.participation) {
      // Replay only the request which created this still-active participation; do not renew it.
      if (expectedConsentRevision !== current.consentRevision - 1) throw new MilestoneConflict('CONSENT_CHANGED');
      return true;
    }
    if (expectedConsentRevision !== current.consentRevision) throw new MilestoneConflict('CONSENT_CHANGED');
    await client.query('update goal set milestone_consent_revision=milestone_consent_revision+1 where id=$1 and user_id=$2', [goalId, userId]);
    await client.query('delete from milestone_participation where user_id=$1', [userId]);
    await client.query('insert into milestone_participation(user_id,goal_id,policy_version,joined_at,expires_at) values($1,$2,$3,$4,$5)',
      [userId, goalId, MILESTONE_POLICY_VERSION, current.snapshot.now, plus90(current.snapshot.now)]);
    return true;
  });
}
export async function withdrawMilestone(pool: Pool, userId: string, goalId: string, expectedId: string, clock: () => Date, build: string) {
  return owned(pool, userId, goalId, clock, build, true, async (client, current) => {
    if (current.participation?.goal_id === goalId && current.participation.id !== expectedId) throw new MilestoneConflict('PARTICIPATION_CHANGED');
    // Preserve only a monotone precondition on the business Goal, even after derived consent rows are removed.
    await client.query('update goal set milestone_consent_revision=milestone_consent_revision+1 where id=$1 and user_id=$2', [goalId, userId]);
    await client.query('delete from milestone_participation where user_id=$1 and goal_id=$2 and id=$3', [userId, goalId, expectedId]);
    return true;
  });
}
export type CaptureExpected = { expectedGoalSettingsRevision: number; expectedParticipationId: string; expectedAnswerRevision: number;
  artifactId?: string; artifactHash?: string };
function makeReadyEpisode(snapshot: TodaySnapshot, scope: Scope, build: string, selected?: { id: string; hash: string; fit: OffsetFit }) {
  try { return makeEpisode(snapshot, scope, build, selected); }
  catch (error) {
    if (error instanceof Error && ['BASELINE_INSUFFICIENT', 'NEAR_GOAL', 'Evaluation requires recorded, incomplete state'].includes(error.message)) throw new MilestoneConflict(error.message === 'Evaluation requires recorded, incomplete state' ? 'RECORDED_INCOMPLETE_STATE_REQUIRED' : error.message);
    throw error;
  }
}
export async function captureMilestone(pool: Pool, userId: string, goalId: string, expected: CaptureExpected, clock: () => Date, build: string) {
  const prepared = await owned(pool, userId, goalId, clock, build, true, async (_client, current) => {
    ready(current, goalId, expected);
    const today = localDateIn(current.snapshot.now, current.snapshot.goal.timezone);
    const existing = current.rows.find(row => row.payload.origin === today);
    if (existing) return { kind: 'replayed' as const, view: episodeView(existing, current.snapshot, build) };
    const latest = current.rows[0];
    if (latest && !assessEpisode(latest, current.snapshot, build).closed) throw new MilestoneConflict('ACTIVE_EPISODE');
    const selected = candidate(current, build);
    if (Boolean(expected.artifactId) !== Boolean(expected.artifactHash)) throw new MilestoneConflict('ARTIFACT_REFERENCE_REQUIRED');
    if (expected.artifactId && (!selected.valid || selected.row?.id !== expected.artifactId || selected.row.payload_hash !== expected.artifactHash)) throw new MilestoneConflict('ARTIFACT_CHANGED');
    return { kind: 'prepared' as const, current,
      candidate: expected.artifactId && selected.row ? { id: selected.row.id, hash: selected.row.payload_hash, fit: selected.fit } : undefined };
  });
  if (prepared === null) return null;
  if (prepared.kind === 'replayed') return { replayed: true, forecast: prepared.view };
  const payload = makeReadyEpisode(prepared.current.snapshot, prepared.current.scope, build, prepared.candidate);
  return owned(pool, userId, goalId, clock, build, true, async (client, current) => {
    ready(current, goalId, expected);
    if (current.scope.contextKey !== payload.scope.contextKey || localDateIn(current.snapshot.now, current.snapshot.goal.timezone) !== payload.origin ||
      fingerprint(current.snapshot.logs) !== fingerprint(prepared.current.snapshot.logs)) throw new MilestoneConflict('CAPTURE_INPUT_CHANGED');
    const selected = candidate(current, build);
    if (prepared.candidate && (!selected.valid || selected.row?.id !== prepared.candidate.id || selected.row.payload_hash !== prepared.candidate.hash)) throw new MilestoneConflict('ARTIFACT_CHANGED');
    const existing = current.rows.find(row => row.payload.origin === payload.origin);
    if (existing) return { replayed: true, forecast: episodeView(existing, current.snapshot, build) };
    if (current.rows[0] && !assessEpisode(current.rows[0], current.snapshot, build).closed) throw new MilestoneConflict('ACTIVE_EPISODE');
    const row: StoredEpisode = { id: randomUUID(), issued_at: prepared.current.snapshot.now,
      expires_at: new Date(Math.min(plus90(prepared.current.snapshot.now).getTime(), current.participation!.expires_at.getTime())),
      payload, payload_hash: fingerprint(payload) };
    await client.query('delete from milestone_forecast where goal_id=$1 and user_id=$2 and expires_at<=$3', [goalId, userId, current.snapshot.now]);
    await client.query(`insert into milestone_forecast(id,goal_id,user_id,participation_id,origin_date,issued_at,expires_at,payload,payload_hash)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row.id, goalId, userId, current.participation!.id, payload.origin, row.issued_at, row.expires_at, row.payload, row.payload_hash]);
    return { replayed: false, forecast: episodeView(row, current.snapshot, build) };
  });
}
export async function fitMilestone(pool: Pool, userId: string, goalId: string,
  expected: CaptureExpected & { expectedFitGeneration: number }, clock: () => Date, build: string) {
  const prepared = await owned(pool, userId, goalId, clock, build, true, async (client, current) => {
    ready(current, goalId, expected);
    if (current.participation!.fit_generation !== expected.expectedFitGeneration || expected.expectedFitGeneration >= 2147483647) throw new MilestoneConflict('FIT_GENERATION_CHANGED');
    await client.query('update milestone_participation set fit_generation=fit_generation+1 where user_id=$1 and goal_id=$2 and id=$3', [userId, goalId, expected.expectedParticipationId]);
    return { current, generation: expected.expectedFitGeneration + 1 };
  });
  if (prepared === null) return null;
  const { current, generation } = prepared;
  const selected = current.rows.slice(0, 3);
  const assessed = selected.map(row => assessEpisode(row, current.snapshot, build));
  const bad = assessed.find(item => !item.observation);
  const fit = selected.length < 3 ? identityFit('INSUFFICIENT_EPISODES', selected.length) : bad ? identityFit(bad.reason ?? bad.state, 3) :
    fitMilestoneOffset(selected.map((row, i) => ({ id: row.id, origin: row.payload.origin, scope: row.payload.scope,
      cdf: row.payload.milestone.cdf, observation: assessed[i]!.observation!, labelHash: assessed[i]!.labelHash })), current.scope);
  const receipts = selected.map((row, i) => receipt(row, assessed[i]!));
  const payload: Artifact = { schemaVersion: 'session-milestone-artifact-v1', scope: current.scope, generation,
    cutoff: localDateIn(current.snapshot.now, current.snapshot.goal.timezone), protocol: 'session-milestone-survival-v1', fit, receipts };
  return owned(pool, userId, goalId, clock, build, true, async (client, fresh) => {
    ready(fresh, goalId, expected);
    if (fresh.participation!.fit_generation !== generation || !sameScope(fresh.scope, current.scope) ||
      localDateIn(fresh.snapshot.now, fresh.snapshot.goal.timezone) !== payload.cutoff ||
      JSON.stringify(fresh.rows.slice(0, 3).map(row => row.id)) !== JSON.stringify(selected.map(row => row.id)) ||
      !receiptsMatch(fresh, receipts, build)) throw new MilestoneConflict('FIT_INPUT_CHANGED');
    const expires = Math.min(fresh.participation!.expires_at.getTime(), ...selected.map(row => row.expires_at.getTime()));
    const row: ArtifactRow = { id: randomUUID(), payload_hash: fingerprint(payload), created_at: current.snapshot.now,
      expires_at: new Date(expires), payload };
    await client.query('delete from milestone_artifact where goal_id=$1 and user_id=$2', [goalId, userId]);
    await client.query(`insert into milestone_artifact(id,goal_id,user_id,participation_id,generation,created_at,expires_at,payload,payload_hash)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [row.id, goalId, userId, fresh.participation!.id, generation, row.created_at, row.expires_at, payload, row.payload_hash]);
    return { id: row.id, hash: row.payload_hash, valid: true, expiresAt: row.expires_at.toISOString(), fit };
  });
}
export async function previewMilestone(pool: Pool, userId: string, goalId: string, id: string, hash: string, clock: () => Date, build: string) {
  const prepared = await owned(pool, userId, goalId, clock, build, false, async (_client, current) => {
    const selected = candidate(current, build);
    if (!selected.valid || selected.row?.id !== id || selected.row.payload_hash !== hash) throw new MilestoneConflict('ARTIFACT_CHANGED');
    return { current, selected: { id, hash, fit: selected.fit } };
  });
  if (!prepared) return null;
  const payload = makeReadyEpisode(prepared.current.snapshot, prepared.current.scope, build, prepared.selected);
  return { origin: payload.origin, comparison: payload.comparison, baselineMilestoneCdf: payload.milestone.cdf,
    baselineFinalCdf: payload.finalCdf, baselineEngineQuantiles: { p50Days: payload.source.p50Days, p80Days: payload.source.p80Days } };
}
export async function purgeExpiredMilestone(pool: Pool, now: Date) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const artifacts = await client.query('delete from milestone_artifact where expires_at<=$1 or created_at<=$2', [now, cutoff90(now)]);
    const forecasts = await client.query('delete from milestone_forecast where expires_at<=$1 or issued_at<=$2', [now, cutoff90(now)]);
    const participations = await client.query('delete from milestone_participation where expires_at<=$1 or joined_at<=$2', [now, cutoff90(now)]);
    await client.query('commit');
    return { artifacts: artifacts.rowCount ?? 0, forecasts: forecasts.rowCount ?? 0, participations: participations.rowCount ?? 0 };
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}
