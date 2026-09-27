// Calculs d'affichage de la carte : état de stock, qualité, créneaux, recherche.
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  MENU_LIMITS,
  findAlcoholTerm,
  normalizeText,
  type MenuIssueType,
  type MenuSchedule,
  type Product,
} from '@golink/shared';
import type { Tone } from '@golink/ui';

export type StockState = 'untracked' | 'ok' | 'low' | 'out';

export function stockState(product: Pick<Product, 'stock' | 'lowStockThreshold'>): StockState {
  if (product.stock === null || product.stock === undefined) return 'untracked';
  if (product.stock <= 0) return 'out';
  if (product.stock <= (product.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD)) return 'low';
  return 'ok';
}

export const STOCK_STATE_META: Record<StockState, { label: string; tone: Tone }> = {
  untracked: { label: 'Non suivi', tone: 'neutral' },
  ok: { label: 'En stock', tone: 'success' },
  low: { label: 'Stock faible', tone: 'amber' },
  out: { label: 'Rupture', tone: 'danger' },
};

/** Statut de vente vu par le client : en ligne, masqué, rupture. */
export function saleState(product: Pick<Product, 'available' | 'stock' | 'autoSoldOut'>): { label: string; tone: Tone } {
  if (product.stock === 0 || product.autoSoldOut) return { label: 'Rupture', tone: 'danger' };
  if (!product.available) return { label: 'Masqué', tone: 'neutral' };
  return { label: 'En ligne', tone: 'success' };
}

/**
 * Anomalies de qualité, évaluées dans le navigateur pour un retour immédiat
 * (le prix inhabituel vient du contrôle serveur, qui compare aux autres produits).
 */
export function productIssues(
  product: Pick<Product, 'name' | 'image' | 'description' | 'allergensDeclared' | 'qualityIssues' | 'priceCents' | 'vatCategory' | 'containsAlcohol'>,
): MenuIssueType[] {
  const issues: MenuIssueType[] = [];
  if (!product.image?.url) issues.push('missing_photo');
  if ((product.description ?? '').trim().length < MENU_LIMITS.minDescription) issues.push('missing_description');
  if (!product.allergensDeclared) issues.push('allergens_missing');
  if (product.priceCents <= 0 || (product.qualityIssues ?? []).includes('price_outlier')) issues.push('price_outlier');
  // Mention d'alcool : signalée tant que le contrôle serveur ne l'a pas levée (signalement ignoré après vérification).
  const mention = Boolean(findAlcoholTerm(product.name, product.description)) && (product.qualityIssues?.includes('alcohol_suspected') ?? true);
  if (product.vatCategory === 'alcohol' || product.containsAlcohol || mention) issues.push('alcohol_suspected');
  return issues;
}

/** Contrôles qualité évalués par produit. */
export const QUALITY_CHECKS = 5;

/** Score de qualité de la carte (0 à 1) : part des contrôles réussis. */
export function menuQualityScore(products: Array<Parameters<typeof productIssues>[0]>): number {
  if (products.length === 0) return 1;
  const failed = products.reduce((sum, product) => sum + productIssues(product).length, 0);
  return Math.max(0, 1 - failed / (products.length * QUALITY_CHECKS));
}

const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const DAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** « lun.–ven. · 11:30–14:30 ». */
export function scheduleSummary(schedule: MenuSchedule | null | undefined): string | null {
  if (!schedule) return null;
  const days = [...schedule.days].sort((a, b) => a - b);
  let dayText: string;
  if (days.length === 7) dayText = 'Tous les jours';
  else if (days.length === 0) dayText = 'Aucun jour';
  else {
    const contiguous = days.every((day, index) => index === 0 || day === days[index - 1]! + 1);
    dayText = contiguous && days.length > 2 ? `${DAY_SHORT[days[0]!]}–${DAY_SHORT[days[days.length - 1]!]}` : days.map((d) => DAY_SHORT[d]).join(' ');
  }
  return `${dayText} · ${schedule.from}–${schedule.to}`;
}

/** Recherche insensible aux accents et à la casse. */
export function matches(query: string, ...values: Array<string | null | undefined>): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return values.some((value) => value && normalizeText(value).includes(q));
}

/** Nom de section libre (comparaison insensible à la casse et aux accents). */
export function sectionNameTaken(name: string, sections: Array<{ id: string; name: string }>, exceptId?: string): boolean {
  const key = normalizeText(name).replace(/\s+/g, ' ');
  return sections.some((section) => section.id !== exceptId && normalizeText(section.name).replace(/\s+/g, ' ') === key);
}

/** Saisie « 12,50 » → centimes ; null si invalide. */
export function parseEuros(input: string): number | null {
  const normalized = input.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Centimes → « 12,50 » pour un champ de saisie. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${new Intl.NumberFormat('fr-FR').format(count)} ${count > 1 ? pluralForm : singular}`;
}
