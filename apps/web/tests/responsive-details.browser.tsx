import { StrictMode, useState } from 'react';
import { YesterdayDetails } from '../src/features/today/YesterdayDetails.tsx';
import { RecordChoiceBar } from '../src/features/logs/RecordChoiceBar.tsx';
import { todayCopy } from '../src/copy/today.ts';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ResponsiveDetails } from '../src/features/today/ResponsiveDetails.tsx';
import { ProgressSummary } from '../src/features/today/ProgressSummary.tsx';
import { amountFormat } from '../src/copy/amount.ts';
import { mountYesterdayCorrection, yesterdayCorrectionState } from './yesterday-correction.native.tsx';
import { mountOutlook, outlookState } from './outlook-axis.native.tsx';

// 実コンポーネントをStrictModeで描画。viewport・trusted入力は外側の実Chrome/CDPが担当する。
// API/予測契約はmockせず、ProgressSummaryには実量だけを渡す。
const host = document.getElementById('app')!;
const root = createRoot(host);
let generation = 0;
const inputs: { type: string; key: string | null; trusted: boolean }[] = [];
for (const type of ['click', 'keydown', 'keyup']) {
  document.addEventListener(type, (event) => {
    if (event.target instanceof Element && event.target.closest('summary')) {
      inputs.push({ type, key: event instanceof KeyboardEvent ? event.key : null, trusted: event.isTrusted });
    }
  });
}
function mountDetails() {
  inputs.length = 0;
  flushSync(() => root.render(
    <StrictMode><ResponsiveDetails key={++generation} summary="詳細を開閉" ariaLabel="回帰テスト詳細">
      <p data-testid="details-content">開いているときだけ表示される内容</p>
    </ResponsiveDetails></StrictMode>,
  ));
}
function mountProgress(unit: 'minutes' | 'sessions', done: number, total: number) {
  flushSync(() => root.render(
    <StrictMode><ProgressSummary key={++generation} progress={{ unit, done, total }}
      initialProgress={done} logs={[]} recordStartDate="2026-10-10" today="2026-10-10"
      fmt={amountFormat({ unit })} /></StrictMode>,
  ));
}
function DockFixture() {
  const [editing, setEditing] = useState(false);
  const saver = { isSaving: false, failure: null, isStaleDate: () => false, save: () => { throw Error('native focus test must not save'); } } as any;
  return <RecordChoiceBar today="2026-10-10" sessionAmount={20} fmt={amountFormat({ unit: 'minutes' })} saver={saver} editingAmount={editing} onEditingAmountChange={setEditing} onRefresh={() => {}} />;
}
function mountDock() { flushSync(() => root.render(<DockFixture key={++generation} />)); }
function mountYesterday(reveal: unknown = false, remount = false) {
  if (remount) generation++;
  flushSync(() => root.render(<YesterdayDetails key={generation} reveal={reveal}>
    <summary>昨日の記録</summary><p data-testid="details-content">{reveal === 'failed' ? '保存できませんでした' : '昨日を記録する'}</p>
  </YesterdayDetails>));
}
function view() {
  const details = host.querySelector('details');
  const content = host.querySelector('[data-testid="details-content"]');
  return {
    ...yesterdayCorrectionState(host),
    focused: { tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'), name: document.activeElement?.getAttribute('aria-label'), text: document.activeElement?.textContent?.trim().slice(0, 300) },
    width: window.innerWidth, desktop: window.matchMedia('(min-width: 960px)').matches,
    // closed detailsは矩形が残り得るため、UAのcontent-visibilityを含む実際の可視性を読む。
    open: details?.open, contentVisible: !!content && content.checkVisibility(),
    focusedSummary: document.activeElement === details?.querySelector('summary'), inputs: [...inputs],
    amount: host.querySelector('.fr-progress__amount')?.textContent,
    percent: host.querySelector('.fr-progress__percent')?.textContent?.replace(/\s/g, ''),
    ariaPercent: host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    balances: Object.fromEntries([...host.querySelectorAll('.fr-progress__balance > div')].map(row => [
      row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent,
    ])),
  };
}
(globalThis as any).__responsiveFixture = { mountDetails, mountProgress, mountDock, mountYesterday, mountCorrection: (status: 'DONE' | 'SKIPPED') => mountYesterdayCorrection(root, status),
  mountOutlook: (today: string, p50: number | null, p80: number | null, targetDays: number, width: number) => mountOutlook(root, today, p50, p80, targetDays, width), outlookState, view };
mountDetails();
