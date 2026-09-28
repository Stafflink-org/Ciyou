// Compilation des Cloud Functions en un seul fichier lib/index.js.
// Le paquet partagé @golink/shared (hors du dossier déployé) est intégré au
// bundle ; les dépendances npm restent externes et sont installées au déploiement.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: [fileURLToPath(new URL('./src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./lib/index.js', import.meta.url)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'warning',
  external: Object.keys(pkg.dependencies ?? {}),
  alias: { '@golink/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
});
