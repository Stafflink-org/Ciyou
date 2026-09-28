// Carte du restaurant : sections, produits, options, listes d'options, stocks.
// Sous-collections de restaurants/{rid}. Prix TTC en centimes. Une suppression
// déplace le document dans la corbeille (`trash`) ; il n'y a pas de champ deletedAt.
import type { Allergen, ProductSaleUnit, VatCategory } from '../constants/enums';
import type { MenuDietaryTag, MenuIssueType, ProductBadge } from '../constants/menu';
import type { Cents } from '../pricing/money';
import type { ImageRef, Timestamp, Tracked } from './common';

/** Traductions manuelles ou générées (bouton « Traduire automatiquement », Azure Translator). */
export type FieldTranslations = Partial<Record<string, { name?: string | null; description?: string | null }>>;

/** restaurants/{rid}/sections/{id}. Nom unique par restaurant (insensible à la casse). */
export interface MenuSection extends Tracked {
  name: string;
  description?: string | null;
  image?: ImageRef | null;
  enabled: boolean;
  hideProductNames: boolean;
  order: number;
  /** Disponibilité horaire (ex. formule midi) ; null = toute la journée. */
  availability?: { days: number[]; from: string; to: string } | null;
  /** Traductions par langue (ex. { en: { name: '...' }, ar: { name: '...' } }), modifiables à la main. */
  translations?: FieldTranslations | null;
}

export interface NutritionInfo {
  kcal?: number | null;
  proteinsG?: number | null;
  carbsG?: number | null;
  fatsG?: number | null;
}

/** restaurants/{rid}/products/{id}. */
export interface Product extends Tracked {
  sectionId: string | null;
  name: string;
  description?: string | null;
  priceCents: Cents;
  /** Prix barré d'affichage (promotion permanente). */
  compareAtPriceCents?: Cents | null;
  /** `alcohol` est interdit (décision client) : voir SELECTABLE_VAT_CATEGORIES. */
  vatCategory: VatCategory;
  /** Taux de TVA propre au produit (commerces non alimentaires), prioritaire sur la catégorie. */
  vatRateBpsOverride?: number | null;
  /** Mode de vente (absent = à l'unité). Au poids : `priceCents` = prix d'une portion indicative. */
  saleUnit?: ProductSaleUnit;
  /** Vente au poids : prix au kilogramme. */
  pricePerKgCents?: Cents | null;
  /** Vente au poids : pas, minimum et maximum de la quantité commandée (grammes). */
  weightStepGrams?: number | null;
  minWeightGrams?: number | null;
  maxWeightGrams?: number | null;
  /** Prix variable : montant maximal pré-autorisé par unité (prix final fixé à la préparation). */
  variablePriceMaxCents?: Cents | null;
  image?: ImageRef | null;
  available: boolean;
  /** null = stock non suivi (illimité). */
  stock: number | null;
  lowStockThreshold: number;
  preparationMinutes?: number | null;
  optionGroupIds: string[];
  allergens: Allergen[];
  /** Le restaurant a explicitement renseigné les allergènes (même vides). */
  allergensDeclared: boolean;
  dietary: Array<'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'gluten_free' | 'spicy'>;
  /** Doit rester false : un produit alcoolisé est refusé (compliance/alcohol.ts). */
  containsAlcohol: boolean;
  alcoholPercent?: number | null;
  nutrition?: NutritionInfo | null;
  featured: boolean;
  order: number;
  salesCount: number;
  /** Référence externe (logiciel de caisse). */
  externalId?: string | null;
  searchKeywords: string[];
  /** Photos supplémentaires (la principale reste `image`), au plus MENU_LIMITS.photos au total. */
  gallery?: ImageRef[];
  /** Pastille affichée dans l'app client. */
  badge?: ProductBadge | null;
  /** Étiquettes libres (« best-seller », « nouveau chef »…), utiles à la recherche et aux filtres. */
  tags?: string[];
  /** Créneaux de vente (ex. midi en semaine) ; null = pendant toutes les heures d'ouverture. */
  schedule?: MenuSchedule | null;
  /** Position dans la vitrine « produits mis en avant » (croissante). */
  featuredOrder?: number | null;
  /** Rendu indisponible automatiquement par la rupture de stock (remis en ligne au réassort). */
  autoSoldOut?: boolean;
  /** Anomalies détectées par le contrôle qualité (Cloud Function onProductWritten). */
  qualityIssues?: MenuIssueType[];
  /** Traductions par langue (ex. { en: { name: '...', description: '...' } }), modifiables à la main. */
  translations?: FieldTranslations | null;
}

/** Créneau de disponibilité : jours (0 = lundi … 6 = dimanche) et plage horaire locale. */
export interface MenuSchedule {
  days: number[];
  from: string;
  to: string;
}

/** Ligne d'import CSV de la carte, déjà convertie (prix en centimes). */
export interface MenuImportRow {
  section: string;
  name: string;
  description?: string | null;
  priceCents: Cents;
  compareAtPriceCents?: Cents | null;
  vatCategory?: VatCategory | null;
  available?: boolean | null;
  /** null = stock non suivi ; absent = inchangé. */
  stock?: number | null;
  lowStockThreshold?: number | null;
  preparationMinutes?: number | null;
  allergens?: Allergen[] | null;
  dietary?: MenuDietaryTag[] | null;
  badge?: ProductBadge | null;
  tags?: string[] | null;
  externalId?: string | null;
}

/** Résultat d'un import (ou d'une simulation d'import). */
export interface MenuImportReport {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  sectionsCreated: string[];
  errors: Array<{ row: number; message: string }>;
  /** Lignes importées mais à vérifier (mention d'alcool : produit importé hors vente). */
  warnings?: Array<{ row: number; message: string }>;
}

/** restaurants/{rid}/options/{id} : option réutilisable dans plusieurs listes. */
export interface MenuOption extends Tracked {
  name: string;
  priceCents: Cents;
  enabled: boolean;
  allergens: Allergen[];
  /** Option qui pointe vers un produit (menus composés). */
  linkedProductId?: string | null;
  externalId?: string | null;
}

/** restaurants/{rid}/optionGroups/{id} : liste de choix (requise si min ≥ 1). */
export interface OptionGroup extends Tracked {
  name: string;
  description?: string | null;
  optionIds: string[];
  enabled: boolean;
  multiple: boolean;
  min: number;
  max: number;
  /** Une même option peut être choisie plusieurs fois (ex. 2 × sauce). */
  allowQuantity: boolean;
}

/** restaurants/{rid}/stockMovements/{id} : historique des mouvements de stock. */
export interface StockMovement {
  productId: string;
  productName: string;
  delta: number;
  stockAfter: number;
  reason: 'order' | 'order_cancelled' | 'manual_adjust' | 'reception' | 'waste' | 'inventory';
  orderId?: string | null;
  note?: string | null;
  createdAt: Timestamp;
  createdBy: string;
}
