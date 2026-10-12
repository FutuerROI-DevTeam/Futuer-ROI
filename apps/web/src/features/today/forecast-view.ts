import type { TodayR11 as Today } from '@contracts';
import { todayCopy } from '../../copy/today.ts';
import { weekLabel } from '../../copy/date.ts';
import type { ActualProgress, CompletionPresentation, ForecastPresentation, Source, SufficientSource, Unit } from '../prior/presentation-types.ts';

// 実績由来の予測と R-11 の予測は config の中身だけが違う。表示に config は使わない
type Prediction = Omit<Today['prediction'], 'config'>;

/** R-11 の読み取りで得る、出所と計画。 */
export type R11Extras = { provenance: Today['provenance']; plan: Today['plan']; sessionAmount: number };

/** 見通しを出すときの出所。NONE なのに見通しが出ているのは食い違いなので止める。 */
function sufficient(source: Source): SufficientSource {
  if (source === 'NONE') {
    throw new TypeError('見通しを表示しているのに、出所が NONE になっています。');
  }
  return source;
}

/**
 * API の予測を表示データへ変換する。日数・出所・plan は補わず、週ラベルだけを付ける。
 * 優先順は達成済み（R-08）→ 今日記録済み（R-07）→ 未記録（PR #120）。
 * 記録だけの読み取りでは出所を RECORDS にし、R-11 で NONE の見通しは拒否する。
 */
export function toForecastView(prediction: Prediction, unit: Unit, r11?: R11Extras): ForecastPresentation {
  const progress: ActualProgress = { done: prediction.progress.done, total: prediction.progress.total, unit };
  if (prediction.progress.completed) {
    return { kind: 'completed', progress };
  }

  const resumed = {
    success: prediction.observations.nSD,
    total: prediction.observations.nSD + prediction.observations.nSS,
  };
  const completion = toCompletion(prediction, unit, r11);

  if (prediction.todayStatus === 'DONE' || prediction.todayStatus === 'SKIPPED') {
    if (completion.kind === 'estimate') {
      if (completion.scenario !== 'CURRENT_STATE') {
        throw new TypeError('記録済みの日の完了の目安は CURRENT_STATE であるはずです。');
      }
      return { kind: 'today-recorded', progress, resumed, completion: { ...completion, scenario: 'CURRENT_STATE' } };
    }
    // 不足（計画があれば条件付きの回数）も、記録済みの日にそのまま出す
    return { kind: 'today-recorded', progress, resumed, completion };
  }

  if (prediction.coreMetric.status === 'not_applicable') {
    throw new TypeError('未記録の日に中心指標が対象外になっています。');
  }
  if (completion.kind === 'estimate' && completion.scenario !== 'TODAY_DONE') {
    throw new TypeError('未記録の日の完了の目安は TODAY_DONE であるはずです。');
  }
  return {
    kind: 'forecast',
    progress,
    resumed,
    completion,
    core:
      prediction.coreMetric.status === 'available'
        ? // 中心の数字は「休んだ日の翌日」の再開傾向から出すので、b の出所を使う
          {
            kind: 'estimate',
            days: prediction.coreMetric.g50,
            source: r11 ? sufficient(r11.provenance.b) : 'RECORDS',
          }
        : { kind: 'insufficient', message: todayCopy.insufficientCore },
  };
}

function toCompletion(prediction: Prediction, unit: Unit, r11?: R11Extras): CompletionPresentation {
  const c = prediction.completion;
  switch (c.status) {
    case 'available':
      return {
        kind: 'estimate',
        scenario: c.scenario,
        sources: r11
          ? { a: sufficient(r11.provenance.a), b: sufficient(r11.provenance.b) }
          : { a: 'RECORDS', b: 'RECORDS' },
        p50Days: c.p50Days,
        p80Days: c.p80Days,
        p50Label: weekLabel(prediction.today, c.p50Days),
        p80Label: weekLabel(prediction.today, c.p80Days),
      };
    case 'insufficient':
      // API が返す plan は設定量で行う残り回数で、日数の予測ではない。
      if (r11?.plan) {
        return {
          kind: 'conditional',
          plan: {
            remainingAmount: r11.plan.remainingAmount,
            sessions: r11.plan.remainingSessions,
            sessionAmount: r11.sessionAmount,
            lastAmount: r11.plan.lastSessionAmount,
            unit,
          },
          reason: todayCopy.planReason(r11.provenance.a === 'NONE', r11.provenance.b === 'NONE'),
        };
      }
      return { kind: 'insufficient', message: todayCopy.insufficientCompletion };
    case 'completed':
      // 実績が未達なのに完了扱いの結果は、達成済みの判定（progress.completed）と食い違う
      throw new TypeError('未達成なのに完了の目安が completed になっています。');
  }
}
