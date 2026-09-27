// Alertes par exception et file « à traiter » (platformAlerts) : lecture temps réel
// dans le périmètre, présentation et traitement (Cloud Function handlePlatformAlert).
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { AlertOctagon, AlertTriangle, ArrowUpRight, Check, CheckCheck, CircleSlash, Info, MoreHorizontal, RotateCcw } from 'lucide-react';
import {
  Badge,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  cn,
  formatRelative,
  type Tone,
} from '@golink/ui';
import {
  COLLECTIONS,
  PLATFORM_ALERT_KIND_LABELS,
  PLATFORM_ALERT_STATUS_LABELS,
  type AlertSeverity,
  type HandlePlatformAlertInput,
  type PlatformAlert,
  type PlatformAlertView,
} from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { callFunction, toMillis, useCollection, useMutation } from '@/lib/firestore';
import { alertHref } from './links';

export type AlertQueue = PlatformAlert['queue'];
export type AlertGroup = 'active' | 'closed';

const ACTIVE: PlatformAlert['status'][] = ['open', 'acknowledged'];
const CLOSED: PlatformAlert['status'][] = ['resolved', 'dismissed'];

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = { critical: 'danger', warning: 'amber', info: 'info' };
export const STATUS_TONE: Record<PlatformAlert['status'], Tone> = {
  open: 'brand',
  acknowledged: 'info',
  resolved: 'success',
  dismissed: 'neutral',
};

/**
 * Alertes d'une file dans le périmètre courant. Sans filtre géographique : requête
 * par statut ; avec filtre (pays, villes) : requête par zone puis filtre des statuts.
 */
export function useAlerts(queue: AlertQueue, group: AlertGroup = 'active', max = 60) {
  const geo = useGeoScope();
  const statuses = group === 'active' ? ACTIVE : CLOSED;
  const cityKey = geo.cityIds?.slice(0, 30).join(',') ?? '';
  const alertsQuery = useMemo(() => {
    const ref = collection(db, COLLECTIONS.platformAlerts);
    if (geo.cityIds) {
      if (!geo.cityIds.length) return null;
      return query(ref, where('queue', '==', queue), where('cityId', 'in', cityKey.split(',')), orderBy('detectedAt', 'desc'), limit(max * 3));
    }
    if (geo.countryId) return query(ref, where('queue', '==', queue), where('countryId', '==', geo.countryId), orderBy('detectedAt', 'desc'), limit(max * 3));
    return query(ref, where('queue', '==', queue), where('status', 'in', statuses), orderBy('detectedAt', 'desc'), limit(max));
  }, [queue, geo.cityIds, geo.countryId, cityKey, statuses, max]);
  const { data, loading, error } = useCollection<PlatformAlert>(alertsQuery);
  const alerts = useMemo<PlatformAlertView[]>(
    () =>
      data
        .filter((alert) => statuses.includes(alert.status))
        .slice(0, max)
        .sort((a, b) =>
          group === 'active'
            ? SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (toMillis(b.detectedAt) ?? 0) - (toMillis(a.detectedAt) ?? 0)
            : (toMillis(b.resolvedAt ?? b.detectedAt) ?? 0) - (toMillis(a.resolvedAt ?? a.detectedAt) ?? 0),
        ),
    [data, statuses, max, group],
  );
  return { alerts, loading: Boolean(alertsQuery) && loading, error };
}

export function SeverityIcon({ severity, className }: { severity: AlertSeverity; className?: string }) {
  const Icon = severity === 'critical' ? AlertOctagon : severity === 'warning' ? AlertTriangle : Info;
  return (
    <span
      className={cn(
        `tone-${SEVERITY_TONE[severity]}`,
        'grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4',
        className,
      )}
      aria-label={severity === 'critical' ? 'Critique' : severity === 'warning' ? 'Attention' : 'Information'}
    >
      <Icon />
    </span>
  );
}

const handleAlert = callFunction<HandlePlatformAlertInput, { status: PlatformAlert['status'] }>('handlePlatformAlert');

const SUCCESS: Record<HandlePlatformAlertInput['status'], string> = {
  acknowledged: 'Alerte prise en charge',
  resolved: 'Alerte marquée comme résolue',
  dismissed: 'Alerte écartée',
  open: 'Alerte rouverte',
};

/** Menu de traitement d'une alerte (prise en charge, résolution, mise à l'écart, réouverture). */
export function AlertActions({ alert, align = 'end' }: { alert: PlatformAlertView; align?: 'start' | 'end' }) {
  const navigate = useNavigate();
  const [dismissOpen, setDismissOpen] = useState(false);
  const { mutate, loading } = useMutation(handleAlert, {
    success: (result) => SUCCESS[result.status as HandlePlatformAlertInput['status']] ?? 'Alerte mise à jour',
  });
  const active = alert.status === 'open' || alert.status === 'acknowledged';
  const href = alertHref(alert);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions sur l’alerte « ${alert.title} »`} size="sm" loading={loading}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56">
          {href && (
            <DropdownMenuItem icon={<ArrowUpRight />} onSelect={() => void navigate(href)}>
              Ouvrir l’élément
            </DropdownMenuItem>
          )}
          {alert.status === 'open' && (
            <DropdownMenuItem icon={<Check />} onSelect={() => void mutate({ alertId: alert.id, status: 'acknowledged' })}>
              Prendre en charge
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem icon={<CheckCheck />} onSelect={() => void mutate({ alertId: alert.id, status: 'resolved' })}>
              Marquer comme résolue
            </DropdownMenuItem>
          )}
          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<CircleSlash />} onSelect={() => setDismissOpen(true)}>
                Écarter…
              </DropdownMenuItem>
            </>
          )}
          {!active && (
            <DropdownMenuItem icon={<RotateCcw />} onSelect={() => void mutate({ alertId: alert.id, status: 'open' })}>
              Rouvrir
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        title="Écarter cette alerte ?"
        description="Elle ne sera plus signalée pendant 7 jours si la situation persiste. Le motif est conservé dans le journal d’audit."
        confirmLabel="Écarter l’alerte"
        requireReason
        onConfirm={async (reason) => {
          await mutate({ alertId: alert.id, status: 'dismissed', note: reason ?? null });
        }}
      />
    </>
  );
}

/** Ligne d'alerte : sévérité, titre (lien vers l'élément), message, âge, statut, actions. */
export function AlertItem({ alert, cityName, dense }: { alert: PlatformAlertView; cityName?: string | null; dense?: boolean }) {
  const href = alertHref(alert);
  const detected = toMillis(alert.detectedAt) ?? 0;
  const Title = href ? Link : 'span';
  return (
    <li className={cn('group relative flex items-start gap-3', dense ? 'px-4 py-3' : 'px-5 py-3.5')}>
      <SeverityIcon severity={alert.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Title
            to={href ?? ''}
            className={cn(
              'min-w-0 truncate text-sm font-medium text-fg',
              href && 'hover:underline focus-visible:underline focus-visible:outline-none after:absolute after:inset-0 after:content-[""]',
            )}
          >
            {alert.title}
          </Title>
          {alert.status !== 'open' && (
            <Badge size="sm" tone={STATUS_TONE[alert.status]}>
              {PLATFORM_ALERT_STATUS_LABELS[alert.status]}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted" title={String(alert.message ?? '')}>{alert.message}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-2xs text-fg-subtle">
          <span>{PLATFORM_ALERT_KIND_LABELS[alert.kind]}</span>
          {cityName && (
            <>
              <span aria-hidden>·</span>
              <span>{cityName}</span>
            </>
          )}
          {detected > 0 && (
            <>
              <span aria-hidden>·</span>
              <time dateTime={new Date(detected).toISOString()}>{formatRelative(detected)}</time>
            </>
          )}
        </p>
      </div>
      <div className="relative z-10 -mr-1.5 shrink-0">
        <AlertActions alert={alert} />
      </div>
    </li>
  );
}
