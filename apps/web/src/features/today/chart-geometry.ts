// Engine の日数と保存済み実績を、実表示幅（px）の座標へ変換する。
// viewBox で縮めると文字まで小さくなるため、実際の幅で計算する。
import type { Log } from '@contracts';
import { addDays, DAY_MS, daysBetween, parseLocalDate, shortDate } from '../../copy/date.ts';

/** 幅を測れるまでの仮の幅（デザインの基準幅）。 */
export const DEFAULT_CHART_WIDTH = 350;

/** 1か月の平均日数（365.25 ÷ 12）。目盛りの間隔を px に直すときの目安。 */
const DAYS_PER_MONTH = 30.44;

// ---- これからの見通し：今日から余裕をみた日付までを、実際の日付に比例した軸に置く（デザイン案5） ----

export interface AxisMarker {
  x: number;
  kind: 'p50' | 'p80';
  /** ラベルの縦位置。近い2つの印はラベルをずらして重ならないようにする。 */
  labelY: number;
}
export interface AxisTick {
  x: number;
  label: string;
  yearLabel: string | null;
}
export interface OutlookAxis {
  markers: AxisMarker[];
  ticks: AxisTick[];
  /** 目安と「10回中8回」が同じ週か（同じ週なら印を1つにまとめる）。 */
  sameWeek: boolean;
  axisLeft: number;
  axisRight: number;
  /** 到達予定日の位置（#157、B案）。設定がない・今日以前なら null。 */
  target: { x: number } | null;
  /**
   * 到達予定日が見通しより大きく先のとき、軸を途中で省いた位置（#187、案C）。省かないなら null。
   * この位置より右は日付に比例しない。
   */
  cut: { x: number } | null;
}

/** 印のラベル同士が重なる横の距離（px）。 */
const LABEL_GAP = 56;
/** 目盛りのラベル（「12月」など）同士、また「今日」との間に必要な横の距離（px）。 */
const TICK_GAP = 34;

/** 目盛りの間隔の候補（か月）。 */
const MONTH_STEPS = [1, 2, 3, 6, 12] as const;

const AXIS_LEFT = 20;
const AXIS_RIGHT_PAD = 16;
/** 軸に出す最短の期間（日）。短い見通しでも3週間分は見せる。 */
const MIN_SPAN_DAYS = 21;
/** 一番遠い印の右に取る余白（倍率と日数）。印が右端に張り付かないようにする。 */
const SPAN_MARGIN_RATIO = 1.15;
const SPAN_MARGIN_DAYS = 7;
/** 印のラベルの縦位置（px）。近い2つの印は、2つ目を上にずらして重ならないようにする。 */
const MARKER_LABEL_Y = 38;
const MARKER_LABEL_RAISED_Y = 20;
/**
 * 到達予定日が「10回中8回（なければ目安）」のこの倍数より先なら、軸を途中で省いて右端に置く（#187、案C）。
 * 比例のまま伸ばすと、印が「今日」に詰まって見分けられなくなるため。遠さは印の下のずれの文言で伝わる。
 */
const CUT_RATIO = 3;
/** 省いた位置から右端（到達予定日）までの幅（px）。省いた印（//）を置く。 */
const CUT_WIDTH = 40;
/**
 * 省いたとき、印をこれより右端に寄せない幅（px）。右端の「到達予定日 2029年12月31日」（11pxで約130px）と、
 * 印のラベルの半分（「目安・10回中8回」で約40px）が重ならない幅。
 */
const CUT_LABEL_RESERVE = 170;

export function outlookAxis(
  today: string,
  p50Days: number,
  p80Days: number | null,
  sameWeek: boolean,
  width: number,
  targetDays: number | null = null,
): OutlookAxis {
  const axisRight = width - AXIS_RIGHT_PAD;
  const target = targetDays !== null && targetDays > 0 ? targetDays : null;
  const outlook = p80Days ?? p50Days;
  // 遠い到達予定日は右端に置き、その手前で比例軸を省く。
  const cut = target !== null && target > outlook * CUT_RATIO;
  const plotRight = cut ? axisRight - CUT_WIDTH : axisRight;
  const last = cut ? outlook : Math.max(outlook, target ?? 0);
  // 短い期間でも3週間分を表示する。軸を省く場合は右端ラベルとの重なりも防ぐ。
  const markerRoom = axisRight - CUT_LABEL_RESERVE - AXIS_LEFT;
  const span = Math.max(
    MIN_SPAN_DAYS,
    Math.ceil(last * SPAN_MARGIN_RATIO) + SPAN_MARGIN_DAYS,
    cut && markerRoom > 0 ? Math.ceil((outlook * (plotRight - AXIS_LEFT)) / markerRoom) : 0,
  );
  const x = (days: number) => AXIS_LEFT + ((plotRight - AXIS_LEFT) * days) / span;

  const markers: AxisMarker[] = [{ x: x(p50Days), kind: 'p50', labelY: MARKER_LABEL_Y }];
  if (p80Days !== null && !sameWeek) {
    const p80x = x(p80Days);
    const close = p80x - x(p50Days) < LABEL_GAP;
    markers.push({ x: p80x, kind: 'p80', labelY: close ? MARKER_LABEL_RAISED_Y : MARKER_LABEL_Y });
  }

  // 月の初日に目盛りを置く。間隔は 1・2・3・6・12か月から、ラベルが重ならない一番細かいものを選び、
  // 暦にそろえる（3か月おきなら1・4・7・10月）。「今日」に近すぎる目盛りは出さない
  const start = parseLocalDate(today);
  const pxPerMonth = ((plotRight - AXIS_LEFT) * DAYS_PER_MONTH) / span;
  const step = MONTH_STEPS.find((months) => months * pxPerMonth >= TICK_GAP) ?? 12;
  const ticks: AxisTick[] = [];
  let lastYear = start.getUTCFullYear();
  for (let monthsAhead = 1; ; monthsAhead += 1) {
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsAhead, 1));
    const days = Math.round((first.getTime() - start.getTime()) / DAY_MS);
    // cutのラベル余白でspanがtargetを越えても、右端より未来の月をその左に置かない。
    if (days > span || (cut && target !== null && days >= target)) {
      break;
    }
    if (first.getUTCMonth() % step !== 0) continue;
    const tickX = x(days);
    if (tickX - AXIS_LEFT < TICK_GAP) continue;
    const year = first.getUTCFullYear();
    ticks.push({
      x: tickX,
      label: `${first.getUTCMonth() + 1}月`,
      yearLabel: year !== lastYear ? `${year}年` : null,
    });
    lastYear = year;
  }
  return {
    markers,
    ticks,
    sameWeek,
    axisLeft: AXIS_LEFT,
    axisRight,
    target: target === null ? null : { x: cut ? axisRight : x(target) },
    cut: cut ? { x: plotRight + CUT_WIDTH / 2 } : null,
  };
}

// ---- これまでの積み上げ：記録開始日から今日までの累計（初期量＋DONE の量） ----

export interface PlotBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CumulativeChart {
  points: { x: number; y: number }[];
  targetY: number | null;
  maxValue: number;
  singleDay: boolean;
  zeroY: number;
  gridLines: { y: number; value: number }[];
  startLabel: string;
  todayLabel: string;
  last: number;
  bounds: PlotBounds;
}

const PLOT_LEFT = 56;
const PLOT_RIGHT_PAD = 14;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 200;
/** 縦軸の上端は実績の1.1倍にして、線が図の天井に張り付かないようにする。 */
const ACTUAL_HEADROOM_RATIO = 1.1;
/** 目盛りの本数の目安。実績の範囲をこの数で割って、きりのよい刻みを選ぶ。 */
const GRID_LINE_COUNT = 4;
/** きりのよい刻みの候補（×10のべき乗）。 */
const NICE_STEPS = [1, 2, 5, 10] as const;

export function cumulativeChart(
  logs: Log[],
  initialProgress: number,
  total: number,
  recordStartDate: string,
  today: string,
  width: number,
  /** 目盛りの値をそろえる刻み（分のGoalは60分＝1時間刻みにして、目盛りを整数の時間にする。P-18）。 */
  gridUnit = 1,
): CumulativeChart {
  const bounds: PlotBounds = {
    left: PLOT_LEFT,
    right: width - PLOT_RIGHT_PAD,
    top: PLOT_TOP,
    bottom: PLOT_BOTTOM,
  };
  const days = Math.max(0, daysBetween(recordStartDate, today));
  const doneByDate = new Map(logs
    .filter((log) => log.status === 'DONE')
    .map((log) => [log.localDate, log.amount ?? 0]));
  const actual = initialProgress + logs
    .filter(log => log.status === 'DONE' && log.localDate >= recordStartDate && log.localDate <= today)
    .reduce((sum, log) => sum + (log.amount ?? 0), 0);
  // 実績の範囲だけでniceな目盛りを決める。遠い総量で実績を潰さず、超過した実績も切り落とさない。
  const rawStep = Math.max(gridUnit, actual * ACTUAL_HEADROOM_RATIO / GRID_LINE_COUNT);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const nice = NICE_STEPS.find(candidate => candidate * magnitude >= rawStep) ?? 10;
  const step = Math.max(gridUnit, Math.ceil(nice * magnitude / gridUnit) * gridUnit);
  const maxValue = Math.max(step, Math.ceil(actual * ACTUAL_HEADROOM_RATIO / step) * step);
  const y = (value: number) => bounds.bottom - ((bounds.bottom - bounds.top) * value) / maxValue;
  const xAt = (dayIndex: number) => days === 0
    ? (bounds.left + bounds.right) / 2
    : bounds.left + ((bounds.right - bounds.left) * dayIndex) / days;

  const points: { x: number; y: number }[] = [];
  let sum = initialProgress;
  for (let dayIndex = 0; dayIndex <= days; dayIndex += 1) {
    const date = addDays(recordStartDate, dayIndex).toISOString().slice(0, 10);
    sum += doneByDate.get(date) ?? 0;
    points.push({ x: xAt(dayIndex), y: y(sum) });
  }
  const gridLines = Array.from({ length: Math.round(maxValue / step) }, (_, i) => ({
    value: (i + 1) * step,
    y: y((i + 1) * step),
  }));
  return {
    points,
    targetY: total <= maxValue ? y(total) : null,
    maxValue,
    singleDay: days === 0,
    zeroY: bounds.bottom,
    gridLines,
    startLabel: shortDate(parseLocalDate(recordStartDate)),
    todayLabel: shortDate(parseLocalDate(today)),
    last: sum,
    bounds,
  };
}
