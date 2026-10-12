import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/components/Icon.tsx';
import { WIDE_LAYOUT_QUERY } from '../../ui/layout.ts';

/** 初期はdesktopで開く。利用者の開閉は、その後の幅変更でも上書きしない。 */
export function ResponsiveDetails({ summary, children, ariaLabel }: { summary: string; children: ReactNode; ariaLabel?: string }) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_LAYOUT_QUERY).matches);
  // 利用者が一度でも開閉したら、以後は幅の変化で開閉を上書きしない
  const chosenByUser = useRef(false);
  useEffect(() => {
    const media = window.matchMedia(WIDE_LAYOUT_QUERY);
    const sync = () => {
      if (!chosenByUser.current) {
        setOpen(media.matches);
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return (
    <details className="fr-today__detail" aria-label={ariaLabel} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary onClick={() => { chosenByUser.current = true; }}>{summary}<Icon name="chevronDown" size={16} /></summary>
      {children}
    </details>
  );
}
