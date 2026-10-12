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

/** 通信・保存のエラー（琥珀の面＋切断アイコン）。「記録が足りない」と取り違えないよう、データ不足とは別の見た目にする。 */
export function ErrorPanel({ title, children, action, focusTitle = false }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** 表示時に見出しへフォーカスを移す。押したボタンがこのパネルに置き換わる場面（保存の失敗）で、フォーカスが body に落ちないようにする（#277）。 */
  focusTitle?: boolean;
}) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (focusTitle) titleRef.current?.focus(); }, [focusTitle]);
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
