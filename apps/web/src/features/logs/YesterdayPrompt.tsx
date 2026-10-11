import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/components/Button.tsx';
import { ErrorPanel } from '../../ui/components/Notice.tsx';
import { longDate } from '../../copy/date.ts';
import { amountFormat, type AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { AmountEditor } from './AmountEditor.tsx';
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
 * 1回押すだけで昨日を記録する（やった量は1回の量。「量を変更」で変えられる）。
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
  const amountEntry = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!editingAmount && returnFocus.current) {
      returnFocus.current = false;
      amountEntry.current?.focus();
    }
  }, [editingAmount]);
  const save = (choice: RecordChoice) => saver.save({ localDate: yesterday, choice });
  const saving = saver.saving?.choice;
  const failureKind = saver.failure ? classifySaveError(saver.failure.error) : null;

  let body;
  if (failureKind === 'signed-out' || failureKind === 'date' || failureKind === 'settings') {
    // ログイン切れ・記録できない日は、選び直しても保存できないため、先にその対処を出す
    body = (
      <SaveFailure
          settings={{ ready: saver.settingsReady, meaningChanged: saver.meaningChanged, loading: saver.reloadingSettings, failed: saver.settingsReloadFailed, reload: saver.reloadSettings }}
        kind={failureKind}
        body={saver.failure?.vars?.choice.status === 'DONE' ? todayCopy.unsavedAmount(saver.failure.vars.choice.amount, amountFormat({ unit: saver.failure.vars.unit }).recordUnit) : todayCopy.unsavedRest}
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
        initial={sessionAmount}
        sessionAmount={sessionAmount}
        fmt={fmt}
        busy={saver.isSaving}
        onSubmit={(amount) => save({ status: 'DONE', amount })}
        onCancel={() => {
          returnFocus.current = true;
          setEditingAmount(false);
        }}
      />
    );
  } else {
    body = (
      <>
        {/* 押すとすぐ保存されるため、記録する量を先に見せてから2択を置く（今日の操作帯と同じ読む順、#199） */}
        <p className="fr-yesterday__amount">
          {todayCopy.doneAmount(fmt.record(sessionAmount))}
          <Button ref={amountEntry} variant="text" disabled={saver.isSaving} onClick={() => setEditingAmount(true)}>
            {todayCopy.changeAmount}
          </Button>
        </p>
        <div className="fr-yesterday__pair">
          <Button icon="check" busy={saving?.status === 'DONE'} disabled={saver.isSaving} onClick={() => save({ status: 'DONE', amount: sessionAmount })}>
            {saving?.status === 'DONE' ? todayCopy.saving : todayCopy.yesterdayDone}
          </Button>
          <Button icon="moon" busy={saving?.status === 'SKIPPED'} disabled={saver.isSaving} onClick={() => save({ status: 'SKIPPED', amount: null })}>
            {saving?.status === 'SKIPPED' ? todayCopy.saving : todayCopy.yesterdayRest}
          </Button>
        </div>
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
