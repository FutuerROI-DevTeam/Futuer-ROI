import type { GoalUnit } from '@contracts';

/*
 * 量の書き方（Product Spec P-18「整数分を保った時間＋分表示」、#121・#157）。
 * 量はAPI・Engine・入力とも分（回のGoalは回）の整数のまま扱い、ここで画面に出す文字にするだけ。
 * - 分のGoal：累計・総量・残量は正確な「時間＋分」（1240分 → 20時間40分）。小数へ丸めない（1分の差を隠さない）
 *   1回量・日々の記録は分のまま。累計・総量と混同しない（P-23）
 * - 回のGoal：すべて回
 * 表示の文字から量を逆算しない。FEで予測の数値は計算しない。
 */

export type AmountGoal = { unit: GoalUnit };

const MINUTES_PER_HOUR = 60;

// LogPutのDONE量と同じ整数範囲。ステッパーも分・回の元の値を保つ。
export const RECORD_AMOUNT_MIN = 1;
export const RECORD_AMOUNT_MAX = 2_147_483_647;

export function isRecordAmount(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= RECORD_AMOUNT_MIN && value <= RECORD_AMOUNT_MAX;
}

/**
 * −／＋を1回押したときの刻み（#199、依頼者判断でD1-sheet/E2の「1回の量ずつ」から変更）。
 * 1回の量に合わせたきりのよい幅にし、およそ4回押すと1回分増える。
 * - 分のGoal：1回の量が30分まで5分、90分まで15分、それより大きければ30分
 * - 回のGoal：1回の量が10回まで1回、50回まで5回、それより大きければ10回
 */
export function recordStep(unit: GoalUnit, sessionAmount: number): number {
  if (unit === 'sessions') return sessionAmount <= 10 ? 1 : sessionAmount <= 50 ? 5 : 10;
  return sessionAmount <= 30 ? 5 : sessionAmount <= 90 ? 15 : 30;
}

/**
 * 量を刻み1つ分だけ増減する。刻みの倍数にそろえ（23分で＋なら25分）、刻み1つ分より下には減らさない。
 * 減らせない・増やせないときは元の値を返す（呼び出し側はボタンを押せなくする）。保存や予測計算は行わない。
 */
export function stepRecordAmount(value: number, step: number, direction: -1 | 1): number {
  if (direction === 1) return Math.min(RECORD_AMOUNT_MAX, (Math.floor(value / step) + 1) * step);
  const next = (Math.ceil(value / step) - 1) * step;
  return next >= Math.max(step, RECORD_AMOUNT_MIN) ? next : value;
}

const integer = (n: number) => n.toLocaleString('ja-JP');

/** 整数分を正確な時間＋分にする（0 → 0時間0分、61 → 1時間1分、1240 → 20時間40分）。 */
export function hoursMinutes(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${integer(hours)}時間${minutes - hours * MINUTES_PER_HOUR}分`;
}

/** 日々の量は入力と同じ分／回。累計・総量の時間＋分表示とは分ける。 */
export function recordDisplay(fmt: Pick<AmountFormat, 'record' | 'recordUnit'>, amount: number): string {
  return fmt.record(amount);
}

export type AmountFormat = {
  /** 累計・総量・残量（例「20時間40分」「38回」）。 */
  total: (amount: number) => string;
  /** 1回の量・日々の記録（例「20分」「20回」）。 */
  record: (amount: number) => string;
  /** 1回の量・日々の記録の単位（入力欄の右端）。 */
  recordUnit: string;
  /** −／＋を1回押したときの刻み（recordStep）。 */
  recordStep: (sessionAmount: number) => number;
  /** 積み上げの図の縦軸（総量で決まる）。 */
  axis: (total: number) => AmountAxis;
};

export type AmountAxis = {
  /** 縦軸の単位。 */
  unit: string;
  /** 目盛りの数字（単位なし）。 */
  label: (amount: number) => string;
  /** 目盛りの値をそろえる刻み。 */
  gridUnit: number;
};

const plainAxis = (unit: string): AmountAxis => ({ unit, label: integer, gridUnit: 1 });

export function amountFormat(goal: AmountGoal): AmountFormat {
  if (goal.unit === 'sessions') {
    const times = (n: number) => `${integer(n)}回`;
    return { total: times, record: times, recordUnit: '回', recordStep: (n) => recordStep('sessions', n), axis: () => plainAxis('回') };
  }
  return {
    total: hoursMinutes,
    record: (n) => `${integer(n)}分`,
    recordUnit: '分',
    recordStep: (n) => recordStep('minutes', n),
    // 3時間以上なら1時間刻みの目盛りを時間の数で出す（目盛りは整数時間なので丸めは起きない）。短いGoalは分の目盛り
    axis: (total) =>
      total >= 3 * MINUTES_PER_HOUR ? { unit: '時間', label: (n) => integer(n / MINUTES_PER_HOUR), gridUnit: MINUTES_PER_HOUR } : plainAxis('分'),
  };
}
