import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { Button, Checkbox, FormField, Input } from '@golink/ui';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../firestore/errors';
import { useTranslation } from '../i18n/I18nProvider';
import { AuthAlert, AuthHeading } from './AuthLayout';

/** Champ mot de passe avec bouton afficher / masquer. */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  id,
  invalid,
  placeholder,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      id={id}
      size="lg"
      type={visible ? 'text' : 'password'}
      autoComplete={autoComplete}
      required
      value={value}
      invalid={invalid}
      placeholder={placeholder}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
      leading={<LockKeyhole />}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t('auth.password.hide') : t('auth.password.show')}
          aria-pressed={visible}
          className="grid size-7 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg"
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      }
    />
  );
}

export interface LoginScreenProps {
  eyebrow: string;
  description: string;
  forgotPath?: string;
}

/** Formulaire de connexion e-mail / mot de passe. */
export function LoginScreen({ eyebrow, description, forgotPath = '/mot-de-passe-oublie' }: LoginScreenProps) {
  const { signIn } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // La redirection est faite par la garde de route dès que la session est ouverte.
      await signIn(email, password, remember);
    } catch (caught) {
      setError(errorMessage(caught, t('auth.login.failed')));
      setLoading(false);
    }
  }

  return (
    <>
      <AuthHeading eyebrow={eyebrow} title={t('auth.login.title')} description={description} />
      <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
        <FormField label={t('auth.login.email')}>
          <Input
            size="lg"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('auth.login.emailPlaceholder')}
            leading={<Mail />}
          />
        </FormField>
        <FormField
          label={t('auth.login.password')}
          aside={
            <Link to={forgotPath} className="font-medium text-primary-soft-fg hover:underline">
              {t('auth.login.forgot')}
            </Link>
          }
        >
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </FormField>
        <Checkbox
          label={t('auth.login.remember')}
          description={t('auth.login.rememberHint')}
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked === true)}
        />
        {error && <AuthAlert>{error}</AuthAlert>}
        <Button type="submit" variant="primary" size="lg" block loading={loading} rightIcon={<ArrowRight className="rtl:-scale-x-100" />}>
          {t('auth.login.submit')}
        </Button>
      </form>
    </>
  );
}
