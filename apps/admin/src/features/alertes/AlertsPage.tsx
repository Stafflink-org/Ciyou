import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, Check, CheckCheck, CircleCheck, CircleSlash, Inbox, RefreshCw, RotateCcw, Search, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import {
  ALERT_SEVERITY_LABELS,
  PLATFORM_ALERT_KIND_LABELS,
  PLATFORM_ALERT_STATUS_LABELS,
  type AlertSeverity,
  type HandlePlatformAlertInput,
  type PlatformAlert,
  type PlatformAlertView,
} from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { callFunction, toMillis, useMutation } from '@/lib/firestore';
import { AlertActions, SEVERITY_TONE, STATUS_TONE, SeverityIcon, useAlerts, type AlertGroup, type AlertQueue } from '../pilotage-commun/alerts';
import { LoadError } from '../pilotage-commun/components';
import { alertHref } from '../pilotage-commun/links';

const runMonitoringNow = callFunction<Record<string, never>, { created: number; updated: number; resolved: number; candidates: number }>('runMonitoringNow');
const handleAlert = callFunction<HandlePlatformAlertInput, { status: PlatformAlert['status'] }>('handlePlatformAlert');

const ALL = 'all';

function metricText(metric: NonNullable<PlatformAlert['metric']>): {
  value: string;
  threshold: string;
} {
  const unit = metric.unit === 'ratio' ? 'livreur / commande' : metric.unit;
  const fmt = (v: number) => `${formatNumber(v, { decimals: true })}${unit === '%' ? ' %' : unit ? ` ${unit}` : ''}`;
  return { value: fmt(metric.value), threshold: fmt(metric.threshold) };
}

/** Alertes par exception et file « à traiter » (cahier §1), avec traitement et historique. */
export function AlertsPage() {
  useDocumentTitle('Alertes · GoLink Admin');
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const [params, setParams] = useSearchParams();
  const queue: AlertQueue = params.get('file') === 'a-traiter' ? 'todo' : 'alert';
  const group: AlertGroup = params.get('statut') === 'clotures' ? 'closed' : 'active';
  const kind = params.get('type') ?? ALL;
  const [severity, setSeverity] = useState<AlertSeverity | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { alerts, loading, error } = useAlerts(queue, group, 200);
  const alertCount = useAlerts('alert', 'active', 200).alerts.length;
  const todoCount = useAlerts('todo', 'active', 200).alerts.length;
  const cityNames = useMemo(() => new Map(geo.cities.map((c) => [c.id, c.name])), [geo.cities]);
  const { mutate: refresh, loading: refreshing } = useMutation(runMonitoringNow, {
    success: (r) =>
      r.created
        ? `${r.created} nouvelle${r.created > 1 ? 's' : ''} alerte${r.created > 1 ? 's' : ''} détectée${r.created > 1 ? 's' : ''}`
        : 'Surveillance relancée : aucune nouvelle anomalie',
  });

  const kinds = useMemo(() => [...new Set(alerts.map((a) => a.kind))], [alerts]);
  const filtered = alerts.filter(
    (a) =>
      (kind === ALL || a.kind === kind) &&
      (severity === ALL || a.severity === severity) &&
      (!search.trim() || `${a.title} ${a.message} ${a.target.label ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const selected = alerts.find((a) => a.id === selectedId) ?? null;

  function update(next: Record<string, string | null>) {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace: true });
  }

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow={`Surveillance · ${geo.label}`}
        title="Alertes"
        description="Anomalies détectées toutes les 15 minutes et demandes en attente de traitement. Chaque élément ouvre la fiche concernée."
        actions={
          <>
            {can('settings.view') && (
              <Button variant="secondary" asChild>
                <Link to="/alertes/seuils">
                  <SlidersHorizontal /> Seuils
                </Link>
              </Button>
            )}
            <Button variant="primary" leftIcon={<RefreshCw />} loading={refreshing} onClick={() => void refresh({})}>
              Relancer la surveillance
            </Button>
          </>
        }
      />

      <Tabs value={queue} onValueChange={(v) => update({ file: v === 'todo' ? 'a-traiter' : null, type: null })}>
        <TabsList className="mb-4">
          <TabsTrigger value="alert" icon={<ShieldAlert />} count={alertCount}>
            Alertes par exception
          </TabsTrigger>
          <TabsTrigger value="todo" icon={<Inbox />} count={todoCount}>
            À traiter
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <SegmentedControl
            size="sm"
            aria-label="Statut"
            value={group}
            onValueChange={(v) => update({ statut: v === 'closed' ? 'clotures' : null })}
            options={[
              { value: 'active', label: 'En cours' },
              { value: 'closed', label: 'Clôturées' },
            ]}
          />
          <div className="flex flex-1 flex-wrap items-center gap-2 lg:justify-end">
            <Input
              leading={<Search />}
              placeholder="Rechercher une alerte…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher une alerte"
              className="min-w-0 flex-1 basis-full sm:basis-56 lg:max-w-72"
              size="sm"
            />
            <Select
              size="sm"
              aria-label="Type"
              value={kinds.includes(kind as PlatformAlert['kind']) ? kind : ALL}
              onValueChange={(v) => update({ type: v === ALL ? null : v })}
              options={[
                { value: ALL, label: 'Tous les types' },
                ...kinds.map((k) => ({
                  value: k,
                  label: PLATFORM_ALERT_KIND_LABELS[k],
                })),
              ]}
              className="min-w-0 flex-1 sm:w-48 sm:flex-none"
            />
            <Select
              size="sm"
              aria-label="Sévérité"
              value={severity}
              onValueChange={(v) => setSeverity(v as AlertSeverity | typeof ALL)}
              options={[
                { value: ALL, label: 'Toutes sévérités' },
                { value: 'critical', label: 'Critique' },
                { value: 'warning', label: 'Attention' },
                { value: 'info', label: 'Information' },
              ]}
              className="min-w-0 flex-1 sm:w-44 sm:flex-none"
            />
          </div>
        </div>

        {error ? (
          <LoadError error={error} className="py-12" />
        ) : loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-3 px-5 py-4">
                <Skeleton className="size-8" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            className="py-14"
            icon={<CircleCheck className="text-success" />}
            title={
              alerts.length
                ? 'Aucun élément ne correspond aux filtres'
                : group === 'active'
                  ? queue === 'alert'
                    ? 'Aucune anomalie en cours'
                    : 'Rien en attente'
                  : 'Aucun élément clôturé'
            }
            description={
              alerts.length
                ? 'Modifiez la recherche, le type ou la sévérité.'
                : group === 'active'
                  ? 'La surveillance tourne toutes les 15 minutes ; les nouvelles anomalies apparaîtront ici.'
                  : 'Les alertes résolues ou écartées sont conservées ici.'
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {filtered.map((alert) => (
                <AlertRow key={alert.id} alert={alert} cityName={alert.cityId ? cityNames.get(alert.cityId) : null} onOpen={() => setSelectedId(alert.id)} />
              ))}
            </ul>
            <p className="border-t border-border px-5 py-2.5 text-xs text-fg-subtle">
              {formatNumber(filtered.length)} élément
              {filtered.length > 1 ? 's' : ''}
              {filtered.length !== alerts.length ? ` sur ${formatNumber(alerts.length)}` : ''}
            </p>
          </>
        )}
      </Card>

      <AlertSheet alert={selected} cityName={selected?.cityId ? cityNames.get(selected.cityId) : null} onClose={() => setSelectedId(null)} />
    </PageContainer>
  );
}

function AlertRow({ alert, cityName, onOpen }: { alert: PlatformAlertView; cityName?: string | null; onOpen: () => void }) {
  const detected = toMillis(alert.detectedAt) ?? 0;
  return (
    <li className="relative flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2">
      <SeverityIcon severity={alert.severity} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 truncate text-left text-sm font-medium text-fg after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {alert.title}
          </button>
          {alert.status !== 'open' && (
            <Badge size="sm" tone={STATUS_TONE[alert.status]}>
              {PLATFORM_ALERT_STATUS_LABELS[alert.status]}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted" title={String(alert.message ?? '')}>{alert.message}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-2xs text-fg-subtle">
          <span>{PLATFORM_ALERT_KIND_LABELS[alert.kind]}</span>
          {cityName && <span>· {cityName}</span>}
          {detected > 0 && <span>· {formatRelative(detected)}</span>}
        </p>
      </div>
      <div className="relative z-10 -mr-1.5 shrink-0">
        <AlertActions alert={alert} />
      </div>
    </li>
  );
}

function AlertSheet({ alert, cityName, onClose }: { alert: PlatformAlertView | null; cityName?: string | null; onClose: () => void }) {
  const { user } = useAuth();
  const [dismissOpen, setDismissOpen] = useState(false);
  const { mutate, loading } = useMutation(handleAlert, {
    success: 'Alerte mise à jour',
  });
  const href = alert ? alertHref(alert) : null;
  const active = alert?.status === 'open' || alert?.status === 'acknowledged';
  const metric = alert?.metric ? metricText(alert.metric) : null;
  const rows: Array<[string, string]> = alert
    ? [
        ['Type', PLATFORM_ALERT_KIND_LABELS[alert.kind]],
        ['Sévérité', ALERT_SEVERITY_LABELS[alert.severity]],
        ['Concerne', alert.target.label || alert.target.id],
        ...(cityName ? ([['Ville', cityName]] as Array<[string, string]>) : []),
        ['Détectée', formatDateTime(toMillis(alert.detectedAt) ?? 0)],
        ...(alert.acknowledgedAt
          ? ([['Prise en charge', `${formatDateTime(toMillis(alert.acknowledgedAt) ?? 0)}${alert.acknowledgedBy === user?.uid ? ' · par vous' : ''}`]] as Array<
              [string, string]
            >)
          : []),
        ...(alert.resolvedAt
          ? ([[alert.status === 'dismissed' ? 'Écartée' : 'Clôturée', formatDateTime(toMillis(alert.resolvedAt) ?? 0)]] as Array<[string, string]>)
          : []),
      ]
    : [];

  return (
    <Sheet open={Boolean(alert)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {alert && (
          <>
            <SheetHeader
              title={alert.title}
              description={PLATFORM_ALERT_STATUS_LABELS[alert.status]}
              icon={<SeverityIcon severity={alert.severity} className="size-10" />}
            />
            <SheetBody className="flex-1 space-y-5 overflow-y-auto">
              <p className="text-sm text-fg">{alert.message}</p>
              {metric && (
                <div
                  className={cn(
                    `tone-${SEVERITY_TONE[alert.severity]}`,
                    'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-(--tone-border) bg-(--tone-border)',
                  )}
                >
                  <div className="bg-surface p-4">
                    <p className="text-xs text-fg-muted">Valeur relevée</p>
                    <p className="num mt-1 font-display text-xl font-semibold text-(--tone-fg)">{metric.value}</p>
                  </div>
                  <div className="bg-surface p-4">
                    <p className="text-xs text-fg-muted">Seuil</p>
                    <p className="num mt-1 font-display text-xl font-semibold text-fg">{metric.threshold}</p>
                  </div>
                </div>
              )}
              <dl className="divide-y divide-border rounded-xl border border-border">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                    <dt className="min-w-0 max-w-[55%] [overflow-wrap:anywhere] text-fg-muted">{label}</dt>
                    <dd className="min-w-0 text-right text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
              {href && (
                <Button variant="secondary" block asChild>
                  <Link to={href}>
                    <ArrowUpRight /> Ouvrir l’élément concerné
                  </Link>
                </Button>
              )}
            </SheetBody>
            <SheetFooter>
              {active ? (
                <>
                  <Button variant="ghost" leftIcon={<CircleSlash />} onClick={() => setDismissOpen(true)} disabled={loading}>
                    Écarter
                  </Button>
                  {alert.status === 'open' && (
                    <Button
                      variant="secondary"
                      leftIcon={<Check />}
                      loading={loading}
                      onClick={() =>
                        void mutate({
                          alertId: alert.id,
                          status: 'acknowledged',
                        })
                      }
                    >
                      Prendre en charge
                    </Button>
                  )}
                  <Button variant="primary" leftIcon={<CheckCheck />} loading={loading} onClick={() => void mutate({ alertId: alert.id, status: 'resolved' })}>
                    Résoudre
                  </Button>
                </>
              ) : (
                <Button variant="secondary" leftIcon={<RotateCcw />} loading={loading} onClick={() => void mutate({ alertId: alert.id, status: 'open' })}>
                  Rouvrir
                </Button>
              )}
            </SheetFooter>
            <ConfirmDialog
              open={dismissOpen}
              onOpenChange={setDismissOpen}
              title="Écarter cette alerte ?"
              description="Elle ne sera plus signalée pendant 7 jours si la situation persiste. Le motif est conservé dans le journal d’audit."
              confirmLabel="Écarter l’alerte"
              requireReason
              onConfirm={async (reason) => {
                await mutate({
                  alertId: alert.id,
                  status: 'dismissed',
                  note: reason ?? null,
                });
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
