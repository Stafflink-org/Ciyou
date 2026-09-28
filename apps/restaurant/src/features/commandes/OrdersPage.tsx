// Service en cours : commandes en temps réel rangées par étape (nouvelles, en
// cuisine, prêtes, en livraison), avec minuteurs, recherche, filtres et épinglage.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Bike, CalendarClock, ClipboardList, Columns3, List, Radio, Search, ShoppingBag, Utensils, X } from 'lucide-react';
import { Button, Card, EmptyState, Input, SegmentedControl, Skeleton, cn, toneClass } from '@golink/ui';
import type { FulfillmentMode } from '@golink/shared';
import { usePersistentState } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import { useActiveOrders, useNow, usePinnedOrders } from './hooks';
import { LANES, laneOf, orderMatches, readyAtMs, type Lane, type OrderRow } from './lib';
import { OrderActionsProvider } from './components/OrderActions';
import { OrderCard } from './components/OrderCard';
import { OrderSheet, OrdersLayout } from './components/OrdersLayout';

type ModeFilter = 'all' | FulfillmentMode;

/** Urgence dans une colonne : délai restant le plus court en premier. */
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
  const [mode, setMode] = useState<ModeFilter>('all');
  const [lane, setLane] = useState<'all' | Lane>('all');
  const [layout, setLayout] = usePersistentState<'board' | 'list'>('golink:restaurant:commandes-vue', 'board');

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('commande', id);
    else next.delete('commande');
    setParams(next, { replace: !id });
  };

  const live = useMemo(() => data.filter((o) => o.status !== 'scheduled'), [data]);
  const scheduled = useMemo(() => data.filter((o) => o.status === 'scheduled'), [data]);
  const filtered = useMemo(
    () =>
      live
        .filter((o) => (mode === 'all' ? true : o.fulfillment === mode))
        .filter((o) => orderMatches(o, search))
        .sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)) || urgency(a) - urgency(b)),
    [live, mode, search, isPinned],
  );
  const byLane = useMemo(() => {
    const map: Record<Lane, OrderRow[]> = { new: [], kitchen: [], ready: [], delivery: [] };
    for (const o of filtered) {
      const l = laneOf(o);
      if (l) map[l].push(o);
    }
    return map;
  }, [filtered]);
  const counts = useMemo(() => {
    const c: Record<Lane, number> = { new: 0, kitchen: 0, ready: 0, delivery: 0 };
    for (const o of live) {
      const l = laneOf(o);
      if (l) c[l] += 1;
    }
    return c;
  }, [live]);
  const late = live.filter((o) => (o.status === 'preparing' || o.status === 'accepted') && (readyAtMs(o) ?? Infinity) < now).length;
  const filtersActive = search.trim() !== '' || mode !== 'all';
  const reset = () => {
    setSearch('');
    setMode('all');
    setLane('all');
  };

  const card = (o: OrderRow, showStatus = false) => (
    <OrderCard key={o.id} order={o} now={now} pinned={isPinned(o.id)} onTogglePin={() => toggle(o.id)} onOpen={() => open(o.id)} showStatus={showStatus} />
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
      <OrdersLayout activeCount={live.length} pendingCount={counts.new}>
        {/* Résumé du service */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Résumé du service">
          {LANES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLane(lane === l.id ? 'all' : l.id)}
              aria-pressed={lane === l.id}
              className={cn(
                toneClass[l.tone],
                'group rounded-xl border bg-surface px-4 py-3 text-left shadow-card transition-[border-color,box-shadow] hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring',
                lane === l.id ? 'border-(--tone-solid) ring-1 ring-(--tone-solid)/30' : 'border-border',
              )}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <span className={cn('size-2 rounded-full bg-(--tone-solid)', l.id === 'new' && counts.new > 0 && 'animate-pulse')} />
                {l.label}
              </span>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-12" />
              ) : (
                <span className="num mt-1 block font-display text-3xl font-semibold tracking-display text-fg">{counts[l.id]}</span>
              )}
              <span className="mt-0.5 block truncate text-2xs text-fg-subtle">
                {l.id === 'kitchen' && late > 0 ? <span className="tone-danger font-medium text-(--tone-fg)">{late} en retard</span> : l.hint}
              </span>
            </button>
          ))}
        </div>

        {/* Barre d'outils */}
        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="w-full md:max-w-sm">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° de commande, client, adresse, plat…"
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
          <div className="flex min-w-0 items-center justify-between gap-2">
            <SegmentedControl
              aria-label="Filtrer par mode"
              value={mode}
              onValueChange={(v) => setMode(v as ModeFilter)}
              options={[
                { value: 'all', label: 'Tous' },
                { value: 'delivery', label: 'Livraison', icon: <Bike /> },
                { value: 'pickup', label: 'À emporter', icon: <ShoppingBag /> },
                { value: 'dine_in', label: 'Sur place', icon: <Utensils /> },
              ]}
            />
            <SegmentedControl
              aria-label="Présentation"
              className="hidden xl:inline-flex"
              value={layout}
              onValueChange={(v) => setLayout(v as 'board' | 'list')}
              options={[
                { value: 'board', label: <span className="sr-only">Colonnes</span>, icon: <Columns3 /> },
                { value: 'list', label: <span className="sr-only">Liste</span>, icon: <List /> },
              ]}
            />
          </div>
        </div>

        <div className="mt-5">
          {error ? (
            <Card className="p-6 text-sm text-danger">{errorMessage(error)}</Card>
          ) : loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-52 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            emptyAll
          ) : layout === 'board' && lane === 'all' ? (
            <>
              {/* Colonnes (grand écran) */}
              <div className="hidden gap-4 xl:grid xl:grid-cols-4">
                {LANES.map((l) => (
                  <section key={l.id} aria-label={l.label} className="min-w-0">
                    <header className={cn(toneClass[l.tone], 'mb-3 flex items-center justify-between px-1')}>
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                        <span className="size-2 rounded-full bg-(--tone-solid)" />
                        {l.label}
                      </h2>
                      <span className="num rounded-full bg-surface-3 px-2 py-px font-mono text-2xs text-fg-muted">{byLane[l.id].length}</span>
                    </header>
                    <div className="space-y-3">
                      {byLane[l.id].length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-fg-subtle">Aucune commande</p>
                      ) : (
                        byLane[l.id].map((o) => card(o))
                      )}
                    </div>
                  </section>
                ))}
              </div>
              {/* File unique (tablette et mobile) */}
              <div className="grid gap-3 md:grid-cols-2 xl:hidden">{filtered.map((o) => card(o, true))}</div>
            </>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(lane === 'all' ? filtered : byLane[lane]).map((o) => card(o, true))}
              {lane !== 'all' && byLane[lane].length === 0 && <p className="text-sm text-fg-subtle">Aucune commande à cette étape.</p>}
            </div>
          )}
        </div>

        {scheduled.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              <CalendarClock className="size-4 text-fg-subtle" /> Commandes programmées
              <span className="num rounded-full bg-surface-3 px-2 py-px font-mono text-2xs text-fg-muted">{scheduled.length}</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{scheduled.map((o) => card(o, true))}</div>
          </section>
        )}
      </OrdersLayout>
      <OrderSheet orderId={openId} onClose={() => open(null)} />
    </OrderActionsProvider>
  );
}
