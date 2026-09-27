// Import / export CSV de la carte (séparateur « ; », UTF-8 avec BOM pour Excel).
import Papa from 'papaparse';
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  MENU_CSV_COLUMNS,
  MENU_DIETARY_LABELS,
  MENU_DIETARY_TAGS,
  MENU_LIMITS,
  PRODUCT_BADGES,
  PRODUCT_BADGE_LABELS,
  VAT_CATEGORIES,
  VAT_CATEGORY_LABELS,
  normalizeText,
  slugify,
  type Allergen,
  type MenuCsvColumn,
  type MenuDietaryTag,
  type MenuImportRow,
  type ProductBadge,
  type VatCategory,
} from '@golink/shared';
import type { MenuProduct, Section } from './data';
import { centsToInput, parseEuros } from './helpers';

const LIST_SEPARATOR = ', ';

function lookup<T extends string>(values: readonly T[], labels: Record<T, string>): Map<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    map.set(normalizeText(value), value);
    map.set(normalizeText(labels[value]), value);
  }
  return map;
}

const ALLERGEN_LOOKUP = lookup(ALLERGENS, ALLERGEN_LABELS);
const DIETARY_LOOKUP = lookup(MENU_DIETARY_TAGS, MENU_DIETARY_LABELS);
const BADGE_LOOKUP = lookup(PRODUCT_BADGES, PRODUCT_BADGE_LABELS);
const VAT_LOOKUP = lookup(VAT_CATEGORIES, VAT_CATEGORY_LABELS);

function download(filename: string, content: string) {
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rowOf(product: MenuProduct, sectionName: string): Record<MenuCsvColumn, string> {
  return {
    section: sectionName,
    nom: product.name,
    description: product.description ?? '',
    prix: centsToInput(product.priceCents),
    prix_barre: centsToInput(product.compareAtPriceCents ?? null),
    tva: VAT_CATEGORY_LABELS[product.vatCategory],
    disponible: product.available ? 'oui' : 'non',
    stock: product.stock === null ? '' : String(product.stock),
    seuil_alerte: String(product.lowStockThreshold ?? ''),
    preparation_min: product.preparationMinutes ? String(product.preparationMinutes) : '',
    allergenes: product.allergensDeclared ? (product.allergens.length ? product.allergens.map((a) => ALLERGEN_LABELS[a]).join(LIST_SEPARATOR) : 'aucun') : '',
    regimes: product.dietary.map((d) => MENU_DIETARY_LABELS[d]).join(LIST_SEPARATOR),
    badge: product.badge ? PRODUCT_BADGE_LABELS[product.badge] : '',
    etiquettes: (product.tags ?? []).join(LIST_SEPARATOR),
    reference: product.externalId ?? '',
  };
}

export function exportMenuCsv(restaurantName: string, sections: Section[], products: MenuProduct[]) {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const sorted = [...products].sort((a, b) => {
    const sa = a.sectionId ? (sectionById.get(a.sectionId)?.order ?? 9999) : 10_000;
    const sb = b.sectionId ? (sectionById.get(b.sectionId)?.order ?? 9999) : 10_000;
    return sa - sb || a.order - b.order;
  });
  const rows = sorted.map((p) => rowOf(p, p.sectionId ? (sectionById.get(p.sectionId)?.name ?? 'Sans section') : 'Sans section'));
  const csv = Papa.unparse({ fields: [...MENU_CSV_COLUMNS], data: rows.map((r) => MENU_CSV_COLUMNS.map((c) => r[c])) }, { delimiter: ';' });
  const day = new Date().toISOString().slice(0, 10);
  download(`carte-${slugify(restaurantName)}-${day}.csv`, csv);
}

export function downloadMenuTemplate() {
  const example: Record<MenuCsvColumn, string> = {
    section: 'Plats',
    nom: 'Assiette poulet za’atar',
    description: 'Poulet rôti, labneh fouetté, herbes fraîches et pain plat.',
    prix: '15,50',
    prix_barre: '',
    tva: 'Restauration',
    disponible: 'oui',
    stock: '20',
    seuil_alerte: '5',
    preparation_min: '15',
    allergenes: 'Gluten, Lait, Sésame',
    regimes: 'Halal',
    badge: 'Suggestion du chef',
    etiquettes: 'best-seller',
    reference: '',
  };
  const csv = Papa.unparse({ fields: [...MENU_CSV_COLUMNS], data: [MENU_CSV_COLUMNS.map((c) => example[c])] }, { delimiter: ';' });
  download('modele-carte-golink.csv', csv);
}

// ------------------------------------------------------------------ Lecture

export interface ParsedLine {
  /** Numéro de ligne dans le fichier (1 = en-têtes). */
  line: number;
  row: MenuImportRow | null;
  errors: string[];
}

const HEADER_ALIASES: Record<string, MenuCsvColumn> = {
  section: 'section',
  categorie: 'section',
  nom: 'nom',
  produit: 'nom',
  description: 'description',
  prix: 'prix',
  prixbarre: 'prix_barre',
  tva: 'tva',
  type: 'tva',
  disponible: 'disponible',
  stock: 'stock',
  seuilalerte: 'seuil_alerte',
  seuil: 'seuil_alerte',
  preparationmin: 'preparation_min',
  preparation: 'preparation_min',
  allergenes: 'allergenes',
  regimes: 'regimes',
  badge: 'badge',
  etiquettes: 'etiquettes',
  reference: 'reference',
  ref: 'reference',
};

function headerKey(header: string): MenuCsvColumn | null {
  return HEADER_ALIASES[normalizeText(header).replace(/[^a-z]/g, '')] ?? null;
}

function parseBool(value: string): boolean | null | 'invalid' {
  const v = normalizeText(value);
  if (!v) return null;
  if (['oui', 'o', 'yes', 'vrai', 'true', '1'].includes(v)) return true;
  if (['non', 'n', 'no', 'faux', 'false', '0'].includes(v)) return false;
  return 'invalid';
}

function parseInteger(value: string): number | null | 'invalid' {
  const v = value.trim();
  if (!v) return null;
  return /^\d+$/.test(v) ? Number(v) : 'invalid';
}

function parseList<T extends string>(value: string, map: Map<string, T>, label: string, errors: string[]): T[] {
  const out: T[] = [];
  for (const part of value.split(/[,;|]/)) {
    const key = normalizeText(part);
    if (!key) continue;
    const found = map.get(key);
    if (found) {
      if (!out.includes(found)) out.push(found);
    } else errors.push(`${label} inconnu : « ${part.trim()} »`);
  }
  return out;
}

export function parseMenuCsv(text: string): { lines: ParsedLine[]; missingColumns: MenuCsvColumn[] } {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const [header = [], ...body] = parsed.data;
  const columns = header.map(headerKey);
  const missingColumns = (['section', 'nom', 'prix'] as MenuCsvColumn[]).filter((c) => !columns.includes(c));
  if (missingColumns.length) return { lines: [], missingColumns };

  const lines = body.slice(0, MENU_LIMITS.importRows).map((cells, index): ParsedLine => {
    const errors: string[] = [];
    const get = (column: MenuCsvColumn): string | undefined => {
      const i = columns.indexOf(column);
      return i < 0 ? undefined : (cells[i] ?? '').trim();
    };
    const section = get('section') ?? '';
    const name = get('nom') ?? '';
    if (!section) errors.push('Section manquante');
    if (!name) errors.push('Nom manquant');
    const price = parseEuros(get('prix') ?? '');
    if (price === null) errors.push('Prix invalide');
    const row: MenuImportRow = { section, name, priceCents: price ?? 0 };

    const description = get('description');
    if (description !== undefined) row.description = description || null;
    const compare = get('prix_barre');
    if (compare !== undefined) {
      if (!compare) row.compareAtPriceCents = null;
      else {
        const cents = parseEuros(compare);
        if (cents === null) errors.push('Prix barré invalide');
        else row.compareAtPriceCents = cents;
      }
    }
    const vat = get('tva');
    if (vat) {
      const found = VAT_LOOKUP.get(normalizeText(vat));
      if (found === 'alcohol' || normalizeText(vat).includes('alcool')) errors.push('La vente d’alcool est interdite sur GoLink');
      else if (found) row.vatCategory = found as VatCategory;
      else errors.push(`Type de TVA inconnu : « ${vat} »`);
    }
    const available = get('disponible');
    if (available !== undefined) {
      const value = parseBool(available);
      if (value === 'invalid') errors.push('Disponibilité : indiquez oui ou non');
      else if (value !== null) row.available = value;
    }
    const numbers: Array<[MenuCsvColumn, 'stock' | 'lowStockThreshold' | 'preparationMinutes', string]> = [
      ['stock', 'stock', 'Stock'],
      ['seuil_alerte', 'lowStockThreshold', 'Seuil d’alerte'],
      ['preparation_min', 'preparationMinutes', 'Temps de préparation'],
    ];
    for (const [column, field, label] of numbers) {
      const raw = get(column);
      if (raw === undefined) continue;
      const value = parseInteger(raw);
      if (value === 'invalid') errors.push(`${label} : nombre entier attendu`);
      else if (field === 'stock' || value !== null) row[field] = value;
    }
    const allergens = get('allergenes');
    if (allergens) row.allergens = normalizeText(allergens) === 'aucun' ? [] : parseList<Allergen>(allergens, ALLERGEN_LOOKUP, 'Allergène', errors);
    const dietary = get('regimes');
    if (dietary !== undefined) row.dietary = parseList<MenuDietaryTag>(dietary, DIETARY_LOOKUP, 'Régime', errors);
    const badge = get('badge');
    if (badge !== undefined) {
      if (!badge) row.badge = null;
      else {
        const found = BADGE_LOOKUP.get(normalizeText(badge));
        if (found) row.badge = found as ProductBadge;
        else errors.push(`Badge inconnu : « ${badge} »`);
      }
    }
    const tags = get('etiquettes');
    if (tags !== undefined) row.tags = tags.split(/[,;|]/).map((t) => t.trim().slice(0, MENU_LIMITS.tagLength)).filter(Boolean).slice(0, MENU_LIMITS.tags);
    const reference = get('reference');
    if (reference !== undefined) row.externalId = reference || null;

    return { line: index + 2, row: errors.length ? null : row, errors };
  });
  return { lines, missingColumns };
}
