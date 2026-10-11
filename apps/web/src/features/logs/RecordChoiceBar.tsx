import { useEffect, useId, useRef, useState } from 'react';
import { longDate } from '../../copy/date.ts';
import { ErrorPanel } from '../../ui/components/Notice.tsx';
import type { Log } from '@contracts';
import { amountFormat, RECORD_AMOUNT_MAX, stepRecordAmount, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { Button, IconButton } from '../../ui/components/Button.tsx';
import { ChoiceButton } from '../../ui/components/ChoiceButton.tsx';
import { StickyActionBar } from '../../ui/components/StickyActionBar.tsx';
import { AmountEditor } from './AmountEditor.tsx';
import { classifySaveError, describeChoice, unlessLocked, type RecordChoice } from './record-log.ts';
import { SaveFailure } from './SaveFailure.tsx';
import type { useSaveLog } from './useSaveLog.ts';
import './logs.css';

/**
 * 今日の記録の2択（R-03、#79）。画面の下に固定し、スクロールに追従する。
 * 予測の表示が失敗しても操作できるよう、予測の Error Boundary の外に置く。
 * 「やった」「今日は休む」は1回押すだけで保存する（やった量は1回の量）。
 * −／＋は、その場で「今日記録する量」を刻み1つ分変える（保存はしない。「やった」を押したときにその量で保存する、#199）。
 * 数を直接打ち込みたいときは「量を変更」から。
 * current があるときは記録の変更（D5-change）：今の記録を選択中として出し、選び直すと上書きする。
 * 量の入力を開いているかは親（TodayPage）が持つ。開いている間は昨日の訂正を始められないようにするため。
 */
export function RecordChoiceBar({
  today,
  sessionAmount,
  fmt,
  current,
  saver,
  onCancelChange,
  onRefresh,
  locked = false,
  editingAmount,
  onEditingAmountChange,
}: {
  today: string;
  sessionAmount: number;
  /** 量の書き方（1回の量は分か回。P-18）。 */
  fmt: AmountFormat;
  current?: Log | null;
  saver: ReturnType<typeof useSaveLog>;
  onCancelChange?: () => void;
  onRefresh: () => void;
  /** 昨日の記録を訂正している間は押せなくする（今日と昨日を同時に編集しない）。 */
  locked?: boolean;
  /** 量の入力を開いているか（親が持つ）。 */
  editingAmount: boolean;
  onEditingAmountChange: (editing: boolean) => void;
}) {
  const label = fmt.record;
  const currentAmount = current?.status === 'DONE' && current.amount !== null ? current.amount : sessionAmount;
  // −／＋で変えた、まだ保存していない量。保存し終えたとき・日付や今の記録が変わったときは捨てる
  const [draftAmount, setDraftAmount] = useState<number | null>(null);
  useEffect(() => {
    setDraftAmount(null);
  }, [today, current?.status, current?.amount, sessionAmount]);
  const shownAmount = draftAmount ?? (current ? currentAmount : sessionAmount);
  const stepSize = fmt.recordStep(sessionAmount);
  const canDecrease = stepRecordAmount(shownAmount, stepSize, -1) !== shownAmount;
  const canIncrease = shownAmount < RECORD_AMOUNT_MAX;
  const predictionNoteId = useId();
  const hasDifferentAmount = shownAmount !== sessionAmount;
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
  const openAmount = () => {
    if (saver.isSaving || locked) return;
    // 入力欄は、−／＋で変えた量（なければ今の量）から始める
    setSteppedInitial(draftAmount);
    onEditingAmountChange(true);
  };
  // その場で量を変える（保存しない）
  const stepAmount = (direction: -1 | 1) => {
    if (saver.isSaving || locked) return;
    setDraftAmount(stepRecordAmount(shownAmount, stepSize, direction));
  };
  const closeAmount = () => {
    returnFocus.current = true;
    setSteppedInitial(null);
    onEditingAmountChange(false);
  };
  // 昨日を訂正している間は、量の入力からも送らない
  const save = (choice: RecordChoice) => (locked ? undefined : saver.save({ localDate: today, choice }));
  const saving = saver.saving?.choice;

  // 失敗した保存の再試行は、その variables の日付も検査する（表示が翌日へ更新された後も）。
  const staleDate = saver.isStaleDate(today) ? today
    : saver.failure?.vars && saver.isStaleDate(saver.failure.vars.localDate) ? saver.failure.vars.localDate : undefined;
  if (staleDate && !saver.isSaving) {
    return (
      <StickyActionBar>
        <ErrorPanel title={todayCopy.dateChangedTitle} action={<Button variant="primary" block onClick={onRefresh}>{todayCopy.refresh}</Button>}>
          {todayCopy.dateChanged(longDate(staleDate))}
        </ErrorPanel>
      </StickyActionBar>
    );
  }

  if (saver.failure?.vars) {
    const failed = saver.failure.vars.choice;
    return (
      <StickyActionBar>
        <SaveFailure
          settings={{ ready: saver.settingsReady, meaningChanged: saver.meaningChanged, loading: saver.reloadingSettings, failed: saver.settingsReloadFailed, reload: saver.reloadSettings }}
          kind={classifySaveError(saver.failure.error)}
          body={todayCopy.saveFailed(describeChoice(failed, sessionAmount, amountFormat({ unit: saver.failure.vars.unit }).record, todayCopy.recordedRest))}
          localDate={saver.failure.vars.localDate}
          // 昨日を訂正している間は、失敗後の再試行からも送らない（通常の保存と同じ排他）
          onRetry={unlessLocked(locked, saver.retry)}
          retryLocked={locked}
          lockedNote={todayCopy.otherEditing}
          onReselect={saver.reset}
          onRefresh={() => {
            saver.reset();
            onRefresh();
          }}
        />
      </StickyActionBar>
    );
  }

  if (editingAmount) {
    return (
      <StickyActionBar>
        <AmountEditor
          label={todayCopy.amountTodayLabel}
          initial={steppedInitial ?? currentAmount}
          sessionAmount={sessionAmount}
          fmt={fmt}
          busy={saver.isSaving || locked}
          onSubmit={(amount) => save({ status: 'DONE', amount })}
          onCancel={closeAmount}
        />
      </StickyActionBar>
    );
  }

  const note = saver.isSaving ? (
    todayCopy.savingNote
  ) : locked ? (
    todayCopy.otherEditing
  ) : (
    <span className="fr-record__note">
      {current ? <span>{todayCopy.changeNote}</span> : null}
      <span className="fr-record__amount-controls">
        <span className="fr-record__amount-text" aria-live="polite">
          {/* 「今日記録する量：3回」。数と単位の間では折り返さない */}
          {todayCopy.amountTodayLabel}：<span className="fr-record__amount-value">{label(shownAmount)}</span>
        </span>
        <IconButton icon="minus" label={`${todayCopy.amountDecrease}（${label(stepSize)}ずつ）`} disabled={saver.isSaving || locked || !canDecrease} onClick={() => stepAmount(-1)} />
        <IconButton icon="plus" label={`${todayCopy.amountIncrease}（${label(stepSize)}ずつ）`} disabled={saver.isSaving || locked || !canIncrease} onClick={() => stepAmount(1)} />
        <Button ref={amountLink} variant="text" disabled={saver.isSaving || locked} onClick={() => openAmount()}>
          {todayCopy.changeAmount}
        </Button>
      </span>
      {/* 1回の量と違う量にしたときだけ、見通しは1回の量で計算していることを添える（AmountEditorと同じ注記） */}
      {hasDifferentAmount ? (
        <span id={predictionNoteId} className="fr-amount__prediction-note">
          {todayCopy.amountPredictionNote(label(sessionAmount))}
        </span>
      ) : null}
      {current && onCancelChange ? (
        <Button variant="text" onClick={onCancelChange}>
          {todayCopy.cancelChange}
        </Button>
      ) : null}
    </span>
  );

  return (
    <StickyActionBar columns={2} note={note}>
      <ChoiceButton
        kind="done"
        label={todayCopy.choiceDone}
        sublabel={label(shownAmount)}
        aria-describedby={hasDifferentAmount ? predictionNoteId : undefined}
        selected={current?.status === 'DONE'}
        busy={saving?.status === 'DONE'}
        busyLabel={todayCopy.saving}
        disabled={saver.isSaving || locked}
        onClick={() => save({ status: 'DONE', amount: shownAmount })}
      />
      <ChoiceButton
        kind="rest"
        label={todayCopy.choiceRest}
        selected={current?.status === 'SKIPPED'}
        busy={saving?.status === 'SKIPPED'}
        busyLabel={todayCopy.saving}
        disabled={saver.isSaving || locked}
        onClick={() => save({ status: 'SKIPPED', amount: null })}
      />
    </StickyActionBar>
  );
}
