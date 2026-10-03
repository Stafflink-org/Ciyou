// Service en cours : liste compacte des commandes en temps réel (numéro,
// client, service, délai, statut, total), avec tuiles de résumé, filtres par
// statut, recherche et épinglage — alignée sur la maquette de référence.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bike, ClipboardList, Radio, Search, ShoppingBag, Utensils, X } from 'lucide-react';
import { Button, Card, EmptyState, Input, SegmentedControl, Skeleton, cn, toneClass } from '@golink/ui';
import type { FulfillmentMode } from '@golink/shared';
import { usePersistentState } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import { useActiveOrders, useNow, usePinnedOrders } from './hooks';
import { orderMatches, readyAtMs, STATUS_FILTERS, SUMMARY_TILES, type OrderRow, type StatusFilter } from './lib';
import { OrderActionsProvider } from './components/OrderActions';
import { OrderListRow } from './components/OrderListRow';
import { OrderSheet, OrdersLayout } from './components/OrdersLayout';

type ModeFilter = 'all' | FulfillmentMode;

/** Urgence dans la file : délai restant le plus court en premier. */
function urgency(order: OrderRow): number {
  if (order.status === 'new') return order.acceptDeadline?.toMillis() ?? order.createdAt.toMillis();
  return readyAtMs(order) ?? order.createdAt.toMillis();
}

export function OrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openId = params.get('commande');
  const now = useNow();
  const { data, loading, error } = useActiveOrders();
  const { isPinned, toggle } = usePinnedOrders();
  const [search, setSearch] = useState('');
  const [mode, setMode] = usePersistentState<ModeFilter>('golink:restaurant:commandes-mode', 'all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('commande', id);
    else next.delete('commande');
    setParams(next, { replace: !id });
  };

  const live = useMemo(() => data.filter((o) => o.status !== 'scheduled'), [data]);
  const scheduled = useMemo(() => data.filter((o) => o.status === 'scheduled'), [data]);

  const tileCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tile of SUMMARY_TILES) counts[tile.id] = live.filter((o) => tile.statuses.includes(o.status)).length;
    return counts;
  }, [live]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of STATUS_FILTERS) counts[f.id] = f.statuses ? live.filter((o) => f.statuses!.includes(o.status)).length : live.length;
    return counts;
  }, [live]);

  const filtered = useMemo(() => {
    const active = STATUS_FILTERS.find((f) => f.id === status);
    return live
      .filter((o) => (mode === 'all' ? true : o.fulfillment === mode))
      .filter((o) => (!active?.statuses ? true : active.statuses.includes(o.status)))
      .filter((o) => orderMatches(o, search))
      .sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)) || urgency(a) - urgency(b));
  }, [live, mode, status, search, isPinned]);

  const filtersActive = search.trim() !== '' || mode !== 'all' || status !== 'all';
  const reset = () => {
    setSearch('');
    setMode('all');
    setStatus('all');
  };

  const row = (o: OrderRow) => (
    <OrderListRow key={o.id} order={o} now={now} pinned={isPinned(o.id)} onTogglePin={() => toggle(o.id)} onOpen={() => open(o.id)} />
  );

  const emptyAll = (
    <Card>
      {filtersActive ? (
        <EmptyState
          icon={<Search />}
          title="Aucune commande trouvée"
          description="Essayez un autre nom, numéro ou mode de commande."
          action={
            <Button variant="secondary" onClick={reset}>
              Réinitialiser les filtres
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<ClipboardList />}
          title="Le comptoir est calme"
          description="Les nouvelles commandes apparaissent ici dès leur arrivée, avec une alerte sonore."
          action={
            <Button variant="secondary" leftIcon={<Radio />} onClick={() => navigate('/commandes/suivi')}>
              Voir le suivi en direct
            </Button>
          }
        />
      )}
    </Card>
  );

  return (
    <OrderActionsProvider>
      <OrdersLayout activeCount={live.length} pendingCount={statusCounts.new ?? 0}>
        {/* Tuiles de résumé */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Résumé du service">
          {SUMMARY_TILES.map((tile) => (
            <div key={tile.id} className={cn(toneClass[tile.tone], 'rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-card')}>
              <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <span className={cn('size-2 rounded-full bg-(--tone-solid)', tile.id === 'toHandle' && tileCounts.toHandle > 0 && 'animate-pulse')} />
                {tile.label}
              </span>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-12" />
              ) : (
                <span className="num mt-1 block font-display text-3xl font-semibold tracking-display text-fg">{tileCounts[tile.id]}</span>
              )}
              <span className="mt-0.5 block truncate text-2xs text-fg-subtle">{tile.hint}</span>
            </div>
          ))}
        </div>

        {/* Onglet En cours / Historique + recherche */}
        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:max-w-sm">
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="N° commande, client, adresse…"
                aria-label="Rechercher une commande"
                leading={<Search className="size-4" />}
                trailing={
                  search ? (
                    <button type="button" onClick={() => setSearch('')} className="grid size-6 place-items-center rounded-md text-fg-subtle hover:text-fg" aria-label="Effacer la recherche">
                      <X className="size-3.5" />
                    </button>
                  ) : undefined
                }
              />
            </div>
            {/* Mode de service : filtre secondaire, combiné à la recherche (fonctionnalité conservée, non prioritaire). */}
            <SegmentedControl
              aria-label="Filtrer par mode de service"
              value={mode}
              onValueChange={(v) => setMode(v as ModeFilter)}
              options={[
                { value: 'all', label: 'Tous' },
                { value: 'delivery', label: <span className="sr-only">Livraison</span>, icon: <Bike /> },
                { value: 'pickup', label: <span className="sr-only">À emporter</span>, icon: <ShoppingBag /> },
                { value: 'dine_in', label: <span className="sr-only">Sur place</span>, icon: <Utensils /> },
              ]}
            />
          </div>

          {/* Filtres par statut */}
          <div data-scroll-ok className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatus(f.id)}
                aria-pressed={status === f.id}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  status === f.id ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {f.label}
                <span className="num rounded-full bg-surface-3 px-1.5 py-px font-mono text-2xs text-fg-muted">{statusCounts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Liste des commandes */}
        <div className="mt-4">
          {error ? (
            <Card className="p-6 text-sm text-danger">{errorMessage(error)}</Card>
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            emptyAll
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="hidden items-center gap-x-4 border-b border-border bg-surface-2 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-fg-subtle sm:flex">
                <span className="flex-1 basis-56">N° & client</span>
                <span className="w-24 shrink-0">Type</span>
                <span className="w-28 shrink-0">Délai</span>
                <span className="w-32 shrink-0">Statut</span>
                <span className="w-24 shrink-0 text-right">Total</span>
                <span className="ml-auto w-20 shrink-0 text-right">Actions</span>
              </div>
              <ul className="divide-y divide-border">{filtered.map((o) => row(o))}</ul>
            </div>
          )}
        </div>

        {scheduled.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              Commandes programmées
              <span className="num rounded-full bg-surface-3 px-2 py-px font-mono text-2xs text-fg-muted">{scheduled.length}</span>
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{scheduled.map((o) => row(o))}</ul>
          </section>
        )}
      </OrdersLayout>
      <OrderSheet orderId={openId} onClose={() => open(null)} />
    </OrderActionsProvider>
  );
}
