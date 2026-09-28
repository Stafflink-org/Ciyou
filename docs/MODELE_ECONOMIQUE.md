# Ciyou Eats — Modèle économique et moteur de tarification

Ce document décrit comment Ciyou Eats gagne de l'argent sur chaque commande, d'où viennent les valeurs par défaut et comment elles se règlent. Le calcul est implémenté dans `packages/shared/src/pricing/` : un moteur pur et testé (`npm run test:shared`), utilisé à l'identique par l'app client pour l'affichage et par les Cloud Functions pour le montant qui fait foi.

Principe retenu : même fonctionnement qu'Uber Eats, Deliveroo et Just Eat. Ciyou Eats est un **intermédiaire**. Le restaurant vend ses plats au client, et Ciyou Eats facture :

- au **restaurant** : une commission sur ses ventes, plus un abonnement selon la formule ;
- au **client** : des frais de service, des frais de livraison, et des frais de petite commande si le panier est faible.

Avec ces recettes, Ciyou Eats rémunère les livreurs indépendants et paie les frais de paiement.

> Toutes les valeurs chiffrées se règlent sans développeur depuis le super admin, à trois niveaux : `countries/{id}.pricing`, puis `cities/{id}.pricing`, puis les conditions du commerce. Les points fiscaux (TVA, DAC7, statut des livreurs) sont à faire valider par un expert-comptable, comme le demande le cahier du client.

---

## 0. Décisions du client (26/09/2026)

Source : `docs/DECISIONS_CLIENT.md`, qui fait foi. Ces décisions **remplacent** les hypothèses des sections suivantes quand elles s'y opposent ; les valeurs par défaut du code (`pricing/defaults.ts`, `pricing/plans.ts`, `pricing/decisions.ts`) et de la base (script `scripts/seed/only/decisions-client.ts`) y sont alignées.

| Sujet | Décision appliquée | Où dans le code |
|---|---|---|
| Assiette de la commission | Sous-total articles **TTC payé par le client**, après remise financée par le commerce, **hors livraison et hors pourboires** | `commission.base = subtotal_after_restaurant_discount`, `Settlement.restaurant.commissionBaseCents` |
| Taux de commission | 3 taux paramétrables : livraison Ciyou Eats / livreur propre du commerce / retrait (défauts 30 / 15 / 12 %, à fixer dans le super admin) | `commission.platformDeliveryBps`, `restaurantDeliveryBps`, `pickupBps` |
| Mode de facturation | `commission`, `subscription` (aucune commission) ou `hybrid`, par formule (`plans.billingMode`) et surchargeable par commerce (`private/commercial.billingMode`) | `resolveBillingMode`, `resolveCommissionBps({ billingMode })` |
| Frais de paiement (carte) | **Déduits du reversement du commerce** (ligne `restaurant.paymentFeeCents` de la répartition) | `payment.payer = 'restaurant'` |
| Remboursements | **Imputés au commerce pour toutes les causes**, déduits du prochain reversement ; règle toujours paramétrable | `DEFAULT_REFUND_LIABILITY` (l'ancienne règle reste disponible : `CAUSE_BASED_REFUND_LIABILITY`) |
| Frais de service client | Paramètre, **0 par défaut** | `serviceFee.enabled = false` |
| Frais de petite commande | Désactivés par défaut (le minimum est fixé par le commerce) ; paramètre conservé | `smallOrderFee.enabled = false` |
| Frais d'inscription commerce | **Aucun** | `CLIENT_DECISIONS.merchantSignupFeeCents = 0` |
| Rémunération livreur | **< 2 km : forfait ; au-delà : au km ; + bonus heure de pointe**, tous paramétrables **par ville** (`cities/{id}.pricing.courier`) ; pourboires 100 % au livreur | `courier.model = 'flat_then_per_km'`, `flatDistanceThresholdMeters`, `flatAmountCents`, `perKmCents`, `perKmMode`, `peakBonusCents` |
| Garantie horaire | Paramètre optionnel : active en France, **désactivée hors France** | `courier.hourlyGuaranteeEnabled`, `isHourlyGuaranteeEnabled` |
| Frais de livraison et minimum | **Fixés par le commerce sur ses zones** (`restaurants/{rid}/deliveryZones`) ; la plateforme ne fixe que des bornes optionnelles | `QuoteInput.merchantZone`, `pricing.merchantDelivery` (bornes), paliers plateforme en repli |
| Espèces | **Uniquement avec un livreur salarié du commerce** ; livreur indépendant = paiement en ligne obligatoire | `isCashAllowed`, `allowedPaymentMethodsFor` |
| Titres-restaurant | Désactivés | `DISABLED_PAYMENT_METHODS`, `settings/payments.methods.meal_voucher = false` |
| Alcool | **Interdit et verrouillé** : catégorie de TVA `alcohol` non sélectionnable, blocage des produits déclarés alcoolisés, signalement par mots-clés FR/EN/AR | `compliance/alcohol.ts`, `SELECTABLE_VAT_CATEGORIES`, `featureFlags/alcohol_sales.locked` |
| Règles de commande | Acceptation 5 min puis annulation + remboursement ; pause automatique après 3 commandes manquées d'affilée ; client absent : attente 10 min, clôture sans remboursement, livreur et commerce payés ; commandes programmées activées ; inactivité : alerte à 15 jours, retrait 30 jours après | `DEFAULT_ORDER_RULES`, `shouldAutoPauseMerchant`, `merchantInactivityAction`, `customerAbsentOutcome` |
| Formules Basic / Pro / Premium | Prix 0, sans contenu, sans engagement, sans essai, délai d'impayé 0, **tout paramétrable** (prix mensuel et annuel, mode de facturation, fonctionnalités, limites, engagement, essai, carte requise, délai avant suspension) | `DEFAULT_PLANS`, `Plan` |
| Parrainage | Commerce → commerce : **100 € de crédit publicitaire** (paramètre) ; parrainages client et livreur éteints | `settings/referral.restaurant` (`rewardType: 'ad_credit'`) |
| Pourboires / fidélité / offre entreprises | Pourboires activés (100 % livreur) ; fidélité éteinte ; offre entreprises : non | `CLIENT_DECISIONS` |
| Promotions des commerces | Sans limite (plafond conservé mais désactivé) | `promotions.capEnabled = false`, `settings/promotions.capsEnabled = false` |
| Pays et devises | FR, BE, LU (EUR), DZ (DZD), MA (MAD), TN (TND) ; langues fr, en, ar ; montants en **unités mineures** de la devise (millimes pour TND) | `LAUNCH_MARKETS`, `DEFAULT_PRICING_BY_COUNTRY`, `formatMoney`, `toMinorUnits` |
| Types de commerce | Restaurant, épicerie, boulangerie, fleuriste, pharmacie, autre ; vente à l'unité, au poids (prix au kg) ou à prix variable | `MERCHANT_TYPES`, `Product.saleUnit`, `pricePerKgCents`, `QuoteLineInput.saleUnit` |

### 0.1 Rémunération livreur (nouveau barème)

```
distance < seuil (2 km)  → forfait
distance ≥ seuil         → forfait + (distance − seuil) × prix au km      (perKmMode = beyond_threshold, défaut)
                           ou max(forfait, distance × prix au km)         (perKmMode = full_distance)
+ attente au-delà du temps gratuit + bonus heure de pointe (peakBonusCents) + primes des règles de pointe
+ pourboire (100 %)
```

Valeurs par défaut (hypothèses à régler par ville) : FR forfait 4,00 €, 0,80 €/km, bonus de pointe 1,00 € ; BE et LU forfait 4,50 €, 0,90 €/km ; DZ 200 DA, 40 DA/km ; MA 20 DH, 4 DH/km ; TN 6 DT, 1,2 DT/km. L'ancien barème (prise en charge + remise + km) reste disponible : `courier.model = 'pickup_dropoff_per_km'`.

### 0.2 Marchés et TVA par défaut

| Pays | Devise (décimales) | TVA normale | Plats livrés / boissons sans alcool | Épicerie | Statut |
|---|---|---|---|---|---|
| France | EUR (2) | 20 % | 10 % / 10 % | 5,5 % | Connu, à confirmer |
| Belgique | EUR (2) | 21 % | 6 % / 6 % | 6 % | **À faire valider** (réforme 2026 discutée, boissons sucrées) |
| Luxembourg | EUR (2) | 17 % | 3 % / 3 % | 3 % | Connu |
| Algérie | DZD (2) | 19 % | 19 % / 19 % | 9 % | **À faire valider** |
| Maroc | MAD (2) | 20 % | 10 % / 10 % | 7 % | **À faire valider** |
| Tunisie | TND (3) | 19 % | 13 % / 13 % | 7 % | **À faire valider** |

Stripe n'étant pas disponible au Maghreb, les frais de paiement y sont une hypothèse de prestataire local (2 %, sans part fixe). Seuls FR et LU sont ouverts (`active`) ; les autres pays sont créés inactifs, lancement ville par ville. Les taux de TVA de la catégorie `alcohol` restent renseignés pour la compatibilité mais ne sont plus utilisables.

> Les sections 2 à 4 ci-dessous décrivent le fonctionnement du moteur. Là où elles diffèrent de la section 0 (frais de service, petite commande, payeur des frais de paiement, imputation des remboursements, barème livreur, formules), **la section 0 s'applique**. Les exemples chiffrés de la section 4 ont été calculés avec les anciennes hypothèses (frais de service et petite commande actifs, frais de paiement à la charge de Ciyou Eats) ; ils restent valables comme illustration du moteur avec cette configuration.

---

## 1. Ce que font les plateformes du marché (recherche, septembre 2026)

| Élément | Constat marché | Sources |
|---|---|---|
| Commission restaurant, livraison par la plateforme | Uber Eats : 30 % HT. Deliveroo : 25 à 35 % | [Fooderise](https://www.fooderise.com/fr/plateformes/uber-eats), [commandeici](https://commandeici.com/blogs/guide-restaurateur/commission-uber-eats-grille-tarifaire-complete), [thegoodseat](https://thegoodseat.app/blog/pro/commissions-livraison-uber-eats-deliveroo-restaurant) |
| Commission, livreurs du restaurant (« marketplace ») | Uber Eats : 15 à 17 % HT | [Savoryo](https://savoryo.fr/blog/commission-uber-eats-combien-coute-vraiment) |
| Commission, retrait sur place | Environ 12 % | [deli-free](https://deli-free.fr/frais-uber-eats-restaurant) |
| Coûts ajoutés au restaurant | TVA 20 % sur la commission, frais de paiement, mises en avant payantes (+5 à 10 %) | [restaurenta](https://restaurenta.fr/blogs/blog/commission-uber-eats-vraie-marge), [monouso](https://www.monouso.fr/blog/combien-uber-eats-facture-t-il-au-restaurant/) |
| Frais de service client | Uber Eats : environ 10 % du panier. Deliveroo : 10 %, plafonnés à 3 € | [Deliveroo](https://deliveroo.fr/fr/comms/m6rzmg), [eatic](https://eatic.fr/quel-est-cout-dune-livraison-deliveroo-tarifs-frais-expliques/) |
| Frais de livraison client | Deliveroo : 0,49 à 5,99 € selon la distance et le moment | [neorestauration](https://www.neorestauration.com/article/frais-de-livraison-deliveroo-fait-l-effort-aupres-des-consommateurs,52428), [parrainduweb](https://parrainduweb.fr/blog/deliveroo-france) |
| Frais de petite commande | Uber Eats : forfait d'environ 2 €. Deliveroo : l'écart jusqu'au minimum | [Uber Eats FR sur X](https://x.com/ubereats_fr/status/1529132266399596548), [code-parrainage](https://www.code-parrainage.org/alimentation-food/code-parrainage-deliveroo.html) |
| Rémunération livreur par course (Uber Eats FR) | Environ 2 € de prise en charge, 1 € de remise, 0,76 à 0,85 €/km, minimum de 3 € par course depuis 2025. Majorations en heure de pointe, primes météo, pourboires reversés à 100 % | [Legalstart](https://www.legalstart.fr/fiches-pratiques/salaire-uber-eats/devenir-livreur-uber-eats/), [fluxmicro](https://fluxmicro.fr/blog/combien-gagne-livreur-uber-eats), [Oasis](https://www.oasis-services.fr/touchent-vraiment-livreurs-uber-eats-france/) |
| Revenu minimum garanti | 11,75 € brut par heure d'activité (accord ARPE 2023). Porté à **19 € brut/h au 1er septembre 2026**, apprécié à la semaine, hors pourboires | [Uber](https://www.uber.com/fr/blog/mise-en-place-du-revenu-minimum-garanti/), [Brut, 13/07/2026](https://www.brut.media/fr/articles/economie/emploi-formation/les-livreurs-uber-eats-et-deliveroo-obtiennent-une-hausse-massive-de-leur-revenu-minimal) |
| Frais Stripe | Cartes EEE standard : 1,5 % + 0,25 €. Cartes premium : 2,8 % + 0,25 €. Cartes britanniques : 2,5 % + 0,25 €. Internationales : 3,15 % + 0,25 €. Connect : 0,25 % du volume | [Stripe](https://stripe.com/fr/pricing) |
| DAC7 | Déclaration annuelle au 31 janvier. Vendeurs de biens déclarables dès 30 ventes ou 2 000 € ; prestataires de services personnels déclarables dès le premier euro. Données : identité, NIF, adresse, montants et frais par trimestre | [donneespersonnelles.fr](https://www.donneespersonnelles.fr/dac7-plateformes), [kohenavocats](https://kohenavocats.com/vinted-dac7-signale-fisc-2000-euros-30-ventes-imposable-texte-reel/) |

Taux de TVA retenus (droit fiscal connu, à valider par l'expert-comptable) :

- **France** :
  - plats préparés vendus à emporter ou en livraison, et boissons sans alcool à consommer immédiatement : **10 %** ;
  - boissons alcoolisées : **20 %** ;
  - produits d'épicerie conditionnés : **5,5 %** ;
  - commission, frais de service et frais de livraison facturés par Ciyou Eats : **20 %**.
- **Luxembourg** :
  - restauration et vente à emporter : **3 %** ;
  - boissons alcoolisées : **17 %** ;
  - services de Ciyou Eats : **17 %**.

---

## 2. Valeurs par défaut de Ciyou Eats

Source : `pricing/defaults.ts`, amorçage de `countries/{id}.pricing`. Montants TTC pour le client, HT pour ce que Ciyou Eats facture au restaurant.

### 2.1 Côté client

| Paramètre | France | Luxembourg | Règle |
|---|---|---|---|
| Frais de service | 10 % du sous-total, entre 0,49 € et 3,49 € | idem | Livraison uniquement ; aucun frais pour le retrait |
| Petite commande | Écart jusqu'à 10 €, au plus 3 € | idem | Exemple : panier de 8 € → 2 € de frais |
| Livraison ≤ 1,5 km | 0,99 € | 1,49 € | Paliers par distance, surchargeables par zone (`zones.deliveryTiers`) |
| Livraison ≤ 3 km | 1,99 € | 2,49 € | |
| Livraison ≤ 5 km | 2,99 € | 3,49 € | |
| Livraison ≤ 7 km | 3,99 € | 4,49 € | |
| Livraison ≤ 9 km | 4,99 € | 5,49 € | Au-delà : hors zone |
| Heure de pointe | Multiplicateur des frais de livraison, jusqu'à ×1,5, plus un supplément fixe possible | idem | Règles `surgeRules` (manuelles, planifiées ou selon la demande) |
| Pourboire | Suggestions 1, 2, 3 ou 5 €, 50 € au plus | idem | 100 % au livreur, hors commission et hors TVA |

### 2.2 Côté restaurant

| Paramètre | Valeur | Règle |
|---|---|---|
| Commission, livraison Ciyou Eats | 30 % HT | Assiette : sous-total TTC des plats, moins les remises que le restaurant finance |
| Commission, livreurs du restaurant | 15 % HT | Le restaurant garde ses frais de livraison et les pourboires |
| Commission, retrait / sur place | 12 % HT | |
| TVA sur commission | 20 % (FR), 17 % (LU) | Retenue avec la commission, récupérable par le restaurant |
| Frais de paiement | **Déduits du reversement du commerce** (décision client) | Réglable (`payment.payer`, défaut `restaurant`) |
| Priorité de la commission | négociée pour le commerce > négociée pour son groupe > barème de la ville > taux de la formule (sauf formule qui « hérite ») > barème du pays, puis offre temporaire retirée | `resolveCommission` (`pricing/policies.ts`), `orders/commission.ts` |
| Mode de facturation | `commission` (défaut), `subscription` (aucune commission sur les ventes, abonnement seul), `hybrid` (les deux) ; commerce > formule > pays | `resolveBillingMode` ; `orders/{id}.commission = { bps, source, billingMode }` |

### 2.3 Formules d'abonnement

Source : `pricing/plans.ts`, amorçage de la collection `plans`.

> **Décision client** : les trois formules sont aujourd'hui vides (prix 0, aucune fonctionnalité, commission identique au marché, sans engagement, sans essai, délai d'impayé 0). Le tableau ci-dessous est l'**ancienne hypothèse**, conservée comme exemple de paramétrage possible.

| Formule | Prix HT / mois | Essai | Commission (Ciyou Eats / propres livreurs / retrait) | Inclus |
|---|---|---|---|---|
| Basic | 0 € | — | 30 % / 15 % / 12 % | Commandes, carte, finances, messagerie, codes promo ; rayon 5 km |
| Pro | 49 € | 30 jours | 27 % / 13 % / 10 % | + fidélité, campagnes push, équipe, planning, pointage, absences, tâches, documents ; rayon 7 km ; bonus de classement |
| Premium | 129 € | 30 jours | 24 % / 11 % / 8 % | + paie, HACCP, multi-établissements (3 inclus), caisse connectée, support prioritaire ; rayon 9 km |

Point mort entre formules : Pro devient rentable pour le restaurant dès 1 633 € HT de ventes livrées par mois (3 points de commission économisés couvrent 49 €). Premium devient plus intéressant que Pro à partir de 2 667 € par mois.

### 2.4 Livreurs indépendants

| Paramètre | France | Luxembourg |
|---|---|---|
| Prise en charge au restaurant | 2,00 € | 2,50 € |
| Remise au client | 1,00 € | 1,50 € |
| Par km (restaurant → client) | 0,80 € | 0,90 € |
| Par minute | 0 € (réglable) | 0 € |
| Minimum par course | 3,00 € | 4,00 € |
| Attente client | 0,20 €/min après 5 min | idem |
| Garantie horaire (semaine, hors pourboires) | 19 € brut | 19 € (hypothèse, alignée sur la France) |
| Heure de pointe | Prime fixe par course (`surgeRules.courierBonusCents`) | idem |
| Pourboires | 100 % reversés | idem |

Le complément de garantie est calculé chaque semaine par `computeHourlyGuaranteeTopUp` à partir des `driverSessions` (minutes d'activité) et des gains hors pourboires.

---

## 3. Formules de calcul

Tous les montants sont des **entiers en centimes**. Tous les taux sont en **points de base** (1 000 = 10 %). Les arrondis se font au centime le plus proche. Les répartitions au prorata utilisent la méthode du plus fort reste, ce qui garantit qu'aucun centime n'est perdu.

### 3.1 Panier (`computeQuote`)

```
sous-total    = Σ (prix unitaire + options) × quantité
frais service = borné(sous-total × taux, plancher, plafond)        si le mode est concerné
petite cmd    = min(seuil − sous-total, plafond)                   si sous-total < seuil (mode « écart »)
livraison     = palier(distance) ou tarif imposé ; × majoration de pointe (bornée) + supplément
remise        = pourcentage (plafonné) | montant fixe | livraison offerte ; jamais plus que le sous-total
pourboire     = saisi, plafonné ; seulement en livraison
TOTAL         = sous-total + service + petite cmd + livraison − remise + pourboire
```

La commande est **bloquée** dans ces cas :

- panier vide ;
- minimum de commande non atteint ;
- adresse hors zone ;
- distance inconnue.

Si le minimum d'une promotion n'est pas atteint, la commande reste valide mais sans remise.

**TVA des articles.** Elle est calculée par catégorie (plats, boissons sans alcool, alcool, épicerie) sur le montant TTC, après déduction de la part de remise financée par le restaurant. Cette part est répartie au prorata des catégories. Une remise financée par Ciyou Eats ne réduit pas la base de TVA du restaurant : Ciyou Eats paie cette part pour le compte du client.

### 3.2 Répartition (`computeSettlement`)

```
commission HT      = assiette × taux ; TVA commission = HT × taux normal
reversement resto  = sous-total − remises financées par le resto − commission TTC
                     (+ frais de livraison et pourboire s'il livre lui-même)
                     (− frais de paiement si la configuration les lui impute)
livreur            = barème de la course (+ prime de pointe) ; + pourboire à 100 %
frais de paiement  = total × 1,5 % + 0,25 € + 0,25 % Connect (carte) ; 0 en espèces ou avec l'avoir
TVA due par Ciyou Eats = TVA sur frais de service, petite commande, livraison encaissée, commission
MARGE Ciyou Eats       = total − reversement − livreur − frais de paiement − TVA due
                   = service HT + petite cmd HT + livraison HT + commission HT
                     − rémunération livreur − remises financées par Ciyou Eats − frais de paiement
```

Les tests vérifient les deux écritures de la marge pour toutes les combinaisons suivantes : type de remise, qui livre, carte ou espèces.

**Portefeuille (avoirs Ciyou Eats).** `SettlementInput.walletAppliedCents` : la part réglée par le portefeuille n'est pas un encaissement. Les frais de carte ne portent que sur `total − avoirs`, et les espèces encaissées par le livreur salarié aussi. Une commande entièrement réglée par le portefeuille a des frais de paiement nuls. L'utilisation des avoirs est écrite à la commande (`walletTransactions` motif `order_payment`, grand livre `wallet_debit`) et rendue à l'annulation.

**Abonnement et mises en avant : compensation sur les reversements.** Il n'y a pas de prélèvement carte. La facture mensuelle (`fac-{commerce}-{mois}`) récapitule les commissions et frais de paiement (déjà retenus commande par commande) et l'abonnement et les mises en avant, retenus au grand livre par des écritures négatives (`subscription_fee`, `sponsored_placement`) reprises au prochain reversement. Si le solde à reverser couvre la retenue, la facture est payée « par compensation » ; sinon elle reste `issued` avec `compensation.status = 'pending'`, l'abonnement passe en impayé (`past_due`), puis `restricted` (fonctions coupées : `settings/dunning.restrictedFeatures`) et `suspended` (plus de nouvelles commandes) selon les relances et le délai de grâce de la formule. De nouvelles ventes ou un reversement positif compensent la facture et rétablissent l'abonnement ; un virement reçu se constate par `markInvoicePaid` (écriture inverse).

**Espèces.** Uniquement avec un livreur salarié du commerce (`isCashAllowed`). L'argent reste chez le commerce : la caisse du livreur (`driverPrivate.cashBalanceCents`, plafond `cashLimitCents` ou `settings/payments.cash.driverCashLimitCents`) augmente à chaque livraison payée en espèces (`cashMovements`) et redescend à la remise de caisse. Au plafond, le livreur ne reçoit plus de commande en espèces.

**Devises.** Tous les montants sont des entiers en unités mineures de la devise du pays (EUR, DZD, MAD ; TND en millimes) ; `currency` est écrit sur les commandes, paiements, écritures, factures et reversements (`countries/{id}.currency`). Pays sans Stripe : reversement manuel avec référence bancaire (`payouts.provider = 'manual'`).

### 3.3 Règles automatiques (`policies.ts`)

- **Imputation d'un remboursement** selon sa cause. Par défaut (décision client), **toutes les causes sont imputées au commerce**. Le montant est déduit du prochain reversement. Réglage : `settings/orderRules.refundLiability` (l'ancienne répartition par cause est exportée sous `CAUSE_BASED_REFUND_LIABILITY`).
- **Annulation par le client** :
  - 100 % remboursé avant acceptation ;
  - 50 % après acceptation ;
  - 0 % en préparation ;
  - impossible ensuite ;
  - le pourboire est toujours rendu.
- **Avoir automatique de retard** : 10 % du total (5 € au plus) à partir de 20 min, 30 % (15 € au plus) à partir de 40 min.
- **DAC7** : `isDac7Reportable` applique les seuils, `aggregateDac7` produit les montants et frais trimestriels de chaque vendeur ou livreur. Les résultats vont dans `taxReports`.

---

## 4. Exemples chiffrés (France, calculés par le moteur)

| Cas | Client paie | Resto reçoit | Commission HT | Livreur | Stripe | TVA due Ciyou Eats | **Marge Ciyou Eats** |
|---|---|---|---|---|---|---|---|
| A. Panier 25 €, 2,5 km, carte | 29,49 € (25 + 2,50 service + 1,99 livraison) | 16,00 € | 7,50 € | 5,00 € | 0,76 € | 2,25 € | **5,48 €** |
| B. Idem + −20 % offert par Ciyou Eats (plafond 5 €) + pourboire 2 € | 26,49 € | 16,00 € | 7,50 € | 5,00 € + 2 € | 0,72 € | 2,25 € | **0,52 €** |
| C. Petit panier 8 €, 1,2 km | 11,79 € (8 + 0,80 + 2,00 petite cmd + 0,99) | 5,12 € | 2,40 € | 3,96 € | 0,46 € | 1,10 € | **1,15 €** |
| D. Retrait 25 € | 25,00 € | 21,40 € | 3,00 € | — | 0,69 € | 0,60 € | **2,31 €** |
| E. Livreur du restaurant, 25 € + 2,50 € de livraison | 30,00 € | 23,00 € | 3,75 € | (payé par le resto) | 0,78 € | 1,17 € | **5,05 €** |
| F. Panier 40 €, 4,5 km | 46,48 € | 25,60 € | 12,00 € | 6,60 € | 1,07 € | 3,48 € | **9,73 €** |

Enseignements :

- **Une promotion financée par Ciyou Eats efface presque toute la marge (cas B).** Les promotions d'acquisition doivent être plafonnées et ciblées sur les nouveaux clients, ou cofinancées avec le restaurant (`funding = shared`).
- **Les petits paniers ne sont rentables que grâce aux frais de petite commande (cas C).** Sans eux, la marge devient négative.
- **La rentabilité dépend du panier moyen et de la distance** : la rémunération du livreur est fixe pour l'essentiel. Viser un panier moyen supérieur à 25 € et un rayon de 3 à 5 km.
- **Garantie de 19 €/h** : un livreur doit faire environ 3,5 courses par heure d'activité à 5,50 € pour ne pas déclencher de complément. Un complément fréquent signale un **surplus de livreurs** dans la zone. Suivi : `zones.live` et alerte `zone_driver_shortage`, ainsi que le ratio inverse.

---

## 5. Où régler quoi (super admin)

| Réglage | Document |
|---|---|
| Frais client, commissions, barème livreur, TVA, paiement, pourboires | `countries/{id}.pricing` (marché), `cities/{id}.pricing` (ville) |
| Paliers et minimum par zone, coupure d'urgence | `zones/{id}` |
| Heures de pointe | `surgeRules/{id}` |
| Formules | `plans/{code}` |
| Commissions (historisées) | `commissionRules/{id}` ; commission négociée : `restaurants/{rid}/private/commercial` (par Cloud Function, avec audit) |
| Remboursements, annulations, retards, alcool, commandes programmées | `settings/orderRules` (plateforme) ; surcharges dans `countries` et `cities` |
| Plafonds de remboursement par agent | `adminRoles/{role}.defaultRefundLimitCents`, `admins/{uid}.refundLimitCents`, `settings/refunds` |
| Calendrier des reversements | `settings/payouts` |
| Encadrement des promotions restaurant, seuil « client fidèle », délai « client inactif » | `settings/promotions` |
| Relances d'impayé, fonctions restreintes, blocage des reversements | `settings/dunning` |
| Plafond d'espèces par livreur, pourboires, nouvelles tentatives de paiement | `settings/payments` |
| Prestataires de paiement par pays | `paymentProviders/{id}`, `countries/{id}.paymentProviderIds` |
| Parrainage (client, commerce, livreur), fidélité | `settings/referral`, `settings/loyalty` |

Chaque modification est historisée dans `settingsHistory` (ancienne et nouvelle valeur, auteur, date) et dans `auditLogs`.
