import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { SessionUnreachableError } from '../auth/session.ts';
import { appCopy } from '../copy/app.ts';
import { MainLandmark } from './MainLandmark.tsx';
import { AppBar } from '../ui/components/AppBar.tsx';
import { Button } from '../ui/components/Button.tsx';
import { ErrorPanel } from '../ui/components/Notice.tsx';
import { PageTitle } from '../ui/components/PageTitle.tsx';
import { Spinner } from '../ui/components/Spinner.tsx';
import '../ui/tokens.css';
import '../ui/page.css';
import '../ui/components/Button.css';
import './route-states.css';

const c = appCopy;

/** 定義していないURL（ルーター全体の既定。デザイン B-notfound と同じ形）。 */
export function NotFoundPage() {
  return (
    <MainLandmark className="fr fr-page">
      <PageTitle title={c.notFound.title} />
      <AppBar title={c.name} />
      <section className="fr-route__top">
        <h1 className="fr-route__heading">{c.notFound.title}</h1>
      </section>
      <div className="fr-route__pad">
        <ErrorPanel
          title={c.notFound.panel}
          action={
            <Link to="/goals" className="fr-btn fr-btn--secondary">
              {c.notFound.back}
            </Link>
          }
        >
          {c.notFound.body}
        </ErrorPanel>
      </div>
    </MainLandmark>
  );
}

/**
 * ルートの読み込み・描画の失敗（ルーター全体の既定。デザイン B-error と同じ形）。
 * ログインの確認が通信の失敗でできなかったときは「接続できませんでした」とし、ログイン画面へは送らない。
 * 再読み込みはルートの読み込み（ログインの確認を含む）からやり直す。
 */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const unreachable = error instanceof SessionUnreachableError;
  const title = unreachable ? c.error.unreachableTitle : c.error.title;
  return (
    <MainLandmark className="fr fr-page">
      <PageTitle title={title} />
      <AppBar title={c.name} />
      <div className="fr-route__pad fr-route__pad--top">
        <ErrorPanel
          title={title}
          action={
            <Button
              icon="retry"
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              {c.error.retry}
            </Button>
          }
        >
          {unreachable ? c.error.unreachable : c.error.body}
        </ErrorPanel>
      </div>
    </MainLandmark>
  );
}

/** ルートの読み込み中（ログインの確認が遅いとき。ルーターの既定の待ち時間を過ぎたら出す）。 */
export function RoutePendingPage() {
  return (
    <MainLandmark className="fr fr-page">
      <AppBar title={c.name} />
      <p className="fr-route__loading" role="status">
        <Spinner />
        {c.loading}
      </p>
    </MainLandmark>
  );
}
