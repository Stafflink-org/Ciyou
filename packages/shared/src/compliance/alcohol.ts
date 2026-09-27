// Interdiction de la vente d'alcool (décision du client). Module pur : détection par
// mots-clés (français, anglais, arabe) après normalisation (casse, accents, signes
// diacritiques arabes, variantes d'alif), et contrôle d'un produit avant écriture.
// Un produit déclaré alcoolisé est bloqué ; un mot-clé détecté est signalé au
// contrôle qualité (faux positifs possibles : « baba au rhum », « coq au vin »).
import type { VatCategory } from '../constants/enums';
import { FORBIDDEN_VAT_CATEGORIES } from '../constants/enums';

/** La vente d'alcool est interdite sur la plateforme. */
export const ALCOHOL_SALES_FORBIDDEN = true as const;

/** Politique verrouillée : aucun réglage (plateforme, pays, ville, commerce) ne peut la lever. */
export const ALCOHOL_POLICY = {
  forbidden: true,
  locked: true,
  /** Clé de fonctionnalité éteinte et verrouillée. */
  featureKey: 'alcohol_sales',
  /** Catégorie de TVA non sélectionnable. */
  vatCategory: 'alcohol',
} as const;

/** Mots-clés (forme normalisée : minuscules, sans accents). Plusieurs mots = expression. */
export const ALCOHOL_KEYWORDS: Readonly<Record<'fr' | 'en' | 'ar', readonly string[]>> = {
  fr: [
    'alcool', 'alcoolise', 'alcoolisee', 'biere', 'vin', 'vins', 'whisky', 'whiskey', 'vodka', 'rhum', 'champagne',
    'cidre', 'aperitif', 'digestif', 'pastis', 'liqueur', 'cognac', 'armagnac', 'calvados', 'gin', 'tequila',
    'mezcal', 'porto', 'martini', 'sangria', 'prosecco', 'cremant', 'spiritueux', 'kir', 'spritz', 'absinthe',
    'limoncello', 'schnaps', 'eau de vie', 'ricard', 'muscat', 'bourbon', 'brandy', 'sake', 'soju', 'rose de provence',
  ],
  en: [
    'alcohol', 'alcoholic', 'beer', 'lager', 'stout', 'ale', 'wine', 'rum', 'cider', 'liquor', 'spirits',
    'hard seltzer', 'bourbon', 'brandy', 'whisky', 'whiskey', 'vodka', 'gin', 'tequila', 'champagne',
  ],
  ar: [
    'كحول', 'كحولي', 'كحولية', 'خمر', 'خمور', 'نبيذ', 'بيرة', 'بيره', 'جعة', 'ويسكي', 'فودكا', 'شمبانيا',
    'شامبانيا', 'كونياك', 'ليكيور', 'مشروبات روحية', 'مشروب كحولي',
  ],
};

/** Mentions « sans alcool » : le produit reste signalé, mais la mention est remontée. */
const NON_ALCOHOLIC_MENTIONS = [
  'sans alcool', '0 alcool', 'alcohol free', 'non alcoholic', 'alcoholfree', 'nonalcoholic', 'بدون كحول',
  'خالي من الكحول', 'خال من الكحول',
];

/** Préfixes arabes collés au mot (article, conjonctions, prépositions). */
const ARABIC_PREFIXES = ['وال', 'بال', 'فال', 'كال', 'لل', 'ال', 'و', 'ب', 'ف', 'ل'];

/**
 * Normalise un texte pour la détection : minuscules, accents latins retirés,
 * signes diacritiques arabes et tatweel retirés, variantes d'alif, ta marbuta et
 * alif maqsura unifiées, ponctuation remplacée par des espaces.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizedKeyword(k: string): string[] {
  return normalizeForMatch(k).split(' ').filter(Boolean);
}

const KEYWORD_TOKENS: ReadonlyArray<{ keyword: string; tokens: string[] }> = [
  ...new Set([...ALCOHOL_KEYWORDS.fr, ...ALCOHOL_KEYWORDS.en, ...ALCOHOL_KEYWORDS.ar]),
].map((keyword) => ({ keyword, tokens: normalizedKeyword(keyword) }));

/** Variantes d'un mot : pluriels simples (s, x) et préfixes arabes. */
function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  if (token.length > 3 && (token.endsWith('s') || token.endsWith('x'))) variants.add(token.slice(0, -1));
  if (/[؀-ۿ]/.test(token)) {
    for (const prefix of ARABIC_PREFIXES) {
      if (token.startsWith(prefix) && token.length - prefix.length >= 3) variants.add(token.slice(prefix.length));
    }
  }
  return [...variants];
}

export interface AlcoholDetection {
  /** Au moins un mot-clé d'alcool trouvé. */
  matched: boolean;
  /** Mots-clés trouvés (forme de la liste). */
  keywords: string[];
  /** Une mention « sans alcool » figure dans le texte. */
  nonAlcoholicMention: boolean;
}

/** Détecte des mots-clés d'alcool dans un ou plusieurs textes (nom, description, étiquettes). */
export function detectAlcoholKeywords(...texts: ReadonlyArray<string | null | undefined>): AlcoholDetection {
  const normalized = normalizeForMatch(texts.filter(Boolean).join(' '));
  const tokens = normalized.split(' ').filter(Boolean);
  const variants = tokens.map(tokenVariants);
  const found = new Set<string>();
  for (const { keyword, tokens: kw } of KEYWORD_TOKENS) {
    if (kw.length === 0) continue;
    for (let i = 0; i + kw.length <= tokens.length; i++) {
      if (kw.every((t, j) => variants[i + j]!.includes(t))) {
        found.add(keyword);
        break;
      }
    }
  }
  const padded = ` ${normalized} `;
  const nonAlcoholicMention = NON_ALCOHOLIC_MENTIONS.some((m) => padded.includes(` ${normalizeForMatch(m)} `));
  return { matched: found.size > 0, keywords: [...found], nonAlcoholicMention };
}

/** Champs d'un produit utiles au contrôle (compatibles avec `Product` et `MenuImportRow`). */
export interface AlcoholCheckInput {
  name?: string | null;
  description?: string | null;
  tags?: readonly string[] | null;
  vatCategory?: VatCategory | null;
  containsAlcohol?: boolean | null;
  alcoholPercent?: number | null;
}

export type AlcoholBlockReason = 'vat_category_alcohol' | 'contains_alcohol' | 'alcohol_percent';

export interface AlcoholCheck {
  /** Création ou modification refusée (produit déclaré alcoolisé). */
  blocked: boolean;
  reasons: AlcoholBlockReason[];
  /** Mots-clés détectés : à signaler au contrôle qualité. */
  flagged: boolean;
  keywords: string[];
  nonAlcoholicMention: boolean;
}

/** Contrôle d'un produit avant écriture : blocage des produits déclarés alcoolisés, signalement par mots-clés. */
export function checkProductAlcohol(product: AlcoholCheckInput): AlcoholCheck {
  const reasons: AlcoholBlockReason[] = [];
  if (product.vatCategory && FORBIDDEN_VAT_CATEGORIES.includes(product.vatCategory)) reasons.push('vat_category_alcohol');
  if (product.containsAlcohol) reasons.push('contains_alcohol');
  if (product.alcoholPercent != null && product.alcoholPercent > 0) reasons.push('alcohol_percent');
  const detection = detectAlcoholKeywords(product.name, product.description, ...(product.tags ?? []));
  return {
    blocked: reasons.length > 0,
    reasons,
    flagged: detection.matched,
    keywords: detection.keywords,
    nonAlcoholicMention: detection.nonAlcoholicMention,
  };
}

export const ALCOHOL_BLOCK_MESSAGES: Readonly<Record<AlcoholBlockReason, string>> = {
  vat_category_alcohol: 'La vente de boissons alcoolisées est interdite sur GoLink.',
  contains_alcohol: 'Les produits contenant de l’alcool ne peuvent pas être vendus sur GoLink.',
  alcohol_percent: 'Un produit avec un degré d’alcool ne peut pas être vendu sur GoLink.',
};
