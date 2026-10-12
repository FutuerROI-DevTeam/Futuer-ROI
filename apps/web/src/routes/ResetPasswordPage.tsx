import { Link } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { runAuthAction } from '../auth/action.ts';
import { authClient, describeAuthError } from '../auth/client.ts';
import { validateNewPassword, type NewPasswordErrors, type ResetSearch } from '../auth/reset.ts';
import { appCopy, authCopy } from '../copy/app.ts';
import { Button } from '../ui/components/Button.tsx';
import { Field, TextInput, fieldAria } from '../ui/components/FormField.tsx';
import { Icon } from '../ui/components/Icon.tsx';
import { PageTitle } from '../ui/components/PageTitle.tsx';
import '../ui/tokens.css';
import '../ui/components/Button.css';
import './auth.css';

const c = authCopy.reset;

/**
 * 新しいパスワードの設定（/reset-password）。メールのリンクはAPIを経由してここへ戻る。
 * - `?token=` があれば入力フォーム。無い・`?error=INVALID_TOKEN` なら「使えないリンク」として再要求へ誘導
 * - 保存時のINVALID_TOKEN（期限切れ・使用済み）も同じ案内にする
 * - 成功後はログインへ進める（自動ログインはしない。Better Authの既定どおり）
 */
export function ResetPasswordPage({ search }: { search: ResetSearch }) {
  const [fieldErrors, setFieldErrors] = useState<NewPasswordErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(search.token ? 'form' : 'invalid');
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorCount = Object.keys(fieldErrors).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !search.token) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');
    const errors = validateNewPassword(password, confirm);
    setFieldErrors(errors);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const token = search.token;
    await runAuthAction(() => authClient.resetPassword({ newPassword: password, token }), {
      setBusy,
      onError: (failure) => {
        if (failure.code === 'INVALID_TOKEN') setState('invalid');
        else setServerError(describeAuthError(failure.code, failure.message));
      },
      onSuccess: async () => setState('done'),
    });
  }

  const title = state === 'done' ? c.doneTitle : state === 'invalid' ? c.invalidTitle : c.newTitle;
  return (
    <main className="fr fr-auth">
      <PageTitle title={title} />
      <div className="fr-auth__head">
        <Link to="/" className="fr-auth__name fr-auth__brand-link">{appCopy.name}</Link>
        <p className="fr-auth__tagline">{appCopy.tagline}</p>
      </div>

      <section className="fr-auth__card" aria-labelledby="reset-title">
        {state === 'done' ? (
          <div className="fr-auth__done" role="status">
            <div className="fr-auth__intro">
              <h1 id="reset-title">{c.doneTitle}</h1>
              <p>{c.doneBody}</p>
            </div>
            <Link to="/login" search={{ redirect: '/goals' }} className="fr-btn fr-btn--primary fr-btn--block">{authCopy.login}</Link>
          </div>
        ) : state === 'invalid' ? (
          <div className="fr-auth__done" role="alert">
            <div className="fr-auth__intro">
              <h1 id="reset-title">{c.invalidTitle}</h1>
              <p>{c.invalidBody}</p>
            </div>
            <Link to="/forgot-password" search={{ redirect: '/goals' }} className="fr-btn fr-btn--primary fr-btn--block">{c.requestAgain}</Link>
            <Link to="/login" search={{ redirect: '/goals' }} className="fr-auth__link">{c.backToLogin}</Link>
          </div>
        ) : (
          <>
            <div className="fr-auth__intro">
              <h1 id="reset-title">{c.newTitle}</h1>
              <p>{c.newIntro}</p>
            </div>

            {errorCount > 0 || serverError ? (
              <div className="fr-error fr-auth__summary" role="alert" tabIndex={-1} ref={summaryRef}>
                <p className="fr-error__title">
                  <Icon name="info" size={20} />
                  {errorCount > 0 ? authCopy.summary(errorCount) : serverError}
                </p>
              </div>
            ) : null}

            <form className="fr-auth__form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
              <Field id="reset-password" label={c.newPassword} error={fieldErrors.password} help={authCopy.passwordHelp}>
                <div className="fr-inwrap">
                  <TextInput
                    id="reset-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    disabled={busy}
                    invalid={Boolean(fieldErrors.password)}
                    {...fieldAria('reset-password', { error: fieldErrors.password, help: authCopy.passwordHelp })}
                  />
                  <button
                    type="button"
                    className="fr-icon-btn fr-auth__eye"
                    aria-label={showPassword ? authCopy.hidePassword : authCopy.showPassword}
                    aria-pressed={showPassword}
                    disabled={busy}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={20} />
                  </button>
                </div>
              </Field>
              <Field id="reset-confirm" label={c.confirm} error={fieldErrors.confirm}>
                <TextInput
                  id="reset-confirm"
                  name="confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  disabled={busy}
                  invalid={Boolean(fieldErrors.confirm)}
                  {...fieldAria('reset-confirm', { error: fieldErrors.confirm })}
                />
              </Field>
              <Button type="submit" variant="primary" block busy={busy}>
                {busy ? c.newSending : c.newSubmit}
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
