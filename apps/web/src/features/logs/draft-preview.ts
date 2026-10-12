import type { FeedbackSnapshot } from './save-feedback.ts';
import { isRecordAmount } from '../../copy/amount.ts';
import { isSameSnapshot } from '../today/snapshot.ts';

export type RecordDraft = { baseline: string; localDate: string; status: 'DONE' | 'SKIPPED'; amount: number | null };
export type DraftProgress = { amount: number; points: number; done: number; total: number; unit: FeedbackSnapshot['goal']['unit'] };

/** 入力開始時の表示に固定する。取得後の更新へ古い入力を黙って読み替えない。 */
export function recordPreviewBaseline({ goal, today, logs }: FeedbackSnapshot): string {
  return JSON.stringify([
    goal.id, goal.unit, goal.totalRequired, goal.progressDone, goal.initialProgress,
    goal.sessionAmount, goal.timezone, goal.recordStartDate, goal.goalSettingsRevision,
    goal.answerRevision, today.today,
    logs.map(l => [l.localDate, l.status, l.amount]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

/** 「やった」と保存する場合だけの未保存試算。保存・予測計算・達成判定は行わない。 */
export function draftProgress(snapshot: FeedbackSnapshot, draft: RecordDraft | null): DraftProgress | null {
  if (!draft || draft.status !== 'DONE' || !isRecordAmount(draft.amount)) return null;
  if (!isSameSnapshot(snapshot.goal, snapshot.today, snapshot.logs)) return null;
  if (snapshot.goal.progressDone !== snapshot.today.prediction.progress.done) return null;
  if (new Set(snapshot.logs.map(log => log.localDate)).size !== snapshot.logs.length) return null;
  if (draft.localDate !== snapshot.today.today || draft.baseline !== recordPreviewBaseline(snapshot)) return null;
  const { progressDone: before, totalRequired: total, unit } = snapshot.goal;
  if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(total) || total <= 0) return null;
  const previous = snapshot.logs.find(l => l.localDate === draft.localDate);
  const amount = draft.amount - (previous?.status === 'DONE' ? previous.amount ?? 0 : 0);
  const done = before + amount;
  if (!Number.isSafeInteger(done) || done < 0) return null;
  return { amount, points: amount / total * 100, done, total, unit };
}
