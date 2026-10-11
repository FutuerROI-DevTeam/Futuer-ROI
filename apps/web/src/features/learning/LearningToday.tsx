import { useEffect, useState, type ReactNode } from 'react';
import type { GoalR11, Log, TodayR11, LearningSelectedForecast, LearningArtifactSummary } from '@contracts';
import { ApiError } from '../../api/client.ts';
import { privateDataReady, usePrivateEpoch } from '../../api/session-cache.ts';
import { useDraftGeneration } from '../../api/session-draft.ts';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog.tsx';
import { adoptable, matchesLearningContext, previewAmount } from './presentation.ts';
import { useLearning, useLearningCapability } from './useLearning.ts';
import './learning.css';
import { LearningComparisonPanel } from './LearningComparisonPanel.tsx';

export function LearningToday({ goal, today, logs, locked, changing, children }: {
  goal: GoalR11; today: TodayR11; logs: readonly Log[]; locked: boolean; changing: boolean; children: ReactNode;
}) {
  const capability = useLearningCapability(), current = usePrivateEpoch(), generation = useDraftGeneration();
  if (!privateDataReady(current)) return <p role="status">認証状態を確認しています。</p>;
  if (!capability.data?.enabled) return <>{children}{capability.isError ? <p className="fr-learning__notice">学習機能を確認できません。従来モデルを表示しています。</p> : null}</>;
  const scope = `${goal.id}:${today.today}:${goal.goalSettingsRevision}:${goal.answerRevision}`;
  return <OwnedLearning key={`${current.owner}:${generation}:${scope}`} goal={goal} today={today} logs={logs} scope={scope} locked={locked} changing={changing}>{children}</OwnedLearning>;
}
/** The unchanged two-Beta details stay available, but their source is explicit. */
export function LearningBaselineDetails({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
function OwnedLearning({ goal, today, logs, scope, locked, changing, children }: {
  goal: GoalR11; today: TodayR11; logs: readonly Log[]; scope: string; locked: boolean; changing: boolean; children: ReactNode;
}) {
  const learning = useLearning(goal.id, true, scope);
  const [accepted, setAccepted] = useState(false), [amount, setAmount] = useState(String(goal.sessionAmount));
  const [confirmation, setConfirmation] = useState<'withdraw' | 'rollback' | null>(null);
  const report = learning.report;
  useEffect(() => { setAmount(String(goal.sessionAmount)); learning.clearPreview(); }, [goal.sessionAmount, today.today, report?.activeRevision, report?.participation?.id]);
  const matched = report && learning.selected && matchesLearningContext(goal, today, logs, report, learning.selected);
  const selected = matched ? learning.selected?.selectedForecast : undefined;
  const preview = !learning.busy && !learning.awaitingConfirmation && !learning.reportQuery.error && !learning.todayQuery.error && report && learning.preview && matchesLearningContext(goal, today, logs, report, learning.preview) ? learning.preview.selectedForecast : undefined;
  const disabled = locked || learning.busy || learning.awaitingConfirmation;
  const input = previewAmount(amount);
  const failure = learning.error ?? learning.reportQuery.error ?? learning.todayQuery.error;
  return <>
    {children}<p className="fr-learning__notice">標準モデルを表示しています。実験モデルは下で別に比較し、主表示へ自動採用しません。</p>
    <section className="fr-learning" aria-labelledby="learning-heading">
      <h2 id="learning-heading">本人の記録から学ぶ予測</h2>
      <p>この目標の既存の日次記録だけから実験モデルを作り、標準モデルと別に比較します。画面を開くだけでは学習・採用・記録の保存を行いません。精度改善や実際の80%の的中は未確認です。実験の成功を採用資格の合格と扱いません。</p>
      {!report ? <><p role={failure ? 'alert' : 'status'}>{failure ? '学習状態を取得できませんでした。採用済みとみなさず従来モデルを使います。' : '学習状態を確認しています。'}</p>
        <button type="button" className="fr-btn fr-btn--secondary" onClick={() => void Promise.all([learning.reportQuery.refetch(), learning.todayQuery.refetch()])}>学習状態を再確認</button></> : <>
        <p>学習候補は最大{report.policy.maxArtifacts}件・最大{report.policy.retentionDays}日。参加期限や設定変更・件数上限により早く使えなくなる場合があります。メールアドレス・自由記述・新たな個人属性を追加収集せず、外部転送・個人間の集計を行いません。実利用の説明と期限切れ削除運用は別途確定が必要です。バックアップ消去や法的同意成立を保証しません。</p>
        <p>解除すると学習モデル・候補・学習予測の評価記録を削除します。同じ期間を未見のテストとして使い直さないため、比較済みの最終日だけ目標削除まで残します。日々の記録は残ります。</p>
        {!report.participation ? <>
          <label className="fr-learning__accept"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={disabled} />この説明を確認し、この目標の既存記録から学習候補を作ることを選ぶ</label>
          <button type="button" className="fr-btn fr-btn--primary" disabled={disabled || !accepted} onClick={() => void learning.action('participate')}>この目標の学習に参加</button>
        </> : <>
          <p>参加期限: {report.participation.expiresAt}。採用版: {report.activeRevision}。</p>
          <LearningComparisonPanel goal={goal} today={today} logs={logs} learning={learning} locked={locked || changing} />
          <details><summary>既存の採用資格監査（実験比較とは別）</summary>
          <div className="fr-learning__actions">
            <button type="button" className="fr-btn fr-btn--primary" disabled={disabled} onClick={() => void learning.action('fit')}>候補を学習して比較</button>
            <button type="button" className="fr-btn fr-btn--secondary" disabled={locked || learning.busy} onClick={() => void learning.action('refresh')}>学習状態を再確認</button>
            <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled || report.activeArtifactId === null} onClick={() => setConfirmation('rollback')}>従来モデルへ戻す</button>
            <button type="button" className="fr-btn fr-btn--text" disabled={disabled} onClick={() => setConfirmation('withdraw')}>学習参加を解除・候補を削除</button>
          </div>
          <ul className="fr-learning__artifacts">{report.artifacts.filter(artifact => artifact.purpose !== 'EXPERIMENTAL').map(artifact => <ArtifactRow key={artifact.id} artifact={artifact}
            active={report.activeArtifactId === artifact.id} applied={selected?.source === 'LEARNED' && selected.artifactId === artifact.id && selected.artifactHash === artifact.hash} disabled={disabled}
            activate={() => void learning.action('activate', artifact)} />)}</ul>
          {report.artifacts.length === 0 ? <p>学習候補はまだありません。</p> : null}
          </details>
        </>}
        <details><summary>採用資格確認用の予測比較（実験とは別）</summary>
        <section className="fr-learning__preview" aria-labelledby="learning-amount-heading"><h3 id="learning-amount-heading">採用資格確認用の今日の量比較（未保存）</h3>
          <p>この比較は日次記録を保存しません。正の量の比較と、0＝休む場合は別の状態です。休む場合が必ず何日遅れるとは限りません。</p>
          <label htmlFor="learning-amount">今日やる量（{goal.unit === 'minutes' ? '分' : '回'}）</label>
          <input id="learning-amount" type="text" inputMode="numeric" value={amount} disabled={disabled}
            onChange={event => { setAmount(event.target.value); learning.clearPreview(); }} />
          <div className="fr-learning__actions">
            <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled || input === undefined || input === 0} onClick={() => { if (input !== undefined && input > 0) void learning.requestPreview(input); }}>この量で比較（未保存）</button>
            <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled} onClick={() => void learning.requestPreview(0)}>休む場合を比較（未保存）</button>
          </div>
          {input === undefined ? <p role="alert">0以上の整数を半角で入力してください（先頭の0は不要です）。</p> : null}
          {preview ? <SelectedCompletion forecast={preview} primary={false} unit={goal.unit} /> : null}
          {learning.previewError ? <p role="alert">比較を取得できませんでした。設定や採用状態を再確認してください。</p> : null}
        </section>
        </details>
      </>}
      {learning.busy ? <p role="status">学習状態を更新しています。書き込みは自動再送しません。</p> : null}
      {learning.awaitingConfirmation ? <p role="status">書き込み結果を確認できていません。採用状態と予測の両方を再確認するまで、学習予測の表示と操作を保留します。書き込みは自動再送しません。</p> : null}
      {learning.awaitingConfirmation && report && !report.participation ? <button type="button" className="fr-btn fr-btn--secondary" disabled={locked || learning.busy} onClick={() => void learning.action('refresh')}>学習状態を再確認</button> : null}
      {learning.notice ? <p role="status">{learning.notice}</p> : null}
      {report && failure ? <p role="alert">{failure instanceof ApiError && failure.status === 409 ? '別の操作で参加・設定・採用状態が変わりました。最新状態を確認してから操作してください。' : '操作または最新取得を確認できませんでした。自動再送せず、学習状態を再確認してください。'}</p> : null}
      <ConfirmDialog open={confirmation !== null} title={confirmation === 'withdraw' ? '学習参加を解除しますか？' : '従来モデルへ戻しますか？'}
        confirmLabel={confirmation === 'withdraw' ? '解除して候補を削除' : '従来モデルへ戻す'} cancelLabel="取り消す" busy={learning.busy}
        onConfirm={() => { const kind = confirmation; setConfirmation(null); if (kind) void learning.action(kind); }} onCancel={() => setConfirmation(null)}>
        <p>{confirmation === 'withdraw' ? '学習モデル・候補・学習予測の評価記録を削除し、従来モデルへ戻します。比較済みの最終日だけ目標削除まで残します。日次記録は残ります。バックアップ消去は保証しません。' : '学習候補の採用を解除します。日次記録は変更しません。'}</p>
      </ConfirmDialog>
    </section>
  </>;
}
export function SelectedCompletion({ forecast: f, primary, unit }: { forecast: LearningSelectedForecast; primary: boolean; unit: string }) {
  const label = f.todayAmount === 0 ? '休む場合（未保存）' : f.hypothetical ? `今日${f.todayAmount ?? '設定量'}${unit === 'minutes' ? '分' : '回'}やる場合（未保存）` : '現在の記録からの見通し';
  const heading = primary ? <h1>今日の量による到達見通し</h1> : <h4>{label}</h4>;
  return <section className="fr-learning__forecast" aria-label={primary ? '採用した予測の主表示' : '未保存の量比較'}>
    {heading}{primary ? <p>{label}</p> : null}<p>{f.source === 'LEARNED' ? '本人の記録で比較し、採用した学習モデル' : '従来モデル'}（採用版 {f.activeRevision}）</p>
    {f.status === 'completed' ? <p>到達済みです。</p> : f.status === 'insufficient' ? <p>予測に必要な材料が不足しています。</p> : <dl>
      <div><dt>P50 到達日数の目安</dt><dd>{f.p50Days === null ? `${f.horizonDays}日以内では日数を見積もれません` : `${f.p50Days}日`}</dd></div>
      <div><dt>P80 到達日数の目安</dt><dd>{f.p80Days === null ? `${f.horizonDays}日以内では日数を見積もれません` : `${f.p80Days}日`}</dd></div>
    </dl>}
    {f.reachProbability !== null ? <p>{f.horizonDays}日以内の到達見込み {Math.round(f.reachProbability * 100)}%</p> : null}
    <p>モデル上の見通しであり、実データで校正済みの確率や到達の保証ではありません。</p>
    <p>今日の状態・実績と選択量を条件にした見通しです。2つの中央値の差を、休むことの因果的な遅れとは扱いません。</p>
    {f.reason ? <p>表示理由: {f.reason}</p> : null}
  </section>;
}
export function ArtifactRow({ artifact, active, applied = false, disabled, activate }: { artifact: LearningArtifactSummary; active: boolean; applied?: boolean; disabled: boolean; activate: () => void }) {
  const gate = artifact.gate;
  return <li data-applied={active && applied ? 'true' : 'false'}><h3>候補 {artifact.createdAt}</h3><p>{active ? applied ? '資格確認用の予測に適用中（標準主表示は維持）' : '選択済み（現在の予測には未適用）' : gate.status === 'ADOPTABLE' ? '採用条件を満たしました（未採用）' : gate.status === 'INSUFFICIENT' ? '比較材料が不足しています' : '採用条件を満たしていません'}</p>
    <p>学習遷移 {gate.trainTransitions}件 ／ 検証起点 {gate.validationOrigins}件 ／ 未見テスト起点 {gate.testOrigins}件。適用 {gate.appliedOrigins}件 ／ 従来モデル使用 {gate.fallbackOrigins}件 ／ 除外 {gate.excludedOrigins}件。</p>
    {gate.reasons.length > 0 ? <ul>{gate.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : null}
    {artifact.eligibilityReason ? <p>使用条件: {artifact.eligibilityReason}</p> : null}
    <p>学習対象の最終日: {artifact.trainingCutoff} ／ 使用期限: {artifact.expiresAt}</p>
    <button type="button" className="fr-btn fr-btn--secondary" disabled={disabled || active || !adoptable(artifact)} onClick={activate}>この候補を明示採用</button>
  </li>;
}
