import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { EvaluationForecast, EvaluationReport } from '@contracts';
import { ApiError } from '../../api/client.ts';
import { isNotFound, isUnauthenticated } from '../../api/http.ts';
import { privateDataReady, usePrivateEpoch } from '../../api/session-cache.ts';
import { useDraftGeneration } from '../../api/session-draft.ts';
import { AppBar } from '../../ui/components/AppBar.tsx';
import { PageTitle } from '../../ui/components/PageTitle.tsx';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog.tsx';
import { GoalNotFoundPanel, LoadErrorPanel, SignedOutPanel } from '../goals/GoalStates.tsx';
import { useEvaluation, useEvaluationCapability } from './useEvaluation.ts';
import '../../ui/tokens.css';
import '../../ui/page.css';
import '../../ui/components/Button.css';
import './evaluation.css';

const states = {
  REACHED: '期限までに到達', NOT_REACHED: '期限までに未到達', UNKNOWN: '未記録があり判定できない',
  PENDING: '訂正可能期間・観測期間中', NULL: '有限の予測日数なし', OUTSIDE_HORIZON: '照合期間の範囲外',
  INPUT_CORRECTED: '発行時の記録が訂正された', CONTEXT_CHANGED: '目標設定・回答の版が変わった',
} as const;
function Frame({ goalId, children }: { goalId: string; children: React.ReactNode }) {
  return <div className="fr fr-page fr-evaluation">
    <PageTitle title="予測と実績の記録" />
    <AppBar title="予測と実績の記録" leading={<Link to="/goals/$goalId" params={{ goalId }} className="fr-btn fr-btn--text">戻る</Link>} />
    <main className="fr-evaluation__content"><h1>予測と実績の記録</h1>{children}</main>
  </div>;
}
export function EvaluationPage({ goalId }: { goalId: string }) {
  const current = usePrivateEpoch();
  const generation = useDraftGeneration();
  const capability = useEvaluationCapability();
  if (!privateDataReady(current)) return <Frame goalId={goalId}>{current.owner === null ? <SignedOutPanel /> : <p role="status">認証状態を確認しています。</p>}</Frame>;
  if (capability.isError) return <Frame goalId={goalId}><LoadErrorPanel error={capability.error} onRetry={() => void capability.refetch()} /></Frame>;
  if (!capability.data) return <Frame goalId={goalId}><p role="status">読み込んでいます。</p></Frame>;
  if (!capability.data.enabled) return <Frame goalId={goalId}><p>この機能は現在利用できません。評価用予測の保存は行われません。</p></Frame>;
  return <PrivateEvaluation key={`${current.owner}:${goalId}:${generation}`} goalId={goalId} />;
}
function PrivateEvaluation({ goalId }: { goalId: string }) {
  const evaluation = useEvaluation(goalId, true);
  const [accepted, setAccepted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const report = evaluation.data;
  const failure = evaluation.error ?? evaluation.query.error;
  if (!report) return <Frame goalId={goalId}>{isUnauthenticated(failure) ? <SignedOutPanel /> :
    isNotFound(failure) ? <GoalNotFoundPanel /> : failure ?
      <LoadErrorPanel error={failure} onRetry={() => void evaluation.query.refetch()} /> : <p role="status">読み込んでいます。</p>}</Frame>;
  return <Frame goalId={goalId}>
    <section className="fr-evaluation__section" aria-labelledby="evaluation-purpose">
      <h2 id="evaluation-purpose">自分の目標で予測を振り返る</h2>
      <p>本人の1目標だけを対象に、ボタンを押した時の予測と、後日の記録を照合します。画面を開くだけでは予測を保存しません。今日の「やった・休んだ」を記録した後、評価用予測を発行できます。</p>
      <p>発行時の残量・単位・設定と予測を保存します。タイトルや自由記述は評価用に複製しません。保存は1日1件、最大{report.policy.maxSnapshots}件、評価画面で扱う期間は発行から最大{report.policy.retentionDays}日です。参加開始からの期限または件数上限により、これより早く評価対象から外れる場合があります。照合は最大{report.policy.observationDays}日です。残り日数が照合期間を超える予測は範囲外として表示します。実利用前には、期限切れ記録の削除運用と利用説明を確定する必要があります。</p>
      <p>参加解除・目標削除で評価用記録を削除します。バックアップからの消去を保証するものではありません。参加は学習利用や個人をまたぐ集計への同意を意味しません。</p>
      {!report.participating ? <>
        <label className="fr-evaluation__accept"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={evaluation.busy} />この説明を確認し、この目標の評価用記録を保存する</label>
        <button type="button" className="fr-btn fr-btn--primary" disabled={!accepted || evaluation.busy} onClick={() => void evaluation.action('participate')}>この目標で参加する</button>
      </> : <div className="fr-evaluation__actions">
        <button type="button" className="fr-btn fr-btn--primary" disabled={evaluation.busy} onClick={() => void evaluation.action('capture')}>評価用予測を記録</button>
        <button type="button" className="fr-btn fr-btn--secondary" disabled={evaluation.busy} onClick={() => void evaluation.action('assess')}>結果を照合</button>
        <button type="button" className="fr-btn fr-btn--text" disabled={evaluation.busy} onClick={() => setConfirm(true)}>参加解除・評価記録を削除</button>
      </div>}
    </section>
    {evaluation.busy ? <p role="status">処理しています。</p> : null}
    {evaluation.notice ? <p role="status">{evaluation.notice}</p> : null}
    {!evaluation.error && evaluation.query.isError ? <p role="alert">最新の照合結果を取得できませんでした。前回の結果を表示しています。「結果を照合」で再確認してください。</p> : null}
    {evaluation.error ? <p role="alert">{isUnauthenticated(evaluation.error) ? 'ログインを確認してください。' :
      evaluation.error instanceof ApiError && evaluation.error.status === 409 ? '現在の状態では保存できません。今日の記録・目標設定・他の目標での参加を確認し、結果を照合してから操作してください。' :
      '処理を確認できませんでした。書き込みは自動再送しません。結果を照合して保存状態を確認してください。'}</p> : null}
    <Summary report={report} />
    <section className="fr-evaluation__section" aria-labelledby="evaluation-records"><h2 id="evaluation-records">保存した予測（{report.forecasts.length}件）</h2>
      {report.forecasts.length === 0 ? <p>評価用予測はまだありません。</p> : <ul className="fr-evaluation__records">{report.forecasts.map(forecast => <ForecastRow key={forecast.id} forecast={forecast} />)}</ul>}
    </section>
    <ConfirmDialog open={confirm} title="参加を解除しますか？" confirmLabel="解除して評価記録を削除" cancelLabel="取り消す" busy={evaluation.busy}
      onConfirm={() => { setConfirm(false); void evaluation.action('withdraw'); }} onCancel={() => setConfirm(false)}>
      <p>この目標の評価用予測を削除します。目標と日々の記録は残ります。バックアップからの消去を保証するものではありません。</p>
    </ConfirmDialog>
  </Frame>;
}
function Summary({ report }: { report: EvaluationReport }) {
  return <section className="fr-evaluation__section" aria-labelledby="evaluation-summary"><h2 id="evaluation-summary">この記録での実績</h2>
    <p>保存中の発行件数: {report.summary.issued}件。参加者: {report.summary.participantCount}人（本人のみ）。人数・観測数が不足しており、他の人への一般化や予測の校正・精度改善を保証しません。日ごとの記録は独立した参加者ではありません。</p>
    <p>到達は、発行時の残量を後日の「やった」の実際の量が満たしたかで判断します。記録訂正・設定の版変更・未記録を、未到達とは分けます。日付は発行時の目標のタイムゾーンで扱い、昨日を訂正できる期間が終わるまで確定しません。</p>
    <div className="fr-evaluation__summaries">{(['p50', 'p80'] as const).map(key => {
      const counts = report.summary[key];
      const lower = counts.lowerCoverage, upper = counts.upperCoverage;
      return <section key={key}><h3>{key.toUpperCase()}の日数までの到達割合</h3><p>{lower === null || upper === null ? '割合を計算できる記録がありません。' : `${Math.round(lower * 100)}〜${Math.round(upper * 100)}%（未記録を考慮した範囲）`}</p>
        <dl>{Object.entries(states).map(([state, label]) => <div key={state}><dt>{label}</dt><dd>{counts[state as keyof typeof states]}件</dd></div>)}</dl></section>;
    })}</div>
  </section>;
}
function ForecastRow({ forecast: f }: { forecast: EvaluationForecast }) {
  return <li><h3>{f.anchorDate} の予測</h3><p>発行: {f.issuedAt} ／ 日付基準: {f.timezone}</p>
    <p>発行時の残量: {f.remainingAmount} {f.unit}。P50: {f.p50Days === null ? '有限値なし' : `${f.p50Days}日`} ／ P80: {f.p80Days === null ? '有限値なし' : `${f.p80Days}日`}</p>
    <p>P50: {states[f.p50State]} ／ P80: {states[f.p80State]}</p>
    {f.predictionStatus === 'insufficient' ? <p>記録が不足し、予測日数を発行できませんでした。</p> : null}
    <p className="fr-evaluation__metadata">設定版: {f.goalSettingsRevision} ／ 回答版: {f.answerRevision} ／ モデル: {f.modelVersion} ／ ビルド: {f.buildVersion} ／ 保存期限: {f.expiresAt}</p>
  </li>;
}
