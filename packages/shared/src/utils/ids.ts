// Identifiants lisibles, codes, slugs et mots-clés de recherche.

/** Numéro de commande lisible : 10482 → « GL-10482 ». */
export function formatOrderNumber(sequence: number): string {
  return `GL-${String(sequence).padStart(5, '0')}`;
}

/** Numéro de ticket : 4512 → « T-004512 ». */
export function formatTicketNumber(sequence: number): string {
  return `T-${String(sequence).padStart(6, '0')}`;
}

/** Numéro de facture continu par série : (« FR-COM », 2026, 125) → « FR-COM-2026-000125 ». */
export function formatInvoiceNumber(series: string, year: number, sequence: number): string {
  return `${series}-${year}-${String(sequence).padStart(6, '0')}`;
}

/** Normalise une saisie de numéro de commande (« gl 10482 », « #GL-10482 ») ; null si ce n'en est pas un. */
export function parseOrderNumber(input: string): string | null {
  const match = input.trim().toUpperCase().match(/^#?GL[\s-]?(\d{1,10})$/);
  return match ? formatOrderNumber(Number(match[1])) : null;
}

/** Code de retrait ou de remise à 4 chiffres. `random` est injectable pour les tests. */
export function generateFourDigitCode(random: () => number = Math.random): string {
  return String(1000 + Math.floor(random() * 9000));
}

/** Code de parrainage : 8 caractères sans ambiguïté (pas de 0/O, 1/I). */
export function generateReferralCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
}

/** Code promo valide : majuscules, chiffres, tiret, souligné, 3 à 24 caractères. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,24}$/;

/** Supprime accents et casse pour la recherche et les slugs. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Mots-clés de recherche (préfixes) pour une requête `array-contains` :
 * « Mina Kitchen » → mi, min, mina, ki, kit, … Longueur minimale 2, maximale 15.
 */
export function buildSearchKeywords(...values: Array<string | null | undefined>): string[] {
  const keywords = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeText(value);
    const compact = normalized.replace(/[\s.+()-]/g, '');
    if (compact.length >= 2) keywords.add(compact.slice(0, 30));
    for (const word of normalized.split(/[\s,@.'’-]+/)) {
      for (let i = 2; i <= Math.min(word.length, 15); i += 1) keywords.add(word.slice(0, i));
    }
  }
  return [...keywords];
}
