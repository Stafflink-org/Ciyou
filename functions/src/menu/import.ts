// Import de la carte depuis un fichier CSV (lu et converti par le back-office) :
// sections créées à la volée, produits rapprochés par référence externe puis par nom
// dans la section, création ou mise à jour. `dryRun` renvoie le rapport sans rien écrire.
import {
  ALLERGENS,
  MENU_DIETARY_TAGS,
  MENU_LIMITS,
  PRODUCT_BADGES,
  VAT_CATEGORIES,
  isVatCategorySelectable,
  buildSearchKeywords,
  findAlcoholTerm,
  type MenuImportReport,
  type Product,
} from '@golink/shared';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { callable } from '../lib/callable';
import { planLimitOf } from '../finance/argent/entitlements';
import { z, zId } from '../lib/validation';
import { auditMenu, chunk, menuCollection, nameKey, requireMenuAccess, trackedCreate, trackedUpdate, MENU_RUNTIME } from './common';

const row = z.object({
  section: z.string().trim().min(1, 'Section manquante').max(MENU_LIMITS.sectionName),
  name: z.string().trim().min(1, 'Nom manquant').max(MENU_LIMITS.productName),
  description: z.string().trim().max(MENU_LIMITS.productDescription).nullish(),
  priceCents: z.number().int().min(0).max(MENU_LIMITS.maxPriceCents),
  compareAtPriceCents: z.number().int().min(0).max(MENU_LIMITS.maxPriceCents).nullish(),
  vatCategory: z
    .enum(VAT_CATEGORIES)
    .refine((category) => isVatCategorySelectable(category), 'La vente d’alcool est interdite sur Ciyou Eats')
    .nullish(),
  available: z.boolean().nullish(),
  stock: z.number().int().min(0).max(99_999).nullish(),
  lowStockThreshold: z.number().int().min(0).max(9_999).nullish(),
  preparationMinutes: z.number().int().min(0).max(240).nullish(),
  allergens: z.array(z.enum(ALLERGENS)).nullish(),
  dietary: z.array(z.enum(MENU_DIETARY_TAGS)).nullish(),
  badge: z.enum(PRODUCT_BADGES).nullish(),
  tags: z.array(z.string().trim().min(1).max(MENU_LIMITS.tagLength)).max(MENU_LIMITS.tags).nullish(),
  externalId: z.string().trim().max(64).nullish(),
});

const schema = z.object({
  restaurantId: zId,
  // Chaque ligne est validée individuellement pour produire un rapport ligne par ligne.
  rows: z.array(z.unknown()).min(1).max(MENU_LIMITS.importRows),
  dryRun: z.boolean().default(false),
});

type Row = z.output<typeof row>;

/** Champs modifiés par l'import ; un champ absent du fichier reste inchangé. */
function fieldsFromRow(input: Row): Partial<Product> {
  const fields: Partial<Product> = { name: input.name, priceCents: input.priceCents };
  if (input.description !== undefined) fields.description = input.description || null;
  if (input.compareAtPriceCents !== undefined) fields.compareAtPriceCents = input.compareAtPriceCents ?? null;
  if (input.vatCategory) fields.vatCategory = input.vatCategory;
  if (input.available !== undefined && input.available !== null) fields.available = input.available;
  if (input.stock !== undefined) fields.stock = input.stock ?? null;
  if (input.lowStockThreshold !== undefined && input.lowStockThreshold !== null) fields.lowStockThreshold = input.lowStockThreshold;
  if (input.preparationMinutes !== undefined) fields.preparationMinutes = input.preparationMinutes ?? null;
  if (input.allergens) {
    fields.allergens = input.allergens;
    fields.allergensDeclared = true;
  }
  if (input.dietary) fields.dietary = input.dietary;
  if (input.badge !== undefined) fields.badge = input.badge ?? null;
  if (input.tags) fields.tags = input.tags;
  if (input.externalId !== undefined) fields.externalId = input.externalId || null;
  return fields;
}

function differs(product: Product, fields: Partial<Product>): boolean {
  return Object.entries(fields).some(([key, value]) => JSON.stringify(product[key as keyof Product] ?? null) !== JSON.stringify(value ?? null));
}

export const importMenu = callable(
  schema,
  async (data, request): Promise<MenuImportReport> => {
    const context = await requireMenuAccess(request, data.restaurantId, 'menu.edit');
    const uid = context.actor.caller.uid;
    const sectionsCol = menuCollection(data.restaurantId, 'sections');
    const productsCol = menuCollection(data.restaurantId, 'products');
    const [sectionSnap, productSnap] = await Promise.all([sectionsCol.get(), productsCol.get()]);

    const sectionByName = new Map<string, { id: string; name: string }>();
    let nextSectionOrder = 0;
    sectionSnap.docs.forEach((doc) => {
      sectionByName.set(nameKey(String(doc.get('name') ?? '')), { id: doc.id, name: String(doc.get('name') ?? '') });
      nextSectionOrder = Math.max(nextSectionOrder, Number(doc.get('order') ?? 0) + 1);
    });
    const byExternal = new Map<string, { id: string; product: Product }>();
    const byName = new Map<string, { id: string; product: Product }>();
    const nextOrderBySection = new Map<string, number>();
    productSnap.docs.forEach((doc) => {
      const product = doc.data() as Product;
      if (product.externalId) byExternal.set(product.externalId, { id: doc.id, product });
      byName.set(`${product.sectionId ?? ''}|${nameKey(product.name)}`, { id: doc.id, product });
      const key = product.sectionId ?? '';
      nextOrderBySection.set(key, Math.max(nextOrderBySection.get(key) ?? 0, product.order + 1));
    });

    const report: MenuImportReport = { dryRun: data.dryRun, created: 0, updated: 0, unchanged: 0, sectionsCreated: [], errors: [], warnings: [] };
    const writes: Array<{ ref: DocumentReference; value: Record<string, unknown>; merge: boolean }> = [];
    const seen = new Set<string>();
    // Limite de produits de la formule (§17) : la règle Firestore `withinProductLimit` ne protège
    // que la saisie manuelle (écriture cliente) — cet import écrit en lot avec le SDK Admin, qui la
    // contourne entièrement. Vérifiée ici ligne à ligne plutôt qu'avec `assertWithinLimit` (qui
    // lèverait une exception et annulerait tout le lot) pour rester cohérente avec le rapport
    // ligne par ligne déjà produit par cette fonction.
    const maxProducts = await planLimitOf(data.restaurantId, 'maxProducts');
    let existingProducts = productSnap.size;

    data.rows.forEach((raw, index) => {
      const line = index + 2; // ligne 1 = en-têtes du fichier
      const parsed = row.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        report.errors.push({ row: line, message: issue ? `${issue.path.join('.') || 'ligne'} : ${issue.message}` : 'Ligne invalide' });
        return;
      }
      const input = parsed.data;

      let section = sectionByName.get(nameKey(input.section));
      if (!section) {
        const ref = sectionsCol.doc();
        section = { id: ref.id, name: input.section };
        sectionByName.set(nameKey(input.section), section);
        report.sectionsCreated.push(input.section);
        writes.push({
          ref,
          merge: false,
          value: { name: input.section, description: null, image: null, enabled: true, hideProductNames: false, order: nextSectionOrder++, availability: null, ...trackedCreate(uid) },
        });
      }

      const key = input.externalId ? `ext:${input.externalId}` : `${section.id}|${nameKey(input.name)}`;
      if (seen.has(key)) {
        report.errors.push({ row: line, message: 'Produit en double dans le fichier' });
        return;
      }
      seen.add(key);

      const match = (input.externalId && byExternal.get(input.externalId)) || byName.get(`${section.id}|${nameKey(input.name)}`);
      const fields = fieldsFromRow(input);
      // Alcool interdit : une mention repérée fait entrer le produit hors vente, à vérifier.
      const alcoholTerm = findAlcoholTerm(input.name, input.description);
      if (alcoholTerm) {
        fields.available = false;
        report.warnings!.push({ row: line, message: `Mention d’alcool repérée (« ${alcoholTerm} ») : produit importé hors vente, à vérifier.` });
      }
      fields.searchKeywords = buildSearchKeywords(input.name, section.name, ...(input.tags ?? []));

      if (match) {
        const moved = match.product.sectionId !== section.id;
        if (!moved && !differs(match.product, { ...fields, searchKeywords: match.product.searchKeywords })) {
          report.unchanged += 1;
          return;
        }
        report.updated += 1;
        writes.push({ ref: productsCol.doc(match.id), merge: true, value: { ...fields, sectionId: section.id, ...trackedUpdate(uid) } });
        return;
      }

      if (maxProducts !== null && existingProducts >= maxProducts) {
        report.errors.push({ row: line, message: `Limite de produits de votre formule atteinte (${maxProducts}) : changez de formule depuis « Abonnement » pour en ajouter.` });
        return;
      }

      const order = nextOrderBySection.get(section.id) ?? 0;
      nextOrderBySection.set(section.id, order + 1);
      existingProducts += 1;
      report.created += 1;
      const product: Omit<Product, 'createdAt' | 'updatedAt'> = {
        sectionId: section.id,
        name: input.name,
        description: input.description || null,
        priceCents: input.priceCents,
        compareAtPriceCents: input.compareAtPriceCents ?? null,
        vatCategory: input.vatCategory ?? 'food',
        image: null,
        available: alcoholTerm ? false : (input.available ?? true),
        stock: input.stock ?? null,
        lowStockThreshold: input.lowStockThreshold ?? 5,
        preparationMinutes: input.preparationMinutes ?? null,
        optionGroupIds: [],
        allergens: input.allergens ?? [],
        allergensDeclared: Boolean(input.allergens),
        dietary: input.dietary ?? [],
        containsAlcohol: false,
        alcoholPercent: null,
        nutrition: null,
        featured: false,
        order,
        salesCount: 0,
        externalId: input.externalId || null,
        searchKeywords: fields.searchKeywords ?? [],
        gallery: [],
        badge: input.badge ?? null,
        tags: input.tags ?? [],
        schedule: null,
        featuredOrder: null,
        autoSoldOut: false,
        qualityIssues: [],
      };
      writes.push({ ref: productsCol.doc(), merge: false, value: { ...product, ...trackedCreate(uid) } });
    });

    if (data.dryRun) return report;

    for (const group of chunk(writes, 400)) {
      const batch = db.batch();
      group.forEach(({ ref, value, merge }) => (merge ? batch.set(ref, value, { merge: true }) : batch.set(ref, value)));
      await batch.commit();
    }
    if (writes.length > 0) {
      await auditMenu(request, context, 'menu.imported', { type: 'restaurant', id: data.restaurantId, label: String(context.restaurant.name ?? '') }, {
        after: { created: report.created, updated: report.updated, sectionsCreated: report.sectionsCreated.length, errors: report.errors.length },
      });
    }
    return report;
  },
  { ...MENU_RUNTIME, timeoutSeconds: 120, memory: '512MiB' },
);
