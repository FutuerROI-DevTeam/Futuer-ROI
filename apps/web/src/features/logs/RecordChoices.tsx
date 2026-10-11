import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { RECORD_AMOUNT_MAX, stepRecordAmount, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { Button, IconButton } from '../../ui/components/Button.tsx';
import { ChoiceButton } from '../../ui/components/ChoiceButton.tsx';
import { StickyActionBar } from '../../ui/components/StickyActionBar.tsx';
import type { RecordChoice } from './record-log.ts';

/** 今の記録（今日の Log・昨日の訂正の RecordChoice のどちらでもよい）。 */
type CurrentRecord = { status: RecordChoice['status']; amount: number | null } | null | undefined;

/**
 * 記録する量の下書き（−／＋）と「量を変更」の入力欄の開閉（#199）。今日と昨日で同じ動きにする（#221）。
 * −／＋は保存せず、押した2択でその量を保存する。日付・今の記録・1回の量が変わったら下書きを捨てる。
 * 量の入力を開いているかは呼び出し側が持つ（今日は TodayPage が、昨日の訂正中は今日を押せなくするために使う）。
 */
export function useRecordAmount({
  date,
  sessionAmount,
  fmt,
  current,
  blocked,
  editingAmount,
  onEditingAmountChange,
}: {
  date: string;
  sessionAmount: number;
  fmt: AmountFormat;
  current: CurrentRecord;
  /** 保存中・ほかの記録を編集中は量を変えない。 */
  blocked: boolean;
  editingAmount: boolean;
  onEditingAmountChange: (editing: boolean) => void;
}) {
  const currentAmount = current?.status === 'DONE' && current.amount !== null ? current.amount : sessionAmount;
  // −／＋で変えた、まだ保存していない量。保存し終えたとき・日付や今の記録が変わったときは捨てる
  const [draftAmount, setDraftAmount] = useState<number | null>(null);
  useEffect(() => {
    setDraftAmount(null);
  }, [date, current?.status, current?.amount, sessionAmount]);
  const shownAmount = draftAmount ?? (current ? currentAmount : sessionAmount);
  const stepSize = fmt.recordStep(sessionAmount);
  const [steppedInitial, setSteppedInitial] = useState<number | null>(null);
  const amountLink = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    // 量の入力を閉じたら、開いた「量を変更」へフォーカスを戻す
    if (!editingAmount && returnFocus.current) {
      returnFocus.current = false;
      amountLink.current?.focus();
    }
  }, [editingAmount]);
  return {
    currentAmount,
    shownAmount,
    stepSize,
    canDecrease: stepRecordAmount(shownAmount, stepSize, -1) !== shownAmount,
    canIncrease: shownAmount < RECORD_AMOUNT_MAX,
    hasDifferentAmount: shownAmount !== sessionAmount,
    steppedInitial,
    amountLink,
    // 入力欄は、−／＋で変えた量（なければ今の量）から始める
    openAmount: () => {
      if (blocked) return;
      setSteppedInitial(draftAmount);
      onEditingAmountChange(true);
    },
    // その場で量を変える（保存しない）
    stepAmount: (direction: -1 | 1) => {
      if (blocked) return;
      setDraftAmount(stepRecordAmount(shownAmount, stepSize, direction));
    },
    closeAmount: () => {
      returnFocus.current = true;
      setSteppedInitial(null);
      onEditingAmountChange(false);
    },
  };
}

export type RecordAmount = ReturnType<typeof useRecordAmount>;

/** 選び直しをやめる入口。スクロールしても押せるよう、上部ではなく記録の欄に置く（#221）。保存中は押せない。 */
export function CancelChangeButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="text" disabled={disabled} onClick={onClick}>
      {todayCopy.cancelChange}
    </Button>
  );
}

/**
 * 量の行（「◯◯する量：3回 −／＋ 量を変更」）と、大きい2択（やった＋量／休む）。今日の記録と昨日の記録で同じ形にする（#221）。
 * current があるときは選び直し：今の記録を選択中として出し、押すと上書きする。
 * 失敗・日付の変化など、2択を出せない状態の扱いは呼び出し側が持つ。
 */
export function RecordChoices({
  amount,
  fmt,
  sessionAmount,
  amountLabel,
  doneLabel,
  restLabel,
  changeNote,
  current,
  saving,
  isSaving,
  locked,
  onSave,
  onCancelChange,
}: {
  amount: RecordAmount;
  fmt: AmountFormat;
  sessionAmount: number;
  amountLabel: string;
  doneLabel: string;
  restLabel: string;
  /** 選び直しのときの注記（「選び直すと、◯◯の記録を上書きします」）。 */
  changeNote: string;
  current: CurrentRecord;
  /** 保存中の選択（押した側のボタンに保存中を出す）。 */
  saving: RecordChoice['status'] | undefined;
  isSaving: boolean;
  /** ほかの記録を編集している間は押せない。 */
  locked: boolean;
  onSave: (choice: RecordChoice) => void;
  onCancelChange?: (() => void) | undefined;
}) {
  const label = fmt.record;
  const predictionNoteId = useId();
  const cancelButton = current && onCancelChange ? <CancelChangeButton disabled={isSaving} onClick={onCancelChange} /> : null;

  let note: ReactNode;
  if (isSaving) {
    note = todayCopy.savingNote;
  } else if (locked) {
    note = (
      <span className="fr-record__note">
        <span>{todayCopy.otherEditing}</span>
        {cancelButton}
      </span>
    );
  } else {
    note = (
      <span className="fr-record__note">
        {current ? <span>{changeNote}</span> : null}
        <span className="fr-record__amount-controls">
          <span className="fr-record__amount-text" aria-live="polite">
            {/* 「今日記録する量：3回」。数と単位の間では折り返さない */}
            {amountLabel}：<span className="fr-record__amount-value">{label(amount.shownAmount)}</span>
          </span>
          <IconButton icon="minus" label={`${todayCopy.amountDecrease}（${label(amount.stepSize)}ずつ）`} disabled={!amount.canDecrease} onClick={() => amount.stepAmount(-1)} />
          <IconButton icon="plus" label={`${todayCopy.amountIncrease}（${label(amount.stepSize)}ずつ）`} disabled={!amount.canIncrease} onClick={() => amount.stepAmount(1)} />
          <Button ref={amount.amountLink} variant="text" onClick={() => amount.openAmount()}>
            {todayCopy.changeAmount}
          </Button>
        </span>
        {/* 1回の量と違う量にしたときだけ、見通しは1回の量で計算していることを添える（AmountEditorと同じ注記） */}
        {amount.hasDifferentAmount ? (
          <span id={predictionNoteId} className="fr-amount__prediction-note">
            {todayCopy.amountPredictionNote(label(sessionAmount))}
          </span>
        ) : null}
        {cancelButton}
      </span>
    );
  }

  return (
    <StickyActionBar columns={2} note={note}>
      <ChoiceButton
        kind="done"
        label={doneLabel}
        sublabel={label(amount.shownAmount)}
        aria-describedby={amount.hasDifferentAmount && !isSaving && !locked ? predictionNoteId : undefined}
        selected={current?.status === 'DONE'}
        busy={saving === 'DONE'}
        busyLabel={todayCopy.saving}
        disabled={isSaving || locked}
        onClick={() => onSave({ status: 'DONE', amount: amount.shownAmount })}
      />
      <ChoiceButton
        kind="rest"
        label={restLabel}
        selected={current?.status === 'SKIPPED'}
        busy={saving === 'SKIPPED'}
        busyLabel={todayCopy.saving}
        disabled={isSaving || locked}
        onClick={() => onSave({ status: 'SKIPPED', amount: null })}
      />
    </StickyActionBar>
  );
}
