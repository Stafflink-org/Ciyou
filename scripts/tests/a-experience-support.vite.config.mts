// Serveur de développement du module Expérience client et support (tests en parallèle d'autres chantiers) :
// configuration de l'app admin, plus un module neutre pour les imports relatifs encore
// absents des autres rubriques en cours d'écriture (leurs pages restent inaccessibles,
// le reste de l'application démarre). Les noms importés sont exportés comme fonctions
// renvoyant null (hooks de pastille, composants).
// Usage (dans apps/admin) : npx vite --config ../../scripts/tests/a-experience-support.vite.config.mts --port 5405 --strictPort
import { readFileSync } from 'node:fs';
import { mergeConfig, type Plugin } from 'vite';
import base from '../../apps/admin/vite.config.ts';

const MINE = /features[\\/](affichage|avis|support|_experience)[\\/]/;
const STUB = '\0a-experience-support-stub';

function importedNames(importer: string, source: string): string[] {
  let code = '';
  try {
    code = readFileSync(importer.split('?')[0]!, 'utf8');
  } catch {
    return [];
  }
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = new Set<string>();
  for (const match of code.matchAll(new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g'))) {
    for (const part of match[1]!.split(',')) {
      const name = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0]!.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

const stubMissing: Plugin = {
  name: 'a-experience-support-stub-missing',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer || !source.startsWith('.') || MINE.test(importer) || !/[\\/]features[\\/]/.test(importer)) return null;
    const resolved = await this.resolve(source, importer, { skipSelf: true });
    if (resolved) return null;
    return `${STUB}?names=${importedNames(importer, source).join(',')}`;
  },
  load(id) {
    if (!id.startsWith(STUB)) return null;
    const names = (new URLSearchParams(id.split('?')[1] ?? '').get('names') ?? '').split(',').filter(Boolean);
    return names.map((name) => `export const ${name} = () => null;`).join('\n') || 'export {};';
  },
};

// Pastilles des autres rubriques en cours d'écriture neutralisées (une pastille qui
// lève une erreur ferait tomber toute la navigation pendant les tests).
const OTHER_MODULE = /features[\/](?!affichage|avis|support)[^\/]+[\/]module\.tsx$/;
const noForeignBadges: Plugin = {
  name: 'a-experience-support-no-foreign-badges',
  enforce: 'pre',
  transform(code, id) {
    if (!OTHER_MODULE.test(id.split('?')[0]!)) return null;
    return code.replace(/^\s*badge:\s*[A-Za-z0-9_]+,\s*$/m, '');
  },
};

export default mergeConfig(base, { plugins: [stubMissing, noForeignBadges] });
