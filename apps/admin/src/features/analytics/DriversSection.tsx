import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Bike, Clock, Handshake, Timer } from 'lucide-react';
import { BarChart, Card, CardHeader, DataTable, EmptyState, Section, StatCard, StatusBadge, createColumnHelper, formatNumber, formatPercent, Table } from '@golink/ui';
import { VEHICLE_LABELS, type DriverPerformanceRow, type PilotageAnalytics, type VehicleType } from '@golink/shared';
import { ChartCard } from '../pilotage-commun/components';
import { DRIVER_AVAILABILITY_META, DRIVER_STATUS_META, Num, RateCell, minutes } from './shared';

const col = createColumnHelper<DriverPerformanceRow>();

function weighted(rows: DriverPerformanceRow[], pick: (r: DriverPerformanceRow) => number): number {
  const total = rows.reduce((s, r) => s + r.deliveriesInPeriod, 0);
  if (!total) return 0;
  return rows.reduce((s, r) => s + pick(r) * r.deliveriesInPeriod, 0) / total;
}

/** Performance des livreurs et des zones (cahier §3). */
export function DriversSection({ data, cityNames }: { data: NonNullable<PilotageAnalytics['drivers']>; cityNames: Map<string, string> }) {
  const navigate = useNavigate();
  const active = data.rows.filter((r) => r.deliveriesInPeriod > 0);
  const deliveries = data.rows.reduce((s, r) => s + r.deliveriesInPeriod, 0);
  const late = data.rows.reduce((s, r) => s + r.lateInPeriod, 0);
  const acceptance = active.length ? active.reduce((s, r) => s + r.acceptanceRate, 0) / active.length : 0;
  const averageMinutes = Math.round(
    weighted(
      active.filter((r) => r.averageDeliveryMinutes > 0),
      (r) => r.averageDeliveryMinutes,
    ),
  );
  const zones = [...data.byZone].sort((a, b) => b.deliveries - a.deliveries).slice(0, 12);

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Livreur',
        cell: (info) => (
          <span className="block min-w-36">
            <span className="block font-medium text-fg">{info.getValue()}</span>
            <span className="block text-2xs text-fg-subtle">
              {cityNames.get(info.row.original.cityId) ?? info.row.original.cityId} ·{' '}
              {VEHICLE_LABELS[info.row.original.vehicle as VehicleType] ?? info.row.original.vehicle}
            </span>
          </span>
        ),
      }),
      col.accessor('status', {
        header: 'Statut',
        enableGlobalFilter: false,
        // Compte actif : disponibilité en temps réel ; sinon, statut du compte.
        cell: (info) =>
          info.getValue() === 'active' ? (
            <StatusBadge status={info.row.original.availability} map={DRIVER_AVAILABILITY_META} className="whitespace-nowrap" />
          ) : (
            <StatusBadge status={info.getValue()} map={DRIVER_STATUS_META} className="whitespace-nowrap" />
          ),
      }),
      col.accessor('deliveriesInPeriod', {
        header: 'Livraisons',
        meta: { align: 'right' },
        cell: (info) => <Num>{formatNumber(info.getValue())}</Num>,
      }),
      col.accessor('acceptanceRate', {
        header: 'Acceptation',
        meta: { align: 'right' },
        cell: (info) => <Num muted={info.getValue() >= 0.85}>{formatPercent(info.getValue())}</Num>,
      }),
      col.accessor('averageDeliveryMinutes', {
        header: 'Temps moyen',
        meta: { align: 'right' },
        cell: (info) => <Num muted>{minutes(info.getValue())}</Num>,
      }),
      col.accessor('lateInPeriod', {
        header: 'Retards',
        meta: { align: 'right' },
        cell: (info) => <Num muted={!info.getValue()}>{formatNumber(info.getValue())}</Num>,
      }),
      col.accessor('onTimeRate', {
        header: 'À l’heure',
        meta: { align: 'right' },
        cell: (info) => <Num>{info.row.original.deliveries ? formatPercent(info.getValue()) : '—'}</Num>,
      }),
      col.accessor('cancellationRate', {
        header: 'Annulations',
        meta: { align: 'right' },
        cell: (info) => <RateCell value={info.getValue()} warn={0.05} danger={0.1} has={info.row.original.deliveries > 0} />,
      }),
      col.accessor('rating', {
        header: 'Note',
        meta: { align: 'right' },
        cell: (info) => <Num muted>{info.getValue() ? `${formatNumber(info.getValue(), { decimals: true })} / 5` : '—'}</Num>,
      }),
    ],
    [cityNames],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Livraisons"
          value={formatNumber(deliveries)}
          icon={<Bike />}
          tone="brand"
          footer={`${formatNumber(active.length)} livreur${active.length > 1 ? 's' : ''} actif${active.length > 1 ? 's' : ''} sur la période.`}
        />
        <StatCard
          label="Taux d’acceptation moyen"
          value={formatPercent(acceptance)}
          icon={<Handshake />}
          tone="success"
          footer="Courses acceptées sur courses proposées."
        />
        <StatCard
          label="Temps de livraison moyen"
          value={minutes(averageMinutes)}
          icon={<Timer />}
          tone="info"
          footer="De la commande à la remise au client."
        />
        <StatCard
          label="Livraisons en retard"
          value={formatNumber(late)}
          icon={<Clock />}
          tone="danger"
          footer={deliveries ? `${formatPercent(late / deliveries)} des livraisons de la période.` : 'Aucune livraison sur la période.'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <ChartCard className="xl:col-span-3" title="Livraisons par zone" description="Zones de service les plus actives sur la période.">
          {zones.length === 0 ? (
            <EmptyState compact icon={<Bike />} title="Aucune livraison" description="Aucune livraison rattachée à une zone sur la période." />
          ) : (
            <BarChart
              data={zones.map((z) => ({
                name: z.name.length > 18 ? `${z.name.slice(0, 17)}…` : z.name,
                deliveries: z.deliveries,
              }))}
              xKey="name"
              horizontal
              series={[
                {
                  key: 'deliveries',
                  label: 'Livraisons',
                  color: 'var(--gl-chart-2)',
                },
              ]}
              height={Math.max(220, zones.length * 32 + 40)}
            />
          )}
        </ChartCard>
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title="Qualité par zone" description="Retards et temps moyen de livraison." divided />
          {zones.length === 0 ? (
            <EmptyState compact icon={<Clock />} title="Pas de données" />
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left font-mono text-3xs uppercase tracking-wider text-fg-subtle">
                    <th className="px-5 py-2.5 font-medium">Zone</th>
                    <th className="px-3 py-2.5 text-right font-medium">Retards</th>
                    <th className="px-5 py-2.5 text-right font-medium">Temps</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => (
                    <tr key={z.zoneId} className="border-b border-border last:border-0">
                      <td className="max-w-40 truncate px-5 py-2.5 text-fg">{z.name}</td>
                      <td className="px-3 py-2.5 text-right">
                        <RateCell value={z.lateRate} warn={0.1} danger={0.2} has={z.deliveries > 0} />
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <Num muted>{minutes(z.averageMinutes)}</Num>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Section title="Tous les livreurs" description="Livraisons de la période ; taux calculés sur l’historique du livreur.">
        <DataTable
          data={data.rows}
          columns={columns}
          getRowId={(r) => r.driverId}
          searchPlaceholder="Rechercher un livreur…"
          itemLabel="livreurs"
          initialSorting={[{ id: 'deliveriesInPeriod', desc: true }]}
          onRowClick={(r) => void navigate(`/livreurs/${r.driverId}`)}
          filters={[
            {
              id: 'city',
              label: 'Ville',
              options: [...new Set(data.rows.map((r) => r.cityId))].map((id) => ({ value: id, label: cityNames.get(id) ?? id })),
              getValue: (r) => r.cityId,
            },
            {
              id: 'status',
              label: 'Statut',
              options: Object.entries(DRIVER_STATUS_META).map(([value, meta]) => ({ value, label: meta.label })),
              getValue: (r) => r.status,
            },
          ]}
          emptyState={<EmptyState compact icon={<Bike />} title="Aucun livreur" description="Aucun livreur dans ce périmètre." />}
        />
      </Section>
    </div>
  );
}
