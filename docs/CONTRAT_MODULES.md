# Contrat des modules Ciyou Eats

> **IMPORTANT — Décisions du client : lis `docs/DECISIONS_CLIENT.md` AVANT tout travail.** Elles priment sur toute hypothèse : commission sur les articles TTC hors livraison et pourboires, remboursements toujours payés par le commerce, frais bancaires déduits du reversement, espèces seulement avec un livreur salarié du commerce, **alcool interdit**, rémunération livreur fixe sous 2 km puis au km (par ville), acceptation en 5 min puis annulation + pause auto, client absent 10 min sans remboursement, validation commerce automatique / livreurs manuelle, lancement ville par ville, tous types de commerces, formules à 0 mais entièrement paramétrables. **Tout chiffre est un paramètre du super admin.**

Ce document fixe la façon d'ajouter une rubrique aux back-offices (restaurant et super admin) et ce qu'elle implique côté données, Cloud Functions et règles de sécurité. Toute nouvelle rubrique le respecte. En cas de doute, le code du socle cité ici fait foi.

Documents liés :

- `docs/SCHEMA_FIRESTORE.md` : collections, champs, droits, Cloud Functions prévues, correspondance avec les 31 rubriques du cahier super admin.
- `docs/DESIGN_SYSTEM.md` : thèmes, jetons, composants du kit `@golink/ui`.
- `docs/MODELE_ECONOMIQUE.md` : formules et valeurs par défaut du moteur de tarification.

---

## 1. Vue d'ensemble

Une rubrique (ex. « Commandes » côté restaurant) touche jusqu'à quatre couches, toujours dans cet ordre :

| Ordre | Couche | Emplacement | Rôle |
|---|---|---|---|
| 1 | Partagé | `packages/shared/src` | Types des documents, noms de collections, enums et libellés, permissions, calculs |
| 2 | Règles | `firebase/rules/*.rules` (+ `storage/`) | Qui lit, qui écrit quels champs |
| 3 | Fonctions | `functions/src/<domaine>/` | Écritures sensibles, calculs d'argent, statuts, e-mails, audit |
| 4 | Front | `apps/<app>/src/features/<id>/` | Écrans, hooks de lecture, appels de fonctions |

Paquets du front :

| Paquet | Contenu | Import |
|---|---|---|
| `@golink/shared` | Types, `COLLECTIONS`, `SUBCOLLECTIONS`, `paths`, `STORAGE_PATHS`, enums, libellés, permissions, tarification, formats | `@golink/shared` |
| `@golink/ui` | Kit d'interface (Tailwind v4 + Radix) | `@golink/ui` |
| `@golink/web` | Session, hooks Firestore, modules, écrans d'accès | via `@/lib/firestore` dans les apps (sauf `useAuth`, `Can`, `usePersistentState`, `useDocumentTitle`) |

---

## 2. Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Dossier de rubrique | `src/features/<id>/`, `id` en français, minuscules, tirets | `features/commandes`, `features/points-de-vente` |
| Module | `src/features/<id>/module.tsx`, `export default defineModule({...})`, `id` = nom du dossier | — |
| Pages | `PascalCase` + `Page`, un fichier par page, export nommé | `OrdersPage.tsx` → `export function OrdersPage()` |
| Composants locaux | dans le dossier de la rubrique (`components/` si plusieurs) | `features/commandes/components/OrderCard.tsx` |
| Hooks locaux | `use…`, fichier `hooks.ts` ou `use-….ts` dans la rubrique | `usePendingOrdersCount` |
| URL | français, minuscules, tirets, sans accents | `commandes`, `commandes/:orderId`, `equipe/planning` |
| Collections Firestore | anglais, camelCase, **uniquement via `COLLECTIONS` / `SUBCOLLECTIONS` / `paths`** | `COLLECTIONS.orders`, `paths.restaurantSub(rid, 'products')` |
| Champs | anglais, camelCase ; montants `…Cents` (entiers), taux `…Bps` (1 000 = 10 %) ; dates calendaires `AAAA-MM-JJ`, heures `HH:MM` | `subtotalCents`, `commissionBps` |
| Enums stockés | anglais, snake_case, dans `constants/enums.ts` ; libellé français dans `constants/labels.ts` | `ready_for_pickup` → « Prête » |
| Permissions | `<domaine>.<action>`, dans `permissions/restaurant.ts` ou `permissions/admin.ts` | `orders.manage`, `refunds.approve` |
| Cloud Functions | anglais, camelCase, verbe d'abord ; triggers `on<Entité><Événement>` | `advanceOrder`, `onOrderWrite` |
| Actions d'audit | `<entité>.<événement_passé>` | `restaurant.suspended`, `refund.approved` |
| Clés `localStorage` | `golink:<app>:<sujet>` | `golink:restaurant:<uid>` |

Textes : 100 % français, marque « Ciyou Eats », formats `fr-FR`, devise EUR. Commentaires en français, sobres. Pas de code mort, pas de `any` hors typage de colonnes de tableau, TypeScript strict.

---

## 3. Front : ajouter une rubrique

### 3.1 Déclaration

```tsx
// apps/restaurant/src/features/commandes/module.tsx
import { ShoppingBag } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { usePendingOrdersCount } from './hooks';

export default defineModule({
  id: 'commandes',
  nav: {
    group: 'commandes',          // groupe déclaré dans app/navigation.ts
    label: 'Commandes',
    icon: <ShoppingBag />,       // lucide-react
    order: 10,                   // position croissante dans le groupe
    badge: usePendingOrdersCount, // hook React, facultatif
    keywords: ['service', 'tickets'], // recherche ⌘K, facultatif
  },
  permission: 'orders.view',     // masque le menu et protège toutes les routes du module
  routes: [
    { path: 'commandes', lazy: () => import('./OrdersPage').then((m) => ({ Component: m.OrdersPage })) },
    { path: 'commandes/:orderId', lazy: () => import('./OrderPage').then((m) => ({ Component: m.OrderPage })) },
  ],
});
```

Rien d'autre à modifier : le routeur, la sidebar, le fil d'Ariane et la palette ⌘K découvrent les modules par `import.meta.glob('../features/*/module.tsx')`. L'application refuse de démarrer si l'export par défaut manque, si `id` ≠ dossier, si un `id` est en double, si le groupe est inconnu ou si `routes` est vide.

Contrat exact (`packages/web/src/modules/modules.tsx`) :

```ts
interface ModuleNav<G> {
  group: G; label: string; icon: ReactNode; order: number;
  badge?: () => number | string | null | undefined; // hook, appelé à chaque rendu, ordre fixe
  href?: string;                                     // défaut : chemin de la première route
  keywords?: string[];
  hidden?: boolean;   // absent de la sidebar, présent dans ⌘K/fil d'Ariane/route directe (hubs)
}
interface AppModule<G, P> { id: string; nav: ModuleNav<G>; routes: RouteObject[]; permission?: P }
```

Règles :

- Routes relatives à la racine (`'commandes'`, pas `'/commandes'`), `{ index: true }` réservé à l'accueil. Toujours `lazy`.
- Une rubrique = un module. Les sous-pages (onglets, détail) sont des routes du même module.
- `badge` doit être un hook léger (une requête `count` ou un `useCollection` limité) et renvoyer `0`/`null` pour masquer la pastille. Il est appelé pour tous les modules, même masqués : il ne doit pas lever d'erreur si l'utilisateur n'a pas la permission (renvoyer `null`, via `useCan()`).
- Les droits plus fins qu'une rubrique se testent dans la page : `const can = useCan(); can('orders.cancel')`, ou `<Can permission="finance.view">…</Can>`. Exemple : le rôle cuisine a `dashboard.view` mais pas `finance.view` ; un indicateur de chiffre d'affaires sur l'accueil doit donc être conditionné.

Groupes disponibles (`app/navigation.ts`) :

- Restaurant : `pilotage`, `commandes`, `carte`, `clients`, `equipe`, `finances`, `marketing`, `messagerie`, `configuration`.
- Super admin : `pilotage`, `acteurs`, `operations`, `argent`, `croissance`, `plateforme`.

Ajouter un groupe reste exceptionnel et se fait uniquement dans `app/navigation.ts`.

### 3.1 bis Regrouper des rubriques dans un hub (`nav.hidden`)

Un hub (Paiement, Marketing, Paramètres) est une page normale (son propre `features/<id>/module.tsx`)
qui **affiche les rubriques existantes sans dupliquer leur code** : onglets (Paiement) ou cartes
(Marketing), chacun rendant le composant déjà exporté par la rubrique agrégée. Les rubriques
agrégées passent `nav.hidden: true` : elles disparaissent de la sidebar mais restent inchangées
partout ailleurs — palette ⌘K, fil d'Ariane, permission, et surtout leur **route directe**
(`/finances`, `/virements/:payoutId`…), qui continue de fonctionner pour les liens déjà partagés et
les favoris (elles s'affichent alors seules, avec leur propre en-tête).

Pour un onglet intégré dans un hub (Paiement), qui ne doit pas répéter son propre `PageHeader` /
`PageContainer` à côté de celui du hub, envelopper le rendu des onglets dans `<HubEmbedProvider>`
(`@golink/ui`) : `PageHeader` et `PageContainer` deviennent alors des passe-plats (seuls `actions`
et le contenu de `PageHeader` restent affichés). Rien ne change hors de ce contexte.

Hubs actuels de `apps/restaurant` (plan V2 §3, lot D) :

| Hub | Route | Présentation | Rubriques agrégées (`nav.hidden: true`) |
|---|---|---|---|
| Paiement | `/paiement` (onglet actif : `?onglet=`) | onglets (`HubEmbedProvider`) | `finances`, `chiffre-affaires`, `virements`, `factures`, `versements`, `abonnement` ; nouvel onglet `commissions` (`features/paiement/CommissionsTab.tsx`, lecture `order.restaurantSettlement`, aucun taux figé dans le code) |
| Marketing | `/marketing` | cartes (navigation classique) | `promotions`, `campagnes`, `fidelite`, `populaires`, `avis`, `reseaux-sociaux`, `modeles`, `annonces` |
| Paramètres (déjà existant) | `/parametres` | tuiles regroupées en 4 sections (Établissement, Service, Encaissement, Préférences) | `etablissement`, `utilisateurs`, `documents`, `reglages-commandes`, `horaires`, `zones`, `paiements`, `notifications` |
| Assistance (groupe `messagerie`, pas de page hub) | — | 2 entrées de menu inchangées | aucune (`messages` et `support` restent visibles, avec leurs pastilles) |

Les groupes de sidebar `finances` et `messagerie` gardent leurs identifiants (modules déjà groupés
dessus) ; seuls leurs libellés changent (`nav:groups.*` dans `i18n/<locale>/nav.json`) : Finances →
« Paiement », Messagerie → « Assistance ».

### 3.2 Contexte disponible dans une page

Restaurant (`@/auth/RestaurantAccess`) :

| Hook | Renvoie |
|---|---|
| `useRestaurantAccess()` | `restaurants`, `roles`, `restaurantId`, `restaurant`, `member`, `setRestaurantId`, `can` |
| `useActiveRestaurant()` | l'établissement actif (`WithId<Restaurant>`) |
| `useCan()` | `(permission: RestaurantPermission) => boolean` |
| `useAppColorMode()` (`@/app/color-mode`) | mode clair / sombre |

Toute requête d'une page restaurant est filtrée par `restaurantId` (sous-collection `restaurants/{rid}/…` ou champ `restaurantId`). Changer d'établissement doit suffire à recharger la page : dépendre de `restaurantId`, jamais d'un identifiant mémorisé.

Super admin (`@/auth/AdminAccess`, `@/layout/GeoScope`) :

| Hook | Renvoie |
|---|---|
| `useAdminAccess()` | `admin` (document `admins/{uid}`), `can` |
| `useCan()` | `(permission: AdminPermission) => boolean` |
| `useGeoScope()` | `countryId`, `cityId`, `cityIds`, `global`, `label`, `countries`, `cities`, `setScope` |

Toute liste admin respecte le filtre pays / ville : `where('cityId', 'in', cityIds)` quand `global` est faux (au plus 30 valeurs par `in`), sinon `where('countryId', '==', countryId)` si un pays est choisi. Un responsable de ville ne voit que ses villes ; les règles le vérifient aussi (`isAdminIn`).

Communs (`@golink/web`) : `useAuth()` (`status`, `user`, `claims`, `signIn`, `signOut`, `sendPasswordReset`, `refreshClaims`), `useCurrentUser()`, `<Can>`, `usePermissionCheck()`, `usePersistentState(key, défaut)`, `useDocumentTitle(titre)`.

Titre d'onglet : `useDocumentTitle('Commandes · Ciyou Eats Restaurant')` (ou `· Ciyou Eats Admin`).

### 3.3 Lire et écrire les données (`@/lib/firestore`)

| Besoin | Outil |
|---|---|
| Un document en temps réel | `useDoc<T>(docAt(paths.restaurant(rid)))` → `{ data, loading, error, missing }` (`ref` null : pas d’abonnement) |
| Une liste en temps réel (courte, bornée par `limit`) | `useCollection<T>(query(...))` → `{ data, loading, error }` |
| Plusieurs documents connus | `useDocs<T>(refs)` |
| Liste longue en temps réel, « Afficher plus » | `useInfiniteCollection<T>(query(..., orderBy(...)), { pageSize })` |
| Grand tableau, pages précédente / suivante, total | `usePagedQuery<T>(query, { pageSize, withTotal })` (lecture ponctuelle) |
| Écriture simple autorisée par les règles | `updateDoc` / `setDoc` + `createdFields(uid)` / `updatedFields(uid)` dans un `useMutation` |
| Écriture sensible | `callFunction<Entrée, Sortie>('nomDeLaFonction')` dans un `useMutation` |
| Dates | `toDate`, `toMillis`, `toTimestamp` |
| Références | `docAt(chemin)`, `collectionAt(chemin)`, chemins par `paths` / `COLLECTIONS` |

Points à respecter :

- La requête peut être reconstruite à chaque rendu : les hooks la comparent (`queryEqual`) et ne se réabonnent que si elle change. `null` suspend la lecture (utile tant qu'un filtre manque).
- `createdFields` / `updatedFields` posent `serverTimestamp()` : les règles vérifient `createdAt == request.time`. Ne jamais écrire une date client à la place.
- Toute requête composite doit avoir son index dans `firebase/firestore.indexes.json` (voir § 5).
- `useMutation(action, { success: 'Commande acceptée' })` gère chargement, toast de succès et toast d'erreur en français ; `mutate` renvoie `undefined` en cas d'échec.
- Les messages d'erreur viennent de `errorMessage(error)` : ne pas afficher `error.message` brut.

```tsx
const advanceOrder = callFunction<{ orderId: string; to: OrderStatus }, void>('advanceOrder');

export function AcceptButton({ orderId }: { orderId: string }) {
  const { mutate, loading } = useMutation(advanceOrder, { success: 'Commande acceptée' });
  return <Button loading={loading} onClick={() => void mutate({ orderId, to: 'accepted' })}>Accepter</Button>;
}
```

La fonction appelée doit exister et être déployée ; sinon, afficher l'action désactivée avec une info-bulle plutôt qu'un bouton qui échoue.

### 3.4 Interface (`@golink/ui`)

Squelette d'une page :

```tsx
<PageContainer>
  <PageHeader eyebrow="Service" title="Commandes" description="…" actions={<Button>…</Button>} />
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{/* StatCard */}</div>
  <Section title="En cours">{/* DataTable, Card… */}</Section>
</PageContainer>
```

| Besoin | Composants |
|---|---|
| Structure | `PageContainer`, `PageHeader`, `Section`, `Card`, `Breadcrumbs` |
| Actions | `Button` (variantes, `loading`), `IconButton`, menus déroulants |
| Formulaires | `FormField`, `Label`, `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Switch`, `RadioGroup`, `Slider`, `DatePicker`, `DateRangePicker`, `TimeInput`, `FileUpload` (react-hook-form + zod recommandés) |
| Listes | `DataTable` (tri, recherche, `filters`, `bulkActions`, pagination, `loading`, état vide), `createColumnHelper` |
| Indicateurs | `StatCard`, `Badge`, `StatusPill`, `StatusBadge`, `ProgressBar`, `Avatar`, `Timeline`, `Stepper` |
| Graphiques | `AreaChart`, `BarChart`, `DonutChart`, `Sparkline`, `ChartLegend` |
| Surcouches | `Dialog`, `Sheet` (détail d'une ligne), `ConfirmDialog` (avec `requireReason` pour toute action auditée), `Popover`, `Tooltip`, `toast` |
| États | `EmptyState`, `Skeleton`, `Spinner` |
| Carte | `MapContainer`, `MapPin` (clé `VITE_GOOGLE_MAPS_API_KEY`) |
| Formats | `formatEUR(cents)`, `formatNumber`, `formatPercent`, dates, `formatRelative` |

Règles d'interface :

- Uniquement les jetons sémantiques (`bg-surface`, `text-fg-muted`, `border-border`, `primary`, `tone-*`…). Aucune couleur hexadécimale ni couleur Tailwind par défaut (elles sont retirées).
- Chaque liste a trois états soignés : chargement (`Skeleton` ou `loading`), vide (`EmptyState` avec action), erreur (message `errorMessage`).
- Toute action destructive ou sensible passe par `ConfirmDialog` ; si elle est auditée, `requireReason` et le motif est transmis à la fonction.
- Montants toujours stockés en centimes et affichés par `formatEUR`. Statuts affichés par `StatusBadge` / libellés de `@golink/shared`, jamais la valeur brute.
- Responsive obligatoire : aucun défilement horizontal de la page à 390 px (les tableaux défilent dans leur conteneur). Vérifier les trois thèmes : admin, restaurant clair, restaurant sombre.
- Vitrine des composants : `npm run dev:admin` puis http://localhost:5174/_ui (`?theme=admin`, `restaurant`, `restaurant-dark`).

---

## 4. Données partagées (`packages/shared`)

Avant d'écrire un écran, vérifier que le type existe dans `src/models/<domaine>.ts` (14 domaines, décrits dans `SCHEMA_FIRESTORE.md`). Sinon :

1. Ajouter ou compléter l'interface dans `models/<domaine>.ts` (documents tracés : étendre `Tracked` de `models/common.ts`).
2. Nouvelle collection : l'ajouter à `COLLECTIONS` ou `SUBCOLLECTIONS` (`constants/collections.ts`), et un helper dans `paths` si le chemin est composé.
3. Nouvel enum : `constants/enums.ts` + libellés dans `constants/labels.ts`.
4. Nouvelle permission : `permissions/restaurant.ts` ou `permissions/admin.ts`, puis l'ajouter aux rôles par défaut concernés.
5. Calcul d'argent : uniquement dans `pricing/` (centimes entiers, `bps`), avec un test dans `packages/shared/test/`.
6. Mettre à jour `docs/SCHEMA_FIRESTORE.md`.

Le paquet est consommé par les apps (sources TypeScript) et intégré au bundle des fonctions par esbuild : pas de dépendance navigateur ni Node spécifique dans `shared`.

---

## 5. Règles de sécurité et index (`firebase/`)

- Les règles s'écrivent dans `firebase/rules/<domaine>.rules` (Firestore) et `firebase/rules/storage/*.rules`. Les fichiers `firebase/firestore.rules` et `firebase/storage.rules` sont **générés** (`npm run rules:build`), ne jamais les modifier à la main.
- Tout chemin non décrit est refusé. Chaque nouvelle collection doit avoir son bloc `match`.
- Helpers disponibles (`_helpers.rules`) : `signedIn()`, `uid()`, `isRole(r)`, `isSelf(id)`, `isAnyAdmin()`, `isAdmin(perm)`, `isAdminIn(perm, cityId)`, `isRestaurantMember(rid)`, `can(rid, perm)`, `incoming()`, `existing()`, `changedKeys()`, `onlyChanges([...])`, `keepsUnchanged([...])`, `createdNow()`, `updatedNow()`, `isNonEmptyString(v, max)`, `isOptionalString(v, max)`, `isCents(v)`, `isIsoDay(v)`, `isHourMinute(v)`.
- Les permissions sont relues dans Firestore (`restaurants/{rid}/members/{uid}.permissions`, `admins/{uid}.permissions`), pas dans les claims : un retrait de droit est immédiat.
- Écritures client autorisées seulement sur des champs listés (`onlyChanges`) ; statuts, montants, rôles, validations, compteurs, audit : `allow write: if false` et passage par une fonction.
- **Aucune écriture directe d'un administrateur sur les réglages, les droits ou l'argent** : `settings`, `featureFlags` (dont le verrou `alcohol_sales`), `adminRoles`, `plans`, `commissionRules`, `countries`, `cities`, `zones`, `surgeRules`, `integrations`, `appVersions`, `incidents`, `platformAlerts`, `securityAlerts`, `scheduledReports`, `promotions` (côté équipe), `messageTemplates`, `sponsoredOffers`, `fraudCases`, `blocklist`, `restaurants` et leur carte (côté équipe) sont en `allow write: if false` pour le client : tout passe par une fonction appelable avec **motif**, historique (`settingsHistory`) et **audit**. Une nouvelle collection de ce type suit la même règle.
- Données personnelles : `driverPrivate` (identité légale, adresse, coordonnées bancaires) n'est lisible que par le livreur lui-même et par les rôles disposant de la permission `personal_data.view` (source unique du masquage ; le champ `maskPersonalData` d'un rôle en est déduit par `updateAdminRoleDefinition`).
- Suppression : `allow delete: if false` pour les comptes et documents financiers ; les autres documents passent par la corbeille (`moveToTrash`, fonction).
- Index composites : `firebase/firestore.indexes.json`. Une requête sans index échoue en production avec un lien de création dans la console : reporter l'index dans le fichier, jamais le créer seulement depuis la console.

```
npm run rules:build            # régénère
npm run rules:check            # échoue si les fichiers générés ne sont pas à jour
npm run deploy:rules           # règles Firestore + Storage + index (reconstruit avant déploiement)
```

---

## 6. Cloud Functions (`functions/src`)

Structure : un dossier par domaine (`core`, `restaurant`, `orders`, `menu`, `finance`, `marketing`, `messaging`, `hr`, `admin`, `platform`, `payments`, `notifications`), chacun avec un `index.ts` qui ré-exporte ses fonctions ; `src/index.ts` ré-exporte tous les domaines. Région `europe-west1` et `maxInstances` posés globalement (`lib/runtime.ts`).

### 6.1 Fonction appelable

```ts
// functions/src/orders/advance.ts
import { COLLECTIONS, ORDER_STATUSES } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';

export const advanceOrder = callable(
  z.object({ orderId: zId, to: z.enum(ORDER_STATUSES) }),
  async (data, request) => {
    const snap = await db.collection(COLLECTIONS.orders).doc(data.orderId).get();
    if (!snap.exists) throw fail.notFound('Commande');
    const actor = await requireRestaurantAccess(request, snap.get('restaurantId'), 'orders.manage', 'orders.intervene');
    // … transition vérifiée, écriture en transaction, événement, audit
    return { status: data.to };
  },
);
```

```ts
// functions/src/orders/index.ts
export { advanceOrder } from './advance';
```

Outils du socle (`functions/src/lib`) :

| Fichier | Contenu |
|---|---|
| `callable.ts` | `callable(schemaZod, handler, options)` : validation, erreurs françaises, journalisation |
| `validation.ts` | `z` (messages français), `parseInput`, `zId`, `zEmail`, `zName`, `zPhone`, `zPassword`, `zReason` |
| `errors.ts` | `fail.unauthenticated / forbidden / invalid / notFound / alreadyExists / precondition / unavailable / internal` |
| `permissions.ts` | `requireAuth`, `requireAdmin(request, perm)`, `assertAdminCovers(admin, cityId)`, `requireRestaurantAccess(request, rid, perm, adminPerm?)`, `loadMember`, `loadAdmin` |
| `audit.ts` | `writeAudit({ actor, action, target, reason, before, after, countryId, cityId, request })`, `actorFromCaller`, `SYSTEM_ACTOR` |
| `admin.ts` | `db`, `auth`, `storage`, `FieldValue`, `Timestamp` |
| `claims.ts` | `syncClaims(uid)` après tout changement de rôle ou d'appartenance |
| `brevo.ts`, `emails.ts`, `email-layout.ts` | `sendEmail(...)` et gabarits HTML Ciyou Eats ; déclarer `secrets: EMAIL_SECRETS` |
| `stripe.ts`, `secrets.ts` | client Stripe (secret `STRIPE_SECRET_KEY`), secrets déclarés par `defineSecret` |
| `config.ts` | `APP_URLS` (liens des e-mails, surchargés par `ADMIN_APP_URL` / `RESTAURANT_APP_URL`) |

Règles :

- Toute action sensible vérifie le droit **dans la fonction** (les règles ne protègent que l'accès direct à Firestore).
- Toute action d'un administrateur sur les données d'un tiers écrit une entrée d'audit ; les actions destructives exigent un motif (`zReason`).
- Transactions pour tout ce qui touche un statut, un stock, un solde ou un compteur. Montants calculés par `@golink/shared/pricing`, jamais reçus du client.
- Triggers : `onDocumentWritten` / `onDocumentCreated` (`firebase-functions/v2/firestore`) ; tâches planifiées : `onSchedule` (fuseau `Europe/Paris`). Un trigger doit être idempotent (rejouable sans doublon).
- Aucun secret en clair : `defineSecret` + `firebase functions:secrets:set NOM`. Les valeurs locales restent dans `functions/.env.local.secrets` (ignoré par git).
- Les noms des fonctions prévues sont listés dans `docs/SCHEMA_FIRESTORE.md` ; réutiliser ces noms.

### 6.2 Garde-fous transverses des fonctions d'administration

- **Invoker public posé par la fabrique.** `callable()` (`lib/callable.ts`) fixe `invoker: 'public'` : chaque déploiement rend le service Cloud Run appelable sans jeton IAM (l'authentification reste celle de Firebase Auth, vérifiée dans le handler). Sans cela, les appels répondent 403 côté Google Frontend. Si un service est quand même en 403 après un déploiement (ancienne fonction, quota) : `npm run functions:invoker` repose `roles/run.invoker` pour `allUsers` sur tous les callables déployés (repérés par l'étiquette `deployment-callable`), et **retire** l'accès public des fonctions planifiées (qui ne doivent être appelées que par Cloud Scheduler) ; le webhook Stripe reste public. Ex. : `npm run functions:invoker -- getRefundPolicy` pour une seule fonction. Vérification : un appel anonyme (`curl -X POST -d '{"data":{}}' https://europe-west1-golink-9f16d.cloudfunctions.net/<nom>`) doit répondre 400 ou 401 applicatif, jamais 403 Google.
- **Double authentification dans `requireAdmin`.** `requireAdmin(request, permission?, { skipMfa? })` (`lib/permissions.ts`, logique dans `lib/mfa.ts`) refuse toute fonction d'administration quand la 2FA est exigée et que la session du jeton n'a pas validé de code (session absente, fermée, expirée ou code non saisi). Seules `trackAdminSession`, `enrollTotp`, `verifyTotp` et `getMfaStatus` passent `skipMfa: true`. `requireRestaurantAccess` applique le même contrôle quand l'accès se fait en tant qu'administrateur. La 2FA est exigée si le compte est enrôlé (toujours) ou si `settings/security.requireMfaForAdmins` est vrai ; une fois exigée, elle ne peut plus être désactivée ni repoussée (`updatePlatformSettings`), et aucun code ne désactive la 2FA d'un compte existant (seul `resetAdminMfa`, sur demande motivée d'un super administrateur). Limite connue : les règles Firestore ne lisent pas la 2FA (lecture directe de données par un jeton non vérifié) ; toutes les **écritures** et actions passent par des fonctions contrôlées.
- **Motif obligatoire.** Toute action sensible prend un champ `reason` (`zReason`, 3 caractères minimum) et l'écrit dans `writeAudit(... reason ...)` ; les montants et états avant/après sont consignés. Côté interface : `callFunctionWithReason(nom, { title })` (`apps/admin/src/lib/reason.tsx`) ouvre la boîte de motif avant l'appel (ou réutilise le motif déjà saisi dans le formulaire) ; `ReasonPromptHost` est monté une fois à la racine de l'application. Ne jamais générer un motif factice dans l'écran.
- **Plafond unique de remboursement et d'avoir.** `refundLimitOf(admin)` (`admin/experience/common.ts`) : plafond individuel de l'agent, sinon plafond de son rôle (`adminRoles.defaultRefundLimitCents`), borné par le seuil de la plateforme (`settings/refunds.approvalThresholdCents`) ; le super administrateur n'a pas de plafond. Utilisé par `refundFromTicket`, `reviewTicketRefund`, `creditFromTicket` et `creditCustomer` ; au-delà : remboursement en attente de validation d'un autre responsable, avoir refusé et à faire accorder par un responsable dont le plafond suffit (pas d'auto-validation, même avec `refunds.approve`). `settings/refunds.maxCreditCents` (500 € par défaut) borne tout avoir manuel. L'interface lit ces valeurs par `getRefundPolicy`.
- **Périmètre.** Un responsable de ville doit avoir au moins une ville existante (`assertCityScopeValid`) ; un périmètre par pays est converti en villes du pays (`resolveCityScope`), et `saveCity` ajoute une nouvelle ville aux administrateurs limités à son pays.
- **Interrupteurs de fonctionnalités lus à l'exécution.** `lib/features.ts` : `isFeatureOn(clé, portée)` / `assertFeatureOn(...)`, portée résolue commerce > formule > ville > pays > plateforme, absence de réglage = actif, cache de 10 s. Lus par la commande (`orders/place.ts` : livraison, retrait, sur place, programmées, pourboires, promotions, carte, espèces, stock), la fidélité, le parrainage, les promotions (commerce et plateforme), le stock, le chat en direct, le suivi du livreur (position visible du client), le multi-boutiques (groupes) et l'intégration caisse. Le trigger `onFeatureFlagWrite` (`restaurant/feature-sync.ts`) resynchronise les fiches publiques (modes de commande, moyens de paiement) et l'ouverture de la position aux clients ; les réglages saisis par les commerces ne sont jamais modifiés.

Compilation et déploiement :

```
npm run build:functions                       # tsc --noEmit + bundle esbuild (lib/index.js)
FUNCTIONS_DISCOVERY_TIMEOUT=120 npx firebase deploy --only functions:nomA,functions:nomB
```

Sur ce poste (dossier OneDrive), le chargement du code dépasse les 10 s par défaut : `FUNCTIONS_DISCOVERY_TIMEOUT=120` est obligatoire. Déployer de préférence les seules fonctions modifiées. Le bundle est unique (`lib/index.js`) : une modification d'un utilitaire partagé (ex. `requireAdmin`) demande de redéployer TOUTES les fonctions, par lots de 30 pour ne pas saturer le quota de processeurs.

Après un déploiement : `npm run functions:invoker` (voir 6.2) puis un appel anonyme de contrôle.

### 6.3 Compte du propriétaire d'un restaurant et devise du commerce

Contrat exact, pour qu'une future page d'inscription publique (faite par un tiers) sache quoi appeler :

- **Qui crée le compte Firebase Auth du propriétaire, et quand.** Trois chemins existent, tous dans `functions/src`, tous via `getOrCreateAuthUser` (`lib/accounts.ts`, réutilisé par les invitations) :
  - `core/signup.ts` (`restaurantSignup`, inscription en ligne) : si l'appelant a déjà une session, le compte existant est réutilisé (l'e-mail doit correspondre) ; sinon un mot de passe est **obligatoire** dans la requête et le compte est créé avec **ce** mot de passe, choisi par le propriétaire lui-même. Dans les deux cas, le propriétaire a déjà ses accès dès l'inscription : `Restaurant.ownerCredentialsDelivered = true`.
  - `admin/acteurs/import.ts` (`importRestaurants`, création par l'équipe) : le compte est créé avec un mot de passe **provisoire aléatoire, jamais communiqué** (`provisionalPassword`) ; un lien de définition de mot de passe est envoyé aussitôt si `inviteOwners` est vrai (gabarit `ownerAccessEmail`). `Restaurant.ownerCredentialsDelivered` reflète l'envoi réel de ce lien (faux si `inviteOwners` est faux, si la création est une donnée de test, ou si l'adresse est réservée aux tests) — un dossier créé sans lien envoyé recevra le lien à la validation (point suivant).
  - Toute autre origine (dossier écrit directement en base, sans passer par une fonction) : le champ `ownerCredentialsDelivered` est absent, traité comme faux.
- **`reviewRestaurantApplication` (validation du dossier, `admin/acteurs/applications.ts`)** : à l'approbation, si `ownerCredentialsDelivered !== true`, la fonction (a) s'assure qu'un compte Auth existe pour l'adresse du gérant (le réaligne sur `restaurants/{id}.ownerId` si besoin, cas d'un dossier créé sans compte), (b) génère un lien de définition de mot de passe (même mécanisme que `core/invitations.ts` : `auth.generatePasswordResetLink` → `oobCode` → `<app restaurant>/definir-mot-de-passe?oobCode=…`), (c) envoie ce lien par e-mail (gabarit `applicationApprovedWithCredentialsEmail`) au lieu du simple message « Dossier validé », et (d) marque `ownerCredentialsDelivered = true` (jamais de second envoi à une validation ultérieure). Si le propriétaire a déjà ses accès, l'e-mail « Dossier validé » simple (`applicationApprovedEmail`) est envoyé, sans lien.
- **Devise du compte (`Restaurant.currency`, ISO 4217 : EUR, DZD, MAD, TND).** Fixée automatiquement d'après le pays à la création (`currencyOfCountry`, `lib/currency.ts`), **modifiable** par le super admin à la validation du dossier (sélecteur pré-rempli dans la boîte d'approbation) ou après coup (fiche restaurant → Modifier la fiche → `adminUpdateRestaurant`, motif et audit obligatoires). Le champ est absent sur les documents antérieurs à cette rubrique : ne jamais le lire directement, toujours passer par `resolveRestaurantCurrency(restaurant, country?, countryId?)` (`packages/shared/src/utils/restaurant-config.ts`), qui applique le repli pays puis EUR. Cette devise ne sert **qu'au formatage** des montants déjà propres à ce commerce dans les back-offices (ex. minimum de commande sur sa fiche) ; elle ne change pas la devise réelle des paiements/commandes, qui reste celle du pays (`pricingFor`/`currencyOfCountry`, moteur de tarification) — propager le formatage multi-devises à tous les écrans qui affichent des montants (restaurant et super admin) reste une tâche à part, plus large.
- Une inscription publique construite par un tiers doit donc appeler `restaurantSignup` (ou une fonction équivalente suivant ce même contrat) plutôt que d'écrire directement dans Firestore, pour que ce mécanisme reste cohérent.

---

## 7. Données de démonstration

`npm run seed` (rejouable, identifiants stables, chaque document porte `seed: true`) remplit le projet `golink-9f16d`. Une nouvelle collection s'accompagne de données de démonstration réalistes dans `scripts/seed/<domaine>.ts`, branchées dans `scripts/seed/index.ts`, vérifiées par `npm run seed:check`. `npm run seed -- --reset` supprime d'abord les documents `seed: true`.

Comptes de test (mots de passe dans `.test-accounts.local.md`, ignoré par git, jamais recopié ailleurs) :

| App | Compte | Rôle |
|---|---|---|
| Admin | `superadmin@golink.test` | super admin |
| Admin | `support@golink.test`, `finance@golink.test`, `commercial@golink.test` | support, finance, commercial |
| Admin | `metz@golink.test` | responsable de ville (Metz) |
| Restaurant | `mina.haddad@golink.test` | propriétaire de 3 établissements (Mina Kitchen, Lune Coffee, Onda Pasta Club) |
| Restaurant | `sofia.martin@golink.test` | manager de Mina Kitchen |
| Restaurant | `youssef.karim@golink.test` | cuisine, Mina Kitchen |

Une rubrique se teste au minimum avec un compte qui a le droit et un compte qui ne l'a pas.

**Double authentification des comptes de test.** La 2FA est obligatoire pour l'équipe interne. Le compte `superadmin@golink.test` a une 2FA active dont le code n'est pas accessible : ne jamais la contourner ni la réinitialiser (les pages réservées au super administrateur se testent avec un compte jetable). Les quatre autres comptes de l'équipe sont enrôlés par `node scripts/tests/mfa-enroll-test-accounts.mjs` (secrets dans `.test-mfa.local.json`, ignoré par git) ; `npm run smoke -- admin <e-mail>` saisit alors seul le code TOTP sur l'écran de vérification. Un script qui appelle directement une fonction d'administration ouvre la session avec `adminSession(email, motDePasse)` de `scripts/lib/test-mfa.mjs` (`trackAdminSession` puis `verifyTotp`) ; les tests des pages super admin créent un administrateur jetable (`cdcd-…`, supprimé en fin de script) : voir `scripts/tests/cdc-fix-d.flow.mjs` et `cdc-fix-d.ui.mjs`.

---

## 8. Tester

À lancer avant de rendre une rubrique (tout doit passer) :

```
npx tsc --noEmit -p packages/shared
npm run test:shared
npm run build:functions
npm run rules:check
npm run build:restaurant
npm run build:admin
```

Contrôle dans le navigateur, sur la vraie base (données de démonstration) :

```
npm run dev:restaurant          # http://localhost:5173
npm run dev:admin               # http://localhost:5174
npm run smoke -- restaurant sofia.martin@golink.test /commandes 1440
npm run smoke -- restaurant youssef.karim@golink.test /commandes 390
npm run smoke -- admin metz@golink.test /restaurants 1440
```

`scripts/smoke.mjs` se connecte avec le compte indiqué, ouvre la page, enregistre une capture pleine page dans `.smoke/` (ignoré par git) et affiche le titre, le débordement horizontal et les erreurs de la console ; il sort en erreur s'il y a un débordement ou une erreur. Regarder les captures, pas seulement le code de sortie.

Émulateurs (règles réelles, sans toucher la production), utiles pour tester des écritures ou une fonction non déployée :

```
firebase emulators:start --only auth,firestore,functions
VITE_FIREBASE_EMULATORS=true npm run dev:restaurant
```

Sous Windows, si Java refuse de démarrer l'émulateur Firestore : `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Windows/Temp`.

Processus : arrêter uniquement les serveurs que l'on a lancés, par leur PID. Ne jamais tuer `node` par nom.

---

## 8 bis. Zéro débordement

Exigence : à 1440, 1024, 768, 390 et 320 px, thème clair ou sombre, y compris pendant un redimensionnement en direct, avec des données longues (noms interminables, gros montants, 200 lignes, texte arabe) : aucun défilement horizontal de la page, aucun élément qui dépasse de sa carte ou de l'écran, aucun chevauchement, aucun texte coupé sans moyen de le lire.

Ce que le kit `packages/ui` garantit déjà (ne pas le refaire à la main) :

- **Tableaux** : `DataTable` bascule tout seul en cartes empilées quand le tableau ne tient plus dans son conteneur (pas seulement sous 640 px). Le composant `Table` (et donc tout `<Table>` posé à la main) s'empile aussi en cartes : l'en-tête de colonne devient l'étiquette de chaque valeur. Ne jamais écrire `<table>` brut ni `min-w-[…]` sur une table : utiliser `Table`.
- **Grilles** : `.grid > *` a `min-width: 0` (un enfant ne peut plus élargir sa piste). Sur un enfant flex, ajouter `min-w-0` à la zone de texte.
- **Texte coupé** : `truncate` et `line-clamp-*` sont autorisés à condition que le texte complet reste accessible ; la coque (`AppShell`) pose automatiquement `title` au survol/focus sur tout élément réellement coupé. Ajouter `data-no-auto-title` pour l'empêcher. Mots longs : `[overflow-wrap:anywhere]` (déjà appliqué aux titres, paragraphes, cellules, libellés).
- **Pastilles** (`Badge`, `StatusPill`) : `max-w-full` avec points de suspension.
- **Barres d'onglets / sélecteurs** : `TabsList` défile horizontalement dans sa propre bande (`data-scroll-ok`) ; `SegmentedControl` passe à la ligne. Une bande qui défile volontairement doit porter `data-scroll-ok` (le script d'audit l'accepte alors).
- **En-tête** : recherche à largeur réduite sous `xl`, nom de l'utilisateur masqué sous `xl`, groupe d'actions `min-w-0 shrink`.

Motif à suivre pour toute nouvelle page :

1. Rangées d'actions et de filtres : `flex flex-wrap items-center gap-2` (jamais `flex` seul avec des largeurs fixes).
2. Ligne « icône + texte + action » : `flex items-center gap-3`, texte dans un `div.min-w-0`, icône/actions en `shrink-0`.
3. Largeurs fixes (`w-64`, `min-w-56`) uniquement à partir de `sm:` (`w-full sm:w-64`).
4. Grilles : colonnes progressives (`grid gap-4 sm:grid-cols-2 xl:grid-cols-4`), jamais un nombre de colonnes fixe sur mobile.
5. Graphiques : conteneur `min-w-0` et `ResponsiveContainer`/ResizeObserver, jamais de largeur en pixels.
6. Modales et tiroirs : `max-h-[calc(100dvh-2rem)]` avec défilement interne du corps, largeur `min(…, 100vw - 2rem)`.
7. Images : `max-w-full` (appliqué globalement) ; avatars empilés : marge négative (ignorée par l'audit).

Vérifier : `node scripts/tests/audit-overflow.mjs <admin|restaurant> <e-mail> --port=<port> [--themes=default,alt] [--stress] [--rtl] [--routes=…] [--skip-done]`. Le script visite chaque route déclarée dans `features/*/module.tsx` (et une fiche par route dynamique), enchaîne les largeurs en direct (réduction puis agrandissement), recharge à la plus petite largeur, ouvre les modales principales, et écrit `.smoke/overflow-<app>-<compte>.json` + captures `.smoke/overflow-<app>/`. Cible : 0 défaut. Les comptes avec double authentification ne sont pas utilisables : prendre un compte sans MFA (le script marque `denied` les rubriques refusées au rôle ; `--skip-done` évite de refaire les pages déjà couvertes par un autre compte).

## 9. Interdits

- Secrets dans un fichier suivi par git (`sk_test_`, `sk_live_`, `whsec_`, `xkeysib-`, clé Google Maps). Seule la configuration web Firebase publique figure dans `apps/*/src/lib/firebase.ts`.
- Nom de collection écrit en dur, montant en euros flottants, date client pour `createdAt` / `updatedAt`.
- Écriture directe d'un champ sensible depuis le front (statut, montant, rôle, validation, compteur, audit).
- Modification des fichiers générés (`firebase/*.rules`), du shell ou de `@golink/web` pour les besoins d'une seule rubrique : proposer l'évolution du socle séparément.

## 10. Application client mobile (`apps/client`)

React Native + Expo (React Navigation, Firebase JS SDK — pas `@react-native-firebase`, comme les back-offices web). Fidélité à `golink-maquette/v2/client.md` (lecture seule) obligatoire pour la structure, les proportions, les libellés et le schéma de navigation (§18) ; contrairement aux back-offices web, **on ne vise pas un style « premium » qui s'écarte de la maquette** — la palette et la charte des back-offices sont réutilisées uniquement parce qu'elles coïncident déjà avec la palette de la maquette (corail `#E8784B`, encre `#19343B`, §19.18 de client.md).

Arborescence (`apps/client/src`) :

- `navigation/` : `types.ts` (un seul fichier de types de routes, à étendre — jamais dupliquer), `RootNavigator` (Auth ⇄ Main selon `useAuth().status`), `AuthStack`, `MainStack` (pile connectée : onglets + écrans empilés), `MainTabs` (barre basse 5 onglets). Reflète exactement le schéma §18.2 de client.md ; un lot qui ajoute un écran ajoute sa route dans `types.ts` puis dans la pile concernée, jamais une nouvelle pile parallèle.
- `auth/` : `AuthContext` (Firebase Auth email/mot de passe, persistance `AsyncStorage`, vérification e-mail, réinitialisation de mot de passe), `WelcomeScreen`, `SignInScreen`, `SignUpScreen`, `ForgotPasswordScreen`, `VerifyCodeScreen`, `AuthLayout` (habillage commun : bandeau encre + carte crème).
- `ui/` : socle de design system RN (`Button`, `Card`, `Text`, `Input`, `Badge`, `Skeleton`, `Toast` — ajouté au lot 2, `ToastProvider`/`useToast()` monté dans `App.tsx` au-dessus de la navigation, un seul message à la fois), barril unique `ui/index.ts` — toujours importer depuis là, jamais `<Text>`/`<Pressable>` stylé à la main dans un écran. Réexporte aussi `theme/tokens` et `theme/logo`.
- `theme/tokens.ts` : seule source de couleurs/rayons/espacements/ombres/typo (équivalent RN de `packages/ui/src/styles/tokens.css`) ; `theme/logo.ts` réutilise directement les PNG de `packages/ui/src/assets` (jamais de copie locale).
- `i18n/` : `I18nProvider` + `core.ts`, FR uniquement pour ce lot (`fr/common.ts`) — forme prête à recevoir EN/AR sans changer son API (`useTranslation()`), décision à revoir si le client demande le multilingue mobile avant les lots suivants.
- `lib/firebase.ts` (config + `getReactNativePersistence(AsyncStorage)`), `lib/firestore.ts` (copie fidèle des hooks `useDoc`/`useCollection`/`callFunction`/`errorMessage` de `apps/restaurant/src/lib/firestore.ts` — pas un import de `@golink/web`, qui embarque du JSX web incompatible avec Metro), `lib/env.ts` (`EXPO_PUBLIC_*`).
- `features/<domaine>/` : un dossier par écran de §18.1. Un écran non encore construit est une coquille `PlaceholderScreen` (icône + titre + note « Bientôt disponible », jamais un écran vide ou une erreur) ; un écran construit lit de vraies données Firestore (jamais de mock). **État lot 3 (dernier lot mobile client) : tous les écrans de §18.1 sont construits avec des données réelles** — `home`, `restaurant`, `product`, `search`, `cart`, `checkout`, `confirmation`, `profile`, `tracking`, `orders` (Orders/OrderDetail/RateOrder), `favorites`, `notifications`, `addresses` (Addresses/AddressForm), `profile` (EditProfile/PaymentMethods/Help), `promotions`. Aucun écran de la navigation §18.1/§18.2 ne reste une coquille — voir « État exact laissé » du lot 3 ci-dessous pour les deux limites assumées (paiement carte, ajout de carte bancaire).
- `features/cart/CartContext.tsx` : panier client, persistant localement (`AsyncStorage`, un seul restaurant à la fois — remplace tout le panier avec confirmation native `Alert.alert` si on ajoute un plat d'un autre restaurant, §6 client.md), monté dans `App.tsx` (`CartProvider`, au-dessus de la navigation). `pricing.ts` calcule un **aperçu** de devis avec le vrai moteur `computeQuote` de `packages/shared` (le même que celui exécuté par `placeOrder`) ; le montant qui fait foi reste toujours celui renvoyé par la Cloud Function à la confirmation.

**Lot 2 (parcours d'achat complet) — décisions d'adaptation à la maquette, à conserver pour les lots suivants :**
- **Code promo** : les règles Firestore n'autorisent la lecture d'une promotion par un client que si `showcase == true && status == 'active'` (vitrine), jamais par une recherche de code arbitraire — impossible de reproduire l'aperçu chiffré du panier/checkout de la maquette (« SHOPY20 appliqué : -20 %… ») sans lire les documents. Le code saisi (`CartScreen`, `CheckoutScreen`) est donc seulement transmis à `placeOrder`, qui le valide réellement (c'est la seule validation, mais elle est réelle) ; l'UI l'indique explicitement plutôt que d'afficher un faux succès.
- **Catégories de recherche** : la maquette a une liste figée à 45 catégories de plats ; le modèle réel n'a pas de taxonomie globale (les plats sont classés par section, propre à chaque restaurant). `SearchScreen` filtre donc par cuisine (`cuisineCategories`, public) à la place, en plus du filtre Tout/Restaurants/Plats et de la recherche par mot-clé (`searchKeywords`, préfixes déjà indexés par `buildSearchKeywords`).
- **Adresse de livraison** : formulaire inline dans `CheckoutScreen` (comme la maquette), écrit directement dans `users/{uid}/addresses` (règles Firestore : `create`/`update` autorisés au propriétaire). Il n'y a pas encore de géocodage (aucune intégration cartographique livrée) : le point géographique de la nouvelle adresse est par défaut le centre de la ville active (`City.center`) — à corriger dès qu'un lot cartographie/adresses dédié existe. Les écrans `AddressesScreen`/`AddressFormScreen` restent des coquilles (gestion complète des adresses hors panier, lot séparé).
- **Consignes de retrait** (`pickupInstructions`) : vivent dans `restaurants/{rid}/settings/orders`, réservé au personnel du restaurant par les règles Firestore — le client n'y a pas accès (texte générique affiché à la place).
- **Paiement carte** : les boutons « Carte · démo » et « Espèces » sont tous les deux affichés (fidélité à la maquette) et filtrés par `restaurant.acceptedPaymentMethods` ; « Espèces » appelle réellement `placeOrder` (commande réelle bout en bout, décrémente le stock, écrit `orders`/`payments`). « Carte » n'a pas encore d'écran de saisie (il faudrait Stripe Elements côté web ou `@stripe/stripe-react-native`, non ajouté ce lot) : l'appel part quand même avec `paymentMethod: 'card'` et `paymentMethodId: null`, que `placeOrder` refuse proprement (« Choisissez un moyen de paiement. ») — un vrai refus serveur documenté à l'écran plutôt qu'un paiement simulé qui prétendrait avoir débité une carte. Lot suivant : brancher un vrai `PaymentIntent`/`paymentMethodId`.
- **Suivi (§11 client.md)** : `OrderConfirmationScreen` lit la vraie commande créée et propose « Suivre ma commande », mais `OrderTrackingScreen` reste une coquille (lot suivant : statut temps réel Firestore, plus simulation locale comme la maquette).

Piège relevé et corrigé en lot 1 : un conteneur RN `alignItems: 'center'` qui encadre un texte long (titre/tagline) déborde horizontalement sous **Expo web** (RN-Web ne contraint pas la largeur d'un enfant centré comme le fait le moteur natif) — toujours donner `width: '100%'` à ce conteneur quand il porte un texte qui doit pouvoir passer à la ligne (voir `auth/WelcomeScreen.tsx`, commentaire à l'endroit du correctif). À vérifier sur chaque nouvel écran testé via `expo start --web`.

Test : `npx tsc --noEmit -p apps/client` (aucun alias, tsconfig dédié) ; `npm run web -w @golink/client -- --port <port>` (configuré dans `.claude/launch.json` sous le nom `client`, port 5187) pour un rendu navigateur réel — un seul serveur Expo à la fois, arrêté par son PID en fin de tâche (jamais de `taskkill` global). Compte de test dans `.test-accounts.local.md`.
- Toute mention d'outil de génération de code dans le code, les commentaires, les textes ou les commits.

### 10 bis. Lot 3 — suivi, historique, favoris, notifications, adresses, profil (dernier lot de l'app client)

Reprise après une première tentative interrompue (favoris déjà écrits, confirmés complets à la relecture, rien refait). Complète tous les écrans encore en coquille §18.1.

- **Suivi** (`features/tracking/`) : `hooks.ts` (`useTrackedOrder`, `useDriverLocation` sur `driverLocations/{driverId}`, lisible tant que l'uid client est dans `visibleTo` — écrit par le serveur à l'attribution, jamais par l'app) + `trackingSteps`/`stepLabel` (frise réelle, adaptée retrait/livraison). `RouteMap.{shared,web,tsx}` + `lib/mapsKey.ts` repris à l'identique du pattern `apps/driver` (lot 2 : Google Maps Embed Directions via `getPublicRuntimeConfig`, `react-native-webview` ajouté à `apps/client/package.json`, voir `docs/_deps-demandees.md`) : carte affichée seulement en livraison, étape `picked_up`, livreur assigné — même limite documentée au lot 2 driver (API Maps Embed potentiellement non activée côté GCP, hors périmètre de ce lot).
- **Historique** (`features/orders/`) : `useMyOrders` (`orders` où `customerId == moi`, `orderBy createdAt desc`, index déjà déployé), `OrdersScreen` (sections En cours/Historique), `OrderDetailScreen` (articles, montants, adresse, avis déjà déposé), `RateOrderScreen` (écriture réelle `reviews/{orderId}`, conforme à `firebase/rules/support.rules` : un avis par commande livrée). Testé réellement de bout en bout (voir plus bas) : écriture, lecture, relecture après navigation.
- **Favoris** : `features/favorites/hooks.ts`/`FavoritesScreen.tsx` (trouvés déjà complets à la reprise). **Complété dans ce lot** : les cœurs déjà présents sur `HomeScreen`, `RestaurantScreen`, `ProductScreen` et `SearchScreen` utilisaient un état local factice (`useState<Set<string>>`, jamais persisté, parfois même pas cliquable sur `ProductScreen` qui n'avait pas de `Pressable`) — tous les quatre branchés sur le même hook `useFavorites` que l'écran dédié, pour qu'un cœur coché n'importe où corresponde toujours à la même réalité Firestore. Vérifié réellement : cœur coché sur la fiche restaurant → visible immédiatement sur `HomeScreen` et dans `FavoritesScreen`.
- **Notifications** (`features/notifications/`) : `useNotifications` (`users/{uid}/notifications`, temps réel, `markRead`/`remove`), `NotificationsScreen` (non-lu mis en avant, navigation vers la cible du lien `order`/`promotion`). Aucune création côté app (règles : `create: if false`, notifications émises par les Cloud Functions).
- **Adresses** (`features/addresses/`) : CRUD réel `users/{uid}/addresses` (même collection que le formulaire inline du checkout lot 2) + adresse par défaut (`users/{uid}.defaultAddressId`, champ autorisé par `userEditableFields()`). Même limite que le lot 2 (pas de géocodage : point géographique par défaut au centre de la ville active), documentée dans le code. `AddressesScreen` (liste, modifier, définir par défaut, supprimer) + `AddressFormScreen` (ajout/modification, étiquette/rue/complément/étage/code d'accès/instructions livreur).
- **Profil** : `EditProfileScreen` (écriture réelle `users/{uid}` — prénom/nom/téléphone, `displayName` synchronisé aussi côté Firebase Auth), `PaymentMethodsScreen` (lecture réelle `users/{uid}/paymentMethods`, **aucune Cloud Function d'enregistrement de carte trouvée côté serveur** — recherché dans `functions/src`, absente — donc lecture seule assumée et documentée, pas de faux formulaire Stripe), `HelpScreen` (FAQ réelle statique + contact e-mail, aucune collection FAQ dédiée côté serveur pour ce lot).
- **Promotions** (`features/promotions/`) : `useShowcasePromotions` (`promotions` où `showcase == true && status == 'active'`, seule lecture que les règles autorisent à un client, comme au lot 2). « Appliquer » écrit le code dans un nouveau champ `CartContext.promoCode` (persistant, repris par `CheckoutScreen` à l'ouverture) plutôt que de dupliquer un état local : le code n'est vérifié qu'à `placeOrder`, exactement comme au lot 2.

**Bug transitoire observé, non corrigé (pas un bug de code)** : juste après l'écriture d'un avis, `OrderDetailScreen` peut encore afficher « Noter cette commande » un instant avant que l'écouteur temps réel ne remonte la nouvelle donnée (latence normale de propagation Firestore) ; en revisitant l'écran (ou après quelques secondes), l'avis s'affiche correctement — vérifié réellement à deux reprises.

**Test réel effectué** (`expo start --web`, port 5191, compte `client.lot1@golink.test`, une commande active réelle GL-12981 alors « Livreur en route vers le commerce » disponible en base grâce à une autre tâche concurrente) : connexion → Historique (section En cours + Historique réelles) → Suivi de GL-12981 (frise réelle avec horodatages, carte livreur non affichée car étape antérieure à `picked_up`, fiche livreur réelle « Pedro R. · Scooter ») → Détail de commande (articles/montants réels) → avis déposé sur une commande livrée (4 étoiles + commentaire, écriture confirmée par relecture) → Favoris (cœur sur la fiche restaurant Mina Kitchen → visible sur Accueil et dans Favoris) → Adresses (adresse réelle « Test lot 2 », mise par défaut confirmée à l'écran) → Notifications (fil réel de la commande, plusieurs notifications horodatées) → Offres (10 promotions réelles avec code/valeur/condition) → Modifier le profil (champs réels préremplis, prénom/nom/téléphone/e-mail). `npx tsc --noEmit -p apps/client` : VERT après tout le code (2 erreurs trouvées et corrigées en cours de route : `CartContext.addLine` oubliait `promoCode` dans l'état retourné après un changement de restaurant, `RateOrderScreen` avait un `useState` trop strictement typé sur la note).

**Collision de navigateur partagé observée** : le Browser pane intégré est partagé par plusieurs tâches concurrentes sur cette machine (règle mémoire « un seul navigateur » : respectée côté de cette tâche, mais un autre onglet piloté par une tâche différente a navigué et fermé un onglet ouvert par celle-ci pendant le test). Contournement : onglet dédié ouvert en arrière-plan pour ce lot, fermé proprement à la fin ; aucune interférence avec les données (chaque tâche a son propre port de serveur de dev).

**État exact laissé — plus rien en coquille dans `apps/client` (18/18 écrans de §18.1 réels).** Deux limites assumées, documentées, pas des oublis :
1. **Paiement par carte** (déjà limité au lot 2) : toujours pas de vrai `PaymentIntent`/Stripe Elements branché — inchangé par ce lot.
2. **Ajout d'un moyen de paiement** (`PaymentMethodsScreen`) : lecture seule, aucune Cloud Function d'enregistrement de carte (`createSetupIntent` ou équivalent) n'existe côté serveur pour ce lot.

Reste hors périmètre pour un lot ultérieur (si demandé) : brancher un vrai paiement carte (les deux limites ci-dessus sont liées), EN/AR (jamais demandé pour l'app client), géocodage réel des adresses (lot 2 et 3), détection/message FR pour l'erreur Google Maps Embed si l'API n'est pas activée côté GCP (même limite que `apps/driver` lot 2).

## 11. Application livreur mobile (`apps/driver`)

React Native + Expo, même socle technique que `apps/client` (React Navigation, Firebase JS SDK, hooks `lib/firestore.ts`). **Différence essentielle avec l'app client : la maquette Replit de l'espace livreur (`golink-maquette/v2/livreur-admin.md` §1) n'est volontairement PAS fidèle** — 3 écrans démonstratifs en anglais, disponibilité non persistante, adresses et formule de gains codées en dur (« 4,50 € + 0,80 €/article »), aucune offre avec délai, aucun code, aucun GPS. Seul le **squelette d'UX** (4 écrans : Dispatch, Gains, Historique, Profil) est repris ; le contenu suit les décisions client (`docs/DECISIONS_CLIENT.md` section « Livraison et livreurs ») et le contrat serveur (`docs/CONTRATS_APPS_MOBILES.md` §24, `docs/SCHEMA_FIRESTORE.md` §6), jamais la maquette.

Arborescence (`apps/driver/src`), dupliquée depuis `apps/client/src` et non partagée entre les deux apps Expo (paquet commun à deux apps mobiles jugé disproportionné pour ce lot — choix documenté ici, à revoir si une 3ᵉ app mobile apparaît) :

- `navigation/` : 4 onglets (`Dispatch`, `Earnings`, `History`, `Profile`, voir §1.6 de la maquette) au lieu des 5 de l'app client ; pile d'authentification réduite à `Welcome → SignIn → ForgotPassword` (pas d'écran d'inscription, voir plus bas).
- `auth/AuthContext.tsx` : **pas d'inscription en libre-service** — `docs/DECISIONS_CLIENT.md` exige une validation manuelle du dossier livreur, et aucune Cloud Function d'inscription livreur n'existe encore côté serveur (recherché dans `functions/src` : absent, contrairement à `restaurantSignup`). Seule la connexion à un compte déjà créé (et validé) est couverte par ce lot. La connexion vérifie en plus `claims.role === 'driver'` et déconnecte immédiatement un compte d'un autre rôle.
- `ui/`, `theme/`, `i18n/`, `lib/` : copies fidèles du socle `apps/client` (mêmes composants, même palette Ciyou Eats corail `#E8784B` / encre `#19343B` — une seule identité de marque pour les deux apps mobiles, pas de palette dédiée au rôle livreur), FR uniquement pour ce lot.
- `features/dispatch/` (le seul écran développé en profondeur, comme l'exige la mission) :
  - `hooks.ts` : `useDriver`/`useDriverLocation` (lecture temps réel `drivers/{uid}` et `driverLocations/{uid}`), `useIncomingOffers` (`dispatchOffers` où `driverId == moi` et `status == 'offered'`, triées côté app car l'index composite déjà déployé est en `offeredAt desc`), `useAvailabilityToggle` (écrit **directement** `drivers/{uid}.availability`, seul champ que `firebase/rules/drivers.rules` autorise au livreur — en ligne seulement si `status == 'active'` et sans course active), `useLiveLocation` (voir ci-dessous), `respondToOffer`/`markOrderPickedUp`/`completeOrder` (appels des Cloud Functions existantes, aucune n'a été ajoutée côté serveur).
  - `DispatchScreen.tsx` : bascule de disponibilité réelle, carte d'offre entrante réelle avec compte à rebours réel (`Countdown`, basé sur `dispatchOffers.expiresAt`), accepter/refuser réels (`respondToOffer`), puis suivi de la course active à partir de `drivers/{uid}.activeOrderIds[0]` (lecture réelle de `orders/{orderId}`, autorisée par les règles dès que `order.driverId == moi`, donc seulement **après** acceptation — avant, seule la proposition `dispatchOffers` porte les informations affichées, sans nom de commerce ni adresse : limite réelle des règles Firestore, pas un oubli) : bouton « Commande récupérée » (`markOrderPickedUp`) puis, si `delivery.handoverCodeRequired`, saisie du code de remise avant « Terminer la livraison » (`completeOrder`).
  - **Position GPS** : `navigator.geolocation.watchPosition` du navigateur (Expo web n'a pas d'accès natif complet), throttlée (6 s en course, 45 s sinon, conforme à la fourchette de `docs/CONTRATS_APPS_MOBILES.md` §24), geohash calculé avec `encodeGeohash` de `@golink/shared` (même fonction que le serveur), positions dont la précision dépasse 100 m écartées plutôt qu'envoyées. **Le natif (development build) reste nécessaire pour la position en arrière-plan réelle** (écran éteint, app en arrière-plan) : documenté à l'écran (message si la position est refusée ou non supportée) et ici.
- `features/earnings/` : lecture réelle de `driverEarnings` (`driverId` + `orderBy earnedAt desc`, index déjà déployé), résumé de la semaine en cours calculé côté app (aucun agrégat serveur dédié pour ce lot) — jamais la formule fictive de la maquette.
- `features/history/` : `orders` où `driverId == moi` et `status == 'delivered'` (index déjà déployé), détail d'une course avec son gain réel (`driverEarnings/{orderId}` — même identifiant que la commande, voir `functions/src/finance/argent/settlement.ts`).
- `features/profile/` : identité réelle (`drivers/{uid}`) — statut du dossier, véhicule, distance maximale choisie (`docs/DECISIONS_CLIENT.md` « Distance max : choisie par le livreur »), espèces, note ; modification de ces réglages et documents laissée en coquille assumée (hors lot 1).

**État exact laissé par ce lot :**
- Fonctionnel en conditions réelles (testé `expo start --web`, compte réel `driver.lot1@golink.test`) : connexion (rejet d'un compte non-livreur), bascule de disponibilité en ligne/hors ligne (écriture Firestore réelle, vérifiée avant/après), écran Dispatch (état vide en ligne/hors ligne), Gains (lecture réelle, vide pour un compte neuf), Historique (lecture réelle, vide), Profil (identité et fiche réelles), déconnexion.
- **Non rejoué de bout en bout** faute d'un scénario de dispatch complet disponible sans perturber d'autres tâches concurrentes (créer une vraie commande, l'attribuer, laisser expirer/accepter une offre) : le code de réception d'offre, d'acceptation, de récupération et de remise s'appuie exactement sur les mêmes fonctions et règles que celles déjà testées côté super admin/scripts (`respondToOffer`, `markOrderPickedUp`, `completeOrder`), mais n'a pas été vu à l'écran avec une offre réelle. À vérifier en priorité dans le lot suivant (ou via `scripts/simulate/live-orders.ts` adapté pour forcer une offre vers `test-driver-lot1`).
- Écrans volontairement en coquille (hors périmètre lot 1, mission point 1) : réglages du profil (véhicule, distance, documents), messagerie commerce ↔ livreur (§3.4 de la maquette, absente de la mission lot 1), suivi des espèces détenues (livreur salarié, absent de la mission lot 1), client absent (§1 de `docs/CONTRATS_APPS_MOBILES.md`, non demandé pour ce lot), EN/AR.
- Compte de test créé par `scripts/create-test-driver.mjs` (écriture directe admin, car aucune Cloud Function d'inscription livreur n'existe) : dossier déjà considéré validé (`status: 'active'`), ville Longwy. Identifiants dans `.test-accounts.local.md`.

Test : `npx tsc --noEmit -p apps/driver` ; `npm run web -w @golink/driver -- --port <port>` (configuré dans `.claude/launch.json` sous le nom `driver`, port 5188) — un seul serveur Expo à la fois, arrêté par son PID exact en fin de tâche.

### 11 bis. Lot 2 — déroulé complet d'une course (acceptation → livraison)

Complète le lot 1 : l'écran Dispatch suit désormais la course de bout en bout, testée réellement de bout en bout (voir plus bas).

- **Codes** (mission point 3) : le code de retrait/remise au client (`order.pickupCode`, existant) ne couvrait que le client — **aucun code de collecte livreur ↔ commerce n'existait côté serveur**. Recherché dans `docs/DECISIONS_CLIENT.md` (fait foi) et le cahier client + questions-réponses : aucune exigence écrite, seulement une synthèse déduite par l'audit maquette (`golink-maquette/v2/livreur-admin.md` §1.6). Décision d'adaptation documentée : ajout d'un champ optionnel et rétrocompatible `order.delivery.collectionCode` (+ `collectionVerified`), généré par `placeOrder` pour toute commande en livraison (`packages/shared/src/models/orders.ts`, `functions/src/orders/place.ts`), vérifié par `markOrderPickedUp` (`functions/src/orders/transitions.ts`) uniquement s'il est présent — une commande créée avant ce changement ne demande aucun code (aucune régression). Le commerce voit ce code dans `apps/restaurant` (`OrderDetail.tsx`, `KitchenTicket.ts`, commandes en livraison, avant vérification) pour le communiquer au livreur. Le code de remise finale au client (`handoverCodeRequired`) reste inchangé, jamais demandé avant la remise finale (`apps/driver/src/features/dispatch/DispatchScreen.tsx`, saisie possible seulement à l'étape `picked_up`). **Fonctions serveur redéployées** (`firebase deploy --only functions:placeOrder,functions:markOrderPickedUp --project golink-9f16d --force`) pour rendre le changement testable réellement.
- **Carte et itinéraire réels** (mission point 2) : `apps/driver/src/features/dispatch/RouteMap.tsx` (natif, `react-native-webview` — dépendance ajoutée, voir `docs/_deps-demandees.md`) et `RouteMap.web.tsx` (web, `<iframe>`, Metro résout le fichier `.web.tsx` sur cette cible) affichent Google Maps Embed Directions (commerce → client, ou position du livreur → prochaine étape) avec la clé « web » distribuée par la Cloud Function publique `getPublicRuntimeConfig` (`docs/CONTRATS_APPS_MOBILES.md` §23, sans authentification, testée réellement). **Constat réel en test** : la clé est bien récupérée (`mapsConfigured: true`) mais Google refuse la requête (« This API is not activated on your API project ») — l'**API « Maps Embed »** n'est pas activée dans Google Cloud Console pour cette clé, contrairement à l'API « Maps JavaScript » qu'utilisent déjà les back-offices avec la même clé. **Action requise côté super admin/GCP, hors périmètre de ce lot** : activer l'API Maps Embed sur le projet `golink-9f16d` (https://console.cloud.google.com/apis/library?filter=category:maps). Repli textuel (« Cartographie non configurée… ») prévu seulement pour une clé absente ; l'erreur brute de Google s'affichant dans la WebView/iframe quand la clé existe mais que l'API n'est pas activée est une limite acceptée pour ce lot (amélioration possible : détecter cette erreur précise et afficher un message FR). Conforme au point 4 de `docs/CONTRATS_APPS_MOBILES.md` §23 : la clé mobile native dédiée n'est pas distribuée par cet endpoint et reste à construire pour une vraie app native (non couvert, comme documenté au lot 1).
- **Client absent** (mission point 4) : réutilise intégralement `markDriverArrived`/`logCustomerCall`/`closeCustomerAbsent` (`functions/src/orders/customer-absent.ts`, déjà complets côté serveur, aucun ajout) via `ActiveOrderPanels.tsx` (`CustomerAbsentPanel`) : bouton « Client absent » → attente réelle (10 min par défaut, réglable par ville via `orderRules.customerAbsent`), compteur d'appels, clôture activée seulement après le délai (et un appel si `callViaApp` l'exige). **Le mécanisme d'appel réel (mise en relation téléphonique via l'app) n'est pas câblé** — `logCustomerCall` trace l'appel comme l'exige la fonction serveur, mais le numéro réel du client n'est jamais transmis à l'app livreur (protection des données, seul `customerPhoneMasked` est lisible) : hors périmètre de ce lot, à prévoir avec un fournisseur de téléphonie proxy le moment venu.
- **Messagerie course** (mission point 5) : réutilise `conversations/{id}` sans réinvention (`ActiveOrderPanels.tsx`, `MessagingPanel`) — identifiant déterministe `convd-{orderId}` (même fonction que `functions/src/messaging/restaurant/conversations.ts`), lecture temps réel + écriture directe des messages (autorisée par `firebase/rules/support.rules` aux membres du fil, pas de Cloud Function dédiée). Le fil est créé par le commerce (`openOrderConversation`, jamais par le livreur) : tant qu'il n'existe pas encore, état vide clair plutôt qu'une erreur.
- **Espèces détenues** (mission point 6) : `ActiveOrderPanels.tsx` (`CashBalanceCard`) affiche `driverPrivate/{uid}.cashBalanceCents`/`cashLimitCents`, monté uniquement si `driver.type === 'restaurant'` (livreur salarié d'un commerce). **Non vérifié à l'écran** : `test-driver-lot1` est de type `platform` (créé ainsi au lot 1, cohérent avec son rôle de compte de test générique) — changer son type aurait modifié durablement un compte partagé par d'autres tâches, écarté. Vérifié par relecture de code et `tsc` uniquement.

**Test réel effectué** (`expo start --web`, port 5188, compte `driver.lot1@golink.test`) : une vraie commande a été créée via `scripts/simulate-driver-lot2-order.mjs` (nouveau script de test dédié à ce lot, ne touche pas `scripts/simulate/live-orders.ts` partagé — client `client.lot1@golink.test` → Mina Kitchen, paiement carte test `pm_card_visa`, restaurant `sofia.martin@golink.test` accepte et prépare), puis attribuée à `test-driver-lot1` par une transaction admin reproduisant exactement les écritures réelles de `assignDriverInTransaction` (nécessaire : `settings/dispatch.mode === 'auto_assign'`, réglage plateforme réel non modifié, attribue sinon automatiquement le meilleur candidat parmi tous les livreurs en ligne — vérifié en pratique, un autre livreur simulé a été pris lors d'un premier essai). Rejoué à l'écran, avec succès : réception de la course → carte (clé récupérée, erreur Google Maps documentée ci-dessus) → code de collecte erroné rejeté par le serveur → code correct accepté (`markOrderPickedUp`) → étape « en route vers le client » → messagerie (message reçu du commerce affiché en temps réel, réponse du livreur envoyée et visible) → client absent (arrivée, appel, clôture après le délai réel) → commande livrée, livreur repassé disponible automatiquement.
**Bug réel trouvé et corrigé pendant ce test** : `CustomerAbsentPanel` utilisait `useState(() => {...})` comme substitut de `useEffect` pour démarrer l'intervalle du compte à rebours d'attente — l'initialiseur de `useState` ne s'exécute qu'au tout premier rendu (où `customerAbsence` est encore `null`), donc l'intervalle n'était jamais créé après l'arrivée réelle du livreur : le compte à rebours restait figé à l'écran (la clôture serveur elle-même n'était pas affectée). Corrigé en `useEffect` dépendant de `waitUntilMs` (`apps/driver/src/features/dispatch/ActiveOrderPanels.tsx`).

Reste pour un lot suivant : activer l'API Maps Embed côté GCP (super admin), message FR de repli si la clé existe mais que l'API est refusée, clé mobile native dédiée pour une vraie app (development build), mise en relation téléphonique réelle pour « client absent », vérification visuelle du solde d'espèces avec un compte livreur salarié dédié, réglages du profil (véhicule, distance, documents) et EN/AR (toujours hors périmètre).
