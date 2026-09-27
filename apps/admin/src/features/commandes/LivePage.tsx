// Volumes en direct (cahier §8) : commandes en cours par ville et par étape, sans
// détail individuel ; points d'attention (sans livreur, en retard, en attente).
import { useMemo } from 'react';
import { Link } from 'react-router';
import { AlarmClock, BellRing, Bike, CalendarClock, ChefHat, CircleAlert, PackageCheck, ShoppingBag } from 'lucide-react';
import {
  BarChart,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Skeleton,
  StatCard,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  formatNumber,
  formatRelative,
} from '@golink/ui';
import type { Order, OrderStatus } from '@golink/shared';
import { toDate } from '@/lib/firestore';
import { useNames, useNow, useScopedCities } from '../_operations/hooks';
import { LoadError } from '../_operations/ui';
import { useActiveOrders, useDispatchFailedAlerts } from './hooks';
import { OrdersShell } from './shell';

const STAGES: Array<{ key: string; label: string; statuses: OrderStatus[] }> = [
  { key: 'new', label: 'Nouvelles', statuses: ['new'] },
  { key: 'kitchen', label: 'En préparation', statuses: ['accepted', 'preparing'] },
  { key: 'ready', label: 'Prêtes', statuses: ['ready'] },
  { key: 'assigned', label: 'Livreur en route', statuses: ['assigned'] },
  { key: 'delivering', label: 'En livraison', statuses: ['picked_up'] },
];

export function LivePage() {
  const orders = useActiveOrders();
  const cities = useScopedCities();
  const names = useNames();
  const alerts = useDispatchFailedAlerts();
  const now = useNow(30_000);

  const data = useMemo(() => {
    const live = orders.data.filter((o) => o.status !== 'scheduled');
    const byCity = new Map<string, Record<string, number>>();
    for (const o of live) {
      const row = byCity.get(o.cityId) ?? {};
      const stage = STAGES.find((s) => s.statuses.includes(o.status));
      if (stage) row[stage.key] = (row[stage.key] ?? 0) + 1;
      row.total = (row.total ?? 0) + 1;
      byCity.set(o.cityId, row);
    }
    const waitingDriver = live.filter((o: Order) => o.fulfillment === 'delivery' && o.delivery?.deliveredBy === 'platform' && !o.driverId && ['accepted', 'preparing', 'ready'].includes(o.status));
    return {
      live,
      byCity,
      scheduled: orders.data.filter((o) => o.status === 'scheduled').length,
      pending: live.filter((o) => o.status === 'new').length,
      overdueAccept: live.filter((o) => o.status === 'new' && o.acceptDeadline && (toDate(o.acceptDeadline)?.getTime() ?? Infinity) < now).length,
      noDriver: waitingDriver.filter((o) => o.delivery?.dispatchStatus === 'unavailable').length,
      searching: waitingDriver.filter((o) => o.delivery?.dispatchStatus === 'searching').length,
      late: live.filter((o) => o.flags?.late).length,
    };
  }, [orders.data, now]);

  const chart = cities
    .map((c) => ({ ville: c.name, ...Object.fromEntries(STAGES.map((s) => [s.key, data.byCity.get(c.id)?.[s.key] ?? 0])) }))
    .filter((row) => STAGES.some((s) => (row as Record<string, number | string>)[s.key]));

  return (
    <OrdersShell documentTitle="Commandes en direct" title="En direct" description="Commandes en cours par ville et par étape, mises à jour en temps réel.">
      <div className="mb-6 flex items-center gap-2">
        <StatusPill tone="success" pulse>En direct</StatusPill>
        <span className="text-xs text-fg-subtle">Aucun rechargement nécessaire</span>
      </div>
      {orders.error ? (
        <LoadError error={orders.error} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
            <StatCard label="Commandes en cours" value={formatNumber(data.live.length)} icon={<ShoppingBag />} tone="brand" loading={orders.loading} footer={<span>{data.scheduled} programmée{data.scheduled > 1 ? 's' : ''}</span>} />
            <StatCard label="En attente d’acceptation" value={formatNumber(data.pending)} icon={<BellRing />} tone="amber" loading={orders.loading} footer={<span className={cn(data.overdueAccept && 'text-danger')}>{data.overdueAccept} hors délai</span>} />
            <StatCard label="Recherche de livreur" value={formatNumber(data.searching)} icon={<Bike />} tone="info" loading={orders.loading} />
            <StatCard label="Sans livreur disponible" value={formatNumber(data.noDriver)} icon={<CircleAlert />} tone={data.noDriver ? 'danger' : 'success'} loading={orders.loading} />
            <StatCard label="En retard" value={formatNumber(data.late)} icon={<AlarmClock />} tone={data.late ? 'danger' : 'success'} loading={orders.loading} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="min-w-0 xl:col-span-2">
              <CardHeader title="Par ville et par étape" description="Nombre de commandes à chaque étape, sans détail individuel." divided />
              {orders.loading ? (
                <Skeleton className="m-5 h-48" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Ville</TableHead>
                      {STAGES.map((s) => (
                        <TableHead key={s.key} className="text-right">{s.label}</TableHead>
                      ))}
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cities.map((c) => {
                      const row = data.byCity.get(c.id) ?? {};
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">
                            {c.name}
                            {!c.active && <span className="ml-2 text-2xs text-fg-subtle">inactive</span>}
                          </TableCell>
                          {STAGES.map((s) => (
                            <TableCell key={s.key} className={cn('text-right font-mono num', !row[s.key] && 'text-fg-subtle')}>
                              {row[s.key] ?? 0}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono font-semibold num">{row.total ?? 0}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              {!orders.loading && chart.length > 0 && (
                <CardContent className="border-t border-border">
                  <BarChart
                    data={chart}
                    xKey="ville"
                    stacked
                    height={220}
                    series={STAGES.map((s) => ({ key: s.key, label: s.label }))}
                  />
                </CardContent>
              )}
              {!orders.loading && data.live.length === 0 && <EmptyState compact icon={<PackageCheck />} title="Aucune commande en cours" description="Les nouvelles commandes apparaîtront ici instantanément." />}
            </Card>
            <Card className="min-w-0">
              <CardHeader title="Courses sans livreur" description="Après tous les tours de recherche." icon={<CircleAlert />} divided />
              {alerts.loading ? (
                <Skeleton className="m-5 h-24" />
              ) : alerts.data.length === 0 ? (
                <EmptyState compact icon={<ChefHat />} title="Rien à signaler" description="Toutes les courses ont trouvé un livreur." />
              ) : (
                <ul className="divide-y divide-border">
                  {alerts.data.map((a) => (
                    <li key={a.id}>
                      <Link to={`/commandes/${a.target.id}`} className="block px-5 py-3 hover:bg-surface-2">
                        <p className="text-sm font-medium text-fg">{a.title}</p>
                        <p className="text-xs text-fg-subtle">
                          {names.city(a.cityId)} · {toDate(a.detectedAt) ? formatRelative(toDate(a.detectedAt)!) : ''}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-fg-subtle">
                <CalendarClock className="size-3.5" /> Relance automatique toutes les 2 minutes.
              </div>
            </Card>
          </div>
        </>
      )}
    </OrdersShell>
  );
}
