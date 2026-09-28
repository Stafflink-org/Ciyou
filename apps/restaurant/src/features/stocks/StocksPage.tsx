// Ventes & stocks : inventaire temps réel, ajustements rapides (+/−) et motivés,
// seuils d'alerte, rupture automatique, disponibilité et historique des mouvements.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ClipboardCheck, History, Minus, MoreHorizontal, Package, PackagePlus, PackageX, Plus, Search, TrendingUp, X } from 'lucide-react';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  formatNumber,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  toast,
  Tooltip,
} from '@golink/ui';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { AdjustStockDialog } from '../produits/menu/AdjustStockDialog';
import { menuFunctions, updateProducts, useProducts, useSections, type MenuProduct } from '../produits/menu/data';
import { matches, plural, saleState, stockState, STOCK_STATE_META, type StockState } from '../produits/menu/helpers';
import { StockHistorySheet } from '../produits/menu/StockHistorySheet';
import { Price, saleUnitSuffix, Thumb } from '../produits/menu/ui';
import { InventoryDialog } from './InventoryDialog';

type Filter = 'all' | 'tracked' | 'low' | 'out' | 'untracked';

/** Délai avant l'envoi d'un ajustement rapide (plusieurs clics = un seul mouvement). */
const COMMIT_DELAY = 900;

export function StocksPage() {
  useDocumentTitle('Ventes & stocks · Ciyou Eats Restaurant');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const can = useCan();
  const canStock = can('stock.edit');

  const productsState = useProducts(restaurantId);
  const sectionsState = useSections(restaurantId);
  const products = productsState.data;
  const loading = productsState.loading || sectionsState.loading;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [adjusting, setAdjusting] = useState<{ product: MenuProduct; mode: 'add' | 'remove' | 'set' } | null>(null);
  const [historyFor, setHistoryFor] = useState<MenuProduct | null | undefined>(undefined);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // Ajustements rapides en attente : variation locale par produit, envoyée après une pause.
  const [pending, setPending] = useState<Record<string, number>>({});
  const [committing, setCommitting] = useState<Record<string, boolean>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const commit = useCallback(
    async (product: MenuProduct) => {
      const delta = pendingRef.current[product.id] ?? 0;
      if (delta === 0) return;
      setCommitting((c) => ({ ...c, [product.id]: true }));
      try {
        await menuFunctions.adjustStock({
          restaurantId,
          reason: 'manual_adjust',
          note: 'Ajustement rapide',
          items: [{ productId: product.id, mode: delta > 0 ? 'add' : 'remove', quantity: Math.abs(delta) }],
        });
      } catch (caught) {
        toast.error(errorMessage(caught));
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[product.id];
          return next;
        });
        setCommitting((c) => ({ ...c, [product.id]: false }));
      }
    },
    [restaurantId],
  );

  function step(product: MenuProduct, delta: number) {
    const current = (product.stock ?? 0) + (pending[product.id] ?? 0);
    if (current + delta < 0) return;
    setPending((p) => ({ ...p, [product.id]: (p[product.id] ?? 0) + delta }));
    clearTimeout(timers.current[product.id]);
    timers.current[product.id] = setTimeout(() => void commit(product), COMMIT_DELAY);
  }

  async function toggleAvailable(product: MenuProduct) {
    try {
      await updateProducts(restaurantId, uid, [product.id], { available: !product.available });
      toast.success(product.available ? `« ${product.name} » est masqué aux clients` : `« ${product.name} » est de nouveau en vente`);
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  }

  const sectionById = useMemo(() => new Map(sectionsState.data.map((s) => [s.id, s])), [sectionsState.data]);
  const ordered = useMemo(
    () =>
      [...products].sort((a, b) => {
        const sa = a.sectionId ? (sectionById.get(a.sectionId)?.order ?? 999) : 1000;
        const sb = b.sectionId ? (sectionById.get(b.sectionId)?.order ?? 999) : 1000;
        return sa - sb || a.order - b.order;
      }),
    [products, sectionById],
  );

  const stats = useMemo(() => {
    const tracked = products.filter((p) => p.stock !== null);
    return {
      tracked: tracked.length,
      low: products.filter((p) => stockState(p) === 'low').length,
      out: products.filter((p) => stockState(p) === 'out').length,
      sales: products.reduce((sum, p) => sum + (p.salesCount ?? 0), 0),
    };
  }, [products]);

  const visible = ordered.filter((product) => {
    const state = stockState(product);
    if (filter === 'tracked' && state === 'untracked') return false;
    if (filter === 'low' && state !== 'low') return false;
    if (filter === 'out' && state !== 'out') return false;
    if (filter === 'untracked' && state !== 'untracked') return false;
    if (sectionFilter !== 'all' && product.sectionId !== sectionFilter) return false;
    return matches(search, product.name, ...(product.tags ?? []));
  });

  const filtering = Boolean(search) || filter !== 'all' || sectionFilter !== 'all';
  const resetFilters = () => {
    setSearch('');
    setFilter('all');
    setSectionFilter('all');
  };

  function stockControl(product: MenuProduct) {
    const state = stockState(product);
    if (state === 'untracked') {
      return canStock ? (
        <Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => setAdjusting({ product, mode: 'set' })}>
          Suivre
        </Button>
      ) : (
        <span className="text-xs text-fg-subtle">Non suivi</span>
      );
    }
    const value = (product.stock ?? 0) + (pending[product.id] ?? 0);
    const tone = STOCK_STATE_META[stockState({ stock: value, lowStockThreshold: product.lowStockThreshold })].tone;
    return (
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
        <IconButton label={`Retirer une unité de ${product.name}`} size="xs" disabled={!canStock || value <= 0} onClick={() => step(product, -1)} className="bg-surface shadow-xs">
          <Minus />
        </IconButton>
        <span
          aria-live="polite"
          className={cn(
            `tone-${tone}`,
            'num relative min-w-10 text-center font-mono text-sm font-semibold',
            tone === 'success' || tone === 'neutral' ? 'text-fg' : 'text-(--tone-fg)',
          )}
        >
          {committing[product.id] ? <Spinner className="mx-auto size-3.5" /> : value}
          {pending[product.id] ? <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" aria-label="Ajustement en cours d’envoi" /> : null}
        </span>
        <IconButton label={`Ajouter une unité à ${product.name}`} size="xs" disabled={!canStock} onClick={() => step(product, 1)} className="bg-surface shadow-xs">
          <Plus />
        </IconButton>
      </div>
    );
  }

  function availability(product: MenuProduct) {
    const state = saleState(product);
    const soldOut = product.stock === 0;
    return (
      <Tooltip content={soldOut ? 'En rupture : remis en vente automatiquement au réassort' : product.available ? 'Masquer aux clients' : 'Remettre en vente'}>
        <button
          type="button"
          aria-pressed={product.available && !soldOut}
          aria-label={soldOut ? `${product.name} en rupture` : product.available ? `Masquer ${product.name}` : `Remettre ${product.name} en vente`}
          disabled={!canStock || soldOut}
          onClick={() => void toggleAvailable(product)}
          className={cn(
            `tone-${state.tone}`,
            'inline-flex h-8 items-center gap-2 rounded-full border border-(--tone-border) bg-(--tone-bg) px-3 text-xs font-medium text-(--tone-fg) transition-[filter] hover:brightness-95',
            'focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:hover:brightness-100',
          )}
        >
          <span className="size-1.5 rounded-full bg-(--tone-solid)" aria-hidden="true" />
          {state.label}
        </button>
      </Tooltip>
    );
  }

  function rowMenu(product: MenuProduct) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions pour ${product.name}`} variant="ghost" size="sm">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canStock && (
            <>
              <DropdownMenuItem icon={<PackagePlus />} onSelect={() => setAdjusting({ product, mode: 'add' })}>
                Réception de marchandise
              </DropdownMenuItem>
              <DropdownMenuItem icon={<PackageX />} onSelect={() => setAdjusting({ product, mode: 'remove' })} disabled={product.stock === null}>
                Perte ou casse
              </DropdownMenuItem>
              <DropdownMenuItem icon={<ClipboardCheck />} onSelect={() => setAdjusting({ product, mode: 'set' })}>
                Corriger la quantité
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem icon={<History />} onSelect={() => setHistoryFor(product)} disabled={product.stock === null}>
            Historique des mouvements
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const filterCounts: Record<Filter, number> = {
    all: products.length,
    tracked: stats.tracked,
    low: stats.low,
    out: stats.out,
    untracked: products.length - stats.tracked,
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow={`${restaurant.name} · Carte & inventaire`}
        title="Ventes & stocks"
        description="Gardez la carte à jour pendant le service : ajustez les quantités en un geste, les ruptures sont retirées de la vente automatiquement."
        actions={
          <>
            <Button variant="secondary" leftIcon={<History />} onClick={() => setHistoryFor(null)}>
              Mouvements
            </Button>
            {canStock && (
              <Button variant="primary" leftIcon={<ClipboardCheck />} onClick={() => setInventoryOpen(true)} disabled={loading}>
                Faire l’inventaire
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Produits suivis" value={loading ? '—' : `${stats.tracked}`} icon={<Package />} tone="teal" loading={loading} footer={`sur ${plural(products.length, 'produit')} de la carte`} onClick={() => setFilter('tracked')} />
        <StatCard label="Stock faible" value={stats.low} icon={<AlertTriangle />} tone="amber" loading={loading} footer="Au niveau du seuil d’alerte ou en dessous" onClick={() => setFilter('low')} />
        <StatCard label="En rupture" value={stats.out} icon={<PackageX />} tone="danger" loading={loading} footer="Retirés de la vente automatiquement" onClick={() => setFilter('out')} />
        <StatCard label="Ventes cumulées" value={formatNumber(stats.sales)} icon={<TrendingUp />} tone="brand" loading={loading} footer="Articles vendus depuis la mise en ligne" />
      </div>

      <section aria-label="Inventaire des produits" className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un produit…"
              aria-label="Rechercher un produit en stock"
              leading={<Search />}
              trailing={
                search ? (
                  <button type="button" aria-label="Effacer la recherche" onClick={() => setSearch('')} className="rounded p-0.5 hover:text-fg">
                    <X />
                  </button>
                ) : undefined
              }
              className="sm:w-64"
            />
            <Select
              aria-label="Filtrer par section"
              value={sectionFilter}
              onValueChange={setSectionFilter}
              options={[{ value: 'all', label: 'Toutes les sections' }, ...sectionsState.data.map((s) => ({ value: s.id, label: s.name }))]}
              className="sm:w-52"
            />
          </div>
          <div data-scroll-ok className="max-w-full overflow-x-auto">
            <SegmentedControl
              aria-label="Filtrer les stocks"
              size="sm"
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
              options={(
                [
                  ['all', 'Tous'],
                  ['tracked', 'Suivis'],
                  ['low', 'Stock faible'],
                  ['out', 'Rupture'],
                  ['untracked', 'Non suivis'],
                ] as Array<[Filter, string]>
              ).map(([value, label]) => ({ value, label, count: loading ? undefined : filterCounts[value] }))}
            />
          </div>
        </div>

        {productsState.error ? (
          <EmptyState compact icon={<Package />} title="Impossible de charger les stocks" description={errorMessage(productsState.error)} />
        ) : loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="h-9 w-12 rounded-lg" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-8 w-28 rounded-lg" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            compact
            icon={<Search />}
            title={products.length === 0 ? 'Aucun produit sur la carte' : 'Aucun produit trouvé'}
            description={products.length === 0 ? 'Ajoutez des produits pour suivre leurs stocks.' : 'Essayez un autre nom ou changez de filtre.'}
            action={
              products.length === 0 ? (
                <Button asChild variant="primary">
                  <Link to="/produits">Aller à la carte</Link>
                </Button>
              ) : filtering ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Effacer les filtres
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Tableau (écrans moyens et plus) */}
            <div data-scroll-ok className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-surface-2 font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produit</th>
                    <th className="px-3 py-3 text-right font-medium">Ventes</th>
                    <th className="px-3 py-3 text-right font-medium">Prix</th>
                    <th className="px-3 py-3 text-center font-medium">Stock</th>
                    <th className="px-3 py-3 text-right font-medium">Seuil</th>
                    <th className="px-3 py-3 font-medium">Sur la carte</th>
                    <th className="w-12 px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((product) => {
                    const state: StockState = stockState(product);
                    return (
                      <tr key={product.id} className="transition-colors hover:bg-surface-2/60">
                        <td className="px-4 py-2.5">
                          <Link to={`/produits/${product.id}`} className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
                            <Thumb image={product.image} alt={product.name} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-fg hover:text-primary-soft-fg">{product.name}</span>
                              <span className="block truncate text-xs text-fg-subtle">
                                {product.sectionId ? (sectionById.get(product.sectionId)?.name ?? 'Sans section') : 'Sans section'}
                                {state === 'low' && ' · stock faible'}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="num px-3 py-2.5 text-right font-mono text-fg-muted">{formatNumber(product.salesCount ?? 0)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Price cents={product.saleUnit === 'weight' ? (product.pricePerKgCents ?? product.priceCents) : product.priceCents} suffix={saleUnitSuffix(product)} />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {stockControl(product)}
                        </td>
                        <td className="num px-3 py-2.5 text-right font-mono text-fg-muted">{product.stock === null ? '—' : product.lowStockThreshold}</td>
                        <td className="px-3 py-2.5">
                          {availability(product)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {rowMenu(product)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cartes (mobile) */}
            <ul className="divide-y divide-border md:hidden">
              {visible.map((product) => (
                <li key={product.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Thumb image={product.image} alt={product.name} size="sm" />
                    <Link to={`/produits/${product.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{product.name}</p>
                      <p className="truncate text-xs text-fg-subtle">
                        {product.sectionId ? (sectionById.get(product.sectionId)?.name ?? 'Sans section') : 'Sans section'} · {plural(product.salesCount ?? 0, 'vente')}
                      </p>
                    </Link>
                    <Price cents={product.saleUnit === 'weight' ? (product.pricePerKgCents ?? product.priceCents) : product.priceCents} suffix={saleUnitSuffix(product)} />
                    {rowMenu(product)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="mb-1 font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">Quantité</p>
                      {stockControl(product)}
                    </div>
                    <div className="text-right">
                      <p className="mb-1 font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">Disponibilité</p>
                      {availability(product)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-4 py-2.5 text-xs text-fg-subtle">
              Les boutons − et + enregistrent un mouvement « Correction » après une courte pause. Pour une réception ou une perte, utilisez le menu de chaque ligne.
            </p>
          </>
        )}
      </section>

      <AdjustStockDialog product={adjusting?.product ?? null} initialMode={adjusting?.mode} restaurantId={restaurantId} onOpenChange={(open) => !open && setAdjusting(null)} />
      <StockHistorySheet open={historyFor !== undefined} onOpenChange={(open) => !open && setHistoryFor(undefined)} restaurantId={restaurantId} product={historyFor ?? null} />
      <InventoryDialog open={inventoryOpen} onOpenChange={setInventoryOpen} restaurantId={restaurantId} products={ordered} />
    </PageContainer>
  );
}
