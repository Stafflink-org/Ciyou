import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { ArrowLeft, Check, MailCheck, Mail } from 'lucide-react';
import { Button, FormField, Input, Skeleton, cn } from '@golink/ui';
import { useAuth } from '../auth/AuthProvider';
import { errorCode, errorMessage } from '../firestore/errors';
import { useTranslation } from '../i18n/I18nProvider';
import { AuthAlert, AuthHeading } from './AuthLayout';
import { PasswordInput } from './LoginScreen';

function BackToLogin({ to = '/connexion' }: { to?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
    >
      <ArrowLeft className="size-4 rtl:-scale-x-100" />
      {t('auth.backToLogin')}
    </Link>
  );
}

/* ------------------------------------------------------ Mot de passe oublié */

/** Demande d'un lien de réinitialisation par e-mail. */
export function ForgotPasswordScreen({ loginPath = '/connexion' }: { loginPath?: string }) {
  const { sendPasswordReset } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email, loginPath);
      setSentTo(email.trim());
    } catch (caught) {
      // Un compte inconnu reçoit la même réponse qu'un compte existant (pas d'énumération).
      if (errorCode(caught) === 'auth/user-not-found') setSentTo(email.trim());
      else setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <>
        <span className="mb-6 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary-soft-fg">
          <MailCheck className="size-6" />
        </span>
        <AuthHeading
          title={t('auth.forgot.sentTitle')}
          description={<Emphasized text={t('auth.forgot.sentDescription', { email: '' })} value={sentTo} />}
        />
        <Button variant="secondary" size="lg" block onClick={() => setSentTo(null)}>
          {t('auth.forgot.otherAddress')}
        </Button>
        <BackToLogin to={loginPath} />
      </>
    );
  }

  return (
    <>
      <AuthHeading
        eyebrow={t('auth.forgot.eyebrow')}
        title={t('auth.forgot.title')}
        description={t('auth.forgot.description')}
      />
      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
        <FormField label={t('auth.login.email')}>
          <Input
            size="lg"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('auth.login.emailPlaceholder')}
            leading={<Mail />}
          />
        </FormField>
        {error && <AuthAlert>{error}</AuthAlert>}
        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          {t('auth.forgot.submit')}
        </Button>
      </form>
      <BackToLogin to={loginPath} />
    </>
  );
}

/* ------------------------------------------------- Définir le mot de passe */

const RULES = [
  { id: 'length', test: (value: string) => value.length >= 10 },
  { id: 'letter', test: (value: string) => /\p{L}/u.test(value) },
  { id: 'digit', test: (value: string) => /\d/.test(value) },
  { id: 'symbol', test: (value: string) => /[^\p{L}\d]/u.test(value) },
] as const;

/** Insère une valeur mise en évidence à la place du repère  d'un texte traduit. */
function Emphasized({ text, value }: { text: string; value: string }) {
  const [before, after = ''] = text.split('');
  return (
    <>
      {before}
      <strong className="font-semibold text-fg" dir="auto">
        {value}
      </strong>
      {after}
    </>
  );
}

function PasswordRules({ value }: { value: string }) {
  const { t } = useTranslation();
  const passed = RULES.filter((rule) => rule.test(value)).length;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" aria-hidden="true">
        {RULES.map((rule, index) => (
          <span
            key={rule.id}
            className={cn(
              'h-1 flex-1 rounded-full bg-surface-3 transition-colors duration-300',
              index < passed && (passed === RULES.length ? 'bg-success' : passed >= 2 ? 'bg-warning' : 'bg-danger'),
            )}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li key={rule.id} className={cn('flex items-center gap-1.5 text-xs', ok ? 'text-fg' : 'text-fg-subtle')}>
              <span
                className={cn(
                  'grid size-4 place-items-center rounded-full border transition-colors',
                  ok ? 'border-success bg-success text-white' : 'border-border-strong',
                )}
              >
                {ok && <Check className="size-2.5 stroke-[3.5]" />}
              </span>
              {t(`auth.rules.${rule.id}`)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Choix du mot de passe depuis un lien e-mail (invitation ou réinitialisation) :
 * l'URL porte `oobCode` (code d'action Firebase). La session est ouverte ensuite.
 */
export function SetPasswordScreen({ loginPath = '/connexion', forgotPath = '/mot-de-passe-oublie' }: { loginPath?: string; forgotPath?: string }) {
  const { auth, signIn } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get('oobCode');
  // Page à ouvrir après l'enregistrement (lien d'invitation) : chemin interne uniquement.
  const next = params.get('suite');
  const destination = next && /^\/(?![/\\])/.test(next) ? next : '/';
  const [check, setCheck] = useState<{ status: 'checking' | 'valid' | 'invalid'; email?: string; error?: string }>({
    status: code ? 'checking' : 'invalid',
    error: code ? undefined : t('auth.set.incompleteLink'),
  });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    verifyPasswordResetCode(auth, code).then(
      (email) => !cancelled && setCheck({ status: 'valid', email }),
      (caught) => !cancelled && setCheck({ status: 'invalid', error: errorMessage(caught) }),
    );
    return () => {
      cancelled = true;
    };
  }, [auth, code]);

  const strong = RULES.every((rule) => rule.test(password));
  const mismatch = confirmation.length > 0 && confirmation !== password;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code || !check.email) return;
    if (!strong) return setError(t('auth.set.notStrong'));
    if (password !== confirmation) return setError(t('auth.set.mismatch'));
    setError(null);
    setLoading(true);
    try {
      await confirmPasswordReset(auth, code, password);
      await signIn(check.email, password, true);
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
      setLoading(false);
    }
  }

  if (check.status === 'checking') {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-8 h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    );
  }

  if (check.status === 'invalid') {
    return (
      <>
        <AuthHeading eyebrow={t('auth.set.invalidEyebrow')} title={t('auth.set.invalidTitle')} description={check.error} />
        <Button asChild variant="primary" size="lg" block>
          <Link to={forgotPath}>{t('auth.set.newLink')}</Link>
        </Button>
        <BackToLogin to={loginPath} />
      </>
    );
  }

  return (
    <>
      <AuthHeading
        eyebrow={t('auth.set.eyebrow')}
        title={t('auth.set.title')}
        description={<Emphasized text={t('auth.set.forAccount', { email: '' })} value={check.email ?? ''} />}
      />
      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
        <FormField label={t('auth.set.newPassword')}>
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </FormField>
        <PasswordRules value={password} />
        <FormField label={t('auth.set.confirmation')} error={mismatch ? t('auth.set.mismatchField') : undefined}>
          <PasswordInput value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
        </FormField>
        {error && <AuthAlert>{error}</AuthAlert>}
        <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={!strong || mismatch || !confirmation}>
          {t('auth.set.submit')}
        </Button>
      </form>
      <BackToLogin to={loginPath} />
    </>
  );
}
