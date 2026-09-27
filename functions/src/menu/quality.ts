// Contrôle qualité et champs dérivés d'un produit, à chaque écriture :
// - mots-clés de recherche ;
// - alcool interdit (décision client) : un produit de type « boisson alcoolisée », marqué
//   alcoolisé ou dont le nom / la description mentionne de l'alcool est retiré de la vente
//   et signalé au contrôle qualité (la mention peut être levée après vérification) ;
// - rupture automatique (stock suivi à 0 → indisponible, remis en ligne au réassort) ;
// - anomalies (photo, description, allergènes, prix inhabituel) → `qualityIssues`
//   sur le produit et documents `menuIssues` pour le super admin ;
// - `allergensComplete` du restaurant.
// Idempotent : n'écrit que les valeurs qui changent (l'écriture relance le trigger, sans effet).
import {
  COLLECTIONS,
  MENU_ISSUE_DOC_SUFFIX,
  MENU_LIMITS,
  buildSearchKeywords,
  findAlcoholTerm,
  type MenuIssue,
  type MenuIssueType,
  type Product,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../lib/admin';
import { MENU_RUNTIME, menuCollection, restaurantRef } from './common';

/** Anomalies de qualité suivies produit par produit (la section vide est contrôlée à part). */
const PRODUCT_ISSUES: MenuIssueType[] = ['missing_photo', 'missing_description', 'allergens_missing', 'price_outlier', 'alcohol_suspected'];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Prix hors norme : nul, supérieur à 200 €, ou très éloigné des autres produits de la section. */
async function isPriceOutlier(restaurantId: string, productId: string, product: Product): Promise<boolean> {
  if (product.priceCents <= 0 || product.priceCents > 20_000) return true;
  if (!product.sectionId) return false;
  const siblings = await menuCollection(restaurantId, 'products').where('sectionId', '==', product.sectionId).select('priceCents').get();
  const prices = siblings.docs.filter((doc) => doc.id !== productId).map((doc) => Number(doc.get('priceCents') ?? 0)).filter((p) => p > 0);
  if (prices.length < 3) return false;
  const reference = median(prices);
  return product.priceCents > reference * 4 || product.priceCents * 4 < reference;
}

function sameList(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

async function syncIssues(restaurantId: string, cityId: string, productId: string, name: string, issues: Set<MenuIssueType>) {
  const refs = PRODUCT_ISSUES.map((type) => db.collection(COLLECTIONS.menuIssues).doc(`${restaurantId}-${productId}-${MENU_ISSUE_DOC_SUFFIX[type]}`));
  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let writes = 0;
  const details: Record<MenuIssueType, string> = {
    missing_photo: `« ${name} » n’a pas de photo.`,
    missing_description: `« ${name} » n’a pas de description détaillée.`,
    allergens_missing: `Les allergènes de « ${name} » ne sont pas déclarés.`,
    price_outlier: `Le prix de « ${name} » semble inhabituel.`,
    alcohol_suspected: `« ${name} » semble contenir de l’alcool, dont la vente est interdite sur Ciyou Eats.`,
    empty_section: '',
  };
  PRODUCT_ISSUES.forEach((type, index) => {
    const snap = snaps[index]!;
    const status = snap.exists ? (snap.get('status') as MenuIssue['status']) : null;
    if (issues.has(type)) {
      // Une anomalie ignorée par le restaurant ou l'équipe reste ignorée.
      if (status === 'open' || status === 'ignored') return;
      const issue: Omit<MenuIssue, 'detectedAt'> & { detectedAt: FieldValue } = {
        restaurantId,
        cityId,
        productId,
        type,
        details: details[type],
        status: 'open',
        detectedAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
        resolvedBy: null,
      };
      batch.set(refs[index]!, issue);
      writes += 1;
    } else if (status === 'open') {
      batch.update(refs[index]!, { status: 'fixed', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: 'system' });
      writes += 1;
    }
  });
  if (writes > 0) await batch.commit();
}

async function syncAllergensComplete(restaurantId: string) {
  const [missing, restaurant] = await Promise.all([
    menuCollection(restaurantId, 'products').where('allergensDeclared', '==', false).limit(1).get(),
    restaurantRef(restaurantId).get(),
  ]);
  if (!restaurant.exists) return;
  const complete = missing.empty;
  if (restaurant.get('allergensComplete') !== complete) await restaurant.ref.update({ allergensComplete: complete });
}

export const onProductWritten = onDocumentWritten(
  { document: `${COLLECTIONS.restaurants}/{restaurantId}/products/{productId}`, ...MENU_RUNTIME },
  async (event) => {
    const { restaurantId, productId } = event.params;
    const after = event.data?.after;
    const before = event.data?.before;

    // Suppression (mise en corbeille) : anomalies closes, indicateur recalculé.
    if (!after?.exists) {
      const restaurant = await restaurantRef(restaurantId).get();
      await syncIssues(restaurantId, String(restaurant.get('cityId') ?? ''), productId, '', new Set());
      await syncAllergensComplete(restaurantId);
      return;
    }

    const product = after.data() as Product;
    const patch: Record<string, unknown> = {};

    // Mots-clés : nom, section, étiquettes.
    let sectionName: string | null = null;
    if (product.sectionId) {
      const section = await menuCollection(restaurantId, 'sections').doc(product.sectionId).get();
      sectionName = section.exists ? String(section.get('name') ?? '') : null;
    }
    const keywords = buildSearchKeywords(product.name, sectionName, ...(product.tags ?? []));
    if (!sameList(product.searchKeywords, keywords)) patch.searchKeywords = keywords;

    // Alcool interdit : le produit ne peut pas être en vente. Une simple mention d'alcool
    // le retire aussi de la vente, sauf si le signalement a été levé (« ignoré ») après
    // vérification (ex. « coq au vin », « sauce au rhum » cuisinés).
    const alcoholTerm = findAlcoholTerm(product.name, product.description);
    let alcoholCleared = false;
    if (alcoholTerm) {
      const issue = await db.collection(COLLECTIONS.menuIssues).doc(`${restaurantId}-${productId}-${MENU_ISSUE_DOC_SUFFIX.alcohol_suspected}`).get();
      alcoholCleared = issue.exists && issue.get('status') === 'ignored';
    }
    const forbidden = product.vatCategory === 'alcohol' || product.containsAlcohol === true || (Boolean(alcoholTerm) && !alcoholCleared);
    if (forbidden && product.available) patch.available = false;

    // Rupture automatique (sans effet sur un produit interdit, qui reste hors vente).
    if (!forbidden && product.stock === 0 && product.available) {
      patch.available = false;
      patch.autoSoldOut = true;
    } else if (!forbidden && product.autoSoldOut && (product.stock === null || product.stock > 0)) {
      patch.available = true;
      patch.autoSoldOut = false;
    }

    // Contrôle qualité.
    const issues = new Set<MenuIssueType>();
    if (!product.image?.url) issues.add('missing_photo');
    if ((product.description ?? '').trim().length < MENU_LIMITS.minDescription) issues.add('missing_description');
    if (!product.allergensDeclared) issues.add('allergens_missing');
    const priceChanged = !before?.exists || before.get('priceCents') !== product.priceCents || before.get('sectionId') !== product.sectionId;
    const wasOutlier = (product.qualityIssues ?? []).includes('price_outlier');
    if (priceChanged ? await isPriceOutlier(restaurantId, productId, product) : wasOutlier) issues.add('price_outlier');
    if (forbidden) issues.add('alcohol_suspected');
    const qualityIssues = PRODUCT_ISSUES.filter((type) => issues.has(type));
    if (!sameList(product.qualityIssues, qualityIssues)) patch.qualityIssues = qualityIssues;

    if (Object.keys(patch).length > 0) {
      await after.ref.update(patch);
      logger.debug('Produit mis à jour par le contrôle qualité', { restaurantId, productId, fields: Object.keys(patch) });
    }

    const restaurant = await restaurantRef(restaurantId).get();
    await syncIssues(restaurantId, String(restaurant.get('cityId') ?? ''), productId, product.name, issues);
    if (!before?.exists || before.get('allergensDeclared') !== product.allergensDeclared) await syncAllergensComplete(restaurantId);
  },
);
