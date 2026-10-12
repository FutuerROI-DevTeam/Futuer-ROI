import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { EvaluationPolicy, EvaluationReport } from '../contracts/evaluation.ts';
import { isGoalId } from '../goals/goal-id.ts';
import { localDateIn } from '../goals/local-date.ts';
import { loadTodaySnapshot } from '../prediction/store.ts';
import {
  toTodaySnapshot,
  type SnapshotGoalRow,
  type SnapshotLogRow,
  type TodaySnapshot,
} from '../prediction/snapshot.ts';
import {
  assessEvaluation,
  countQuantiles,
  makeEvaluation,
  prefixFingerprint,
  type ForecastRow,
} from './assessment.ts';

export class EvaluationConflict extends Error {
  readonly code: string;
  constructor(code: string) {
    super('Evaluation state changed; review and explicitly retry.');
    this.code = code;
  }
}

type Participation = {
  id: string;
  goal_id: string;
  joined_at: Date;
  expires_at: Date;
};
type OwnedState = {
  snapshot: TodaySnapshot;
  participation: Participation | undefined;
  rows: ForecastRow[];
};

const expiry = (at: Date, days: number) => new Date(at.getTime() + days * 86_400_000);

// log/settings更新と同じGoal lockで、保存確認後のすり抜けを防ぐ。
async function readState(
  client: PoolClient,
  userId: string,
  goalId: string,
  now: () => Date,
  policy: EvaluationPolicy,
  lock: boolean,
): Promise<OwnedState | null> {
  const goal = (await client.query<SnapshotGoalRow>(
    `select total_required, initial_progress, session_amount, timezone, record_start_date::text as record_start_date,
     unit, goal_settings_revision, unit_history_locked, question_prior, answer_revision::text as answer_revision,
     question_prior_snapshot from goal where id=$1 and user_id=$2${lock ? ' for update' : ''}`,
    [goalId, userId],
  )).rows[0];
  if (!goal) {
    return null;
  }

  const instant = now();
  const logs = (await client.query<SnapshotLogRow>(
    'select local_date::text as local_date,status,amount from action_log where goal_id=$1 order by local_date',
    [goalId],
  )).rows;
  const participation = (await client.query<Participation>(
    'select id,goal_id,joined_at,expires_at from evaluation_participation where user_id=$1 and expires_at>$2 and joined_at>$3',
    [userId, instant, new Date(instant.getTime() - policy.retentionDays * 86_400_000)],
  )).rows[0];
  const rows = participation?.goal_id === goalId ? (await client.query<ForecastRow>(
    'select id,issued_at,expires_at,payload from evaluation_forecast where goal_id=$1 and expires_at>$2 and issued_at>$3 order by issued_at desc,id limit $4',
    [goalId, instant, new Date(instant.getTime() - policy.retentionDays * 86_400_000), policy.maxSnapshots],
  )).rows : [];

  return {
    snapshot: toTodaySnapshot(goal, logs, instant),
    participation,
    rows,
  };
}

async function ownedTransaction<T>(
  pool: Pool,
  userId: string,
  goalId: string,
  now: () => Date,
  policy: EvaluationPolicy,
  write: boolean,
  work: (client: PoolClient, state: OwnedState) => Promise<T>,
): Promise<T | null> {
  if (!isGoalId(goalId)) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query(write ? 'begin' : 'begin isolation level repeatable read read only');
    // 1人1Goalの参加と退会/解除をuser→Goalの順で直列化する。
    if (write) {
      await client.query('select id from "user" where id=$1 for update', [userId]);
    }
    const state = await readState(client, userId, goalId, now, policy, write);
    const result = state ? await work(client, state) : null;
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const reportFrom = (state: OwnedState, policy: EvaluationPolicy, goalId: string): EvaluationReport => {
  const forecasts = state.rows.map(row =>
    assessEvaluation(row, state.snapshot, state.snapshot.now, policy.observationDays),
  );
  return {
    policy,
    participating: state.participation?.goal_id === goalId,
    goalSettingsRevision: state.snapshot.goal.goalSettingsRevision,
    forecasts,
    summary: {
      issued: forecasts.length,
      participantCount: forecasts.length > 0 ? 1 : 0,
      p50: countQuantiles(forecasts, 'p50State'),
      p80: countQuantiles(forecasts, 'p80State'),
    },
  };
};

export async function evaluationReport(
  pool: Pool,
  userId: string,
  goalId: string,
  now: () => Date,
  policy: EvaluationPolicy,
): Promise<EvaluationReport | null> {
  return ownedTransaction(pool, userId, goalId, now, policy, false, async (_client, state) =>
    reportFrom(state, policy, goalId),
  );
}

export async function joinEvaluation(
  pool: Pool,
  userId: string,
  goalId: string,
  now: () => Date,
  policy: EvaluationPolicy,
): Promise<boolean | null> {
  return ownedTransaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    if (state.participation && state.participation.goal_id !== goalId) {
      throw new EvaluationConflict('EVALUATION_OTHER_GOAL');
    }
    if (!state.participation) {
      await client.query('delete from evaluation_participation where user_id=$1', [userId]);
      await client.query(
        'insert into evaluation_participation(user_id,goal_id,policy_version,joined_at,expires_at) values($1,$2,$3,$4,$5)',
        [userId, goalId, policy.policyVersion, state.snapshot.now, expiry(state.snapshot.now, policy.retentionDays)],
      );
    }
    return true;
  });
}

export async function withdrawEvaluation(
  pool: Pool,
  userId: string,
  goalId: string,
  now: () => Date,
  policy: EvaluationPolicy,
): Promise<boolean | null> {
  return ownedTransaction(pool, userId, goalId, now, policy, true, async (client) => {
    await client.query('delete from evaluation_participation where user_id=$1 and goal_id=$2', [userId, goalId]);
    return true;
  });
}

function captureReady(state: OwnedState, goalId: string, expectedRevision: number) {
  if (state.participation?.goal_id !== goalId) {
    throw new EvaluationConflict('EVALUATION_NOT_PARTICIPATING');
  }
  if (state.snapshot.goal.goalSettingsRevision !== expectedRevision) {
    throw new EvaluationConflict('GOAL_SETTINGS_CONFLICT');
  }
}

export async function captureEvaluation(
  pool: Pool,
  userId: string,
  goalId: string,
  expectedRevision: number,
  now: () => Date,
  policy: EvaluationPolicy,
  buildVersion: string,
) {
  // 再送は同日の初回カードを返す。後の完成/訂正でも上書きしない。
  const preflight = await ownedTransaction(pool, userId, goalId, now, policy, true, async (_client, state) => {
    captureReady(state, goalId, expectedRevision);
    const anchor = localDateIn(state.snapshot.now, state.snapshot.goal.timezone);
    const existing = state.rows.find(row => row.payload.anchorDate === anchor);
    return existing
      ? {
        kind: 'replayed' as const,
        forecast: assessEvaluation(existing, state.snapshot, state.snapshot.now, policy.observationDays),
      }
      : { kind: 'prepare' as const, participationId: state.participation!.id };
  });
  if (preflight === null) {
    return null;
  }
  if (preflight.kind === 'replayed') {
    return { replayed: true, forecast: preflight.forecast };
  }

  const snapshot = await loadTodaySnapshot(pool, userId, goalId, now);
  if (!snapshot) {
    return null;
  }
  if (snapshot.goal.goalSettingsRevision !== expectedRevision) {
    throw new EvaluationConflict('GOAL_SETTINGS_CONFLICT');
  }
  const anchor = localDateIn(snapshot.now, snapshot.goal.timezone);
  if (!snapshot.logs.some(log => log.localDate === anchor)) {
    throw new EvaluationConflict('EVALUATION_TODAY_UNRECORDED');
  }
  const done = snapshot.goal.initialProgress + snapshot.logs
    .filter(log => log.status === 'DONE')
    .reduce((sum, log) => sum + (log.amount ?? 0), 0);
  if (done >= snapshot.goal.totalRequired) {
    throw new EvaluationConflict('EVALUATION_ALREADY_COMPLETED');
  }

  // 既存Engine計算は接続返却後に1回だけ行う。
  const payload = makeEvaluation(snapshot, buildVersion);
  return ownedTransaction(pool, userId, goalId, now, policy, true, async (client, state) => {
    captureReady(state, goalId, expectedRevision);
    if (state.participation!.id !== preflight.participationId) {
      throw new EvaluationConflict('EVALUATION_PARTICIPATION_CHANGED');
    }
    if (
      localDateIn(state.snapshot.now, state.snapshot.goal.timezone) !== anchor ||
      state.snapshot.question.answer_revision !== snapshot.question.answer_revision ||
      prefixFingerprint(state.snapshot.logs, anchor) !== payload.prefixHash
    ) {
      throw new EvaluationConflict('EVALUATION_INPUT_CHANGED');
    }
    const existing = state.rows.find(row => row.payload.anchorDate === anchor);
    if (existing) {
      return {
        replayed: true,
        forecast: assessEvaluation(existing, state.snapshot, state.snapshot.now, policy.observationDays),
      };
    }

    await client.query(
      'delete from evaluation_forecast where goal_id=$1 and (expires_at<=$2 or issued_at<=$3)',
      [goalId, state.snapshot.now, new Date(state.snapshot.now.getTime() - policy.retentionDays * 86_400_000)],
    );
    // 行数が設定変更で減った場合も、最新(max-1)件と新規1件までにする。
    await client.query(
      'delete from evaluation_forecast where goal_id=$1 and id not in (select id from evaluation_forecast where goal_id=$1 order by issued_at desc,id limit $2)',
      [goalId, policy.maxSnapshots - 1],
    );
    const row: ForecastRow = {
      id: randomUUID(),
      issued_at: snapshot.now,
      expires_at: new Date(Math.min(
        expiry(snapshot.now, policy.retentionDays).getTime(),
        state.participation!.expires_at.getTime(),
      )),
      payload,
    };
    await client.query(
      'insert into evaluation_forecast(id,goal_id,anchor_date,issued_at,expires_at,payload) values($1,$2,$3,$4,$5,$6)',
      [row.id, goalId, anchor, row.issued_at, row.expires_at, row.payload],
    );
    return {
      replayed: false,
      forecast: assessEvaluation(row, state.snapshot, state.snapshot.now, policy.observationDays),
    };
  });
}

/** 運用者が明示的に実行するpurge。アクセス時の非表示と物理削除の期限保証を混同しない。 */
export async function purgeExpiredEvaluation(
  pool: Pool,
  now: Date,
  retentionDays = 90,
): Promise<{ forecasts: number; participations: number }> {
  if (!Number.isInteger(retentionDays) || retentionDays < 3 || retentionDays > 90) {
    throw new Error('Invalid evaluation retention');
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
    const forecasts = await client.query(
      'delete from evaluation_forecast where expires_at<=$1 or issued_at<=$2 or goal_id in (select goal_id from evaluation_participation where expires_at<=$1 or joined_at<=$2)',
      [now, cutoff],
    );
    const participations = await client.query(
      'delete from evaluation_participation where expires_at<=$1 or joined_at<=$2',
      [now, cutoff],
    );
    await client.query('commit');
    return { forecasts: forecasts.rowCount ?? 0, participations: participations.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
