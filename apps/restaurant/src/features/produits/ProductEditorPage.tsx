// Fiche produit complète (création et modification) : informations, photos, prix,
// allergènes et régimes, listes d'options, disponibilité, vitrine, stock, qualité.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  History,
  Lock,
  MoreHorizontal,
  PackagePlus,
  Save,
  Star,
  Trash2,
  Ban,
  Scale,
} from 'lucide-react';
import {
  MENU_DIETARY_LABELS,
  MENU_DIETARY_TAGS,
  MENU_ISSUE_LABELS,
  MENU_LIMITS,
  PRODUCT_BADGES,
  PRODUCT_BADGE_LABELS,
  SELECTABLE_VAT_CATEGORIES,
  VAT_CATEGORY_LABELS,
  COLLECTIONS,
  findAlcoholTerm,
  MENU_ISSUE_DOC_SUFFIX,
  paths,
  type MenuIssue,
  type ImageRef,
  type MenuDietaryTag,
  type MenuIssueType,
  type Product,
} from '@golink/shared';
import {
  Badge,
  Button,
  Checkbox,
  cn,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  formatDateTime,
  formatEUR,
  formatNumber,
  FormField,
  IconButton,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@golink/ui';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { serverTimestamp, updateDoc } from 'firebase/firestore';
import { docAt, errorMessage, toDate, useDoc } from '@/lib/firestore';
import { AdjustStockDialog } from './menu/AdjustStockDialog';
import {
  createProduct,
  duplicateProduct,
  emptyProduct,
  menuFunctions,
  newProductId,
  updateProduct,
  useOptionGroups,
  useOptions,
  useProducts,
  useSections,
  type MenuProduct,
  type ProductDraft,
} from './menu/data';
import { centsToInput, parseEuros, productIssues, saleState, stockState, STOCK_STATE_META } from './menu/helpers';
import { PhotoManager } from './menu/PhotoManager';
import { AllergenPicker, Panel, ScheduleEditor, TagInput, Thumb, ToggleChips } from './menu/ui';
import { StockHistorySheet } from './menu/StockHistorySheet';

type SaleUnit = 'unit' | 'weight' | 'variable';

/** Commerces où les allergènes/régimes ont un sens (alimentaire) ; masqués pour les autres (fleuriste, pharmacie…). */
const FOOD_MERCHANT_TYPES = ['restaurant', 'grocery', 'bakery'];

interface FormState {
  draft: ProductDraft;
  price: string;
  compareAt: string;
  prep: string;
  perKg: string;
  stepGrams: string;
  minGrams: string;
  maxGrams: string;
  variableMax: string;
  vatOverride: string;
  threshold: string;
  initialStock: string;
  trackStock: boolean;
}

function toForm(draft: ProductDraft): FormState {
  return {
    draft,
    price: draft.priceCents ? centsToInput(draft.priceCents) : '',
    compareAt: centsToInput(draft.compareAtPriceCents ?? null),
    prep: draft.preparationMinutes ? String(draft.preparationMinutes) : '',
    perKg: centsToInput(draft.pricePerKgCents ?? null),
    stepGrams: draft.weightStepGrams ? String(draft.weightStepGrams) : '100',
    minGrams: draft.minWeightGrams ? String(draft.minWeightGrams) : '',
    maxGrams: draft.maxWeightGrams ? String(draft.maxWeightGrams) : '',
    variableMax: centsToInput(draft.variablePriceMaxCents ?? null),
    vatOverride: draft.vatRateBpsOverride ? String(draft.vatRateBpsOverride / 100).replace('.', ',') : '',
    threshold: String(draft.lowStockThreshold ?? 5),
    initialStock: draft.stock === null ? '' : String(draft.stock),
    trackStock: draft.stock !== null,
  };
}

function draftOf(product: MenuProduct): ProductDraft {
  const { id: _id, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, salesCount: _s, searchKeywords: _k, ...draft } = product;
  return { gallery: [], tags: [], badge: null, schedule: null, featuredOrder: null, autoSoldOut: false, qualityIssues: [], ...draft };
}

type Errors = Partial<
  Record<
    'name' | 'price' | 'compareAt' | 'prep' | 'vat' | 'vatOverride' | 'perKg' | 'stepGrams' | 'minGrams' | 'maxGrams' | 'variableMax' | 'threshold' | 'initialStock' | 'schedule',
    string
  >
>;

export function ProductEditorPage() {
  const { productId } = useParams();
  const isNew = !productId || productId === 'nouveau';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const can = useCan();
  const canEdit = can('menu.edit');
  const canStock = can('stock.edit') || canEdit;

  const [id] = useState(() => (isNew ? newProductId(restaurantId) : productId!));
  const productState = useDoc<Product>(isNew ? null : docAt(`${paths.restaurantSub(restaurantId, 'products')}/${productId}`));
  const sections = useSections(restaurantId);
  const groups = useOptionGroups(restaurantId);
  const options = useOptions(restaurantId);
  const products = useProducts(restaurantId);
  const product = productState.data ? ({ ...productState.data, id: productId! } as MenuProduct) : null;
  // Signalement « mention d'alcool » du produit enregistré (levé = ignoré après vérification).
  const savedAlcoholTerm = product ? findAlcoholTerm(product.name, product.description) : null;
  const alcoholIssuePath = `${COLLECTIONS.menuIssues}/${restaurantId}-${productId}-${MENU_ISSUE_DOC_SUFFIX.alcohol_suspected}`;
  const alcoholIssue = useDoc<MenuIssue>(savedAlcoholTerm ? docAt(alcoholIssuePath) : null);
  const [clearing, setClearing] = useState(false);

  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<string>('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [history, setHistory] = useState(false);
  const skipBlock = useRef(false);

  useDocumentTitle(`${isNew ? 'Nouveau produit' : (product?.name ?? 'Produit')} · GoLink Restaurant`);

  // Initialisation du formulaire (une fois les données chargées).
  useEffect(() => {
    if (form) return;
    if (isNew) {
      if (sections.loading || products.loading) return;
      const sectionId = params.get('section') ?? sections.data[0]?.id ?? null;
      const order = products.data.filter((p) => p.sectionId === sectionId).reduce((max, p) => Math.max(max, p.order), -1) + 1;
      const next = toForm(emptyProduct(sectionId, order));
      setForm(next);
      setInitial(JSON.stringify(next));
    } else if (product) {
      const next = toForm(draftOf(product));
      setForm(next);
      setInitial(JSON.stringify(next));
    }
  }, [form, isNew, params, product, products.data, products.loading, sections.data, sections.loading]);

  // Le stock et la vitrine peuvent changer ailleurs (service, autre écran) : on les suit en direct.
  useEffect(() => {
    if (!product || !form) return;
    if (product.stock !== form.draft.stock || product.featured !== form.draft.featured || product.qualityIssues !== form.draft.qualityIssues) {
      setForm((current) =>
        current
          ? { ...current, draft: { ...current.draft, stock: product.stock, featured: product.featured, featuredOrder: product.featuredOrder ?? null, qualityIssues: product.qualityIssues ?? [], autoSoldOut: product.autoSoldOut ?? false, available: product.autoSoldOut ? product.available : current.draft.available } }
          : current,
      );
      setInitial((value) => {
        if (!value) return value;
        const parsed = JSON.parse(value) as FormState;
        parsed.draft.stock = product.stock;
        parsed.draft.featured = product.featured;
        parsed.draft.featuredOrder = product.featuredOrder ?? null;
        parsed.draft.qualityIssues = product.qualityIssues ?? [];
        parsed.draft.autoSoldOut = product.autoSoldOut ?? false;
        if (product.autoSoldOut) parsed.draft.available = product.available;
        return JSON.stringify(parsed);
      });
    }
  }, [product?.stock, product?.featured, product?.qualityIssues, product?.autoSoldOut]);

  const dirty = Boolean(form) && JSON.stringify(form) !== initial;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !skipBlock.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const sectionName = useMemo(() => {
    const map = new Map(sections.data.map((s) => [s.id, s.name]));
    return (sectionId: string | null) => (sectionId ? (map.get(sectionId) ?? null) : null);
  }, [sections.data]);
  const optionNames = useMemo(() => new Map(options.data.map((o) => [o.id, o])), [options.data]);

  // ---------------------------------------------------------------- États
  if (!isNew && productState.missing) {
    return (
      <PageContainer>
        <EmptyState
          icon={<AlertTriangle />}
          title="Produit introuvable"
          description="Il a peut-être été supprimé : consultez la corbeille de la carte pour le restaurer."
          action={
            <Button asChild variant="secondary">
              <Link to="/produits">Retour à la carte</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }
  if (productState.error) {
    return (
      <PageContainer>
        <EmptyState icon={<AlertTriangle />} title="Impossible de charger le produit" description={errorMessage(productState.error)} />
      </PageContainer>
    );
  }
  if (!form) {
    return (
      <PageContainer>
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="mb-8 h-8 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </PageContainer>
    );
  }

  const draft = form.draft;
  const readOnly = !canEdit;
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setForm((current) => (current ? { ...current, draft: { ...current.draft, [key]: value } } : current));
  const setField = <K extends Exclude<keyof FormState, 'draft'>>(key: K, value: FormState[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));
  const photos: ImageRef[] = [...(draft.image ? [draft.image] : []), ...(draft.gallery ?? [])];
  const saleUnit: SaleUnit = draft.saleUnit ?? 'unit';
  const perKgCents = parseEuros(form.perKg);
  const portionGrams = Number(form.minGrams || form.stepGrams || 0);
  const priceCents =
    saleUnit === 'weight' ? (perKgCents !== null && portionGrams > 0 ? Math.round((perKgCents * portionGrams) / 1000) : null) : parseEuros(form.price);
  const alcoholTerm = findAlcoholTerm(draft.name, draft.description);
  const alcoholCleared = Boolean(alcoholTerm) && alcoholTerm === savedAlcoholTerm && alcoholIssue.data?.status === 'ignored';
  const liveIssues: MenuIssueType[] = productIssues({
    ...draft,
    priceCents: priceCents ?? 0,
    qualityIssues: alcoholTerm && !alcoholCleared ? [...(draft.qualityIssues ?? []), 'alcohol_suspected'] : (draft.qualityIssues ?? []).filter((i) => i !== 'alcohol_suspected'),
  });

  async function clearAlcohol() {
    setClearing(true);
    try {
      await updateDoc(docAt(alcoholIssuePath), { status: 'ignored', resolvedAt: serverTimestamp(), resolvedBy: uid });
      toast.success('Signalement levé : vous pouvez remettre le produit en vente');
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setClearing(false);
    }
  }
  const featuredCount = products.data.filter((p) => p.featured && p.id !== id).length;

  function validate(): Errors {
    const next: Errors = {};
    if (!draft.name.trim()) next.name = 'Donnez un nom au produit.';
    if (draft.vatCategory === 'alcohol') next.vat = 'La vente d’alcool est interdite sur GoLink : choisissez un autre type.';
    if (form!.vatOverride && !/^\d{1,2}([.,]\d{1,2})?$/.test(form!.vatOverride)) next.vatOverride = 'Taux invalide (ex. 5,5).';
    if (saleUnit === 'weight') {
      if (perKgCents === null || perKgCents <= 0) next.perKg = 'Indiquez le prix au kilo.';
      if (!/^\d{1,5}$/.test(form!.stepGrams) || Number(form!.stepGrams) <= 0) next.stepGrams = 'Pas en grammes.';
      if (form!.minGrams && !/^\d{1,5}$/.test(form!.minGrams)) next.minGrams = 'Nombre de grammes.';
      if (form!.maxGrams && (!/^\d{1,5}$/.test(form!.maxGrams) || Number(form!.maxGrams) < portionGrams)) next.maxGrams = 'Supérieur au minimum.';
    } else if (priceCents === null) next.price = 'Indiquez un prix valide, par exemple 12,50.';
    if (saleUnit === 'variable') {
      const max = parseEuros(form!.variableMax);
      if (max === null || (priceCents !== null && max < priceCents)) next.variableMax = 'Au moins égal au prix estimé.';
    }
    if (priceCents !== null && priceCents > MENU_LIMITS.maxPriceCents) next[saleUnit === 'weight' ? 'perKg' : 'price'] = 'Le prix ne peut pas dépasser 1 000 €.';
    if (saleUnit === 'unit' && form!.compareAt) {
      const compare = parseEuros(form!.compareAt);
      if (compare === null) next.compareAt = 'Prix barré invalide.';
      else if (priceCents !== null && compare <= priceCents) next.compareAt = 'Le prix barré doit être supérieur au prix de vente.';
    }
    if (form!.prep && !/^\d{1,3}$/.test(form!.prep)) next.prep = 'Nombre de minutes entier.';
    if (!/^\d{1,4}$/.test(form!.threshold)) next.threshold = 'Nombre entier.';
    if (isNew && form!.trackStock && !/^\d{1,5}$/.test(form!.initialStock)) next.initialStock = 'Indiquez la quantité disponible.';
    if (draft.schedule && (draft.schedule.days.length === 0 || draft.schedule.from >= draft.schedule.to)) next.schedule = 'Choisissez au moins un jour et une heure de fin postérieure au début.';
    return next;
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (readOnly || !form) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Vérifiez les champs signalés.');
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const payload: ProductDraft = {
      ...draft,
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      priceCents: priceCents!,
      compareAtPriceCents: saleUnit === 'unit' && form.compareAt ? parseEuros(form.compareAt) : null,
      preparationMinutes: form.prep ? Number(form.prep) : null,
      alcoholPercent: null,
      containsAlcohol: false,
      saleUnit,
      vatRateBpsOverride: form.vatOverride ? Math.round(Number(form.vatOverride.replace(',', '.')) * 100) : null,
      pricePerKgCents: saleUnit === 'weight' ? perKgCents : null,
      weightStepGrams: saleUnit === 'weight' ? Number(form.stepGrams) : null,
      minWeightGrams: saleUnit === 'weight' ? portionGrams : null,
      maxWeightGrams: saleUnit === 'weight' && form.maxGrams ? Number(form.maxGrams) : null,
      variablePriceMaxCents: saleUnit === 'variable' ? parseEuros(form.variableMax) : null,
      lowStockThreshold: Number(form.threshold),
      stock: isNew ? (form.trackStock ? Number(form.initialStock) : null) : draft.stock,
    };
    setSaving(true);
    try {
      if (isNew) {
        // Le stock initial passe par un mouvement historisé (« Stock initial »).
        await createProduct(restaurantId, uid, id, { ...payload, stock: null }, sectionName(payload.sectionId));
        if (payload.stock !== null) {
          await menuFunctions
            .adjustStock({ restaurantId, reason: 'reception', note: 'Stock initial', items: [{ productId: id, mode: 'set', quantity: payload.stock }] })
            .catch((caught: unknown) => toast.error(`Produit créé, mais le stock initial n’a pas été enregistré : ${errorMessage(caught)}`));
        }
        toast.success('Produit ajouté à la carte');
        skipBlock.current = true;
        navigate(`/produits/${id}`, { replace: true });
        setForm(null);
      } else {
        // Le stock passe uniquement par les ajustements (historisés) : il n'est pas réécrit ici.
        const { stock: _stock, salesCount: _sales, ...patch } = payload as ProductDraft & { salesCount?: number };
        await updateProduct(restaurantId, uid, id, patch, { name: payload.name, sectionName: sectionName(payload.sectionId), tags: payload.tags ?? [] });
        const next = toForm(payload);
        setForm(next);
        setInitial(JSON.stringify(next));
        toast.success('Produit enregistré');
      }
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function toggleTracking(track: boolean) {
    if (!product) return setField('trackStock', track);
    try {
      await menuFunctions.adjustStock({ restaurantId, reason: 'inventory', items: [{ productId: id, mode: track ? 'track' : 'untrack', quantity: 0 }] });
      toast.success(track ? 'Suivi du stock activé (0 en stock) : ajustez la quantité' : 'Le stock n’est plus suivi');
      if (track) setAdjusting(true);
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  }

  async function remove() {
    await menuFunctions.trashMenuItems({ restaurantId, kind: 'product', ids: [id] });
    toast.success('Produit placé dans la corbeille');
    skipBlock.current = true;
    navigate('/produits');
  }

  const state = product ? saleState(product) : null;
  const stock = product ? stockState(product) : null;
  const vatOptions = [
    ...SELECTABLE_VAT_CATEGORIES.map((v) => ({ value: v as string, label: VAT_CATEGORY_LABELS[v], disabled: false })),
    ...(draft.vatCategory === 'alcohol' ? [{ value: 'alcohol', label: `${VAT_CATEGORY_LABELS.alcohol} (interdit)`, disabled: true }] : []),
  ];
  const sectionOptions = [...sections.data.map((s) => ({ value: s.id, label: s.name })), { value: '__none', label: 'Sans section' }];
  const isFoodMerchant = FOOD_MERCHANT_TYPES.includes(restaurant.merchantType ?? 'restaurant');

  return (
    <PageContainer className="pb-28">
      <nav aria-label="Fil d’Ariane" className="mb-4 flex items-center gap-1 text-xs text-fg-subtle">
        <Link to="/produits" className="transition-colors hover:text-fg">
          Produits & menu
        </Link>
        <ChevronRight className="size-3" aria-hidden="true" />
        <span className="truncate text-fg-muted" aria-current="page">
          {isNew ? 'Nouveau produit' : (product?.name ?? '…')}
        </span>
      </nav>
      <PageHeader
        eyebrow={`${restaurant.name} · Fiche produit`}
        title={isNew ? 'Nouveau produit' : draft.name || 'Produit sans nom'}
        description={
          isNew ? 'Renseignez l’essentiel ; tout reste modifiable ensuite.' : (
            <span className="inline-flex flex-wrap items-center gap-2">
              {state && <Badge tone={state.tone}>{state.label}</Badge>}
              {draft.featured && (
                <Badge tone="brand" icon={<Star />}>
                  En vitrine
                </Badge>
              )}
              {product?.updatedAt && <span className="text-sm text-fg-subtle">Modifié {formatDateTime(toDate(product.updatedAt) ?? new Date())}</span>}
            </span>
          )
        }
        actions={
          !isNew && canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" rightIcon={<MoreHorizontal />}>
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  icon={<Copy />}
                  onSelect={() =>
                    product &&
                    void duplicateProduct(restaurantId, uid, product, sectionName(product.sectionId))
                      .then((copyId) => {
                        toast.success('Copie créée, indisponible le temps de la relire');
                        navigate(`/produits/${copyId}`);
                        setForm(null);
                      })
                      .catch((caught: unknown) => toast.error(errorMessage(caught)))
                  }
                >
                  Dupliquer
                </DropdownMenuItem>
                <DropdownMenuItem icon={<History />} onSelect={() => setHistory(true)}>
                  Historique du stock
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setConfirmDelete(true)}>
                  Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
      />

      {readOnly && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          Consultation seule : votre rôle ne permet pas de modifier la carte{canStock ? ', mais vous pouvez ajuster le stock.' : '.'}
        </div>
      )}

      <form id="product-form" onSubmit={(event) => void submit(event)} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <fieldset disabled={readOnly || saving} className="min-w-0 space-y-6">
          <Panel id="infos" title="Informations" description="Ce que le client lit sur la carte.">
            <div className="space-y-4">
              <FormField label="Nom du produit" required error={errors.name} aside={<span className="num text-2xs text-fg-subtle">{draft.name.length}/{MENU_LIMITS.productName}</span>}>
                <Input value={draft.name} maxLength={MENU_LIMITS.productName} onChange={(e) => set('name', e.target.value)} placeholder="Ex. Assiette poulet za’atar" autoFocus={isNew} />
              </FormField>
              <FormField
                label="Description"
                hint="Ingrédients, garniture, portion : une description précise rassure et limite les réclamations."
                aside={<span className="num text-2xs text-fg-subtle">{(draft.description ?? '').length}/{MENU_LIMITS.productDescription}</span>}
              >
                <Textarea rows={4} value={draft.description ?? ''} maxLength={MENU_LIMITS.productDescription} onChange={(e) => set('description', e.target.value)} placeholder="Poulet rôti aux épices, labneh fouetté, herbes fraîches et pain plat chaud…" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Section">
                  <Select value={draft.sectionId ?? '__none'} onValueChange={(v) => set('sectionId', v === '__none' ? null : v)} options={sectionOptions} disabled={readOnly} />
                </FormField>
                <FormField label="Type de produit" error={errors.vat} hint="Détermine le taux de TVA appliqué.">
                  <Select value={draft.vatCategory} onValueChange={(v) => set('vatCategory', v as ProductDraft['vatCategory'])} options={vatOptions} disabled={readOnly} invalid={Boolean(errors.vat)} />
                </FormField>
              </div>
              <FormField
                label="Taux de TVA spécifique"
                error={errors.vatOverride}
                hint="Facultatif : pour un article dont le taux diffère de sa catégorie (fleurs, parapharmacie…). Laissez vide sinon."
                className="sm:max-w-sm"
              >
                <Input inputMode="decimal" value={form.vatOverride} onChange={(e) => setField('vatOverride', e.target.value)} placeholder="Taux de la catégorie" trailing="%" />
              </FormField>
              {((alcoholTerm && !alcoholCleared) || draft.vatCategory === 'alcohol') && (
                <div role="alert" className="tone-danger flex items-start gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-3 text-sm text-(--tone-fg)">
                  <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>
                    <span className="font-semibold">La vente d’alcool est interdite sur GoLink.</span>{' '}
                    {draft.vatCategory === 'alcohol'
                      ? 'Ce produit est classé « boisson alcoolisée » : changez son type pour pouvoir le vendre.'
                      : `Le terme « ${alcoholTerm} » a été repéré : le produit reste hors vente. S’il s’agit d’une boisson alcoolisée, retirez-le ; sinon, reformulez ou confirmez qu’il ne contient pas d’alcool servi.`}
                    {canEdit && draft.vatCategory !== 'alcohol' && alcoholTerm === savedAlcoholTerm && alcoholIssue.data?.status === 'open' && (
                      <Button type="button" size="sm" variant="secondary" className="mt-2 flex" loading={clearing} onClick={() => void clearAlcohol()}>
                        Ce n’est pas une boisson alcoolisée
                      </Button>
                    )}
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel id="photos" title="Photos" description="Jusqu’à 6 photos ; la première illustre le produit sur la carte.">
            <PhotoManager
              photos={photos}
              onChange={(next) => setForm((current) => (current ? { ...current, draft: { ...current.draft, image: next[0] ?? null, gallery: next.slice(1) } } : current))}
              restaurantId={restaurantId}
              folder={`products/${id}`}
              alt={draft.name || 'Produit'}
              disabled={readOnly}
            />
          </Panel>

          <Panel id="prix" title="Prix et mode de vente" description="Prix TTC payé par le client, en euros.">
            <div className="space-y-4">
              <div role="radiogroup" aria-label="Mode de vente" className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { value: 'unit', title: 'À l’unité', text: 'Prix fixe par article' },
                    { value: 'weight', title: 'Au poids', text: 'Prix au kilo, quantité choisie' },
                    { value: 'variable', title: 'Prix variable', text: 'Ajusté à la préparation' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={saleUnit === option.value}
                    onClick={() => set('saleUnit', option.value)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
                      saleUnit === option.value ? 'border-primary bg-primary-soft/60' : 'border-border bg-surface hover:border-border-strong',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                      {option.value === 'weight' && <Scale className="size-3.5" aria-hidden="true" />}
                      {option.title}
                    </span>
                    <span className="block text-xs text-fg-subtle">{option.text}</span>
                  </button>
                ))}
              </div>

              {saleUnit === 'weight' ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <FormField label="Prix au kilo" required error={errors.perKg}>
                    <Input inputMode="decimal" value={form.perKg} onChange={(e) => setField('perKg', e.target.value)} placeholder="0,00" trailing="€/kg" />
                  </FormField>
                  <FormField label="Pas" required error={errors.stepGrams} hint="Incrément de commande.">
                    <Input inputMode="numeric" value={form.stepGrams} onChange={(e) => setField('stepGrams', e.target.value.replace(/[^\d]/g, '').slice(0, 5))} trailing="g" />
                  </FormField>
                  <FormField label="Minimum" error={errors.minGrams} hint="Portion affichée.">
                    <Input inputMode="numeric" value={form.minGrams} onChange={(e) => setField('minGrams', e.target.value.replace(/[^\d]/g, '').slice(0, 5))} placeholder={form.stepGrams} trailing="g" />
                  </FormField>
                  <FormField label="Maximum" error={errors.maxGrams} hint="Facultatif.">
                    <Input inputMode="numeric" value={form.maxGrams} onChange={(e) => setField('maxGrams', e.target.value.replace(/[^\d]/g, '').slice(0, 5))} placeholder="—" trailing="g" />
                  </FormField>
                  <p className="col-span-2 text-sm text-fg-muted sm:col-span-4">
                    Prix affiché sur la carte : <span className="num font-mono font-medium text-fg">{priceCents !== null ? formatEUR(priceCents, { cents: true }) : '—'}</span> les{' '}
                    {portionGrams || '…'} g, puis par pas de {form.stepGrams || '…'} g.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label={saleUnit === 'variable' ? 'Prix estimé' : 'Prix de vente'} required error={errors.price}>
                    <Input inputMode="decimal" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0,00" trailing="€" />
                  </FormField>
                  {saleUnit === 'variable' ? (
                    <FormField label="Montant maximal" required error={errors.variableMax} hint="Pré-autorisé à la commande.">
                      <Input inputMode="decimal" value={form.variableMax} onChange={(e) => setField('variableMax', e.target.value)} placeholder="0,00" trailing="€" />
                    </FormField>
                  ) : (
                    <FormField label="Prix barré" error={errors.compareAt} hint="Facultatif, promotion permanente.">
                      <Input inputMode="decimal" value={form.compareAt} onChange={(e) => setField('compareAt', e.target.value)} placeholder="—" trailing="€" />
                    </FormField>
                  )}
                  <FormField label="Préparation" error={errors.prep} hint="Temps propre au produit.">
                    <Input
                      inputMode="numeric"
                      value={form.prep}
                      onChange={(e) => setField('prep', e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
                      placeholder={String(restaurant.prepMinutes ?? 15)}
                      trailing="min"
                    />
                  </FormField>
                </div>
              )}
            </div>
          </Panel>

          {isFoodMerchant && (
          <Panel
            id="allergenes"
            title="Allergènes et régimes"
            description="Les 14 allergènes réglementaires (règlement UE 1169/2011) : information obligatoire pour vos clients."
            actions={draft.allergensDeclared ? <Badge tone="success" icon={<CheckCircle2 />}>Déclarés</Badge> : <Badge tone="amber">À déclarer</Badge>}
          >
            <div className="space-y-4">
              <AllergenPicker
                value={draft.allergens}
                disabled={readOnly}
                onChange={(value) => setForm((current) => (current ? { ...current, draft: { ...current.draft, allergens: value, allergensDeclared: true } } : current))}
              />
              <Checkbox
                checked={draft.allergensDeclared}
                onCheckedChange={(value) => set('allergensDeclared', value === true)}
                label={draft.allergens.length ? 'J’ai vérifié la liste des allergènes de ce produit' : 'Ce produit ne contient aucun des 14 allergènes'}
                description="Confirmation requise pour que la fiche soit considérée comme complète."
              />
              <div className="h-px bg-border" />
              <div>
                <p className="mb-2 text-sm font-medium text-fg">Régimes et mentions</p>
                <ToggleChips<MenuDietaryTag>
                  label="Régimes"
                  options={MENU_DIETARY_TAGS.map((tag) => ({ value: tag, label: MENU_DIETARY_LABELS[tag] }))}
                  value={draft.dietary as MenuDietaryTag[]}
                  onChange={(value) => set('dietary', value)}
                  disabled={readOnly}
                />
              </div>
            </div>
          </Panel>
          )}

          <Panel
            id="options"
            title="Listes d’options"
            description="Suppléments et choix proposés avec ce produit (sauces, cuisson, accompagnements…)."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/options">Gérer les listes</Link>
              </Button>
            }
          >
            {groups.loading ? (
              <Skeleton className="h-24 rounded-lg" />
            ) : groups.data.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-sm text-fg-muted">
                Aucune liste d’options pour l’instant. Créez-les dans « Options & listes ».
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {groups.data.map((group) => {
                  const checked = draft.optionGroupIds.includes(group.id);
                  const names = group.optionIds.map((o) => optionNames.get(o)?.name).filter(Boolean);
                  return (
                    <li key={group.id} className={cn('flex items-start gap-3 px-3 py-2.5', checked && 'bg-primary-soft/40')}>
                      <Checkbox
                        className="mt-0.5"
                        aria-label={`Proposer la liste ${group.name}`}
                        checked={checked}
                        onCheckedChange={(value) => set('optionGroupIds', value === true ? [...draft.optionGroupIds, group.id] : draft.optionGroupIds.filter((g) => g !== group.id))}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                          {group.name}
                          {group.min > 0 ? <Badge tone="brand" size="sm">Obligatoire</Badge> : <Badge size="sm">Facultatif</Badge>}
                          {!group.enabled && <Badge tone="neutral" size="sm">Désactivée</Badge>}
                        </p>
                        <p className="truncate text-xs text-fg-subtle">
                          {group.multiple ? `De ${group.min} à ${group.max} choix` : '1 choix'} · {names.join(', ') || 'aucune option'}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel id="disponibilite" title="Disponibilité" description="Quand le produit peut être commandé.">
            <ScheduleEditor value={draft.schedule ?? null} onChange={(value) => set('schedule', value)} disabled={readOnly} />
            {errors.schedule && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {errors.schedule}
              </p>
            )}
          </Panel>
        </fieldset>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Panel title="Mise en vente">
            <fieldset disabled={readOnly || saving} className="space-y-4">
              <Switch
                label="Disponible à la vente"
                description={draft.stock === 0 ? 'En rupture : il reviendra en vente au réassort.' : 'Désactivez pour le masquer aux clients.'}
                checked={draft.available && draft.stock !== 0}
                disabled={draft.stock === 0}
                onCheckedChange={(value) => set('available', value)}
              />
              <div className="h-px bg-border" />
              <Switch
                label="En vitrine"
                description={`Mis en avant dans l’app client (${featuredCount + (draft.featured ? 1 : 0)}/${MENU_LIMITS.featured}).`}
                checked={draft.featured}
                disabled={!draft.featured && featuredCount >= MENU_LIMITS.featured}
                onCheckedChange={(value) => setForm((current) => (current ? { ...current, draft: { ...current.draft, featured: value, featuredOrder: value ? (current.draft.featuredOrder ?? featuredCount) : null } } : current))}
              />
              <div className="h-px bg-border" />
              <FormField label="Badge">
                <Select
                  value={draft.badge ?? '__none'}
                  onValueChange={(v) => set('badge', v === '__none' ? null : (v as ProductDraft['badge']))}
                  options={[{ value: '__none', label: 'Aucun badge' }, ...PRODUCT_BADGES.map((b) => ({ value: b, label: PRODUCT_BADGE_LABELS[b] }))]}
                  disabled={readOnly}
                />
              </FormField>
              <FormField label="Étiquettes" hint="Internes : recherche, filtres, rapports.">
                <TagInput value={draft.tags ?? []} onChange={(value) => set('tags', value)} disabled={readOnly} />
              </FormField>
            </fieldset>
          </Panel>

          <Panel
            title="Stock"
            actions={
              !isNew && draft.stock !== null && canStock ? (
                <IconButton label="Historique des mouvements" variant="ghost" size="sm" onClick={() => setHistory(true)}>
                  <History />
                </IconButton>
              ) : undefined
            }
          >
            <div className="space-y-4">
              {isNew ? (
                <fieldset disabled={readOnly || saving} className="space-y-4">
                  <Switch label="Suivre le stock" description="Le produit passe en rupture automatiquement à 0." checked={form.trackStock} onCheckedChange={(value) => setField('trackStock', value)} />
                  {form.trackStock && (
                    <FormField label="Quantité disponible" required error={errors.initialStock}>
                      <Input inputMode="numeric" value={form.initialStock} onChange={(e) => setField('initialStock', e.target.value.replace(/[^\d]/g, '').slice(0, 5))} placeholder="20" />
                    </FormField>
                  )}
                </fieldset>
              ) : draft.stock === null ? (
                <div className="space-y-3">
                  <p className="text-sm text-fg-muted">Stock non suivi : le produit reste disponible tant que vous ne le masquez pas.</p>
                  {canStock && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => void toggleTracking(true)}>
                      Activer le suivi du stock
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="num font-display text-3xl font-semibold tracking-display text-fg">{formatNumber(draft.stock)}</p>
                      {stock && <Badge tone={STOCK_STATE_META[stock].tone}>{STOCK_STATE_META[stock].label}</Badge>}
                    </div>
                    {canStock && (
                      <Button type="button" variant="secondary" size="sm" leftIcon={<PackagePlus />} onClick={() => setAdjusting(true)}>
                        Ajuster
                      </Button>
                    )}
                  </div>
                  {canStock && (
                    <button type="button" className="text-xs text-fg-subtle underline-offset-4 hover:text-fg hover:underline" onClick={() => void toggleTracking(false)}>
                      Ne plus suivre le stock
                    </button>
                  )}
                </div>
              )}
              <fieldset disabled={readOnly || saving}>
                <FormField label="Seuil d’alerte" error={errors.threshold} hint="Signalé « stock faible » à partir de ce nombre.">
                  <Input inputMode="numeric" value={form.threshold} onChange={(e) => setField('threshold', e.target.value.replace(/[^\d]/g, '').slice(0, 4))} />
                </FormField>
              </fieldset>
            </div>
          </Panel>

          <Panel title="Qualité de la fiche">
            <ul className="space-y-2 text-sm">
              {(['missing_photo', 'missing_description', 'allergens_missing', 'price_outlier', 'alcohol_suspected'] as MenuIssueType[])
                .filter((issue) => isFoodMerchant || issue !== 'allergens_missing')
                .map((issue) => {
                const ok = !liveIssues.includes(issue);
                const labels: Record<string, string> = {
                  missing_photo: 'Au moins une photo',
                  missing_description: `Description de ${MENU_LIMITS.minDescription} caractères ou plus`,
                  allergens_missing: 'Allergènes déclarés',
                  price_outlier: 'Prix cohérent avec la section',
                  alcohol_suspected: 'Aucune mention d’alcool',
                };
                return (
                  <li key={issue} className="flex items-center gap-2">
                    {ok ? <CheckCircle2 className="tone-success size-4 text-(--tone-solid)" aria-hidden="true" /> : <Circle className="size-4 text-fg-subtle" aria-hidden="true" />}
                    <span className={ok ? 'text-fg' : 'text-fg-muted'}>{labels[issue]}</span>
                    <span className="sr-only">{ok ? ' : fait' : ` : à faire (${MENU_ISSUE_LABELS[issue]})`}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Aperçu dans l’app">
            <div className="flex gap-3 rounded-xl border border-border bg-surface-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{draft.name || 'Nom du produit'}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{draft.description || 'Description du produit'}</p>
                <p className="mt-1.5 flex items-center gap-2">
                  <span className="num font-mono text-sm font-medium text-fg">{priceCents !== null ? formatEUR(priceCents, { cents: true }) : '—'}</span>
                  {form.compareAt && parseEuros(form.compareAt) ? <span className="num font-mono text-xs text-fg-subtle line-through">{formatEUR(parseEuros(form.compareAt)!, { cents: true })}</span> : null}
                  {draft.badge && <Badge tone="brand" size="sm">{PRODUCT_BADGE_LABELS[draft.badge]}</Badge>}
                </p>
              </div>
              <Thumb image={draft.image} alt={draft.name || 'Produit'} size="lg" />
            </div>
          </Panel>

          {!isNew && product && (
            <Panel title="Informations">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-fg-muted">Ventes</dt>
                <dd className="num text-right font-mono text-fg">{formatNumber(product.salesCount ?? 0)}</dd>
                <dt className="text-fg-muted">Créé le</dt>
                <dd className="text-right text-fg">{toDate(product.createdAt) ? formatDateTime(toDate(product.createdAt)!) : '—'}</dd>
              </dl>
              <fieldset disabled={readOnly || saving} className="mt-4">
                <FormField label="Référence externe" hint="Identifiant dans votre logiciel de caisse.">
                  <Input value={draft.externalId ?? ''} maxLength={64} onChange={(e) => set('externalId', e.target.value || null)} placeholder="Ex. POS-1042" />
                </FormField>
              </fieldset>
            </Panel>
          )}
        </aside>
      </form>

      {/* Barre d'enregistrement */}
      {canEdit && (isNew || dirty) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-elevated/95 backdrop-blur supports-[backdrop-filter]:bg-elevated/80">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <p className="hidden text-sm text-fg-muted sm:block">{isNew ? 'Nouveau produit, pas encore enregistré.' : 'Modifications non enregistrées.'}</p>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="ghost"
                onClick={() => {
                  if (isNew) {
                    skipBlock.current = true;
                    navigate('/produits');
                  } else {
                    setForm(JSON.parse(initial) as FormState);
                    setErrors({});
                  }
                }}
                disabled={saving}
              >
                {isNew ? 'Annuler' : 'Annuler les modifications'}
              </Button>
              <Button type="submit" form="product-form" variant="primary" leftIcon={<Save />} loading={saving}>
                {isNew ? 'Ajouter à la carte' : 'Enregistrer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
        title="Quitter sans enregistrer ?"
        description="Vos modifications de cette fiche seront perdues."
        confirmLabel="Quitter la page"
        cancelLabel="Rester"
        destructive
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title={`Supprimer « ${draft.name} » ?`}
        description={`Retiré immédiatement de la carte, il reste restaurable depuis la corbeille pendant ${MENU_LIMITS.trashDays} jours.`}
        confirmLabel="Supprimer"
        onConfirm={async () => {
          try {
            await remove();
          } catch (caught) {
            toast.error(errorMessage(caught));
          }
        }}
      />
      <AdjustStockDialog product={adjusting && product ? product : null} restaurantId={restaurantId} onOpenChange={(open) => !open && setAdjusting(false)} />
      <StockHistorySheet open={history} onOpenChange={setHistory} restaurantId={restaurantId} product={product} />
    </PageContainer>
  );
}
