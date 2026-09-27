import { useEffect, useState, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useNavigation, useRouteError } from 'react-router';
import { ArrowLeft, Compass, LockKeyhole, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, Logo, cn } from '@golink/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { LanguageSwitch } from '../i18n/shell';

/** Écran plein page centré (accès refusé, erreur applicative). */
function StatusFrame({ icon, eyebrow, title, description, actions, caption }: {
  icon: ReactNode;
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  caption?: string;
}) {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-6 py-16 text-fg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(55%_100%_at_50%_0%,color-mix(in_oklab,var(--gl-primary)_12%,transparent),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,var(--gl-border)_1px,transparent_1px)] bg-size-[22px_22px] [mask-image:radial-gradient(60%_50%_at_50%_40%,#000,transparent)] opacity-60" />
      <LanguageSwitch className="absolute end-4 top-4 z-10" />
      <div className="relative flex w-full max-w-md flex-col items-center text-center animate-rise">
        <Logo size={30} caption={caption} className="mb-14" />
        <div className="relative mb-6">
          <div className="absolute inset-0 -z-10 scale-[1.8] rounded-full bg-primary-soft blur-2xl" />
          <span className="grid size-14 place-items-center rounded-2xl border border-border bg-surface text-primary shadow-md [&_svg]:size-6">
            {icon}
          </span>
        </div>
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-display text-balance">{title}</h1>
        <div className="mt-3 text-md text-fg-muted text-pretty">{description}</div>
        {actions && <div className="mt-8 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export interface AccessDeniedScreenProps {
  caption?: string;
  title?: ReactNode;
  description?: ReactNode;
  /** E-mail du compte connecté, rappelé à l'utilisateur. */
  email?: string | null;
  onSignOut?: () => void;
  actions?: ReactNode;
}

/** Accès refusé plein écran : compte sans rôle ou sans rattachement pour cette application. */
export function AccessDeniedScreen({
  caption,
  title,
  description,
  email,
  onSignOut,
  actions,
}: AccessDeniedScreenProps) {
  const { t } = useTranslation();
  return (
    <StatusFrame
      caption={caption}
      icon={<ShieldAlert />}
      eyebrow={t('status.error403')}
      title={title ?? t('status.deniedTitle')}
      description={
        <>
          <p>{description ?? t('status.deniedDescription')}</p>
          {email && (
            <p className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted">
              {t('status.connectedAs', { email: '' })}
              <span className="truncate font-medium text-fg" dir="auto">
                {email}
              </span>
            </p>
          )}
        </>
      }
      actions={
        <>
          {actions}
          {onSignOut && (
            <Button variant="primary" size="lg" onClick={onSignOut}>
              {t('status.switchAccount')}
            </Button>
          )}
        </>
      }
    />
  );
}

/** Rubrique interdite par les permissions : affichée dans le contenu, le menu reste accessible. */
export function AccessDeniedPanel({ description }: { description?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <EmptyState
        icon={<LockKeyhole />}
        title={t('status.panelDeniedTitle')}
        description={description ?? t('status.panelDeniedDescription')}
        action={
          <Button asChild variant="secondary" leftIcon={<ArrowLeft className="rtl:-scale-x-100" />}>
            <Link to="/">{t('status.backHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}

/** Page introuvable, dans le contenu de l'application. */
export function NotFoundPanel() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <EmptyState
        icon={<Compass />}
        title={t('status.notFoundTitle')}
        description={t('status.notFoundPanel')}
        action={
          <Button asChild variant="secondary" leftIcon={<ArrowLeft className="rtl:-scale-x-100" />}>
            <Link to="/">{t('status.backHome')}</Link>
          </Button>
        }
      />
    </div>
  );
}

/** Erreur de rendu ou de chargement d'une route (errorElement du routeur). */
export function RouteErrorScreen({ caption }: { caption?: string }) {
  const { t } = useTranslation();
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // Après une mise en ligne, les anciens fragments JS n'existent plus : un rechargement suffit.
  const staleChunk = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);

  return (
    <StatusFrame
      caption={caption}
      icon={notFound ? <Compass /> : <TriangleAlert />}
      eyebrow={notFound ? t('status.error404') : t('status.errorUnexpected')}
      title={notFound ? t('status.notFoundTitle') : staleChunk ? t('status.staleTitle') : t('status.errorTitle')}
      description={
        notFound ? t('status.notFoundShort') : staleChunk ? t('status.staleDescription') : t('status.errorDescription')
      }
      actions={
        <>
          <Button asChild variant="secondary" size="lg">
            <Link to="/">{t('status.home')}</Link>
          </Button>
          {!notFound && (
            <Button variant="primary" size="lg" leftIcon={<RefreshCw />} onClick={() => window.location.reload()}>
              {t('status.reload')}
            </Button>
          )}
        </>
      }
    />
  );
}

/** Barre de progression fine en haut de l'écran pendant le chargement d'une route. */
export function NavigationProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  // Délai d'affichage : les navigations instantanées ne font pas clignoter la barre.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(timer);
  }, [busy]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-primary transition-[transform,opacity] duration-500 ease-out',
        visible ? 'scale-x-[0.85] opacity-100' : 'scale-x-0 opacity-0',
      )}
    />
  );
}
