import { useState, type Ref } from 'react';
import type { Log } from '@contracts';
import { longDate, parseLocalDate, shortDate } from '../../copy/date.ts';
import { amountFormat, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { Button } from '../../ui/components/Button.tsx';
import { ErrorPanel } from '../../ui/components/Notice.tsx';
import { AmountEditor } from './AmountEditor.tsx';
import { choiceFromLog, classifySaveError, describeChoice, type RecordChoice } from './record-log.ts';
import { SaveFailure } from './SaveFailure.tsx';
import type { useSaveLog } from './useSaveLog.ts';
import './logs.css';

/**
 * 記録済みの昨日の訂正（R-04、#80。#88 で案Aに決定）。
 * - 普段は「昨日（10月6日（火））：やった・20分［変更］」の1行。未記録の昨日は YesterdayPrompt（補完）で扱い、ここには来ない
 * - ［変更］で訂正の状態へ入る。対象日は押した時点の昨日に固定し、日付が変わったら黙って別の日へ切り替えず、画面を新しくするよう案内する
 * - 初期値は保存済みの記録（DONE は保存済みの量。今の1回の量に置き換えない）。DONE の量の訂正と DONE↔SKIPPED を扱い、未記録へは戻さない
 * - 「キャンセル」は保存しない。保存に失敗しても、今の記録のまま（未記録とは表示しない）であることを書く
 */
export function YesterdayCorrection({
  log,
  currentYesterday,
  sessionAmount,
  fmt,
  saver,
  editing,
  disabled,
  onStart,
  onEnd,
  onRefresh,
  entryRef,
}: {
  /** 保存済みの昨日の記録。訂正中は、訂正を始めた時点の記録（親が固定して渡す）。 */
  log: Log;
  /** いまの /today が返す昨日。訂正中にこれが変わったら日付が変わったと判断する。 */
  currentYesterday: string;
  sessionAmount: number;
  fmt: AmountFormat;
  saver: ReturnType<typeof useSaveLog>;
  editing: boolean;
  /** 今日の記録を選び直している間は、同時に編集しない。 */
  disabled: boolean;
  onStart: () => void;
  onEnd: () => void;
  onRefresh: () => void;
  /** view/editの作り直しを所有する親が、取消後の入口へフォーカスを戻す。 */
  entryRef?: Ref<HTMLButtonElement>;
}) {
  const current = choiceFromLog(log);
  const currentText = describeChoice(current, sessionAmount, fmt.record, todayCopy.recordedRest);
  // 対象日。訂正中は、親（TodayPage）が訂正を始めた時点の記録を固定して渡す
  const target = log.localDate;
  const [draft, setDraft] = useState<RecordChoice>(current);
  const date = longDate(target);

  if (!editing) {
    return (
      <section className="fr-yesterday fr-yesterday--summary" aria-label={todayCopy.yesterdayQuestion}>
        {/* 1行に収まるよう日付は短く（10/6）。読み上げ名には曜日付きの日付を入れる */}
        <p className="fr-yesterday__summary">{todayCopy.yesterdaySummary(shortDate(parseLocalDate(log.localDate)), currentText)}</p>
        <Button ref={entryRef ?? null} variant="text" icon="edit" disabled={disabled} aria-label={todayCopy.yesterdayChangeLabel(longDate(log.localDate))} onClick={onStart}>
          {todayCopy.yesterdayChange}
        </Button>
      </section>
    );
  }

  const cancel = () => {
    saver.reset();
    onEnd();
  };
  const save = (choice: RecordChoice) => saver.save({ localDate: target, choice });

  let body;
  if (target !== currentYesterday) {
    // 訂正中に日付が変わった。保存せず、新しい昨日で選び直してもらう
    body = (
      <ErrorPanel
        title={todayCopy.dateChangedTitle}
        action={
          <Button
            variant="primary"
            block
            onClick={() => {
              cancel();
              onRefresh();
            }}
          >
            {todayCopy.refresh}
          </Button>
        }
      >
        {todayCopy.dateChanged(date)}
      </ErrorPanel>
    );
  } else if (saver.failure?.vars) {
    const failed = saver.failure.vars.choice;
    body = (
      <SaveFailure
          settings={{ ready: saver.settingsReady, meaningChanged: saver.meaningChanged, loading: saver.reloadingSettings, failed: saver.settingsReloadFailed, reload: saver.reloadSettings }}
        kind={classifySaveError(saver.failure.error)}
        body={todayCopy.correctFailed(describeChoice(failed, sessionAmount, amountFormat({ unit: saver.failure.vars.unit }).record, todayCopy.recordedRest), currentText)}
        localDate={target}
        onRetry={saver.retry}
        onReselect={saver.reset}
        onRefresh={() => {
          cancel();
          onRefresh();
        }}
      />
    );
  } else {
    body = (
      <>
        <p className="fr-yesterday__note">{todayCopy.yesterdayCorrectNote(currentText)}</p>
        <div className="fr-yesterday__pair" role="group" aria-label={todayCopy.yesterdayCorrectTitle(date)}>
          <Button
            icon="check"
            aria-pressed={draft.status === 'DONE'}
            disabled={saver.isSaving}
            onClick={() => setDraft({ status: 'DONE', amount: current.status === 'DONE' ? current.amount : sessionAmount })}
          >
            {todayCopy.yesterdayDone}
          </Button>
          <Button icon="moon" aria-pressed={draft.status === 'SKIPPED'} disabled={saver.isSaving} onClick={() => setDraft({ status: 'SKIPPED', amount: null })}>
            {todayCopy.yesterdayRest}
          </Button>
        </div>
        {draft.status === 'DONE' ? (
          <AmountEditor
            label={todayCopy.amountYesterdayLabel}
            initial={draft.amount ?? sessionAmount}
            sessionAmount={sessionAmount}
            fmt={fmt}
            busy={saver.isSaving}
            submitLabel={todayCopy.saveChange}
            cancelLabel={todayCopy.cancel}
            onSubmit={(amount) => save({ status: 'DONE', amount })}
            onCancel={cancel}
          />
        ) : (
          <div className="fr-amount__actions">
            <Button variant="primary" busy={saver.isSaving} onClick={() => save({ status: 'SKIPPED', amount: null })}>
              {saver.isSaving ? todayCopy.saving : todayCopy.saveChange}
            </Button>
            <Button variant="secondary" disabled={saver.isSaving} onClick={cancel}>
              {todayCopy.cancel}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section className="fr-yesterday" aria-labelledby="fr-yesterday-correct-title">
      <h2 id="fr-yesterday-correct-title" className="fr-yesterday__title">
        {todayCopy.yesterdayCorrectTitle(date)}
      </h2>
      {body}
    </section>
  );
}
