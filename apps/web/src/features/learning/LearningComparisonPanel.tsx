import { useEffect, useState } from 'react';
import type { GoalR11, TodayR11, Log, LearningReferenceForecast, LearningExperimentalForecast } from '@contracts';
import type { useLearning } from './useLearning.ts';
import { matchesComparisonContext, previewAmount, reasonLabel } from './presentation.ts';

export function LearningComparisonPanel({ goal, today, logs, learning, locked }: {
  goal: GoalR11; today: TodayR11; logs: readonly Log[]; learning: ReturnType<typeof useLearning>; locked: boolean;
}) {
  const report = learning.report;
  const [amount, setAmount] = useState(String(goal.sessionAmount)), [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setAmount(String(goal.sessionAmount)); setSelectedId(null); learning.clearComparison(); },
    [goal.sessionAmount, today.today, report?.activeRevision, report?.participation?.id]);
  if (!report?.participation) return null;
  const artifacts = report.artifacts.filter(item => item.purpose === 'EXPERIMENTAL');
  const selected = artifacts.find(item => item.id === selectedId);
  const input = previewAmount(amount), disabled = locked || learning.busy || learning.awaitingConfirmation;
  const comparison = !disabled && selected && learning.comparison && learning.comparison.experiment.artifactId === selected.id &&
    matchesComparisonContext(goal, today, logs, report, learning.comparison) ? learning.comparison : null;
  return <section className="fr-learning__experiment" aria-labelledby="learning-experiment-heading">
    <h3 id="learning-experiment-heading">実績から作ったモデルとの実験比較</h3>
    <p>標準モデルの主表示は変えません。本人の既存記録から実験モデルを作り、明示的に選んで比較します。精度改善・実際の80%の的中は未確認です。作成や比較だけでは採用しません。</p>
    <p>主画面の標準予測は{today.prediction.config.horizonDays}日、下の比較は標準モデルと実験モデルを同じ今日の量・{report.policy.observationDays}日でそろえます。比較は記録を保存しません。</p>
    <button type="button" className="fr-btn fr-btn--primary" disabled={disabled} onClick={() => void learning.action('experiment')}>実績から実験モデルを作る</button>
    <label htmlFor="learning-experiment-amount">比較で仮置きする今日の量（{goal.unit === 'minutes' ? '分' : '回'}）</label>
    <input id="learning-experiment-amount" type="text" inputMode="numeric" value={amount} disabled={disabled}
      onChange={event => { setAmount(event.target.value); learning.clearComparison(); }} />
    {input === undefined ? <p role="alert">0以上の半角整数を入力してください。先頭の0は不要です。</p> : null}
    <ul className="fr-learning__artifacts">{artifacts.map(artifact => {
      const context = artifact.goalSettingsRevision === report.goalSettingsRevision && artifact.answerRevision === report.answerRevision;
      return <li key={artifact.id}><h4>実験用の結果 {artifact.createdAt}</h4>
        <p>実験用です。採用資格を満たしたモデルとしては扱いません。</p>
        <p>記録の最終日: {artifact.trainingCutoff} ／ 使用期限: {artifact.expiresAt}</p>
        {!context ? <p>設定や回答が変わりました。新しい実験モデルを作ってください。</p> : null}
        <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled || !context || input === undefined}
          onClick={() => { setSelectedId(artifact.id); if (input !== undefined) void learning.requestComparison(artifact, input); }}>このモデルと比較</button>
      </li>;
    })}</ul>
    {artifacts.length === 0 ? <p>実験モデルはまだありません。</p> : null}
    {selected ? <div className="fr-learning__actions">
      <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled || input === undefined || input === 0}
        onClick={() => { if (input !== undefined && input > 0) void learning.requestComparison(selected, input); }}>選んだモデルでこの量を比較（未保存）</button>
      <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled}
        onClick={() => void learning.requestComparison(selected, 0)}>選んだモデルで休む場合を比較（未保存）</button>
    </div> : null}
    {comparison ? <div className="fr-learning__comparison" aria-label="標準モデルと実験モデルの未保存比較">
      <ComparisonForecast forecast={comparison.reference} /><ComparisonForecast forecast={comparison.experiment} />
      <p>モデル上の見通しです。実データでの校正や到達を保証せず、中央値の差を休むことの因果的な遅れとは扱いません。0＝休む場合は、正の量を実行する場合と別の状態です。</p>
    </div> : null}
    {learning.comparisonError ? <p role="alert">実験比較を取得できませんでした。記録・設定・候補を再確認してください。書き込みは行いません。</p> : null}
  </section>;
}
export function ComparisonForecast({ forecast }: { forecast: LearningReferenceForecast | LearningExperimentalForecast }) {
  return <section aria-label={forecast.source === 'BASELINE' ? '同じ期間の標準予測' : '改善未確認の実験予測'}>
    <h4>{forecast.source === 'BASELINE' ? '標準モデル' : '実験モデル（改善未確認）'}</h4>
    <p>{!forecast.hypothetical ? `今日の記録: ${forecast.todayAmount === 0 ? '休み' : forecast.todayAmount ?? '未確認'}` : forecast.todayAmount === 0 ? '休む場合（未保存）' : `今日の量 ${forecast.todayAmount ?? '未確認'}（未保存）`} ／ {forecast.horizonDays}日以内の見通し</p>
    {forecast.status === 'insufficient' ? <p>このモデルで計算する材料が不足しています。別のモデルの値で補いません。</p> : forecast.status === 'completed' ? <p>到達済みです。</p> : <>
      <dl><div><dt>P50 到達日数の目安</dt><dd>{forecast.p50Days === null ? `${forecast.horizonDays}日以内では見積もれません` : `${forecast.p50Days}日`}</dd></div>
        <div><dt>P80 到達日数の目安</dt><dd>{forecast.p80Days === null ? `${forecast.horizonDays}日以内では見積もれません` : `${forecast.p80Days}日`}</dd></div></dl>
      {forecast.reachProbability !== null ? <p>{forecast.horizonDays}日以内の到達見込み {Math.round(forecast.reachProbability * 100)}%</p> : null}
    </>}
    {forecast.reason ? <p>表示理由: {reasonLabel(forecast.reason)}</p> : null}
  </section>;
}
