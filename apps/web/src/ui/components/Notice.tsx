import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import './Notice.css';

/** データ不足・お知らせ（破線＋情報アイコン）。エラーとは見た目を分ける。 */
export function InsufficientNotice({ title, children, role }: { title?: string; children: ReactNode; role?: 'status' }) {
  return (
    <div className="fr-insuf" role={role}>
      <Icon name="info" size={20} />
      <div className="fr-insuf__body">
        {title ? <p className="fr-insuf__title">{title}</p> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

/** 通信・保存のエラー。データ不足と取り違えないよう、琥珀の面と切断アイコンで示す。 */
export function ErrorPanel({ title, children, action, focusTitle = false }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** 保存ボタンがパネルに置き換わるとき、bodyへ落ちるフォーカスを見出しで受ける（#277）。 */
  focusTitle?: boolean;
}) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (focusTitle) {
      titleRef.current?.focus();
    }
  }, [focusTitle]);
  return (
    <section className="fr-error" role="alert">
      <p className="fr-error__title" tabIndex={focusTitle ? -1 : undefined} ref={titleRef}>
        <Icon name="offline" />
        {title}
      </p>
      <p>{children}</p>
      {action ?? null}
    </section>
  );
}
