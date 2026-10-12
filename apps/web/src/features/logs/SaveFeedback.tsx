import { amountFormat, recordDisplay } from '../../copy/amount.ts';
import type { SaveFeedback as Feedback } from './save-feedback.ts';

/** 前回の表示との比較を一度だけ通知する。今回のPUTの原子的差分とは表現しない。 */
export function SaveFeedback({ value }: { value: Feedback | null }) {
  const sign = value && value.amount < 0 ? '−' : '+';
  return <div className="fr-save-feedback" role="status" aria-live="polite" aria-atomic="true">
    {value ? <p key={value.sequence} className={value.amount > 0 ? 'fr-save-feedback__increase' : undefined}>
      <span>保存前の表示との差</span>
      {sign}{recordDisplay(amountFormat(value), Math.abs(value.amount))}
      <span>目標進捗 {sign}{Math.abs(value.points).toLocaleString('ja-JP', { maximumSignificantDigits: 3 })}パーセントポイント</span>
    </p> : null}
  </div>;
}
