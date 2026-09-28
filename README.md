# Ciyou Eats

Plateforme de livraison (France, Luxembourg, Belgique, Algérie) : commande client, restaurants partenaires, livreurs suivis en temps réel.

## Applications

| Dossier | Application | Techno | Déploiement |
|---|---|---|---|
| `apps/client` | App mobile client | React Native (Expo) | EAS Build → App Store / Google Play |
| `apps/driver` | App mobile livreur | React Native (Expo) | EAS Build → App Store / Google Play |
| `apps/restaurant` | Back-office restaurant | React + Vite + TypeScript | Docker (Coolify, VPS OVH) |
| `apps/admin` | Back-office super admin | React + Vite + TypeScript | Docker (Coolify, VPS OVH) |
| `packages/shared` | Types, rôles, statuts, collections partagés | TypeScript | — |
| `packages/ui` | Kit d'interface des back-offices (design system) | React + Tailwind v4 | — |
| `packages/web` | Socle applicatif des back-offices : hooks Firestore, session, pages d'accès, modules | React + Firebase | — |
| `functions` | Cloud Functions (europe-west1) | Node 22 + TypeScript | `firebase deploy --only functions` |
| `firebase` | Règles Firestore / Storage, index | — | `npm run deploy:rules` |

Backend : Firebase projet `golink-9f16d` (Auth, Firestore `europe-west1`, Storage, Cloud Functions, FCM).

État réel du back-office super admin par rapport au cahier client (31 rubriques, 166 lignes) : voir `docs/AUDIT_COUVERTURE_CDC.md` (§3, recompté le 27/09/2026 : 101 COMPLET / 65 PARTIEL / 0 ABSENT / 0 FAUX) et `docs/ETAT_AVANCEMENT.md`.

## Fonctionnalités

**Back-office restaurant** (`apps/restaurant`) : accueil (ventes, service en direct), commandes en cours + fiche + historique + suivi livreur en direct, carte (produits, options, stocks, mise en avant), équipe & RH (employés, planning, pointages, absences, paie, tâches, documents, HACCP), finances & clients (finances, chiffre d'affaires, virements, factures, CRM clients, livreurs), configuration (établissement, horaires, zones, réglages commandes, paiements, notifications, utilisateurs, documents, versements, abonnement), marketing & messagerie (promotions, campagnes, fidélité, avis, réseaux sociaux, modèles, messages, support).

**Back-office super admin** (`apps/admin`) : pilotage (accueil, alertes, recherche globale ⌘K, analytics, rapports & exports), restaurants & clients (validation, qualité, groupes, import, fiches, CRM clients), livreurs & opérations (validation, flotte en direct, attribution, règles automatiques, zones/villes), argent (paiements, finance & reversements, facturation & TVA, abonnements & commissions), expérience & support (affichage app client, avis & notes, support & litiges), croissance (promotions, fidélité/parrainage, communication, annonces, prospection CRM), plateforme & sécurité (paramètres, multi-pays, fonctionnalités, connexions, administrateurs, double authentification, fraude, RGPD, santé/maintenance, sauvegardes).

## Comptes de test

Mots de passe uniquement dans `.test-accounts.local.md` (fichier local, jamais committé, régénéré par `npm run seed`).

| Rôle | E-mail |
|---|---|
| Super administratrice | `superadmin@golink.test` |
| Agent support | `support@golink.test` |
| Responsable finance | `finance@golink.test` |
| Commercial | `commercial@golink.test` |
| Responsable de ville (Metz) | `metz@golink.test` |
| Propriétaire (groupe Maison Haddad, 3 établissements) | `mina.haddad@golink.test` |
| Manager de Mina Kitchen | `sofia.martin@golink.test` |
| Employé cuisine de Mina Kitchen | `youssef.karim@golink.test` |

## Scripts utiles

```bash
npm run smoke -- <restaurant|admin> <email> [chemin] [largeur]   # capture d'écran authentifiée (puppeteer-core)
npm run simulate:orders                                          # commandes réelles simulées, livreur en mouvement
npm run seed                                                      # jeu de données de démonstration complet (destructeur : --reset)
npm run seed:check                                                # typecheck des scripts de seed
npm run deploy:rules                                              # règles + index + storage
npm run deploy:functions                                          # Cloud Functions
```

## Démarrage

```bash
npm install
npm run dev:restaurant   # http://localhost:5173
npm run dev:admin        # http://localhost:5174
npm run start:client     # Expo
npm run start:driver     # Expo
```

Les apps mobiles utilisent la géolocalisation en arrière-plan : elles tournent en **development build** (`npx expo run:android` / EAS), pas dans Expo Go.

## Back-offices : structure et modules

Chaque back-office (`apps/restaurant`, `apps/admin`) suit la même structure :

```
src/
  app/        App.tsx (providers), router.tsx, navigation.ts (groupes du menu), modules.ts (découverte)
  auth/       garde d'accès (établissement actif / administrateur), pages de connexion
  layout/     Shell (sidebar, barre supérieure, ⌘K) et éléments de la barre
  lib/        firebase.ts, firestore.ts (hooks et appels de fonctions), env.ts
  features/   un dossier par rubrique, chacun avec son module.tsx
```

**Ajouter une rubrique** : créer `src/features/<id>/module.tsx`, sans toucher au shell :

```tsx
import { ShoppingBag } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'commandes',                         // = nom du dossier
  nav: { group: 'commandes', label: 'Commandes', icon: <ShoppingBag />, order: 10, badge: usePendingCount },
  permission: 'orders.view',               // facultatif : masque le menu et protège les routes
  routes: [
    { path: 'commandes', lazy: () => import('./OrdersPage').then((m) => ({ Component: m.OrdersPage })) },
    { path: 'commandes/:orderId', lazy: () => import('./OrderPage').then((m) => ({ Component: m.OrderPage })) },
  ],
});
```

Le routeur, la sidebar (groupes de `app/navigation.ts`), le fil d'Ariane et la recherche ⌘K découvrent les modules via `import.meta.glob`. `badge` est un hook React (compteur du menu).

**Accès aux données** (`@/lib/firestore`) : `useDoc`, `useCollection`, `useDocs` (temps réel), `useInfiniteCollection` (« afficher plus »), `usePagedQuery` (pages par curseurs, total optionnel), `callFunction<Entrée, Sortie>('nom')` (Cloud Function europe-west1), `useMutation` (chargement, toasts, erreurs en français), `toDate`, `createdFields` / `updatedFields` (horodatage serveur exigé par les règles).

**Droits** : restaurant → `useRestaurantAccess()` / `useCan()` (membre `restaurants/{rid}/members/{uid}`, établissements des claims) ; admin → `useAdminAccess()` / `useCan()` (document `admins/{uid}`) et `useGeoScope()` (filtre pays / ville de la barre supérieure).

### Tests locaux avec les émulateurs

```bash
firebase emulators:start --only auth,firestore   # Java : si « Unable to establish loopback connection »,
                                                 # JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Windows/Temp
VITE_FIREBASE_EMULATORS=true npm run dev:restaurant
```

`VITE_FIREBASE_EMULATORS=true` branche Auth, Firestore, Functions et Storage sur les émulateurs (ports de `firebase.json`), avec les vraies règles de sécurité.

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

Les règles de sécurité s'écrivent par domaine dans `firebase/rules/` (Firestore) et `firebase/rules/storage/` (Storage). `npm run rules:build` génère `firebase/firestore.rules` et `firebase/storage.rules`, et le déploiement le relance automatiquement (predeploy).

## Documentation

- `docs/CONTRAT_MODULES.md` : contrat d’ajout d’une rubrique (front, Cloud Functions, règles, données partagées), conventions et procédure de test (`npm run smoke`).
- `docs/SCHEMA_FIRESTORE.md` : schéma complet de la base (collections, champs, index, droits, Cloud Functions).
- `docs/MODELE_ECONOMIQUE.md` : modèle économique, valeurs par défaut et formules du moteur de tarification (`packages/shared/src/pricing`, tests : `npm run test:shared`).
