import { Band } from '../../ui/components/Section.tsx';
import { ResponsiveDetails } from './ResponsiveDetails.tsx';
import { InsufficientNotice } from '../../ui/components/Notice.tsx';
import { recordDisplay, type AmountFormat } from '../../copy/amount.ts';
import { completionNoteFor, todayCopy } from '../../copy/today.ts';
import { useElementWidth } from '../../ui/useElementWidth.ts';
import { DEFAULT_CHART_WIDTH, outlookAxis } from './chart-geometry.ts';
import { shortDate, fullDate, parseLocalDate } from '../../copy/date.ts';
import { Icon } from '../../ui/components/Icon.tsx';
import { daysUntil, targetDateState, targetGap, targetGapText } from './target-gap.ts';
import type { CompletionPresentation, Plan } from '../prior/presentation-types.ts';

/** スマホの進捗近くへ置く同じ予測の要約。未保存量で再計算せず、日付の欠如も保持する。 */
export function CompletionBrief({ completion }: { completion: CompletionPresentation }) {
  return <p className="fr-completion-brief">{completion.kind === 'estimate'
    ? completion.p50Label ? todayCopy.completionBrief(completion.p50Label) : todayCopy.completionBriefOutside
    : todayCopy.completionBriefUnavailable}
    {completion.kind === 'estimate' ? <span>{' · '}{completion.p80Label ? todayCopy.completionP80(completion.p80Label) : todayCopy.completionP80Over3Years}</span> : null}
  </p>;
}

/** これからの見通し（補助指標2）。目安と「10回中8回」の日付を、実際の日付に比例した軸に置く。 */
export function OutlookPanel({
  completion,
  today,
  title,
  fmt,
  targetDate = null,
  sessionAmount,
  showDetails = true,
}: {
  completion: CompletionPresentation;
  today: string;
  title: string;
  fmt: AmountFormat;
  /** 到達予定日（#157、B案）。設定がなければ null で、A案と同じ表示。 */
  targetDate?: string | null;
  sessionAmount: number;
  showDetails?: boolean;
}) {
  return (
    <Band labelledBy="fr-outlook-title">
      <h2 id="fr-outlook-title" className="fr-outlook__title">
        {title}
      </h2>
      {/* 材料が足りないときも、到達予定日だけは出す（ずれは出さない） */}
      {targetDate ? <TargetDateRow today={today} targetDate={targetDate} /> : null}
      {completion.kind === 'estimate' ? (
        <Estimate completion={completion} today={today} targetDate={targetDate} session={recordDisplay(fmt, sessionAmount)} showDetails={showDetails} />
      ) : completion.kind === 'insufficient' ? (
        <InsufficientNotice>{completion.message}</InsufficientNotice>
      ) : (
        // 材料が足りないときの、設定量で行う場合の残り（R-11、デザインキャンバス R2・R4）。日数の予測ではない
        <PlanView plan={completion.plan} reason={completion.reason} fmt={fmt} />
      )}
    </Band>
  );
}

function Estimate({ completion, today, targetDate, session, showDetails }: { completion: Extract<CompletionPresentation, { kind: 'estimate' }>; today: string; targetDate: string | null; session: string; showDetails: boolean }) {
  const label = completion.scenario === 'TODAY_DONE' ? todayCopy.completionLabelTodayDone(session) : todayCopy.completionLabelCurrent(session);
  return (
    <>
      <div className="fr-outlook__estimate">
        <p className="fr-outlook__label">{label}</p>
        <p className="fr-outlook__p50">{completion.p50Label ? todayCopy.completionP50(completion.p50Label) : todayCopy.over3Years}</p>
        {targetDate ? <GapLine today={today} days={completion.p50Days} targetDate={targetDate} /> : null}
        <p className="fr-outlook__p80">{completion.p80Label ? todayCopy.completionP80(completion.p80Label) : todayCopy.completionP80Over3Years}</p>
        {targetDate ? <GapLine today={today} days={completion.p80Days} targetDate={targetDate} /> : null}
      </div>
      <p className="fr-note fr-outlook__assumption">{completion.scenario === 'TODAY_DONE' ? todayCopy.completionTodayAssumption(session) : todayCopy.completionAssumption(session)}</p>
      <EstimateNote completion={completion} />
      <SourceRows sources={completion.sources} />
      {showDetails ? <CompletionDetails completion={completion} today={today} targetDate={targetDate} /> : null}
    </>
  );
}

/** 予測の要約の後に配置する、既存データの詳細。 */
export function CompletionDetails({ completion, today, targetDate = null }: { completion: CompletionPresentation; today: string; targetDate?: string | null }) {
  if (completion.kind !== 'estimate') return null;
  return (
    <ResponsiveDetails summary={todayCopy.completionWhyTitle} ariaLabel={todayCopy.outlookLabel}>
      {completion.p50Days !== null ? (
        <AxisChart today={today} p50Days={completion.p50Days} p80Days={completion.p80Days} sameWeek={completion.p50Label === completion.p80Label} targetDate={targetDate} />
      ) : null}
      <p className="fr-note">
        {completionNoteFor(completion.sources)}
        {todayCopy.axisNote}
        {targetDate && targetDateState(today, targetDate) === 'ahead' ? todayCopy.targetGapNote : null}
      </p>
    </ResponsiveDetails>
  );
}

/** 到達予定日（#157、B案、デザイン B案 Today）。今日以前なら、ずれの行の代わりにこの行で1回だけ伝える（#186）。 */
function TargetDateRow({ today, targetDate }: { today: string; targetDate: string }) {
  const state = targetDateState(today, targetDate);
  return (
    <p className="fr-outlook__due">
      <span className="fr-outlook__due-label">
        <Icon name="flag" size={16} strokeWidth={2} />
        {todayCopy.targetDate}
      </span>
      <span className="fr-outlook__due-value">{fullDate(targetDate)}</span>
      {state === 'ahead' ? null : (
        <span className="fr-outlook__due-state">{state === 'past' ? todayCopy.targetDatePassed : todayCopy.targetDateToday}</span>
      )}
    </p>
  );
}

/** 目安・余裕をみるならの下の、到達予定日とのずれ。早い＝青緑、遅い＝琥珀。色だけでなく文字で伝える。 */
function GapLine({ today, days, targetDate }: { today: string; days: number | null; targetDate: string }) {
  const gap = targetGap(today, days, targetDate);
  if (!gap) return null;
  return (
    <p className={`fr-gap fr-gap--${gap.kind}`}>
      <Icon name="flag" size={16} strokeWidth={2} />
      <span>
        {gap.kind === 'near' ? null : todayCopy.targetGapPrefix}
        <b>{targetGapText(gap)}</b>
      </span>
    </p>
  );
}

/**
 * 日付が出ない・特別な場合の補足（デザインキャンバス D4・D4b・D8）。日数は Engine の値をそのまま見るだけで、計算しない。
 * - 目安が3年より先（p50 なし）：日付を出していない理由
 * - 10回中8回だけが3年より先（p80 なし）：その意味
 * - 今日やった場合に今週で届く（TODAY_DONE で p50 が 0 日）：今日やれば今週に届く
 */
function EstimateNote({ completion }: { completion: Extract<CompletionPresentation, { kind: 'estimate' }> }) {
  const note =
    completion.p50Days === null
      ? todayCopy.over3YearsNote
      : completion.p80Days === null
        ? todayCopy.p80Over3YearsNote
        : completion.scenario === 'TODAY_DONE' && completion.p50Days === 0
          ? todayCopy.thisWeekNote
          : null;
  return note ? <p className="fr-note">{note}</p> : null;
}

/**
 * 回答を使った見通しであること（R-11「回答由来と仮の値を明示する」）。どちらも記録だけなら出さない（記録だけのモードの表示を変えない）。
 * a／b 別の出所の2行は利用者に意味が伝わらなかったため、1文にまとめた（#221）。材料ごとの説明は「完了予測の根拠」に残る。
 */
function SourceRows({ sources }: { sources: Extract<CompletionPresentation, { kind: 'estimate' }>['sources'] }) {
  if (sources.a === 'RECORDS' && sources.b === 'RECORDS') return null;
  return (
    <div className="fr-sources">
      <p className="fr-note">{todayCopy.sourcesQuestionNote}</p>
    </div>
  );
}

function PlanView({ plan, reason, fmt }: { plan: Plan; reason: string; fmt: AmountFormat }) {
  // 残りは累計と同じ時間＋分、1回の量と最後の量は分で書く（P-18）
  return (
    <div className="fr-plan">
      <p className="fr-plan__title">{todayCopy.planTitle}</p>
      <p className="fr-plan__value">{todayCopy.planSessions(plan.sessions)}</p>
      <p className="fr-note">{todayCopy.planNote(fmt.total(plan.remainingAmount), recordDisplay(fmt, plan.sessionAmount), recordDisplay(fmt, plan.lastAmount))}</p>
      <InsufficientNotice>{reason}</InsufficientNotice>
    </div>
  );
}

/** 端に近いラベルは、図の外にはみ出さないよう寄せる向きを変える。 */
function labelAnchor(x: number, width: number, edge: number): 'start' | 'middle' | 'end' {
  if (x < edge) return 'start';
  if (x > width - edge) return 'end';
  return 'middle';
}

const AXIS_HEIGHT = 130;
/** 軸を省いた印（//）の、中心からの片側の幅（px）。 */
const CUT_GAP = 4;
// 図の縦の配置（px）。上から：到達予定日のラベル → 印のラベル → 印（点） → 軸 → 目盛りのラベル → 年のラベル
const TARGET_LABEL_Y = 12;
const TARGET_LINE_TOP_Y = 18;
const MARKER_DOT_Y = 58;
const MARKER_DOT_RADIUS = 7;
const MARKER_LINE_TOP_Y = 62;
const TODAY_MARK_TOP_Y = 84;
const AXIS_Y = 92;
const TICK_BOTTOM_Y = 97;
const TICK_LABEL_Y = 112;
const YEAR_LABEL_Y = 128;
/** 軸を省いた印（//）の斜線。軸をまたいで上下に伸ばし、横に少し傾ける。 */
const CUT_MARK_TOP_Y = 85;
const CUT_MARK_BOTTOM_Y = 99;
const CUT_MARK_SLANT = 3;
/** ラベルが図の端からはみ出さないよう、寄せる向きを変える幅（px）。年のラベルは短く、印のラベルは長い。 */
const YEAR_LABEL_EDGE = 24;
const MARKER_LABEL_EDGE = 60;

function AxisChart({ today, p50Days, p80Days, sameWeek, targetDate }: { today: string; p50Days: number; p80Days: number | null; sameWeek: boolean; targetDate: string | null }) {
  // 実際の幅で描く（縮めて表示すると文字まで小さくなるため）
  const [ref, width] = useElementWidth<HTMLDivElement>(DEFAULT_CHART_WIDTH);
  const axis = outlookAxis(today, p50Days, p80Days, sameWeek, width, targetDate ? daysUntil(today, targetDate) : null);
  const description =
    p80Days === null
      ? `日付の軸。目安の日付に印。${todayCopy.completionP80Over3Years}`
      : axis.sameWeek
        ? `日付の軸。目安も10回中8回の日付も同じ週です。`
        : `日付の軸。今日から目安の日付、10回中8回の日付の順に印。`;
  const label = axis.cut ? `${description}${todayCopy.targetDateAxisCut}` : description;
  return (
    <div ref={ref} className="fr-chart-box">
      <svg className="fr-chart" width={width} height={AXIS_HEIGHT} viewBox={`0 0 ${width} ${AXIS_HEIGHT}`} role="img" aria-label={label}>
        {axis.cut ? (
          <>
            {/* 到達予定日が大きく先なので、軸を途中で省く（#187）。ここから右は日付に比例しない */}
            <line x1={axis.axisLeft} y1={AXIS_Y} x2={axis.cut.x - CUT_GAP} y2={AXIS_Y} className="fr-chart__axis" />
            <line x1={axis.cut.x + CUT_GAP} y1={AXIS_Y} x2={axis.axisRight} y2={AXIS_Y} className="fr-chart__axis" />
            <line x1={axis.cut.x - CUT_GAP - CUT_MARK_SLANT} y1={CUT_MARK_BOTTOM_Y} x2={axis.cut.x - CUT_GAP + CUT_MARK_SLANT} y2={CUT_MARK_TOP_Y} className="fr-chart__axis" />
            <line x1={axis.cut.x + CUT_GAP - CUT_MARK_SLANT} y1={CUT_MARK_BOTTOM_Y} x2={axis.cut.x + CUT_GAP + CUT_MARK_SLANT} y2={CUT_MARK_TOP_Y} className="fr-chart__axis" />
          </>
        ) : (
          <line x1={axis.axisLeft} y1={AXIS_Y} x2={axis.axisRight} y2={AXIS_Y} className="fr-chart__axis" />
        )}
        {axis.ticks.map((tick) => (
          <g key={`${tick.label}-${tick.x}`}>
            <line x1={tick.x} y1={AXIS_Y} x2={tick.x} y2={TICK_BOTTOM_Y} className="fr-chart__axis" />
            <text x={tick.x} y={TICK_LABEL_Y} textAnchor="middle" className="fr-chart__text">
              {tick.label}
            </text>
            {tick.yearLabel ? (
              <text x={tick.x} y={YEAR_LABEL_Y} textAnchor={labelAnchor(tick.x, width, YEAR_LABEL_EDGE)} className="fr-chart__text">
                {tick.yearLabel}
              </text>
            ) : null}
          </g>
        ))}
        <line x1={axis.axisLeft} y1={TODAY_MARK_TOP_Y} x2={axis.axisLeft} y2={TICK_BOTTOM_Y} className="fr-chart__today" />
        <text x={axis.axisLeft} y={TICK_LABEL_Y} textAnchor="start" className="fr-chart__text fr-chart__text--strong">
          今日
        </text>
        {axis.markers.map((marker) => (
          <g key={marker.kind}>
            <line x1={marker.x} y1={MARKER_LINE_TOP_Y} x2={marker.x} y2={AXIS_Y} className="fr-chart__marker-line" />
            {/* 塗り＝目安、白抜き＝10回中8回（色だけに頼らない） */}
            <circle cx={marker.x} cy={MARKER_DOT_Y} r={MARKER_DOT_RADIUS} className={marker.kind === 'p50' ? 'fr-chart__dot' : 'fr-chart__dot fr-chart__dot--open'} />
            <text x={marker.x} y={marker.labelY} textAnchor={labelAnchor(marker.x, width, MARKER_LABEL_EDGE)} className="fr-chart__text">
              {marker.kind === 'p50' ? (axis.sameWeek ? '目安・10回中8回' : '目安') : '10回中8回'}
            </text>
          </g>
        ))}
        {/* 到達予定日（#157、B案）。破線で示す */}
        {axis.target && targetDate ? (
          <g>
            <line x1={axis.target.x} y1={TARGET_LINE_TOP_Y} x2={axis.target.x} y2={AXIS_Y} className="fr-chart__due" />
            <text x={axis.target.x} y={TARGET_LABEL_Y} textAnchor={labelAnchor(axis.target.x, width, MARKER_LABEL_EDGE)} className="fr-chart__text fr-chart__text--strong">
              {/* 軸を省いたときは位置から遠さが読めないので、年まで書く（#187） */}
              {todayCopy.targetDateAxis(axis.cut ? fullDate(targetDate) : shortDate(parseLocalDate(targetDate)))}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
