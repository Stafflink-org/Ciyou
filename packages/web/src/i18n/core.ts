// Moteur de traduction sans dépendance (même forme d'API qu'i18next : espaces de
// noms, clés à points, {{variables}}, suffixes de pluriel _one/_other). Le
// français est la langue de repli : une clé absente ailleurs affiche le français,
// une clé absente partout affiche la clé, jamais un écran cassé.
import { APP_LOCALES, isRtlLocale, type Locale } from '@golink/shared';

export type TranslationTree = { [key: string]: string | TranslationTree };
export type TranslateVars = Record<string, string | number | undefined> & { count?: number };

export const DEFAULT_LOCALE: Locale = 'fr';
export const DEFAULT_NAMESPACE = 'common';
export const SUPPORTED_LOCALES: readonly Locale[] = APP_LOCALES;

const resources = new Map<string, TranslationTree>(); // "langue/namespace" -> arbre
let currentLocale: Locale = DEFAULT_LOCALE;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function merge(target: TranslationTree, source: TranslationTree): TranslationTree {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (typeof value === 'object' && typeof existing === 'object') merge(existing, value);
    else target[key] = value;
  }
  return target;
}

/** Enregistre (ou complète) les traductions d'un espace de noms pour une langue. */
export function addResources(locale: Locale, namespace: string, tree: TranslationTree): void {
  const id = `${locale}/${namespace}`;
  resources.set(id, merge(resources.get(id) ?? {}, structuredClone(tree)));
  notify();
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocale(): Locale {
  return currentLocale;
}

/** `silent` : pose la langue sans prévenir les abonnés (appel pendant un rendu React). */
export function setCurrentLocale(locale: Locale, silent = false): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  if (!silent) notify();
}

/** Abonnement aux changements de langue ou de ressources (useSyncExternalStore). */
export function subscribeI18n(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Numéro de version incrémenté à chaque changement de langue ou de ressources. */
export function i18nVersion(): number {
  return version;
}

function lookup(locale: Locale, namespace: string, path: string): string | undefined {
  let node: string | TranslationTree | undefined = resources.get(`${locale}/${namespace}`);
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function resolve(locale: Locale, namespace: string, path: string, count?: number): string | undefined {
  if (count !== undefined) {
    const category = new Intl.PluralRules(locale).select(count);
    const plural = lookup(locale, namespace, `${path}_${category}`) ?? lookup(locale, namespace, `${path}_other`);
    if (plural !== undefined) return plural;
  }
  return lookup(locale, namespace, path);
}

/**
 * Traduit une clé « espace:chemin.de.la.cle » (espace par défaut : common).
 * Repli : langue demandée, puis français, puis la clé elle-même.
 */
export function translate(key: string, vars?: TranslateVars, locale: Locale = currentLocale, defaultNamespace = DEFAULT_NAMESPACE): string {
  const separator = key.indexOf(':');
  const namespace = separator > 0 ? key.slice(0, separator) : defaultNamespace;
  const path = separator > 0 ? key.slice(separator + 1) : key;
  const raw = resolve(locale, namespace, path, vars?.count) ?? resolve(DEFAULT_LOCALE, namespace, path, vars?.count) ?? path;
  if (!vars) return raw;
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** Vrai si la clé existe dans la langue demandée ou en français (sans repli sur la clé brute). */
export function hasTranslation(key: string, locale: Locale = currentLocale, defaultNamespace = DEFAULT_NAMESPACE): boolean {
  const separator = key.indexOf(':');
  const namespace = separator > 0 ? key.slice(0, separator) : defaultNamespace;
  const path = separator > 0 ? key.slice(separator + 1) : key;
  return lookup(locale, namespace, path) !== undefined || lookup(DEFAULT_LOCALE, namespace, path) !== undefined;
}

/** Étiquette BCP 47 pour Intl : chiffres latins en arabe (usage des marchés DZ, MA, TN). */
export function intlLocale(locale: Locale = currentLocale): string {
  if (locale === 'ar') return 'ar-u-nu-latn';
  if (locale === 'en') return 'en-GB';
  return 'fr-FR';
}

export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}

const STORAGE_KEY = 'golink:locale';

export function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Stockage indisponible : la préférence reste portée par le profil.
  }
}

/** Langue du navigateur parmi les langues prises en charge (« ar-DZ » donne « ar »). */
export function detectBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isSupportedLocale(base)) return base;
  }
  return null;
}
