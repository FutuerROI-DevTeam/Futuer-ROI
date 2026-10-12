import { useState, type ReactNode } from 'react';
import { Field, NumberInput, fieldAria } from '../../../ui/components/FormField.tsx';
import { parseGoalAmount } from '../goal-form.ts';

export function timeParts(raw: string): [string, string] {
  if (raw.startsWith('@hm:')) {
    try {
      const p: unknown = JSON.parse(raw.slice(4));
      if (Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string') {
        return [p[0], p[1]];
      }
    } catch {
      // 不正なdraftは消さず時間側に残す。
    }
  }
  const n = parseGoalAmount(raw);
  return n !== null && Number.isFinite(n) ? [String(Math.floor(n / 60)), String(n % 60)] : [raw, '0'];
}

/** 入力文字列を親の既存draftへ保持する。表示形式の切替は量やAPI bodyを変えない。 */
export function TimeAmountField({ id, label, value, error, disabled, onChange, help }: {
  id: string;
  label: string;
  value: string;
  error?: string | undefined;
  disabled: boolean;
  onChange: (raw: string) => void;
  help?: ReactNode;
}) {
  const [mode, setMode] = useState<'minutes' | 'parts'>('parts');
  const parts = timeParts(value);
  const amount = parseGoalAmount(value);
  const canSwitch = value === '' || (amount !== null && Number.isFinite(amount));
  return <Field id={id} label={label} error={error} help={<>
    <p>時間は0以上の整数、分は0〜59。1分単位で保存します。</p>
    {!canSwitch && value !== '' ? <p>入力を直すと表示形式を切り替えられます。</p> : null}{help}
  </>}>
    <fieldset className="fr-time-mode" disabled={disabled} aria-label={`${label}の入力方式`}>
      <label><input type="radio" name={`${id}-mode`} checked={mode === 'parts'} disabled={!canSwitch && mode !== 'parts'} onChange={() => {
        if (canSwitch) {
          onChange(value === '' ? '' : String(amount));
          setMode('parts');
        }
      }} />時間＋分</label>
      <label><input type="radio" name={`${id}-mode`} checked={mode === 'minutes'} disabled={!canSwitch && mode !== 'minutes'} onChange={() => {
        if (canSwitch) {
          onChange(value === '' ? '' : String(amount));
          setMode('minutes');
        }
      }} />分だけ</label>
    </fieldset>
    {mode === 'minutes' ? <NumberInput id={id} suffix="分" value={value} disabled={disabled} invalid={Boolean(error)}
      onChange={e => onChange(e.target.value)} {...fieldAria(id, { help: true, error })} /> :
      <div className="fr-time-parts">
        <NumberInput id={id} suffix="時間" aria-label={`${label}の時間`} value={parts[0]} disabled={disabled} invalid={Boolean(error)}
          onChange={e => onChange('@hm:' + JSON.stringify([e.target.value, parts[1]]))} {...fieldAria(id, { help: true, error })} />
        <NumberInput id={`${id}-minutes`} suffix="分" aria-label={`${label}の分`} value={parts[1]} disabled={disabled} invalid={Boolean(error)}
          onChange={e => onChange('@hm:' + JSON.stringify([parts[0], e.target.value]))} {...fieldAria(id, { help: true, error })} />
      </div>}
  </Field>;
}
