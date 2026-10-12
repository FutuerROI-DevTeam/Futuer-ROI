import { useEffect, useState, type ReactNode } from 'react';

/** 普段は畳み、保存の開始・失敗は日付ごとに必ず見える状態にする。 */
export function YesterdayDetails({ reveal, children }: { reveal: unknown; children: ReactNode }) {
  const [open, setOpen] = useState(!!reveal);
  useEffect(() => {
    if (reveal) {
      setOpen(true);
    }
  }, [reveal]);
  return <details className="fr-today__yesterday" open={open} onToggle={event => setOpen(event.currentTarget.open)}>{children}</details>;
}
