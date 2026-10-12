import { Goal as GoalSchema, GoalList, GoalR11 as GoalR11Schema } from '@contracts';
import type { Goal, GoalCreate, GoalPatch, GoalR11 } from '@contracts';
import { requestJson, requestNoContent } from './http.ts';

/**
 * Goal API（#76）を実際に呼ぶ。Goal の一覧・作成・編集・削除の画面（#78）と、Today 画面（#81）の Goal の取得が使う。
 */
const path = (goalId: string) => `/api/goals/${encodeURIComponent(goalId)}`;

export const goalsHttp = {
  listGoals: (signal?: AbortSignal): Promise<Goal[]> => requestJson(GoalList, '/api/goals', { signal }),
  /** R-11 の読み取り（?view=r11）。R-11 の回答（questionPrior）と回答の版（answerRevision）を含む。専用の schema で応答を確かめる。 */
  getGoal: (goalId: string, signal?: AbortSignal): Promise<GoalR11> => requestJson(GoalR11Schema, `${path(goalId)}?view=r11`, { signal }),
  createGoal: (body: GoalCreate, idempotencyKey: string, owner?: string): Promise<Goal> => requestJson(
    GoalSchema,
    '/api/goals',
    {
      method: 'POST',
      body,
      headers: {
        'Idempotency-Key': idempotencyKey,
        ...(owner ? { 'X-Create-Owner': owner } : {}),
      },
    },
  ),
  updateGoal: (goalId: string, body: GoalPatch): Promise<Goal> => requestJson(GoalSchema, path(goalId), { method: 'PATCH', body }),
  deleteGoal: (goalId: string): Promise<void> => requestNoContent(path(goalId), { method: 'DELETE' }),
};

/**
 * Goal の取得結果をまとめて持つキー。作成・編集・削除の後に、一覧と個別の両方を取り直す。
 * 個別は R-11 の読み取り（?view=r11）なので、読み取りの表現をキーに含め、通常の表現の応答と同じキャッシュに入れない。
 * 利用者ごとの私的なデータなので、ログインしている人が変わったら ['goals'] の下をまとめて止めて消す（session-cache.ts）。
 */
export const goalKeys = {
  all: ['goals'] as const,
  list: () => ['goals', 'list'] as const,
  detail: (goalId: string) => ['goals', 'detail', goalId, 'r11'] as const,
};
