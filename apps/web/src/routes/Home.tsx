import { Link } from '@tanstack/react-router';
import { authClient } from '../auth/client.ts';
import { appCopy } from '../copy/app.ts';
import { PageTitle } from '../ui/components/PageTitle.tsx';
import { Spinner } from '../ui/components/Spinner.tsx';
import '../ui/tokens.css';
import '../ui/components/Button.css';
import '../features/today/assets/zen-old-mincho.css';
import './auth.css';

// 公開の入口（P-16）。Goalを取得せず、既存の登録・ログイン・Goal一覧へ接続する。
export function Home() {
  const session = authClient.useSession();
  const c = appCopy.home;
  return (
    <main className="fr fr-auth fr-auth--home">
      <PageTitle />
      <header className="fr-auth__head">
        <p className="fr-auth__name">{appCopy.name}</p>
      </header>
      <section className="fr-welcome" aria-labelledby="welcome-title">
        <div className="fr-welcome__body">
          <p className="fr-welcome__eyebrow">{c.eyebrow}</p>
          <h1 id="welcome-title" className="fr-welcome__title">{c.titleFirst}<br />{c.titleSecond.map(phrase => <span className="fr-welcome__phrase" key={phrase}>{phrase}</span>)}</h1>
          <p className="fr-auth__lead">{c.lead}</p>
          {session.isPending ? (
            <p className="fr-auth__status" role="status"><Spinner />{c.checking}</p>
          ) : session.data ? (
            <Link to="/goals" className="fr-btn fr-btn--primary fr-btn--block">{c.openGoals}</Link>
          ) : (
            <div className="fr-auth__actions">
              <Link to="/register" search={{ redirect: '/goals' }} className="fr-btn fr-btn--primary fr-btn--block">{c.register}</Link>
              <div className="fr-auth__returning">
                <span>{c.returning}</span>
                <Link to="/login" search={{ redirect: '/goals' }} className="fr-btn fr-btn--secondary">{c.login}</Link>
              </div>
            </div>
          )}
        </div>
        <div className="fr-welcome__art" aria-hidden="true" />
      </section>
      <ol className="fr-welcome__steps" aria-label={c.stepsLabel}>
        {c.steps.map((step, index) => <li key={step}><span aria-hidden="true">0{index + 1}</span>{step}</li>)}
      </ol>
      <p className="fr-welcome__note">{c.note}</p>
    </main>
  );
}
