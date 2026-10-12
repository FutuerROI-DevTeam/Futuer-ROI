import { useEffect, useId, useRef, useState } from 'react';
import { todayCopy } from '../../copy/today.ts';
import { Button } from '../../ui/components/Button.tsx';
import { Field, fieldAria, NumberInput } from '../../ui/components/FormField.tsx';
import { IconButton } from '../../ui/components/Button.tsx';
import { isRecordAmount, RECORD_AMOUNT_MAX, RECORD_AMOUNT_MIN, stepRecordAmount, type AmountFormat } from '../../copy/amount.ts';
import { parseInteger } from '../goals/goal-form.ts';
import './logs.css';

/**
 * やった量の確認・変更（R-03・R-04「DONEの量は既定で1回の量、変更可」）。デザインキャンバス D1-sheet・E2。
 * ±ボタンは1回の量に応じた刻みで増減し、数値の欄で細かく直せる。送る前に1以上の整数かを確かめる。
 */
export function AmountEditor({
  label,
  initial,
  sessionAmount,
  fmt,
  busy,
  onSubmit,
  onCancel,
  submitLabel = todayCopy.saveWithAmount,
  cancelLabel = todayCopy.back,
  onDraftChange,
}: {
  label: string;
  initial: number;
  sessionAmount: number;
  /** 量の書き方（記録は分か回の整数で入力する、P-18）。 */
  fmt: AmountFormat;
  busy: boolean;
  onSubmit: (amount: number) => void;
  onCancel: () => void;
  /** 主ボタンの文言（既定は「この量で記録」）。 */
  submitLabel?: string;
  cancelLabel?: string;
  /** 入力を試算へ渡すだけ。保存はonSubmitでのみ行う。不正・空欄はnull。 */
  onDraftChange?: (amount: number | null) => void;
}) {
  const id = useId();
  const editor = useRef<HTMLDivElement>(null);
  // 編集へ入った場所を知らせる。数値入力へ直ちに移してモバイルのキーボードを開かせない。
  useEffect(() => { editor.current?.focus(); }, []);
  const [text, setText] = useState(String(initial));
  const [error, setError] = useState<string | undefined>();
  const value = parseInteger(text);
  const valid = isRecordAmount(value);
  useEffect(() => { onDraftChange?.(valid ? value : null); }, [onDraftChange, valid, value]);
  const hasDifferentAmount = valid && value !== sessionAmount;
  // −／＋の刻み（1回の量に合わせたきりのよい幅。copy/amount.ts）
  const stepSize = fmt.recordStep(sessionAmount);
  const canDecrease = valid && stepRecordAmount(value, stepSize, -1) !== value;
  const minusRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  // 刻み1つ分だけ量を変える（↑↓キーとボタンの両方から使う）
  const step = (direction: -1 | 1) => {
    if (busy || !valid) return;
    // 同じevent batchの連打でも、前の更新後の入力値を基準にする。
    setText((previous) => {
      const current = parseInteger(previous);
      return isRecordAmount(current) ? String(stepRecordAmount(current, stepSize, direction)) : previous;
    });
    setError(undefined);
  };
  // ボタンで下限・上限に達して押せなくなるときは、先に反対側のボタンへフォーカスを移す（押せないボタンにフォーカスを残さない、#221）
  const stepByButton = (direction: -1 | 1) => {
    if (busy || !valid) return;
    const next = stepRecordAmount(value, stepSize, direction);
    const reachesLimit = direction === -1 ? stepRecordAmount(next, stepSize, -1) === next : next >= RECORD_AMOUNT_MAX;
    if (reachesLimit) (direction === -1 ? plusRef : minusRef).current?.focus();
    step(direction);
  };
  const submit = () => {
    if (busy) return;
    if (!valid) {
      setError(todayCopy.amountInvalid);
      return;
    }
    onSubmit(value);
  };
  const help = <p>{todayCopy.amountHelp(fmt.record(sessionAmount))}</p>;
  const aria = fieldAria(id, { help, error });

  return (
    <div className="fr-amount" ref={editor} role="group" aria-label={label} tabIndex={-1}>
      <div className="fr-amount__stepper">
        <IconButton ref={minusRef} icon="minus" label={`${todayCopy.amountDecrease}（${fmt.record(stepSize)}ずつ）`} disabled={busy || !canDecrease} onClick={() => stepByButton(-1)} />
        <Field id={id} label={label} error={error} help={help}>
          <NumberInput
            id={id}
            suffix={fmt.recordUnit}
            value={text}
            disabled={busy}
            invalid={Boolean(error)}
            role="spinbutton"
            aria-valuemin={RECORD_AMOUNT_MIN}
            aria-valuemax={RECORD_AMOUNT_MAX}
            aria-valuenow={valid ? value : undefined}
            aria-valuetext={valid ? fmt.record(value) : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || busy) return;
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                step(event.key === 'ArrowUp' ? 1 : -1);
              } else if (event.key === 'Enter' && !event.repeat) {
                event.preventDefault();
                submit();
              }
            }}
            {...aria}
            aria-describedby={hasDifferentAmount ? `${aria['aria-describedby']} ${id}-prediction-note` : aria['aria-describedby']}
          />
        </Field>
        <IconButton ref={plusRef} icon="plus" label={`${todayCopy.amountIncrease}（${fmt.record(stepSize)}ずつ）`} disabled={busy || !valid || value >= RECORD_AMOUNT_MAX} onClick={() => stepByButton(1)} />
      </div>
      {hasDifferentAmount ? <p id={`${id}-prediction-note`} className="fr-amount__prediction-note">{todayCopy.amountPredictionNote(fmt.record(sessionAmount))}</p> : null}
      <div className="fr-amount__actions">
        <Button variant="primary" busy={busy} onClick={submit}>
          {busy ? todayCopy.saving : submitLabel}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
