import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authClient, describeAuthError, retryAfterSeconds } from '../auth/client.ts';
import { runAuthAction } from '../auth/action.ts';
import { validateAuth, waitUntil, type AuthFieldErrors, type AuthMode } from '../auth/form.ts';
import { afterAuthTarget, type AuthReason } from '../auth/redirect.ts';
import { appCopy, authCopy } from '../copy/app.ts';
import { Button } from '../ui/components/Button.tsx';
import { Field, TextInput, fieldAria } from '../ui/components/FormField.tsx';
import { Icon } from '../ui/components/Icon.tsx';
import { InsufficientNotice } from '../ui/components/Notice.tsx';
import { PageTitle } from '../ui/components/PageTitle.tsx';
import '../ui/tokens.css';
import '../ui/components/Button.css';
import './auth.css';

const DEFAULT_RETRY_SECONDS = 60;
const c = authCopy;

/**
 * ログイン・新規登録（R-01、デザイン A1〜A5）。/login・/register
 * 2つは入力項目が同じなので1つの画面で扱い、上の切り替えでルートを移る（戻り先と理由は引き継ぐ）。
 * - 送る前に項目ごとに検査し、まとめて伝える（A2）。サーバーの失敗は同じ位置に出す
 * - 送信中は入力とボタンを止める（A3）
 * - 回数制限（429）は再開できる時刻を伝え、その時刻まで押せなくする（A4）
 * - ログインが切れて来たときは、その旨を伝える（A5）
 */
export function AuthPage({ mode, redirectTo, reason }: { mode: AuthMode; redirectTo: string; reason?: AuthReason | undefined }) {
  const navigate = useNavigate();
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  const action = mode === 'login' ? c.login : c.register;
  // ログイン／新規登録を切り替えても、戻り先とログイン切れの理由を引き継ぐ（新規登録から戻っても案内を消さない）
  const switchSearch = reason ? { redirect: redirectTo, reason } : { redirect: redirectTo };
  const errorCount = Object.keys(fieldErrors).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || wait) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const errors = validateAuth(mode, email, password);
    setFieldErrors(errors);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      // 何を直せばよいかを先に読み上げる
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    let limited = false;
    const fetchOptions = {
      onError: (context: { response: Response }) => {
        if (context.response.status === 429) {
          limited = true;
          setRetryAt(Date.now() + (retryAfterSeconds(context.response) ?? DEFAULT_RETRY_SECONDS) * 1000);
          setNow(Date.now());
        }
      },
    };
    await runAuthAction(
      () =>
        mode === 'register'
          ? authClient.signUp.email({ email, password, name: email.split('@')[0] || email }, fetchOptions)
          : authClient.signIn.email({ email, password }, fetchOptions),
      {
        setBusy,
        onError: (failure) => {
          if (!limited) setServerError(describeAuthError(failure.code, failure.message));
        },
        // ログイン後に「戻る」でこの画面へ戻らないよう、履歴を置き換える。新規登録の後はGoal一覧へ（#249）
        onSuccess: () => navigate({ to: afterAuthTarget(mode, redirectTo), replace: true }),
      },
    );
  }

  return (
    <main className="fr fr-auth">
      <PageTitle title={action} />
      <div className="fr-auth__head">
        <Link to="/" className="fr-auth__name fr-auth__brand-link">{appCopy.name}</Link>
        <p className="fr-auth__tagline">{appCopy.tagline}</p>
      </div>

      <section className="fr-auth__card" aria-labelledby="auth-title">
        <div className="fr-auth__intro">
          <h1 id="auth-title">{action}</h1>
          <p>{c.intro[mode]}</p>
        </div>
        {reason === 'expired' ? <InsufficientNotice role="status">{c.expired}</InsufficientNotice> : null}

        <nav className="fr-auth__seg" aria-label={c.tabs}>
          <Link to="/login" search={switchSearch} replace aria-current={mode === 'login' ? 'page' : undefined}>
            {c.login}
          </Link>
          <Link to="/register" search={switchSearch} replace aria-current={mode === 'register' ? 'page' : undefined}>
            {c.register}
          </Link>
        </nav>

        {wait ? (
          <section className="fr-auth__wait" role="status">
            <p className="fr-auth__wait-title">
              <Icon name="clock" size={20} />
              {c.waitTitle}
            </p>
            <p>{c.waitBody(action, wait.minutes, wait.clock)}</p>
          </section>
        ) : errorCount > 0 || serverError ? (
          <div className="fr-error fr-auth__summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <p className="fr-error__title">
              <Icon name="info" size={20} />
              {errorCount > 0 ? c.summary(errorCount) : serverError}
            </p>
          </div>
        ) : null}

        <form className="fr-auth__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
          <Field id="auth-email" label={c.email} error={fieldErrors.email}>
            <TextInput
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              disabled={busy}
              invalid={Boolean(fieldErrors.email)}
              {...fieldAria('auth-email', { error: fieldErrors.email })}
            />
          </Field>
          <Field id="auth-password" label={c.password} error={fieldErrors.password} help={mode === 'register' ? c.passwordHelp : undefined}>
            <div className="fr-inwrap">
              <TextInput
                id="auth-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                disabled={busy}
                invalid={Boolean(fieldErrors.password)}
                {...fieldAria('auth-password', { error: fieldErrors.password, help: mode === 'register' ? c.passwordHelp : undefined })}
              />
              <button
                type="button"
                className="fr-icon-btn fr-auth__eye"
                aria-label={showPassword ? c.hidePassword : c.showPassword}
                aria-pressed={showPassword}
                disabled={busy}
                onClick={() => setShowPassword((v) => !v)}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </div>
          </Field>
          <Button type="submit" variant="primary" block busy={busy} disabled={wait !== null} {...(wait ? { icon: 'clock' as const } : {})}>
            {busy ? c.sending[mode] : wait ? c.waitButton(wait.clock, action) : c.submit[mode]}
          </Button>
        </form>
      </section>
    </main>
  );
}
