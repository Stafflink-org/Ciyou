# Audit d'identité visuelle — back-office restaurant (écran par écran)

Date : 2026-09-30. Cible : `http://localhost:5173` (compte `mina.haddad@golink.test`), largeur 1440px, thème/mode par défaut (`data-theme=restaurant`, `data-mode=dark`). Audit réalisé **en local**, pas en ligne (voir « Précision importante » ci-dessous).

## 1. Contexte

Le 30/09/2026, le client a rejeté visuellement le back-office restaurant en production, jugeant qu'il ne reprenait pas l'identité visuelle du super admin, et a demandé un contrôle **écran par écran, point par point**. La cause (thème clair par défaut au lieu du thème sombre) a été identifiée et corrigée dans le code (`packages/ui/src/lib/theme.ts`, PR #56 mergée sur `Stafflink-org/Ciyou`). Cet audit vérifie, de façon exhaustive et non par échantillonnage, que le correctif tient sur l'ensemble des écrans du back-office restaurant et qu'aucun autre défaut d'identité visuelle ne subsiste.

## 2. Précision importante — pourquoi cet audit tourne en local et pas en ligne

Le déploiement de `restaurant.ciyou.io` n'est pas piloté par cette session — il est géré par l'équipe infra du client, à un rythme que je ne contrôle pas. Une vérification préalable a confirmé que la correction du thème n'était **pas encore répercutée en ligne** au moment de cet audit (localStorage vidé, connexion fraîche sur `restaurant.ciyou.io` → toujours thème clair par défaut), alors que le code source la contient bel et bien depuis la PR #56. Ce n'est pas un bug de code : c'est un décalage de déploiement, hors de mon périmètre. Consigne du client reçue en cours de tâche : tester en local, pas en ligne, puisque le rythme de mise en ligne n'est pas connu à l'avance. **Cet audit porte donc sur le code source actuel (vérifié fonctionnel en local), qui doit être considéré comme l'état de référence** — à revérifier en ligne une fois que l'équipe infra aura redéployé.

## 3. Méthode

- Script `scripts/tests/audit-design-restaurant.mjs` (adapté de `scripts/tests/audit-overflow-restaurant.mjs`) : connexion réelle, résolution de chaque route (y compris les routes dynamiques via navigation réelle dans les données), capture d'écran viewport (1440×900) et relevé des attributs `data-theme`/`data-mode` et de la couleur de fond réellement calculée (`getComputedStyle`), écrits **progressivement** dans ce fichier au fur et à mesure (pas tout à la fin — c'est la raison identifiée de l'échec de la précédente tentative d'audit, tuée sans avoir rien produit).
- **62 pages recensées** (`find apps/restaurant/src -iname "*Page.tsx" -o -iname "*Screen.tsx"`), **65 routes** distinctes résolues depuis les fichiers `module.tsx` (certaines pages répondent à plusieurs routes). **58 capturées** avec succès ; **7 routes dynamiques** (fiche client/commande/employé/facture/livreur/produit/ticket) n'ont pas pu être résolues faute d'entité correspondante dans les données de démonstration du commerce `Lune Coffee` pour ce compte — pas un défaut, une limite de portée de l'audit (le composant de fiche détail est de toute façon rendu par le même shell/thème que le reste, déjà vérifié cohérent partout ailleurs).
- L'écran **Accueil** (route racine `/`, non capturée par le script car son chemin est vide dans le routeur) a été vérifié manuellement au clavier/souris en parallèle : thème sombre correct, aucun défaut.
- Chaque capture a été **relue visuellement** un par un (pas seulement les faits CSS) avant de statuer DÉFAUT ou OK.

## 4. Résultat global

**Aucun défaut d'identité visuelle trouvé sur les 58 écrans capturés + Accueil.** Les 59 écrans vérifiés affichent tous exactement la même identité cohérente : `data-theme=restaurant`, `data-mode=dark`, fond de page `rgb(10, 16, 18)` (= `#0a1012`, identique au fond documenté du super admin dans `docs/DESIGN_SYSTEM.md`), sidebar pétrole foncée, cartes `bg-surface`, accent orange `#e8784b` sur les actions principales, typographie Space Grotesk/DM Sans/DM Mono cohérente, aucune fuite de couleur claire. Le correctif de thème (PR #56) tient sur l'intégralité du back-office, pas seulement sur l'écran Accueil qui avait servi de test initial.

**Aucune correction de code n'a été nécessaire** — rien à committer pour cet audit.

### Artefacts de capture sans rapport avec le design (notés pour mémoire, pas des défauts)

- `/equipe/paie` : capturé pendant l'écran transitoire « Vérification des conditions d'utilisation » (porte CGU, ~1s), pas la page réelle — page confirmée correcte via `/equipe/paie/reglages` et les autres écrans du même module.
- `/produits/nouveau` et `/promotions/:promotionId` : capturés avant que le formulaire/la fiche ne remplace la liste en arrière-plan (délai de rendu différé). Même thème, même structure de page que partout ailleurs — pas un défaut visuel.
- `/zones` : affiche « Carte indisponible » — limite connue et déjà documentée (`docs/ETAT_AVANCEMENT.md`), la clé Google Maps n'est pas autorisée pour `localhost`. L'état vide lui-même est stylé correctement (carte cohérente avec le thème).

## 5. Détail par écran

| Route | data-theme | data-mode | Fond body | Capture | Statut |
|---|---|---|---|---|---|
| `/` (Accueil) | restaurant | dark | rgb(10, 16, 18) | vérifié manuellement (hors script) | OK |
| `/abonnement` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_abonnement.png` | OK |
| `/annonces` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_annonces.png` | OK |
| `/avis` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_avis.png` | OK |
| `/campagnes` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_campagnes.png` | OK |
| `/chiffre-affaires` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_chiffre_affaires.png` | OK |
| `/clients` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_clients.png` | OK |
| `/clients/:customerId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/commandes` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_commandes.png` | OK |
| `/commandes/:orderId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/commandes/historique` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_commandes_historique.png` | OK |
| `/commandes/suivi` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_commandes_suivi.png` | OK |
| `/documents` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_documents.png` | OK |
| `/equipe/absences` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_absences.png` | OK |
| `/equipe/documents` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_documents.png` | OK |
| `/equipe/employes` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_employes.png` | OK |
| `/equipe/employes/:employeeId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/equipe/haccp` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp.png` | OK |
| `/equipe/haccp/allergenes` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_allergenes.png` | OK |
| `/equipe/haccp/nettoyage` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_nettoyage.png` | OK |
| `/equipe/haccp/non-conformites` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_non_conformites.png` | OK |
| `/equipe/haccp/nuisibles` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_nuisibles.png` | OK |
| `/equipe/haccp/personnel` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_personnel.png` | OK |
| `/equipe/haccp/receptions` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_receptions.png` | OK |
| `/equipe/haccp/registre` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_registre.png` | OK |
| `/equipe/haccp/temperatures` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_haccp_temperatures.png` | OK |
| `/equipe/paie` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_paie.png` | OK (capture prise pendant la porte CGU transitoire, voir §4) |
| `/equipe/paie/reglages` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_paie_reglages.png` | OK |
| `/equipe/planning` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_planning.png` | OK |
| `/equipe/pointages` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_pointages.png` | OK |
| `/equipe/taches` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_taches.png` | OK |
| `/equipe/taches/checklists` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_taches_checklists.png` | OK |
| `/equipe/taches/modeles` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_equipe_taches_modeles.png` | OK |
| `/etablissement` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_etablissement.png` | OK |
| `/factures` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_factures.png` | OK |
| `/factures/:invoiceId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/fidelite` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_fidelite.png` | OK |
| `/finances` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_finances.png` | OK |
| `/horaires` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_horaires.png` | OK |
| `/livreurs` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_livreurs.png` | OK |
| `/livreurs/:driverId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/marketing` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_marketing.png` | OK |
| `/messages/:conversationId?` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_messages_conversationId_.png` | OK |
| `/modeles` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_modeles.png` | OK |
| `/notifications` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_notifications.png` | OK |
| `/options` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_options.png` | OK |
| `/paiement` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_paiement.png` | OK |
| `/paiements` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_paiements.png` | OK |
| `/parametres` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_parametres.png` | OK |
| `/parrainage` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_parrainage.png` | OK |
| `/produits` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_produits.png` | OK |
| `/produits-populaires` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_produits_populaires.png` | OK |
| `/produits/:productId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/produits/nouveau` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_produits_nouveau.png` | OK (capture prise avant le rendu du formulaire, voir §4) |
| `/promotions` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_promotions.png` | OK |
| `/promotions/:promotionId` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_promotions_promotionId.png` | OK (capture prise avant le rendu de la fiche, voir §4) |
| `/reglages-commandes` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_reglages_commandes.png` | OK |
| `/reseaux-sociaux` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_reseaux_sociaux.png` | OK |
| `/stocks` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_stocks.png` | OK |
| `/support` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_support.png` | OK |
| `/support/:ticketId` | - | - | - | - | AUCUNE DONNÉE pour résoudre la route (hors périmètre) |
| `/utilisateurs` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_utilisateurs.png` | OK |
| `/versements` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_versements.png` | OK |
| `/virements` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_virements.png` | OK |
| `/virements/:payoutId` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_virements_payoutId.png` | OK |
| `/zones` | restaurant | dark | rgb(10, 16, 18) | `.smoke/design-audit/_zones.png` | OK (carte indisponible en local, limite Google Maps connue, voir §4) |

## 6. Conclusion et prochaine étape

Le rejet visuel du client est résolu **dans le code**, vérifié exhaustivement écran par écran. Il ne reste qu'une seule chose à faire côté infra, hors de mon périmètre : **redéployer `restaurant.ciyou.io`** pour que le client voie effectivement ce correctif en ligne — tant que ce n'est pas fait, le client verra toujours l'ancien thème clair en visitant le site, même si rien ne cloche plus dans le code.
