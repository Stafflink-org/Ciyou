// Fiche restaurant, onglet « Statistiques & finances » : commandes, CA,
// commissions (30 ou 90 jours), reversements, factures et abonnement.
import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { Banknote, FileText, Receipt, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import {
  AreaChart,
  Badge,
  EmptyState,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusBadge,
  formatDate,
  formatNumber,
  type StatusMeta,
} from '@golink/ui';
import {
  COLLECTIONS,
  INVOICE_KIND_LABELS,
  PAYOUT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  paths,
  type Invoice,
  type Payout,
  type Restaurant,
  type RestaurantDailyStats,
  type Subscription,
  type WithId,
} from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, errorMessage, toDate, useCollection } from '@/lib/firestore';
import { Panel, bpsLabel, eur } from '../../acteurs-commun/ui';
import { PLAN_LABELS } from '../lib';

const PAYOUT_META: Record<string, StatusMeta> = {
  scheduled: { label: PAYOUT_STATUS_LABELS.scheduled, tone: 'info' },
  processing: { label: PAYOUT_STATUS_LABELS.processing, tone: 'amber' },
  paid: { label: PAYOUT_STATUS_LABELS.paid, tone: 'success' },
  failed: { label: PAYOUT_STATUS_LABELS.failed, tone: 'danger' },
  on_hold: { label: PAYOUT_STATUS_LABELS.on_hold, tone: 'amber' },
  cancelled: { label: PAYOUT_STATUS_LABELS.cancelled, tone: 'neutral' },
};

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function StatsTab({ restaurant }: { restaurant: WithId<Restaurant> }) {
  const can = useCan();
  const [period, setPeriod] = useState<'30' | '90'>('30');
  const days = Number(period);
  const stats = useCollection<RestaurantDailyStats>(
    useMemo(() => query(collectionAt(paths.restaurantSub(restaurant.id, 'dailyStats')), orderBy('day', 'desc'), limit(180)), [restaurant.id]),
  );
  const payouts = useCollection<Payout>(
    useMemo(
      () =>
        can('finance.view')
          ? query(collectionAt(COLLECTIONS.payouts), where('beneficiaryType', '==', 'restaurant'), where('beneficiaryId', '==', restaurant.id), orderBy('scheduledFor', 'desc'), limit(8))
          : null,
      [can, restaurant.id],
    ),
  );
  const invoices = useCollection<Invoice>(
    useMemo(
      () =>
        can('invoices.view')
          ? query(collectionAt(COLLECTIONS.invoices), where('recipient.type', '==', 'restaurant'), where('recipient.id', '==', restaurant.id), orderBy('issuedAt', 'desc'), limit(8))
          : null,
      [can, restaurant.id],
    ),
  );
  const subscriptions = useCollection<Subscription>(
    useMemo(
      () => (can('finance.view') || can('subscriptions.manage') ? query(collectionAt(COLLECTIONS.subscriptions), where('restaurantIds', 'array-contains', restaurant.id), limit(3)) : null),
      [can, restaurant.id],
    ),
  );

  const view = useMemo(() => {
    const current = stats.data.filter((s) => s.day >= isoDay(days - 1));
    const previous = stats.data.filter((s) => s.day < isoDay(days - 1) && s.day >= isoDay(days * 2 - 1));
    const sum = (list: RestaurantDailyStats[], key: keyof RestaurantDailyStats) => list.reduce((acc, s) => acc + (Number(s[key]) || 0), 0);
    const totals = {
      orders: sum(current, 'ordersCount'),
      delivered: sum(current, 'deliveredCount'),
      cancelled: sum(current, 'cancelledCount'),
      sales: sum(current, 'salesCents'),
      commission: sum(current, 'commissionCents'),
      net: sum(current, 'netPayoutCents'),
    };
    const prev = { orders: sum(previous, 'ordersCount'), sales: sum(previous, 'salesCents'), commission: sum(previous, 'commissionCents') };
    const delta = (a: number, b: number) => (b > 0 ? (a - b) / b : undefined);
    const byDay = new Map(current.map((s) => [s.day, s]));
    const chart = Array.from({ length: days }, (_, i) => {
      const day = isoDay(days - 1 - i);
      const s = byDay.get(day);
      return { day: `${day.slice(8, 10)}/${day.slice(5, 7)}`, ventes: (s?.salesCents ?? 0) / 100, commissions: (s?.commissionCents ?? 0) / 100 };
    });
    return {
      totals,
      chart,
      deltas: { orders: delta(totals.orders, prev.orders), sales: delta(totals.sales, prev.sales), commission: delta(totals.commission, prev.commission) },
      basket: totals.delivered ? Math.round(totals.sales / totals.delivered) : 0,
      cancelRate: totals.orders ? Math.round((totals.cancelled / totals.orders) * 10_000) : 0,
    };
  }, [stats.data, days]);

  const subscription = subscriptions.data[0];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">Agrégats quotidiens du commerce, comparés à la période précédente.</p>
        <SegmentedControl
          aria-label="Période"
          size="sm"
          value={period}
          onValueChange={(v) => setPeriod(v as '30' | '90')}
          options={[
            { value: '30', label: '30 jours' },
            { value: '90', label: '90 jours' },
          ]}
        />
      </div>
      {stats.error ? (
        <p className="text-sm text-danger">{errorMessage(stats.error)}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Commandes" value={formatNumber(view.totals.orders)} icon={<ShoppingBag />} delta={view.deltas.orders} deltaLabel="vs période préc." loading={stats.loading} footer={`Annulation ${bpsLabel(view.cancelRate)}`} />
            <StatCard label="Chiffre d’affaires" value={eur(view.totals.sales)} icon={<TrendingUp />} tone="success" delta={view.deltas.sales} deltaLabel="vs période préc." loading={stats.loading} footer={`Panier moyen ${eur(view.basket)}`} />
            <StatCard label="Commissions GoLink" value={eur(view.totals.commission)} icon={<Receipt />} tone="brand" delta={view.deltas.commission} deltaLabel="vs période préc." loading={stats.loading} />
            <StatCard label="Net reversé" value={eur(view.totals.net)} icon={<Wallet />} tone="info" loading={stats.loading} footer="Après commissions et remboursements" />
          </div>
          <Panel title="Ventes et commissions" icon={<TrendingUp />}>
            {stats.loading ? (
              <Skeleton className="h-64 w-full" />
            ) : view.totals.orders === 0 ? (
              <EmptyState compact icon={<TrendingUp />} title="Aucune vente sur la période" description="Les ventes apparaîtront dès les premières commandes." />
            ) : (
              <AreaChart
                data={view.chart}
                xKey="day"
                height={260}
                series={[
                  { key: 'ventes', label: 'Ventes' },
                  { key: 'commissions', label: 'Commissions' },
                ]}
                valueFormatter={(v) => eur(Math.round(v * 100))}
              />
            )}
          </Panel>
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Abonnement" icon={<Banknote />}>
          {!(can('finance.view') || can('subscriptions.manage')) ? (
            <p className="text-sm text-fg-muted">Réservé à la finance.</p>
          ) : subscriptions.loading ? (
            <Skeleton className="h-20 w-full" />
          ) : subscription ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-fg">Formule {PLAN_LABELS[subscription.planCode]}</span>
                <Badge tone={subscription.status === 'active' ? 'success' : subscription.status === 'trialing' ? 'plum' : 'danger'}>{SUBSCRIPTION_STATUS_LABELS[subscription.status]}</Badge>
              </div>
              <p className="text-fg-muted">
                {eur(subscription.priceHtCents)} HT / {subscription.billingCycle === 'yearly' ? 'an' : 'mois'}
              </p>
              <p className="text-xs text-fg-subtle">Période en cours jusqu’au {toDate(subscription.currentPeriodEnd) ? formatDate(toDate(subscription.currentPeriodEnd)!) : '—'}</p>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">Aucun abonnement : facturation à la commission.</p>
          )}
        </Panel>

        <Panel title="Derniers reversements" icon={<Wallet />}>
          {!can('finance.view') ? (
            <p className="text-sm text-fg-muted">Réservé à la finance.</p>
          ) : payouts.loading ? (
            <Skeleton className="h-28 w-full" />
          ) : payouts.data.length === 0 ? (
            <p className="text-sm text-fg-muted">Aucun reversement pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {payouts.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-fg num">{eur(p.netCents)}</p>
                    <p className="text-xs text-fg-subtle">
                      {p.periodStart.slice(8, 10)}/{p.periodStart.slice(5, 7)} → {p.periodEnd.slice(8, 10)}/{p.periodEnd.slice(5, 7)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} map={PAYOUT_META} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Factures" icon={<FileText />}>
          {!can('invoices.view') ? (
            <p className="text-sm text-fg-muted">Réservé à la finance.</p>
          ) : invoices.loading ? (
            <Skeleton className="h-28 w-full" />
          ) : invoices.data.length === 0 ? (
            <p className="text-sm text-fg-muted">Aucune facture émise.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invoices.data.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-fg">{inv.number}</p>
                    <p className="truncate text-xs text-fg-subtle">{INVOICE_KIND_LABELS[inv.kind]}</p>
                  </div>
                  <span className="font-mono text-sm text-fg num">{eur(inv.totalTtcCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
