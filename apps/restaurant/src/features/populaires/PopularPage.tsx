// Produits mis en avant : vitrine ordonnée (glisser-déposer) affichée en tête de la
// page du restaurant dans l'app Ciyou Eats, et classement des ventes pour la composer.
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Flame, ImageOff, Search, Sparkles, Star, StarOff, Trophy, X } from 'lucide-react';
import { MENU_LIMITS, PRODUCT_BADGE_LABELS } from '@golink/shared';
import { Badge, Button, cn, EmptyState, formatEUR, formatNumber, IconButton, Input, PageContainer, PageHeader, Select, Skeleton, toast, Tooltip } from '@golink/ui';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { menuFunctions, updateProducts, useProducts, useSections, type MenuProduct } from '../produits/menu/data';
import { matches, plural, saleState } from '../produits/menu/helpers';
import { DragHandle, SortableHint, useSortable } from '../produits/menu/sortable';
import { Price, Thumb } from '../produits/menu/ui';

const PAGE = 24;

export function PopularPage() {
  useDocumentTitle('Produits mis en avant · Ciyou Eats Restaurant');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const canEdit = useCan()('menu.edit');
  const productsState = useProducts(restaurantId);
  const sectionsState = useSections(restaurantId);
  const products = productsState.data;
  const loading = productsState.loading;

  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  const sectionName = useMemo(() => new Map(sectionsState.data.map((s) => [s.id, s.name])), [sectionsState.data]);
  const featured = useMemo(
    () => products.filter((p) => p.featured).sort((a, b) => (a.featuredOrder ?? 999) - (b.featuredOrder ?? 999) || a.order - b.order),
    [products],
  );
  const ranking = useMemo(() => [...products].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0) || a.order - b.order), [products]);
  const rankOf = useMemo(() => new Map(ranking.map((p, index) => [p.id, index + 1])), [ranking]);
  const topSales = ranking[0]?.salesCount ?? 0;

  const commitOrder = useCallback(
    (ids: string[]) =>
      menuFunctions.reorderMenu({ kind: 'featured', restaurantId, ids }).catch((caught: unknown) => {
        toast.error(errorMessage(caught));
        throw caught;
      }),
    [restaurantId],
  );
  const sortable = useSortable(
    featured.map((p) => p.id),
    commitOrder,
    !canEdit,
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  const showcase = sortable.order.map((id) => byId.get(id)).filter((p): p is MenuProduct => Boolean(p));

  async function toggle(product: MenuProduct) {
    if (!product.featured && featured.length >= MENU_LIMITS.featured) {
      toast.error(`La vitrine est limitée à ${MENU_LIMITS.featured} produits : retirez-en un d’abord.`);
      return;
    }
    setBusy(product.id);
    try {
      const next = featured.reduce((max, p) => Math.max(max, p.featuredOrder ?? 0), -1) + 1;
      await updateProducts(restaurantId, uid, [product.id], product.featured ? { featured: false, featuredOrder: null } : { featured: true, featuredOrder: next });
      toast.success(product.featured ? 'Produit retiré de la vitrine' : 'Produit mis en avant');
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const candidates = ranking.filter((p) => (sectionFilter === 'all' || p.sectionId === sectionFilter) && matches(search, p.name, p.sectionId ? sectionName.get(p.sectionId) : null));
  const full = featured.length >= MENU_LIMITS.featured;

  return (
    <PageContainer>
      <SortableHint />
      <PageHeader
        eyebrow={`${restaurant.name} · Vitrine`}
        title="Produits mis en avant"
        description="Mettez vos incontournables en avant : ils s’affichent en tête de votre page dans l’app Ciyou Eats. Les ventes vous guident, vous décidez de l’ordre."
      />

      {/* Bandeau */}
      <div className="tone-brand relative mb-6 overflow-hidden rounded-2xl border border-(--tone-border) bg-(--tone-bg) p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full border-[28px] border-(--tone-solid) opacity-10" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="eyebrow text-(--tone-fg)!">Ce qui marche chez vous</p>
            <h2 className="mt-1.5 max-w-lg font-display text-xl font-semibold tracking-tight text-fg sm:text-2xl">Vos favoris méritent la première place.</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {ranking[0] && topSales > 0 ? (
                <>
                  Meilleure vente : <span className="font-medium text-fg">{ranking[0].name}</span> ({plural(topSales, 'vente')}).
                </>
              ) : (
                'Le classement se construit avec vos premières commandes.'
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4 rounded-xl bg-surface/80 px-5 py-3 shadow-card">
            <div className="text-center">
              <p className="num font-display text-3xl font-semibold tracking-display text-fg">
                {loading ? '—' : featured.length}
                <span className="text-lg text-fg-subtle">/{MENU_LIMITS.featured}</span>
              </p>
              <p className="text-xs text-fg-muted">en vitrine</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Vitrine ordonnée */}
        <section aria-labelledby="vitrine-title" className="min-w-0 self-start rounded-xl border border-border bg-surface shadow-card">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 id="vitrine-title" className="flex items-center gap-2 font-display text-md font-semibold tracking-tight text-fg">
                <Sparkles className="size-4 text-primary" aria-hidden="true" /> Votre vitrine
              </h2>
              <p className="text-xs text-fg-muted">{canEdit ? 'Glissez pour changer l’ordre d’affichage.' : 'Ordre d’affichage dans l’app.'}</p>
            </div>
          </header>
          {loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : showcase.length === 0 ? (
            <EmptyState compact icon={<Star />} title="Aucun produit en vitrine" description="Choisissez vos meilleurs produits dans le classement des ventes." />
          ) : (
            <ol className="p-2" aria-label="Produits en vitrine">
              {showcase.map((product, index) => {
                const state = saleState(product);
                return (
                  <li key={product.id} {...sortable.itemProps(product.id)} className={cn(sortable.itemProps(product.id).className, 'flex items-center gap-2.5 rounded-lg bg-surface px-2 py-2 hover:bg-surface-2')}>
                    {canEdit && <DragHandle {...sortable.handleProps(product.id, `Déplacer ${product.name} dans la vitrine`)} />}
                    <span className="num w-6 text-center font-mono text-xs font-medium text-fg-subtle">{String(index + 1).padStart(2, '0')}</span>
                    <Thumb image={product.image} alt={product.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/produits/${product.id}`} className="block truncate text-sm font-medium text-fg hover:text-primary-soft-fg">
                        {product.name}
                      </Link>
                      <p className="flex items-center gap-2 text-xs text-fg-subtle">
                        <span>{plural(product.salesCount ?? 0, 'vente')}</span>
                        {state.label !== 'En ligne' && (
                          <Badge tone={state.tone} size="sm">
                            {state.label}
                          </Badge>
                        )}
                      </p>
                    </div>
                    <Price cents={product.priceCents} />
                    {canEdit && (
                      <IconButton label={`Retirer ${product.name} de la vitrine`} variant="danger" size="sm" loading={busy === product.id} onClick={() => void toggle(product)}>
                        <StarOff />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {showcase.length > 0 && (
            <div className="border-t border-border p-4">
              <p className="mb-2.5 font-mono text-3xs uppercase tracking-eyebrow text-fg-subtle">Aperçu dans l’app Ciyou Eats</p>
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                {showcase.slice(0, 6).map((product) => (
                  <div key={product.id} className="w-36 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
                    <div className="relative aspect-[4/3] bg-surface-3">
                      {product.image?.thumbUrl || product.image?.url ? (
                        <img src={product.image.thumbUrl || product.image.url} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <div className="grid size-full place-items-center text-fg-subtle">
                          <ImageOff className="size-5" aria-hidden="true" />
                        </div>
                      )}
                      {product.badge && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-3xs font-medium text-white">{PRODUCT_BADGE_LABELS[product.badge]}</span>}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-semibold text-fg">{product.name}</p>
                      <p className="num font-mono text-xs text-fg-muted">{formatEUR(product.priceCents, { cents: true })}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Classement */}
        <section aria-labelledby="classement-title" className="min-w-0 rounded-xl border border-border bg-surface shadow-card">
          <header className="flex flex-col gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 id="classement-title" className="flex items-center gap-2 font-display text-md font-semibold tracking-tight text-fg">
                <Trophy className="size-4 text-fg-muted" aria-hidden="true" /> Classement des ventes
              </h2>
              <p className="text-xs text-fg-muted">Tous vos produits, du plus vendu au moins vendu.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setLimit(PAGE);
                }}
                placeholder="Rechercher un produit…"
                aria-label="Rechercher un produit"
                leading={<Search />}
                trailing={
                  search ? (
                    <button type="button" aria-label="Effacer la recherche" onClick={() => setSearch('')} className="rounded p-0.5 hover:text-fg">
                      <X />
                    </button>
                  ) : undefined
                }
                className="flex-1"
              />
              <Select
                aria-label="Section"
                value={sectionFilter}
                onValueChange={(value) => {
                  setSectionFilter(value);
                  setLimit(PAGE);
                }}
                options={[{ value: 'all', label: 'Toutes les sections' }, ...sectionsState.data.map((s) => ({ value: s.id, label: s.name }))]}
                className="sm:w-52"
              />
            </div>
          </header>
          {productsState.error ? (
            <EmptyState compact icon={<Flame />} title="Impossible de charger les produits" description={errorMessage(productsState.error)} />
          ) : loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState
              compact
              icon={<Search />}
              title="Aucun produit ne correspond"
              description="Essayez un autre nom ou une autre section."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setSectionFilter('all');
                  }}
                >
                  Effacer les filtres
                </Button>
              }
            />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {candidates.slice(0, limit).map((product) => {
                  const rank = rankOf.get(product.id) ?? 0;
                  const share = topSales > 0 ? (product.salesCount ?? 0) / topSales : 0;
                  return (
                    <li key={product.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={cn('num w-9 shrink-0 rounded-md py-0.5 text-center font-mono text-xs font-semibold', rank <= 3 ? 'tone-brand bg-(--tone-bg) text-(--tone-fg)' : 'bg-surface-3 text-fg-muted')}>
                        #{String(rank).padStart(2, '0')}
                      </span>
                      <Thumb image={product.image} alt={product.name} size="sm" className="hidden sm:block" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{product.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, share * 100)}%` }} />
                          </div>
                          <span className="num shrink-0 font-mono text-2xs text-fg-subtle">{formatNumber(product.salesCount ?? 0)} ventes</span>
                        </div>
                      </div>
                      <Price cents={product.priceCents} className="hidden sm:inline" />
                      <Tooltip content={product.featured ? 'Retirer de la vitrine' : full ? `Vitrine complète (${MENU_LIMITS.featured} produits)` : 'Mettre en avant'} disabled={!canEdit}>
                        <span className="inline-flex">
                          <Button
                            size="sm"
                            variant={product.featured ? 'soft' : 'secondary'}
                            leftIcon={<Star className={cn(product.featured && 'fill-current')} />}
                            disabled={!canEdit || (!product.featured && full)}
                            loading={busy === product.id}
                            aria-pressed={product.featured}
                            aria-label={product.featured ? `Retirer ${product.name} de la vitrine` : `Mettre ${product.name} en avant`}
                            onClick={() => void toggle(product)}
                          >
                            <span className="hidden sm:inline">{product.featured ? 'En vitrine' : 'Mettre en avant'}</span>
                          </Button>
                        </span>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
              {candidates.length > limit && (
                <div className="border-t border-border p-3 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                    Afficher plus ({candidates.length - limit} restants)
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
