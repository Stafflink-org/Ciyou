// Produits & menu : sections réordonnables, produits, recherche et filtres,
// actions groupées, contrôle qualité, import / export CSV, corbeille.
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileUp,
  FolderInput,
  LayoutList,
  List,
  MoreHorizontal,
  Plus,
  Rows3,
  Search,
  Star,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { MENU_ISSUE_LABELS, MENU_LIMITS, type MenuIssueType } from '@golink/shared';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  toast,
} from '@golink/ui';
import { useAuth, useDocumentTitle, usePersistentState } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { DeleteSectionDialog, MoveProductsDialog } from './components/MenuDialogs';
import { ImportDialog } from './components/ImportDialog';
import { ProductsTable } from './components/ProductsTable';
import { QualityBanner } from './components/QualityBanner';
import { SectionCard, type SectionActions } from './components/SectionCard';
import { SectionDialog } from './components/SectionDialog';
import { TrashSheet } from './components/TrashSheet';
import type { ProductRowActions } from './components/ProductRow';
import { downloadMenuTemplate, exportMenuCsv } from './menu/csv';
import {
  duplicateProduct,
  menuFunctions,
  moveProducts,
  updateProducts,
  updateSection,
  useOptionGroups,
  useProducts,
  useSections,
  type MenuProduct,
  type Section,
} from './menu/data';
import { matches, plural, productIssues, stockState } from './menu/helpers';
import { SortableHint, useSortable } from './menu/sortable';

type StatusFilter = 'all' | 'available' | 'unavailable' | 'out' | 'featured';

export function ProductsPage() {
  useDocumentTitle('Produits & menu · GoLink Restaurant');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const can = useCan();
  const canEdit = can('menu.edit');
  const canStock = can('stock.edit') || canEdit;
  const navigate = useNavigate();

  const sectionsState = useSections(restaurantId);
  const productsState = useProducts(restaurantId);
  const groupsState = useOptionGroups(restaurantId);
  const sections = sectionsState.data;
  const products = productsState.data;
  const loading = sectionsState.loading || productsState.loading;
  const error = sectionsState.error ?? productsState.error;

  const [view, setView] = usePersistentState<'sections' | 'table'>('golink:restaurant:carte-vue', 'sections');
  const [qualityHidden, setQualityHidden] = usePersistentState<boolean>(`golink:restaurant:carte-qualite-masquee:${restaurantId}`, false);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [issue, setIssue] = useState<MenuIssueType | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const [sectionDialog, setSectionDialog] = useState<{ open: boolean; section: Section | null }>({ open: false, section: null });
  const [deleting, setDeleting] = useState<Section | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [tableClear, setTableClear] = useState<(() => void) | null>(null);

  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const groupsById = useMemo(() => new Map(groupsState.data.map((g) => [g.id, g])), [groupsState.data]);
  const orphanProducts = useMemo(() => products.filter((p) => !p.sectionId || !sectionById.has(p.sectionId)), [products, sectionById]);

  const filtering = Boolean(search.trim()) || sectionFilter !== 'all' || status !== 'all' || issue !== null;

  const visible = useMemo(
    () =>
      products.filter((product) => {
        const section = product.sectionId ? sectionById.get(product.sectionId) : undefined;
        if (sectionFilter === '__none' ? section : sectionFilter !== 'all' && product.sectionId !== sectionFilter) return false;
        if (status === 'available' && !(product.available && product.stock !== 0)) return false;
        if (status === 'unavailable' && product.available && product.stock !== 0) return false;
        if (status === 'out' && stockState(product) !== 'out') return false;
        if (status === 'featured' && !product.featured) return false;
        if (issue && !productIssues(product).includes(issue)) return false;
        return matches(search, product.name, product.description, section?.name, ...(product.tags ?? []));
      }),
    [products, sectionById, sectionFilter, status, issue, search],
  );
  const visibleBySection = useMemo(() => {
    const map = new Map<string, MenuProduct[]>();
    for (const product of visible) {
      const key = product.sectionId && sectionById.has(product.sectionId) ? product.sectionId : '__none';
      map.set(key, [...(map.get(key) ?? []), product]);
    }
    return map;
  }, [visible, sectionById]);
  const totalBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) {
      const key = product.sectionId && sectionById.has(product.sectionId) ? product.sectionId : '__none';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [products, sectionById]);

  const selectedProducts = useMemo(() => products.filter((p) => selection.has(p.id)), [products, selection]);

  // ---------------------------------------------------------------- Réordonnancement
  const commitSections = useCallback(
    (ids: string[]) => menuFunctions.reorderMenu({ kind: 'sections', restaurantId, ids }).catch((caught: unknown) => {
      toast.error(errorMessage(caught));
      throw caught;
    }),
    [restaurantId],
  );
  const sectionSortable = useSortable(
    sections.map((s) => s.id),
    commitSections,
    !canEdit || filtering,
  );
  const orderedSections = sectionSortable.order.map((id) => sectionById.get(id)).filter((s): s is Section => Boolean(s));

  // ---------------------------------------------------------------- Actions
  const run = useCallback(async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) toast.success(success);
      return true;
    } catch (caught) {
      toast.error(errorMessage(caught));
      return false;
    }
  }, []);

  const sectionActions: SectionActions = useMemo(
    () => ({
      onEdit: (section) => setSectionDialog({ open: true, section }),
      onToggle: (section, enabled) =>
        void run(() => updateSection(restaurantId, uid, section.id, { enabled }), enabled ? `« ${section.name} » est visible` : `« ${section.name} » est masquée aux clients`),
      onDuplicate: (section, withProducts) =>
        void run(async () => {
          const result = await menuFunctions.duplicateSection({ restaurantId, sectionId: section.id, withProducts });
          toast.success(
            withProducts
              ? `« ${result.name} » créée avec ${plural(result.products, 'produit')}, masquée le temps de la relire`
              : `« ${result.name} » créée, masquée le temps de la compléter`,
          );
        }),
      onDelete: (section) => setDeleting(section),
      onMove: (section, direction) => {
        const ids = sections.map((s) => s.id);
        const from = ids.indexOf(section.id);
        const to = from + direction;
        if (to < 0 || to >= ids.length) return;
        ids.splice(from, 1);
        ids.splice(to, 0, section.id);
        void run(() => menuFunctions.reorderMenu({ kind: 'sections', restaurantId, ids }));
      },
      onReorderProducts: (sectionId, ids) =>
        menuFunctions.reorderMenu({ kind: 'products', restaurantId, sectionId, ids }).catch((caught: unknown) => {
          toast.error(errorMessage(caught));
          throw caught;
        }),
    }),
    [restaurantId, run, sections, uid],
  );

  const featuredCount = products.filter((p) => p.featured).length;

  const productActions: ProductRowActions = useMemo(
    () => ({
      onToggleAvailable: (product, available) =>
        void run(() => updateProducts(restaurantId, uid, [product.id], { available }), available ? `« ${product.name} » est en vente` : `« ${product.name} » est indisponible`),
      onDuplicate: (product) =>
        void run(
          () => duplicateProduct(restaurantId, uid, product, product.sectionId ? (sectionById.get(product.sectionId)?.name ?? null) : null),
          'Copie ajoutée, indisponible le temps de la relire',
        ),
      onToggleFeatured: (product) => {
        if (!product.featured && featuredCount >= MENU_LIMITS.featured) {
          toast.error(`La vitrine est limitée à ${MENU_LIMITS.featured} produits : retirez-en un d’abord.`);
          return;
        }
        const nextOrder = products.reduce((max, p) => (p.featured ? Math.max(max, p.featuredOrder ?? 0) : max), -1) + 1;
        void run(
          () => updateProducts(restaurantId, uid, [product.id], product.featured ? { featured: false, featuredOrder: null } : { featured: true, featuredOrder: nextOrder }),
          product.featured ? 'Produit retiré de la vitrine' : 'Produit mis en vitrine',
        );
      },
      onDelete: (product) => setDeleteIds([product.id]),
    }),
    [featuredCount, products, restaurantId, run, sectionById, uid],
  );

  function select(product: MenuProduct, selected: boolean) {
    setSelection((current) => {
      const next = new Set(current);
      if (selected) next.add(product.id);
      else next.delete(product.id);
      return next;
    });
  }
  function selectMany(list: MenuProduct[], selected: boolean) {
    setSelection((current) => {
      const next = new Set(current);
      list.forEach((p) => (selected ? next.add(p.id) : next.delete(p.id)));
      return next;
    });
  }
  function clearSelection() {
    setSelection(new Set());
    tableClear?.();
    setTableClear(null);
  }

  async function bulk(action: 'available' | 'unavailable' | 'move' | 'feature' | 'delete', rows: MenuProduct[]) {
    const ids = rows.map((r) => r.id);
    if (action === 'move') return setMoveOpen(true);
    if (action === 'delete') return setDeleteIds(ids);
    if (action === 'feature') {
      const toAdd = rows.filter((r) => !r.featured);
      if (featuredCount + toAdd.length > MENU_LIMITS.featured) {
        toast.error(`La vitrine est limitée à ${MENU_LIMITS.featured} produits (${featuredCount} déjà en vitrine).`);
        return;
      }
      let next = products.reduce((max, p) => (p.featured ? Math.max(max, p.featuredOrder ?? 0) : max), -1) + 1;
      const ok = await run(async () => {
        for (const row of toAdd) await updateProducts(restaurantId, uid, [row.id], { featured: true, featuredOrder: next++ });
      }, toAdd.length ? `${plural(toAdd.length, 'produit mis', 'produits mis')} en vitrine` : 'Déjà en vitrine');
      if (ok) clearSelection();
      return;
    }
    const available = action === 'available';
    const ok = await run(
      () => updateProducts(restaurantId, uid, ids, { available }),
      available ? `${plural(ids.length, 'produit remis', 'produits remis')} en vente` : `${plural(ids.length, 'produit rendu', 'produits rendus')} indisponible${ids.length > 1 ? 's' : ''}`,
    );
    if (ok) clearSelection();
  }

  async function confirmMove(sectionId: string | null) {
    const target = sectionId ? (sectionById.get(sectionId) ?? null) : null;
    const start = products.filter((p) => (p.sectionId ?? null) === sectionId).reduce((max, p) => Math.max(max, p.order), -1) + 1;
    const ok = await run(
      () => moveProducts(restaurantId, uid, selectedProducts, target, start),
      `${plural(selectedProducts.length, 'produit déplacé', 'produits déplacés')} vers « ${target?.name ?? 'Sans section'} »`,
    );
    if (ok) clearSelection();
  }

  async function confirmDeleteProducts() {
    if (!deleteIds) return;
    const count = deleteIds.length;
    const ok = await run(
      () => menuFunctions.trashMenuItems({ restaurantId, kind: 'product', ids: deleteIds }),
      count > 1 ? `${count} produits placés dans la corbeille` : 'Produit placé dans la corbeille',
    );
    if (ok) {
      setSelection((current) => new Set([...current].filter((id) => !deleteIds.includes(id))));
      tableClear?.();
    }
  }

  function resetFilters() {
    setSearch('');
    setSectionFilter('all');
    setStatus('all');
    setIssue(null);
  }

  // ---------------------------------------------------------------- Rendu
  const empty = !loading && !error && sections.length === 0 && products.length === 0;
  const available = products.filter((p) => p.available && p.stock !== 0).length;
  const outCount = products.filter((p) => stockState(p) === 'out').length;
  const hiddenSections = sections.filter((s) => !s.enabled).length;
  const sectionOptions = [
    { value: 'all', label: 'Toutes les sections' },
    ...sections.map((s) => ({ value: s.id, label: s.name })),
    ...(orphanProducts.length ? [{ value: '__none', label: 'Sans section' }] : []),
  ];

  return (
    <PageContainer>
      <SortableHint />
      <PageHeader
        eyebrow={`${restaurant.name} · Carte`}
        title="Produits & menu"
        description="Organisez votre carte, de la première section au dernier supplément. Les changements sont visibles immédiatement dans l’app GoLink."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" leftIcon={<FileSpreadsheet />} rightIcon={<MoreHorizontal />}>
                  <span className="hidden sm:inline">Import / export</span>
                  <span className="sm:hidden">CSV</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {canEdit && (
                  <DropdownMenuItem icon={<FileUp />} onSelect={() => setImportOpen(true)}>
                    Importer un fichier CSV…
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem icon={<Download />} disabled={products.length === 0} onSelect={() => exportMenuCsv(restaurant.name, sections, products)}>
                  Exporter la carte (CSV)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<FileSpreadsheet />} onSelect={downloadMenuTemplate}>
                  Télécharger le modèle
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canEdit && (
              <>
                <IconButton label="Corbeille de la carte" variant="secondary" onClick={() => setTrashOpen(true)}>
                  <Trash2 />
                </IconButton>
                <Button variant="secondary" leftIcon={<LayoutList />} onClick={() => setSectionDialog({ open: true, section: null })}>
                  Nouvelle section
                </Button>
                <Button variant="primary" leftIcon={<Plus />} onClick={() => navigate('/produits/nouveau')} disabled={loading}>
                  Nouveau produit
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Indicateurs */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Produits', value: products.length, hint: `${available} en vente` },
          { label: 'Sections', value: sections.length, hint: hiddenSections ? `${hiddenSections} masquée${hiddenSections > 1 ? 's' : ''}` : 'Toutes visibles' },
          { label: 'En rupture', value: outCount, hint: outCount ? 'À réapprovisionner' : 'Aucune rupture', tone: outCount ? 'text-danger' : '' },
          { label: 'En vitrine', value: `${featuredCount}/${MENU_LIMITS.featured}`, hint: 'Produits mis en avant' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
            <p className="text-xs font-medium text-fg-muted">{stat.label}</p>
            {loading ? (
              <Skeleton className="mt-1.5 h-7 w-14" />
            ) : (
              <p className={`num mt-0.5 font-display text-2xl font-semibold tracking-display text-fg ${stat.tone ?? ''}`}>{stat.value}</p>
            )}
            <p className="mt-0.5 truncate text-xs text-fg-subtle">{stat.hint}</p>
          </div>
        ))}
      </div>

      {!loading && !qualityHidden && (
        <QualityBanner products={products} active={issue} onFilter={setIssue} onDismiss={() => setQualityHidden(true)} />
      )}

      {/* Barre d'outils */}
      {!empty && (
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un produit, une section, une étiquette…"
            aria-label="Rechercher dans la carte"
            leading={<Search />}
            trailing={
              search ? (
                <button type="button" aria-label="Effacer la recherche" onClick={() => setSearch('')} className="rounded p-0.5 hover:text-fg">
                  <X />
                </button>
              ) : undefined
            }
            className="lg:w-80 lg:shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Select aria-label="Filtrer par section" value={sectionFilter} onValueChange={setSectionFilter} options={sectionOptions} className="w-full sm:w-52" />
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl
                aria-label="Filtrer par état"
                size="sm"
                value={status}
                onValueChange={(value) => setStatus(value as StatusFilter)}
                options={[
                  { value: 'all', label: 'Tous' },
                  { value: 'available', label: 'En vente' },
                  { value: 'unavailable', label: 'Indisponibles' },
                  { value: 'out', label: 'Rupture' },
                  { value: 'featured', label: 'Vitrine', icon: <Star /> },
                ]}
              />
            </div>
            {issue && (
              <Button size="sm" variant="soft" rightIcon={<X />} onClick={() => setIssue(null)}>
                {MENU_ISSUE_LABELS[issue]}
              </Button>
            )}
            <div className="ml-auto">
              <SegmentedControl
                aria-label="Affichage"
                size="sm"
                value={view}
                onValueChange={(value) => setView(value as 'sections' | 'table')}
                options={[
                  { value: 'sections', label: <span className="sr-only sm:not-sr-only">Sections</span>, icon: <Rows3 /> },
                  { value: 'table', label: <span className="sr-only sm:not-sr-only">Liste</span>, icon: <List /> },
                ]}
              />
            </div>
          </div>
        </div>
      )}

      {filtering && !loading && view === 'sections' && (
        <p className="mb-3 text-sm text-fg-muted" aria-live="polite">
          {plural(visible.length, 'produit affiché', 'produits affichés')} sur {products.length}.{' '}
          <button type="button" onClick={resetFilters} className="font-medium text-primary-soft-fg underline-offset-4 hover:underline">
            Effacer les filtres
          </button>
          {canEdit && <span className="text-fg-subtle"> · Le glisser-déposer est désactivé pendant un filtrage.</span>}
        </p>
      )}

      {error ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={<UtensilsCrossed />} title="Impossible de charger la carte" description={errorMessage(error)} />
        </div>
      ) : loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex items-center gap-3 bg-surface-2/60 p-4">
                <Skeleton className="h-11 w-[58px] rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              {Array.from({ length: 3 }, (_, j) => (
                <div key={j} className="flex items-center gap-3 border-t border-border p-3">
                  <Skeleton className="h-11 w-[58px] rounded-lg" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-14" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-surface">
          <EmptyState
            icon={<UtensilsCrossed />}
            title="Votre carte commence ici"
            description="Créez une première section (Entrées, Plats, Desserts…), puis ajoutez-y vos produits. Vous pouvez aussi importer une carte existante."
            action={
              canEdit ? (
                <>
                  <Button variant="primary" leftIcon={<LayoutList />} onClick={() => setSectionDialog({ open: true, section: null })}>
                    Créer la première section
                  </Button>
                  <Button variant="secondary" leftIcon={<FileUp />} onClick={() => setImportOpen(true)}>
                    Importer un CSV
                  </Button>
                </>
              ) : undefined
            }
          />
        </div>
      ) : view === 'table' ? (
        <ProductsTable
          products={visible}
          sections={sections}
          loading={loading}
          canEdit={canEdit}
          onBulk={(action, rows, clear) => {
            setSelection(new Set(rows.map((r) => r.id)));
            setTableClear(() => clear);
            void bulk(action, rows);
          }}
        />
      ) : visible.length === 0 && filtering ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            compact
            icon={<Search />}
            title="Aucun produit ne correspond"
            description="Essayez un autre nom, une autre section ou un autre filtre."
            action={
              <Button variant="secondary" onClick={resetFilters}>
                Effacer les filtres
              </Button>
            }
          />
        </div>
      ) : (
        <ol className="space-y-4" aria-label="Sections de la carte">
          {orderedSections
            .filter((section) => !filtering || (visibleBySection.get(section.id)?.length ?? 0) > 0)
            .map((section, index) => (
              <SectionCard
                key={section.id}
                section={section}
                products={visibleBySection.get(section.id) ?? []}
                totalCount={totalBySection.get(section.id) ?? 0}
                index={index}
                sectionsCount={sections.length}
                canEdit={canEdit}
                canStock={canStock}
                reorderable={!filtering}
                selection={selection}
                onSelect={select}
                onSelectMany={selectMany}
                sectionSortable={sectionSortable}
                sectionActions={sectionActions}
                productActions={productActions}
                groupsById={groupsById}
              />
            ))}
          {(visibleBySection.get('__none')?.length ?? 0) > 0 && (
            <SectionCard
              section={null}
              products={visibleBySection.get('__none') ?? []}
              totalCount={totalBySection.get('__none') ?? 0}
              index={sections.length}
              sectionsCount={sections.length}
              canEdit={canEdit}
              canStock={canStock}
              reorderable={!filtering}
              selection={selection}
              onSelect={select}
              onSelectMany={selectMany}
              sectionActions={sectionActions}
              productActions={productActions}
              groupsById={groupsById}
            />
          )}
        </ol>
      )}

      {/* Barre d'actions groupées (vue par sections) */}
      {view === 'sections' && selection.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="Actions sur la sélection"
            className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-elevated p-1.5 shadow-xl"
          >
            <span className="num whitespace-nowrap px-2.5 text-sm font-medium text-fg">{plural(selection.size, 'sélectionné', 'sélectionnés')}</span>
            <Button size="sm" variant="ghost" leftIcon={<Eye />} onClick={() => void bulk('available', selectedProducts)}>
              <span className="hidden sm:inline">En vente</span>
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<EyeOff />} onClick={() => void bulk('unavailable', selectedProducts)}>
              <span className="hidden sm:inline">Indisponibles</span>
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<FolderInput />} onClick={() => setMoveOpen(true)}>
              <span className="hidden sm:inline">Déplacer</span>
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<Star />} onClick={() => void bulk('feature', selectedProducts)}>
              <span className="hidden sm:inline">Vitrine</span>
            </Button>
            <Button size="sm" variant="danger-soft" leftIcon={<Trash2 />} onClick={() => setDeleteIds([...selection])}>
              <span className="hidden sm:inline">Supprimer</span>
            </Button>
            <IconButton label="Annuler la sélection" variant="ghost" size="sm" onClick={clearSelection}>
              <X />
            </IconButton>
          </div>
        </div>
      )}

      <SectionDialog
        open={sectionDialog.open}
        onOpenChange={(open) => setSectionDialog((current) => ({ ...current, open }))}
        restaurantId={restaurantId}
        sections={sections}
        section={sectionDialog.section}
      />
      <DeleteSectionDialog
        section={deleting}
        productCount={deleting ? (totalBySection.get(deleting.id) ?? 0) : 0}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={async (withProducts) => {
          if (!deleting) return;
          await run(
            () => menuFunctions.trashMenuItems({ restaurantId, kind: 'section', ids: [deleting.id], withProducts }),
            withProducts ? 'Section et produits placés dans la corbeille' : 'Section placée dans la corbeille ; ses produits sont dans « Sans section »',
          );
        }}
      />
      <MoveProductsDialog open={moveOpen} count={selectedProducts.length} sections={sections} onOpenChange={setMoveOpen} onConfirm={confirmMove} />
      <ConfirmDialog
        open={deleteIds !== null}
        onOpenChange={(open) => !open && setDeleteIds(null)}
        destructive
        title={deleteIds && deleteIds.length > 1 ? `Supprimer ${deleteIds.length} produits ?` : 'Supprimer ce produit ?'}
        description={`Retiré immédiatement de la carte, il reste restaurable depuis la corbeille pendant ${MENU_LIMITS.trashDays} jours.`}
        confirmLabel="Supprimer"
        onConfirm={confirmDeleteProducts}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} restaurantId={restaurantId} />
      <TrashSheet open={trashOpen} onOpenChange={setTrashOpen} restaurantId={restaurantId} kinds={['section', 'product']} />
    </PageContainer>
  );
}
