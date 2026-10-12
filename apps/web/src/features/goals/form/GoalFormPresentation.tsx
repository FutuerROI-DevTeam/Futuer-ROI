import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Goal } from '@contracts';
import { goalsCopy } from '../../../copy/goals.ts';
import { todayCopy } from '../../../copy/today.ts';
import { isNotFound, isUnauthenticated } from '../../../api/http.ts';
import { AppBar } from '../../../ui/components/AppBar.tsx';
import { DeskHeader } from '../../../ui/components/DeskHeader.tsx';
import { PageTitle } from '../../../ui/components/PageTitle.tsx';
import { Button } from '../../../ui/components/Button.tsx';
import { Icon } from '../../../ui/components/Icon.tsx';
import { ErrorPanel } from '../../../ui/components/Notice.tsx';
import { Spinner } from '../../../ui/components/Spinner.tsx';
import { SignedOutPanel } from '../GoalStates.tsx';
import { createFailureKind } from '../create-attempt.ts';
import { isEditSaveResultUnknown } from '../goal-form.ts';
import { isCreateResultDeleted, isEditConflict } from './form-recovery.ts';

const c = goalsCopy;
const f = goalsCopy.form;

// 描画だけを担う。保存・認証・復旧操作は親からcallbackで受け取る。
export function FormShell({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="fr fr-page fr-page--desk fr-page--goalform">
      <PageTitle title={title} />
      <AppBar title={title} leading={<CloseLink />} />
      <DeskHeader back={<ListCrumb />} title={title} titleAs="p" />
      <FormIntro title={title} />
      <div className="fr-goals__pad">{body}</div>
    </div>
  );
}

export function FormIntro({ title, guide, goalTitle }: { title: string; guide?: string; goalTitle?: string }) {
  return (
    <header className="fr-goalform__intro">
      {goalTitle ? <p className="fr-goalform__goal-name">{goalTitle}</p> : null}
      <h1>{title}</h1>
      {guide ? <p className="fr-goalform__guide">{guide}</p> : null}
    </header>
  );
}

export function CloseLink() {
  return (
    <Link to="/goals" className="fr-icon-btn" aria-label={f.close}>
      <Icon name="close" />
    </Link>
  );
}

/** デスクトップ幅の戻り先（Goal一覧）。 */
export function ListCrumb() {
  return (
    <Link to="/goals" className="fr-btn fr-btn--text">
      <Icon name="back" size={18} />
      {c.crumbList}
    </Link>
  );
}

/** デスクトップ幅の編集の戻り先（そのGoalのToday。表示は Today の戻り先と同じ「Goal一覧 / タイトル」）。 */
export function GoalCrumb({ goal }: { goal: Goal }) {
  return (
    <Link to="/goals/$goalId" params={{ goalId: goal.id }} className="fr-btn fr-btn--text">
      <Icon name="back" size={18} />
      {todayCopy.breadcrumbTrail(goal.title)}
    </Link>
  );
}

export function FormLoading() {
  return (
    <p className="fr-goals__help fr-goals__loading" role="status">
      <Spinner />
      {c.loadingVisible}
    </p>
  );
}

/** 表示した後の再取得の失敗。フォームと入力はそのまま残す。 */
export function RefreshFailed({ error, onRetry, editConflict }: { error: unknown; onRetry: () => void; editConflict: boolean }) {
  if (isUnauthenticated(error)) {
    return <SignedOutPanel body={c.signedOut.formBody} newTab />;
  }
  return (
    <ErrorPanel
      title={f.refreshFailed.title}
      action={
        <Button icon="retry" onClick={onRetry}>
          {c.loadError.retry}
        </Button>
      }
    >
      {isNotFound(error) ? f.refreshFailed.notFound : editConflict ? f.refreshFailed.conflictBody : f.refreshFailed.body}
    </ErrorPanel>
  );
}

/**
 * 入力を残し、明示的な拒否と結果不明（通信失敗・5xx）を区別して表示する（R5、#146）。
 */
export function SaveFailure({ error, mode, onReloadLatest, reloadingLatest, onRestartCreate, onResumeCorrection }: {
  error: unknown;
  mode: 'create' | 'edit';
  onReloadLatest: () => Promise<void>;
  reloadingLatest: boolean;
  onRestartCreate?: (() => void) | undefined;
  onResumeCorrection?: (() => void) | undefined;
}) {
  if (isUnauthenticated(error)) {
    return <SignedOutPanel body={c.signedOut.formBody} newTab />;
  }
  if (mode === 'create' && (createFailureKind(error) === 'recovery' || createFailureKind(error) === 'conflict')) {
    return (
      <ErrorPanel
        title={createFailureKind(error) === 'recovery' ? f.createRecovery.unreadableTitle : f.createRecovery.conflictTitle}
        action={
          <>
            {onResumeCorrection ? <Button onClick={onResumeCorrection}>{f.createRecovery.resumeCorrection}</Button> : null}
            <Link to="/goals" className="fr-btn fr-btn--secondary">{f.createRecovery.checkList}</Link>
          </>
        }
      >
        {onResumeCorrection ? f.createRecovery.rejectedCleanupBody : f.createRecovery.checkBody}
      </ErrorPanel>
    );
  }
  if (mode === 'create' && createFailureKind(error) === 'owner') {
    return <SignedOutPanel body={f.createRecovery.ownerBody} newTab />;
  }
  if (mode === 'create' && isCreateResultDeleted(error)) {
    return (
      <ErrorPanel
        title={f.createRecovery.deletedTitle}
        action={onRestartCreate ? <Button onClick={onRestartCreate}>{f.createRecovery.restart}</Button> : undefined}
      >
        {f.createRecovery.deletedBody}
      </ErrorPanel>
    );
  }
  if (isEditConflict(error)) {
    // 回答またはGoal設定の版が古い。保存済みに見せず、入力を残して最新を読み直してもらう。
    return (
      <ErrorPanel
        title={f.answerConflict.title}
        action={
          <Button icon="retry" busy={reloadingLatest} onClick={() => void onReloadLatest()}>
            {f.answerConflict.reload}
          </Button>
        }
      >
        {f.answerConflict.body}
      </ErrorPanel>
    );
  }
  if (mode === 'edit' && isEditSaveResultUnknown(error)) {
    // 結果不明を未保存と断定せず、最新を読んで確認してもらう（R5）。
    return (
      <ErrorPanel
        title={f.saveUnknown.title}
        action={
          <Button icon="retry" busy={reloadingLatest} onClick={() => void onReloadLatest()}>
            {f.answerConflict.reload}
          </Button>
        }
      >
        {f.saveUnknown.body}
      </ErrorPanel>
    );
  }
  return (
    <ErrorPanel title={f.saveFailed.title}>
      {mode === 'create' ? f.saveFailed.createBody : f.saveFailed.editBody}
    </ErrorPanel>
  );
}
