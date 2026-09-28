# Contrats attendus des apps mobiles (client et livreur)

Les apps `apps/client` et `apps/driver` ne sont pas encore construites. Tout ce qui les concerne est déjà
livré **côté serveur** (fonctions appelables, déclencheurs, règles Firestore et Storage) et testé par des
scripts qui jouent le rôle du client ou du livreur. Ce document fixe ce que chaque app doit appeler ou lire.

Conventions communes :

- Fonctions appelables en région `europe-west1` (`httpsCallable(functions, 'nom')`), utilisateur connecté (custom claims `role`).
- Erreurs : les fonctions renvoient des erreurs Firebase (`failed-precondition`, `invalid-argument`, `permission-denied`, `not-found`) dont le message est déjà en français et affichable tel quel.
- Montants en centimes, dates en `Timestamp` Firestore. Aucune valeur métier n'est codée dans l'app : délais, seuils et plafonds viennent des règles (`settings/orderRules`, surchargées par pays puis par ville).
- Les apps n'écrivent jamais directement dans une commande, un remboursement, un avoir ou une réclamation.

## 1. Client absent (app livreur, et back-office restaurant pour un livreur salarié du commerce)

Règle décidée : le livreur attend N minutes (10 par défaut, `customerAbsent.driverWaitMinutes`), appelle le
client depuis l'app, puis clôture ; la commande est close sans remboursement, livreur et commerce payés.

| Étape | Appel | Entrée | Sortie |
|---|---|---|---|
| Arrivée chez le client | `markDriverArrived` | `{ orderId }` | `{ arrivedAt, waitUntil }` (ms) |
| Appel du client (numéro masqué) | `logCustomerCall` | `{ orderId }` | `{ calls }` |
| Clôture | `closeCustomerAbsent` | `{ orderId }` | `{ status: 'delivered', closedAs: 'customer_absent', refundedCents }` |

- Précondition : commande `delivery`, statut `picked_up`, appelant = `order.driverId` (ou membre `orders.manage` du commerce si le commerce livre lui-même).
- `markDriverArrived` écrit `orders/{id}.customerAbsence = { arrivedAt, waitUntil, calls, lastCallAt, closedAt, closedBy, payDriver, payRestaurant }` ; l'app affiche un compte à rebours jusqu'à `waitUntil`.
- `closeCustomerAbsent` échoue tant que `waitUntil` n'est pas atteint (« Patientez encore N minute(s)… ») et, si `customerAbsent.callViaApp` est vrai, tant qu'aucun appel n'est consigné (« Appelez le client depuis l'application… »).
- Si le livreur oublie de clôturer, la plateforme le fait seule `waitUntil + customerAbsent.autoCloseGraceMinutes` (défaut 10 min ; 0 = jamais) : `closedBy = 'system'`.
- Effet : `status = 'delivered'`, `closedAs = 'customer_absent'`, événements `driver_arrived`, `customer_called`, `customer_absent`, règlement du commerce et du livreur par `onOrderSettled`, message `order_customer_absent` au client. Paiement en espèces : la commande est annulée (rien n'a été encaissé).
- Si le super admin active `customerAbsent.refundCustomer`, le client est remboursé (hors pourboire) avec l'imputation `refundLiability`.

## 2. Produit indisponible (app client)

Le commerce signale l'article (`reportItemUnavailable`, back-office restaurant). L'app client réagit :

- Lecture : `orders/{id}.itemProposals[lineId] = { status: 'pending'|'accepted'|'declined'|'expired', productName, replacementName, replacementUnitPriceCents, expiresAt }` et `orders/{id}.items[].adjustment` (`removed`/`replaced`, `refundCents`). Notification `item_replacement_proposed` dans `users/{uid}/notifications`.
- Réponse du client : `respondToItemProposal` `{ orderId, lineId, accept }` → `{ status: 'replaced'|'removed', refundCents }`.
  Erreurs : « Aucun remplacement n'est en attente pour cet article. », « Le délai de réponse est dépassé : l'article a été retiré. »
- Sans réponse avant `expiresAt` (délai `itemUnavailable.replacementTimeoutSeconds`), la plateforme retire l'article et rembourse (tâche minutée, message `item_removed`).
- Le client ne paie jamais plus cher : `finalTotalCents = min(ancien, nouveau)` et la différence est remboursée.
- Si tous les articles sont retirés, la commande est annulée (`cancellation.reason = 'item_unavailable'`) et le solde remboursé.

## 3. Réclamation avec photo (app client)

Photo obligatoire (`claims.photoRequired`), contrôlée automatiquement (doublon, date de prise de vue, cohérence).

1. Dépôt des photos dans Storage : chemin **`claims/{uid}/{nom}.jpg`** (uid = client connecté), JPEG/PNG/WebP/HEIC, 10 Mo maximum (règle Storage `claims/{userId}/{fileName}`, création seule).
2. Appel `submitOrderClaim` :

```ts
{
  orderId: string,
  type: 'missing_item' | 'damaged_item' | 'wrong_item' | 'quality' | 'other',
  lineIds: string[],        // articles concernés (obligatoire sauf 'quality'/'other')
  description: string,      // 10 à 1000 caractères
  photoPaths: string[]      // chemins Storage ci-dessus, au plus `claims.maxPhotos`
}
// -> { claimId, verdict: 'clean'|'suspect'|'rejected', status, ticketId, ticketNumber, checks[] }
```

- Recevable seulement sur une commande `delivered` du client, dans `claimWindowHours` après la livraison.
- Erreurs qui **n'enregistrent rien** (le client corrige et renvoie) : photo absente (« Joignez au moins 1 photo : elle est obligatoire pour une réclamation. »), fichier non exploitable, article inconnu, photo non reçue.
- Verdict `rejected` (délai dépassé, articles déjà réclamés, même photo jointe deux fois) : réclamation enregistrée avec `status = 'rejected'` et message `claim_decided`. Verdict `suspect` (photo déjà utilisée ailleurs, prise avant la livraison, définition faible, trop de réclamations) ou `clean` : ticket ouvert au support, `status = 'pending_review'`, message `claim_received`.
- Lecture : `orderClaims/{id}` (le client lit les siennes) : `status`, `verdict`, `checks[]`, `grantedCents`, `decisionNote`. La décision d'un agent (`decideOrderClaim`) déclenche le message `claim_decided`.
- Acceptation automatique possible si `claims.autoAcceptMaxCents > 0` (contrôles propres et montant sous le plafond) : remboursement immédiat sur le moyen de paiement d'origine.

## 4. Avoir de retard (app client)

Crédité automatiquement à la livraison si le retard dépasse un palier (`lateCredit.tiers`, par ville).

- Lecture : `users/{uid}.walletBalanceCents`, `walletTransactions` (`reason = 'late_delivery'`, `orderId`, `expiresAt`), événement de commande `credit_issued`, notification `late_credit_issued`.
- `flags.late` est posé au-delà de `lateToleranceMinutes` (défaut 5) ; l'avoir, lui, dépend des paliers.
- L'avoir est dépensable à la commande (`useWallet`, voir la section 9).

## 5. Messages automatiques (apps client, livreur et restaurant)

- Centre de notifications : `users/{uid}/notifications/{id}` (`title`, `body`, `category`, `link`, `read`), écrit pour chaque message quel que soit le mode d'envoi ; l'identifiant `{clé}-{clé d'idempotence}` évite les doublons.
- Push : enregistrer le jeton dans `users/{uid}/devices/{deviceId}` (`fcmToken`, `app`, `platform`, `appVersion`). Le push n'est transmis que si le super admin active « Push réels » ; sinon il est journalisé « préparé ».
- Les textes viennent des gabarits `messageTemplates` (français, anglais, arabe : langue du profil `users/{uid}.locale`, repli français).

## 6. Fermeture d'urgence d'une ville ou d'une zone (app client)

- Lecture : `cities/{id}.emergencyClosure` et `zones/{id}.emergencyClosure` : `{ active, reason, message: { fr, en?, ar? }, endsAt }`. Afficher `message[locale]` (repli `fr`) et masquer la commande.
- `placeOrder` refuse avec ce même message dans la langue du profil. Une ville désactivée (`cities/{id}.active = false`) refuse aussi : « Le service Ciyou Eats n'est pas encore ouvert dans cette ville. »
- Les clients ayant une commande en cours dans la ville ou la zone reçoivent le message `zone_emergency_closure`.

## 7. Classement et mention « Sponsorisé » (app client)

- `restaurants/{id}.rankingScore` : score de base 0 à 1, hors distance, recalculé chaque nuit (03 h 20) et à chaque changement des pondérations.
- Ordre final : `finalRankingScore(rankingScore, proximité, settings/display.ranking)` (fonction du paquet `@golink/shared`), proximité = `1 − distance / distance_max`.
- **Obligation légale** : tout commerce avec `sponsored = true` doit afficher `sponsoredLabel` (texte de `settings/display.sponsoredLabel`). L'app ne doit jamais masquer cette mention.

## 8. Inscription autonome d'un commerce (web, `apps/restaurant`)

Écran `/inscription` déjà livré : appelle `restaurantSignup` (fonction publique) pour FR, BE, LU, DZ, MA, TN. Ville non ouverte : prospect créé (`status: 'waitlisted'`), aucun compte. Limite anti-abus : 5 inscriptions par heure et par adresse IP. La validation du dossier est ensuite automatique si les contrôles réglés par le super admin passent (voir `docs/AUDIT_COUVERTURE_CDC.md`, ligne « Validation automatique »).

## 9. Passer commande : offres, portefeuille, mode de paiement (app client)

`placeOrder` (voir `PlaceOrderInput` du paquet `@golink/shared`) applique tout côté serveur ; l'app n'envoie jamais un montant.

```ts
{
  restaurantId, fulfillment: 'delivery' | 'pickup' | 'dine_in', lines[], addressId?,
  paymentMethod: 'card' | 'apple_pay' | 'google_pay' | 'cash' | 'wallet',
  paymentMethodId?: string,   // pm_… Stripe, exigé pour un règlement en ligne
  promoCode?: string,         // facultatif : sans code, l'offre automatique la plus avantageuse est appliquée
  useWallet?: boolean,        // régler avec le solde d'avoirs Ciyou Eats (tout ou partie)
  tipCents?, customerNote?, scheduledFor?, clientRequestId
}
// -> { orderId, number, status, totalCents, chargedCents, payment: { status, clientSecret? } }
```

- **Offres.** Sans `promoCode`, le serveur cherche les offres sans code éligibles (portée, dates, mode, limites, ciblage) et applique celle qui fait économiser le plus ; `orders/{id}.promotionId`, `amounts.discount`. Ciblage : `new_customers` (aucune commande), `inactive_customers` (dernière commande plus ancienne que `inactiveDays`, sinon `settings/promotions.inactiveDaysDefault`), `loyal_customers` (au moins `settings/promotions.loyalOrdersThreshold` commandes). Les limites (total, par client) sont recontrôlées dans la transaction : une commande simultanée peut donc être refusée (« Vous avez déjà utilisé cette offre. ») et se renvoie sans l'offre.
- **Annulation.** L'utilisation de l'offre est libérée (`promotionRedemptions/{orderId}.status = 'reversed'`) et le quota du client rendu.
- **Portefeuille.** Affichage : `users/{uid}.walletBalanceCents`, `walletTransactions` (motifs `refund`, `late_delivery`, `commercial_gesture`, `referral`, `loyalty_reward`, `order_payment`). Avec `useWallet: true`, le serveur utilise `min(solde, total)` : si le solde couvre tout, la commande est réglée sans autre moyen (`payment.method = 'wallet'`, `amounts.chargedCents = 0`, `paymentMethod`/`paymentMethodId` ignorés) ; sinon la carte n'est autorisée que pour le reste (`amounts.chargedCents`). Erreurs : « Votre solde d'avoirs Ciyou Eats est vide. », « Votre solde d'avoirs a changé… » (solde modifié entre-temps : rafraîchir). Annulation : les avoirs utilisés sont rendus (`walletTransactions/wr-{orderId}`).
- **Espèces.** Proposées seulement pour une livraison assurée par un livreur salarié du commerce (`restaurant.deliveredBy = 'restaurant'`, `settings/payments.cash.enabled`) ; sinon « Le paiement en espèces n'est possible qu'avec les livreurs du commerce. »
- **Pourboire.** Activation et plafond : `settings/payments.tips` (et plafond du pays) ; aucune valeur codée dans l'app. Reversé à 100 % au livreur.
- **Paiement refusé.** « Paiement refusé par votre banque… » : le refus est tracé dans `payments` (`orderId = null`, `status = 'failed'`). Au-delà de `settings/payments.failedPaymentRetry.maxAttempts` refus dans l'heure : « Trop de paiements refusés récemment. »
- **Commerce suspendu pour impayé.** « {nom} est momentanément indisponible. » (à traiter comme un commerce fermé).

## 10. Parrainage et fidélité (app client)

- **Code du client** : `users/{uid}.referralCode` (à partager). Saisie du code d'un autre client avant sa première commande : `applyReferralCode` `{ code }` → `{ referralId, rewardCents, minFirstOrderCents }`. Erreurs : code inexistant, son propre code, code déjà enregistré, première commande passée, programme fermé (`settings/referral.client.enabled`).
- La récompense (5 € pour chacun par défaut, réglable) est versée au portefeuille à la **première** commande livrée si elle atteint `minFirstOrderCents` ; sinon le parrainage expire. Suivi : `referrals/{id}` (lecture par le parrain et le filleul), notification `referral_rewarded`.
- **Points de fidélité** (programme éteint par défaut, `settings/loyalty.enabled`) : gagnés à la livraison (`pointsPerEuro`), points de bienvenue à la première commande. Lecture : `loyaltyAccounts/{uid}` (`points`, `lifetimePoints`), `loyaltyTransactions`. Échange contre du crédit au portefeuille : `redeemLoyaltyPoints` `{ points }` (un palier exact de `settings/loyalty.rewards`) → `{ pointsLeft, balanceCents, valueCents }`. Les points expirent après `pointsValidityDays` (lots les plus anciens consommés d'abord).

## 11. Compte de paiement du livreur (app livreur)

- **Livreur indépendant, pays avec Stripe** : `createDriverConnectAccount` `{}` → `{ accountId, status, created }` ; `createDriverConnectAccountLink` `{}` → `{ url, expiresAt }` (ouvrir l'URL Stripe, valable quelques minutes) ; au retour, `refreshDriverConnectAccountStatus` `{}` → `{ status: 'pending'|'restricted'|'enabled'|null }`. Lecture : `driverPrivate/{uid}.stripeAccountStatus`. Sans compte actif, le reversement échoue avec « Le livreur n'a pas encore activé son compte de paiement Stripe. »
- **Pays sans Stripe (Algérie, Maroc, Tunisie)** : `setDriverPayoutAccount` `{ account: { provider: 'bank_transfer'|'mobile_wallet', paymentProviderId?, holderName, accountNumber } }` → `{ accountMasked, verified: false }`. Le numéro complet n'est jamais conservé (extrait masqué) ; l'équipe finance vérifie le compte avant le premier virement, puis vire à la main et saisit la référence. Prestataires proposés : `paymentProviders` (lecture pour tout compte connecté), filtrer sur `countryIds` et `supports.payout`.
- Un livreur **salarié d'un commerce** n'a pas de compte de paiement Ciyou Eats (« Les livreurs salariés d'un commerce sont payés par leur employeur. »).
- Reversements et relevés : `payouts` (`currency`, `provider`, `manualReference`), messages `driver_payout_paid`.

## 12. Espèces (app livreur salarié du commerce)

Décision : espèces uniquement avec un livreur salarié du commerce ; l'argent reste chez le commerce.

- À la clôture de la livraison (`completeOrder`), le montant encaissé (`orders/{id}.amounts.chargedCents`) est ajouté à la caisse du livreur : `driverPrivate/{uid}.cashBalanceCents` (lecture par le livreur), mouvements `cashMovements` (`collected` / `remitted`, `balanceAfterCents`).
- Plafond : `driverPrivate.cashLimitCents`, sinon `settings/payments.cash.driverCashLimitCents`. Au plafond, la plateforme n'attribue plus de commande en espèces au livreur (« … détient X en espèces (plafond Y) : enregistrez sa remise de caisse… ») ; le commerce reçoit le message `cash_limit_reached`.
- Le livreur doit être autorisé aux espèces (`drivers/{uid}.acceptsCash`).
- Remise de caisse : enregistrée par le commerce (`recordMerchantCashRemittance` `{ restaurantId, driverId, amountCents, note? }`, droit `couriers.manage`) ou par l'équipe Ciyou Eats (`recordCashRemittance`). L'app livreur affiche la caisse et le plafond, sans écrire.

## 13. Parrainage entre commerces (web `apps/restaurant`, app livreur pour la prime livreur)

- Lien et code : `getRestaurantReferralLink` `{ restaurantId }` → `{ code, url, enabled, rewardCents, rewardType, qualifyingOrders, adCreditCents }` (l'URL est `…/inscription?parrain=CODE`, l'écran d'inscription pré-remplit le champ). Saisie tardive : `applyRestaurantReferralCode` `{ restaurantId, code }`.
- Inscription : `restaurantSignup` accepte `referralCode` ; la réponse contient `referral: { applied, accepted }` ou `{ applied: false, reason }` (`code_unknown`, `program_disabled`, `referrer_inactive`, `already_linked`). Un auto-parrainage (même gérant, même SIRET, même téléphone ou e-mail du gérant) crée un parrainage refusé, avec `fraudSignals`, sans prime.
- Récompense : 100 € (réglable, `settings/referral.restaurant`) de **budget publicitaire** (`private/commercial.adCreditCents`, utilisable pour les mises en avant payantes) quand le commerce parrainé est validé (`qualifyingOrders = 0`) ou a livré N commandes ; un seul versement par parrainage.

## 14. Interrupteurs de fonctionnalités (apps client et livreur)

Le super admin allume ou éteint une fonctionnalité **sans nouvelle version** des apps (`featureFlags/{clé}` : `enabled`, `overrides[]` par pays, ville, formule d'abonnement ou commerce ; la portée la plus précise l'emporte ; un interrupteur jamais configuré vaut « activé »). Le serveur applique déjà chaque interrupteur ; les apps l'utilisent pour **masquer ou griser** l'option et ne jamais afficher un bouton qui sera refusé.

- **Lecture** : `featureFlags` est lisible sans connexion (`allow read: if true`). Résolution côté app : pour un commerce donné, chercher dans `overrides` dans l'ordre `restaurant` (id du commerce) > `plan` (`restaurant.planCode`) > `city` (`restaurant.cityId`) > `country` (`restaurant.countryId`), sinon `enabled`. Écouter le document pour refléter un changement en direct.
- **Effets serveur (refus avec message français, code `failed-precondition`)** : `placeOrder` refuse le mode (`delivery`, `pickup`, `dine_in`), la commande programmée (`scheduled_orders`), le pourboire (`tips`), le code promo (`promotions`, aucune offre automatique non plus), le paiement par carte (`card_payment`) ou en espèces (`cash_payment`) quand l'interrupteur est éteint pour le commerce ; le contrôle du stock est ignoré si `stock_management` est éteint ; `redeemLoyaltyPoints` et le crédit de points (`loyalty`), `applyReferralCode` et les primes (`referral`), `openSupportChat` (`live_chat`) suivent le même principe.
- **Fiche publique du commerce** : `restaurants/{id}.fulfillmentModes` et `acceptedPaymentMethods` sont recalculés par le serveur à chaque changement d'interrupteur (déclencheur `onFeatureFlagWrite`) : l'app client s'appuie sur ces champs pour proposer les modes et moyens de paiement, sans relire les interrupteurs.
- **Suivi du livreur (`driver_tracking`)** : la position du livreur n'est lisible par le client (`driverLocations/{driverId}.visibleTo`) que si l'interrupteur est actif pour la commande ; quand il change, `visibleTo` est mis à jour pour les livraisons en cours. L'app client affiche la carte de suivi seulement si sa lecture est autorisée, sinon l'état textuel de la commande.
- **Vente d'alcool** : `alcohol_sales` est verrouillée par décision de la direction (`locked: true`) ; l'app ne la propose jamais, quelle que soit sa valeur.

## 15. Marque de la plateforme (apps client et livreur)

`settings/branding` (lecture publique) : `logo`, `logoDark`, `favicon` (`{ url, path }` ou `null`) et `colors` (`primary`, `secondary`, `accent`, `background`, au format `#RRGGBB`). `settings/general` : `platformName`, `defaultLocale`, `supportedLocales`, `currency`. Les back-offices appliquent déjà la couleur principale et le logo (`BrandingEffect`, `useBranding` de `@golink/web`). Les apps client et livreur doivent lire ces documents au démarrage (avec repli sur le thème livré si absents) et écouter leurs changements. Les couleurs secondaire, d'accent et d'arrière-plan sont réservées à ces apps.

## 16. Écrans de sécurité de l'équipe interne : rappel

Les apps client et livreur n'appellent aucune fonction d'administration. La double authentification, les sessions et le journal d'audit ne concernent que le back-office `apps/admin`.

## 17. Liste de blocage à la commande (apps client et livreur)

Consultée automatiquement par `placeOrder` (téléphone et e-mail du profil) : rien à appeler pour cela. Pour
l'empreinte d'appareil (comptes multiples liés, §28), l'app pose un identifiant stable et anonyme (ex.
`expo-application` `getAndroidId()` / `getIosIdForVendorAsync()`, ou un UUID généré une fois et conservé en
stockage sécurisé local) et le transmet dans `placeOrder({ ..., deviceId })`. Refus : `permission-denied`
« Votre compte ne permet pas de passer commande… ». L'app livreur doit prévoir la même chose côté
inscription/connexion (aucune fonction dédiée pour l'instant : le blocage livreur passe par le dossier de
fraude, `decideFraudCase`, effectif dès la version en cours).

## 18. Mode maintenance et version minimale (source unique, apps client, livreur, restaurant)

Deux documents Firestore, lisibles sans authentification, font foi pour toutes les apps :

- `settings/maintenance` : `{ apps: { client|driver|restaurant|admin: { enabled, message: { fr }, until } } }`. Si `enabled` est vrai (et `until` non dépassé), l'app affiche l'écran de maintenance (`message.fr`) et bloque l'usage : aucune commande, aucune connexion nouvelle. Le serveur applique déjà ce blocage sur `placeOrder` (client) et `restaurantSignup` (restaurant) ; l'app doit faire de même dès le démarrage et à chaque changement (écoute temps réel), pour ne pas laisser l'utilisateur avancer jusqu'à un refus serveur tardif.
- `appVersions/{client|driver|restaurant|admin}` : `{ latestVersion, minimumVersion, forceUpdate, message: { fr } | null, storeUrls: { ios, android } | null }`. Si `forceUpdate` est vrai et que la version de l'app est strictement inférieure à `minimumVersion` (comparaison `major.minor.patch`), l'app affiche un écran de mise à jour obligatoire (`message.fr`, boutons vers `storeUrls`) et ne laisse rien faire d'autre.
- `placeOrder` accepte un champ optionnel `appVersion` (`"1.4.2"`) : à envoyer systématiquement pour que le serveur applique aussi la mise à jour forcée côté commande (double contrôle, pas un remplacement de l'écran ci-dessus).

## 19. Acceptation des CGU/CGV et consentements (apps client et livreur)

- `acceptLegalDocument({ documentType, countryId })` — `documentType` parmi `terms_client`, `terms_driver`, `privacy_policy`, `cookie_policy`, `legal_notice` (pas `terms_restaurant`, géré à l'inscription commerce) ; `countryId` = pays du compte. Enregistre l'acceptation (`legalAcceptances`) et met à jour `users/{uid}.acceptedLegal.{documentType}`. Renvoie `{ accepted, version }`.
- Réacceptation forcée : à la connexion, l'app compare `users/{uid}.acceptedLegal.{documentType}` à la version actuelle de `legalDocuments` (requête `where('type','==',documentType).where('countryId','==',countryId).where('status','==','published').orderBy('publishedAt','desc').limit(1)`). Si elles diffèrent ET que le document lu a `requiresReacceptance: true`, l'app bloque avec un écran « Conditions mises à jour » jusqu'à l'appel de `acceptLegalDocument`. Le serveur applique déjà ce blocage sur `placeOrder` (`terms_client`) : sans l'app, cette règle ne s'exerçait jamais avant la version actuelle.
- `setConsent({ key, granted })` — `key` parmi `marketing_email`, `marketing_push`, `marketing_sms`, `analytics_cookies`, `personalization`. Journalise (`users/{uid}/consents`) et met à jour `users/{uid}.consents.{key}`. À appeler depuis les réglages de confidentialité et le bandeau cookies (web) : au minimum `analytics_cookies` avant tout traceur non essentiel.

## 20. Tunnel de commande (app client)

`trackFunnelEvent({ event, countryId, cityId })` — anonyme, sans authentification requise, jamais bloquant (l'app ignore silencieusement un échec réseau). `event` parmi `app_open` (au lancement, une fois par session), `restaurant_view` (ouverture d'une fiche commerce), `add_to_cart` (premier ajout au panier de la commande en cours). Les deux dernières étapes (paiement lancé, payé) sont déjà dérivées par le serveur des commandes réelles (`placeOrder`) : ne pas les envoyer par cet appel.

## 21. Selfie de vérification d'identité (app livreur)

Contrôle ponctuel (§6, aléatoire ou sur demande) : un document `identityChecks/{id}` passe à `status: 'requested'` (le livreur en est notifié). L'app :
1. Dépose la photo dans Storage à `drivers/{driverId}/private/<nom-de-fichier>` (règles déjà ouvertes à `isSelf(driverId)`, JPEG/PNG/WebP/HEIC, 10 Mo au plus).
2. Appelle `submitIdentitySelfie({ checkId, photoPath })`. Le contrôle passe à `status: 'submitted'` ; un agent compare ensuite visuellement le selfie à la pièce d'identité validée et décide (`reviewIdentityCheck`). **Aucune similarité automatique n'est calculée** (pas de service de reconnaissance faciale dans ce projet) : ne pas afficher de pourcentage de ressemblance.
3. Sans réponse sous 48 h, le compte est automatiquement suspendu (`identity_check_expired`) : l'app doit relancer une notification de rappel avant l'échéance si possible (pas de fonction dédiée pour l'instant, seulement la notification initiale).

## 22. Contenu traduit (traduction automatique Azure Translator)

Le contenu métier (fiches produits/sections, pages d'information, articles d'aide, gabarits de messages, annonces) porte un champ `translations` optionnel à côté du champ français (ex. `product.name` en français, `product.translations.en.name` / `product.translations.ar.name`). Les apps mobiles doivent :

- Lire la langue de l'utilisateur (`users/{uid}.locale`, repli sur la langue de l'appareil puis `fr`).
- Afficher `translations[locale][champ]` si présent et non vide, sinon retomber **silencieusement** sur le champ français — jamais de texte vide ni d'écran cassé. Ce repli est le même principe que pour les textes d'interface (voir `docs/I18N.md`).
- Ne jamais appeler `translateTexts` depuis l'app cliente ou livreur : cette fonction sert aux back-offices (restaurant, super admin) au moment de la saisie, pas à la consultation. Le contenu est déjà traduit et stocké au moment où l'app le lit.

## 23. Cartographie et distribution de clé (tâche « maps-settings »)

Les clés Google Maps ne sont plus des variables d'environnement figées au build (`VITE_GOOGLE_MAPS_API_KEY`) : elles se règlent depuis le super admin (Plateforme > Cartographie, `settings/maps` + `mapsSecrets/config` chiffré, jamais lisibles côté client) et se distribuent par un appel serveur.

**Modèle à suivre par toute nouvelle app (web ou mobile) :**
1. Au démarrage, appeler la Cloud Function callable `getPublicRuntimeConfig({})` (aucune authentification requise — un appareil doit pouvoir afficher une carte avant toute connexion). Elle renvoie `{ googleMapsWebKey: string | null, mapsConfigured: boolean }`.
2. Mettre le résultat en cache en mémoire pour la durée de la session (jamais dans le stockage persistant de l'appareil) : ne pas rappeler la fonction à chaque écran. Les apps web utilisent `packages/web/src/lib/runtime-config.ts` (`loadRuntimeConfig` / `useRuntimeConfig`) ; une app mobile doit reproduire le même principe (appel unique, cache mémoire process).
3. Si `googleMapsWebKey` est `null` (non configurée) ou l'appel échoue (réseau), afficher un repli clair — jamais un écran cassé : message « Cartographie non configurée, contactez votre administrateur » (voir `apps/admin/src/features/_operations/map.tsx` `OpsMap`, `apps/restaurant/src/features/commandes/components/LiveMap.tsx` pour l'exemple d'un plan schématique de secours).
4. **Clé mobile distincte** : les futures apps Android/iOS ne doivent PAS utiliser `googleMapsWebKey` pour le SDK natif Google Maps — Google recommande une clé propre par plateforme, restreinte par empreinte de signature (Android) ou identifiant de bundle (iOS), jamais par référent HTTP. Cette clé mobile est enregistrée séparément par le super admin (même écran, champ « Clé mobile ») mais **n'est jamais renvoyée par `getPublicRuntimeConfig`** ni par aucun endpoint accessible à un client web — prévoir un mécanisme de distribution dédié à l'app mobile le moment venu (ex. un champ supplémentaire dans une fonction appelée uniquement après authentification de l'app livreur/cliente, à créer avec cette app), pas un simple ajout au même endpoint public.
5. Ne jamais committer une clé Google Maps en clair dans le dépôt (fichier `.env*` suivi par git, code source, configuration native Android/iOS versionnée) : elle doit être injectée au build mobile depuis un secret CI/CD ou lue depuis le serveur au premier lancement, selon le mécanisme retenu au moment de construire l'app.

## 24. Position en direct du livreur (suivi de flotte, apps client et livreur à venir)

Le modèle de données existe déjà (`driverLocations/{driverId}`, un seul document par livreur, écrit en direct pendant une course) : voir `packages/shared/src/models/drivers.ts` (`DriverLocation`). Contrat pour la future app livreur (émetteur) et les futures apps client / le back-office restaurant / le super admin (lecteurs) :

**Ce que l'app livreur doit envoyer :**
- Écriture **directe Firestore** (pas de callable) sur `driverLocations/{monUid}`, en `update` uniquement — le document est créé par le serveur (attribution de la première course ou passage en ligne), l'app ne le crée jamais elle-même. Les règles n'autorisent la mise à jour que des champs `position`, `geohash`, `heading`, `speedKmh`, `accuracyMeters`, `updatedAt` (`onlyChanges(...)`, voir `firebase/rules/*.rules`) : tout autre champ (`availability`, `activeOrderIds`, `visibleTo`, `cityId`, `zoneId`) est géré par le serveur (passage en ligne/hors ligne, attribution de course), jamais par l'app.
- `updatedAt` doit être `request.time` côté règles (horodatage serveur au moment de l'écriture, pas un horodatage client) — utiliser `serverTimestamp()` du SDK, jamais une date calculée sur l'appareil (dérive d'horloge).
- `position` : `GeoPoint` Firestore natif (pas un objet `{lat,lng}` maison). `geohash` : recalculé par l'app à chaque envoi (même bibliothèque que le serveur, précision 9) pour permettre les requêtes de proximité côté back-office.
- **Fréquence recommandée** : toutes les 4 à 8 secondes pendant une course active (`activeOrderIds` non vide), et une fois toutes les 30 à 60 secondes quand le livreur est simplement « disponible » sans course (pour limiter la consommation batterie/données). Pas d'envoi du tout quand le livreur est hors ligne — passer plutôt par la fonction qui bascule sa disponibilité (à identifier au moment de construire l'app : recherche `availability` dans les Cloud Functions de dispatch).
- **Arrière-plan / batterie** : sur Android, utiliser un service de localisation au premier plan (foreground service) avec une notification persistante pendant une course active — obligatoire au-delà d'Android 10 pour continuer à recevoir des positions écran éteint ; réduire la fréquence ou suspendre l'envoi si l'app passe en arrière-plan hors course active. Sur iOS, utiliser le mode de localisation « en cours d'utilisation » pendant une course et demander l'autorisation « toujours » uniquement si une course en arrière-plan est un scénario produit validé (sinon, s'en tenir à l'avant-plan pour limiter l'impact batterie et les frictions de validation App Store).
- Écarter les positions dont `accuracyMeters` dépasse un seuil déraisonnable (ex. 100 m) plutôt que de les envoyer : mieux vaut ne rien envoyer qu'une position trompeuse pour le client qui suit la course.

**Ce que les lecteurs consomment :**
- **Client (app à venir)** : autorisé à lire `driverLocations/{driverId}` uniquement si son `uid` figure dans `visibleTo` (liste tenue par le serveur au moment de l'attribution de la course, retirée à la livraison). Écouter le document en temps réel (`onSnapshot`), jamais en interrogation répétée (`get()` en boucle).
- **Restaurant (déjà en place, `apps/restaurant` `LivePage`/`LiveMap`)** : même principe, `visibleTo` inclut le personnel du restaurant concerné par la course en cours.
- **Super admin (déjà en place, `a-livreurs-operations` suivi de flotte)** : lit via la permission `drivers.view` ou `orders.view` (pas de restriction `visibleTo`), toutes positions confondues par ville/zone.
- **Dernière position connue** : `driverLocations/{driverId}` porte déjà la dernière position (un seul document, écrasé à chaque mise à jour) — pas de collection d'historique séparée aujourd'hui (voir `docs/AUDIT_COUVERTURE_CDC.md`, limite documentée : pas d'historique de trajet conservé). Une app qui a besoin d'un tracé complet du trajet (et non juste du point courant) devra construire sa propre historisation le moment venu — hors périmètre de cette tâche.
- **Statut en ligne/hors ligne** : le champ `availability` du même document reflète l'état courant (`online`, `busy`, `offline`… selon `DriverAvailability`) ; un lecteur qui veut savoir si un livreur est joignable regarde ce champ plutôt que la fraîcheur de `updatedAt` seule (un livreur qui vient de passer hors ligne peut conserver une position récente).
- Langues actives : `settings/translator.activeLocales` (fr toujours présent ; en/ar par défaut, extensible). Une langue absente de cette liste n'a jamais de traduction à afficher : repli français normal.

## 25. Vente au poids et à prix variable (app client)

Décision client : tous types de commerces, produits vendus à l'unité, au poids ou à prix variable
(`docs/DECISIONS_CLIENT.md`). Modèle produit : `Product.saleUnit` (`'unit' | 'weight' | 'variable'`, absent =
à l'unité), `pricePerKgCents`, `weightStepGrams`/`minWeightGrams`/`maxWeightGrams` (vente au poids),
`variablePriceMaxCents` (prix variable, `packages/shared/src/models/menu.ts`). Le prix affiché sur la carte
d'un article `weight`/`variable` est **indicatif** : le montant réellement dû est calculé côté serveur, à la
commande puis confirmé par le commerce à la préparation.

**Panier envoyé par l'app client (`placeOrder`) :**
- Article `weight` : la ligne (`lines[]`) doit porter `weightGrams` (poids souhaité, en grammes). Sans cette
  valeur, le serveur retombe sur `product.minWeightGrams` (ou `weightStepGrams`) ; s'il n'y en a aucun, la
  commande est refusée (« Indiquez le poids souhaité… »). Le poids est validé contre `minWeightGrams` /
  `maxWeightGrams` du produit (message d'erreur explicite si hors bornes). Le sous-total de la ligne = prix au
  kg (`pricePerKgCents`) × poids réel, arrondi au centime le plus proche.
- Article `variable` : rien à envoyer de plus — le serveur autorise le montant au plafond du produit
  (`variablePriceMaxCents`, ou `priceCents` si non renseigné) ; c'est ce montant qui est pré-autorisé au
  paiement. L'app doit afficher ce prix comme **« prix indicatif, confirmé à la préparation »**, jamais comme
  un prix ferme.
- Article `unit` : inchangé, aucun champ supplémentaire.
- La commande créée porte sur chaque ligne concernée `saleUnit`, `pricePerKgCents`, `weightGrams` (poids
  demandé) — l'app les relit pour afficher « au poids » / « prix variable » sur le récapitulatif et le suivi
  de commande, plutôt qu'un montant fixe trompeur.

**Ajustement à la préparation (déjà géré par le back-office restaurant, `adjustOrderItemWeight`) :**
- Le commerce entre le poids réellement pesé (article `weight`) ou fixe le prix final, plafonné au montant
  pré-autorisé (article `variable`), pendant que la commande est `accepted`/`preparing`.
- **Le client ne paie jamais plus que le montant indiqué à la commande** : si le montant réel est inférieur,
  la différence est remboursée automatiquement sur le moyen de paiement d'origine (même mécanique que le
  retrait d'un article indisponible, cause de remboursement `weight_adjustment`) ; si le poids réel est
  supérieur à l'estimation, l'écart est absorbé par le commerce, jamais refacturé au client.
- La commande porte ensuite `actualWeightGrams` (poids réellement pesé) et `finalTotalCents` (montant final
  de la ligne, éventuellement inférieur à `totalCents`) sur la ligne concernée ; l'app doit afficher
  `finalTotalCents` (une fois présent) au lieu de `totalCents`, et peut afficher `totalCents` comme montant
  « indicatif, au poids » avant que l'article ne soit pesé.
- Un message automatique (`item_weight_adjusted`) est envoyé au client quand un remboursement en résulte.
