import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ChefHat, Timer, TrendingUp } from 'lucide-react';
import { toast } from '@golink/ui';
import {
  AccessDeniedScreen,
  AuthLayout,
  ForgotPasswordScreen,
  FullScreenLoader,
  LoginScreen,
  SetPasswordScreen,
  useAuth,
  useDocumentTitle,
  useTranslation,
} from '@golink/web';
import { callFunction, errorMessage } from '@/lib/firestore';
import { activeRestaurantKey } from './RestaurantAccess';

export function AuthPageLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth');
  const highlights = [
    { icon: <Timer />, title: t('highlights.live.title'), text: t('highlights.live.text') },
    { icon: <ChefHat />, title: t('highlights.menu.title'), text: t('highlights.menu.text') },
    { icon: <TrendingUp />, title: t('highlights.figures.title'), text: t('highlights.figures.text') },
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
    <AuthPageLayout>
      <LoginScreen eyebrow={t('eyebrow')} description={t('description')} />
      <p className="mt-6 text-center text-sm text-fg-muted">
        {t('signup.cta')}{' '}
        <Link to="/inscription" className="font-medium text-primary-soft-fg hover:underline">
          {t('signup.link')}
        </Link>
      </p>
    </AuthPageLayout>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.forgot'));
  return (
    <AuthPageLayout>
      <ForgotPasswordScreen />
    </AuthPageLayout>
  );
}

export function SetPasswordPage() {
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.set'));
  return (
    <AuthPageLayout>
      <SetPasswordScreen />
    </AuthPageLayout>
  );
}

const acceptInvitation = callFunction<{ restaurantId: string }, { claimsUpdated: boolean }>('acceptInvitation');

/**
 * Retour d'invitation (/invitation?restaurant=…) : l'arrivée dans l'équipe est
 * enregistrée (acceptInvitation), l'établissement qui a invité devient
 * l'établissement actif, puis l'accueil s'ouvre (connexion si besoin).
 */
export function InvitationRedirect() {
  const { user, refreshClaims } = useAuth();
  const [params] = useSearchParams();
  const restaurantId = params.get('restaurant');
  const [done, setDone] = useState(!restaurantId);

  useEffect(() => {
    if (!user || !restaurantId) return;
    let cancelled = false;
    try {
      window.localStorage.setItem(activeRestaurantKey(user.uid), JSON.stringify(restaurantId));
    } catch {
      // Stockage indisponible : le premier établissement accessible sera ouvert.
    }
    acceptInvitation({ restaurantId })
      .then(async ({ claimsUpdated }) => {
        if (claimsUpdated) await refreshClaims();
      })
      .catch((caught: unknown) => toast.error(errorMessage(caught)))
      .finally(() => {
        if (!cancelled) setDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, restaurantId, refreshClaims]);

  return done ? <Navigate to="/" replace /> : <FullScreenLoader />;
}

/** Page « Accès refusé » (redirections explicites depuis l'application). */
export function AccessDeniedPage() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation('auth');
  useDocumentTitle(t('titles.denied'));
  return <AccessDeniedScreen caption={t('caption')} email={user?.email} onSignOut={user ? () => void signOut() : undefined} />;
}
