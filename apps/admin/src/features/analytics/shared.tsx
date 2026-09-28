// Outils communs aux sections d'analytics : appel de la fonction par section,
// formats, cellules de tableau et états.
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, Skeleton, cn, formatEUR, formatNumber, formatPercent, type StatusMeta, type Tone } from '@golink/ui';
import {
  DRIVER_AVAILABILITY_LABELS,
  DRIVER_STATUS_LABELS,
  RESTAURANT_STATUS_LABELS,
  type AnalyticsSection,
  type PilotageAnalytics,
  type PilotageAnalyticsInput,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';
import { useCallableQuery, type PilotageFilterState } from '../pilotage-commun/hooks';

const getAnalytics = callFunction<PilotageAnalyticsInput, PilotageAnalytics>('getPilotageAnalytics');

export function useAnalytics(section: AnalyticsSection, state: PilotageFilterState) {
  return useCallableQuery(getAnalytics, { ...state.filters, section }, `${section}|${state.key}`);
}

export const euros = (cents: number) => formatEUR(cents, { cents: true });
export const eurosCompact = (cents: number) => formatEUR(cents, { cents: true, compact: true });
export const minutes = (value: number) => (value ? `${formatNumber(value)} min` : '—');
export const percentOrDash = (ratio: number, has = true) => (has ? formatPercent(ratio) : '—');

/** Variation colorée (+12 %), neutre si absente. */
export function TrendBadge({ value, invert, className }: { value: number | null | undefined; invert?: boolean; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn('text-fg-subtle', className)}>—</span>;
  const up = value > 0;
  const good = value === 0 ? null : up !== Boolean(invert);
  const Icon = value === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-2xs font-medium num',
        good === null && 'bg-surface-3 text-fg-muted',
        good === true && 'tone-success bg-(--tone-bg) text-(--tone-fg)',
        good === false && 'tone-danger bg-(--tone-bg) text-(--tone-fg)',
        className,
      )}
    >
      <Icon className="size-3" />
      {up ? '+' : ''}
      {formatPercent(value)}
    </span>
  );
}

/** Taux coloré selon un seuil (au-delà = mauvais). */
export function RateCell({ value, warn, danger, has = true }: { value: number; warn: number; danger: number; has?: boolean }) {
  if (!has) return <span className="text-fg-subtle">—</span>;
  const tone: Tone | null = value >= danger ? 'danger' : value >= warn ? 'amber' : null;
  return <span className={cn('num font-mono text-xs', tone ? `tone-${tone} text-(--tone-fg)` : 'text-fg')}>{formatPercent(value)}</span>;
}

export function Num({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <span className={cn('num font-mono text-xs', muted ? 'text-fg-muted' : 'text-fg')}>{children}</span>;
}

/** Squelette d'une section en cours de calcul. */
export function SectionSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Calcul en cours">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-32" />
            <Skeleton className="mt-3 h-3 w-20" />
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-64 w-full" />
      </Card>
    </div>
  );
}

/** Regroupe une série journalière par semaine au-delà de `threshold` points. */
export function bucketSeries<T extends { day: string }>(rows: T[], keys: Array<keyof T>, threshold = 60): Array<Record<string, number | string>> {
  const size = rows.length > threshold ? 7 : 1;
  const out: Array<Record<string, number | string>> = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const first = slice[0];
    if (!first) continue;
    const point: Record<string, number | string> = { day: first.day };
    for (const key of keys) point[key as string] = slice.reduce((s, r) => s + Number(r[key] ?? 0), 0);
    out.push(point);
  }
  return out;
}

/** Statuts des commerces et des livreurs pour StatusBadge. */
export const RESTAURANT_STATUS_META: Record<string, StatusMeta> = {
  onboarding: { label: RESTAURANT_STATUS_LABELS.onboarding, tone: 'info' },
  active: { label: RESTAURANT_STATUS_LABELS.active, tone: 'success' },
  paused: { label: RESTAURANT_STATUS_LABELS.paused, tone: 'amber' },
  suspended: { label: RESTAURANT_STATUS_LABELS.suspended, tone: 'danger' },
  closed: { label: 'Fermé', tone: 'neutral' },
};

export const DRIVER_STATUS_META: Record<string, StatusMeta> = {
  onboarding: { label: DRIVER_STATUS_LABELS.onboarding, tone: 'info' },
  active: { label: DRIVER_STATUS_LABELS.active, tone: 'success' },
  suspended: { label: DRIVER_STATUS_LABELS.suspended, tone: 'danger' },
  deactivated: { label: DRIVER_STATUS_LABELS.deactivated, tone: 'neutral' },
};

export const DRIVER_AVAILABILITY_META: Record<string, StatusMeta> = {
  offline: { label: DRIVER_AVAILABILITY_LABELS.offline, tone: 'neutral' },
  online: {
    label: DRIVER_AVAILABILITY_LABELS.online,
    tone: 'success',
    pulse: true,
  },
  on_delivery: {
    label: DRIVER_AVAILABILITY_LABELS.on_delivery,
    tone: 'info',
    pulse: true,
  },
  paused: { label: DRIVER_AVAILABILITY_LABELS.paused, tone: 'amber' },
};
