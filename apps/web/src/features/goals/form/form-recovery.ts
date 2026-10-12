import { ApiError } from '../../../api/client.ts';
import {
  CreateRecoveryError,
  createFailureKind,
  loadCreateAttempt,
  type CreateAttempt,
} from '../create-attempt.ts';
import {
  valuesFromGoal,
  type FieldErrors,
  type FormValues,
  type GoalWithAnswers,
  type PriorChosen,
} from '../goal-form.ts';

export type FormRecovery = {
  attempt: CreateAttempt | null;
  error: CreateRecoveryError | null;
  knownRejected: boolean;
};

export type FormDraft = {
  values: FormValues;
  baseline: GoalWithAnswers | undefined;
  sourceGoal: GoalWithAnswers | undefined;
  submitted: boolean;
  priorOpen: boolean;
  /** 初期質問の各問でどれかを選んだか（#259）。古い保存形式では無いことがある。 */
  priorChosen?: PriorChosen;
  latestAnswers: GoalWithAnswers['questionPrior'] | null;
};

export type FormFailure = FormDraft & {
  error: unknown;
  prepareError?: unknown;
  serverErrors: FieldErrors;
  operation: CreateAttempt | null;
};

/** 同ownerで送信し、VALIDATION_ERRORで確定拒否された作成操作。 */
export function rejectedCreateOperation(error: unknown, operation: CreateAttempt | null, owner: string | undefined) {
  return owner && operation?.owner === owner
    && error instanceof ApiError && error.status === 422
    && error.body?.error.code === 'VALIDATION_ERROR'
    ? operation : null;
}

/** 送信結果が確定して再送できない作成の失敗（別入力との競合・作成済みGoalの削除）。保存ボタンを押せなくする。 */
export function isCreateBlocked(error: unknown): boolean {
  return ['conflict', 'deleted'].includes(createFailureKind(error) ?? '');
}

/**
 * 作成の回復情報（sessionStorage）を読む。壊れたJSON・旧schemaでも画面を落とさず、原文は保全する。
 * 読めないときは、同owner・同訪問で実際に送って422で断られた操作と原文が一致した場合だけ表示用に採用し（knownRejected）、保存は止める。
 */
export function loadRecovery(
  owner: string | undefined,
  failure: FormFailure | undefined,
): FormRecovery {
  try {
    return { attempt: owner ? loadCreateAttempt(owner, sessionStorage) : null, error: null, knownRejected: false };
  } catch (error) {
    const unreadable = error instanceof CreateRecoveryError ? error : new CreateRecoveryError();
    const rejected = rejectedCreateOperation(failure?.error, failure?.operation ?? null, owner);
    // 同owner・同訪問の実送信422と原文が一致するときだけ表示に使う。保存禁止は維持する。
    try {
      if (rejected && sessionStorage.getItem(`future-roi:create-attempt:${owner}`) === rejected.raw) {
        return { attempt: rejected, error: unreadable, knownRejected: true };
      }
    } catch {
      // storageを確認できなければ初回loadの拒否を維持する。
    }
    return { attempt: null, error: unreadable, knownRejected: false };
  }
}

function sameEditableGoal(left: GoalWithAnswers, right: GoalWithAnswers) {
  return left.id === right.id
    && left.answerRevision === right.answerRevision
    && left.hasLogs === right.hasLogs
    && ('goalSettingsRevision' in left ? left.goalSettingsRevision : undefined)
      === ('goalSettingsRevision' in right ? right.goalSettingsRevision : undefined)
    && JSON.stringify(valuesFromGoal(left)) === JSON.stringify(valuesFromGoal(right));
}

/** 回答またはGoal設定の古い版で保存しようとした409。 */
export function isEditConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
    && ['ANSWER_CONFLICT', 'GOAL_SETTINGS_CONFLICT'].includes(error.body?.error.code ?? '');
}

export function isCreateResultDeleted(error: unknown): boolean {
  return error instanceof ApiError && error.status === 410 && error.body?.error.code === 'CREATE_RESULT_DELETED';
}

/**
 * 親でowner・世代・訪問を照合したsnapshotから、表示に戻せる入力だけを選ぶ。
 * 未確定作成の元bodyを優先し、通常draftは現在の編集可能値が一致するときだけ復元する。
 */
export function restoreFormDraft(
  mode: 'create' | 'edit',
  goal: GoalWithAnswers | undefined,
  draft: FormDraft | undefined,
  failure: FormFailure | undefined,
  recovery: FormRecovery,
  attempt: CreateAttempt | null,
): { recoveredFailure: FormFailure | undefined; restored: FormDraft | undefined } {
  const recoveredFailure = (!recovery.error || recovery.knownRejected) && failure && (
    mode === 'edit' ? failure.sourceGoal?.id === goal!.id
      : attempt ? failure.operation?.raw === attempt.raw
      : failure.operation === null || (failure.error instanceof ApiError && failure.error.status === 422)
  ) ? failure : undefined;
  const restored = recoveredFailure ?? (
    !attempt && !recovery.error && draft && (!goal || (draft.sourceGoal && sameEditableGoal(draft.sourceGoal, goal)))
      ? draft : undefined
  );
  return { recoveredFailure, restored };
}
