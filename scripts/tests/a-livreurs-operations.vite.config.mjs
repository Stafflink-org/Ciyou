// Serveur de développement de test pour les rubriques d'exploitation : identique à la
// configuration du super admin, mais les pages encore absentes d'autres rubriques en
// cours de construction (travail parallèle) sont remplacées par une page vide, pour
// que l'application démarre. Usage (depuis apps/admin) :
//   npx vite --config ../../scripts/tests/a-livreurs-operations.vite.config.mjs --port 5403 --strictPort
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const adminRoot = fileURLToPath(new URL('../../apps/admin', import.meta.url));
const PREFIX = '\0ops-missing-page:';

function missingPages() {
  return {
    name: 'ops-missing-pages',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('./') || !importer.replace(/\\/g, '/').includes('/src/features/')) return null;
      const base = resolve(dirname(importer), source);
      if (['', '.ts', '.tsx'].some((ext) => existsSync(base + ext)) || existsSync(resolve(base, 'index.ts'))) return null;
      const name = source.split('/').pop();
      return /^[A-Z]\w*Page$/.test(name) ? PREFIX + name : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const name = id.slice(PREFIX.length);
      return `export function ${name}() { return null; }`;
    },
  };
}

export default defineConfig({
  root: adminRoot,
  plugins: [missingPages(), react(), tailwindcss()],
  cacheDir: resolve(adminRoot, 'node_modules/.vite-a-livreurs-ops'),
  envDir: resolve(adminRoot, '../..'),
  resolve: { alias: { '@': resolve(adminRoot, 'src') } },
});
