# GoLink

Plateforme de livraison (France, Luxembourg) : commande client, restaurants partenaires, livreurs suivis en temps réel.

## Applications

| Dossier | Application | Techno | Déploiement |
|---|---|---|---|
| `apps/client` | App mobile client | React Native (Expo) | EAS Build → App Store / Google Play |
| `apps/driver` | App mobile livreur | React Native (Expo) | EAS Build → App Store / Google Play |
| `apps/restaurant` | Back-office restaurant | React + Vite + TypeScript | Docker (Coolify, VPS OVH) |
| `apps/admin` | Back-office super admin | React + Vite + TypeScript | Docker (Coolify, VPS OVH) |
| `packages/shared` | Types, rôles, statuts, collections partagés | TypeScript | — |
| `functions` | Cloud Functions (europe-west1) | Node 22 + TypeScript | `firebase deploy --only functions` |
| `firebase` | Règles Firestore / Storage, index | — | `npm run deploy:rules` |

Backend : Firebase projet `golink-9f16d` (Auth, Firestore `europe-west1`, Storage, Cloud Functions, FCM).

## Démarrage

```bash
npm install
npm run dev:restaurant   # http://localhost:5173
npm run dev:admin        # http://localhost:5174
npm run start:client     # Expo
npm run start:driver     # Expo
```

Les apps mobiles utilisent la géolocalisation en arrière-plan : elles tournent en **development build** (`npx expo run:android` / EAS), pas dans Expo Go.

## Déploiement des back-offices (Coolify)

Une application Coolify par back-office, branche `main`, auto-deploy :

- Build pack : **Dockerfile**
- Base directory : `/` (racine du dépôt)
- Dockerfile : `apps/restaurant/Dockerfile` ou `apps/admin/Dockerfile`
- Port exposé : `80`

## Firebase

```bash
npm run deploy:rules       # règles Firestore + Storage + index
npm run deploy:functions   # compile puis déploie les Cloud Functions
```

Les rôles (`client`, `driver`, `restaurant`, `admin`) sont portés par les custom claims Firebase Auth et posés uniquement par les Cloud Functions.
