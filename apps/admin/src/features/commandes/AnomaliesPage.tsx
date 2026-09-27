// Anomalies des commandes (cahier §8) : taux d'annulation, de retard ou de refus
// anormaux par commerce, par zone ou à une heure donnée, comparés à la moyenne.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Ban, Clock, Gauge, MapPinned, RefreshCw, Store, ThumbsDown, TriangleAlert } from 'lucide-react';
import {
  BarChart,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  SegmentedControl,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  formatNumber,
} from '@golink/ui';
import type { AnomalyRow } from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { fn } from '../_operations/functions';
import { useCall, useNames } from '../_operations/hooks';
import { LoadError, pct } from '../_operations/ui';
import { OrdersShell } from './shell';

const METRIC_LABELS: Record<AnomalyRow['worstMetric'], string> = { cancel: 'annulations', late: 'retards', reject: 'refus' };

export function AnomaliesPage() {
  const geo = useGeoScope();
  const [days, setDays] = useState('7');
  const input = useMemo(() => ({ countryId: geo.countryId, cityIds: geo.cityIds, days: Number(days) }), [geo.countryId, geo.cityIds, days]);
  const result = useCall(fn.getOrderAnomalies, input, JSON.stringify(input));
  const r = result.data;
  const flagged = r ? r.restaurants.filter((x) => x.flagged).length + r.zones.filter((x) => x.flagged).length + r.hours.filter((x) => x.flagged).length : 0;
  const hourChart = r?.hours.map((h) => ({ heure: `${h.key} h`, annulations: Math.round(h.cancelRate * 1000) / 10, retards: Math.round(h.lateRate * 1000) / 10, refus: Math.round(h.rejectRate * 1000) / 10 })) ?? [];

  return (
    <OrdersShell
      documentTitle="Anomalies des commandes"
      title="Anomalies"
      description="Détection automatique des écarts : seuls les commerces, zones et créneaux anormaux sont signalés."
      actions={
        <div className="flex items-center gap-2">
          <SegmentedControl
            aria-label="Période"
            value={days}
            onValueChange={setDays}
            options={[
              { value: '1', label: '24 h' },
              { value: '7', label: '7 jours' },
              { value: '30', label: '30 jours' },
            ]}
          />
          <Button variant="secondary" aria-label="Actualiser" onClick={result.reload} leftIcon={<RefreshCw className={cn(result.loading && 'animate-spin')} />}>
            <span className="hidden sm:inline">Actualiser</span>
          </Button>
        </div>
      }
    >
      {result.error ? (
        <LoadError error={result.error} onRetry={result.reload} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Commandes analysées" value={r ? formatNumber(r.baseline.orders) : '—'} icon={<Gauge />} tone="neutral" loading={result.loading} footer={<span>Référence de la période</span>} />
            <StatCard label="Taux d’annulation" value={r ? pct(r.baseline.cancelRate, 1) : '—'} icon={<Ban />} tone="danger" loading={result.loading} />
            <StatCard label="Taux de retard" value={r ? pct(r.baseline.lateRate, 1) : '—'} icon={<Clock />} tone="amber" loading={result.loading} />
            <StatCard label="Écarts signalés" value={formatNumber(flagged)} icon={<TriangleAlert />} tone={flagged ? 'danger' : 'success'} loading={result.loading} footer={<span>{r ? `Seuil : +${Math.round(r.threshold * 100)} points, dès ${r.minOrders} commandes` : ''}</span>} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <AnomalyTable title="Par commerce" icon={<Store />} rows={r?.restaurants ?? []} loading={result.loading} baseline={r?.baseline} kind="restaurant" days={Number(days)} />
            <AnomalyTable title="Par zone" icon={<MapPinned />} rows={r?.zones ?? []} loading={result.loading} baseline={r?.baseline} kind="zone" days={Number(days)} />
          </div>

          <Card className="mt-6">
            <CardHeader title="Par heure de la journée" description="Taux par créneau horaire (Europe/Paris), en %." icon={<Clock />} divided />
            <CardContent>
              {result.loading ? (
                <Skeleton className="h-64" />
              ) : hourChart.length === 0 ? (
                <EmptyState compact icon={<Clock />} title="Pas de commande sur la période" />
              ) : (
                <>
                  <BarChart data={hourChart} xKey="heure" height={260} series={[{ key: 'annulations', label: 'Annulations' }, { key: 'retards', label: 'Retards' }, { key: 'refus', label: 'Refus' }]} valueFormatter={(v) => `${v.toLocaleString('fr-FR')} %`} axisFormatter={(v) => `${v} %`} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r?.hours.filter((h) => h.flagged).map((h) => (
                      <Badge key={h.key} tone="danger" icon={<TriangleAlert />}>
                        {h.label} : {METRIC_LABELS[h.worstMetric]} +{Math.round(h.worstGap * 100)} pts
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </OrdersShell>
  );
}

function AnomalyTable({
  title,
  icon,
  rows,
  loading,
  baseline,
  kind,
  days,
}: {
  title: string;
  icon: React.ReactNode;
  rows: AnomalyRow[];
  loading: boolean;
  baseline?: { cancelRate: number; lateRate: number; rejectRate: number };
  kind: 'restaurant' | 'zone';
  days: number;
}) {
  const names = useNames();
  const [all, setAll] = useState(false);
  const visible = all ? rows : rows.filter((r) => r.flagged).concat(rows.filter((r) => !r.flagged).slice(0, Math.max(0, 6 - rows.filter((r) => r.flagged).length)));
  const period = days <= 1 ? 'today' : days <= 7 ? '7d' : '30d';
  const rate = (value: number, base: number | undefined) => (
    <span className={cn('font-mono num', base !== undefined && value - base >= 0.05 ? 'text-danger' : value - (base ?? 0) >= 0.02 ? 'text-warning' : 'text-fg-muted')}>{pct(value, 1)}</span>
  );
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        icon={icon}
        actions={rows.length > 6 ? <Button size="xs" variant="ghost" onClick={() => setAll((a) => !a)}>{all ? 'Réduire' : `Tout voir (${rows.length})`}</Button> : undefined}
        divided
      />
      {loading ? (
        <Skeleton className="m-5 h-40" />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={<ThumbsDown />} title="Aucune donnée" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{kind === 'restaurant' ? 'Commerce' : 'Zone'}</TableHead>
              <TableHead className="text-right">Cmd.</TableHead>
              <TableHead className="text-right">Annul.</TableHead>
              <TableHead className="text-right">Retard</TableHead>
              <TableHead className="text-right">Refus</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.key} className={cn(row.flagged && 'bg-danger-soft/40')}>
                <TableCell className="max-w-56">
                  <div className="flex items-center gap-2">
                    {row.flagged && <TriangleAlert className="size-3.5 shrink-0 text-danger" aria-label="Anomalie" />}
                    <Link
                      to={kind === 'restaurant' ? `/commandes?commerce=${row.key}&periode=${period}` : `/commandes?zone=${row.key}&periode=${period}`}
                      className="truncate text-sm font-medium text-fg hover:underline"
                    >
                      {row.label}
                    </Link>
                  </div>
                  <p className="text-2xs text-fg-subtle">{names.city(row.cityId)}{row.flagged ? ` · ${METRIC_LABELS[row.worstMetric]} +${Math.round(row.worstGap * 100)} pts` : ''}</p>
                </TableCell>
                <TableCell className="text-right font-mono num">{row.orders}</TableCell>
                <TableCell className="text-right">{rate(row.cancelRate, baseline?.cancelRate)}</TableCell>
                <TableCell className="text-right">{rate(row.lateRate, baseline?.lateRate)}</TableCell>
                <TableCell className="text-right">{rate(row.rejectRate, baseline?.rejectRate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
