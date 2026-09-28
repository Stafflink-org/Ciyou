# Déploiement — Stafflink-org/Ciyou

Document de suivi du dépôt [Stafflink-org/Ciyou](https://github.com/Stafflink-org/Ciyou) : historique des PR, état réel de mise en production, accès de test.

## 1. État de mise en production

**Rien n'est encore déployé en ligne pour Ciyou à ce jour.** Le code est sur `main` du dépôt, testé localement (voir §3), mais aucun serveur de production n'a encore été mis en place côté Ciyou — la mise en ligne (Coolify, VPS, domaine) était en préparation sur l'ancienne organisation et reste à refaire ici. Priorité confirmée : **le back-office super admin (`apps/admin`) en premier**, les autres apps (`apps/restaurant`, `apps/client`, `apps/driver`) restent dans le dépôt mais ne sont pas encore construites/déployées.

À mettre à jour ici dès qu'un premier déploiement réel a lieu : URL, date, méthode (Coolify/Docker), résultat des tests post-déploiement.

## 2. Historique des PR (une par fonctionnalité, fusionnées dans l'ordre chronologique réel)

| PR | Date | Contenu |
|---|---|---|
| [#2](https://github.com/Stafflink-org/Ciyou/pull/2) | 25/09 | Monorepo initial : apps mobiles, back-offices, config Firebase |
| [#3](https://github.com/Stafflink-org/Ciyou/pull/3) | 27/09 | Packages partagés : modèles métier, i18n (FR/EN/AR RTL), kit UI |
| [#4](https://github.com/Stafflink-org/Ciyou/pull/4) | 27/09 | Cloud Functions et règles Firestore/Storage : argent, sécurité, fraude, RGPD, automatismes, traduction |
| [#5](https://github.com/Stafflink-org/Ciyou/pull/5) | 27/09 | App super admin : couverture du cahier, 2FA, journal d'audit, finance, réglages |
| [#6](https://github.com/Stafflink-org/Ciyou/pull/6) | 27/09 | Back-office restaurant : i18n, adoption du kit partagé, corrections de mise en page |
| [#7](https://github.com/Stafflink-org/Ciyou/pull/7) | 27/09 | Documentation, déploiement (Coolify/Docker), scripts de maintenance |
| [#8](https://github.com/Stafflink-org/Ciyou/pull/8) | 27/09 | Correctif : clé i18n non traduite affichée en clair (GeoScope) |
| [#9](https://github.com/Stafflink-org/Ciyou/pull/9) | 27/09 | Clés Google Maps configurables depuis le super admin, correctif IAM de déploiement ciblé |
| [#10](https://github.com/Stafflink-org/Ciyou/pull/10) | 27/09 | Clés Google Maps configurables (web et mobile, chiffrées) |
| [#11](https://github.com/Stafflink-org/Ciyou/pull/11) | 27/09 | Changement de marque vers Ciyou Eats : logo, favicon, textes |
| [#12](https://github.com/Stafflink-org/Ciyou/pull/12) | 27/09 | Super admin : correctifs de recherche (préfixe facture, mots-clés commerce, téléphones livreurs LU) |
| [#13](https://github.com/Stafflink-org/Ciyou/pull/13) | 27/09 | Super admin : réglages plateforme des commandes, suivi espèces, notice commerce, limites export/sécurité |
| [#14](https://github.com/Stafflink-org/Ciyou/pull/14) | 27/09 | Devise par restaurant (fixée à la validation), e-mail de création de mot de passe à l'approbation |
| [#15](https://github.com/Stafflink-org/Ciyou/pull/15) | 27/09 | Restaurant : passe zéro débordement (kit partagé, durcissement de l'outil d'audit) |
| [#16](https://github.com/Stafflink-org/Ciyou/pull/16) | 27/09 | Restaurant : plafond de commandes simultanées, visibilité, erreurs de panier typées, offres produits, historique espèces |
| [#17](https://github.com/Stafflink-org/Ciyou/pull/17) | 27/09 | Contrôle final restaurant : build/règles/fonctions vérifiés, redéployés |
| [#18](https://github.com/Stafflink-org/Ciyou/pull/18) | 28/09 | Offres produits : intégration au devis, écran restaurant, visibilité, supervision admin |
| [#19](https://github.com/Stafflink-org/Ciyou/pull/19) | 28/09 | Vente au poids / prix variable : calcul réel, ajustement en cuisine, remboursement automatique |
| [#20](https://github.com/Stafflink-org/Ciyou/pull/20) | 28/09 | **Correctif critique paiement** : les commandes auto-acceptées n'encaissaient jamais le paiement Stripe |
| [#21](https://github.com/Stafflink-org/Ciyou/pull/21) | 28/09 | Restaurant : navigation restructurée en hubs (Paiement, Marketing, Paramètres) |
| [#22](https://github.com/Stafflink-org/Ciyou/pull/22) | 28/09 | Correctif : restauration du nom de marque Ciyou Eats |
| [#23](https://github.com/Stafflink-org/Ciyou/pull/23) | 28/09 | Super admin : points secondaires cahier — croissance et plateforme/sécurité |
| [#24](https://github.com/Stafflink-org/Ciyou/pull/24) | 28/09 | Super admin : points secondaires cahier — reste |
| [#25](https://github.com/Stafflink-org/Ciyou/pull/25) | 28/09 | Super admin : dernier lot de points secondaires (clôture de la série) |
| [#26](https://github.com/Stafflink-org/Ciyou/pull/26) | 28/09 | Retotalisation du document questions-réponses client (36 réponses) |
| [#27](https://github.com/Stafflink-org/Ciyou/pull/27) | 28/09 | Vérification manuelle : 2 bugs réels trouvés et corrigés (sessions admin) |
| [#28](https://github.com/Stafflink-org/Ciyou/pull/28) | 28/09 | Super admin : points restants non bloqués par le mobile |
| [#29](https://github.com/Stafflink-org/Ciyou/pull/29) | 28/09 | App client mobile : lot 1, fondations |
| [#30](https://github.com/Stafflink-org/Ciyou/pull/30) | 28/09 | README : marchés étendus (Belgique, Algérie) |

*(PR #1 : import initial en un seul bloc, retiré immédiatement après coup — voir son commentaire. Le contenu réel de `main` correspond aux PR #2 à #30 ci-dessus.)*

État fonctionnel détaillé du super admin (ce qui est fait, ligne par ligne du cahier client) : voir `docs/AUDIT_COUVERTURE_CDC.md` et `docs/ETAT_AVANCEMENT.md`.

## 3. Accès de test (base Firebase partagée)

Le backend (authentification, base de données, fonctions serveur) est **un seul projet Firebase partagé par toutes les apps** : `golink-9f16d`, région `europe-west1`.

### Accès console Firebase

Pour que l'équipe puisse consulter/tester directement dans la console Firebase (Firestore, Auth, Functions, logs), chaque personne concernée doit être invitée comme membre du projet — rôle Éditeur pour développer, Lecteur pour consulter seulement. Cette invitation se fait depuis la [console Firebase](https://console.firebase.google.com/project/golink-9f16d/settings/iam) ou la [console Google Cloud IAM](https://console.cloud.google.com/iam-admin/iam?project=golink-9f16d), par le propriétaire/administrateur du compte du projet.

### Tester en local contre la vraie base

```bash
npm install
npm run dev:admin        # http://localhost:5174 — back-office super admin
npm run dev:restaurant   # http://localhost:5173 — back-office restaurant
```

Ces commandes démarrent un serveur de développement branché sur `golink-9f16d` (pas un émulateur) : les données et connexions sont réelles.

### Comptes de test

Les mots de passe ne sont **jamais commités** (fichier local `.test-accounts.local.md`, régénéré par `npm run seed`). Comptes disponibles par rôle :

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

Mots de passe transmis séparément (jamais dans un dépôt public). `npm run seed` régénère un jeu de données de démonstration complet (destructeur avec `--reset`).
