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
- **Parité visuelle restaurant / admin (2026-09-30, correctif rejet client)** : le restaurant démarre désormais en mode **sombre par défaut** (comme l'admin, qui n'a pas de sélecteur), et la palette `[data-theme="restaurant"][data-mode="dark"]` (`packages/ui/src/styles/tokens.css`) est **strictement identique**, valeur par valeur, à `[data-theme="admin"]`. Le sélecteur clair/sombre du restaurant est **conservé** (le retour client portait sur l'identité de base, pas sur l'existence du sélecteur) ; un script inline dans `apps/restaurant/index.html` pose `data-mode="dark"` avant le premier rendu pour éviter un flash clair au chargement. Structure des pages (colonnes Commandes, listes Produits/Options) non modifiée — seul le skin a été harmonisé. Point non tranché : si le client souhaite à terme retirer complètement le sélecteur clair pour le restaurant (fixer comme l'admin), c'est un choix produit restant à confirmer explicitement.

### 3.5 Modules activables par formule (`PlanFeatureKey`, cahier §17)

Retour client explicite : StaffLink (équipe/RH) et certaines rubriques marketing sont des **produits
supplémentaires** de Ciyou, activables par formule côté super admin (`apps/admin/src/features/abonnements/PlansPage.tsx`,
cases à cocher `PLAN_FEATURE_KEYS` — `packages/shared/src/constants/argent.ts`). Le back-office restaurant doit
refléter cette formule : masquer le menu, bloquer les routes, bloquer le serveur. Une formule dont `features`
est vide (`[]`) ne restreint rien (décision client, `entitlements.ts`) — c'est le cas de toutes les formules
Basic/Pro/Premium actuelles.

**Correspondance rubrique du menu restaurant → `PlanFeatureKey`** (`nav.feature` dans chaque `features/<id>/module.tsx`) :

| `PlanFeatureKey` | Rubrique(s) restaurant (id du dossier) | Libellé menu |
|---|---|---|
| `team` | `employes`, `utilisateurs` | Employés, Utilisateurs & accès |
| `planning` | `planning` | Planning |
| `timeclock` | `pointages` | Pointages |
| `absences` | `absences` | Absences |
| `tasks` | `taches` | Tâches |
| `documents` | `documents-entreprise` | Documents (équipe) |
| `payroll` | `paie` | Paie |
| `haccp` | `haccp` | HACCP |
| `promo_codes` | `promotions` | Codes promo |
| `loyalty` | `fidelite` | Fidélité |
| `push_campaigns` | `campagnes` | Campagnes |
| `messaging` | `messages` | Messages (conversations client/livreur) |
| `orders`, `menu`, `finance` | — | Fonctions de base, jamais gatées (aucune rubrique dédiée à masquer) |
| `multi_outlet`, `pos_integration`, `priority_support`, `sponsored` | — | Pas encore de rubrique restaurant dédiée ; déjà affichées comme argument de vente dans `AbonnementPage.tsx` |

Rubriques **volontairement non gatées** malgré un lien avec le marketing : `annonces` (offres sur les plats)
et `reseaux-sociaux` (visuels/QR code) sont des outils marketing de base sans `PlanFeatureKey` dédié, comme
`avis` (réponse aux avis, permission `reviews.reply` seule) ; `clients` n'a pas de clé de formule. `abonnement`
(changer de formule) n'est **jamais** gaté : un établissement doit toujours pouvoir voir/changer sa formule.
`paie` n'a pas de permission de rubrique (chaque salarié y voit son propre bulletin) mais est gaté par `payroll` :
si la formule ne comprend pas la paie, personne n'y accède, y compris pour son propre bulletin (cohérent avec
« StaffLink est un produit supplémentaire »).

**Mécanisme (générique, `packages/web`, réutilisable par n'importe quelle app)** :

- `ModuleNav.feature?: string` (`packages/web/src/modules/modules.tsx`) : optionnel, en plus de `permission`.
- `FeatureProvider` / `useFeatureCheck()` (`packages/web/src/auth/guards.tsx`, même patron que `PermissionProvider` /
  `usePermissionCheck()`). Sans `FeatureProvider` monté (ex. super admin), `useFeatureCheck()` renvoie toujours
  `true` : aucune régression pour les apps qui ignorent la notion de formule.
  `useModuleNav` (sidebar) et `moduleCommands` (palette ⌘K) filtrent maintenant aussi sur `nav.feature`.
- `ModuleGate` (garde de route de chaque module) affiche `FeatureNotIncludedPanel` (nouveau, `screens/StatusScreens.tsx`,
  clés i18n `status.featureDenied*`/`status.seeSubscription`, fr/en/ar) si la fonctionnalité n'est pas incluse —
  état cohérent pour un lien direct ou un favori vers une rubrique masquée du menu, plutôt qu'un plantage.
- **Restaurant** (`apps/restaurant/src/auth/useEntitlements.ts`) : lit `restaurant.planCode` (champ du document
  public `restaurants/{rid}`, lisible par tout membre — pas `restaurants/{rid}/private/commercial`, réservé aux
  membres `finance.view`) puis `plans/{planCode}` (lecture publique) ; expose `hasFeature(key: PlanFeatureKey)`
  avec exactement la même règle que le serveur (`functions/src/finance/argent/entitlements.ts`) : formule vide
  = aucune restriction. `EntitlementsGate` (`apps/restaurant/src/auth/RestaurantAccess.tsx`, exporté et réutilisé
  par la session « voir comme » de `Impersonation.tsx`) monte `FeatureProvider` sous `RestaurantAccessContext`.
  `Shell.tsx` passe `useFeatureCheck()` à `moduleCommands`. Le hub `features/marketing/MarketingPage.tsx` filtre
  aussi ses cartes (`promotions`, `campagnes`, `fidelite`) par `hasFeature`, en plus de la permission.
- **Cloud Functions (défense en profondeur, point 4)** : `assertFeatureAllowed(restaurantId, key)` ajouté aux
  fonctions sensibles qui ne l'appelaient pas encore : `publishSchedule`/`reviewShiftChangeRequest` (planning),
  `clockEvent`/`correctTimeEntry`/`validateWeek` (timeclock), `reviewAbsence` (absences), `computePayroll`/
  `savePayslipAdjustments`/`setPayslipStatus`/`sendPayslips` (payroll — `generatePayslipPdf` volontairement non
  gaté : un salarié doit pouvoir retélécharger un bulletin déjà émis), `exportHaccpRegister` (haccp), `sendMessage`
  (messaging). Déjà protégées avant cette tâche : `invitations.ts` (team), `promotions.ts` (promo_codes),
  `loyalty.ts` (loyalty), `campaigns.ts` (push_campaigns). Non modifié (hors périmètre) : `restaurant/documents.ts`
  (justificatifs KYC du commerce, sans rapport avec la clé `documents` = documents d'équipe StaffLink) ;
  création de tâches (`hr/tasks.ts` ne contient qu'un trigger `onDocumentWritten`, pas de callable — l'écriture
  passe par les règles Firestore, hors périmètre d'un correctif Cloud Functions).
- **Déploiement** : le menu (front) est visible dès la mise en ligne d'`apps/restaurant`/`packages/web` ; les
  nouveaux appels `assertFeatureAllowed` nécessitent en plus un redéploiement des fonctions listées ci-dessus
  (`firebase deploy --only functions:<noms>`) pour être actifs en ligne.
- **Testé réellement** (voir `.autopilot/progress/cdc-fix.md`) : formule de test temporaire sans `team`/`planning`
  assignée à `mina-kitchen`, connecté en `sofia.martin@golink.test` — Employés et Planning disparaissent du menu,
  un lien direct vers `/equipe/employes` affiche « Non inclus dans votre formule » avec un bouton vers
  `/abonnement`, formule restaurée ensuite (`mina-kitchen` → `pro`) et réapparition confirmée.

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
- `i18n/` : `I18nProvider` + `core.ts` + `LanguagePicker.tsx`, **FR/EN/AR avec RTL réel depuis la tâche `mobile-i18n-en-ar`** (même moteur que `packages/web/src/i18n`, JSON par namespace `fr/en/ar`, `useTranslation('ns')`/`t('ns:cle')`, pluriel `_one`/`_other`) — voir « 10 ter. Internationalisation (FR/EN/AR, RTL) » pour l'état exact (namespaces et écrans couverts vs restants).
- `lib/firebase.ts` (config + `getReactNativePersistence(AsyncStorage)`), `lib/firestore.ts` (copie fidèle des hooks `useDoc`/`useCollection`/`callFunction`/`errorMessage` de `apps/restaurant/src/lib/firestore.ts` — pas un import de `@golink/web`, qui embarque du JSX web incompatible avec Metro), `lib/env.ts` (`EXPO_PUBLIC_*`).
- `features/<domaine>/` : un dossier par écran de §18.1. Un écran non encore construit est une coquille `PlaceholderScreen` (icône + titre + note « Bientôt disponible », jamais un écran vide ou une erreur) ; un écran construit lit de vraies données Firestore (jamais de mock). **État lot 3 (dernier lot mobile client) : tous les écrans de §18.1 sont construits avec des données réelles** — `home`, `restaurant`, `product`, `search`, `cart`, `checkout`, `confirmation`, `profile`, `tracking`, `orders` (Orders/OrderDetail/RateOrder), `favorites`, `notifications`, `addresses` (Addresses/AddressForm), `profile` (EditProfile/PaymentMethods/Help), `promotions`. Aucun écran de la navigation §18.1/§18.2 ne reste une coquille — voir « État exact laissé » du lot 3 ci-dessous (ajout de carte bancaire depuis le profil, fermé depuis la tâche `profile-add-card`). Paiement carte réel câblé depuis la tâche `client-stripe-checkout` (voir « 10 quater » plus bas).
- `features/cart/CartContext.tsx` : panier client, persistant localement (`AsyncStorage`, un seul restaurant à la fois — remplace tout le panier avec confirmation native `Alert.alert` si on ajoute un plat d'un autre restaurant, §6 client.md), monté dans `App.tsx` (`CartProvider`, au-dessus de la navigation). `pricing.ts` calcule un **aperçu** de devis avec le vrai moteur `computeQuote` de `packages/shared` (le même que celui exécuté par `placeOrder`) ; le montant qui fait foi reste toujours celui renvoyé par la Cloud Function à la confirmation.

**Lot 2 (parcours d'achat complet) — décisions d'adaptation à la maquette, à conserver pour les lots suivants :**
- **Code promo** : les règles Firestore n'autorisent la lecture d'une promotion par un client que si `showcase == true && status == 'active'` (vitrine), jamais par une recherche de code arbitraire — impossible de reproduire l'aperçu chiffré du panier/checkout de la maquette (« SHOPY20 appliqué : -20 %… ») sans lire les documents. Le code saisi (`CartScreen`, `CheckoutScreen`) est donc seulement transmis à `placeOrder`, qui le valide réellement (c'est la seule validation, mais elle est réelle) ; l'UI l'indique explicitement plutôt que d'afficher un faux succès.
- **Catégories de recherche** : la maquette a une liste figée à 45 catégories de plats ; le modèle réel n'a pas de taxonomie globale (les plats sont classés par section, propre à chaque restaurant). `SearchScreen` filtre donc par cuisine (`cuisineCategories`, public) à la place, en plus du filtre Tout/Restaurants/Plats et de la recherche par mot-clé (`searchKeywords`, préfixes déjà indexés par `buildSearchKeywords`).
- **Adresse de livraison** : formulaire inline dans `CheckoutScreen` (comme la maquette), écrit directement dans `users/{uid}/addresses` (règles Firestore : `create`/`update` autorisés au propriétaire). Il n'y a pas encore de géocodage (aucune intégration cartographique livrée) : le point géographique de la nouvelle adresse est par défaut le centre de la ville active (`City.center`) — à corriger dès qu'un lot cartographie/adresses dédié existe. Les écrans `AddressesScreen`/`AddressFormScreen` restent des coquilles (gestion complète des adresses hors panier, lot séparé).
- **Consignes de retrait** (`pickupInstructions`) : vivent dans `restaurants/{rid}/settings/orders`, réservé au personnel du restaurant par les règles Firestore — le client n'y a pas accès (texte générique affiché à la place).
- **Paiement carte** : câblé réellement depuis la tâche `client-stripe-checkout` (voir « 10 quater » plus bas) — les boutons « Carte » et « Espèces » restent filtrés par `restaurant.acceptedPaymentMethods` ; « Espèces » et « Carte » appellent tous les deux réellement `placeOrder`, « Carte » avec un vrai `paymentMethodId` Stripe créé à l'écran.
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

**État exact laissé — plus rien en coquille dans `apps/client` (18/18 écrans de §18.1 réels).**

~~1. Ajout d'un moyen de paiement (`PaymentMethodsScreen`) : lecture seule, aucune Cloud Function d'enregistrement de carte.~~ **Fermé (01/10/2026, tâche `profile-add-card`)** : `createSetupIntent`/`savePaymentMethod` (`functions/src/payments/cards.ts`), déployées sur `golink-9f16d`. `createSetupIntent` crée (au premier besoin) un client Stripe réutilisable (`userPrivate/{uid}.stripeCustomerId`) et prépare un `SetupIntent` ; `savePaymentMethod` relit la carte confirmée côté Stripe et l'enregistre dans `users/{uid}/paymentMethods` (marque/4 derniers chiffres seulement, jamais le PAN), première carte posée par défaut. `CardPayment` (natif + web) étendu avec `confirmCardSetup`. Test réel sur `golink-9f16d` via les fonctions déployées (`node scripts/tests/cdc-fix-residuals-30.flow.mjs`, 12/12 OK) : flux complet, deuxième carte n'écrase pas `isDefault`, un client ne peut pas s'approprier le `SetupIntent` d'un autre (refusé), carte refusée bloquée à la confirmation — nettoyage vérifié (Firestore + client Stripe de test).

Reste hors périmètre pour un lot ultérieur (si demandé) : EN/AR (jamais demandé pour l'app client), géocodage réel des adresses (lot 2 et 3), détection/message FR pour l'erreur Google Maps Embed si l'API n'est pas activée côté GCP (même limite que `apps/driver` lot 2).

### 10 quater. Paiement carte réel (tâche `client-stripe-checkout`, 2026-09-29)

Câble un vrai flux Stripe sur `CheckoutScreen` (auparavant `paymentMethodId: null` envoyé en dur, refusé proprement côté serveur). **Rien à ajouter côté Cloud Functions : tout existait déjà et attendait un vrai `paymentMethodId`** — `functions/src/orders/payment.ts::authorizePayment` (PaymentIntent `capture_method: 'manual'`, `confirm: true`, `payment_method` = celui envoyé par le client, retourne `clientSecret` si `requires_action`/3-D Secure), `functions/src/orders/place.ts` (callable `placeOrder`, refuse déjà proprement si `paymentMethodId` absent pour une méthode carte), `functions/src/orders/transitions.ts::confirmOrderPayment` (callable existant, prévu pour après 3-D Secure : `refreshIntentStatus` + met à jour `order.payment.status`).

- **SDK** : `@stripe/stripe-react-native@0.78.0` (natif iOS/Android, `CardField`/`useStripe().createPaymentMethod`/`handleNextAction`) + `@stripe/stripe-js@9.17.0`/`@stripe/react-stripe-js@6.12.0` (web uniquement — le paquet natif n'a aucune implémentation web, vérifié dans son code source ; nécessaire pour pouvoir tester réellement dans le navigateur intégré, seul mode de test disponible dans cet environnement). Voir `docs/_deps-demandees.md`.
- **Architecture** : `apps/client/src/features/checkout/payment/` — `types.ts` (contrat `CardPayment` commun), `PaymentProvider.tsx` (natif, `StripeProvider`) + `PaymentProvider.web.tsx` (`Elements`/Stripe.js), `CardInput.tsx` (`CardField`) + `CardInput.web.tsx` (`CardElement`). Convention de fichiers reprise de `features/tracking/RouteMap.tsx`/`.web.tsx` (fichier de base = natif/défaut, suffixe `.web.tsx` = override web résolu par Metro) plutôt que `.native.tsx`/`.web.tsx`, car TypeScript (`tsc`) ne connaît pas la résolution par plateforme et a besoin d'un module de base importable. **`PaymentProvider` est posé au plus près du formulaire** (`CheckoutScreen` enveloppe `CheckoutScreenInner`), pas au niveau de `App.tsx` : lors d'un essai avec le fournisseur au niveau de l'app, `useStripe()`/`CardElement` levaient « Could not find Elements context » côté web malgré un arbre React correctement imbriqué (cause exacte non identifiée avec certitude — possiblement liée au découpage par route de Metro/Expo Router en mode `lazy`) ; le fournisseur local, dans le même sous-arbre que ses consommateurs, élimine le problème et évite aussi de charger Stripe.js sur les écrans qui n'en ont pas besoin.
- **Flux** : `CheckoutScreen.onConfirm` crée un vrai `paymentMethodId` (`cardPayment.createCardPaymentMethod()`) avant d'appeler `placeOrder` ; si le paiement revient en `requires_action` avec un `clientSecret` (carte 3-D Secure), `cardPayment.confirmNextAction(clientSecret)` puis la Cloud Function `confirmOrderPayment({ orderId })` (aucune n'a été créée, toutes deux existaient déjà). Messages d'erreur clairs (carte incomplète, authentification échouée, refus banque — ce dernier déjà remonté tel quel par `placeOrder`), nouvelles clés i18n fr/en/ar dans le namespace `checkout` existant (`cardIncompleteError`, `cardPreparingToast`, `cardAuthenticatingToast`, `cardAuthFailedError`, `cardGenericError`, `cardFieldLabel`) ; les libellés « Carte · démo »/« Paiement simulé » ont été corrigés (le paiement est désormais réellement transmis à Stripe, même en mode test).
- **Piège de configuration (à retenir pour tout futur `EXPO_PUBLIC_*` côté `apps/client`)** : contrairement au commentaire précédent de `lib/env.ts` (et contrairement aux `VITE_*` des back-offices web), **Expo (`@expo/env`) ne charge les `.env*` que depuis la racine du PROJET EXPO (`apps/client`), jamais depuis la racine du monorepo** — vérifié dans `node_modules/@expo/env/build/index.js` (`parseProjectEnv(projectRoot, …)`, pas de remontée vers un répertoire parent). La clé `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` doit donc exister à la fois dans `.env.local` (racine, pour cohérence avec les back-offices) et dans `apps/client/.env.local` (copie locale, celle réellement lue par Expo) — les deux gitignorés, même clé de test que les back-offices restaurant/admin.
- **Test réel effectué** : `npx tsc --noEmit -p apps/client/tsconfig.json` VERT. Parcours à l'écran (`expo start --web`, port 5187, compte `client.lot1@golink.test`) jusqu'à `CheckoutScreen` avec le champ carte Stripe (`CardElement`) affiché et fonctionnel (aucune erreur, libellés Stripe visibles « Numéro de carte »/« MM / AA ») — **mais la saisie clavier de la carte de test 4242 4242 4242 4242 n'a pas pu être menée à l'écran** : l'outil de navigateur intégré de cet environnement n'a pas réussi à faire parvenir de frappes clavier à l'intérieur de l'iframe sécurisée cross-origin `js.stripe.com` (plusieurs méthodes essayées : clic direct par coordonnées, clic par référence d'accessibilité, `Tab` puis frappe — dans tous les cas les frappes atterrissaient ailleurs sur la page, jamais dans l'iframe Stripe). C'est un comportement de sécurité attendu de ces iframes vis-à-vis de l'automatisation, pas un bug du code de l'app. **Contournement pour prouver le câblage réel malgré cette limite d'outillage** : `node scripts/test-stripe-card-checkout.mjs --apply` crée un vrai `PaymentMethod` Stripe dynamique (mode test, jeton `tok_visa` = carte Visa 4242, équivalent serveur de ce que produit `CardField`/`CardElement` à l'écran) puis appelle la Cloud Function réelle `placeOrder` exactement comme le fait `CheckoutScreen.tsx` — exécuté avec succès : commande `GL-12986` créée, `payment.status: 'authorized'`, `provider: 'stripe'`, `providerIntentId` réel (`pi_3UL7KNC1DHrmVQ2R0xDSXHOC`), `cardLabel: 'Visa ···· 4242'`, vérifié par relecture Firestore (`orders/o-12986` et `payments/pay-o-12986`). Mot de passe temporaire du compte de test restauré et revérifié par `signInWithPassword` (règle mémoire des comptes partagés).
- **Reste pour un lot ultérieur (si demandé)** : vérification visuelle de l'écran de confirmation avec un paiement carte réel mené par un vrai utilisateur (bloqué ici uniquement par l'outillage de test, pas par le code) ; test sur un build natif réel (iOS/Android, hors de portée de cet environnement Windows sans Xcode/Android Studio) pour valider `CardField`/Apple Pay/Google Pay ; Apple Pay/Google Pay (`automatic_payment_methods` déjà activé côté serveur, `allow_redirects: 'never'`, mais aucun bouton dédié ajouté à l'écran ce lot).
- **Config native iOS requise — deux réglages distincts, à garder TOUS LES DEUX dans `apps/client/app.json` → `expo.plugins`** (incident réel le 01/10/2026 : l'un a été accidentellement remplacé par l'autre au lieu d'être ajouté à côté, 5 minutes après son ajout — l'app a planté au lancement sur un vrai appareil iOS pendant toute la journée, avant qu'un client ne le signale) :
  1. `./plugins/with-stripe-disable-spm` (fichier local, pose `$StripeDisableSPM = true` dans le `Podfile` généré) — évite un conflit de symboles dupliqués entre Swift Package Manager et CocoaPods pour le SDK Stripe.
  2. `expo-build-properties` avec `ios.useFrameworks: "dynamic"` — **sans ce réglage, CocoaPods lie les pods en statique par défaut, ce que le SDK Stripe (Swift) ne supporte pas sur iOS : l'app plante au démarrage sur un vrai appareil**, avant tout code JS (le binaire natif est chargé au lancement du process, pas seulement à l'écran de paiement) — jamais reproductible dans ce navigateur de test (web uniquement), seulement sur un vrai build iOS.
  Les deux réglages répondent à des problèmes différents et sont tous les deux nécessaires ; retirer l'un en ajoutant l'autre réintroduit le plantage. Vérifiable sans build complet : `cd apps/client && npx expo prebuild --platform ios --no-install` (dossier `ios/` généré, jamais committé — le supprimer après) puis vérifier `ios.useFrameworks: "dynamic"` dans `ios/Podfile.properties.json` et `$StripeDisableSPM = true` en tête de `ios/Podfile`.

## 11. Application livreur mobile (`apps/driver`)

React Native + Expo, même socle technique que `apps/client` (React Navigation, Firebase JS SDK, hooks `lib/firestore.ts`). **Différence essentielle avec l'app client : la maquette Replit de l'espace livreur (`golink-maquette/v2/livreur-admin.md` §1) n'est volontairement PAS fidèle** — 3 écrans démonstratifs en anglais, disponibilité non persistante, adresses et formule de gains codées en dur (« 4,50 € + 0,80 €/article »), aucune offre avec délai, aucun code, aucun GPS. Seul le **squelette d'UX** (4 écrans : Dispatch, Gains, Historique, Profil) est repris ; le contenu suit les décisions client (`docs/DECISIONS_CLIENT.md` section « Livraison et livreurs ») et le contrat serveur (`docs/CONTRATS_APPS_MOBILES.md` §24, `docs/SCHEMA_FIRESTORE.md` §6), jamais la maquette.

Arborescence (`apps/driver/src`), dupliquée depuis `apps/client/src` et non partagée entre les deux apps Expo (paquet commun à deux apps mobiles jugé disproportionné pour ce lot — choix documenté ici, à revoir si une 3ᵉ app mobile apparaît) :

- `navigation/` : 4 onglets (`Dispatch`, `Earnings`, `History`, `Profile`, voir §1.6 de la maquette) au lieu des 5 de l'app client ; pile d'authentification réduite à `Welcome → SignIn → ForgotPassword` (pas d'écran d'inscription, voir plus bas).
- `auth/AuthContext.tsx` : **pas d'inscription en libre-service** — `docs/DECISIONS_CLIENT.md` exige une validation manuelle du dossier livreur, et aucune Cloud Function d'inscription livreur n'existe encore côté serveur (recherché dans `functions/src` : absent, contrairement à `restaurantSignup`). Seule la connexion à un compte déjà créé (et validé) est couverte par ce lot. La connexion vérifie en plus `claims.role === 'driver'` et déconnecte immédiatement un compte d'un autre rôle.
- `ui/`, `theme/`, `i18n/`, `lib/` : copies fidèles du socle `apps/client` (mêmes composants, même palette Ciyou Eats corail `#E8784B` / encre `#19343B` — une seule identité de marque pour les deux apps mobiles, pas de palette dédiée au rôle livreur). `i18n/` : même moteur FR/EN/AR que `apps/client` depuis la tâche `mobile-i18n-en-ar` (socle complet + sélecteur de langue dans Profil), mais **aucun écran converti côté livreur pour l'instant** (texte encore en dur) — voir « 10 ter ».
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

Reste pour un lot suivant (avant lot 3) : activer l'API Maps Embed côté GCP (super admin — le message FR de repli existe désormais, voir §11 ter), clé mobile native dédiée pour une vraie app (development build), mise en relation téléphonique réelle pour « client absent » (toujours hors périmètre), EN/AR (toujours hors périmètre).

### 11 ter. Lot 3 — réglages du profil (véhicule, distance, documents) et reste du lot 2

Ferme la coquille de réglages laissée au lot 1 et les deux points restants du lot 2 (repli carte FR, vérification visuelle des espèces).

- **Véhicule et distance maximale** (mission points 1 et 2) : `firebase/rules/drivers.rules` n'autorisait le livreur (`isSelf`) qu'à écrire `availability`/`lastSeenAt` sur `drivers/{uid}` — aucune écriture directe de `vehicle`/`maxDistanceMeters` n'était possible malgré `docs/DECISIONS_CLIENT.md` (« Distance max : choisie par le livreur »). Ajout d'une clause self-service dédiée (type de véhicule dans l'enum, plaque/modèle/couleur optionnels bornés, distance entre 500 et 50 000 m comme la borne plateforme de `functions/src/platform/markets.ts`, jamais en cours de course). `apps/driver/src/features/profile/hooks.ts` (`useUpdateDriverSettings`, écriture directe Firestore, même pattern que `useAvailabilityToggle`) et `ProfileSettingsScreen.tsx` (nouvel écran : chips de véhicule, champs conditionnels si motorisé, distance en km). Accessible depuis `ProfileScreen.tsx` (bouton « Véhicule, distance et documents »), route `ProfileSettings` ajoutée à `MainStackParamList`/`MainStack.tsx`.
- **Documents** (mission point 3) : recherché d'abord une Cloud Function d'upload livreur existante — absente (seul `functions/src/restaurant/documents.ts` existait, pour les commerces). Ajout de `functions/src/drivers/documents.ts` (`uploadDriverDocument`, nouveau module `functions/src/drivers/`), mirroir strict du pattern restaurant (mêmes contrôles réels sur l'objet Storage déjà déposé : existence, taille ≤ 10 Mo, type MIME, anti-doublon par chemin) mais `ownerType: 'driver'`, self uniquement (`caller.uid === driverId`, pas de délégation admin dans ce lot). Les règles Firestore (`partnerDocuments`, `ownerType: 'driver'`) et Storage (`drivers/{uid}/private`, création par `isSelf`) existaient déjà côté réseau (prévues dès l'origine) — rien à changer là. Côté app : `apps/driver/src/lib/storage.ts` (nouveau, repris de `apps/restaurant/.../kit/storage.ts`, upload cross-plateforme File direct sur web / fetch+blob sinon), `features/profile/hooks.ts` (`useDriverDocuments`, `uploadDriverDocument`), `ProfileSettingsScreen.tsx` (une ligne par type de document pertinent livreur, statut affiché, bouton Déposer/Remplacer). Dépendance ajoutée : `expo-document-picker` (`~57.0.3`, `docs/_deps-demandees.md`) — sélection de fichier cross-plateforme (fonctionne aussi sur Expo web).
  **Limite de test assumée** : l'automatisation du navigateur intégré ne peut pas piloter la boîte de dialogue de fichier native (pas d'outil de dépôt de fichier disponible pour ce navigateur) — le bouton « Déposer » a été vérifié à l'écran (rendu, libellés, statuts), mais le chemin complet UI → Storage → fonction n'a pas pu être rejoué depuis le navigateur. Vérifié à la place par un script de test dédié (`scripts/verify-driver-document-upload.mjs`) qui reproduit exactement le même appel (connexion réelle `driver.lot1@golink.test`, dépôt réel dans Storage, appel réel de `uploadDriverDocument`, vérification du document Firestore créé, rejet réel d'un doublon, nettoyage, mot de passe restauré) : succès complet.
- **Repli message carte FR** (reste du lot 2, mission point 4) : impossible de lire le corps de la réponse Google côté navigateur (vérifié réellement : `curl` sur l'URL Maps Embed avec la clé du projet renvoie `403` « This API project is not authorized to use this API » en `text/plain`, sans en-tête CORS — un `fetch` du navigateur ne peut pas lire cette réponse). Solution serveur : `functions/src/platform/maps.ts` (`embedActivated()`, appel réel à l'URL Maps Embed, résultat mis en cache 30 min dans `settings/maps.embedActivated`/`embedCheckedAt`), exposé par `getPublicRuntimeConfig` (nouveau champ `mapsEmbedActivated: boolean | null`, `packages/shared/src/models/platform.ts`). Côté app : `apps/driver/src/lib/mapsKey.ts` (`useGoogleMapsRuntime`, remplace `useGoogleMapsWebKey` en gardant un alias de compatibilité), `RouteMap.tsx`/`RouteMap.web.tsx` affichent désormais « Itinéraire momentanément indisponible (cartographie non activée côté serveur), contactez votre administrateur. » au lieu de l'erreur brute Google quand `embedActivated === false` (jamais bloquant si `null`, non vérifiable). **Vérifié réellement à l'écran** (course de test, voir plus bas) : message FR affiché, plus d'erreur Google brute.
- **Vérification visuelle du solde d'espèces** (reste du lot 2, mission point 5) : `test-driver-lot1` reste de type `platform` (non modifié, compte partagé). Nouveau compte de test dédié `driver.lot3-restaurant@golink.test` (uid `test-driver-lot3-restaurant`, `scripts/create-test-driver-restaurant.mjs`, copie adaptée de `create-test-driver.mjs`), `type: 'restaurant'`, `restaurantIds: ['mina-kitchen']`, `driverPrivate.cashBalanceCents: 4250`/`cashLimitCents: 15000`. Constat en cours de route : `CashBalanceCard` n'est montée que dans le bloc `activeOrder` (`DispatchScreen.tsx`), jamais hors course active — un solde non nul seul ne suffit pas à la voir. Course de test réelle créée et attribuée directement à ce compte (`scripts/simulate-driver-lot3-cash-order.mjs`, copie adaptée de `scripts/simulate-driver-lot2-order.mjs`, commande `GL-12985`), **vérifiée réellement à l'écran** : carte « ESPÈCES DÉTENUES / À reverser 42,50 € / Plafond 150,00 € » affichée pendant la course, en plus du message de repli carte FR (ci-dessus) sur le même écran. Commande ensuite terminée réellement (code de collecte vérifié par le serveur, `completeOrder`), livreur de test remis hors ligne (état propre).
- **Test réel effectué** (`npm run web -w @golink/driver -- --port 5199`, un seul serveur/navigateur, arrêté par son PID exact en fin de tâche) : connexion `driver.lot1@golink.test` → Profil → « Véhicule, distance et documents » → changement réel (Vélo → Scooter, plaque/modèle/couleur, 8 → 12 km) → **Enregistrer** → écriture Firestore réelle confirmée (revu sur Profil : « Scooter », « 12.0 km », revu sur l'écran réglages après rechargement complet : valeurs conservées) → documents (écran vérifié visuellement, upload vérifié par script dédié ci-dessus) ; connexion `driver.lot3-restaurant@golink.test` → course de test → carte espèces + repli carte FR visibles → livraison terminée.
- **Fonctions déployées** (`FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:uploadDriverDocument,functions:getPublicRuntimeConfig --project golink-9f16d --force`) et règles Firestore déployées (`firebase deploy --only firestore:rules --project golink-9f16d`, changement rétrocompatible : nouvelle clause self-service, rien retiré).

**État exact laissé pour l'app livreur mobile après ce lot** : les 4 écrans (Dispatch, Gains, Historique, Profil) et l'écran de réglages sont tous réels et testés bout en bout, sans coquille restante dans le périmètre des lots 1 à 3. Ce qui reste vraiment ouvert, toujours hors périmètre explicite (jamais demandé pour ces lots) : activer l'API Maps Embed côté GCP (super admin — le code est prêt, seul le réglage Google Cloud manque), clé mobile native dédiée (development build natif, non couvert par des lots testés uniquement sur Expo web), mise en relation téléphonique réelle pour « client absent » (le blocage est la protection du numéro réel du client, pas le code), traduction EN/AR.

### 11 quater. Contestation de sanction (tâche `cdc-mobile-recompte`, recomptage cahier super admin)

Le back-office admin permet de sanctionner un livreur (`sanctionDriver`) et de trancher une contestation (`decideSanctionContest`), et `firebase/rules/drivers.rules` autorisait déjà le livreur à écrire lui-même `driverSanctions/{id}.contest` (self-service, une seule fois par sanction, jamais en modification après décision) — mais rien dans l'app livreur ne l'exerçait, cause identifiée par `docs/AUDIT_COUVERTURE_CDC.md` §2 verdict / §6.

- `apps/driver/src/features/profile/hooks.ts` : `useActiveSanction(driver)` (lit `drivers/{uid}.activeSanctionId` puis `driverSanctions/{id}` si présent) et `useContestSanction(uid)` (écriture directe `driverSanctions/{id}` : `status: 'contested'`, `contest: { message, submittedAt, decision: null }`, conforme à la règle existante).
- `apps/driver/src/features/profile/ProfileScreen.tsx` : nouveau composant `SanctionCard`, affiché sous le bloc d'informations quand une sanction est active — type, motif, échéance ; formulaire de contestation (message ≥ 10 caractères) si pas déjà contestée/tranchée ; badge d'état sinon (« Contestation envoyée », « Sanction annulée », « Contestation examinée »).
- Aucune Cloud Function ni règle nouvelle : uniquement le consommateur manquant.
- **Testé réellement à l'écran** : sanction factice créée par un script de test dédié (avertissement, `driverSanctions` + `drivers/{uid}.activeSanctionId`, sur le compte partagé `test-driver-lot1`, sans toucher `status`/`availability` pour ne pas perturber d'autres tâches concurrentes), affichée correctement dans l'app, contestation envoyée depuis l'écran, vérifiée en base (`status: 'contested'`, `contest.message` exact), puis sanction et référence entièrement retirées (état du compte partagé restauré à l'identique).

### 10 ter. Support (tickets + chat), légal (réacceptation CGU + consentements) et parrainage (tâche `cdc-mobile-recompte`, recomptage cahier super admin)

Trois consommateurs manquants pour des fonctions déjà prêtes côté serveur (jamais appelées par aucune app avant ce lot), plus un nouveau module serveur pour le support.

- **Support (tickets + chat)** : nouveau `functions/src/messaging/client/support.ts` (`createClientTicket`, `replyToClientTicket`, `updateClientTicket`), miroir strict de `functions/src/messaging/restaurant/support.ts` (mêmes délais SLA, mêmes écritures), `requesterType: 'client'`, vérifie que la commande éventuellement liée appartient bien au client (`customerId === uid`). Enregistré dans `functions/src/messaging/client/index.ts` et `messaging/index.ts`. Règles Firestore `support.rules` déjà génériques (`isTicketRequester = isSelf(requesterId)`) : **aucune modification de règles nécessaire**. Côté app : `apps/client/src/features/support/hooks.ts` (`useMyTickets`, `useTicket`, `useTicketMessages`, `markTicketRead`), `SupportScreen.tsx` (liste + création : catégorie, objet, message, commande liée en option), `TicketDetailScreen.tsx` (chat réel, bulles requester/agent/système). Routes `Support`/`TicketDetail` ajoutées (`navigation/types.ts`, `MainStack.tsx`). Points d'entrée : Profil (« Support (mes demandes) »), Aide (bouton « Contacter le support » en plus du mailto existant), Détail de commande (« Signaler un problème », commande prérenseignée).
  **Bug réel trouvé et corrigé pendant le test** : `useTicketMessages` ne filtrait pas `where('internal', '==', false)` alors que la règle Firestore conditionne la lecture à `resource.data.internal == false` — Firestore refuse une requête *list* qui ne reproduit pas ce filtre dans la requête elle-même (confirmé isolément : `get()` sur un message précis passait, `list()` sans le filtre était refusé, `list()` avec le filtre passait). Corrigé en reprenant exactement le filtre déjà utilisé par `apps/restaurant/src/features/support/TicketPage.tsx`.
- **Légal (réacceptation des CGU + consentements cookies/marketing)** : `apps/client/src/features/legal/hooks.ts` (`useMyProfile`, `usePublishedTerms` via l'index Firestore déjà déclaré `type+countryId+status+publishedAt`, wrappers `acceptLegalDocument`/`setConsent`) et `LegalGate.tsx` (nouveau, enrobe `MainStack` dans `RootNavigator.tsx`) : écran plein bloquant tant que `acceptedLegal.terms_client` ≠ version publiée du pays (contenu du document, bouton « J'accepte ») ; bandeau cookies non bloquant une seule fois par compte (`consents.analytics_cookies` jamais renseigné), boutons Tout accepter/Tout refuser.
- **Parrainage (saisie d'un code)** : `apps/client/src/features/referral/ReferralScreen.tsx` — code personnel réel affiché (`users/{uid}.referralCode`, déjà généré à l'inscription), partage natif (`Share`), champ de saisie du code d'un ami (`applyReferralCode`), messages clairs si déjà parrainé ou première commande déjà passée. Accès : Profil > Parrainage.
- **Fermeture d'urgence (bannière côté client)** : `apps/client/src/features/home/HomeScreen.tsx` lit `city.emergencyClosure` (déjà chargé par `useDefaultCity`, aucune nouvelle donnée) et affiche une bannière rouge en haut de l'accueil quand `active`.
- **Classement + mention « Sponsorisé »** : vérifié déjà réel (construit lors d'un lot précédent, jamais recompté) — accueil trié par `rankingScore`, badge « Sponsorisé » affiché, recherche triée sponsorisés d'abord.
- **Testé réellement à l'écran** (port dédié, un seul serveur/navigateur, nouveau compte `client.mobilerecompte@golink.test` — le compte partagé `client.lot1@golink.test` avait un mot de passe rejeté par Firebase Auth, vraisemblablement changé par une tâche concurrente, non touché) : inscription → réacceptation CGU bloquante puis acceptée → bandeau cookies accepté → accueil (badge Sponsorisé visible) → Support (ticket créé, deux messages envoyés et affichés après correction du bug) → Parrainage (code personnel affiché, auto-parrainage rejeté par le serveur, vérifié en base).
- `npx tsc --noEmit -p functions` et `-p apps/client` : VERT. Fonctions `createClientTicket`/`replyToClientTicket`/`updateClientTicket` déployées (`firebase deploy --only functions:createClientTicket,functions:replyToClientTicket,functions:updateClientTicket --project golink-9f16d --force`).
- **Reste ouvert, non traité par ce lot** : ouverture de ticket/chat côté livreur, réacceptation CGU et bandeau cookies côté restaurant/livreur, enregistrement des jetons push (FCM) dans les deux apps, parrainage restaurant (lien à l'inscription) et parrainage livreur.

## 10 ter. Internationalisation mobile FR/EN/AR + RTL (tâche `mobile-i18n-en-ar`)

Socle i18n complet ajouté aux deux apps mobiles, en reprenant à l'identique le moteur de `packages/web/src/i18n` (mêmes fichiers JSON par namespace `fr/en/ar`, même API `useTranslation('ns')` / `t('ns:cle')`, même repli langue→FR→clé brute, mêmes suffixes de pluriel `_one`/`_other`). Adaptation React Native : le sens d'écriture n'est plus posé par `dir` CSS mais par `apps/<app>/src/i18n/I18nProvider.tsx` ; la préférence de langue est mémorisée sur l'appareil via `AsyncStorage` (`golink-client:locale` / `golink-driver:locale`, pas encore synchronisée sur `users/{uid}.locale` comme le fait le web — limite documentée, à ajouter si besoin).

**Bug réel trouvé et corrigé pendant le test à l'écran** : `I18nManager.forceRTL`/`allowRTL` de **react-native-web sont des no-op** (`node_modules/react-native-web/src/exports/I18nManager/index.js` — l'objet exporté n'a même pas de propriété `isRTL`, seulement `getConstants().isRTL` toujours `false`) : le texte se traduisait bien en arabe mais la mise en page ne se miroitait pas du tout sur Expo web (constaté à l'écran, capture avant/après). Corrigé en pilotant directement `document.documentElement.dir`/`lang` sur web (`Platform.OS === 'web'`), ce que react-native-web respecte nativement pour la disposition flex (`flexDirection: 'row'` suit le sens d'écriture du document, comportement CSS standard) — revérifié à l'écran après correctif : miroir complet (barre du haut, barre d'onglets du bas, listes, chevrons, icônes). Sur mobile natif, `I18nManager.forceRTL` reste la bonne API mais **n'y prend effet qu'après redémarrage de l'app** (limitation React Native documentée, pas de contournement propre sans module natif dédié) : `LanguagePicker` affiche alors un message d'invitation à redémarrer (`restartRecommended`), jamais un redémarrage automatique.

**État exact laissé (à ne pas refaire, à reprendre ici pour la suite) :**

- **App client (`apps/client`, priorité de la mission) :**
  - Socle complet : `i18n/core.ts`, `i18n/I18nProvider.tsx`, `i18n/LanguagePicker.tsx` (modale de sélection FR/EN/AR, accessible depuis Profil), JSON `fr/en/ar` pour 4 namespaces : `common` (actions génériques, langue), `auth` (connexion), `home` (accueil), `profile` (profil, raccourcis).
  - Écrans intégralement basculés sur `t('ns:cle')`, testés réellement à l'écran FR→EN→AR avec RTL visible : `SignInScreen` (formulaire de connexion — le formulaire demandé par la mission), `HomeScreen` (accueil — adresse, offres, sections restaurants/plats ; le reste de l'accueil, à savoir `HomeHeader`/`DeliveryContextBar`/`FoodTypeTiles`/cartes dans `features/home/components.tsx`, reste en dur, voir plus bas), `ProfileScreen` (identité, bannière de vérification d'e-mail, raccourcis, déconnexion, nouveau raccourci « Langue »).
  - **Non converti (texte encore en dur, à faire dans un lot ultérieur)** : `WelcomeScreen`, `SignUpScreen`, `ForgotPasswordScreen`, `VerifyCodeScreen`, `AuthLayout` (hors les props déjà traduites passées par `SignInScreen`) ; `features/home/components.tsx` (badges « Fermé »/« Sponsorisé »/« Livraison offerte », libellés des tuiles types de nourriture) ; `SearchScreen`, `RestaurantScreen`, `ProductScreen`, `CartScreen`, `CheckoutScreen`, `OrderConfirmationScreen`, `OrderTrackingScreen`, `OrdersScreen`/`OrderDetailScreen`/`RateOrderScreen`, `FavoritesScreen`, `NotificationsScreen`, `AddressesScreen`/`AddressFormScreen`, `EditProfileScreen`/`PaymentMethodsScreen`/`HelpScreen`, `PromotionsScreen`, `ReferralScreen`, `SupportScreen`/`TicketDetailScreen`, `LegalGate.tsx` ; `lib/firestore.ts` (`errorMessage()`, messages d'erreur Firebase toujours en FR — nécessiterait de rendre la fonction consciente de la langue courante, non fait ce lot).
- **App livreur (`apps/driver`, priorité secondaire selon la mission) :**
  - Socle dupliqué à l'identique (`i18n/core.ts`, `i18n/I18nProvider.tsx`, `i18n/LanguagePicker.tsx`, JSON `fr/en/ar` du namespace `common` uniquement, repris du contenu client). `App.tsx` montait déjà `I18nProvider` (aucun câblage à changer).
  - **Seul changement d'écran : un bouton « Langue » ajouté à `ProfileScreen`** (ouvre `LanguagePicker`, vérifié réellement à l'écran FR→EN→AR). **Aucun autre texte de l'app livreur n'est converti** (Dispatch, Gains, Historique, Profil restent entièrement en dur) — priorité donnée à l'app client conformément à la mission, à reprendre dans un lot dédié « i18n livreur ».
- `npx tsc --noEmit -p apps/client` et `-p apps/driver` : VERT (revérifié après le correctif RTL).
- **Test réel effectué** (`npm run web -w @golink/client -- --port 5187`, un seul serveur, compte `client.mobilerecompte@golink.test`, viewport mobile 375×812) : SignIn (FR) → connexion → Accueil (FR) → Profil → bascule EN (texte traduit, vérifié à l'écran) → bascule AR (texte traduit **et** mise en page RTL réelle : barre du haut mirroir, barre d'onglets mirroir, listes/chevrons/icônes mirroir) → retour Accueil en AR (texte traduit, RTL actif sur toute la page ; les parties non converties — en-tête « CIYOU EATS · LONGWY », « Bonjour Test. » — restent en français, comme attendu et documenté ci-dessus). Serveur arrêté par son PID exact (`taskkill /PID 26128 /F`, confirmé port libéré), onglet fermé.

**Lot `mobile-i18n-en-ar-2` (suite, 2026-09-29) — parcours d'achat + suivi/historique côté client :**

- 8 nouveaux namespaces `fr/en/ar` : `search`, `restaurant`, `product`, `cart`, `checkout`, `confirmation`, `tracking`, `orders`, tous enregistrés dans `apps/client/src/i18n/I18nProvider.tsx`.
- Écrans intégralement basculés sur `t('ns:cle')`, testés réellement à l'écran (voir plus bas) : **priorité 1 (parcours d'achat)** `SearchScreen`, `RestaurantScreen` (+ sous-composant `ProductRow`), `ProductScreen`, `CartScreen` (+ sous-composant `CartLineRow`), `CheckoutScreen`, `OrderConfirmationScreen` ; **priorité 2 (suivi/historique)** `OrderTrackingScreen`, `OrdersScreen`, `OrderDetailScreen`, `RateOrderScreen`.
- Refactor nécessaire dans `apps/client/src/features/tracking/hooks.ts` : `stepLabel()`/`trackingSteps()` prenaient une table de libellés figée en français (`STEP_LABELS`) — elles prennent désormais une fonction de traduction `t` en paramètre (clés `tracking:steps.<status>`), appelée depuis `OrderTrackingScreen`, `OrdersScreen` et `OrderDetailScreen` (les 3 consommateurs, tous mis à jour dans ce lot).
- Dates/heures localisées avec `intlLocale(locale)` (au lieu de `'fr-FR'` en dur) dans `OrderConfirmationScreen` (date programmée), `OrderTrackingScreen` (horodatage des étapes), `OrderDetailScreen` (date de commande).
- **Non converti (texte encore en dur, priorité 3 « si le temps le permet », pas atteinte ce lot)** : `FavoritesScreen`, `NotificationsScreen`, `AddressesScreen`/`AddressFormScreen`, `EditProfileScreen`/`PaymentMethodsScreen`/`HelpScreen`, `PromotionsScreen`, `ReferralScreen`, `SupportScreen`/`TicketDetailScreen`, `LegalGate.tsx`, `WelcomeScreen`/`SignUpScreen`/`ForgotPasswordScreen`/`VerifyCodeScreen`, `features/home/components.tsx` (badges « Fermé »/« Sponsorisé »/« Livraison offerte », tuiles types de nourriture) ; `lib/firestore.ts` (`errorMessage()` toujours en FR) ; bottom tab bar (libellés de navigation « Accueil/Recherche/Commandes/Favoris/Profil » posés par React Navigation, pas encore i18n — constaté pendant le test : ils restent en français même langue EN/AR active) ; app livreur inchangée depuis le lot précédent.
- `npx tsc --noEmit -p apps/client` : VERT.
- **Test réel effectué** (`VITE_CACHE_DIR=node_modules/.vite-i18n2 npm run web -w @golink/client -- --port 5241`, un seul serveur, compte dédié `client.mobilerecompte@golink.test`, viewport mobile 375×812) : connexion FR → Search (FR, filtres/résultats réels) → bascule EN via Profil → Search (EN : « Find your next meal », « Explore Longwy », filtres, « 4 results ») → Restaurant Mina Kitchen (EN : « Free delivery », « 7 dishes ») → Product Houmous maison (EN : « Back to restaurant », « Choose up to 3 · optional », « Add to cart ») → ajout au panier → Cart (EN : « Your cart », « 1 ITEM », « Got a promo code? », « Subtotal/Delivery/Free/Service fee/Total », toast « Dish added to cart ») → Checkout (EN : « Finish your order », « How would you like to receive your meal? », « Delivery address », « When? », « As soon as possible », « Confirm order », « Demo order · No amount charged »). Puis bascule AR : Search (RTL complet, « استكشاف Longwy », « 4 نتيجة », chips/filtres à droite) → Orders (état vide RTL, « لا توجد طلبات بعد » / « ستظهر طلباتك السابقة هنا »). Langue reposée en FR à la fin (compte de test laissé propre). Serveur arrêté par son PID exact (confirmé via `Get-CimInstance` avant `Stop-Process`, jamais un kill par nom global), port 5241 revérifié libéré, onglet fermé.

Reste pour un lot ultérieur (si demandé) : priorité 3 listée ci-dessus (Favorites/Notifications/Addresses/EditProfile/PaymentMethods/Help/Promotions/Referral/Support×2/Legal/Welcome/SignUp/ForgotPassword/VerifyCode/home components), i18n de la barre d'onglets (React Navigation), synchroniser la langue sur `users/{uid}.locale` comme le fait le web, rendre `errorMessage()` conscient de la langue, app livreur (toujours seulement le bouton Langue converti).

**Lot `mobile-i18n-en-ar-3` (suite, 2026-09-29) — barre d'onglets + écrans secondaires client + socle i18n livreur étendu :**

- **Barre d'onglets (priorité 1 de la mission)** : `apps/client/src/navigation/MainTabs.tsx` et `apps/driver/src/navigation/MainTabs.tsx` — labels calculés via `useTranslation('common')` (clés `nav.tabs.*` ajoutées au namespace `common` des deux apps, fr/en/ar) au lieu d'une table figée en français. Testé réellement à l'écran FR→EN→AR sur les deux apps.
- **Titres d'en-tête de la pile de navigation (bug réel trouvé pendant le test, non lié à la mission mais très visible)** : `apps/client/src/navigation/MainStack.tsx` et `apps/driver/src/navigation/MainStack.tsx` posaient `options={{ title: '...' }}` en français en dur pour tous les écrans empilés (Product/Cart/Checkout/Confirmation/Tracking/OrderDetail/RateOrder/Notifications/Addresses/AddressForm/Promotions/EditProfile/PaymentMethods/Help/Support/TicketDetail/Referral côté client ; OrderDetail/ProfileSettings côté livreur) — le contenu de l'écran se traduisait mais le titre affiché dans la barre du haut restait en français quelle que soit la langue (constaté à l'écran sur `Help` : titre « Aide » alors que le corps de l'écran était en anglais). Corrigé en calculant les titres via `useTranslation('common')` (nouvelles clés `screenTitles.*` dans `common` des deux apps, fr/en/ar), revérifié à l'écran après correctif (titre « المساعدة » en arabe, RTL correct).
- **Bug réel trouvé et corrigé (composant partagé)** : `apps/client/src/features/shared/PlaceholderScreen.tsx` (utilisé par Favorites/Notifications/Addresses/Promotions/Cart/Checkout/Orders/Product/Restaurant/Confirmation) affichait un badge « Bientôt disponible » codé en dur, jamais traduit même quand le titre/note passés par l'appelant l'étaient (constaté à l'écran sur Favorites en anglais : titre traduit mais badge resté en français). Corrigé : nouvelle clé `placeholder.comingSoon` dans `common` (fr/en/ar), badge traduit par défaut via `useTranslation('common')` dans le composant lui-même (prop `badgeLabel` optionnelle laissée pour un futur override). Revérifié à l'écran (EN « Coming soon », AR « قريبًا »).
- **Priorité 3 côté client (écrans secondaires), intégralement traitée** : 10 nouveaux namespaces fr/en/ar créés et enregistrés dans `I18nProvider.tsx` — `favorites`, `notifications`, `addresses` (AddressesScreen + AddressFormScreen), `editProfile`, `paymentMethods`, `help`, `promotions`, `referral`, `support` (SupportScreen + TicketDetailScreen), `legal` (LegalGate). Namespace `auth` existant enrichi (sections `welcome`/`signup`/`forgotPassword`/`verifyCode`, aucune clé dupliquée) : `WelcomeScreen`, `SignUpScreen`, `ForgotPasswordScreen`, `VerifyCodeScreen` convertis (`AuthLayout` n'avait pas de texte propre à convertir hors la marque « Ciyou Eats », volontairement non traduite). Namespace `home` existant enrichi : `features/home/components.tsx` intégralement converti (`HomeHeader`, `DeliveryContextBar`, `HomeHero`, `FoodTypeTiles`, `RestaurantCard`, `FeaturedProductRow`) — badges « Fermé »/« Sponsorisé »/« Livraison offerte » et libellés des tuiles compris. `FOOD_TYPES.label` (le champ français du tableau exporté, utilisé par `SearchScreen` comme texte de recherche indexé) volontairement laissé en français : le traduire casserait la recherche en EN/AR (limite documentée, pas un oubli).
- **App livreur (priorité 2 de la mission, atteinte)** : namespace `dispatch` (fr/en/ar) — `DispatchScreen`, `dispatch/components.tsx` (Countdown), `ActiveOrderPanels` (CustomerAbsentPanel/MessagingPanel/CashBalanceCard), `RouteMap.tsx`/`RouteMap.web.tsx` (messages de repli). Namespaces `earnings`, `history` (+ `OrderDetailScreen` de l'historique, complété après le premier passage), `profileSettings`, `profile` (fr/en/ar) — `EarningsScreen`, `HistoryScreen`, `ProfileSettingsScreen` (véhicule + documents), `ProfileScreen` (identité/statut/véhicule/sanctions/raccourcis, le bouton Langue déjà existant reste sur `common`). Dates localisées via `intlLocale(locale)` au lieu de `'fr-FR'`/`toLocaleDateString('fr-FR', …)` en dur (Earnings, History, ProfileScreen carte sanction).
- **Limite documentée (hors périmètre des fichiers d'app, non traitée ce lot)** : `VEHICLE_LABELS`/`SANCTION_TYPE_LABELS`/`PARTNER_DOCUMENT_LABELS`/`DOCUMENT_STATUS_LABELS` viennent de `@golink/shared` (package partagé client+livreur+restaurant+admin) et restent en français en dur — nécessiterait de rendre ce package conscient de la langue courante, à faire dans un lot dédié si demandé.
- `npx tsc --noEmit -p apps/client` et `-p apps/driver` : VERT (2/2, revérifié après chaque lot et en fin de tâche).
- **Test réel effectué, app client** (`VITE_CACHE_DIR=node_modules/.vite-i18n3 npm run web -w @golink/client -- --port 5301`, un seul serveur, compte `client.mobilerecompte@golink.test`, viewport mobile 375×812) : connexion FR (tab bar « Accueil/Recherche/Commandes/Favoris/Profil ») → bascule EN via Profil (tab bar « Home/Search/Orders/Favorites/Profile », menu Profil intégralement traduit) → Accueil EN (« Hello Test. », tuiles types de nourriture, badges restaurant) → Favorites EN (bug badge « Bientôt disponible » constaté puis corrigé, revérifié « Coming soon ») → Help EN (titre d'en-tête « Help », FAQ traduite) → bascule AR (menu Profil miroir RTL complet, checkmark à gauche) → tab bar AR miroir (« الرئيسية/بحث/الطلبات/المفضلة/الملف الش.. ») → Favorites AR (« قريبًا ») → Help AR (titre d'en-tête « المساعدة », RTL complet). Langue reposée en FR à la fin (compte de test laissé propre). Serveur arrêté par son PID exact (`taskkill /PID 13372 /T /F` puis toute la chaîne d'enfants, port 5301 revérifié libéré), onglet fermé avant le serveur suivant.
- **Test réel effectué, app livreur** (`VITE_CACHE_DIR=node_modules/.vite-i18n3d npm run web -w @golink/driver -- --port 5302`, un seul serveur, compte `driver.lot1@golink.test` — mot de passe lu dans `.test-accounts.local.md`, jamais réinitialisé, revérifié fonctionnel en fin de test) : connexion FR → Dispatch FR (« Vous êtes hors ligne », « Passez en ligne… ») → Profil FR (identité, véhicule, sanctions, tab bar « Dispatch/Gains/Historique/Profil ») → bascule AR via Profil (miroir RTL complet : avatar à droite, libellés à droite, valeurs à gauche) → tab bar AR miroir (« توزيع الطلبات/الأرباح/السجل/الملف الشخصي ») → Earnings AR (montants, dates localisées en arabe « الثلاثاء، 29 سبتمبر ») → History AR (liste des courses, miroir) → détail d'une course AR (titre d'en-tête « تفاصيل التوصيلة », labels Client/Articles/Gain convertis pendant ce test après avoir été repérés non traduits). Langue reposée en FR à la fin (compte de test partagé laissé propre, mot de passe non modifié). Serveur arrêté par son PID exact (`taskkill /PID 32572 /F` après arrêt de la chaîne d'enfants), port 5302 revérifié libéré, onglet fermé.
- **Non converti (texte encore en dur, reste pour un lot ultérieur)** : côté client, `lib/firestore.ts` (`errorMessage()` toujours en FR), synchronisation de la langue sur `users/{uid}.locale` (web only pour l'instant) ; côté livreur, aucun autre écran que ceux listés ci-dessus (le reste — écrans non mentionnés dans la mission — était déjà hors périmètre) ; réseau — `@golink/shared` (labels véhicule/sanction/documents partagés entre les 4 apps).

**Lot `mobile-i18n-residuals` (30/09) — résidus i18n : errorMessage(), synchro `users/{uid}.locale`, labels partagés `@golink/shared` :**

- **`errorMessage()` (mission point 1)** : `apps/client/src/lib/firestore.ts` et `apps/driver/src/lib/firestore.ts` — signature changée, prend désormais un `t` (type `TranslateFn`, compatible avec le `t` de n'importe quel namespace) en 2e paramètre ; tous les messages (mot de passe incorrect, compte introuvable, e-mail déjà utilisé, mot de passe faible, e-mail invalide, trop de tentatives, réseau, non autorisé, générique) passent par des clés `common:errors.*` (fr/en/ar ajoutées dans les deux apps). Les 15 appels côté client et 9 côté livreur ont été mis à jour pour passer `t` ; namespace `auth` enrichi d'une clé `login.invalidCredentials`. Deux écrans livreur pas encore i18n (`ForgotPasswordScreen`, `GdprScreen`) reçoivent un `useTranslation('common')` minimal, seulement pour cette fonction (le reste de ces écrans reste hors périmètre de ce lot).
- **Synchronisation `users/{uid}.locale` (mission point 2)** : ajoutée dans `apps/client/src/i18n/LanguagePicker.tsx` et `apps/driver/src/i18n/LanguagePicker.tsx` (seul point d'appel de `setLocale` dans chaque app) — nouvelle fonction `changeLocale()` qui appelle `setLocale` (inchangé, `AsyncStorage` local) **puis** `updateDoc(users/{uid}, {locale, ...updatedFields})` en best-effort (catch silencieux, ne bloque jamais le changement local si hors-ligne/déconnecté). Le champ `locale` était déjà dans `UserProfile` (`packages/shared/src/models/users.ts`) et déjà dans `userEditableFields()` des règles Firestore (`firebase/rules/users.rules`) — aucune règle à modifier. Déjà consommé côté serveur avant ce lot (`functions/src/orders/place.ts`, `functions/src/notifications/messages.ts`) : la synchronisation ferme un vrai trou fonctionnel (la langue n'était jamais mise à jour après l'inscription).
- **Labels partagés `@golink/shared` (mission point 3)** : découverte à l'inventaire — `packages/shared/src/constants/labels-i18n.ts` existe déjà (`labelOf(table, key, locale)` / `labelsFor(table, locale)`, repli garanti locale→français→clé brute), couvrant déjà toutes les tables `*_LABELS` avec traductions EN/AR complètes, fait par un lot antérieur non documenté sous ce nom, jamais exploité par les apps mobiles. Convertis dans `apps/driver` (seul consommateur mobile de `VEHICLE_LABELS`/`SANCTION_TYPE_LABELS`/`PARTNER_DOCUMENT_LABELS`/`DOCUMENT_STATUS_LABELS`/`GDPR_REQUEST_TYPE_LABELS`/`GDPR_REQUEST_STATUS_LABELS` — vérifié par grep sur `apps/client`, aucun) : `features/profile/ProfileSettingsScreen.tsx`, `features/profile/ProfileScreen.tsx`, `features/gdpr/GdprScreen.tsx`. `apps/restaurant`/`apps/admin` intentionnellement non touchés (mission : ne pas casser les back-offices web), toujours sur les tables FR brutes.
- **CGU + cookies app livreur (mission point 4)** : `apps/driver/src/features/legal/{hooks.ts,LegalGate.tsx}` (nouveau), copie fidèle de `apps/client/src/features/legal` (mêmes Cloud Functions `acceptLegalDocument`/`setConsent`, jamais dupliquées), seul `documentType` change (`terms_driver`). `acceptLegalDocument` écrit toujours dans `users/{uid}` quel que soit le rôle de l'appelant (vérifié dans `functions/src/platform/gdpr.ts`) — `countryId` lu depuis `users/{uid}.countryId` (posé à l'inscription) comme côté client. Namespace i18n `legal` créé fr/en/ar dans `apps/driver/src/i18n/`. Branché dans `apps/driver/src/navigation/RootNavigator.tsx` (`LegalGate` enveloppe `MainStack` quand connecté — pas d'`AccessGate` côté livreur, contrairement au restaurant). Règles Firestore déjà suffisantes, aucune modification nécessaire.
- **Écran RGPD côté client (mission point 5)** : `apps/client/src/features/gdpr/{hooks.ts,GdprScreen.tsx}` (nouveau), copie fidèle de `apps/driver/src/features/gdpr` (mêmes Cloud Functions `submitGdprRequest`/`getGdprExportLink`), `subjectType: 'client'` déduit automatiquement côté serveur (fallback par défaut pour un appelant sans rôle restaurant/livreur). Amélioration vs la copie livreur : namespace i18n dédié `gdpr` (fr/en/ar) + `labelOf(...)` au lieu des tables FR brutes. Route `Gdpr` ajoutée à `MainStackParamList`/`MainStack.tsx` (titre via `common:screenTitles.gdpr`) + raccourci dans `ProfileScreen.tsx` (`shortcuts.gdpr`).
- `npx tsc --noEmit -p apps/client`, `-p apps/driver`, `-p apps/restaurant`, `-p apps/admin` : VERT (4/4) tout au long du lot.
- **Tests réels effectués** (un seul serveur/navigateur à la fois, ports Expo dédiés, arrêtés par leur PID exact vérifié via `netstat`/`taskkill`) :
  - Client (`npx expo start --web --port 5340`, compte `client.mobilerecompte@golink.test`) : bascule FR→EN via Profil → écriture Firestore réelle vérifiée (`users/{uid}.locale` passé de `fr` à `en`, script Admin SDK ponctuel) ; écran RGPD atteint depuis le raccourci « Personal data » (titre d'en-tête traduit), 5 boutons de demande affichés, « Request: Right of access » cliqué → toast de confirmation → badge « Received » affiché → écriture Firestore réelle vérifiée (`gdprRequests`, `subjectType:'client'`) — demande de test supprimée ensuite pour ne pas polluer la file réelle ; erreur de connexion testée avec un mauvais mot de passe → message traduit affiché (« Connexion impossible. Vérifiez vos identifiants. », nouvelle clé `login.invalidCredentials` via `errorMessage()`). Langue reposée en FR à la fin (vérifié en base).
  - Livreur (`npx expo start --web --port 5341`, compte `driver.lot1@golink.test`, `acceptedLegal`/`consents` vides sur ce compte avant le test) : connexion → écran de blocage CGU affiché immédiatement (version `2026-06` du document `terms_driver` publié réel, pays FR par défaut) → « J'accepte les conditions » cliqué → accès débloqué (`DispatchScreen` affiché) → `acceptedLegal.terms_driver` écrit réellement en base (`"2026-06"`, vérifié) → bandeau cookies affiché ensuite → « Tout accepter » cliqué → `consents:{analytics_cookies:true,marketing_email:true}` écrit réellement en base (vérifié) → app fonctionnelle ensuite (tab bar, écran hors-ligne).
- Aucun mot de passe de compte partagé modifié (comptes utilisés : `client.mobilerecompte@golink.test`, `driver.lot1@golink.test`, tous deux dédiés aux tests, pas dans la liste des comptes partagés sensibles).
- **Reste ouvert (documenté honnêtement)** : priorité 3 client de `mobile-i18n-en-ar-3` inchangée ; le document `terms_driver-fr-2026-06` en base contient encore l'ancien nom « GoLink » dans son contenu (donnée de test marquée « version de démonstration à valider par le conseil juridique », pas du code — hors périmètre de correction) ; onglet admin « Acceptations » reste un tableau plat.

## 12. Légal/RGPD étendu au restaurant et au livreur (tâche `legal-rgpd-restaurant-livreur`, 2026-09-29)

§29 du cahier super admin restait la rubrique la plus faible : réacceptation forcée des CGU et bandeau cookies n'existaient que côté client (`cdc-mobile-recompte`) ; le restaurant avait déjà un écran RGPD self-service (`apps/restaurant/src/features/documents/GdprSection.tsx`, ajouté par une tâche antérieure non documentée ici sous ce nom — retrouvé par inventaire en tête de tâche, non refait) ; le livreur n'avait rien. Réutilise exclusivement les Cloud Functions déjà prêtes (`functions/src/platform/gdpr.ts` : `acceptLegalDocument`, `setConsent`, `submitGdprRequest`, `getGdprExportLink`), aucune nouvelle fonction serveur.

- **Restaurant — réacceptation CGU + cookies (mission points 1 et 2)** : `apps/restaurant/src/features/legal/{hooks.ts,LegalGate.tsx}` (nouveau), adaptation web fidèle de `apps/client/src/features/legal/LegalGate.tsx` (React Native) — même logique (comparer `users/{uid}.acceptedLegal.terms_restaurant` à la dernière version publiée de `legalDocuments` type `terms_restaurant` pour le pays de l'établissement actif, bloquer l'accès sinon ; bandeau cookies non bloquant si `consents.analytics_cookies` jamais renseigné), jamais dupliquée côté serveur. Branché comme route guard React Router dans `apps/restaurant/src/app/router.tsx`, entre `<AccessGate/>` (résout l'établissement actif, dont `countryId`) et `<Shell/>`.
- **Livreur — demandes RGPD (mission point 3)** : `apps/driver/src/features/gdpr/{hooks.ts,GdprScreen.tsx}` (nouveau), miroir de `apps/restaurant/src/features/documents/GdprSection.tsx` — 5 types de demande (accès/portabilité/rectification/effacement/opposition), liste des demandes déjà déposées, téléchargement de l'export une fois traité. `submitGdprRequest` sans `restaurantId` classe déjà la demande en `subjectType: 'driver'` côté serveur pour un compte `role === 'driver'` (branche déjà présente, jamais exercée avant ce lot) : aucune Cloud Function à ajouter. Accessible depuis Profil → « Données personnelles (RGPD) » (`navigation/{types,MainStack}.tsx` : route `Gdpr` ajoutée).
- **Effacement RGPD (mission point 3, restaurant)** : déjà réel avant ce lot (`GdprSection.tsx` existant), non retouché.
- **Admin — écran « qui a accepté quoi » (mission point 4, atteint)** : `apps/admin/src/features/a-plateforme-securite/{hooks.ts,LegalRgprPage.tsx}` — nouveau hook `useLegalAcceptances` (les 300 dernières preuves `legalAcceptances`, tri unique `acceptedAt` sans filtre : aucun index composite à ajouter) et nouvel onglet « Acceptations » (compte, public, document, version, date d'acceptation, recherche par compte/version, filtre par type de document). Filtrage côté client (volume limité), pas de nouvel index Firestore.
- **Piège trouvé et corrigé avant tout test à l'écran** : `apps/driver/src/features/gdpr/hooks.ts` filtrait d'abord `where('subjectId','==',uid)` seul avec `orderBy('receivedAt','desc')` — Firestore a refusé la requête (index composite manquant, confirmé par un appel Admin SDK direct). Corrigé en reprenant exactement la forme de requête déjà utilisée par le restaurant (`subjectType`+`subjectId`+`orderBy(receivedAt)`), qui correspond à un index déjà déployé (`firebase/firestore.indexes.json`) — aucun déploiement d'index nécessaire.
- `npx tsc --noEmit -p apps/restaurant`, `-p apps/driver`, `-p apps/admin` : VERT (3/3).
- **Tests réels effectués** (un seul serveur/navigateur à la fois, ports dédiés `VITE_CACHE_DIR` distincts) :
  - Restaurant (`npm run dev -w @golink/restaurant -- --port 5183`, compte `sofia.martin@golink.test`) : bandeau cookies vérifié d'abord sur `mina.haddad@golink.test` (déjà connectée dans le navigateur) — « Tout accepter » cliqué, écriture Firestore réelle vérifiée (`consents:{marketing_email:true,analytics_cookies:true}` + 2 documents dans `users/{uid}/consents`). Puis réacceptation CGU testée sur `sofia.martin@golink.test` : `acceptedLegal.terms_restaurant` temporairement mis à une ancienne version fictive sur ce seul compte de test (jamais la version publiée réelle, partagée par tout le réseau — script `scripts/test-legal-restaurant-setup.mjs`, modes `downgrade`/`restore`/`check`), connexion → écran de blocage affiché (version 2026-06, résumé « Première version »), « J'accepte les conditions générales » cliqué → accès débloqué → `acceptedLegal.terms_restaurant` revenu à `2026-06` en base (vérifié), bandeau cookies affiché ensuite et accepté. Aucun compte partagé laissé dans un état dégradé.
  - Livreur (`npm run web -w @golink/driver -- --port 5188`, compte `driver.lot1@golink.test`) : écran « Données personnelles » atteint depuis Profil, 5 boutons de demande affichés, « Demander : Droit d'accès » cliqué (spinner réel) → écriture Firestore vérifiée par script (`gdprRequests`, `subjectType:'driver'`, `status:'received'`) — preuve que la Cloud Function a bien été appelée en conditions réelles. Bug d'index (ci-dessus) trouvé et corrigé après ce test, avant tout autre test. Demande de test supprimée ensuite pour ne pas polluer la file RGPD réelle.
  - Admin (`npm run dev -w @golink/admin -- --port 5184`, compte `superadmin@golink.test`) : onglet « Acceptations » de `/plateforme/legal-rgpd` vérifié à l'écran — trouve bien l'acceptation `test-manager-mina` (Commerce, Conditions partenaires restaurants, 2026-06) déposée pendant ce même test ; recherche par identifiant de compte vérifiée (filtre en direct, « 1 sur 1 acceptations »).
- Tous les serveurs arrêtés par leur PID exact (jamais de `taskkill` global), ports 5183/5184/5188 revérifiés libres. Aucun mot de passe de compte partagé modifié.
- **Reste ouvert à la fin de ce lot** : le **livreur** n'a pas de réacceptation CGU/cookies (app mobile ; aucun document `terms_driver` n'est aujourd'hui consommé par une app — nécessiterait un écran de blocage équivalent) ; le **client** n'a pas d'écran de dépôt de demande RGPD (seuls réacceptation CGU et cookies existent côté client, `cdc-mobile-recompte`) ; l'onglet admin « Acceptations » est un tableau plat sans fiche détaillée par personne ni export.
  - ✅ **Les deux premiers points ont été fermés par la tâche `mobile-i18n-residuals` (30/09)** : réacceptation CGU + bandeau cookies côté livreur (`apps/driver/src/features/legal/`), et écran de dépôt de demande RGPD côté client (`apps/client/src/features/gdpr/`) — voir la nouvelle sous-section « Lot `mobile-i18n-residuals` » en fin de « 10 ter » pour le détail complet et les tests réels. Seul reste ouvert : l'onglet admin « Acceptations », toujours un tableau plat.

## 13. Parité structurelle Commandes et Options & listes avec la maquette Replit (tâche `restaurant-orders-options-parity`, 2026-10-01)

Retour client direct avec captures d'écran : les rubriques « Commandes » et « Options & listes » du back-office restaurant ne correspondaient pas à l'architecture de la maquette de référence (https://golink-test.replit.app/), alors qu'elles le doivent exactement (le skin visuel sombre, lui, était déjà aligné par la tâche `restaurant-design-parity`). Comparaison faite en rouvrant la maquette dans le navigateur intégré (page `/commandes`, détail d'une commande, menu « Carte & menu » → Options & listes, édition d'une option et d'une liste) avant tout code.

- **Nouveau composant partagé** : `packages/ui/src/components/display.tsx` exporte désormais `PageBanner` (bandeau de mise en avant : eyebrow à puce, titre avec point coloré, description, actions — fond `bg-sidebar`/`text-sidebar-fg`, pas `bg-contrast` qui est volontairement clair même en mode sombre dans ce thème et aurait donné un bandeau blanc). Aucun composant de ce type n'existait avant (vérifié : `OptionsPage.tsx` et `AccueilPage.tsx` utilisaient le simple `PageHeader`, pas un bandeau sombre) — créé une fois, utilisé par les deux pages concernées.
- **Commandes** (`apps/restaurant/src/features/commandes/`) :
  - `components/OrdersLayout.tsx` : `PageBanner` au lieu de `PageHeader` ; 2 onglets (En cours / Historique) au lieu de 3 ; bouton « Suivi des livreurs » dans les actions du bandeau, ouvre `/commandes/suivi` (route et `LivePage.tsx` conservés à l'identique — fonctionnalité réelle de suivi en direct des livreurs non perdue, seulement sortie des onglets) ; nouvelle prop `showLiveTrackingLink` (à `false` sur `LivePage.tsx` pour ne pas pointer vers soi-même).
  - `lib.ts` : `SUMMARY_TILES` (tuiles En cours/À traiter/En préparation/Prêtes — logique de comptage déduite et vérifiée contre les chiffres réels affichés par la maquette : En cours = total actif, À traiter = nouvelles+acceptées, En préparation = en cuisine, Prêtes = prêtes+assignées) et `STATUS_FILTERS` (Tous les statuts/Nouvelles/Acceptées/En préparation/Prêtes/Assignées/En livraison — dernier statut ajouté pour ne perdre aucun statut réel même absent des données de démonstration de la maquette). `LANES`/`laneOf` conservés tels quels (toujours utilisés par `AccueilPage.tsx`, hors périmètre).
  - `components/OrderListRow.tsx` (nouveau) : ligne compacte (numéro, client + articles, service, délai/statut, total, action rapide, épingle) remplace la grille de cartes kanban. `components/OrderCard.tsx` supprimé (plus aucun importeur après la bascule).
  - `OrdersPage.tsx` : réécrite — tuiles, recherche, filtre par mode de service migré en filtre secondaire (aucune exigence prioritaire trouvée dans `docs/DECISIONS_CLIENT.md`), puces de filtre par statut avec compteur, liste compacte au lieu des colonnes kanban. La bascule « Colonnes/Liste » a été supprimée (toujours liste, comme la référence).
  - `components/OrderDetail.tsx` : restructurée en 2 colonnes numérotées « 01 / Le panier » (panier + note client + chronologie) et « 02 / Récapitulatif » (nouveau bloc compact Client/Service/Total + bloc « Demande de livreur indépendant », PUIS les blocs existants Client/Livraison/Paiement/Votre part CONSERVÉS en dessous, aucune donnée réelle supprimée) ; actions déplacées en pied de fiche sticky (Imprimer / action principale selon statut / Annuler, mêmes conditions qu'avant) ; menu « ... » réduit à Copier le numéro/Signaler un problème. Reste une modale/tiroir (`Sheet` via `?commande=`) comme avant, deep-link non cassé ; `OrderPage.tsx` (page pleine page `/commandes/:orderId`, pour les liens de notification) inchangée, réutilise le même composant restructuré.
  - Préfixe de numéro de commande (« GL- ») : **vérifié, non modifié**. Ce n'est pas un reste de marque GoLink oublié : `docs/DECISIONS_CLIENT.md` (§ Organisation et marchés, l.69) documente une décision de marque explicite et déjà actée — le cahier client prend l'exemple « SL- » (marque de la maquette Replit d'origine), mais Ciyou Eats garde son propre préfixe « GL- » (`formatOrderNumber`, `packages/shared/src/utils/ids.ts`). Conforme à la décision qui fait foi, donc non touché.
- **Options & listes** (`apps/restaurant/src/features/options/OptionsPage.tsx`) : réécrite — 2 sections repliables empilées sur la même page (Options individuelles PUIS Listes d'options, avec compteur dans l'en-tête de chaque section) au lieu de 2 onglets séparés. Les options individuelles passent d'un tableau façon fiche verbeuse à des cartes compactes en grille (nom, prix, interrupteur Actif, menu « ... » Modifier/Supprimer), alignées sur la maquette. La sélection multiple et les actions groupées (Activer/Désactiver/Supprimer, qui existaient via le tableau) sont conservées via un bouton « Sélectionner » qui bascule les cartes en mode sélection — aucune fonctionnalité réelle perdue. Les listes d'options (déjà en cartes compactes avant cette tâche) sont inchangées dans leur présentation, seulement sorties de l'onglet séparé. `OptionDialog.tsx`/`GroupDialog.tsx` vérifiées contre la maquette (nom + prix + case active ; nom + options à cocher + choix multiple + min/max + case active) : déjà conformes, aucun écart trouvé.
- `npx tsc --noEmit -p apps/restaurant/tsconfig.app.json` et `-p packages/ui/tsconfig.json` : VERT (2/2).
- **Tests réels effectués** (un seul serveur/navigateur à la fois ; serveur de dev `apps/restaurant` déjà en cours sur le port dédié 5183 — entrée `golink-restaurant-parity` existante, réutilisée sans en relancer un second ; non arrêté en fin de tâche car non démarré par cette tâche, conformément à la règle « ferme uniquement le PID que tu as lancé toi-même » ; onglet navigateur fermé en fin de tâche) : connecté en réel avec `mina.haddad@golink.test` (session déjà active), établissement Lune Coffee avec données réelles. Commandes : bandeau + 2 onglets + 4 tuiles (comptages corrects : 3 En cours = 3 En préparation, 0 ailleurs) + puces de statut (comptages cohérents) + liste compacte affichée, 3 commandes réelles cliquées (GL-12875/12876/12877) → modale 01/02 ouverte avec les bonnes données (panier réel, client réel, paiement réel, chronologie réelle, votre part réelle), pied de page sticky avec Imprimer/+Temps/Marquer prête/Annuler fonctionnel. Historique : bandeau cohérent, données réelles affichées. Bouton « Suivi des livreurs » → `/commandes/suivi` vérifié fonctionnel (carte réelle, bouton absent sur cette page comme prévu). Options & listes : bandeau, section Options individuelles (15 options réelles en cartes compactes, mode Sélection testé), section Listes d'options (3 listes réelles) ; une option réelle (« Sirop vanille ») et une liste réelle (« Garnitures brunch ») ouvertes en édition → données réelles correctement chargées, dialogues fermés sans modification (aucune donnée altérée). Aucune commande/option/liste réelle perdue ou mal affichée pendant la bascule.
- **Observation hors périmètre, non corrigée** : un événement de chronologie d'une commande réelle affiche encore l'acteur « GoLink » (`Automatique · GoLink`) — c'est une donnée déjà stockée en base (résidu de données de test antérieures à l'adoption de la marque Ciyou Eats), pas du code généré par cette tâche ni touché par elle ; aucune occurrence de « GoLink » trouvée dans le code source des fichiers modifiés par cette tâche (`grep` vérifié).
