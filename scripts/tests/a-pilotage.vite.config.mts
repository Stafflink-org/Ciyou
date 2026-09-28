// Serveur de développement du module Pilotage (tests en parallèle d'autres chantiers) :
// configuration de l'app admin, plus un module neutre pour les imports relatifs encore
// absents des autres rubriques en cours d'écriture (leurs pages restent inaccessibles,
// le reste de l'application démarre). Les noms importés sont exportés comme fonctions
// renvoyant null (hooks de pastille, composants).
// Usage (dans apps/admin) : npx vite --config ../../scripts/tests/a-pilotage.vite.config.mts --port 5401 --strictPort
import { readFileSync } from 'node:fs';
import { mergeConfig, type Plugin } from 'vite';
import base from '../../apps/admin/vite.config.ts';

const MINE = /features[\\/](accueil|alertes|analytics|rapports|recherche|pilotage-commun)[\\/]/;
const STUB = '\0a-pilotage-stub';

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
  name: 'a-pilotage-stub-missing',
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

export default mergeConfig(base, { plugins: [stubMissing] });
