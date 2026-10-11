import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { Spinner } from './Spinner.tsx';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> & {
  variant?: ButtonVariant;
  icon?: IconName;
  /** 送信中。押せなくし、読み込み中の印を出す。 */
  busy?: boolean;
  /** 横幅いっぱいに広げる。 */
  block?: boolean;
  /** フォーカスを移すときに使う（確認ダイアログの取り消しボタンなど）。 */
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
};

// 主ボタン（藍の塗り）は1画面に1つまで。Today Decision では使わない。削除だけ赤の塗り。
export function Button({ variant = 'secondary', icon, busy = false, block = false, disabled, type = 'button', children, ...rest }: Props) {
  return (
    <button
      {...rest}
      type={type}
      className={`fr-btn fr-btn--${variant}${block ? ' fr-btn--block' : ''}`}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'children'> & {
  icon: IconName;
  /** アイコンだけのボタンなので、読み上げる名前を必ず渡す。 */
  label: string;
  /** 境界で押せなくなる前に、反対側へフォーカスを移すために使う（#221）。 */
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ icon, label, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} className="fr-icon-btn" aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}
