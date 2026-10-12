import { Link, useLocation } from '@tanstack/react-router';
import { longDate } from '../../copy/date.ts';
import { todayCopy } from '../../copy/today.ts';
import { Button } from '../../ui/components/Button.tsx';
import { ErrorPanel } from '../../ui/components/Notice.tsx';
import type { SaveFailureKind } from './record-log.ts';
import './logs.css';

/**
 * 記録の保存の失敗（デザインキャンバス D7-failed・D7-date・E3-failed）。失敗したのに記録済みに見せず、何が保存されていないかを書く。
 * - failed：同じ内容で「もう一度保存」するか、「選び直す」
 * - date：日付が変わって記録できない日になった。画面を新しくして今日を選び直す
 * - signed-out：ログインし直す（ログイン後にこの画面へ戻る）
 */
export function SaveFailure({
  kind,
  body,
  settings,
  localDate,
  onRetry,
  onReselect,
  onRefresh,
  retryLocked = false,
  lockedNote,
}: {
  kind: SaveFailureKind;
  settings?: { ready: boolean; meaningChanged: boolean; loading: boolean; failed: boolean; reload: () => Promise<void> };
  /** failed のときの本文（「やった・20分」はまだ記録されていません…など）。 */
  body: string;
  localDate: string;
  onRetry: () => void;
  onReselect: () => void;
  onRefresh: () => void;
  /** もう片方の日を編集している間は「もう一度保存」を押せなくする（#88）。 */
  retryLocked?: boolean;
  /** retryLocked のときに、押せない理由として出す一文。 */
  lockedNote?: string;
}) {
  const location = useLocation();
  if (kind === 'settings') return <ErrorPanel focusTitle title={todayCopy.settingsConflict.title} action={<div className="fr-savefail__actions">
    <Button busy={settings?.loading ?? false} onClick={() => void settings?.reload()}>{todayCopy.settingsConflict.reload}</Button>
    <Button disabled={!settings?.ready || settings.meaningChanged || retryLocked || settings.loading} onClick={onRetry}>{todayCopy.settingsConflict.retry}</Button>
    <Button disabled={!settings?.ready || settings.loading} onClick={onReselect}>{todayCopy.reselect}</Button>
  </div>}>
    {body}<br />{todayCopy.settingsConflict.body}
    {settings?.failed ? <p role="alert">{todayCopy.settingsConflict.reloadFailed}</p> : null}
    {settings?.meaningChanged ? <p role="alert">{todayCopy.settingsConflict.meaningChanged}</p> : null}
  </ErrorPanel>;
  if (kind === 'signed-out') {
    return (
      <ErrorPanel focusTitle
        title={todayCopy.signedOutTitle}
        action={
          <Link to="/login" search={{ redirect: location.href, reason: 'expired' }} className="fr-btn fr-btn--secondary">
            {todayCopy.signIn}
          </Link>
        }
      >
        {todayCopy.signedOutSave}
      </ErrorPanel>
    );
  }
  if (kind === 'date' || kind === 'day-changed') {
    return (
      <ErrorPanel focusTitle
        title={kind === 'day-changed' ? todayCopy.dateChangedTitle : todayCopy.dateFailedTitle}
        action={
          <Button variant="primary" block onClick={onRefresh}>
            {todayCopy.refresh}
          </Button>
        }
      >
        {kind === 'day-changed' ? todayCopy.dateChanged(longDate(localDate)) : todayCopy.dateFailed(longDate(localDate))}
      </ErrorPanel>
    );
  }
  return (
    <ErrorPanel focusTitle
      title={todayCopy.saveFailedTitle}
      action={
        <div className="fr-savefail__actions">
          <Button variant="primary" icon="retry" disabled={retryLocked} onClick={onRetry}>
            {todayCopy.retrySave}
          </Button>
          <Button variant="secondary" onClick={onReselect}>
            {todayCopy.reselect}
          </Button>
        </div>
      }
    >
      {body}
      {retryLocked && lockedNote ? (
        <>
          <br />
          {lockedNote}
        </>
      ) : null}
    </ErrorPanel>
  );
}
