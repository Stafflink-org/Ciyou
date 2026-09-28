# Ciyou Eats — Monorepo

Plateforme de livraison multi-commerces (France, Luxembourg, Belgique, Algérie).

## Structure

- `apps/admin` — back-office super admin (déployé en premier)
- `apps/restaurant` — back-office restaurant
- `apps/client` — application mobile client (React Native / Expo, en cours)
- `apps/driver` — application mobile livreur (à venir)
- `packages/shared`, `packages/ui`, `packages/web` — code partagé entre les apps web
- `functions` — Cloud Functions (Firebase)
- `firebase` — règles et index Firestore/Storage
- `docs` — documentation fonctionnelle et technique

## Démarrage

Voir `docs/CONTRAT_MODULES.md` pour la structure détaillée et les conventions.
