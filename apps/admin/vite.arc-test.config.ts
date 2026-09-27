// Configuration de test locale : ne charge que les rubriques testées (les autres
// rubriques, en cours de développement en parallèle, peuvent être incomplètes).
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from './vite.config';

const onlyTestedModules: Plugin = {
  name: 'only-tested-modules',
  enforce: 'pre',
  transform(code, id) {
    if (!id.split('\\').join('/').endsWith('/src/app/modules.ts')) return null;
    return code.replace("'../features/*/module.tsx'", "'../features/{accueil,restaurants,clients}/module.tsx'");
  },
};

export default mergeConfig(base, defineConfig({ plugins: [onlyTestedModules] }));
