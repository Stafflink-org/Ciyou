import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Cache de pré-bundle isolable (plusieurs serveurs de dev en parallèle).
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  // Variables VITE_* lues depuis le .env.local à la racine du dépôt.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Le SDK Firebase (~570 kB) est isolé dans son propre fichier, mis en cache entre deux versions.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        // Bibliothèques isolées dans des fichiers stables : mises en cache entre deux mises en ligne.
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
