import { longDate } from '../../copy/date.ts';
import { ErrorPanel } from '../../ui/components/Notice.tsx';
import type { Log } from '@contracts';
import { amountFormat, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { Button } from '../../ui/components/Button.tsx';
import { StickyActionBar } from '../../ui/components/StickyActionBar.tsx';
import { AmountEditor } from './AmountEditor.tsx';
import { CancelChangeButton, RecordChoices, useRecordAmount } from './RecordChoices.tsx';
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
  const amount = useRecordAmount({
    date: today,
    sessionAmount,
    fmt,
    current,
    blocked: saver.isSaving || locked,
    editingAmount,
    onEditingAmountChange,
  });
  // 昨日を訂正している間は、量の入力からも送らない
  const save = (choice: RecordChoice) => (locked ? undefined : saver.save({ localDate: today, choice }));
  const saving = saver.saving?.choice;

  // 保存失敗後も、以前の上部の入口と同じく選び直しをやめられるようにする（#221）
  const cancelButton = current && onCancelChange ? <CancelChangeButton disabled={saver.isSaving} onClick={onCancelChange} /> : null;

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
        {cancelButton}
      </StickyActionBar>
    );
  }

  if (editingAmount) {
    return (
      <StickyActionBar>
        <AmountEditor
          label={todayCopy.amountTodayLabel}
          initial={amount.steppedInitial ?? amount.currentAmount}
          sessionAmount={sessionAmount}
          fmt={fmt}
          busy={saver.isSaving || locked}
          onSubmit={(value) => save({ status: 'DONE', amount: value })}
          onCancel={amount.closeAmount}
        />
        {/* 量の入力を開いていても、選び直しそのものをやめられる（以前の上部の入口と同じ、#221） */}
        {cancelButton}
      </StickyActionBar>
    );
  }

  return (
    <RecordChoices
      amount={amount}
      fmt={fmt}
      sessionAmount={sessionAmount}
      amountLabel={todayCopy.amountTodayLabel}
      doneLabel={todayCopy.choiceDone}
      restLabel={todayCopy.choiceRest}
      changeNote={todayCopy.changeNote}
      current={current}
      saving={saving?.status}
      isSaving={saver.isSaving}
      locked={locked}
      onSave={save}
      onCancelChange={onCancelChange}
    />
  );
}
