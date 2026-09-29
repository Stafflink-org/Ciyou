// Socle i18n minimal de l'app client — FR uniquement pour ce lot.
//
// Choix documenté (voir docs/CONTRAT_MODULES.md et docs/_deps-demandees.md) :
// `packages/web/src/i18n` (back-offices, FR/EN/AR + RTL) n'est pas réutilisable
// tel quel ici, pour deux raisons distinctes du problème Tailwind de
// `packages/ui` :
//  1. Ce paquet fait partie de `@golink/web`, qui exporte aussi des écrans DOM
//     (`<div>`, react-router) que Metro ne peut pas empaqueter pour React Native
//     — comme pour `lib/firestore.ts`, on ne peut pas importer le paquet entier.
//  2. Le RTL du web repose sur `dir="rtl"` (CSS) ; React Native le gère
//     autrement, via `I18nManager.forceRTL()` (redémarrage de l'app requise).
//     Câbler l'arabe correctement (lots suivants) mérite sa propre passe RTL
//     plutôt qu'une copie hâtive du mécanisme web.
//
// Ce module reprend néanmoins la même forme d'API qu'i18next et que le socle
// web (espaces de noms, clés à points, `{{variable}}`, suffixes de pluriel
// `_one`/`_other`) : un futur passage à i18next ou l'ajout de EN/AR ne touchera
// que ce fichier et `I18nProvider.tsx`, jamais les écrans.
import { fr } from './fr/common';

export type TranslationTree = { [key: string]: string | TranslationTree };
export type TranslateVars = Record<string, string | number | undefined> & { count?: number };

const NAMESPACE = 'common';
const resources: Record<string, TranslationTree> = { [NAMESPACE]: fr };

function lookup(path: string): string | undefined {
  const [namespace, ...rest] = path.includes(':') ? path.split(':') : [NAMESPACE, path];
  let node: string | TranslationTree | undefined = resources[namespace];
  for (const part of (rest.length ? rest.join(':') : path).split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/** Traduit une clé (`namespace:a.b.c` ou `a.b.c`) ; clé absente → la clé elle-même (jamais un écran cassé). */
export function translate(path: string, vars?: TranslateVars): string {
  const key = vars?.count !== undefined ? `${path}_${new Intl.PluralRules('fr').select(vars.count)}` : path;
  const found = lookup(key) ?? (vars?.count !== undefined ? lookup(`${path}_other`) : undefined) ?? lookup(path);
  return found ? interpolate(found, vars) : path;
}

export function hasTranslation(path: string): boolean {
  return lookup(path) !== undefined;
}
