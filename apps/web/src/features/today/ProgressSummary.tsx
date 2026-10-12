import type { ReactNode } from 'react';
import type { Log } from '@contracts';
import { Section, SectionLabel } from '../../ui/components/Section.tsx';
import type { AmountFormat } from '../../copy/amount.ts';
import { todayCopy } from '../../copy/today.ts';
import { useElementWidth } from '../../ui/useElementWidth.ts';
import { cumulativeChart, DEFAULT_CHART_WIDTH } from './chart-geometry.ts';

const CUMULATIVE_HEIGHT = 250;
import type { ActualProgress } from '../prior/presentation-types.ts';
import { progressPercent, progressPercentLabel } from '../../copy/progress.ts';
import type { DraftProgress } from '../logs/draft-preview.ts';
import { DraftProgressPreview } from './DraftProgressPreview.tsx';

interface Props {
  progress: ActualProgress;
  initialProgress: number;
  logs: Log[];
  recordStartDate: string;
  today: string;
  /** 量の書き方（分のGoalは累計・総量を時間＋分で出す、P-18）。 */
  fmt: AmountFormat;
  showDetails?: boolean;
  brief?: ReactNode;
  preview?: DraftProgress | null;
}

/** これまでの積み上げ。％は進捗だけに使い、累計は記録開始日〜今日の範囲で描く（今日より先の線は引かない）。 */
export function ProgressSummary({ progress, initialProgress, logs, recordStartDate, today, fmt, showDetails = true, brief, preview = null }: Props) {
  const percent = progressPercent(progress.done, progress.total);
  return (
    <Section labelledBy="fr-progress-title">
      <div className="fr-progress__header">
        <SectionLabel as="h2" id="fr-progress-title">
          {todayCopy.progressLabel}
        </SectionLabel>
        {brief}
      </div>
      <div className="fr-progress">
        <p className="fr-progress__percent">
          {progressPercentLabel(progress.done, progress.total)}
          <small>%</small>
        </p>
        <p className="fr-progress__amount">
          {todayCopy.progressActual(fmt.total(progress.done))}
        </p>
      </div>
      <DraftProgressPreview value={preview} />
      <dl className="fr-progress__balance">
        <div><dt>{todayCopy.progressGoal}</dt><dd>{fmt.total(progress.total)}</dd></div>
        <div><dt>{todayCopy.progressRemaining}</dt><dd>{fmt.total(Math.max(0, progress.total - progress.done))}</dd></div>
        {progress.done > progress.total ? <div><dt>{todayCopy.progressExcess}</dt><dd>{fmt.total(progress.done - progress.total)}</dd></div> : null}
      </dl>
      <div className="fr-progress-track" role="progressbar" aria-labelledby="fr-progress-title" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: String(percent) + '%' }} />
      </div>
      {showDetails ? <ProgressDetails progress={progress} initialProgress={initialProgress} logs={logs} recordStartDate={recordStartDate} today={today} fmt={fmt} /> : null}
    </Section>
  );
}

export function ProgressDetails({ progress, initialProgress, logs, recordStartDate, today, fmt }: Props) {
  return (
    <section className="fr-today__history-chart" aria-labelledby="fr-cumulative-title">
      <h2 id="fr-cumulative-title">積み上げ推移</h2>
      <p className="fr-note">表示期間：{recordStartDate}〜{today}</p>
      <p className="fr-note">{todayCopy.progressHelp(initialProgress > 0 ? fmt.total(initialProgress) : null)}</p>
      <CumulativeChartView logs={logs} initialProgress={initialProgress} total={progress.total} recordStartDate={recordStartDate} today={today} fmt={fmt} done={progress.done} />
    </section>
  );
}

function CumulativeChartView({
  logs,
  initialProgress,
  total,
  recordStartDate,
  today,
  fmt,
  done,
}: {
  logs: Log[];
  initialProgress: number;
  total: number;
  recordStartDate: string;
  today: string;
  fmt: AmountFormat;
  done: number;
}) {
  const axis = fmt.axis(done);
  // 実際の幅で描く（縮めて表示すると文字まで小さくなるため）
  const [ref, width] = useElementWidth<HTMLDivElement>(DEFAULT_CHART_WIDTH);
  // 分のGoalは、目盛りを1時間刻みにそろえる（P-18）
  const c = cumulativeChart(logs, initialProgress, total, recordStartDate, today, width, axis.gridUnit);
  const b = c.bounds;
  const line = c.points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${b.left},${c.zeroY} ${line} ${b.right},${c.zeroY}`;
  const lastPoint = c.points[c.points.length - 1];
  return (
    <div ref={ref} className="fr-chart-box">
    <p className="fr-note">表示範囲：0〜{fmt.total(c.maxValue)}{c.targetY === null ? '（目標量は範囲外）' : ''}</p>
    <svg className="fr-chart" width={width} height={CUMULATIVE_HEIGHT} viewBox={`0 0 ${width} ${CUMULATIVE_HEIGHT}`} role="img" aria-label={`記録開始日から今日までの累計。今日 ${fmt.total(done)}。目標は${fmt.total(total)}`}>
      <text x="50" y="16" textAnchor="end" className="fr-chart__text">
        {axis.unit}
      </text>
      {c.targetY !== null ? <><line x1={b.left} y1={c.targetY} x2={b.right} y2={c.targetY} className="fr-chart__target" />
      <text x={b.right} y={c.targetY - 8} textAnchor="end" className="fr-chart__text">
        目標 {fmt.total(total)}
      </text></> : null}
      {c.gridLines.map((g) => (
        <g key={g.value}>
          <line x1={b.left} y1={g.y} x2={b.right} y2={g.y} className="fr-chart__grid" />
          <text x="50" y={g.y + 4} textAnchor="end" className="fr-chart__text">
            {axis.label(g.value)}
          </text>
        </g>
      ))}
      <line x1={b.left} y1={c.zeroY} x2={b.right} y2={c.zeroY} className="fr-chart__axis" />
      <text x="50" y={c.zeroY + 4} textAnchor="end" className="fr-chart__text">
        0
      </text>
      {!c.singleDay ? <><polygon points={area} className="fr-chart__area" />
      <polyline points={line} className="fr-chart__line" /></> : null}
      {lastPoint ? <circle cx={lastPoint.x} cy={lastPoint.y} r="5" className="fr-chart__now" /> : null}
      {!c.singleDay ? <><text x={b.left} y="218" textAnchor="start" className="fr-chart__text">
        {c.startLabel}
      </text></> : null}
      {!c.singleDay ? <text x={b.left} y="234" textAnchor="start" className="fr-chart__text">
        記録開始
      </text> : null}
      <text x={b.right} y="218" textAnchor="end" className="fr-chart__text">
        {c.todayLabel}
      </text>
      <text x={b.right} y="234" textAnchor="end" className="fr-chart__text">
        {c.singleDay ? '記録開始・今日' : '今日'}
      </text>
    </svg>
    </div>
  );
}
