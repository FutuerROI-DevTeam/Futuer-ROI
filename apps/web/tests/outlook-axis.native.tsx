import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import type { Root } from 'react-dom/client';
import { CompletionDetails } from '../src/features/today/OutlookPanel.tsx';
import { addDays, weekLabel } from '../src/copy/date.ts';
import tokens from '../src/ui/tokens.css?inline';
import todayStyles from '../src/features/today/today.css?inline';
import font400 from '@fontsource/zen-maru-gothic/400.css?inline';
import font700 from '@fontsource/zen-maru-gothic/700.css?inline';

// 実部品・実測幅・製品の11px書体。CSSはこの追加回帰をmountするときだけ読み、既存nativeケースを変えない。
export function mountOutlook(root: Root, today: string, p50: number | null, p80: number | null, targetDays: number, width: number) {
  if (!document.getElementById('axis-test-styles')) {
    const style = document.createElement('style');
    style.id = 'axis-test-styles';
    style.textContent = font400 + font700 + tokens + todayStyles;
    document.head.append(style);
  }
  flushSync(() => root.render(<StrictMode><div className="fr" style={{ width: width + 32 }}>
    <CompletionDetails today={today} targetDate={addDays(today, targetDays).toISOString().slice(0, 10)}
      completion={{ kind: 'estimate', scenario: 'TODAY_DONE', sources: { a: 'RECORDS', b: 'RECORDS' },
        p50Days: p50, p80Days: p80, p50Label: weekLabel(today, p50), p80Label: weekLabel(today, p80) }} />
  </div></StrictMode>));
  const details = document.querySelector<HTMLDetailsElement>('#app details');
  if (details) details.open = true;
  const box = document.querySelector<HTMLElement>('#app .fr-chart-box');
  if (box) box.style.width = `${width}px`;
}

export async function outlookState() {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const svg = document.querySelector<SVGSVGElement>('#app svg.fr-chart');
  if (!svg) return { width: null, texts: [], ticks: [], markers: [], target: null, cut: false };
  const frame = svg.closest('.fr')!.getBoundingClientRect();
  const texts = [...svg.querySelectorAll('text')].map(text => {
    const box = text.getBBox();
    const painted = text.getBoundingClientRect();
    return { label: text.textContent, x: box.x, y: box.y, width: box.width, height: box.height,
      paintedTop: painted.top - frame.top, paintedBottom: painted.bottom - frame.top,
      font: getComputedStyle(text).fontFamily, size: getComputedStyle(text).fontSize };
  });
  const ticks = [...svg.querySelectorAll('g')].filter(group => group.querySelector('line[y2="97"]')).map(group => {
    const labels = group.querySelectorAll('text');
    return { x: Number(labels[0].getAttribute('x')), label: labels[0].textContent, year: labels[1]?.textContent ?? null };
  });
  return { width: Number(svg.getAttribute('width')), frameHeight: frame.height, visible: svg.checkVisibility(), texts, ticks,
    markers: [...svg.querySelectorAll('line.fr-chart__marker-line')].map(line => Number(line.getAttribute('x1'))),
    target: svg.querySelector('line.fr-chart__due') ? Number(svg.querySelector('line.fr-chart__due')!.getAttribute('x1')) : null,
    cut: !!svg.querySelector('line[y1="99"]'),
    fontLoaded: [...document.fonts].some(face => face.family.includes('Zen Maru Gothic') && face.status === 'loaded') &&
      document.fonts.check('11px "Zen Maru Gothic"', '今日目安10回中8回到達予定日年月') };
}
