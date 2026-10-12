import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Icon } from './Icon.tsx';
import './FormField.css';

/**
 * 入力欄の枠。ラベル・補足・項目ごとのエラーを同じ並びで出す。
 * 入力欄そのもの（TextInput など）は children に入れ、fieldAria(id, …) の戻り値を渡して説明とエラーを読み上げにつなぐ。
 */
export function Field({
  id,
  label,
  counter,
  help,
  error,
  group = false,
  children,
}: {
  id: string;
  label: string;
  counter?: string;
  help?: ReactNode;
  error?: string | undefined;
  /** 単位の切り替えなど、ボタンの集まりに付けるラベル（label 要素ではなく見出しとして出す）。 */
  group?: boolean;
  children: ReactNode;
}) {
  const head = (
    <>
      {label}
      {counter ? <span className="fr-field__counter">{counter}</span> : null}
    </>
  );
  return (
    <div className="fr-field">
      {group ? (
        <span className="fr-field__label" id={`${id}-label`}>
          {head}
        </span>
      ) : (
        <label className="fr-field__label" htmlFor={id}>
          {head}
        </label>
      )}
      {children}
      {error ? (
        <p className="fr-field__error" id={`${id}-error`}>
          <Icon name="alert" size={16} strokeWidth={2} />
          {error}
        </p>
      ) : null}
      {help ? (
        <div className="fr-field__help" id={`${id}-help`}>
          {help}
        </div>
      ) : null}
    </div>
  );
}

/** 入力欄に付ける読み上げ用の属性。エラーがあれば先に読む。 */
export function fieldAria(id: string, { help, error }: { help?: unknown; error?: string | undefined }) {
  const ids = [error ? `${id}-error` : null, help ? `${id}-help` : null].filter(Boolean).join(' ');
  return { 'aria-describedby': ids || undefined, 'aria-invalid': error ? true : undefined } as const;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'style'> & { invalid?: boolean };

export function TextInput({ invalid = false, ...rest }: InputProps) {
  return <input {...rest} className={`fr-input${invalid ? ' fr-input--invalid' : ''}`} />;
}

/** 数の入力欄。単位（分・回）を右端に出す。値は文字列のまま受け渡し、検査は画面側で行う。 */
export function NumberInput({ suffix, invalid = false, ...rest }: InputProps & { suffix: string }) {
  return (
    <div className="fr-inwrap">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={`fr-input fr-input--suffix${invalid ? ' fr-input--invalid' : ''}`}
      />
      <span className="fr-inwrap__suffix" aria-hidden="true">
        {suffix}
      </span>
    </div>
  );
}

export function SelectInput({
  invalid = false,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'style'> & { invalid?: boolean }) {
  return (
    <select {...rest} className={`fr-input fr-select${invalid ? ' fr-input--invalid' : ''}`}>
      {children}
    </select>
  );
}

/** 2〜3個から1つを選ぶ切り替え（単位など）。選んでいるボタンは aria-pressed で伝える。 */
export function SegmentedControl<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
  disabled = false,
}: {
  labelledBy: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fr-seg" role="group" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
