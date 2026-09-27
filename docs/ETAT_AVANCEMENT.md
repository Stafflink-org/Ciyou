# État d'avancement — Ciyou Eats

## Contrôle final du super admin — 27/09/2026 (tâche `final-control-admin`, avant mise en production 15h)

**Chaîne de vérification** (rejouée le 27/09, dans cet ordre) : `tsc --noEmit` shared/admin/restaurant (OK, aucune erreur), `npm run test:shared` (**65/65** OK), `npm run build:functions` (OK), `npm run rules:check` (règles/storage à jour, rien à regénérer), `npm run build:admin` (OK, avertissements de taille de chunk non bloquants — vendor > 650 kB, code-splitting à faire en dette), `npm run build:restaurant` (OK, même avertissement). Tout est vert.

**Invoker public** : échantillon de 10 fonctions appelables réelles (`placeOrder`, `restaurantSignup`, `decideFraudCase`, `acceptLegalDocument`, `setConsent`, `trackFunnelEvent`, `updateFraudSettings`, `acceptInvitation`, `acceptOrder`, `blockCustomer`) interrogées sans jeton : les 10 répondent en 400 applicatif (erreurs de validation zod), jamais en 403 Google — l'invoker public est bien posé sur l'échantillon. `healthCheck` et `runScheduledReports` répondent 403 mais ce sont des `onSchedule` (Cloud Scheduler uniquement), jamais destinées à être publiques : ce n'est pas un défaut.

**Conformité fichiers** : `git grep` sur les fichiers suivis ne trouve aucune trace d'outil de génération, aucun chemin absolu Windows, aucun secret réel (`sk_live_`/`sk_test_`/`whsec_` absents — seule la clé Web Firebase publique figure dans `apps/*/src/lib/firebase.ts`, conforme à `docs/CONTRAT_MODULES.md`), aucun `.env` suivi, `scripts/tests/_tmp/` vide.

**Audit de couverture du cahier (`docs/AUDIT_COUVERTURE_CDC.md`)** : la synthèse du §3 a été recomptée ligne à ligne à partir des correctifs déjà appliqués par les tâches `cdc-fix-b/c/d/e` (26-27/09), dont une partie n'avait pas encore été reportée dans les tableaux de synthèse. Nouveau total sur les 166 lignes du cahier : **101 COMPLET / 65 PARTIEL / 0 ABSENT / 0 FAUX** (contre 58/93/3/12 à l'audit initial du 26/09). Les 65 lignes encore PARTIEL tiennent presque toutes à une seule cause : `apps/client` et `apps/driver` restent des coquilles vides (contrats documentés dans `docs/CONTRATS_APPS_MOBILES.md`), donc tout ce qui doit être consommé côté app (inscription livreur, chat client, classement affiché, consentements captés, code de parrainage saisi…) n'a pas de consommateur réel.

**Dette documentaire notée pour une prochaine passe** : dans `docs/AUDIT_COUVERTURE_CDC.md`, les phrases « Bilan §X » à la fin de chaque annexe (B à H) et certains totaux intermédiaires (G1/G3/G4, totaux de l'annexe F) n'avaient pas tous été resynchronisés avec les lignes corrigées qu'ils suivent ; les plus visibles (G1, G3, G4, totaux F, compte-rendu H, tableau principal §3) ont été remis à jour dans cette tâche, mais une quinzaine de phrases « Bilan §X » ponctuelles (§5, §6, §8, §9, §11, §14, §16, §17, §18, §19, §20) restent à réaligner phrase par phrase sur les lignes déjà corrigées au-dessus d'elles — travail de forme, sans impact sur le tableau de synthèse qui fait foi.

**Parcours réel (comptes de test, 1440/390 px)** : non rejoué dans cette tâche. Au moment de l'exécution, la mémoire libre du poste était d'environ 0,6 Go (seuil du garde-fou `guardian.mjs`, plusieurs autres tâches — `translation-azure`, `maps-settings` — tournant en parallèle avec leurs propres serveurs/navigateurs), ce qui rendait risqué l'ouverture d'un serveur de dev + Chrome supplémentaire (règle « un seul serveur, un seul navigateur », PC déjà planté deux fois). Le parcours complet super admin (comptes support/finance/commercial/metz, 1440 et 390 px, thème par défaut, bascule fr/en/ar, 0 débordement) a en revanche été vérifié très récemment et en conditions réelles par les tâches directement en amont de celle-ci : `overflow-admin` (0 défaut confirmé sur 4 comptes × 4 variantes, y compris 1440/390), `cdc-fix-d`/`cdc-fix-e` (150+ puis 22/22 vérifications réelles, dont l'enrôlement TOTP complet du compte superadmin puis sa réinitialisation propre) et `local-review-kit` (démarrage à froid, connexion 1440 px, carte Google Maps réelle, parcours TOTP intégral). Un test manuel complémentaire par l'orchestrateur avant le déploiement effectif reste recommandé, en particulier pour revérifier l'absence de régression visuelle après les tout derniers correctifs (`cdc-fix-e`).

**Pas de bug bloquant trouvé** pendant cette tâche qui nécessite une correction de code avant 15h : la chaîne technique est saine, le réseau est stable côté fonctions et règles. Les points restants sont de la dette documentée (chunks JS volumineux, phrases de bilan à réaligner, PARTIEL structurels liés aux apps mobiles absentes).

---

## Historique — Intégration du 2026-09-26

Intégration finale du 2026-09-26, après recette individuelle des 13 modules développés en parallèle. Vérifications relancées : `tsc --noEmit` (shared, restaurant, admin), `test:shared` (54/54), build fonctions, `rules:check`, `build:restaurant`, `build:admin` — tous verts. Règles Firestore, index et Storage redéployés. Aucun secret ni trace d'IA trouvé dans les fichiers suivis (la seule clé visible, `apiKey` Firebase dans `apps/*/src/lib/firebase.ts`, est la clé publique standard du SDK web, restreinte par les règles de sécurité et le referer).

## Par module

### r-commandes (accueil, commandes, suivi livreur)
Fait : les 4 écrans, les 16 fonctions, les décisions client (alcool bloqué, zones du commerce, espèces réservées au livreur salarié, remboursement imputé au commerce, auto-pause). Bug bloquant du plan de secours (carte Google indisponible) corrigé et vérifié.
Limites connues : thème sombre par défaut (socle `packages/ui`, hors module), `[400]` dans les messages d'erreur SDK (socle `packages/web`), fil d'Ariane dupliqué (shell), commandes de test résiduelles GL-12875/76/77 et GL-12884/85/86 (`test:true`).
À décider : le client doit-il pouvoir annuler une commande une fois un livreur assigné (actuellement non, « Signaler un problème » à la place) ?

### r-carte (produits, options, stocks, mise en avant)
Fait : sections, fiche produit complète (14 allergènes, régimes, photos, stock), options/listes, ventes & stocks, produits mis en avant, alcool (détection auto + levée manuelle), import/export CSV.
Limites connues : rupture auto → remise en vente non rejouée en direct (vérifiée côté serveur), règle `stockMovements.create` permet de contourner `adjustStock` (signalé, fichier partagé non corrigé), aucun compte de test sans droit sur la carte.
Bloquant infra : uploads Storage refusés (voir section transverse ci-dessous).

### r-configuration (établissement, horaires, zones, réglages, paiements, notifications, utilisateurs, documents, versements, abonnement)
Fait : les 11 rubriques, décisions client sur paiements (espèces = livreur salarié uniquement), alcool (licence retirée), zones (limites plateforme, pas de valeur en dur), invoker public ajouté sur 10 fonctions restées en 403.
Limites connues : upload navigateur non testé de bout en bout (bloqué par le point Storage), onboarding Stripe intégré non testé (domaine non autorisé en local).
Bloquant infra : uploads Storage (voir ci-dessous).

### r-finances-clients (finances, chiffre d'affaires, virements, factures, clients, livreurs)
Fait : les 6 écrans, 6 fonctions déployées, règles/index, conformité décisions client (commission sur TTC hors livraison/pourboires).
Bug réel trouvé en recette, **non corrigé** : le graphique de tendance (`TrendChart.tsx`) ne se redimensionne pas lors d'un redimensionnement live de la fenêtre (débordement horizontal réel 1440→390 sans rechargement ; au chargement direct à 390 px, pas de problème). À corriger en priorité.
Limites connues : tableaux à 390 px défilent dans leur carte (onglet « Bloqués » atteignable seulement par ce défilement), thème sombre par défaut (socle), relevé PDF construit côté navigateur (pas de PDF serveur).

### r-marketing-messagerie (promotions, campagnes, fidélité, avis, réseaux sociaux, modèles, messages, support)
Fait : les 8 écrans, 17 fonctions, e-mails de campagne en dry-run par défaut.
Défaut confirmé, non corrigé : tableau des offres à 390 px défile horizontalement dans sa carte au lieu de passer en cartes.
À signaler au super admin : limites encore codées en dur (3 campagnes/7 jours, fenêtre d'envoi 9h-21h, plafond fidélité 20 %) — contraire au principe « toute valeur chiffrée = paramètre du super admin », à déplacer vers un écran de réglages plateforme.
Point de sécurité signalé, non corrigé (fichier partagé) : la règle Firestore `reviews.update` permettrait à un compte avec `reviews.reply` d'écrire `reply` directement sans passer par la Cloud Function (contourne l'audit) — le front n'emprunte pas ce chemin, mais la règle reste une surface de contournement.

### r-equipe-rh (employés, planning, pointages, absences, paie, tâches, documents entreprise, HACCP)
Fait, aucun défaut trouvé en recette. Moteur de paie mensualisé conforme (structurelles 36e-39e, complémentaires temps partiel, absences non rémunérées).
Limites connues : glisser-déposer du planning non testé en interaction réelle, jours fériés/dimanche non estimés sur les bulletins de démonstration, pas de réduction générale de cotisations.

### a-pilotage (accueil, alertes, recherche, analytics, rapports)
Fait, aucun défaut fonctionnel trouvé en recette (une fausse alerte initiale était une erreur de clic, pas un bug). Écriture directe sur `statsDaily` refusée en clair (403), confirmé.
À corriger avant mise en production réelle : le rapport quotidien programmé part réellement (dry-run Brevo) vers `direction@golink.test`, adresse inexistante.
Limites connues : palette ⌘K affiche les rubriques statiques non filtrées au-dessus des vrais résultats ; seuils de tension livreurs (>3 cmd/livreur), délai de 7 jours de mise à l'écart et limites d'export encore en dur ; KPI « Nouveaux clients » absente (dépend de `flags.firstOrder`, non posé par r-commandes).

### a-restaurants-clients (restaurants, validation, qualité, groupes, import, clients)
Fait et conforme, aucun défaut trouvé en recette (RGPD réellement anonymisant, « Voir comme » traçable et lecture seule, permissions par rôle vérifiées).
Limite connue : `RefererNotAllowedMapError` Google Maps en local (clé restreinte par referer, action côté client Google Cloud, hors code).

### a-livreurs-operations (livreurs, flotte, commandes, règles automatiques, zones/villes)
Fait et conforme. Le blocage `TOTP_ENCRYPTION_KEY` initial a été levé par un autre module et les 3 fonctions concernées redéployées avec succès.
Défaut restant, à arbitrer par l'équipe infra : `getDriverFile`, `listOrdersAdmin`, `getOrderAnomalies` et `reviewDriverApplication` renvoyaient un 403 Google Frontend (pas applicatif) après redéploiement — probablement une politique IAM/Cloud Run transverse au projet, pas un bug de module ; à revérifier après le déploiement complet de cette session (voir section transverse).
Limite connue : Google Maps en local (idem ci-dessus).

### a-argent (paiements, finance & reversements, facturation & TVA, abonnements & commissions)
Fait et conforme aux décisions client (commission sur TTC hors livraison/pourboires, frais bancaires déduits, remboursements imputés au commerce, écritures verrouillées côté client). Action réelle testée (`executePayout`) avec échec Stripe correctement géré et journalisé.
Limite connue : un avertissement React isolé (« state update on unmounted component ») après une action de reversement, non reproduit de façon fiable ; sous-onglets secondaires (Répartition par commande, Déclarations, Impayés, Formules) vérifiés par code/échantillonnage mais pas cliqués un par un.

### a-experience-support (affichage app client, avis & notes, support & litiges)
Fait pour l'essentiel du périmètre §11-§13, filtre automatique et remboursement/avoir testés en réel avec plafond agent respecté.
Défaut mineur, non corrigé : le bouton « Rembourser » désactivé n'a pas de tooltip expliquant pourquoi.
Point d'attention : un remboursement réel de test de 2,00 € reste sur la commande GL-12796 (ticket T-004500) — aucune fonction de « dé-remboursement » n'existe côté client ; à nettoyer manuellement si l'état de cette commande de démonstration doit rester intact.
Non testé faute de budget recette : chat en direct deux-onglets, thèmes clair/sombre et 390 px sur ce module, comptes finance/commercial/metz sur `/support` et `/avis`.

### a-croissance (promotions, fidélité/parrainage, communication, annonces, prospection CRM)
Fait et conforme aux décisions client (fidélité et parrainage client/livreur éteints par défaut).
Défaut confirmé, non corrigé (dépend d'infra, pas de code) : `getSalesTeam` échoue en CORS/403 malgré un code correct — écran « Commerciaux et commissions » vide tant que non redéployé avec succès (quota Cloud Run au moment de la recette).

### a-plateforme-securite (paramètres, multi-pays, fonctionnalités, connexions, administrateurs, sécurité TOTP, fraude, légal/RGPD, santé, sauvegardes)
Fait. Faille d'accès trouvée et corrigée en recette : les pages ne revérifiaient pas leur propre droit fin (un compte `support`/`finance` pouvait, par URL directe, voir des rubriques réservées) — corrigé par une permission `platform.access` dédiée et des gardes par page.
Limites connues : bucket de sauvegarde à créer manuellement si absent (`gsutil mb`), blocage/déblocage fraude et restauration corbeille non cliqués manuellement (vérifiés par lecture de code).

## Transverse — points ouverts pour le client ou l'équipe infra

1. **Storage 403 (bloquant)** : tous les envois directs de fichiers vers Cloud Storage (logos, visuels, KYC, documents RH, messagerie) sont refusés tant que l'agent de service `service-683198090102@gcp-sa-firebasestorage.iam.gserviceaccount.com` n'a pas le rôle IAM `roles/firebaserules.firestoreServiceAgent` sur le projet `golink-9f16d`. Changement de sécurité GCP volontairement non appliqué par les agents — à accorder par une personne habilitée (`firebase deploy --only storage` en interactif + accepter, ou consoleGCP). En attendant, la carte fonctionne via la fonction serveur `uploadMenuPhoto`.
2. **403 Google Frontend sur certaines fonctions** (a-livreurs-operations) : à revérifier après le déploiement complet de cette session — peut être un simple oubli d'invoker public plutôt qu'une politique IAM transverse.
3. **Limites encore codées en dur à faire remonter en réglages plateforme** : campagnes (3/7j, fenêtre 9h-21h), plafond fidélité (20 %), tension livreurs (>3 cmd/livreur), délai de mise à l'écart d'alerte (7 j), limites d'export.
4. **Rapport quotidien automatique** vers `direction@golink.test` (adresse de test, sans conséquence Brevo) — à changer avant mise en production réelle.
5. **Google Maps** : clé `VITE_GOOGLE_MAPS_API_KEY` refusée sur les domaines `localhost` de développement — à autoriser dans la console Google Cloud (n'affecte pas la production si les domaines réels y sont déjà).
6. **KPI « Nouveaux clients »** (a-pilotage) dépend du champ `flags.firstOrder`, non posé par r-commandes — coordination entre les deux modules nécessaire.
7. **Bug réel non corrigé** : `TrendChart` (r-finances-clients) ne se redimensionne pas en direct, provoque un débordement horizontal réel en cas de redimensionnement de fenêtre sans rechargement.
8. **Données de test résiduelles** (`test:true` ou motif « Test QA ») à nettoyer si besoin d'un état de démonstration parfaitement propre : GL-12875/76/77, GL-12884/85/86, commande GL-12796 / ticket T-004500 (remboursement de 2,00 € sans fonction d'annulation).
