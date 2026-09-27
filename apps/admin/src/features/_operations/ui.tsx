// Éléments d'interface communs aux rubriques d'exploitation : onglets de navigation,
// pastilles de statut, lignes d'information, états d'erreur, historique des réglages.
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, History, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Skeleton,
  StatusPill,
  cn,
  formatDateTime,
  formatRelative,
  type Tone,
} from '@golink/ui';
import {
  ADMIN_ORDER_STATUS_TONES,
  DRIVER_AVAILABILITY_LABELS,
  DRIVER_STATUS_LABELS,
  ONBOARDING_STATUS_LABELS,
  type DriverAvailability,
  type DriverStatus,
  type OnboardingStatus,
  type OrderStatus,
  type SettingsHistoryEntry,
  type WithId,
} from '@golink/shared';
import { errorMessage, toDate } from '@/lib/firestore';
import { useTranslation } from '@golink/web';

// ------------------------------------------------------------------ Onglets de rubrique

export interface OpsTab {
  to: string;
  label: string;
  count?: number | null;
  end?: boolean;
  hidden?: boolean;
}

/** Onglets reliés aux routes d'une rubrique (défilement horizontal sur mobile). */
export function OpsTabs({ tabs, className }: { tabs: OpsTab[]; className?: string }) {
  return (
    <nav data-scroll-ok aria-label="Sections" className={cn('-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0', className)}>
      <ul className="flex min-w-max items-center gap-1 border-b border-border">
        {tabs
          .filter((tab) => !tab.hidden)
          .map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                    isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                  )
                }
              >
                {tab.label}
                {tab.count ? (
                  <span className="tone-brand rounded-full bg-(--tone-bg) px-1.5 py-px font-mono text-2xs text-(--tone-fg) num">{tab.count}</span>
                ) : null}
              </NavLink>
            </li>
          ))}
      </ul>
    </nav>
  );
}

// ------------------------------------------------------------------ Statuts

export const DRIVER_STATUS_TONES: Record<DriverStatus, Tone> = {
  onboarding: 'info',
  active: 'success',
  suspended: 'danger',
  deactivated: 'neutral',
};

export const ONBOARDING_TONES: Record<OnboardingStatus, Tone> = {
  draft: 'neutral',
  pending: 'info',
  documents_missing: 'amber',
  approved: 'success',
  rejected: 'danger',
};

export const AVAILABILITY_TONES: Record<DriverAvailability, Tone> = {
  online: 'success',
  on_delivery: 'info',
  paused: 'amber',
  offline: 'neutral',
};

export function DriverStatusPill({ status }: { status: DriverStatus }) {
  return <StatusPill tone={DRIVER_STATUS_TONES[status]}>{DRIVER_STATUS_LABELS[status]}</StatusPill>;
}

export function OnboardingPill({ status }: { status: OnboardingStatus }) {
  return <StatusPill tone={ONBOARDING_TONES[status]} pulse={status === 'pending'}>{ONBOARDING_STATUS_LABELS[status]}</StatusPill>;
}

export function AvailabilityPill({ availability }: { availability: DriverAvailability }) {
  return (
    <StatusPill tone={AVAILABILITY_TONES[availability]} pulse={availability === 'online' || availability === 'on_delivery'}>
      {availability === 'online' ? 'Disponible' : DRIVER_AVAILABILITY_LABELS[availability]}
    </StatusPill>
  );
}

export function OrderStatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  const { label } = useTranslation();
  return (
    <StatusPill tone={ADMIN_ORDER_STATUS_TONES[status]} pulse={status === 'new' || status === 'picked_up'} className={className}>
      {label('ORDER_STATUS_LABELS', status)}
    </StatusPill>
  );
}

// ------------------------------------------------------------------ Mise en page

/** Ligne libellé / valeur des fiches. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2.5 text-sm', className)}>
      <dt className="min-w-0 max-w-[55%] [overflow-wrap:anywhere] text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

/** Carte d'erreur de chargement, avec nouvel essai. */
export function LoadError({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={<AlertTriangle />}
      title="Chargement impossible"
      description={errorMessage(error)}
      action={onRetry ? <Button size="sm" leftIcon={<RefreshCw />} onClick={onRetry}>Réessayer</Button> : undefined}
    />
  );
}

/** Squelette de liste (cartes). */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Indique si une valeur est héritée ou surchargée à ce niveau. */
export function OverrideBadge({ overridden, inheritedFrom }: { overridden: boolean; inheritedFrom: string }) {
  return overridden ? (
    <Badge tone="brand" size="sm">Surchargé</Badge>
  ) : (
    <Badge tone="neutral" size="sm" variant="outline">Hérité · {inheritedFrom}</Badge>
  );
}

// ------------------------------------------------------------------ Historique des réglages

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

/** Journal des modifications d'un réglage (qui, quand, quoi, motif). */
export function SettingsHistoryCard({
  entries,
  loading,
  error,
  labels = {},
  title = 'Historique des modifications',
  className,
}: {
  entries: WithId<SettingsHistoryEntry & { changedByName?: string }>[];
  loading: boolean;
  error: unknown;
  labels?: Record<string, string>;
  title?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} icon={<History />} divided description="Chaque changement est conservé avec son auteur et son motif." />
      <div className="max-h-[520px] overflow-y-auto">
        {loading ? (
          <ListSkeleton rows={3} className="p-4" />
        ) : error ? (
          <LoadError error={error} compact />
        ) : entries.length === 0 ? (
          <EmptyState compact icon={<History />} title="Aucune modification" description="Les réglages n’ont pas encore été modifiés." />
        ) : (
          <ol className="divide-y divide-border">
            {entries.map((entry) => {
              const at = toDate(entry.changedAt);
              return (
                <li key={entry.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-fg">{entry.changedByName ?? 'Administrateur'}</p>
                    {at && (
                      <time className="font-mono text-2xs text-fg-subtle" dateTime={at.toISOString()} title={formatDateTime(at)}>
                        {formatRelative(at)}
                      </time>
                    )}
                  </div>
                  {entry.reason && <p className="text-sm text-fg-muted">« {entry.reason} »</p>}
                  <ul className="space-y-1">
                    {entry.changedFields.slice(0, 6).map((field) => (
                      <li key={field} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="font-medium text-fg">{labels[field] ?? field}</span>
                        <span className="font-mono text-fg-subtle line-through decoration-fg-subtle/50">{describeValue(entry.before?.[field])}</span>
                        <span aria-hidden className="text-fg-subtle">→</span>
                        <span className="font-mono text-fg">{describeValue(entry.after?.[field])}</span>
                      </li>
                    ))}
                    {entry.changedFields.length > 6 && <li className="text-xs text-fg-subtle">et {entry.changedFields.length - 6} autre(s) champ(s)</li>}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Formats

/** Distance lisible (« 850 m », « 2,4 km »). */
export function formatMeters(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}

/** Durée lisible en minutes (« 4 min », « 1 h 20 »). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Taux 0–1 en pourcentage entier. */
export function pct(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}
