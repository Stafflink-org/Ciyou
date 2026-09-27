// Accès aux données de la carte : lectures temps réel, écritures directes autorisées
// par les règles (menu.edit) et Cloud Functions du domaine « carte ».
import { collection, doc, limit, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import {
  COLLECTIONS,
  DEFAULT_LOW_STOCK_THRESHOLD,
  buildSearchKeywords,
  paths,
  type ManualStockReason,
  type MenuImportReport,
  type MenuImportRow,
  type MenuIssue,
  type MenuOption,
  type MenuSection,
  type OptionGroup,
  type Product,
  type StockMovement,
  type TrashItem,
  type WithId,
} from '@golink/shared';
import { db } from '@/lib/firebase';
import { callFunction, collectionAt, createdFields, updatedFields, useCollection } from '@/lib/firestore';

export type Section = WithId<MenuSection>;
export type MenuProduct = WithId<Product>;
export type Option = WithId<MenuOption>;
export type Group = WithId<OptionGroup>;
export type Movement = WithId<StockMovement>;
export type MenuTrashItem = WithId<TrashItem>;

// ------------------------------------------------------------------ Lectures

export function useSections(restaurantId: string) {
  return useCollection<MenuSection>(query(collectionAt(paths.restaurantSub(restaurantId, 'sections')), orderBy('order'), limit(300)));
}

export function useProducts(restaurantId: string) {
  return useCollection<Product>(query(collectionAt(paths.restaurantSub(restaurantId, 'products')), orderBy('order'), limit(1000)));
}

export function useOptions(restaurantId: string) {
  return useCollection<MenuOption>(query(collectionAt(paths.restaurantSub(restaurantId, 'options')), orderBy('name'), limit(500)));
}

export function useOptionGroups(restaurantId: string) {
  return useCollection<OptionGroup>(query(collectionAt(paths.restaurantSub(restaurantId, 'optionGroups')), orderBy('name'), limit(300)));
}

/** Derniers mouvements de stock, éventuellement d'un seul produit. */
export function useStockMovements(restaurantId: string, productId: string | null, max = 60) {
  const base = collectionAt(paths.restaurantSub(restaurantId, 'stockMovements'));
  return useCollection<StockMovement>(
    productId
      ? query(base, where('productId', '==', productId), orderBy('createdAt', 'desc'), limit(max))
      : query(base, orderBy('createdAt', 'desc'), limit(max)),
  );
}

/** Éléments de carte supprimés, restaurables. */
export function useMenuTrash(restaurantId: string, enabled: boolean) {
  return useCollection<TrashItem>(
    enabled ? query(collectionAt(COLLECTIONS.trash), where('restaurantId', '==', restaurantId), orderBy('deletedAt', 'desc'), limit(100)) : null,
  );
}

export function useMenuIssues(restaurantId: string, enabled: boolean) {
  return useCollection<MenuIssue>(
    enabled
      ? query(collectionAt(COLLECTIONS.menuIssues), where('restaurantId', '==', restaurantId), where('status', '==', 'open'), orderBy('detectedAt', 'desc'), limit(200))
      : null,
  );
}

// ------------------------------------------------------------------ Cloud Functions

export type StockMode = 'add' | 'remove' | 'set' | 'track' | 'untrack';

export interface AdjustStockInput {
  restaurantId: string;
  reason: ManualStockReason;
  note?: string;
  items: Array<{ productId: string; mode: StockMode; quantity?: number; lowStockThreshold?: number }>;
}
export interface AdjustStockOutput {
  results: Array<{ productId: string; stock: number | null; delta: number }>;
  movements: number;
}

export type ReorderInput =
  | { kind: 'sections'; restaurantId: string; ids: string[] }
  | { kind: 'products'; restaurantId: string; sectionId: string | null; ids: string[] }
  | { kind: 'featured'; restaurantId: string; ids: string[] };

export type MenuKind = 'section' | 'product' | 'option' | 'optionGroup';

export const menuFunctions = {
  adjustStock: callFunction<AdjustStockInput, AdjustStockOutput>('adjustStock'),
  duplicateSection: callFunction<{ restaurantId: string; sectionId: string; withProducts: boolean }, { sectionId: string; name: string; products: number }>(
    'duplicateSection',
  ),
  reorderMenu: callFunction<ReorderInput, { updated: number }>('reorderMenu'),
  importMenu: callFunction<{ restaurantId: string; rows: MenuImportRow[]; dryRun: boolean }, MenuImportReport>('importMenu'),
  trashMenuItems: callFunction<
    { restaurantId: string; kind: MenuKind; ids: string[]; withProducts?: boolean; reason?: string },
    { trashed: number }
  >('trashMenuItems'),
  restoreMenuItem: callFunction<{ trashId: string }, { path: string; name: string }>('restoreMenuItem'),
};

// ------------------------------------------------------------------ Écritures directes

function sub(restaurantId: string, name: 'sections' | 'products' | 'options' | 'optionGroups') {
  return collection(db, paths.restaurantSub(restaurantId, name));
}

/** Identifiant de document généré à l'avance (utile pour ranger les photos avant l'enregistrement). */
export function newProductId(restaurantId: string): string {
  return doc(sub(restaurantId, 'products')).id;
}

export type SectionInput = Pick<MenuSection, 'name' | 'description' | 'image' | 'enabled' | 'hideProductNames' | 'availability'>;

export async function createSection(restaurantId: string, uid: string, input: SectionInput, order: number): Promise<string> {
  const ref = doc(sub(restaurantId, 'sections'));
  const batch = writeBatch(db);
  batch.set(ref, { ...input, order, ...createdFields(uid) });
  await batch.commit();
  return ref.id;
}

export async function updateSection(restaurantId: string, uid: string, id: string, input: Partial<SectionInput>): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(sub(restaurantId, 'sections'), id), { ...input, ...updatedFields(uid) });
  await batch.commit();
}

/** Mise à jour groupée de produits (disponibilité, section, vitrine…), par lots de 400. */
export async function updateProducts(restaurantId: string, uid: string, ids: string[], patch: Partial<Product>): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.update(doc(sub(restaurantId, 'products'), id), { ...patch, ...updatedFields(uid) }));
    await batch.commit();
  }
}

/**
 * Rattache des produits à une section, placés à la suite à partir de `startOrder`
 * (mots-clés recalculés avec le nom de la section).
 */
export async function moveProducts(restaurantId: string, uid: string, products: MenuProduct[], section: Section | null, startOrder: number): Promise<void> {
  for (let i = 0; i < products.length; i += 400) {
    const batch = writeBatch(db);
    products.slice(i, i + 400).forEach((product, index) =>
      batch.update(doc(sub(restaurantId, 'products'), product.id), {
        sectionId: section?.id ?? null,
        order: startOrder + i + index,
        searchKeywords: buildSearchKeywords(product.name, section?.name, ...(product.tags ?? [])),
        ...updatedFields(uid),
      }),
    );
    await batch.commit();
  }
}

export type ProductDraft = Omit<Product, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'salesCount' | 'searchKeywords'>;

export function emptyProduct(sectionId: string | null, order: number): ProductDraft {
  return {
    sectionId,
    name: '',
    description: '',
    priceCents: 0,
    compareAtPriceCents: null,
    vatCategory: 'food',
    image: null,
    gallery: [],
    available: true,
    stock: null,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    preparationMinutes: null,
    optionGroupIds: [],
    allergens: [],
    allergensDeclared: false,
    dietary: [],
    containsAlcohol: false,
    alcoholPercent: null,
    nutrition: null,
    featured: false,
    featuredOrder: null,
    order,
    externalId: null,
    badge: null,
    tags: [],
    schedule: null,
    autoSoldOut: false,
    qualityIssues: [],
  };
}

export async function createProduct(restaurantId: string, uid: string, id: string, draft: ProductDraft, sectionName: string | null): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(sub(restaurantId, 'products'), id), {
    ...draft,
    salesCount: 0,
    searchKeywords: buildSearchKeywords(draft.name, sectionName, ...(draft.tags ?? [])),
    ...createdFields(uid),
  });
  await batch.commit();
}

export async function updateProduct(
  restaurantId: string,
  uid: string,
  id: string,
  patch: Partial<ProductDraft>,
  keywords?: { name: string; sectionName: string | null; tags: string[] },
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(sub(restaurantId, 'products'), id), {
    ...patch,
    ...(keywords ? { searchKeywords: buildSearchKeywords(keywords.name, keywords.sectionName, ...keywords.tags) } : {}),
    ...updatedFields(uid),
  });
  await batch.commit();
}

/** Copie d'un produit, ajoutée juste après l'original et indisponible par défaut. */
export async function duplicateProduct(restaurantId: string, uid: string, product: MenuProduct, sectionName: string | null): Promise<string> {
  const { id: _id, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, salesCount: _s, ...rest } = product;
  const ref = doc(sub(restaurantId, 'products'));
  const name = `${product.name.slice(0, 91)} (copie)`;
  const batch = writeBatch(db);
  batch.set(ref, {
    ...rest,
    name,
    available: false,
    featured: false,
    featuredOrder: null,
    externalId: null,
    autoSoldOut: false,
    order: product.order + 0.5,
    salesCount: 0,
    searchKeywords: buildSearchKeywords(name, sectionName, ...(product.tags ?? [])),
    ...createdFields(uid),
  });
  await batch.commit();
  return ref.id;
}

export type OptionInput = Pick<MenuOption, 'name' | 'priceCents' | 'enabled' | 'allergens'>;

export async function saveOption(restaurantId: string, uid: string, id: string | null, input: OptionInput): Promise<string> {
  const ref = id ? doc(sub(restaurantId, 'options'), id) : doc(sub(restaurantId, 'options'));
  const batch = writeBatch(db);
  if (id) batch.update(ref, { ...input, ...updatedFields(uid) });
  else batch.set(ref, { ...input, linkedProductId: null, externalId: null, ...createdFields(uid) });
  await batch.commit();
  return ref.id;
}

export async function setOptionsEnabled(restaurantId: string, uid: string, ids: string[], enabled: boolean): Promise<void> {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(sub(restaurantId, 'options'), id), { enabled, ...updatedFields(uid) }));
  await batch.commit();
}

export type GroupInput = Pick<OptionGroup, 'name' | 'description' | 'optionIds' | 'enabled' | 'multiple' | 'min' | 'max' | 'allowQuantity'>;

/**
 * Enregistre une liste d'options et, si `productIds` est fourni, synchronise les
 * produits qui la proposent (ajout ou retrait de l'identifiant de liste).
 */
export async function saveGroup(
  restaurantId: string,
  uid: string,
  id: string | null,
  input: GroupInput,
  products?: { all: MenuProduct[]; selected: string[] },
): Promise<string> {
  const ref = id ? doc(sub(restaurantId, 'optionGroups'), id) : doc(sub(restaurantId, 'optionGroups'));
  const batch = writeBatch(db);
  if (id) batch.update(ref, { ...input, ...updatedFields(uid) });
  else batch.set(ref, { ...input, ...createdFields(uid) });
  if (products) {
    const selected = new Set(products.selected);
    for (const product of products.all) {
      const has = product.optionGroupIds.includes(ref.id);
      if (selected.has(product.id) && !has) {
        batch.update(doc(sub(restaurantId, 'products'), product.id), { optionGroupIds: [...product.optionGroupIds, ref.id], ...updatedFields(uid) });
      } else if (!selected.has(product.id) && has) {
        batch.update(doc(sub(restaurantId, 'products'), product.id), {
          optionGroupIds: product.optionGroupIds.filter((groupId) => groupId !== ref.id),
          ...updatedFields(uid),
        });
      }
    }
  }
  await batch.commit();
  return ref.id;
}

export async function setGroupEnabled(restaurantId: string, uid: string, id: string, enabled: boolean): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(sub(restaurantId, 'optionGroups'), id), { enabled, ...updatedFields(uid) });
  await batch.commit();
}

/** Anomalie de qualité écartée par le restaurant (ex. prix volontairement élevé). */
export async function ignoreMenuIssue(issueId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.menuIssues, issueId), { status: 'ignored', resolvedAt: serverTimestamp(), resolvedBy: uid });
}
