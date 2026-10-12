import type { Pool } from 'pg';
import type { Log } from '../contracts/log.ts';
import { isGoalId } from '../goals/goal-id.ts';
import type { QuestionRow } from '../questions/snapshot.ts';

// Goalと全記録を同じrepeatable read snapshotで取り、途中の更新と混ぜない。
export type TodaySnapshot = {
  goal: {
    totalRequired: number;
    initialProgress: number;
    sessionAmount: number;
    timezone: string;
    recordStartDate: string;
    unit: 'minutes' | 'sessions';
    goalSettingsRevision: number;
    unitLocked: boolean;
  };
  question: QuestionRow;
  logs: Log[];
  now: Date;
};

export async function loadTodaySnapshot(
  pool: Pool,
  userId: string,
  goalId: string,
  clock: () => Date,
): Promise<TodaySnapshot | null> {
  if (!isGoalId(goalId)) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const goal = (
      await client.query<QuestionRow & {
        total_required: number;
        initial_progress: number;
        session_amount: number;
        timezone: string;
        record_start_date: string;
        unit: 'minutes' | 'sessions';
        goal_settings_revision: number;
        unit_history_locked: boolean;
      }>(
        'select total_required, initial_progress, session_amount, timezone, record_start_date::text as record_start_date, unit, goal_settings_revision, unit_history_locked, question_prior, answer_revision::text as answer_revision, question_prior_snapshot from goal where id = $1 and user_id = $2',
        [goalId, userId],
      )
    ).rows[0];
    if (!goal) {
      await client.query('commit');
      return null;
    }
    // BEGINではsnapshotが確定しないため、最初のSELECT後に時計を採取する。
    const now = clock();
    const logs = await client.query<{ local_date: string; status: Log['status']; amount: number | null }>(
      'select local_date::text as local_date, status, amount from action_log where goal_id = $1 order by local_date',
      [goalId],
    );
    await client.query('commit');
    return {
      now,
      goal: {
        totalRequired: goal.total_required,
        initialProgress: goal.initial_progress,
        sessionAmount: goal.session_amount,
        timezone: goal.timezone,
        recordStartDate: goal.record_start_date,
        unit: goal.unit,
        goalSettingsRevision: goal.goal_settings_revision,
        unitLocked: goal.unit_history_locked || goal.initial_progress > 0,
      },
      question: {
        question_prior: goal.question_prior,
        answer_revision: goal.answer_revision,
        question_prior_snapshot: goal.question_prior_snapshot,
      },
      logs: logs.rows.map((r) => ({
        localDate: r.local_date,
        status: r.status,
        amount: r.amount,
      })),
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
