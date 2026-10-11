import type { GoalR11, Log, TodayR11, TodayLearning, LearningReport, LearningArtifactSummary, LearningComparison } from '@contracts';
import { isSameSnapshot } from '../today/snapshot.ts';

export function previewAmount(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]{0,9})$/.test(value)) return undefined;
  const amount = Number(value);
  return amount <= 2_147_483_647 ? amount : undefined;
}
export function adoptable(artifact: LearningArtifactSummary): boolean {
  return artifact.purpose !== 'EXPERIMENTAL' && artifact.eligible && artifact.gate.status === 'ADOPTABLE';
}
export function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    INPUT_CORRECTED: '学習に使った記録が訂正されました。新しい実験結果を作ってください。',
    CONTEXT_CHANGED: '目標の設定や回答が変わりました。新しい実験結果を作ってください。',
    NUMERICAL_INSUFFICIENCY: 'この条件では十分に確かめた計算結果を出せません。',
    RECORD_LIMIT_EXCEEDED: '計算で扱える記録数を超えています。',
    NO_DONE_ORIGIN_TRANSITION: '実行した日の翌日に関する記録が足りません。',
    NO_SKIP_ORIGIN_TRANSITION: '休んだ日の翌日に関する記録が足りません。',
    UNKNOWN_DURATION: '連続して休んだ期間を記録から確認できません。',
    ARTIFACT_EXPIRED: 'この実験結果の使用期限が過ぎました。',
    EXPIRED: 'この実験結果の使用期限が過ぎました。',
    EXPERIMENTAL_NOT_QUALIFIED: '実験用の計算結果です。精度改善と採用資格は確認していません。',
  };
  return labels[reason] ?? 'この条件では実験予測を確認できません。記録や設定を確認してください。';
}
function snapshotValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(snapshotValue).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${snapshotValue((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
// Learned completion is a separate DTO, never an invented two-Beta prediction.
export function matchesLearningContext(goal: GoalR11, today: TodayR11, logs: readonly Log[], report: LearningReport, selected: TodayLearning): boolean {
  if (!isSameSnapshot(goal, selected.baseline, logs)) return false;
  if (snapshotValue(selected.baseline) !== snapshotValue(today)) return false;
  if (report.goalSettingsRevision !== goal.goalSettingsRevision || report.answerRevision !== goal.answerRevision ||
      selected.selectedForecast.activeRevision !== report.activeRevision) return false;
  const forecast = selected.selectedForecast;
  if (forecast.source === 'BASELINE') return true;
  const artifact = report.artifacts.find(item => item.id === forecast.artifactId && item.hash === forecast.artifactHash);
  return report.participation !== null && report.activeArtifactId === forecast.artifactId && artifact !== undefined && adoptable(artifact);
}
export function matchesComparisonContext(goal: GoalR11, today: TodayR11, logs: readonly Log[], report: LearningReport, comparison: LearningComparison): boolean {
  const artifact = report.artifacts.find(item => item.purpose === 'EXPERIMENTAL' && item.id === comparison.experiment.artifactId && item.hash === comparison.experiment.artifactHash);
  return report.participation !== null && artifact !== undefined && isSameSnapshot(goal, comparison.baseline, logs) &&
    snapshotValue(comparison.baseline) === snapshotValue(today) && comparison.goalSettingsRevision === goal.goalSettingsRevision &&
    comparison.answerRevision === goal.answerRevision && report.goalSettingsRevision === comparison.goalSettingsRevision && report.answerRevision === comparison.answerRevision &&
    artifact.goalSettingsRevision === comparison.goalSettingsRevision && artifact.answerRevision === comparison.answerRevision &&
    comparison.activeRevision === report.activeRevision && comparison.reference.source === 'BASELINE' && comparison.experiment.source === 'EXPERIMENTAL' &&
    comparison.reference.horizonDays === report.policy.observationDays && comparison.experiment.horizonDays === comparison.reference.horizonDays &&
    comparison.reference.todayAmount === comparison.experiment.todayAmount && comparison.reference.hypothetical && comparison.experiment.hypothetical;
}
