# Guide de revue locale (localhost)

Ce guide sert à parcourir les deux back-offices Ciyou Eats **sur votre PC**, branchés sur la vraie base
Firebase de démonstration (`golink-9f16d`), avant toute mise en ligne. Aucune donnée fictive
locale : tout ce que vous voyez existe réellement dans la base.

## 1. Prérequis

- Node.js 20 ou plus récent.
- `npm install` à la racine du dépôt (installe aussi les deux back-offices, workspaces npm).
- Un fichier `.env.local` à la racine du dépôt, avec ces variables (déjà présentes en local,
  ne pas les recopier ni les partager) :
  - `VITE_STRIPE_PUBLISHABLE_KEY` — clé publique Stripe (mode test).
  - `VITE_GOOGLE_MAPS_API_KEY` — clé Google Maps restreinte aux domaines Ciyou Eats et à `localhost`.
- Google Chrome installé (utilisé par l'outil de capture `npm run smoke`, facultatif).

## 2. Démarrer les deux back-offices

Dans deux terminaux séparés, à la racine du dépôt :

```
npm run dev:restaurant   # http://localhost:5173 (back-office restaurant)
npm run dev:admin        # http://localhost:5174 (back-office super admin)
```

Lancez `dev:restaurant` en premier : il prend le port 5173. `dev:admin` prend alors le port 5174
(affiché dans le terminal au démarrage — si un autre programme occupe déjà ces ports, Vite en
choisit un autre et l'affiche). Les deux applications lisent la même base de démonstration ; vous
pouvez les laisser ouvertes toute la session.

Pour arrêter proprement : `Ctrl+C` dans chaque terminal.

## 3. Se connecter

Ouvrez `http://localhost:5174/connexion` (super admin) ou `http://localhost:5173/connexion`
(restaurant). Les mots de passe des comptes de test sont dans `.test-accounts.local.md` à la
racine du dépôt (fichier ignoré par git, régénéré par `npm run seed`). Ne le partagez pas.

### Comptes de l'équipe interne (back-office super admin)

| Compte | Ce qu'il permet de voir/tester |
|---|---|
| `superadmin@golink.test` | Accès complet aux 6 espaces du menu (voir §4). Double authentification à ré-enrôler — voir §5. |
| `support@golink.test` | Support et litiges, tickets, chat, aide — accès limité au reste selon son rôle. |
| `finance@golink.test` | Paiements, finance et reversements, facturation/TVA, abonnements et commissions. |
| `commercial@golink.test` | Prospection (pipeline commercial, fiches prospects), annonces. |
| `metz@golink.test` | Responsable de ville : mêmes écrans qu'un admin mais filtrés sur son périmètre géographique (Metz). |

Ces 5 comptes ne sont pas enrôlés en double authentification : la connexion est directe, sans
code à saisir.

### Comptes côté restaurant (back-office restaurant)

| Compte | Ce qu'il permet de voir/tester |
|---|---|
| `mina.haddad@golink.test` | Propriétaire du groupe Maison Haddad (3 établissements) : sélecteur d'établissement, vue consolidée du groupe. |
| `sofia.martin@golink.test` | Manager de Mina Kitchen : accès complet aux écrans d'un établissement (commandes, carte, équipe, finances, marketing, configuration). |
| `youssef.karim@golink.test` | Employé cuisine de Mina Kitchen : accès restreint (tableau de bord, commandes, carte en lecture, stocks, HACCP) — pas de réglages ni de finances. |

## 4. Parcours recommandé — back-office super admin (`superadmin@golink.test`)

Le menu est organisé en 6 espaces (dans cet ordre) :

**Pilotage** — Tableau de bord (vue d'ensemble) · Alertes (seuils, notifications internes) ·
Recherche (commande, restaurant, client, facture…) · Analytics · Rapports et exports (exports
ponctuels et programmés).

**Acteurs** — Restaurants (liste, validation des inscriptions, qualité, groupes multi-établissements)
· Livreurs (liste, validation des candidatures, documents, contrôle d'identité) · Clients (fiche
client, historique).

**Opérations** — Commandes (liste, suivi en direct, anomalies) · Flotte en direct (carte des
livreurs) · Règles automatiques (règles serveur sur les commandes) · Zones et villes (polygones de
livraison) · Affichage app client (mise en avant, bannières, catégories, classement) · Avis et
notes (avis, qualité, signalements, filtre) · Support et litiges (tickets, chat, statistiques,
centre d'aide).

**Argent** — Paiements (transactions, moyens de paiement, espèces, prestataires) · Finance et
reversements (vue d'ensemble, reversements aux restaurants, répartition) · Facturation et TVA
(factures, déclarations) · Abonnements et commissions (formules, commissions, relances impayés).

**Croissance** — Promotions (codes promo, règles, ciblage) · Fidélité et parrainage · Notifications
et envois (campagnes, modèles de messages automatiques, journal d'envoi — tout est en mode
simulation, voir §6) · Annonces · Prospection (pipeline commercial, équipe commerciale).

**Plateforme & sécurité** — Paramètres généraux · Multi-pays · Fonctionnalités (interrupteurs) ·
Connexions (intégrations externes) · Traduction (Azure Translator) · Administrateurs (rôles,
invitations) · **Sécurité** (double authentification, sessions, alertes, journal d'audit — voir
§5) · Journal d'audit · Fraude · Légal & RGPD · Santé (maintenance) · Données & sauvegardes.

Pour un parcours complet : ouvrez chaque rubrique, changez de compte (`metz@golink.test` pour voir
le filtrage géographique, `support@golink.test`/`finance@golink.test`/`commercial@golink.test`
pour voir un accès restreint par rôle), et testez au moins une action de chaque écran (créer,
modifier, filtrer) pour voir le résultat se refléter dans la base.

## 5. Super admin : ré-enrôler votre double authentification

Le compte `superadmin@golink.test` a eu sa double authentification réinitialisée : il n'est plus
enrôlé, vous devez l'activer avec votre propre téléphone.

1. Connectez-vous avec `superadmin@golink.test` (aucun code demandé, le compte n'est pas encore
   enrôlé).
2. Ouvrez **Plateforme & sécurité → Sécurité**.
3. Cliquez sur **Activer**, scannez le QR code avec une application d'authentification (Google
   Authenticator, 1Password, Authy…), puis saisissez le code à 6 chiffres affiché.
4. Notez les codes de secours affichés à l'écran (utilisables une seule fois, en cas de perte du
   téléphone) : ils ne sont montrés qu'à cet instant.
5. À la prochaine connexion, un code à 6 chiffres de votre application sera demandé.

Ce parcours (connexion → écran d'enrôlement → code valide → accès, puis reconnexion → écran de
double authentification → code valide → accès) a été vérifié de bout en bout.

Si vous perdez l'accès à votre application d'authentification, un nouveau reset est possible :
`node scripts/reset-test-2fa.mjs superadmin@golink.test --apply` (ne fonctionne que pour les
comptes `@golink.test`).

## 6. Ce qui n'est PAS testable en local

- **Stripe Connect (reversements réels aux comptes bancaires des restaurants et livreurs)** :
  non activé sur le compte Stripe de démonstration. Les écrans de configuration et l'historique
  des reversements sont consultables, mais aucun virement réel n'est déclenché.
- **E-mails, SMS et notifications push** : tout est envoyé en mode simulation (« dry-run ») —
  les campagnes, messages automatiques et alertes s'enregistrent dans le journal d'envoi mais ne
  partent réellement à personne.
- **Applications mobiles client et livreur** : ce sont des applications séparées (React Native),
  hors périmètre de cette revue ; seuls les deux back-offices web sont à parcourir ici.
- **Carte Google Maps** : la clé locale autorise déjà `http://localhost:*`, la carte doit
  s'afficher normalement (vérifié). Si un écran affiche une erreur de type « RefererNotAllowedMapError »,
  rechargez la page une fois — c'est en général un incident ponctuel de chargement, pas une
  restriction de la clé.
