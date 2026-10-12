import { useState } from 'react';
import { Button } from '../../ui/components/Button.tsx';
import { ErrorPanel } from '../../ui/components/Notice.tsx';
import { longDate } from '../../copy/date.ts';
import { amountFormat, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { AmountEditor } from './AmountEditor.tsx';
import { RecordChoices, useRecordAmount } from './RecordChoices.tsx';
import { classifySaveError, type RecordChoice } from './record-log.ts';
import { SaveFailure } from './SaveFailure.tsx';
import type { useSaveLog } from './useSaveLog.ts';
import './logs.css';

type YesterdayPromptProps = {
  yesterday: string;
  sessionAmount: number;
  fmt: AmountFormat;
  saver: ReturnType<typeof useSaveLog>;
  onLater: () => void;
  onRefresh: () => void;
};

/**
 * 「昨日はどうでしたか？」（R-04、#80）。出す条件は /today の yesterdayMissing だけを見る（開始日の条件は API 側で含める）。
 * 1回押すだけで昨日を記録する。今日の記録と同じく、量は−／＋でその場で変え、数を打つときは「量を変更」から（#221）。
 * 保存に成功すると /today を取り直し、yesterdayMissing が false になって消える（成功したときだけ消える）。
 * 失敗したら「まだ入っていない」と出し、もう一度選べる。「後で答える」はデータを作らない。
 */
export function YesterdayPrompt(props: YesterdayPromptProps) {
  // 同日再取得では入力を保ち、昨日が変わったら旧日の未保存量を新しい日へ持ち越さない。
  return <YesterdayPromptForDate key={props.yesterday} {...props} />;
}

function YesterdayPromptForDate({
  yesterday,
  sessionAmount,
  fmt,
  saver,
  onLater,
  onRefresh,
}: YesterdayPromptProps) {
  const [editingAmount, setEditingAmount] = useState(false);
  // 今日の記録と同じ量の行（−／＋・量を変更）を使う（#221）
  const amount = useRecordAmount({
    date: yesterday,
    sessionAmount,
    fmt,
    current: null,
    blocked: saver.isSaving,
    editingAmount,
    onEditingAmountChange: setEditingAmount,
  });
  const save = (choice: RecordChoice) => saver.save({ localDate: yesterday, choice });
  const saving = saver.saving?.choice;
  const failureKind = saver.failure ? classifySaveError(saver.failure.error) : null;

  let body;
  if (failureKind === 'signed-out' || failureKind === 'date' || failureKind === 'settings') {
    // ログイン切れ・記録できない日は、選び直しても保存できないため、先にその対処を出す
    body = (
      <SaveFailure
        settings={{
          ready: saver.settingsReady,
          meaningChanged: saver.meaningChanged,
          loading: saver.reloadingSettings,
          failed: saver.settingsReloadFailed,
          reload: saver.reloadSettings,
        }}
        kind={failureKind}
        body={saver.failure?.vars?.choice.status === 'DONE'
          ? todayCopy.unsavedAmount(
            saver.failure.vars.choice.amount,
            amountFormat({ unit: saver.failure.vars.unit }).recordUnit,
          ) : todayCopy.unsavedRest}
        localDate={yesterday}
        onRetry={saver.retry}
        onReselect={saver.reset}
        onRefresh={() => {
          saver.reset();
          onRefresh();
        }}
      />
    );
  } else if (editingAmount) {
    body = (
      <AmountEditor
        label={todayCopy.amountYesterdayLabel}
        initial={amount.steppedInitial ?? sessionAmount}
        sessionAmount={sessionAmount}
        fmt={fmt}
        busy={saver.isSaving}
        onSubmit={(value) => save({ status: 'DONE', amount: value })}
        onCancel={amount.closeAmount}
      />
    );
  } else {
    body = (
      <>
        {/* 今日の記録と同じ形：量を先に見せてから大きい2択。押すとすぐ保存する（#199、#221） */}
        <RecordChoices
          amount={amount}
          fmt={fmt}
          sessionAmount={sessionAmount}
          amountLabel={todayCopy.amountYesterdayLabel}
          doneLabel={todayCopy.yesterdayDone}
          restLabel={todayCopy.yesterdayRest}
          changeNote={todayCopy.yesterdayChangeNote}
          current={null}
          saving={saving?.status}
          isSaving={saver.isSaving}
          locked={false}
          onSave={save}
        />
        <Button variant="text" disabled={saver.isSaving} onClick={onLater}>
          {todayCopy.yesterdayLater}
        </Button>
      </>
    );
  }

  return (
    <section className="fr-yesterday" aria-labelledby="fr-yesterday-title">
      <div className="fr-yesterday__head">
        <h2 id="fr-yesterday-title" className="fr-yesterday__title">
          {todayCopy.yesterdayQuestion}
        </h2>
        <span className="fr-yesterday__date">{longDate(yesterday)}</span>
      </div>
      {/* 通信・サーバーの失敗は、選び直せるよう2択の上に出す（E3-failed） */}
      {failureKind === 'failed' ? <ErrorPanel title={todayCopy.saveFailedTitle}>{todayCopy.yesterdayFailed}</ErrorPanel> : null}
      {body}
    </section>
  );
}
