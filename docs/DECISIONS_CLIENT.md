# Décisions du client (font foi)

Réponses du client aux questions de l'annexe du cahier super admin et au questionnaire complémentaire (26/09/2026).
**Ces décisions priment sur toute hypothèse de docs/MODELE_ECONOMIQUE.md, docs/SCHEMA_FIRESTORE.md ou des valeurs par défaut du code.** Principe transverse : toute valeur chiffrée est un **paramètre modifiable dans le super admin** (plateforme → pays → ville → formule → commerce), jamais une constante codée en dur.

## Argent

| Sujet | Décision | Conséquence technique |
|---|---|---|
| Encaissement | Tout passe par Ciyou Eats (Stripe) puis reversement au commerce **commission déduite**. | Stripe Connect : paiement sur le compte plateforme, transferts vers les comptes connectés. |
| Assiette de la commission | Prix des articles payé par le client, **TTC**, **hors frais de livraison et hors pourboires**. | `commissionBase` = sous-total articles TTC (après remise financée par le commerce). |
| Modèle économique | **Commission OU abonnement**, à définir plus tard. | Mode de facturation paramétrable par formule et par commerce : `commission`, `subscription`, `hybrid`. |
| Commission réduite | Oui : réduite si le commerce livre lui-même, encore plus basse en retrait. Taux définis dans le super admin. | 3 taux : livraison Ciyou Eats / livreur propre / retrait. |
| Frais de service client | À définir dans le super admin. | Paramètre (valeur par défaut 0). |
| Frais d'inscription commerce | **Gratuit.** | Aucun frais d'inscription. |
| Frais bancaires (carte) | **Déduits du reversement** du commerce. | Ligne « frais de paiement » dans la répartition et le relevé. |
| Remboursements | **Le commerce paie tout, dans tous les cas.** | Imputation par défaut = commerce pour toutes les causes (règle paramétrable conservée), déduite du prochain reversement. |
| Rythme des reversements | Paramétrable (Stripe + paramètres du back-office). | Calendrier par défaut plateforme + surcharge par commerce (hebdomadaire / tous les 15 jours / mensuel). |
| Formules Basic / Pro / Premium | Rien pour l'instant (prix 0, pas de contenu, pas d'engagement, pas d'essai, pas de délai d'impayé) **mais tout doit être paramétrable** dans le super admin. | Éditeur complet de formules : prix mensuel/annuel, fonctionnalités, limites, engagement, essai, carte requise, délai avant suspension. |
| Espèces | **Uniquement si la livraison est faite par un livreur salarié rattaché au commerce comme employé.** Livreur indépendant = paiement en ligne obligatoire. | Moyen « espèces » proposé seulement si le commerce livre avec ses propres livreurs salariés ; suivi des espèces détenues par ces livreurs côté commerce. |
| Pourboires | Oui, **100 % au livreur**. | Montants proposés paramétrables. |
| Titres-restaurant | **Non.** | Désactivé. |

## Commerces

| Sujet | Décision | Conséquence technique |
|---|---|---|
| Types de commerces | **Tous** : restaurants, épiceries, boulangeries, fleuristes, pharmacies… | Type de commerce ; produits à l'unité, au poids, à prix variable ; catégories adaptées. Le « back-office restaurant » est le back-office de tout commerce. |
| Boutique propre | **Non**, uniquement l'app Ciyou Eats. | — |
| Validation des commerces | **Automatique si possible**, pilotée par le super admin. | Mise en ligne automatique quand les documents sont complets et valides (règle activable), sinon file de validation manuelle. |
| Frais de livraison et minimum | Fixés par **le commerce dans son back-office, sur sa zone de livraison**. | Zones du commerce : frais, minimum, rayon/polygone. La plateforme définit les villes et zones de service. |
| Prix différents de la salle | **Autorisé.** | Aucune contrainte. |
| Promos créées par les commerces | **Oui, sans limite.** | Pas de plafond plateforme (règle conservée mais désactivée). |
| Seuils de suspension | Inactivité : **15 jours sans commande → e-mail d'alerte automatique ; 30 jours après → retrait de la plateforme**. | Tâche planifiée ; « supprimé » = désactivation + corbeille (données légales conservées). Délais paramétrables. |
| Mise en avant payante | **Oui.** | Emplacements payants, mention « sponsorisé ». |
| Alcool | Le client est **contre la vente d'alcool** : il faut l'**empêcher**. | Interdiction plateforme : aucun produit de type boisson alcoolisée, blocage à la création/modification, détection par mots-clés (bière, vin, whisky, vodka, rhum, champagne, cidre, apéritif…) avec signalement en contrôle qualité ; fonctionnalité « vente d'alcool » éteinte et verrouillée. |

## Livraison et livreurs

| Sujet | Décision | Conséquence technique |
|---|---|---|
| Qui livre | **Les deux** : livreurs indépendants de la plateforme et livreurs propres aux commerces (salariés, rattachés comme employés). | Type de livreur `platform` / `merchant` ; les livreurs propres sont liés à une fiche employé du module RH. |
| Rémunération | **< 2 km : montant fixe ; au-delà : au kilomètre, + bonus heures de pointe.** Seuil, fixe, prix/km et bonus **paramétrables par ville**. | Remplace la formule prise en charge + km. |
| Validation des livreurs | **À la main**, sans rendez-vous, tout en ligne à l'inscription. | File de validation manuelle. |
| Véhicules | **Tous** (vélo, VAE, scooter, voiture, à pied), sans exigence particulière. | Documents véhicule seulement si motorisé. |
| Distance max | **Choisie par le livreur** dans son app. | Préférence du livreur prise en compte par le dispatch. |
| Délai d'acceptation commerce | **5 min**, puis annulation automatique + remboursement du client ; après **plusieurs commandes manquées d'affilée**, **pause automatique** du commerce. Délai et nombre paramétrables. | Tâche planifiée + compteur de commandes manquées consécutives. |
| Client absent | Le livreur attend **10 min** et appelle via l'app ; sans réponse, commande **clôturée sans remboursement**, livreur et commerce payés normalement. Délai paramétrable. | Statut de clôture « client absent ». |
| Commandes à l'avance | **Oui** (plus tard dans la journée ou un autre jour). | Commandes programmées activées. |
| Retrait sur place | **Oui, avec un code.** | `pickupCode` vérifié à la remise. |

## Clients

| Sujet | Décision |
|---|---|
| Fidélité | Non définie au lancement (programme paramétrable, éteint par défaut). |
| Parrainage | Un **commerce qui fait inscrire un autre commerce** via son lien de parrainage gagne **100 € de budget publicitaire** (crédit utilisable en mise en avant payante). Montant paramétrable. |
| Réclamation (article manquant / abîmé) | **Photo obligatoire**, avec contrôles automatiques de la photo (doublon, date, cohérence). |
| Offre entreprises | **Non.** |

## Organisation et marchés

| Sujet | Décision |
|---|---|
| Support | Assuré par l'équipe du **super admin**, **24/7**. |
| Langues | **Français, anglais, arabe** (arabe = écriture de droite à gauche). |
| Pays | **France, Belgique, Luxembourg, Algérie, Maroc, Tunisie.** Multi-devises (EUR, DZD, MAD, TND) ; Stripe n'étant pas disponible partout, prévoir des moyens de paiement locaux par pays. |
| Lancement | **Ville par ville.** Seules les villes actives sont visibles et opérables ; les autres restent en attente. |
