import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import type { RecordDraft } from './draft-preview.ts';
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
  previewBaseline,
  onPreviewChange,
  recordSettings,
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
  previewBaseline?: string | undefined;
  onPreviewChange?: (draft: RecordDraft | null) => void;
  /** 入力中の量を別の単位・設定版へ読み替えない。再入力の明示操作まで固定する。 */
  recordSettings: string;
}) {
  const [inputSettings, setInputSettings] = useState(recordSettings);
  const settingsChanged = inputSettings !== recordSettings;
  const reinputFocus = useRef(false);
  const draftBaseline = useRef<string | undefined>(undefined);
  const draftStarted = useRef(false);
  const publishDraft = useCallback((value: number | null) => {
    if (!draftStarted.current) {
      draftBaseline.current = previewBaseline;
      draftStarted.current = true;
    }
    if (draftBaseline.current !== undefined) onPreviewChange?.({ baseline: draftBaseline.current, localDate: today, status: 'DONE', amount: value });
  }, [onPreviewChange, previewBaseline, today]);
  const clearPreview = () => {
    draftBaseline.current = undefined;
    draftStarted.current = false;
    onPreviewChange?.(null);
  };
  useEffect(() => () => onPreviewChange?.(null), [onPreviewChange]);
  const amount = useRecordAmount({
    date: today,
    sessionAmount,
    fmt,
    current,
    blocked: saver.isSaving || locked,
    editingAmount,
    onEditingAmountChange,
    onDraftChange: publishDraft,
  });
  useEffect(() => {
    if (reinputFocus.current) {
      reinputFocus.current = false;
      amount.amountLink.current?.focus();
    }
  }, [inputSettings]);
  // 名前・期限日だけでも版は上がる。下書き・編集中・保存中でなければ最新設定へ合わせ、未入力の記録を止めない（#244）。
  // layout effectで一瞬の誤案内を防ぐ。フォーカスは動かさない。
  useLayoutEffect(() => {
    if (inputSettings === recordSettings || draftStarted.current || editingAmount || saver.isSaving) return;
    setInputSettings(recordSettings);
  }, [recordSettings, inputSettings, editingAmount, saver.isSaving]);
  // 昨日を訂正している間は、量の入力からも送らない
  const save = (choice: RecordChoice) => {
    if (locked || settingsChanged) return;
    clearPreview();
    saver.save({ localDate: today, choice });
  };
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
          settings={{
            ready: saver.settingsReady,
            meaningChanged: saver.meaningChanged,
            loading: saver.reloadingSettings,
            failed: saver.settingsReloadFailed,
            reload: saver.reloadSettings,
          }}
          kind={classifySaveError(saver.failure.error)}
          body={todayCopy.saveFailed(describeChoice(failed, sessionAmount, amountFormat({ unit: saver.failure.vars.unit }).record, todayCopy.recordedRest))}
          localDate={saver.failure.vars.localDate}
          // 昨日を訂正している間は、失敗後の再試行からも送らない（通常の保存と同じ排他）
          onRetry={unlessLocked(locked, saver.retry)}
          retryLocked={locked}
          lockedNote={todayCopy.otherEditing}
          onReselect={() => {
            clearPreview();
            saver.reset();
          }}
          onRefresh={() => {
            clearPreview();
            saver.reset();
            onRefresh();
          }}
        />
        {cancelButton}
      </StickyActionBar>
    );
  }

  if (settingsChanged && !saver.isSaving) {
    return <StickyActionBar>
      <ErrorPanel title="Goalの設定が変わりました" action={<Button variant="primary" block onClick={() => {
        clearPreview();
        amount.resetAmount();
        reinputFocus.current = true;
        setInputSettings(recordSettings);
      }}>今の設定で入力し直す</Button>}>
        未保存の量は保存していません。単位と1回の量を確認して、入力し直してください。
      </ErrorPanel>
    </StickyActionBar>;
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
          onCancel={() => {
            if (amount.hasDraft) publishDraft(amount.shownAmount);
            else clearPreview();
            amount.closeAmount();
          }}
          onDraftChange={publishDraft}
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
