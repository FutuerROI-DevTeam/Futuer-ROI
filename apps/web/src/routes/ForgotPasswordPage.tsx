import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { runAuthAction } from '../auth/action.ts';
import { authClient, describeAuthError, retryAfterSeconds } from '../auth/client.ts';
import { waitUntil } from '../auth/form.ts';
import { resetRedirectTarget, validateResetRequest } from '../auth/reset.ts';
import { appCopy, authCopy } from '../copy/app.ts';
import { Button } from '../ui/components/Button.tsx';
import { Field, TextInput, fieldAria } from '../ui/components/FormField.tsx';
import { Icon } from '../ui/components/Icon.tsx';
import { PageTitle } from '../ui/components/PageTitle.tsx';
import '../ui/tokens.css';
import '../ui/components/Button.css';
import './auth.css';

const DEFAULT_RETRY_SECONDS = 60;
const c = authCopy.reset;

/**
 * パスワード再設定メールの要求（/forgot-password）。
 * - 送る前にメールアドレスを検査し、サーバーの失敗は同じ位置に出す
 * - 成功後は登録の有無を区別せず「登録されていれば届く」と伝える（APIも同じ応答）
 * - 回数制限（429）はログインと同じく再開できる時刻を伝える
 */
export function ForgotPasswordPage() {
  const [emailError, setEmailError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (retryAt === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const wait = retryAt === null ? null : waitUntil(retryAt, now);
  useEffect(() => {
    if (retryAt !== null && wait === null) setRetryAt(null);
  }, [retryAt, wait]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || wait) return;
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    const errors = validateResetRequest(email);
    setEmailError(errors.email);
    setServerError(null);
    if (errors.email) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    let limited = false;
    await runAuthAction(
      () =>
        authClient.requestPasswordReset(
          { email, redirectTo: resetRedirectTarget(window.location.origin) },
          {
            onError: (context: { response: Response }) => {
              if (context.response.status === 429) {
                limited = true;
                setRetryAt(Date.now() + (retryAfterSeconds(context.response) ?? DEFAULT_RETRY_SECONDS) * 1000);
                setNow(Date.now());
              }
            },
          },
        ),
      {
        setBusy,
        onError: (failure) => {
          if (!limited) setServerError(describeAuthError(failure.code, failure.message));
        },
        onSuccess: async () => setSentTo(email),
      },
    );
  }

  return (
    <main className="fr fr-auth">
      <PageTitle title={c.requestTitle} />
      <div className="fr-auth__head">
        <Link to="/" className="fr-auth__name fr-auth__brand-link">{appCopy.name}</Link>
        <p className="fr-auth__tagline">{appCopy.tagline}</p>
      </div>

      <section className="fr-auth__card" aria-labelledby="reset-title">
        {sentTo !== null ? (
          <div className="fr-auth__done" role="status">
            <div className="fr-auth__intro">
              <h1 id="reset-title">{c.sentTitle}</h1>
              <p>{c.sentBody(sentTo)}</p>
            </div>
            <Link to="/login" search={{ redirect: '/goals' }} className="fr-btn fr-btn--primary fr-btn--block">{c.backToLogin}</Link>
            <Button variant="text" block onClick={() => setSentTo(null)}>{c.resend}</Button>
          </div>
        ) : (
          <>
            <div className="fr-auth__intro">
              <h1 id="reset-title">{c.requestTitle}</h1>
              <p>{c.requestIntro}</p>
            </div>

            {wait ? (
              <section className="fr-auth__wait" role="status">
                <p className="fr-auth__wait-title">
                  <Icon name="clock" size={20} />
                  {authCopy.waitTitle}
                </p>
                <p>{authCopy.waitBody(c.requestAction, wait.minutes, wait.clock)}</p>
              </section>
            ) : emailError || serverError ? (
              <div className="fr-error fr-auth__summary" role="alert" tabIndex={-1} ref={summaryRef}>
                <p className="fr-error__title">
                  <Icon name="info" size={20} />
                  {emailError ? authCopy.summary(1) : serverError}
                </p>
              </div>
            ) : null}

            <form className="fr-auth__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
              <Field id="reset-email" label={authCopy.email} error={emailError}>
                <TextInput
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  disabled={busy}
                  invalid={Boolean(emailError)}
                  {...fieldAria('reset-email', { error: emailError })}
                />
              </Field>
              <Button type="submit" variant="primary" block busy={busy} disabled={wait !== null} {...(wait ? { icon: 'clock' as const } : {})}>
                {busy ? c.requestSending : wait ? authCopy.waitButton(wait.clock, c.requestAction) : c.requestSubmit}
              </Button>
            </form>
            <p className="fr-auth__aside">
              <Link to="/login" search={{ redirect: '/goals' }} className="fr-auth__link">{c.backToLogin}</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
