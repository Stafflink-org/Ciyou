// Moteur de traduction sans dépendance — même forme d'API que
// `packages/web/src/i18n/core.ts` et `apps/client/src/i18n/core.ts` (espaces
// de noms, clés à points, `{{variables}}`, suffixes de pluriel
// `_one`/`_other`). Voir `apps/client/src/i18n/core.ts` pour le détail des
// choix (RTL React Native via I18nManager, AsyncStorage).
import { APP_LOCALES, isRtlLocale, type Locale } from '@golink/shared';

export type TranslationTree = { [key: string]: string | TranslationTree };
export type TranslateVars = Record<string, string | number | undefined> & { count?: number };

export const DEFAULT_LOCALE: Locale = 'fr';
export const DEFAULT_NAMESPACE = 'common';
export const SUPPORTED_LOCALES: readonly Locale[] = APP_LOCALES;

const resources = new Map<string, TranslationTree>();
let currentLocale: Locale = DEFAULT_LOCALE;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function clone(tree: TranslationTree): TranslationTree {
  return JSON.parse(JSON.stringify(tree)) as TranslationTree;
}

function merge(target: TranslationTree, source: TranslationTree): TranslationTree {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (typeof value === 'object' && typeof existing === 'object') merge(existing, value);
    else target[key] = value;
  }
  return target;
}

export function addResources(locale: Locale, namespace: string, tree: TranslationTree): void {
  const id = `${locale}/${namespace}`;
  resources.set(id, merge(resources.get(id) ?? {}, clone(tree)));
  notify();
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setCurrentLocale(locale: Locale, silent = false): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  if (!silent) notify();
}

export function subscribeI18n(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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

export function hasTranslation(key: string, locale: Locale = currentLocale, defaultNamespace = DEFAULT_NAMESPACE): boolean {
  const separator = key.indexOf(':');
  const namespace = separator > 0 ? key.slice(0, separator) : defaultNamespace;
  const path = separator > 0 ? key.slice(separator + 1) : key;
  return lookup(locale, namespace, path) !== undefined || lookup(DEFAULT_LOCALE, namespace, path) !== undefined;
}

export function intlLocale(locale: Locale = currentLocale): string {
  if (locale === 'ar') return 'ar-u-nu-latn';
  if (locale === 'en') return 'en-GB';
  return 'fr-FR';
}

export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}
