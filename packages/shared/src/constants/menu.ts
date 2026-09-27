// Carte du restaurant : régimes, badges, motifs de mouvement de stock, anomalies
// de qualité, limites de saisie et format d'import / export CSV du menu.
import { normalizeText } from '../utils/ids';

const values = <const T extends readonly string[]>(list: T): T => list;

// ------------------------------------------------------------------ Régimes
export const MENU_DIETARY_TAGS = values(['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'spicy']);
export type MenuDietaryTag = (typeof MENU_DIETARY_TAGS)[number];

export const MENU_DIETARY_LABELS: Record<MenuDietaryTag, string> = {
  vegetarian: 'Végétarien',
  vegan: 'Végan',
  halal: 'Halal',
  kosher: 'Casher',
  gluten_free: 'Sans gluten',
  spicy: 'Épicé',
};

// ------------------------------------------------------------------ Badges
/** Pastille affichée sur la fiche produit de l'app client (une seule par produit). */
export const PRODUCT_BADGES = values(['new', 'popular', 'chef', 'seasonal', 'limited', 'homemade']);
export type ProductBadge = (typeof PRODUCT_BADGES)[number];

export const PRODUCT_BADGE_LABELS: Record<ProductBadge, string> = {
  new: 'Nouveau',
  popular: 'Populaire',
  chef: 'Suggestion du chef',
  seasonal: 'De saison',
  limited: 'Édition limitée',
  homemade: 'Fait maison',
};

// ------------------------------------------------------------------ Stocks
export const STOCK_MOVEMENT_REASONS = values(['order', 'order_cancelled', 'manual_adjust', 'reception', 'waste', 'inventory']);
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** Motifs qu'un membre du restaurant peut choisir lors d'un ajustement manuel. */
export const MANUAL_STOCK_REASONS = values(['reception', 'waste', 'inventory', 'manual_adjust']);
export type ManualStockReason = (typeof MANUAL_STOCK_REASONS)[number];

export const STOCK_MOVEMENT_REASON_LABELS: Record<StockMovementReason, string> = {
  order: 'Commande',
  order_cancelled: 'Commande annulée',
  manual_adjust: 'Correction',
  reception: 'Réception',
  waste: 'Perte ou casse',
  inventory: 'Inventaire',
};

/** Seuil d'alerte appliqué quand le restaurant n'en a pas défini. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

// ------------------------------------------------------------------ Qualité
export const MENU_ISSUE_TYPES = values([
  'missing_photo',
  'price_outlier',
  'allergens_missing',
  'missing_description',
  'empty_section',
  'alcohol_suspected',
]);
export type MenuIssueType = (typeof MENU_ISSUE_TYPES)[number];

export const MENU_ISSUE_LABELS: Record<MenuIssueType, string> = {
  missing_photo: 'Sans photo',
  price_outlier: 'Prix inhabituel',
  allergens_missing: 'Allergènes non déclarés',
  missing_description: 'Description absente',
  empty_section: 'Section vide',
  alcohol_suspected: 'Mention d’alcool à vérifier',
};

/** Suffixe stable des documents menuIssues : `${restaurantId}-${productId}-${suffixe}`. */
export const MENU_ISSUE_DOC_SUFFIX: Record<MenuIssueType, string> = {
  missing_photo: 'photo',
  price_outlier: 'price',
  allergens_missing: 'allergens',
  missing_description: 'description',
  empty_section: 'section',
  alcohol_suspected: 'alcohol',
};

// ------------------------------------------------------------------ Alcool
/**
 * La vente d'alcool est interdite sur GoLink (décision client) : ces termes, repérés
 * dans le nom ou la description d'un produit, déclenchent un signalement qualité
 * « Mention d'alcool à vérifier ». Comparaison sur le texte normalisé (sans accents).
 */
export const MENU_ALCOHOL_TERMS = values([
  'alcool', 'alcoolise', 'biere', 'bieres', 'beer', 'ipa', 'lager', 'pils', 'vin', 'vins', 'wine',
  'champagne', 'cremant', 'prosecco', 'cava', 'mousseux', 'cidre', 'whisky', 'whiskey', 'bourbon', 'vodka',
  'rhum', 'rum', 'gin', 'tequila', 'mezcal', 'cognac', 'armagnac', 'calvados', 'pastis', 'ricard', 'anisette', 'ouzo',
  'raki', 'arak', 'sake', 'soju', 'liqueur', 'limoncello', 'amaretto', 'spritz', 'aperol', 'martini', 'porto', 'sangria',
  'cocktail alcoolise', 'mojito', 'margarita', 'digestif', 'aperitif', 'eau-de-vie', 'schnaps', 'absinthe', 'hydromel',
]);

/** Premier terme d'alcool trouvé dans les textes (mots entiers, sans accents), ou null. */
export function findAlcoholTerm(...texts: Array<string | null | undefined>): string | null {
  const haystack = ` ${normalizeText(texts.filter(Boolean).join(' '))
    .replace(/[^a-z0-9-]+/g, ' ')
    // « sans alcool » ne suffit pas à signaler un produit à lui seul.
    .replace(/sans alcool/g, ' ')} `;
  return MENU_ALCOHOL_TERMS.find((term) => haystack.includes(` ${term} `)) ?? null;
}

// ------------------------------------------------------------------ Limites
export const MENU_LIMITS = {
  sectionName: 80,
  sectionDescription: 500,
  productName: 100,
  productDescription: 1000,
  optionName: 90,
  groupName: 90,
  groupDescription: 240,
  /** Photos d'un produit, principale comprise. */
  photos: 6,
  tags: 8,
  tagLength: 24,
  /** Lignes par import CSV. */
  importRows: 500,
  /** Produits en vitrine (app client). */
  featured: 12,
  /** Prix maximum accepté pour un produit ou une option (1 000 €). */
  maxPriceCents: 100_000,
  /** Description jugée trop courte en dessous de ce nombre de caractères. */
  minDescription: 15,
  /** Durée de conservation dans la corbeille. */
  trashDays: 30,
} as const;

// ------------------------------------------------------------------ Import / export CSV
/** Colonnes du fichier CSV de la carte (ordre du modèle téléchargeable). */
export const MENU_CSV_COLUMNS = values([
  'section',
  'nom',
  'description',
  'prix',
  'prix_barre',
  'tva',
  'disponible',
  'stock',
  'seuil_alerte',
  'preparation_min',
  'allergenes',
  'regimes',
  'badge',
  'etiquettes',
  'reference',
]);
export type MenuCsvColumn = (typeof MENU_CSV_COLUMNS)[number];
