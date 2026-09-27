// Historique des commandes clôturées : période, recherche par numéro, client ou
// adresse, filtres, export CSV et fiche détaillée.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import Papa from 'papaparse';
import { Archive, Download, Search, X } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input, SegmentedControl, createColumnHelper, formatDateTime, formatEUR } from '@golink/ui';
import { COLLECTIONS, PAYMENT_METHOD_LABELS, normalizeText, type Order } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, errorMessage, toDate, useInfiniteCollection } from '@/lib/firestore';
import { CLOSED_STATUSES, fulfillmentLabel, type OrderRow } from './lib';
import { OrderActionsProvider } from './components/OrderActions';
import { OrderSheet, OrdersLayout } from './components/OrdersLayout';
import { FulfillmentBadge, OrderStatus } from './components/parts';

type Period = 'today' | '7d' | '30d' | 'all';
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
  { value: 'all', label: 'Tout' },
];

function periodStart(period: Period): Date | null {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'today') return start;
  if (period === '7d') return new Date(start.getTime() - 6 * 86_400_000);
  if (period === '30d') return new Date(start.getTime() - 29 * 86_400_000);
  return null;
}

const col = createColumnHelper<OrderRow>();

export function HistoryPage() {
  const { restaurantId, restaurant } = useRestaurantAccess();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const openId = params.get('commande');
  const [period, setPeriod] = useState<Period>('7d');
  const [term, setTerm] = useState('');
  const search = normalizeText(term).replace(/^#/, '').slice(0, 30);

  const q = useMemo(() => {
    const constraints: QueryConstraint[] = [where('restaurantId', '==', restaurantId)];
    if (search.length >= 2) {
      // Recherche : mots-clés indexés (numéro, client, adresse), toutes périodes.
      constraints.push(where('searchKeywords', 'array-contains', search.replace(/\s+/g, ' ').split(' ')[0] ?? search));
    } else {
      constraints.push(where('status', 'in', CLOSED_STATUSES));
      const start = periodStart(period);
      if (start) constraints.push(where('createdAt', '>=', start));
    }
    constraints.push(orderBy('createdAt', 'desc'));
    return query(collectionAt(COLLECTIONS.orders), ...constraints, limit(1000));
  }, [restaurantId, search, period]);
  const state = useInfiniteCollection<Order>(q, { pageSize: 60 });
  const rows = state.data as OrderRow[];

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('commande', id);
    else next.delete('commande');
    setParams(next, { replace: !id });
  };

  const delivered = rows.filter((o) => o.status === 'delivered');
  const cancelled = rows.filter((o) => o.status === 'cancelled');
  const sales = delivered.reduce((s, o) => s + o.amounts.subtotalCents, 0);

  const columns = useMemo(
    () => [
      // Numéro et date réunis : l'essentiel reste visible sur mobile sans défilement.
      col.accessor((o) => o.createdAt.toMillis(), {
        id: 'date',
        header: 'Commande',
        cell: (info) => (
          <span className="block whitespace-nowrap">
            <span className="num block font-mono text-sm font-semibold text-fg">{info.row.original.number}</span>
            <span className="block text-2xs text-fg-subtle">{formatDateTime(info.getValue())}</span>
          </span>
        ),
      }),
      col.accessor('customerName', { header: 'Client', cell: (info) => <span className="whitespace-nowrap text-sm text-fg">{info.getValue()}</span> }),
      col.accessor('status', { header: 'Statut', cell: (info) => <OrderStatus order={info.row.original} className="whitespace-nowrap" />, enableGlobalFilter: false }),
      col.accessor((o) => o.amounts.totalCents, {
        id: 'total',
        header: 'Total',
        meta: { align: 'right' },
        cell: (info) => <span className="num whitespace-nowrap font-mono text-sm font-semibold">{formatEUR(info.getValue(), { cents: true })}</span>,
      }),
      col.accessor('fulfillment', { header: 'Mode', cell: (info) => <FulfillmentBadge mode={info.getValue()} size="sm" />, enableGlobalFilter: false }),
      col.accessor('itemsCount', { header: 'Articles', meta: { align: 'right' }, cell: (info) => <span className="num font-mono text-sm">{info.getValue()}</span> }),
      col.accessor((o) => o.delivery?.driverName ?? '', { id: 'driver', header: 'Livreur', cell: (info) => <span className="text-sm text-fg-muted">{info.getValue() || '—'}</span> }),
    ],
    [],
  );

  const exportCsv = () => {
    const csv = Papa.unparse(
      rows.map((o) => ({
        Commande: o.number,
        Date: toDate(o.createdAt)?.toLocaleString('fr-FR') ?? '',
        Client: o.customerName,
        Mode: fulfillmentLabel(o.fulfillment),
        Statut: o.status === 'delivered' ? (o.fulfillment === 'delivery' ? 'Livrée' : 'Remise') : o.status === 'cancelled' ? 'Annulée' : o.status,
        Articles: o.itemsCount,
        'Sous-total (€)': (o.amounts.subtotalCents / 100).toFixed(2).replace('.', ','),
        'Total client (€)': (o.amounts.totalCents / 100).toFixed(2).replace('.', ','),
        'Remboursé (€)': (o.amounts.refundedCents / 100).toFixed(2).replace('.', ','),
        Paiement: PAYMENT_METHOD_LABELS[o.payment.method],
        Livreur: o.delivery?.driverName ?? '',
      })),
      { delimiter: ';' },
    );
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commandes-${restaurant.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <OrderActionsProvider>
      <OrdersLayout pendingCount={0} description="Toutes les commandes livrées, remises ou annulées de votre établissement.">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="w-full md:max-w-sm">
            <Input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="N° GL-…, nom du client, rue…"
              aria-label="Rechercher dans l’historique"
              leading={<Search className="size-4" />}
              trailing={
                term ? (
                  <button type="button" onClick={() => setTerm('')} className="grid size-6 place-items-center rounded-md text-fg-subtle hover:text-fg" aria-label="Effacer la recherche">
                    <X className="size-3.5" />
                  </button>
                ) : undefined
              }
            />
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div data-scroll-ok className="min-w-0 overflow-x-auto [scrollbar-width:none]">
              <SegmentedControl aria-label="Période" value={period} onValueChange={(v) => setPeriod(v as Period)} options={search.length >= 2 ? [{ value: period, label: 'Toutes périodes' }] : PERIODS} />
            </div>
            <Button variant="secondary" leftIcon={<Download />} onClick={exportCsv} disabled={rows.length === 0} className="shrink-0">
              <span className="sr-only sm:not-sr-only">Exporter en CSV</span>
            </Button>
          </div>
        </div>

        {!state.loading && rows.length > 0 && (
          <p className="mt-4 text-sm text-fg-muted">
            <span className="font-medium text-fg">{delivered.length}</span> commande{delivered.length > 1 ? 's' : ''} {delivered.length > 1 ? 'terminées' : 'terminée'} ·{' '}
            <span className="font-medium text-fg">{cancelled.length}</span> annulée{cancelled.length > 1 ? 's' : ''}
            {can('finance.view') && (
              <>
                {' '}
                · ventes <span className="num font-mono font-medium text-fg">{formatEUR(sales, { cents: true })}</span>
              </>
            )}
          </p>
        )}

        <div className="mt-4">
          {state.error ? (
            <Card className="p-6 text-sm text-danger">{errorMessage(state.error)}</Card>
          ) : (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(o) => o.id}
              loading={state.loading}
              searchable={false}
              onRowClick={(o) => open(o.id)}
              pageSize={20}
              itemLabel="commandes"
              filters={[
                { id: 'status', label: 'Statut', options: [{ value: 'delivered', label: 'Terminées' }, { value: 'cancelled', label: 'Annulées' }], getValue: (o) => o.status },
                { id: 'mode', label: 'Mode', options: [{ value: 'delivery', label: 'Livraison' }, { value: 'pickup', label: 'À emporter' }, { value: 'dine_in', label: 'Sur place' }], getValue: (o) => o.fulfillment },
              ]}
              emptyState={
                <EmptyState
                  icon={<Archive />}
                  title={search.length >= 2 ? 'Aucune commande trouvée' : 'Aucune commande sur cette période'}
                  description={search.length >= 2 ? 'Vérifiez le numéro ou essayez le nom du client.' : 'Les commandes livrées et annulées apparaîtront ici.'}
                />
              }
            />
          )}
          {state.hasMore && !state.loading && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" loading={state.loadingMore} onClick={state.loadMore}>
                Charger plus de commandes
              </Button>
            </div>
          )}
        </div>
      </OrdersLayout>
      <OrderSheet orderId={openId} onClose={() => open(null)} />
    </OrderActionsProvider>
  );
}
