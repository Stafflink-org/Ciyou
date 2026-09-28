import type { ReactNode } from 'react';
import { BellRing, Layers, ScrollText } from 'lucide-react';
import {
  AccessDeniedScreen,
  AuthLayout,
  ForgotPasswordScreen,
  LoginScreen,
  SetPasswordScreen,
  useAuth,
  useDocumentTitle,
  useTranslation,
} from '@golink/web';

function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth');
  const highlights = [
    { icon: <BellRing />, title: t('highlights.alerts.title'), text: t('highlights.alerts.text') },
    { icon: <Layers />, title: t('highlights.bulk.title'), text: t('highlights.bulk.text') },
    { icon: <ScrollText />, title: t('highlights.audit.title'), text: t('highlights.audit.text') },
  ];
  return (
    <AuthLayout
      caption={t('caption')}
      headline={
        <>
          {t('headline1')}
          <br />
          <span className="text-primary">{t('headline2')}</span>
        </>
      }
      tagline={t('tagline')}
      highlights={highlights}
    >
      {children}
    </AuthLayout>
  );
}

export function LoginPage() {
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.login'));
  return (
    <Layout>
      <LoginScreen eyebrow={t('eyebrow')} description={t('description')} />
    </Layout>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.forgot'));
  return (
    <Layout>
      <ForgotPasswordScreen />
    </Layout>
  );
}

export function SetPasswordPage() {
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.set'));
  return (
    <Layout>
      <SetPasswordScreen />
    </Layout>
  );
}

/** Page « Accès refusé » (redirections explicites depuis l'application). */
export function AccessDeniedPage() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.denied'));
  return <AccessDeniedScreen caption={t('caption')} email={user?.email} onSignOut={user ? () => void signOut() : undefined} />;
}
