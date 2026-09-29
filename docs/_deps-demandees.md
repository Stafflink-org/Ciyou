# Dépendances demandées

## Lot i18n FR/EN/AR

- `i18next` et `react-i18next` : absents de tous les package.json et de node_modules. Non installés (règle : pas de npm install).
  Le socle (`packages/web/src/i18n`) est donc écrit sans dépendance, avec la même forme d'API (`useTranslation`, `t('ns:cle')`, `{{variable}}`, suffixes de pluriel `_one`/`_other`, fichiers JSON par namespace).
  Migration ultérieure vers i18next possible sans toucher aux écrans : seul `packages/web/src/i18n/core.ts` et `I18nProvider.tsx` sont à remplacer.

## App livreur (apps/driver) — lot 1 fondations

- Alignement de `apps/driver/package.json` sur `apps/client/package.json` (mêmes dépendances : navigation, firebase, async-storage, gesture-handler, safe-area-context, screens, react-native-web) — nécessaire pour reprendre les mêmes patterns (auth, hooks Firestore, design system) que l'app client. `npm install` exécuté à la racine du monorepo pour matérialiser ces dépendances dans `apps/driver/node_modules`/le lockfile racine.

## App livreur (apps/driver) — lot 2 course active

- `react-native-webview` (13.16.0) ajouté à `apps/driver/package.json` : nécessaire pour la carte/itinéraire réel (Google Maps Embed Directions, cartographie non modélisée en RN pur). `npm install --workspace=@golink/driver` exécuté à la racine. Sur web (Expo web), le composant équivalent (`RouteMap.web.tsx`) utilise un `<iframe>` natif au lieu de la WebView (react-native-webview ne supporte pas la cible web) : les deux partagent la même URL Google Maps Embed.

## App livreur (apps/driver) — lot 3 réglages profil

- `expo-document-picker` (`~57.0.3`, installé via `npx expo install expo-document-picker` pour la version compatible SDK 57) ajouté à `apps/driver/package.json` : nécessaire pour choisir un fichier (justificatif) depuis l'app — fonctionne aussi bien en natif qu'en web (Expo web), une seule implémentation au lieu d'un split `.web.tsx`/`.tsx`.

## App client (apps/client) — lot 3 suivi/profil

- `react-native-webview` (13.16.0) ajouté à `apps/client/package.json`, même besoin que le lot 2 livreur (`features/tracking/RouteMap.tsx`, carte de suivi client). `npm install --workspace=@golink/client` exécuté à la racine.
