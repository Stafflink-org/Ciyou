# Dépendances demandées

## Lot i18n FR/EN/AR

- `i18next` et `react-i18next` : absents de tous les package.json et de node_modules. Non installés (règle : pas de npm install).
  Le socle (`packages/web/src/i18n`) est donc écrit sans dépendance, avec la même forme d'API (`useTranslation`, `t('ns:cle')`, `{{variable}}`, suffixes de pluriel `_one`/`_other`, fichiers JSON par namespace).
  Migration ultérieure vers i18next possible sans toucher aux écrans : seul `packages/web/src/i18n/core.ts` et `I18nProvider.tsx` sont à remplacer.
