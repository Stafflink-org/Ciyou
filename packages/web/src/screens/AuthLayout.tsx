import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@golink/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { LanguageSwitch } from '../i18n/shell';

export interface AuthHighlight {
  icon: ReactNode;
  title: string;
  text: string;
}

export interface AuthLayoutProps {
  /** Libellé sous le logo (« Restaurant », « Super admin »). */
  caption: string;
  headline: ReactNode;
  tagline: ReactNode;
  highlights?: AuthHighlight[];
  children: ReactNode;
}

/** Plan de ville stylisé et itinéraire de livraison animé (panneau de marque). */
function RouteIllustration() {
  const route = 'M132 214 C 196 214 214 168 262 160 S 338 136 360 108 S 420 76 488 78';
  return (
    <svg
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <defs>
        <pattern id="gl-auth-grid" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
          <path d="M40 0H0V40" fill="none" stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" />
        </pattern>
        <radialGradient id="gl-auth-fade" cx="58%" cy="22%" r="58%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="gl-auth-mask">
          <rect width="600" height="600" fill="url(#gl-auth-fade)" />
        </mask>
      </defs>
      <g mask="url(#gl-auth-mask)">
        <rect width="600" height="600" fill="url(#gl-auth-grid)" />
        {/* Grands axes */}
        <path d="M-20 300 C 140 280 260 330 620 250" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="10" />
        <path d="M300 -20 C 280 160 360 360 320 620" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="7" />
        {/* Itinéraire */}
        <path d={route} fill="none" stroke="var(--gl-primary)" strokeOpacity="0.18" strokeWidth="14" strokeLinecap="round" />
        <path d={route} fill="none" stroke="var(--gl-primary)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 9" />
        <circle r="6" fill="var(--gl-primary)">
          <animateMotion dur="7s" repeatCount="indefinite" path={route} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
        </circle>
      </g>
      {/* Restaurant (départ) */}
      <g transform="translate(132 214)">
        <circle r="22" fill="var(--gl-primary)" fillOpacity="0.14" />
        <circle r="9" fill="var(--gl-primary)" />
        <circle r="3.5" fill="var(--gl-sidebar)" />
      </g>
      {/* Client (arrivée) */}
      <g transform="translate(488 78)">
        <circle r="26" fill="currentColor" fillOpacity="0.06">
          <animate attributeName="r" values="18;30;18" dur="3.2s" repeatCount="indefinite" />
        </circle>
        <circle r="9" fill="none" stroke="currentColor" strokeOpacity="0.9" strokeWidth="2.5" />
        <circle r="3.5" fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * Mise en page plein écran des pages d'accès (connexion, mot de passe, accès refusé) :
 * panneau de marque à gauche (écrans larges), formulaire à droite.
 */
export function AuthLayout({ caption, headline, tagline, highlights = [], children }: AuthLayoutProps) {
  const year = new Date().getFullYear();
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh bg-canvas text-fg lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-fg lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_12%_100%,color-mix(in_oklab,var(--gl-primary)_26%,transparent),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(50%_40%_at_90%_0%,rgb(255_255_255/0.06),transparent_70%)]" />
        <RouteIllustration />

        <div className="relative flex flex-1 flex-col p-10 xl:p-14">
          <Logo size={34} caption={caption} />

          <div className="mt-auto max-w-lg">
            <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-display text-balance xl:text-5xl xl:leading-[1.05]">
              {headline}
            </h1>
            <p className="mt-5 max-w-md text-md text-sidebar-muted">{tagline}</p>

            {highlights.length > 0 && (
              <ul className="mt-10 grid gap-3 xl:grid-cols-3">
                {highlights.map((item) => (
                  <li
                    key={item.title}
                    className="rounded-xl border border-sidebar-border bg-white/[0.03] p-4 backdrop-blur-sm"
                  >
                    <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary [&_svg]:size-4">
                      {item.icon}
                    </span>
                    <p className="mt-3 text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-sidebar-muted">{item.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-10 font-mono text-3xs uppercase tracking-eyebrow text-sidebar-muted/70">
            © {year} GoLink · {t('auth.region')}
          </p>
        </div>
      </aside>

      <main className="relative flex min-h-dvh flex-col">
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--gl-primary)_9%,transparent),transparent)] lg:hidden" />
        <header className="relative flex h-20 items-center justify-between px-6 sm:px-10 lg:hidden">
          <Logo size={30} caption={caption} />
          <LanguageSwitch />
        </header>
        <LanguageSwitch className="absolute end-10 top-7 z-10 hidden lg:flex" />
        <div className="relative flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[400px] animate-rise">{children}</div>
        </div>
        <footer className="relative flex items-center justify-center gap-2 px-6 pb-8 text-2xs text-fg-subtle">
          <ShieldCheck className="size-3.5" />
          {t('auth.footer')}
        </footer>
      </main>
    </div>
  );
}

/** En-tête de formulaire des pages d'accès. */
export function AuthHeading({ eyebrow, title, description }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && <p className="eyebrow mb-3 text-primary-soft-fg">{eyebrow}</p>}
      <h2 className="font-display text-[1.75rem] font-semibold leading-9 tracking-display text-fg">{title}</h2>
      {description && <p className="mt-2 text-md text-fg-muted">{description}</p>}
    </div>
  );
}

/** Message d'erreur ou d'information dans un formulaire d'accès. */
export function AuthAlert({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    danger: 'tone-danger',
    success: 'tone-success',
    info: 'tone-info',
  } as const;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`${styles[tone]} rounded-xl border border-(--tone-border) bg-(--tone-bg) px-3.5 py-3 text-sm text-(--tone-fg)`}
    >
      {children}
    </div>
  );
}
