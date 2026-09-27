// Briques d'interface communes aux rubriques de configuration : en-tête,
// sections, lignes de réglage, barre d'enregistrement, états de chargement et d'erreur.
import type { ReactNode } from 'react';
import { AlertTriangle, Info, Lock, RotateCcw, Save } from 'lucide-react';
import { Button, Card, Skeleton, cn, toneClass, type Tone } from '@golink/ui';

/** Carte de section : titre, description, contenu, pied optionnel. */
export function SettingsCard({
  title,
  description,
  icon,
  actions,
  children,
  footer,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)} id={id}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-[18px]">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-md font-semibold tracking-tight text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer && <div className="border-t border-border bg-surface-2 px-5 py-3 text-sm text-fg-muted">{footer}</div>}
    </Card>
  );
}

/** Ligne de réglage : libellé et aide à gauche, contrôle à droite (empilés sur mobile). */
export function SettingRow({
  label,
  description,
  icon,
  children,
  className,
  disabledReason,
}: {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Réglage verrouillé par GoLink : explication affichée sous l'aide. */
  disabledReason?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">{icon}</span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{label}</p>
          {description && <p className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</p>}
          {disabledReason && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-fg-muted">
              <Lock className="size-3" />
              {disabledReason}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-border', className)}>{children}</div>;
}

/** Barre d'enregistrement collante, visible dès qu'une modification est en cours. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  message = 'Modifications non enregistrées',
  disabled,
  saveLabel = 'Enregistrer',
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  message?: ReactNode;
  disabled?: boolean;
  saveLabel?: string;
}) {
  return (
    <div
      aria-hidden={!dirty}
      className={cn(
        'pointer-events-none sticky bottom-3 z-30 mt-6 flex justify-center transition-all duration-200 ease-out sm:bottom-5',
        dirty ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
    >
      <div
        role="region"
        aria-label="Enregistrement des modifications"
        className={cn(
          'flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-elevated px-4 py-3 shadow-lg',
          dirty && 'pointer-events-auto',
        )}
      >
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="truncate">{message}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={onReset} disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>
            Annuler
          </Button>
          <Button variant="primary" size="sm" leftIcon={<Save />} loading={saving} onClick={onSave} disabled={disabled || !dirty} tabIndex={dirty ? 0 : -1}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Encadré d'information, d'alerte ou d'erreur. */
export function Notice({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const fallbackIcon = tone === 'danger' || tone === 'amber' ? <AlertTriangle /> : <Info />;
  return (
    <div
      className={cn(
        toneClass[tone],
        'flex flex-col gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-(--tone-fg) [&_svg]:size-4">{icon ?? fallbackIcon}</span>
        <div className="min-w-0 text-(--tone-fg)">
          {title && <p className="font-medium">{title}</p>}
          {children && <div className={cn('leading-5', title ? 'mt-0.5 opacity-90' : '')}>{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Squelette de page de réglages (deux cartes). */
export function SettingsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: cards }, (_, index) => (
        <Card key={index} className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <div className="mt-6 space-y-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Erreur de lecture : message et nouvelle tentative. */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Impossible de charger ces informations"
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Réessayer
          </Button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}

/** Mise en page deux colonnes : contenu principal et colonne latérale (récapitulatif). */
export function SplitLayout({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">{children}</div>
      <aside className="min-w-0 space-y-4 xl:sticky xl:top-20 xl:self-start">{aside}</aside>
    </div>
  );
}

/** Carte récapitulative sombre (pétrole), à la manière des panneaux « En ce moment ». */
export function SummaryPanel({ eyebrow, title, icon, children }: { eyebrow: string; title: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-sidebar p-5 text-sidebar-fg shadow-card">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-primary/15 blur-2xl" />
      {icon && <div className="relative text-primary [&_svg]:size-5">{icon}</div>}
      <p className="relative mt-4 font-mono text-3xs uppercase tracking-eyebrow text-sidebar-muted">{eyebrow}</p>
      <p className="relative mt-1.5 font-display text-xl font-semibold tracking-tight">{title}</p>
      {children && <div className="relative mt-4 space-y-2.5 border-t border-white/10 pt-4 text-sm">{children}</div>}
    </div>
  );
}

export function SummaryLine({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sidebar-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
