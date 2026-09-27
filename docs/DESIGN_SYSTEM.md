# GoLink — Design system des back-offices

Référence visuelle et technique partagée par `apps/restaurant` (back-office restaurant) et `apps/admin` (super admin).
Tout est implémenté dans le package **`@golink/ui`** (`packages/ui`) : jetons CSS, thème Tailwind v4 et bibliothèque de composants React accessibles (Radix UI).

Vitrine vivante : `npm run dev:admin` puis <http://localhost:5174/_ui> (`?theme=admin`, `?theme=restaurant`, `?theme=restaurant-dark`). Servie uniquement en développement.

---

## 1. Intention

- **Premium et sobre** : densité d'un SaaS haut de gamme (Linear, Stripe Dashboard), aucune décoration gratuite. La couleur signale un état ou une action, jamais un ornement.
- **Chaleur de la marque** : on garde l'ADN de la maquette (crème, pétrole, orange) mais raffiné — neutres chauds, contrastes AA, ombres teintées pétrole très diffuses.
- **Deux thèmes, un seul code** : les composants ne consomment que des jetons sémantiques ; changer de thème = changer un attribut sur `<html>`.
- **Chiffres d'abord** : montants, compteurs et identifiants en chiffres tabulaires ; les KPI utilisent la police de titre.

## 2. Thèmes

| Thème | Attribut | Usage | Caractère |
|---|---|---|---|
| Restaurant (défaut) | `data-theme="restaurant"` | Back-office restaurant | Clair, crème chaleureux, sidebar pétrole |
| Restaurant sombre | `data-theme="restaurant" data-mode="dark"` | Service du soir, préférence utilisateur | Pétrole profond, orange lumineux |
| Admin | `data-theme="admin"` | Super admin | Sombre premium quasi noir-pétrole, accent orange GoLink |

```ts
import { applyTheme, useColorMode } from '@golink/ui';
applyTheme('admin');                    // dans main.tsx, avant le rendu
const { mode, toggle } = useColorMode(); // restaurant : clair / sombre mémorisé
```

`index.html` porte déjà `data-theme` pour éviter tout flash au chargement. La variante Tailwind `dark:` cible le thème admin et le mode sombre restaurant.

## 3. Couleurs

### 3.1 Palettes (50 → 950)

Les couleurs par défaut de Tailwind sont **retirées** (`--color-*: initial`) : seules ces échelles existent (`bg-brand-500`, `text-petrol-900`…).

| Échelle | 500 | Rôle |
|---|---|---|
| `brand` | `#e8784b` | Orange GoLink : action principale, élément actif, focus |
| `petrol` | `#497478` (900 `#19343b`) | Encre de la marque : texte, sidebar restaurant |
| `cream` | `#b6a78e` (100 `#f8f4ec`) | Neutres chauds : fonds, bordures |
| `ink` | `#58696c` (950 `#0a1012`) | Neutres sombres du thème admin |
| `sage` | `#4a846c` | Succès, livré, actif |
| `amber` | `#e09b24` | Alerte, en préparation, en pause |
| `ruby` | `#d6533f` | Erreur, annulé, suspendu |
| `azure` | `#4a7fbb` | Information, en livraison |
| `plum` | `#9467a5` | Livreur, récupérée, essai |
| `teal` | `#31968b` | Prête, série secondaire des graphiques |

Valeurs complètes : `packages/ui/src/styles/index.css`.

### 3.2 Jetons sémantiques (à utiliser dans le code applicatif)

| Utilitaire | Rôle | Restaurant | Admin |
|---|---|---|---|
| `bg-canvas` | Fond de l'application | `#f6f2ea` | `#0a1012` |
| `bg-surface` | Cartes, tableaux, champs | `#fffdf9` | `#10181b` |
| `bg-surface-2` | En-têtes de tableau, pieds de carte | `#faf6ef` | `#131d20` |
| `bg-surface-3` | Survol, pistes, puces neutres | `#f2ece1` | `#19252a` |
| `bg-elevated` | Menus, popovers, infobulles | `#ffffff` | `#152024` |
| `border-border` / `border-border-strong` | Séparateurs / contours de champs | `#e8e0d2` / `#d8cebc` | `#1d2a2e` / `#2a393e` |
| `text-fg` / `text-fg-muted` / `text-fg-subtle` | Texte principal / secondaire / tertiaire | `#19343b` / `#587070` / `#879793` | `#eef2f1` / `#98a9a9` / `#677a7c` |
| `bg-primary` + `text-primary-fg` | Action principale | `#e8784b` sur `#1c0d06` | `#ee8456` sur `#1c0d06` |
| `bg-primary-soft` + `text-primary-soft-fg` | Mise en avant douce, liens | | |
| `bg-contrast` + `text-contrast-fg` | Bouton inversé (fort contraste) | pétrole / crème | clair / noir |
| `bg-danger`, `bg-danger-soft`… | Actions destructives | | |
| `bg-sidebar`, `text-sidebar-fg`, `text-sidebar-muted` | Navigation latérale | `#17323a` | `#0c1315` |
| `chart-1` … `chart-6` | Séries de graphiques | orange, pétrole, ambre, sauge, prune, azur | versions lumineuses |

Texte sur orange : **encre foncée** (`#1c0d06`, contraste 5,8:1) et non blanc (3,3:1, insuffisant) — choix délibéré, conforme WCAG AA.

### 3.3 Tons

Badges, pastilles, KPI, timeline, marqueurs de carte partagent 8 tons : `neutral`, `brand`, `amber`, `success`, `danger`, `info`, `plum`, `teal`. La classe `tone-<nom>` définit `--tone-fg`, `--tone-bg`, `--tone-border`, `--tone-solid`, adaptés automatiquement au thème (fond 50 / texte 700 en clair ; fond translucide / texte 300 en sombre).

```tsx
<div className="tone-danger bg-(--tone-bg) text-(--tone-fg)">…</div>
```

### 3.4 Statuts de commande

Source unique : `ORDER_STATUS` (clés = statuts stockés en base) et `<StatusBadge status="…" />`.

| Clé | Libellé | Ton |
|---|---|---|
| `pending` | Nouvelle (point animé) | brand |
| `accepted` | Acceptée | neutral |
| `preparing` | En préparation | amber |
| `ready` | Prête | teal |
| `picked_up` | Récupérée | plum |
| `delivering` | En livraison (point animé) | info |
| `delivered` | Livrée | success |
| `cancelled` | Annulée | danger |
| `refunded` | Remboursée | neutral |

Statuts de compte (restaurants, livreurs, clients, abonnements) : `ACCOUNT_STATUS` — `active`, `online`, `offline`, `paused`, `pending`, `onboarding`, `suspended`, `banned`, `trial`, `past_due`, `cancelled`, `draft`.

## 4. Typographie

Polices auto-hébergées via Fontsource (aucun appel à Google Fonts : pas de transfert d'IP vers un tiers, RGPD, fonctionne hors ligne).

| Famille | Classe | Usage |
|---|---|---|
| **DM Sans** (variable) | `font-sans` (défaut) | Texte courant, libellés, boutons, cellules |
| **Space Grotesk** (variable) | `font-display` | Titres, chiffres clés des KPI, logo |
| **DM Mono** 400/500 | `font-mono` | Sur-titres (`eyebrow`), en-têtes de tableau, montants alignés, horodatages, raccourcis |

Choix conservés de la maquette : le trio a une vraie personnalité (géométrie de Space Grotesk, chaleur de DM Sans) et DM Mono donne la signature « ticket de caisse » aux données.

Échelle (taille / interligne), base à 14 px pour la densité SaaS :

| Classe | Taille | Usage |
|---|---|---|
| `text-3xs` | 10 / 14 | Eyebrows, en-têtes de tableau |
| `text-2xs` | 11 / 16 | Méta, compteurs |
| `text-xs` | 12 / 18 | Aides, badges |
| `text-sm` | 13 / 20 | Contrôles, navigation, tableaux |
| `text-base` | 14 / 22 | Texte courant (body) |
| `text-md` | 15 / 24 | Titres de carte, descriptions de page |
| `text-lg` | 17 / 26 | Titres de section, modales |
| `text-xl` → `text-5xl` | 20 → 48 | Titres de page (28 px), KPI (30 px) |

Interlettrage : `tracking-display` (-0,035 em) pour les grands titres et KPI, `tracking-tight` (-0,02 em) pour les titres, `tracking-eyebrow` (0,14 em) pour les capitales mono. Utilitaires : `eyebrow` (sur-titre complet), `num` (chiffres tabulaires).

## 5. Espacement, grille, rayons, ombres

- **Espacement** : unité Tailwind de 4 px. Rythme : 6 (24 px) entre blocs d'une page, 10 (40 px) entre sections, 4 (16 px) de gouttière de grille, 5 (20 px) de padding de carte.
- **Grille de page** : `PageContainer` — largeur max 1280 px (1440 px en `wide`), marges 16 / 24 / 32 px. KPI en 1 → 2 → 4 colonnes, graphiques 2/3 + 1/3.
- **Hauteurs de contrôle** : 28 (xs), 32 (sm), 36 (md, défaut), 44 px (lg — cible tactile mobile).
- **Rayons** : `rounded-md` 8 px (petits contrôles), `rounded-lg` 10 px (boutons, champs, items de nav), `rounded-xl` 14 px (cartes, menus), `rounded-2xl` 18 px (modales, tiroir bas), `rounded-full` (pastilles de statut, avatars).
- **Ombres** (teintées pétrole en clair, noires + liseré en sombre) : `shadow-xs` (champs), `shadow-card` (cartes), `shadow-md` (survol), `shadow-lg` (menus, popovers), `shadow-xl` (modales, palette).
- **Mouvement** : 150 ms pour les couleurs, 220–280 ms `ease-out-soft` pour les entrées (modales, tiroirs, menus). `prefers-reduced-motion` respecté globalement.

## 6. Composants `@golink/ui`

| Famille | Composants |
|---|---|
| Structure | `AppShell` (sidebar repliable à groupes, badges, filtre de menu, tiroir mobile, topbar avec fil d'Ariane, recherche ⌘K, notifications, profil), `PageContainer`, `PageHeader`, `Section`, `Breadcrumbs`, `CommandPalette` + `useCommandShortcut`, `NotificationsButton`, `UserMenu` |
| Actions | `Button` (primary, contrast, secondary, soft, ghost, danger, danger-soft, link ; xs → lg ; `loading`, icônes, `asChild`), `IconButton` (libellé accessible obligatoire), `DropdownMenu*` |
| Formulaires | `FormField` (libellé, aide, erreur, `aria-*` câblés), `Label`, `Input` (icônes, suffixe), `Textarea`, `Select`, `Combobox` (simple / multiple, recherche), `Checkbox`, `Switch`, `RadioGroup` (liste ou tuiles), `Slider`, `DatePicker`, `DateRangePicker` (raccourcis), `Calendar`, `TimeInput`, `FileUpload` (glisser-déposer, aperçus, contrôles de format/taille) |
| Données | `DataTable` (tri, recherche, filtres à facettes, sélection multiple + barre d'actions groupées, pagination, squelettes, état vide), primitives `Table*`, `createColumnHelper` |
| Indicateurs | `StatCard` (valeur, variation colorée selon le sens, sparkline), `Card*`, `Badge`, `StatusPill`, `StatusBadge`, `ProgressBar`, `Avatar`, `AvatarGroup`, `Timeline`, `Stepper`, `Kbd` |
| Graphiques | `AreaChart`, `BarChart` (groupé, empilé, horizontal), `DonutChart` (valeur centrale, légende avec parts), `Sparkline`, `ChartLegend` — couleurs du thème, infobulles au format fr-FR |
| Surcouches | `Dialog*`, `Sheet*` (droite, gauche, bas), `ConfirmDialog` (motif obligatoire optionnel pour le journal d'audit), `Popover*`, `Tooltip`, `Toaster` + `toast` (sonner) |
| États | `EmptyState`, `Skeleton`, `Spinner` |
| Marque | `Logo` (symbole + nom, légende « Restaurant » / « Super admin »), `LogoMark` (couleur ou mono) |
| Carte | `MapContainer` (Google Maps, style clair/sombre, repli propre sans clé), `MapPin` (marqueur par ton) |
| Utilitaires | `cn`, `formatEUR` (euros ou centimes, compact), `formatNumber`, `formatPercent`, `formatDate`, `formatDateTime`, `formatTime`, `formatRelative`, `initials`, `applyTheme`, `useColorMode` |

### Règles d'usage

- Un seul bouton `primary` par zone ; les actions secondaires en `secondary` ou `ghost`.
- Toute action sensible (suspension, remboursement, modification de tarif, export) passe par `ConfirmDialog` avec `requireReason` : le motif alimente le journal d'audit.
- Les listes passent par `DataTable` avec `bulkActions` dès qu'une action unitaire existe (principe « tout se fait aussi en masse » du cahier).
- Montants : `formatEUR` + `font-mono num` en tableau, `font-display` en KPI. Jamais de formatage manuel.
- Icônes : `lucide-react`, 16 px dans les contrôles, 18 px dans la navigation (trait 1,75).
- Textes 100 % français, guillemets « », apostrophe typographique ’.

## 7. Intégration dans une application

```css
/* src/index.css */
@import "@golink/ui/styles.css";
```

```ts
// vite.config.ts : plugins [react(), tailwindcss()], alias @ → src, envDir racine du dépôt
import { AppShell, Button, DataTable, toast } from '@golink/ui';
```

Le fichier de styles importe Tailwind, les polices et les jetons, et déclare `@source` sur les composants du kit : aucune configuration supplémentaire côté application.

## 8. Logo

Symbole : tuile orange en dégradé (`#f09264` → `#e2693a`, rayon 9/32) portant un « G » tracé comme un itinéraire — la boucle part d'un point (le restaurant) et revient vers le centre (le client). Nom : « Go**Link** » en Space Grotesk 600, « Link » en orange. Déclinaisons : couleur (fonds clairs et sombres), mono (`variant="mono"`, suit la couleur du texte). Favicon : `apps/*/public/favicon.svg`.
