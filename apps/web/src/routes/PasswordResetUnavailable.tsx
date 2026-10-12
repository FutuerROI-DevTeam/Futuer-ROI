import { Link } from '@tanstack/react-router';
import { PASSWORD_RESET_UNAVAILABLE_MESSAGE } from '../../../api/src/auth/password-reset-policy.ts';
import { appCopy, authCopy } from '../copy/app.ts';
import { PageTitle } from '../ui/components/PageTitle.tsx';
import '../ui/tokens.css';
import '../ui/components/Button.css';
import './auth.css';

export function PasswordResetUnavailable() {
  return (
    <main className="fr fr-auth">
      <PageTitle title="パスワード再設定" />
      <div className="fr-auth__head">
        <Link to="/" className="fr-auth__name fr-auth__brand-link">{appCopy.name}</Link>
        <p className="fr-auth__tagline">{appCopy.tagline}</p>
      </div>
      <section className="fr-auth__card" aria-labelledby="reset-title">
        <div className="fr-auth__intro">
          <h1 id="reset-title">パスワード再設定</h1>
          <p>{PASSWORD_RESET_UNAVAILABLE_MESSAGE}。</p>
          <p>以前届いたメールのリンクからも、現在は再設定できません。</p>
        </div>
        <Link to="/login" search={{ redirect: '/goals' }} className="fr-btn fr-btn--primary fr-btn--block">{authCopy.reset.backToLogin}</Link>
      </section>
    </main>
  );
}
