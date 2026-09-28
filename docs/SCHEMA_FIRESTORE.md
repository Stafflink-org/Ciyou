# Ciyou Eats — Schéma Firestore

Schéma complet de la base `golink-9f16d` (Firestore, `europe-west1`). Il sert à toute la plateforme : back-office restaurant, super admin, app client et app livreur.

Trois sources font foi, dans cet ordre :

1. **Types TypeScript** : `packages/shared/src/models/*.ts`. Une interface par document, avec tous les champs.
2. **Noms de collections** : `packages/shared/src/constants/collections.ts` (`COLLECTIONS`, `SUBCOLLECTIONS`, `paths`).
3. **Règles de sécurité** : `firebase/rules/*.rules`, assemblées dans `firebase/firestore.rules` par `npm run rules:build`. **Index** : `firebase/firestore.indexes.json`.

Ce document reprend, pour chaque collection :

- le chemin ;
- les champs principaux ;
- les index ;
- qui lit et qui écrit ;
- les Cloud Functions associées.

Pour le détail exhaustif des champs, ouvrir l'interface TypeScript indiquée.

---

## 1. Principes

| Principe | Mise en œuvre |
|---|---|
| Multi-tenant | Tout ce qui appartient à un restaurant est sous `restaurants/{rid}/…` ou porte un champ `restaurantId`. Droits : `restaurants/{rid}/members/{uid}` |
| Groupes et chaînes | `restaurantGroups/{groupId}` (propriétaire, conditions communes, facturation consolidée). Chaque restaurant porte `groupId` et `ownerId` ; le propriétaire du groupe est membre `owner` de chaque établissement |
| Commandes | Collection racine `orders`, pour les requêtes transverses (client, livreur, restaurant, admin). Journal `orders/{id}/events` |
| Montants | Entiers en **centimes** (`…Cents`), taux en **points de base** (`…Bps`, 1 000 = 10 %). Aucun flottant pour l'argent |
| Dates | `Timestamp` pour les instants. Chaînes `AAAA-MM-JJ` pour les dates calendaires (planning, pointage). `HH:MM` pour les heures locales |
| Statuts | Un seul enum anglais en snake_case par notion (`constants/enums.ts`). Libellés français dans `constants/labels.ts` |
| Multi-pays | `countryId` (code ISO : FR, LU) et `cityId` partout où c'est pertinent (restaurants, livreurs, commandes, zones, tickets, statistiques, promotions) |
| Audit | `auditLogs` écrit uniquement par Cloud Function, jamais modifié. Historique des réglages dans `settingsHistory` |
| Suppression | Comptes (users, restaurants, livreurs, groupes) : suppression logique (`deletedAt`, `deletedBy`, `deleteReason`) puis anonymisation RGPD. Autres documents (produits, sections, documents…) : déplacés dans `trash` avec leur contenu, restaurables jusqu'à `purgeAt`. Les factures ne sont **jamais** supprimées |
| Écritures sensibles | Statuts de validation, commissions, rôles, permissions, montants de commande, soldes, compteurs : **Cloud Functions uniquement** (SDK Admin). Les règles interdisent ces champs au client, au restaurant et au livreur |
| Recherche | Champ `searchKeywords` (préfixes normalisés, `buildSearchKeywords`) avec `array-contains`. Numéro de commande `GL-xxxxx`, numéro de ticket `T-xxxxxx` |
| Traçabilité | Documents « Tracked » : `createdAt`, `createdBy`, `updatedAt`, `updatedBy` (horodatage serveur vérifié par les règles) |

### 1.1 Identités et rôles

| Acteur | Custom claim `role` | Droits fins |
|---|---|---|
| Client | `client` | Ses propres documents (`customerId == uid`) |
| Livreur | `driver` | Ses documents (`driverId == uid`) |
| Personnel restaurant | `restaurant` (ou `client` pour un employé sans accès back-office) | `restaurants/{rid}/members/{uid}` : `role` (owner, manager, kitchen, service, accountant, employee, custom) + `permissions[]` résolues par Cloud Function (`permissions/restaurant.ts`) |
| Équipe interne | `admin` | `admins/{uid}` : `role` (super_admin, support, finance, sales, ops, city_manager), `permissions[]` résolues depuis `adminRoles`, `cityIds` (périmètre), `refundLimitCents` (`permissions/admin.ts`) |

Dans les tableaux ci-dessous : **C** = client, **L** = livreur, **R** = membre du restaurant (avec la permission indiquée), **A** = administrateur (avec la permission indiquée), **CF** = Cloud Function. Une collection sans règle d'écriture client est en écriture **CF uniquement**.

---

## 2. Plateforme et marchés (`models/platform.ts`)

| Chemin | Contenu (type TS) | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `settings/{doc}` | Documents fixes : `general`, `branding`, `orderRules` (`OrderRulesSettings` : délai d'acceptation, annulation client, imputation des remboursements, client absent, produit indisponible, avoirs de retard, alcool, commandes programmées), `dispatch`, `payments`, `refunds`, `payouts`, `loyalty`, `referral`, `promotions`, `display` (classement, mention « sponsorisé »), `support`, `security`, `retention`, `maintenance` | Public : general, branding, payments, maintenance, display, loyalty, referral. Connecté : orderRules, promotions, support. A `settings.view` : tout | A `settings.edit` (`security` : A `security.manage`) | `onSettingsWrite` → `settingsHistory` + `auditLogs` |
| `settingsHistory/{id}` | `docPath`, `changedFields[]`, `before`, `after`, `reason?`, `changedBy`, `changedAt` | A `settings.view` | CF | — |
| `countries/{FR}` | `Country` (FR, BE, LU, DZ, MA, TN) : `code`, `name`, `active`, `currency` (EUR, DZD, MAD, TND), `vatValidated?`, `vatNote?`, `stripeAvailable?`, `locales[]`, `timezone`, `pricing: MarketPricingConfig`, `orderRules?`, `paymentMethods`, `billingEntity` (entité Ciyou Eats qui facture, préfixe de facture), `legal` (autorité DAC7, URSSAF, âge alcool) | Public | A `markets.edit` | — |
| `cities/{id}` | `City` : `countryId`, `name`, `slug`, `active`, `launchedAt?`, `center`, `serviceHours: WeeklyHours`, `pricing?`, `orderRules?`, `dispatch?`, `emergencyClosure?`, `commissionOverrideBps?`, `managerIds[]`, `stats?` | Public | A `markets.edit`, ou A `zones.edit` dans sa ville | `onCityWrite` : recalcule `acceptingOrders` des restaurants en cas de coupure |
| `zones/{id}` | `Zone` : `countryId`, `cityId`, `name`, `active`, `polygon: LatLng[]` (≥ 3 points), `bounds`, `maxDeliveryDistanceMeters`, `deliveryTiers?`, `minOrderCents?`, `serviceHours?`, `emergencyClosure?`, `currentSurge?`, `live?` (livreurs en ligne et disponibles, commandes en attente) | Public | A `zones.edit` dans la ville (`live` : CF) | `computeZoneLive` (chaque minute) → `live` + alerte `zone_driver_shortage` |
| `surgeRules/{id}` | `SurgeRule` : `cityId`, `zoneIds[]`, `trigger` (manual, schedule, demand), `multiplierBps`, `flatFeeCents`, `courierBonusCents`, `startsAt?`, `endsAt?` | A `zones.edit`, `drivers.pay_rules` | A `zones.edit` dans la ville | `applySurge` → `zones.currentSurge` |
| `featureFlags/{key}` | `FeatureFlag` : `key` (livraison, retrait, carte, fidélité, promotions, suivi livreur, stock, multi-boutiques, programmées, alcool…), `enabled`, `overrides[]` (portée pays, ville, formule ou restaurant) | Public | A `features.edit` | — |
| `integrations/{key}` | `PlatformIntegration` : stripe, brevo, google_maps, fcm, sms, accounting ; `status`, `mode` (test ou live), `publicConfig` (aucun secret) | A `integrations.view` | A `integrations.edit` (état : CF) | `checkIntegrations` (planifié) |
| `appVersions/{app}` | `latestVersion`, `minimumVersion`, `forceUpdate`, `message?`, `storeUrls?` | Public | A `system.manage` | — |
| `serviceStatus/{key}` | `ServiceStatus` : `status` (operational … major_outage), `latencyMs?`, `errorRate?`, `checkedAt`, `openIncidentId?` | A `system.view` | CF | `healthCheck` (planifié) → alerte `service_down` |
| `incidents/{id}` | `Incident` : `services[]`, `severity`, `status`, `updates[]`, `postMortem?` | A `system.view` | A `system.manage` | — |
| `counters/{name}` | `value`, `prefix` : `orders`, `tickets`, `invoice_{série}` | — | CF (transaction) | Numérotation continue |
| `cuisineCategories/{id}` | `name: LocalizedText`, `slug`, `icon?`, `image?`, `order`, `active` | Public | A `display.edit` | — |
| `homeSections/{id}` | `type` (welcome_message, banner_carousel, featured_restaurants, promotions, popular, new_restaurants, categories, reorder), `cityIds \| null`, `order`, `restaurantIds?`, période | Public | A `display.edit` | — |
| `banners/{id}` | `title`, `image`, `link?`, `cityIds`, `order`, période, `sponsored` | Public | A `display.edit` | — |
| `sponsoredPlacements/{id}` | `restaurantId`, `cityId`, `slot`, `priceHtCents`, période, `status`, `invoiceId?`, compteurs | A `display.edit` / `finance.view` ; R `finance.view` (les siens) | Vente : CF `bookSponsoredPlacement` ; A `display.edit` (hors prix et compteurs) | Facturation `sponsored_invoice` |
| `pages/{slug}` | FAQ, à propos… : `title`, `body` (LocalizedText), `audience[]`, `published` | Public si publiée | A `display.edit` | — |
| `helpArticles/{id}` | Centre d'aide : `title`, `body`, `category`, `audience[]`, `published`, `views`, `helpfulYes/No` | Public si publié | A `support.configure` (compteurs : CF) | — |

Index : `platformAlerts`, `statsDaily` (voir §13).

---

## 3. Utilisateurs (`models/users.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `users/{uid}` | `UserProfile` : `role`, `firstName`, `lastName`, `displayName`, `email`, `emailVerified`, `phone?`, `phoneVerified`, `avatar?`, `locale`, `status` (active, blocked, pending_deletion, deleted), `blockedReason?`, `defaultAddressId?`, `consents`, `notificationPrefs`, `walletBalanceCents`, `referralCode`, `referredBy?`, `stats` (commandes, dépenses, annulations, remboursements), `acceptedLegal`, `countryId?`, `cityId?`, `searchKeywords`, suppression logique | Soi ; A `customers.view` / `drivers.view` / `restaurants.view` | Soi : nom, téléphone, avatar, langue, adresse par défaut, préférences. A `customers.edit` : mêmes champs. Rôle, statut, solde, stats : CF | `onUserCreated` (Auth) : profil, claims, code de parrainage. `blockUser`, `deleteAccount` (RGPD), `onUserWrite` → `searchKeywords` |
| `users/{uid}/addresses/{id}` | `UserAddress` : `label`, `line1`, `line2?`, `postalCode`, `city`, `countryCode`, `geo` (obligatoire), `geohash?`, `details?`, `instructions?`, `floor?`, `doorCode?`, `isDefault` | Soi ; A `customers.view` | Soi | — |
| `users/{uid}/favorites/{id}` | `type` (restaurant, product), `restaurantId`, `productId?` | Soi | Soi (création, suppression) | — |
| `users/{uid}/notifications/{id}` | `title`, `body`, `category`, `link?`, `read`, `readAt?` | Soi | Soi : marquer lu, supprimer. Création : CF | `notify` |
| `users/{uid}/devices/{deviceId}` | `platform`, `app`, `appVersion`, `fcmToken?`, `model?`, `lastSeenAt` | Soi | Soi | Empreinte appareil → `userPrivate.deviceHashes` |
| `users/{uid}/paymentMethods/{id}` | `SavedPaymentMethod` : `brand`, `last4`, `expMonth/Year`, `wallet?`, `isDefault`, `providerMethodId` (jamais le numéro) | Soi | CF (Stripe SetupIntent) | `attachPaymentMethod`, `detachPaymentMethod` |
| `users/{uid}/consents/{id}` | `ConsentLog` : `key`, `granted`, `source`, `policyVersion?`, `at` (journal non modifiable) | Soi ; A `gdpr.handle` | CF | `setConsent` |
| `userPrivate/{uid}` | `stripeCustomerId?`, `riskScore`, `riskFlags[]`, `deviceHashes[]`, `cardFingerprints[]`, `phoneHash?`, `fraudCaseIds[]` | A `customers.view` / `fraud.view` | CF | Détection de comptes liés |
| `walletTransactions/{id}` | Avoirs : `userId`, `type` (credit, debit, expiry, reversal), `amountCents`, `balanceAfterCents`, `reason`, `orderId?`, `ticketId?`, `refundId?`, `expiresAt?` | Soi ; A `customers.view` / `finance.view` | CF | `creditWallet` (A `customers.credit`), `expireWalletCredits` |
| `loyaltyAccounts/{uid}` ou `{uid}_{rid}` | `scope` (platform, restaurant), `points`, `lifetimePoints`, `tier?` | Soi ; R `customers.view` (portée restaurant) ; A | CF | `onOrderDelivered` (gain), `redeemLoyalty` |
| `loyaltyTransactions/{id}` | `accountId`, `userId`, `type` (earn, redeem, welcome, expire, adjust), `points`, `orderId?` | Soi ; A | CF | — |
| `referrals/{id}` | `program` (client, restaurant, driver), `referrerId`, `refereeId`, `code`, `status`, récompenses | Parrain, filleul ; A | CF | `onOrderDelivered` / validation partenaire → récompense |

Index : `walletTransactions (userId, createdAt desc)`, `legalAcceptances (userId, acceptedAt desc)`.

---

## 4. Restaurants (`models/restaurants.ts`, `models/menu.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `restaurantGroups/{groupId}` | `RestaurantGroup` : `name`, `ownerId`, `countryId`, identité légale, `restaurantIds[]`, `commercial?` (commission et formule communes), `consolidatedBilling` | Propriétaire ; A `restaurants.view` | A `restaurants.edit` (hors propriétaire, conditions, liste) ; reste CF | `createGroup`, `attachRestaurantToGroup` |
| `restaurants/{rid}` | `Restaurant` : `name`, `slug`, `groupId?`, `ownerId`, `countryId`, `cityId`, `zoneIds[]`, `address` (geo, geohash), contact, `description?`, `cuisineIds[]`, `tags[]`, `priceLevel`, `logo?`, `cover?`, `photos[]`, `accent`, `mark`, **`status`** (onboarding, active, paused, suspended, closed), **`onboardingStatus`** (draft, pending, documents_missing, approved, rejected), `isOpen`, `acceptingOrders` (calculé), `busyExtraMinutes`, `fulfillmentModes[]`, `deliveredBy` (platform, restaurant, both), `minOrderCents`, `ownDeliveryFeeCents?`, `prepMinutes`, `etaMinutes`, `rating`, `hoursSummary`, `planCode`, `sponsored`, `rankingScore`, `qualityScore`, `allergensComplete`, `sellsAlcohol`, `acceptedPaymentMethods[]`, `ordersCount`, `suspension?`, `searchKeywords`, `currency?` (EUR, DZD, MAD, TND ; repli pays puis EUR via `resolveRestaurantCurrency`, formatage seulement), `ownerCredentialsDelivered?` (le propriétaire a-t-il déjà de quoi se connecter) | Public si `status == active` ; membres ; A `restaurants.view` (dans sa ville) | R `settings.manage` : profil (description, visuels, cuisine, temps de préparation, livraison propre, ouverture). R `orders.manage` : `isOpen`, `busyExtraMinutes` (≤ 90). A `restaurants.edit` : profil + nom, zones, modes, minimum. Statut, validation, formule, notes, scores : CF | `registerRestaurant` (inscription autonome), `reviewRestaurant` (validation, refus motivé), `suspendRestaurant` / `reactivateRestaurant`, `computeAcceptingOrders` (horaires, zone, abonnement, documents), `computeQualityScores` (nuit), `computeRankingScores` (nuit), `bulkUpdateRestaurants`, `importRestaurants`, `importMenu`, `startImpersonation` |
| `restaurants/{rid}/private/commercial` | `RestaurantCommercial` : `planCode`, `subscriptionId?`, `subscriptionStatus`, `negotiatedCommission?`, `specialOffer?`, `allowedPaymentMethods[]`, `deliveryFeeOverrideCents?`, `minOrderOverrideCents?`, `payoutFrequency?`, `payoutsBlocked`, `stripeAccountId?` | R `finance.view` ; A `restaurants.commercial` / `finance.view` | CF | `setCommercialTerms` (audit + `commissionRules`), `holdPayouts` |
| `restaurants/{rid}/private/legal` | `RestaurantLegal` : raison sociale, SIRET, TVA intracom., adresse du siège, gérant, `ibanMasked?`, licence alcool, `taxIdentificationNumber?`, `dac7Complete`, version du contrat accepté | R `settings.manage` ; A | CF | `saveLegalInfo`, `createStripeAccountLink` |
| `restaurants/{rid}/settings/{doc}` | `orders` (temps de préparation, capacité, minimum, modes, acceptation auto, programmées, impression), `hours` (`WeeklyHours` : plusieurs créneaux par jour, exceptions), `payments` (dans la limite de `allowedPaymentMethods`), `loyalty`, `notifications`, `payroll` (`PayrollSettings`), `haccp` | Membres ; A | R `settings.manage` (payroll : `payroll.manage` ; haccp : `haccp.manage`) ; A `restaurants.edit` | `onRestaurantSettingsWrite` : recopie les horaires et modes sur la fiche, retire les moyens non autorisés |
| `restaurants/{rid}/deliveryZones/{id}` | Zones propres (livreurs du restaurant) : `type` (radius, polygon), `radiusMeters?`, `polygon?`, `feeCents`, `minOrderCents?`, `enabled`, `order`, `color` | Public | R `zones.manage` | — |
| `restaurants/{rid}/sections/{id}` | `MenuSection` : `name` (≤ 80, unique), `description?`, `image?`, `enabled`, `hideProductNames`, `order`, `availability?` | Public | R `menu.edit` ; A `restaurants.edit` | `moveToTrash` (suppression) |
| `restaurants/{rid}/products/{id}` | `Product` : `sectionId`, `name` (≤ 100), `description?`, `priceCents`, `compareAtPriceCents?`, `vatCategory` (food, soft_drink, alcohol, grocery), `image?`, `available`, `stock` (null = illimité), `lowStockThreshold`, `preparationMinutes?`, `optionGroupIds[]`, `allergens[]` (14 allergènes UE), `allergensDeclared`, `dietary[]`, `containsAlcohol`, `nutrition?`, `featured`, `order`, `salesCount`, `externalId?`, `searchKeywords` | Public | R `menu.edit` (hors `salesCount`) ; R `stock.edit` : `stock`, `available` | `onProductWrite` : contrôle qualité → `menuIssues`, `allergensComplete` ; décrément et recrédit de stock dans `placeOrder` / `cancelOrder` |
| `restaurants/{rid}/options/{id}` | `MenuOption` : `name` (≤ 90), `priceCents`, `enabled`, `allergens[]`, `linkedProductId?` | Public | R `menu.edit` | — |
| `restaurants/{rid}/optionGroups/{id}` | `OptionGroup` : `name`, `optionIds[]` (≥ 1), `enabled`, `multiple`, `min`, `max` (0 ≤ min ≤ max, max ≥ 1), `allowQuantity` | Public | R `menu.edit` | — |
| `restaurants/{rid}/stockMovements/{id}` | `productId`, `delta`, `stockAfter`, `reason`, `orderId?` | R `menu.view` ; A | R `stock.edit` (ajustements manuels) ; CF (commandes) | — |
| `restaurants/{rid}/members/{uid}` | `RestaurantMember` : `role`, `customRoleId?`, `permissions[]`, `active`, `onDuty`, `employeeId?`, invitation | Soi ; R `team.view` ; A | R `team.manage` : `onDuty` seulement ; le reste en CF | `inviteMember` (e-mail Brevo), `updateMemberRole`, `removeMember`, `onStaffRoleWrite` (propagation des permissions) |
| `restaurants/{rid}/staffRoles/{id}` | Rôle personnalisé : `name`, `permissions[]`, `system` | R `team.view` | R `team.manage` (hors rôles système) | `onStaffRoleWrite` |
| `restaurants/{rid}/customers/{uid}` | CRM : `displayName`, `phoneMasked?`, `blocked`, `blockedReason?`, `internalNote?`, `tags[]`, agrégats (commandes, dépenses, panier moyen, dates) | R `customers.view` ; A | R `customers.manage` : blocage, note, étiquettes ; agrégats : CF | `onOrderDelivered` ; blocage vérifié par `placeOrder` |
| `restaurants/{rid}/customers/{uid}/notes/{noteId}` | `CustomerNote` : `body` (≤ 1 000), `authorId`, `authorName`, `createdAt` ; la dernière note est recopiée dans `internalNote`, le compteur dans `notesCount` | R `customers.view` ; A `customers.view` | CF | `addCustomerNote`, `deleteCustomerNote` (auteur ou propriétaire). Blocage : `setCustomerBlocked` (motif obligatoire, audit, jusqu'à 50 clients) |
| `restaurants/{rid}/couriers/{driverId}` | `relation` (own, platform), `status` (active, inactive, blocked), `note?`, compteurs | Livreur concerné ; R `orders.view` ; A | R `couriers.manage` : statut, note (écran : CF `updateCourier`, motif et audit pour un blocage ; zones `zoneIds` des livreurs propres) | `onOrderDelivered` ; exclusion des livreurs bloqués au dispatch ; `inviteOwnCourier` (livreur propre : compte, `drivers/{uid}` type restaurant, fiche avec `invitation`, e-mail) |
| `restaurants/{rid}/dailyStats/{AAAAMMJJ}` | `RestaurantDailyStats` : commandes (livrées, annulées, refusées, en retard), ventes, net, commission, remises, panier moyen, préparation moyenne, par mode, par paiement, par heure | R `dashboard.view` / `finance.view` ; A | CF | `aggregateRestaurantStats` |
| `restaurants/{rid}/announcementReads/{announcementId}` | `readBy`, `readAt` | Membres | Membres (création) | — |
| `partnerDocuments/{id}` | `PartnerDocument` : `ownerType` (restaurant, driver), `ownerId`, `countryId`, `cityId?`, `type` (kbis, siret_notice, manager_id, bank_details, alcohol_license, identity, residence_permit, work_permit, siret_registration, urssaf_certificate, insurance, driving_license, vehicle_registration…), `file`, `status` (pending, approved, rejected, expired), `expiresAt?`, `rejectionReason?`, `remindersSent` | Propriétaire (R `settings.manage` ou le livreur) ; A `restaurants.validate` / `drivers.validate` | Propriétaire : dépôt (`pending`). Validation : CF | `reviewDocument`, `checkDocumentExpiry` (quotidien : relance J-30, J-7, puis blocage et alerte `document_expired`) |
| `menuIssues/{id}` | `restaurantId`, `productId?`, `type` (missing_photo, price_outlier, allergens_missing, missing_description, empty_section), `status` | R `menu.view` ; A | R `menu.edit` / A : corrigé ou ignoré | `onProductWrite`, `auditMenus` (nuit) |
| `posConnections/{id}` | Logiciel de caisse : `provider`, `status`, `syncMenu`, `pushOrders`, `lastSyncAt?`, `lastError?`, `errorCount24h` | R `settings.manage` ; A `integrations.view` | CF | Connecteurs caisse (webhooks) |

Index :

- `restaurants` : (cityId, status, rankingScore desc), (status, rankingScore desc), (cityId, onboardingStatus, createdAt desc), (cuisineIds contains, status, rankingScore desc), (searchKeywords contains, name), (planCode, cityId, createdAt desc).
- `products` : (sectionId, order), (available, order), groupe de collections (searchKeywords contains, name).
- `partnerDocuments` : (ownerType, ownerId, createdAt desc), (status, expiresAt).
- `menuIssues` : (restaurantId, status, detectedAt desc).
- `products` : (featured, featuredOrder) pour la vitrine ; `stockMovements` : (productId, createdAt desc).

### 4.1 Carte : compléments (rubriques Produits & menu, Options & listes, Ventes & stocks, Produits mis en avant)

Constantes : `constants/menu.ts` (régimes, badges, motifs de stock, anomalies, limites, colonnes CSV, termes d'alcool).

| Élément | Détail |
|---|---|
| `Product` (champs ajoutés) | `gallery[]` (photos après la principale, 6 au total), `badge` (`PRODUCT_BADGES`), `tags[]`, `schedule` (jours + plage horaire), `featuredOrder` (ordre de vitrine), `autoSoldOut` (rupture automatique), `qualityIssues[]` (écrit par `onProductWritten`) |
| `TrashItem` (champs ajoutés) | `menuKind` (section, product, option, optionGroup), `detached` (liens retirés, rétablis à la restauration) |
| `menuIssues.type` | + `alcohol_suspected` (mention d'alcool repérée : vente interdite, décision client) |
| Alcool | Règles : création / modification d'un produit refusée si `vatCategory == alcohol` ou `containsAlcohol`. `onProductWritten` retire de la vente un produit interdit ; `importMenu` rejette la ligne |
| Photos | `restaurants/{rid}/public/menu/products/{productId}/{id}.jpg` (+ `_thumb`), recadrées 4:3 et compressées dans le navigateur |

Cloud Functions (`functions/src/menu`) :

| Fonction | Rôle | Droit |
|---|---|---|
| `adjustStock` | Transaction : nouveau stock (ajout, retrait, comptage, activation / arrêt du suivi), seuil d'alerte, mouvement `stockMovements` | R `stock.edit` ; A `restaurants.edit` |
| `duplicateSection` | Copie d'une section (avec ou sans ses produits), désactivée, en fin de carte | R `menu.edit` |
| `reorderMenu` | Ordre des sections, des produits d'une section (et changement de section), vitrine | R `menu.edit` |
| `importMenu` | Import CSV (rapprochement par référence puis par nom), simulation `dryRun`, sections créées à la volée, audit | R `menu.edit` |
| `trashMenuItems` / `restoreMenuItem` | Corbeille de la carte (30 jours) : section (produits conservés ou supprimés), produit, option (retirée des listes), liste (retirée des produits) | R `menu.edit` |
| `onProductWritten` | Mots-clés, rupture automatique et remise en vente, contrôle qualité → `qualityIssues` + `menuIssues`, `allergensComplete` du restaurant, blocage de l'alcool | — |
| `uploadMenuPhoto` | Dépôt serveur d'une photo déjà recadrée (JPEG, 2 Mo max, + vignette) sous `restaurants/{rid}/public/menu/…`, utilisé quand Storage refuse l'envoi direct (règles Storage relisant Firestore : le rôle IAM `roles/firebaserules.firestoreServiceAgent` doit être accordé à l'agent de service Storage) | R `menu.edit` ; A `restaurants.edit` |

### 4.2 Configuration de l'établissement (rubriques « Configuration » du back-office restaurant)

Rubriques : `parametres` (vue d'ensemble, mise en route), `etablissement`, `horaires`, `reglages-commandes`, `zones`, `paiements`, `notifications`, `utilisateurs`, `documents`, `versements`, `abonnement`. Contrôles partagés : `utils/restaurant-config.ts` (`validateWeeklyHours`, `publicHolidays`, `isValidSiret`, `isValidVatNumber`, `RESTAURANT_LABELS`).

Cloud Functions (`functions/src/restaurant`), permission vérifiée côté serveur, audit à chaque écriture :

| Fonction | Rôle |
|---|---|
| `updateRestaurantSettings` | Sections `profile` (nom réservé au propriétaire, cuisines existantes, `labels`, `allergenNotice`), `address` (position contrôlée dans une zone Ciyou Eats active de la ville ; `zoneIds`, `geohash` recalculés), `legal` (SIRET/RCS et TVA contrôlés s'ils changent, `dac7Complete` calculé), `orders` (modes selon les drapeaux, `deliveredBy` ; recopie `prepMinutes`, `etaMinutes`, `fulfillmentModes`, `minOrderCents`), `hours` (`validateWeeklyHours`), `payments` (moyens ∩ `private/commercial.allowedPaymentMethods` ∩ `countries.paymentMethods` ∩ drapeaux ; recopie `acceptedPaymentMethods`), `notifications`, `pause` (R `orders.manage` : `isOpen` + `pausedUntil`) |
| `onRestaurantSettingsWrite` | Filet de sécurité des écritures directes dans `settings/{orders,hours,payments}` : recopie sur la fiche, retrait des moyens non autorisés (idempotent) |
| `resumePausedRestaurants` | Toutes les 5 minutes : réouverture quand `pausedUntil` est échu |
| `saveDeliveryZone`, `deleteDeliveryZone` | Zones propres : rayon ≤ `plans.maxDeliveryRadiusMeters`, tracé contenu dans ce rayon, frais ≤ 20 €, 12 zones ; suppression vers `trash` (30 jours), refusée pour la dernière zone active si `deliveredBy = restaurant` |
| `setMemberPermissions`, `revokeMember` | Rôle standard, rôle sur mesure ou droits individuels ; jamais le propriétaire ni soi-même ; un non-propriétaire n'accorde que ses propres droits ; retrait motivé, claims resynchronisés |
| `saveStaffRole`, `deleteStaffRole` | Rôles sur mesure (20, nom unique), permissions répercutées sur leurs membres ; suppression refusée si un membre actif l'utilise |
| `uploadDocument`, `onDocumentUploaded` | Fichier déposé dans `restaurants/{rid}/private/documents/`, objet vérifié (≤ 10 Mo, PDF ou image) → `partnerDocuments` `pending` ; dossier `documents_missing` complet → `pending` |
| `acceptPartnerContract` | Propriétaire : `legalAcceptances/{documentId}_{rid}_{uid}` (signature simple, empreinte IP) et `private/legal.partnerTerms*` |
| `changePlan`, `applyPendingPlanChanges` | Propriétaire : formule supérieure immédiate (essai s'il n'a jamais servi), inférieure programmée via `subscriptions.pendingChange` à `currentPeriodEnd` ; même formule = annulation |

Champs ajoutés : `Restaurant.labels`, `allergenNotice`, `pausedUntil`, `pauseReason` ; `RestaurantOrderSettings.scheduledLeadMinutes`, `scheduledMaxDays`, `dineInInstructions` ; `RestaurantNotificationSettings.sound`, `volume`, `repeatUntilAccepted`, `alerts`, `emailWeeklyReport`, `emailInvoices` ; `RestaurantDeliveryZone.deliveryMinutes`, `freeAboveCents` ; `RestaurantLegal.partnerTermsDocumentId`, `partnerTermsAcceptedBy`, `partnerTermsSignatureName`, `rcsCity`, `shareCapitalCents` ; `RestaurantMember.revokedAt`, `revokedBy`, `revokeReason`, `permissionsUpdatedAt`, `permissionsUpdatedBy` ; `Subscription.pendingChange`. Index : `invoices` (recipient.type, recipient.id, kind, issuedAt desc).

---

## 5. Gestion d'entreprise du restaurant (`models/workforce.ts`, `models/haccp.ts`)

Ces collections reprennent les fonctions du back-office entreprise de StaffLink, adaptées au restaurant. Toutes sont sous `restaurants/{rid}/`. Le champ dénormalisé `employeeUid` donne à l'employé l'accès à ses propres données.

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `employees/{id}` | `Employee` : `uid?`, identité, `position`, `department?`, `contractType` (cdi, cdd, interim, extra, internship, apprenticeship), `status`, `hireDate`, `endDate?`, `weeklyHours`, `hourlyRateCents`, classification HCR, `socialCategory`, `socialSecurityLast4?`, `paidLeaveBalanceDays`, `rttBalanceDays`, `color`, `clockPinHash?` | R `team.view` ; l'employé (uid) ; A | R `team.manage` | `linkEmployeeAccount`, `accrueLeave` (mensuel) |
| `employeeDocuments/{id}` | Contrat, avenant, pièce, certificat… : `file`, `expiresAt?`, `visibleToEmployee` | R `team.manage` ; l'employé si visible | R `team.manage` | Rappel d'expiration |
| `availabilities/{employeeId_AAAA-MM-JJ}` | Matin, après-midi, soir ; `locked` | R `planning.view` ; l'employé | L'employé (tant que non verrouillé) ; R `planning.manage` | — |
| `shifts/{id}` | `employeeId`, `date`, `startTime`, `endTime`, `breakMinutes`, `position?`, `published`, `templateId?` | R `planning.view` ; l'employé | R `planning.manage` | `publishPlanning` (notifications), `shiftReminders` (planifié) |
| `shiftTemplates/{id}` | Semaine ou service type : `slots[]` | R `planning.view` | R `planning.manage` | `applyShiftTemplate` |
| `shiftChangeRequests/{id}` | Demande de l'employé : `status` (pending, approved, rejected, cancelled) | R `planning.manage` ; l'employé | L'employé : création, annulation ; R `planning.manage` : décision | `onShiftChangeApproved` → planning |
| `timeEntries/{employeeId_AAAA-MM-JJ}` | `TimeEntry` : `clockIn?` / `clockOut?` (heure, position GPS, précision, source), `breaks[]`, `workedMinutes`, `overtimeMinutes`, `nightMinutes`, `status` | R `timeclock.manage` ; l'employé | Pointage : CF `clockEvent` ; corrections : R `timeclock.manage` | `onTimeEntryWrite` → `history` |
| `timeEntries/{id}/history/{hid}` | `field`, `oldValue`, `newValue`, `changedBy`, `changedAt` (non modifiable) | R `timeclock.manage` | CF | — |
| `weekValidations/{employeeId_lundi}` | Total de la semaine ; `status` (pending, employee_validated, manager_validated, rejected) ; commentaires | R `timeclock.manage` ; l'employé | L'employé : validation ; R `timeclock.manage` : validation, refus | `buildWeekValidations` (hebdomadaire) |
| `absences/{id}` | `type` (paid_leave, unpaid_leave, sick, rtt, training, family_event, other), dates, demi-journées, `durationDays`, `attachment?`, `status` | R `planning.view` ; l'employé | L'employé (`absences.self`) : demande, annulation ; R `absences.manage` : décision | `onAbsenceApproved` (soldes, planning) |
| `payslips/{employeeId_AAAA-MM}` | `Payslip` : heures (normales, supplémentaires 10/20/50 %, nuit, dimanche, férié), brut, primes, avantage repas, cotisations salarié et employeur, net imposable, prélèvement à la source, net, `pdf?`, `status` | R `payroll.view` ; l'employé si validé ou envoyé | R `payroll.manage` : validation ; génération : CF | `generatePayslips`, `sendPayslips` |
| `tasks/{id}` | `title`, `priority`, `status`, `dueDate?`, `tags[]`, `assigneeIds[]` (uid), `assigneeStatus{uid}`, `recurrence?` | R `tasks.view` | R `tasks.manage` ; chaque assigné : son propre statut | `onTaskWrite` (statut global, notifications), `generateRecurringTasks` |
| `tasks/{id}/comments/{cid}` | `authorId`, `body`, `createdAt` | R `tasks.view` | R `tasks.view` (auteur = soi) | — |
| `taskTemplates/{id}` | Modèle de tâche : `dueOffsetDays?` | R `tasks.view` | R `tasks.manage` | — |
| `documents/{id}` | Documents de l'entreprise : `category`, `file`, `visibleToRoles[]` | R `documents.view` | R `documents.manage` | — |
| `haccpEquipments/{id}` | Enceinte : `kind`, `area`, `minTemp?`, `maxTemp?`, `readingsPerDay`, `active` | R `haccp.record` ; A | R `haccp.manage` | `haccpReminders` |
| `haccpTemperatureLogs/{id}` | `equipmentId`, `value`, `inRange`, `correctiveAction?`, `recordedBy`, `verifiedBy?` | R `haccp.record` | R `haccp.record` : relevé ; R `haccp.manage` : vérification | `onTemperatureLog` → non-conformité si hors plage |
| `haccpReceptions/{id}` | Contrôle à réception : fournisseur, produit, lot, DLC, température, 6 points de contrôle, `status` | R `haccp.record` | R `haccp.record` : saisie ; R `haccp.manage` : décision | — |
| `haccpNonConformities/{id}` | `severity`, `status`, `source?`, `correctiveActions[]` | R `haccp.record` | R `haccp.record` : déclaration ; R `haccp.manage` : traitement | — |
| `haccpCleaningTasks/{id}`, `haccpCleaningLogs/{id}` | Plan de nettoyage (zone, fréquence, produit, responsable) et traçabilité | R `haccp.record` | Plan : R `haccp.manage` ; relevés : R `haccp.record` | — |
| `haccpPestVisits/{id}`, `haccpPestReports/{id}` | Passages du prestataire nuisibles, signalements internes | R `haccp.record` | R `haccp.manage` / `haccp.record` | — |
| `haccpPersonnelChecks/{employeeId_date}` | Tenue, lavage des mains, absence de symptômes, cheveux protégés | R `haccp.record` | R `haccp.record` | — |
| `haccpDocuments/{id}`, `haccpAudits/{id}` | Plan de maîtrise sanitaire, fiches, formations ; audits internes ou officiels | R `haccp.record` | R `haccp.manage` | — |
| `haccpExports/{id}` | Registre PDF d'une période | R `haccp.manage` | CF | `exportHaccpRegister` |

Les allergènes des plats sont portés par `products.allergens`. Il n'y a pas de table séparée : le tableau des allergènes HACCP est une vue de la carte.

Index :

- `shifts` : (employeeId, date), (employeeUid, date).
- `timeEntries` : (employeeUid, date desc), (status, date desc).
- `absences` : (employeeUid, startDate desc), (status, startDate).
- `payslips` : (employeeUid, period desc).
- `tasks` : (assigneeIds contains, dueDate).
- `haccpTemperatureLogs` : (equipmentId, recordedAt desc).

---

## 6. Livreurs (`models/drivers.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `drivers/{uid}` | `Driver` : identité, `type` (platform, restaurant), `restaurantIds[]`, `vehicle` (bike, e_bike, cargo_bike, scooter, motorbike, car, on_foot), `zoneIds[]`, **`status`** (onboarding, active, suspended, deactivated), **`onboardingStatus`**, `rejectionReason?`, `availability` (offline, online, on_delivery, paused), `activeOrderIds[]`, `acceptsCash`, `rating`, `stats` (livraisons, taux d'acceptation, taux d'annulation, ponctualité, durée moyenne), `documentsValidUntil?`, `lastIdentityCheckAt?`, `countryId`, `cityId`, `searchKeywords` | Soi ; A `drivers.view` (dans sa ville) | Soi : `availability` (online, offline ou paused ; en ligne seulement si actif, et sans course en cours). A `drivers.edit` : coordonnées, zones, espèces. Statut : CF | `registerDriver`, `reviewDriver`, `sanctionDriver`, `bulkUpdateDrivers`, `computeDriverStats` |
| `driverPrivate/{uid}` | Date de naissance, nationalité, adresse, SIRET, TVA, attestation URSSAF, titre de séjour, `ibanMasked?`, `stripeAccountId?`, **`cashBalanceCents`**, `cashLimitCents`, `payoutsBlocked`, `taxIdentificationNumber?`, `dac7Complete`, contrat accepté | Soi ; A `drivers.view` / `finance.view` | CF | `saveDriverLegalInfo`, `recordCashRemittance` |
| `driverLocations/{uid}` | `position` (GeoPoint), `geohash`, `heading?`, `speedKmh?`, `accuracyMeters?`, `availability`, `cityId`, `zoneId?`, `activeOrderIds[]`, **`visibleTo[]`** (client et personnel des commandes en cours) | Soi ; uid présent dans `visibleTo` ; A `orders.view` / `drivers.view` | Soi : position uniquement. Création et `visibleTo` : CF | `onDriverOnline` ; purge après `retention.deleteDriverLocationsAfterDays` |
| `driverSessions/{id}` | `startedAt`, `endedAt?`, `onlineMinutes`, `activeMinutes`, `deliveries`, `earningsCents` | Soi ; A | CF | `computeHourlyGuarantee` (hebdomadaire) → `driverEarnings` `hourly_guarantee` |
| `driverSanctions/{id}` | `type` (warning, temporary_suspension, deactivation), `reason`, `status` (active, contested, upheld, overturned, expired), période, `contest?` | Soi ; A | Soi : contestation. Décision : CF | `sanctionDriver`, `decideSanctionContest` |
| `identityChecks/{id}` | Selfie de contrôle : `trigger`, `selfie?`, `status`, `matchScore?` | Soi ; A `drivers.validate` | Soi : envoi du selfie | `requestIdentityChecks` (aléatoire), `reviewIdentityCheck` |
| `dispatchOffers/{id}` | Proposition de course : `orderId`, `driverId`, `round`, `status` (offered, accepted, declined, expired, cancelled), distances, `estimatedPayCents`, `expiresAt` | Soi ; A `orders.view` | CF | `dispatchOrder` (plus proche, délai d'acceptation, élargissement du rayon), `respondToOffer` (transaction) |
| `driverEarnings/{id}` | `kind` (delivery, bonus, hourly_guarantee, referral, adjustment), `breakdown: CourierPay`, `amountCents`, `tipCents`, `payoutId?` | Soi ; A `finance.view` / `drivers.view` | CF | `onOrderDelivered` |

Index :

- `drivers` : (cityId, status, createdAt desc), (cityId, onboardingStatus, createdAt desc), (searchKeywords contains, displayName).
- `driverLocations` : (cityId, availability, geohash).
- `dispatchOffers` : (driverId, status, offeredAt desc), (orderId, offeredAt desc).
- `driverEarnings`, `driverSessions`, `driverSanctions` : (driverId, date desc).

### 6.1 Exploitation du super admin (livreurs, commandes, règles, zones)

Types : `models/operations.ts` (entrées et sorties des fonctions, `driverDocumentRequirements`, `resolveDispatchRules`, `dispatchRadiusForRound`, libellés). Fonctions : `functions/src/admin/operations/*` et `functions/src/orders/dispatch-advanced.ts`.

| Ajout | Détail |
|---|---|
| `drivers/{uid}` | `blocked` (`documents_expired`, `identity_check_failed`, `sanction`), `activeSanctionId`, `reviewedBy`, `reviewedAt`, `missingDocuments[]` |
| `identityChecks/{id}` | `cityId`, `referencePhoto` (photo de la pièce comparée au selfie), `submittedAt`, `reviewNote` |
| `settings/dispatch`, `cities.dispatch`, `zones.dispatch` | `mode` (`auto_assign`, `offers`), `engine` (`advanced`, `simple`), `minDriverRating` ; surcharge ville puis zone |
| `zones.live` | `driversOnDelivery`, `ordersInProgress` (calculés chaque minute par `computeZoneLive`) |
| `orders.delivery` | `dispatchRound`, `dispatchRadiusMeters`, `dispatchOfferId` |
| `platformAlerts.kind` | `dispatch_failed` (course sans livreur après tous les tours, `dedupKey = dispatch_failed_<orderId>`) |
| `settingsHistory` | aussi écrit par les fonctions d'exploitation : `docPath` suffixé `#dispatch`, `#orderRules`, `#courier`, `#emergencyClosure` ; `changedByName` |

Fonctions : `reviewDriverApplication`, `reviewDriverDocument`, `reviewIdentityCheck`, `requestIdentityChecks`, `sanctionDriver`, `decideSanctionContest`, `bulkUpdateDrivers`, `getDriverFile` (aperçu des justificatifs, droit `drivers.validate`), `dispatchOrder` (intervention : relance, livreur imposé, réattribution), `previewDispatch`, `respondToOffer` (livreur), `advanceDispatchOffers` (chaque minute), `updateDispatchRules`, `updateOrderRules` (alcool toujours verrouillé), `updateCourierPay` (barème pays ou ville), `saveCity`, `setCityActive`, `saveZone`, `closeZone`, `saveSurgeRule`, `applySurge`, `computeZoneLive` (chaque minute : `zones.live`, pointes planifiées et à la demande, fin des fermetures et suspensions), `runDriverCompliance` (quotidien : relances J-30/J-7, blocage automatique, selfies aléatoires), `onDriverLocationWritten` (zone courante), `listOrdersAdmin`, `getOrderAnomalies`. `dispatchOrder` du module commandes délègue au moteur avancé sauf `settings/dispatch.engine = 'simple'`.

Règles complémentaires : `firebase/rules/operations.rules` (historique d'audit d'un livreur, d'une commande, d'une zone ; historique des réglages pour `order_rules.edit`, `zones.edit`, `drivers.pay_rules`). Index : `orders` (driverId, createdAt desc), `dispatchOffers` (status, expiresAt), `driverSanctions` (status, endsAt), (cityId, createdAt desc), `identityChecks` (status, requestedAt asc et desc), (driverId, requestedAt desc), `auditLogs` (target.type, target.id, cityId, at desc), `settingsHistory` (docPath, changedAt desc), `platformAlerts` (kind, status, detectedAt desc), `partnerDocuments` (ownerType, cityId, status, createdAt desc), `driverEarnings` (cityId, earnedAt desc).

---

## 7. Commandes (`models/orders.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `orders/{orderId}` | `Order` : `number` (GL-xxxxx), `countryId`, `cityId`, `restaurantId`, `restaurantName`, `restaurantGroupId?`, `customerId`, `customerName`, `customerPhoneMasked?`, **`status`** (scheduled, new, accepted, preparing, ready, assigned, picked_up, delivered, cancelled), `fulfillment` (delivery, pickup, dine_in), `items[]` (copie figée : produit, prix, options, TVA, alcool, commentaire, ajustement), `itemsCount`, **`amounts`** (sous-total, service, petite commande, livraison, majoration, remise ventilée, pourboire, avoir utilisé, total, débité, remboursé, TVA par taux), `payment` (moyen, statut, libellé masqué), `promotionId?`, `promoCode?`, `delivery?` (adresse, geo, zone, distance, qui livre, livreur, heure promise, preuve, code de remise), `pickupCode?`, `pickupVerified`, `customerNote?`, `scheduledFor?`, `prepMinutes`, `prepExtendedMinutes`, `containsAlcohol`, `ageConfirmed`, **`timeline`** (horodatage de chaque étape), `acceptDeadline?`, `cancellation?` (motif, acteur, remboursement), `flags` (retard, remboursée, litige, fraude, première commande), `reviewId?`, `ticketIds[]`, `conversationId?`, `source`, `driverId?`, `searchKeywords`, `createdAt`, `updatedAt` | C (sa commande) ; L assigné ; R `orders.view` ; A `orders.view` (dans sa ville) | **CF uniquement** | `placeOrder` (contrôles, devis faisant foi, paiement Stripe, stock, numérotation, code de retrait), `advanceOrder`, `extendPrepTime`, `verifyPickupCode`, `cancelOrder` (motif, remboursement, stock), `replaceOrRemoveItem`, `enforceAcceptanceTimeout` (planifié : annulation et remboursement automatiques), `onOrderWritten` (stats journalières, ventes par produit, compteur `restaurants.missedOrdersInARow` + pause automatique au seuil `orderRules.autoPause`, remise à zéro à la première commande acceptée ; marqueurs `processed.salesCounted` / `processed.missCounted`). Décisions client appliquées par `placeOrder` : produits alcoolisés refusés (`checkProductAlcohol`), frais et minimum pris sur `restaurants/{rid}/deliveryZones` (adresse hors zones du commerce refusée ; sans zone, tarification de la ville), espèces seulement via `isCashAllowed` (livreur salarié du commerce), `restaurants.lastOrderAt` mis à jour, `detectLateOrders` (avoirs de retard), `onOrderDelivered` (stats, fidélité, gains, grand livre, reçu), `detectOrderAnomalies` → `platformAlerts` |
| `orders/{id}/events/{eventId}` | `OrderEvent` : `type` (created, status_changed, driver_assigned, prep_time_extended, pickup_code_verified, delivery_proof, item_removed, refund_issued…), `from?`, `to?`, `actor`, `actorId?`, `message?`, `visibleToCustomer`, `at` | C (événements visibles) ; R `orders.view` ; A | CF | Chronologie pour les litiges |
| `orderFinancials/{orderId}` | `Settlement` complet (reversement restaurant, commission HT et TVA, livreur, frais de paiement, TVA due, marge), `commissionBps`, `commissionSource`, remboursements imputés, `finalMarginCents`, reversements liés | A `finance.view` | CF | `onOrderDelivered`, `onRefundProcessed` |

Cycle de vie : `constants/order-flow.ts`.

```
delivery : new → accepted → preparing → ready → assigned → picked_up → delivered
pickup   : new → accepted → preparing → ready → delivered (code client vérifié)
```

L'assignation du livreur peut avoir lieu dès `accepted`. L'annulation est possible selon l'acteur (`CANCELLABLE_FROM`).

Index sur `orders` :

- (restaurantId, status, createdAt desc) ;
- (restaurantId, createdAt desc) ;
- (restaurantId, customerId, createdAt desc) (fiche client CRM) ;
- (restaurantId, driverId, createdAt desc) (missions d'un livreur) ;
- (customerId, createdAt desc) ;
- (driverId, status, createdAt desc) ;
- (cityId, status, createdAt desc) ;
- (cityId, createdAt desc) ;
- (status, createdAt desc) ;
- (searchKeywords contains, createdAt desc).

Index sur `events` : (visibleToCustomer, at).

---

## 8. Argent (`models/finance.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `payments/{id}` | `purpose` (order, subscription, sponsored_placement), payeur, `method`, `amountCents`, `status`, identifiants Stripe, `cardFingerprint?`, `cardLabel?`, `feeCents`, échec, `attempts`, `refundedCents` | C (les siens) ; R `finance.view` (abonnements) ; A `payments.view` | CF | `stripeWebhook`, `retryFailedPayments` |
| `refunds/{id}` | `orderId`, `amountCents`, `method` (original_payment, wallet_credit), **`cause`** (restaurant_error, missing_item, delivery_late, commercial_gesture…), **`allocation`** (part restaurant, livreur, plateforme), `items?`, `status` (requested, pending_approval, approved, processed, rejected, failed), `automatic`, demandeur, validateur, `creditNoteId?` | C ; R `finance.view` ; A `refunds.create` / `finance.view` | CF | `issueRefund` (plafond de l'agent, sinon `pending_approval`), `approveRefund` (A `refunds.approve`), `onRefundProcessed` (avoir, grand livre, imputation) |
| `ledgerEntries/{id}` | Grand livre non modifiable : `accountType` (restaurant, driver, driver_cash, platform, customer_wallet), `accountId`, `type` (order_revenue, commission, promo_funded, courier_earning, courier_tip, refund_charge, subscription_fee, cash_collected, manual_adjustment, payout…), `amountCents` (signé), `vatCents?`, références, `bookingDate` | R `finance.view` (compte restaurant) ; L (ses comptes) ; C (porte-monnaie) ; A `finance.view` | CF | Tous les mouvements ; `adjustBalance` (A `finance.adjust`, motif obligatoire) |
| `payouts/{id}` | Reversement : `beneficiaryType` (restaurant, driver), période, brut, commission, remboursements imputés, ajustements, pourboires, espèces déduites, `netCents`, `status` (scheduled, processing, paid, failed, on_hold, cancelled), `providerTransferId?`, `statementInvoiceId?` | R `finance.view` ; L ; A `finance.view` | CF | `buildPayouts` (calendrier `settings/payouts`), `executePayouts` (Stripe Connect), `onPayoutFailed` → alerte, `generateStatement` (relevé détaillé d'un reversement restaurant : grand livre, identités légales, mis en page PDF par le back-office) |
| `payoutHolds/{id}` | Blocage : `reason` (fraud, dispute, missing_document, unpaid_subscription), `active`, levée | A `finance.view` | CF | `holdPayouts`, `releasePayoutHold` (A `finance.hold`) |
| `invoices/{id}` | `number` continu par série, `kind` (customer_receipt, commission_invoice, subscription_invoice, driver_statement, credit_note, sponsored_invoice), `status`, `issuer`, `recipient`, `selfBilling` (autofacturation livreurs), `lines[]`, `vatSummary[]`, totaux HT, TVA, TTC, période, références, `creditedInvoiceId?`, `creditNoteIds[]`, `pdf?`, `legalMentions[]`, `retainUntil` | Destinataire (R `invoices.view`, C, L) ; émetteur livreur ; A `invoices.view` | CF ; jamais modifiée ni supprimée, annulation par avoir | `issueReceipt` (livraison), `buildMonthlyInvoices` (commission, abonnement, frais), `buildDriverStatements`, `issueCreditNote`, `renderInvoicePdf` |
| `taxReports/{id}` | `type` (dac7, vat, accounting_export), `countryId`, `period`, `status`, totaux, `file?`, référence de dépôt | A `tax.reports` | CF | `buildDac7Report` (annuel, avant le 31 janvier), `buildVatReport`, `buildAccountingExport` (mensuel) |
| `plans/{code}` | `Plan` : basic, pro, premium ; prix HT mensuel et annuel, essai, commissions, bonus de classement, rayon, établissements inclus, `features[]`, `limits`, `stripePriceId?` | Public | A `plans.edit` | `syncStripePrices` |
| `subscriptions/{id}` | `subscriberType` (restaurant, group), `planCode`, `status` (trialing, active, past_due, restricted, suspended, cancelled), cycle, prix, essai, période, résiliation (motif), `specialOffer?`, `dunning` (relances), `history[]` | R `finance.view` ; A `subscriptions.manage` / `finance.view` | CF | `changePlan`, `cancelSubscription`, `stripeWebhook`, `runDunning` (relances puis restriction puis suspension) → alerte `subscription_unpaid` |
| `commissionRules/{id}` | Barème versionné : `scope` (country, city, plan, group, restaurant), `scopeId`, 3 taux, `validFrom`, `validTo?`, `reason`, `supersedesId?` | A `commissions.edit` / `finance.view` / `restaurants.commercial` | A `commissions.edit` (création seulement) | `onCommissionRuleCreate` (clôt la règle précédente, audit) |

Index :

- `ledgerEntries` : (accountType, accountId, createdAt desc), (orderId, createdAt), (accountType, accountId, payoutId, createdAt).
- `payouts` : (beneficiaryType, beneficiaryId, scheduledFor desc), (status, scheduledFor).
- `invoices` : (recipient.type, recipient.id, issuedAt desc), (kind, issuedAt desc).
- `refunds` : (restaurantId | customerId | status, requestedAt desc).
- `payments` : (status, createdAt desc).
- `subscriptions` : (status, currentPeriodEnd).
- `commissionRules` : (scope, scopeId, validFrom desc).

---

## 9. Croissance et communication (`models/marketing.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `promotions/{id}` | `scope` (platform, country, city, restaurant), `restaurantId?`, `cityIds[]`, `restaurantIds[]`, `title`, `code?`, `kind` (percentage, fixed, free_delivery), `value`, `maxDiscountCents?`, `minSubtotalCents`, **`funding`** (platform, restaurant, shared), `restaurantShareBps?`, `target` (everyone, new_customers, inactive_customers, loyal_customers), `inactiveDays?`, `modes[]`, limites totale et par client, période, `status` (draft, pending_review, active, paused, rejected, ended), `showcase`, `stats` | Public si vitrine et active ; R `marketing.manage` (les siennes) ; A `promotions.view` | R `marketing.manage` : portée restaurant financée par le restaurant, brouillon ou en validation. A `promotions.edit` | `validatePromoCode` (au panier), `reviewPromotion` (plafonds `settings/promotions`), `setPromotionStatus`, `expirePromotions` |
| `promotionRedemptions/{id}` | `promotionId`, `userId`, `orderId`, remise, part plateforme, part restaurant, `status` | C ; R `marketing.manage` ; A | CF | Limite par client, coût des promotions |
| `campaigns/{id}` | `scope` (platform, restaurant), `channel` (push, email, sms, in_app), contenu, `audience` (type, pays, villes, formules, restaurants, segment, **`marketing`** = consentement exigé), `status`, `scheduledAt?`, `stats` | R `marketing.manage` ; A `notifications.send` | Auteur : brouillon ou programmée, annulation | `sendCampaign` (planifié : FCM, Brevo, SMS) |
| `messageTemplates/{key}` | Messages automatiques : `event`, `audience`, `channels[]`, `subject?`, `title?`, `body`, `emailHtml?`, `variables[]`, `brevoTemplateId?` | A `templates.edit` / `notifications.send` | A `templates.edit` (texte) | `notify` (tous les envois transactionnels) |
| `notificationLogs/{id}` | Trace de chaque envoi : `channel`, destinataire, `destinationMasked`, `status`, `provider`, `providerMessageId?` | A `support.view` / `notifications.send` | CF | Webhooks Brevo (délivré, ouvert, rejeté) |
| `announcements/{id}` | Annonce back-office restaurant ou app livreur : ciblage pays, villes, formules ; `severity`, période, `requiresAcknowledgement` | Connectés (restaurants) ; livreurs ; A | A `announcements.edit` | — |
| `prospects/{id}` | Mini CRM : restaurant démarché, contact, `source`, `stage` (to_contact, contacted, demo, negotiation, signed_up, lost), `ownerId` (commercial), `nextFollowUpAt?`, `lostReason?`, `restaurantId?` | A `crm.view` | A `crm.edit` | `onRestaurantApproved` → `signed_up` + `salesCommissions` ; relances |
| `prospects/{id}/activities/{aid}` | Appel, e-mail, visite, démo, note, changement d'étape | A `crm.view` | A `crm.edit` | — |
| `salesCommissions/{id}` | Commission d'un commercial : `basis` (prime d'inscription ou part du CA), `amountCents`, `status` | Le commercial ; A `crm.manage_team` / `finance.view` | CF | — |

Index :

- `promotions` : (scope, restaurantId, createdAt desc), (showcase, status, startsAt desc), (code, status).
- `promotionRedemptions` : (promotionId, userId).
- `campaigns` : (scope, restaurantId, createdAt desc).
- `prospects` : (ownerId, stage, nextFollowUpAt), (cityId, stage, updatedAt desc).

---

## 10. Support, messagerie, avis (`models/support.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `supportTickets/{id}` | `number` (T-xxxxxx), `requesterType` (client, restaurant, driver), `requesterId`, `restaurantId?`, `driverId?`, `orderId?`, `countryId`, `cityId?`, `reasonId`, `subject`, `status` (open, in_progress, waiting_customer, resolved, closed), `priority`, `channel`, `assigneeId?`, escalade, SLA (`firstResponseDueAt`, `resolutionDueAt`), `refundIds[]`, `compensationCents`, `satisfaction?`, compteurs non lus | Demandeur (ou R `support.use`) ; A `support.view` | Demandeur : satisfaction, compteur. A `support.handle` : statut, priorité, attribution (escalade : `support.escalate`). Ouverture : CF | `openTicket`, `assignTickets`, `escalateOverdueTickets` (SLA), `onTicketMessage` |
| `supportTickets/{id}/messages/{mid}` | `authorType` (requester, agent, system), `body`, **`internal`** (note entre agents), `attachments[]`, `action?` (remboursement, avoir, changement de statut) | Demandeur (messages non internes) ; A | Demandeur (si le ticket n'est pas fermé) ; A `support.handle` | — |
| `ticketReasons/{id}` | Motif : `label`, `audience[]`, `defaultPriority`, `requiresOrder`, `order`, `active` | Connectés | A `support.configure` | — |
| `cannedResponses/{id}` | Réponse type : `title`, `body`, `reasonIds[]`, `shortcut?` | A `support.view` | A `support.configure` | — |
| `conversations/{id}` | `type` (restaurant_client, restaurant_driver, client_driver, support_chat), `restaurantId?`, `orderId?`, `ticketId?`, `participantIds[]`, `participants`, `lastMessage`, `unread{uid}`, `closed` | Participants ; R `messages.use` ; A `support.view` | Participant : remettre à zéro son compteur. Création : CF | `openConversation`, `onConversationMessage` (notifications, compteurs), `closeOrderConversations` |
| `conversations/{id}/messages/{mid}` | `senderId`, `senderRole`, `text` (≤ 2 000), `attachments[]`, `readBy[]` | Participants ; R `messages.use` ; A | Participants (conversation ouverte) ; marquer lu | — |
| `reviews/{orderId}` | Un avis par commande livrée : `restaurantRating` (1-5), `driverRating?`, `comment?`, `tags[]`, **`status`** (published, pending_moderation, hidden, removed), `autoModeration?`, `moderation?`, `reply?` (réponse du restaurant, modérable), `reportsCount` | Public si publié ; auteur ; R `reviews.reply` ; A `reviews.view` | C : création (commande livrée, statut en modération). R `reviews.reply` : réponse. A `reviews.moderate` : masquage motivé | `onReviewCreate` (filtre d'insultes, publication, notes moyennes), `detectRatingDrops` |
| `contentReports/{id}` | Signalement de contenu illicite (DSA) : cible, `reason`, `status`, `decision?` | A `reviews.moderate` | Connectés : création ; A : décision | `onContentReport` → alerte `review_reported` |

Index :

- `supportTickets` : (requesterId | restaurantId, lastMessageAt desc), (status, priority, lastMessageAt desc), (assigneeId, status, lastMessageAt desc).
- `conversations` : (participantIds contains, lastMessageAt desc), (restaurantId, type, lastMessageAt desc).
- `reviews` : (restaurantId, customerId, createdAt desc), (restaurantId, status, createdAt desc), (driverId, createdAt desc), (status, restaurantRating, createdAt desc).

---

## 11. Administration, sécurité, audit (`models/admin.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `admins/{uid}` | `role`, **`permissions[]`**, `active`, `countryIds[]`, **`cityIds[]`** (périmètre du responsable de ville), `refundLimitCents?`, `mfaEnrolled`, dernière connexion | Soi ; A `admins.view` | CF | `inviteAdmin`, `updateAdmin` (claims, permissions), `deactivateAdmin`, `enforceAdminMfa` (fonction bloquante à la connexion) |
| `adminRoles/{role}` | `label`, `permissions[]`, `defaultRefundLimitCents`, **`maskPersonalData`** | Administrateurs | A `admins.manage` (sauf super_admin) | `onAdminRoleWrite` → propagation aux `admins` |
| `adminSessions/{id}` | Appareil, `userAgent`, `ipHash`, localisation approximative, `lastSeenAt`, `revokedAt?` | Soi ; A `security.manage` | CF | `trackAdminSession`, `revokeSessions` (déconnexion à distance ou globale : révocation des jetons Auth) |
| `auditLogs/{id}` | `actor` (uid, type, rôle, nom), `action`, `target: EntityRef`, `countryId?`, `cityId?`, **`reason?`**, `before?`, `after?`, `impersonationSessionId?`, `sensitive`, `at` | A `audit.view` | **CF uniquement, jamais modifié** | Chaque fonction sensible + triggers sur les écritures directes des admins |
| `securityAlerts/{id}` | `type` (unusual_login, mass_export, refund_spike, failed_logins, permission_change, mfa_disabled), `severity`, `status` | A `security.manage` | A : prise en charge | `detectSecurityAnomalies` |
| `platformAlerts/{id}` | Alertes par exception et file « à traiter » : `kind`, `queue` (alert, todo), `severity`, `target`, `cityId?`, `metric?`, `status`, `dedupKey` | A `dashboard.view` (dans sa ville) | A : acquitter, résoudre, écarter | `monitorPlatform` (planifié) et triggers métier |
| `internalNotes/{id}` | Note interne sur une entité : `target`, `body`, `pinned`, auteur | Administrateurs | Auteur | — |
| `savedFilters/{id}` | Filtre enregistré (« restaurants Pro à Metz ») : `entity`, `filters`, `shared` | Propriétaire ou partagé | Propriétaire | — |
| `impersonationSessions/{id}` | « Voir comme le restaurant » : `mode` (read_only par défaut), `reason`, période, `actionsCount` | Soi ; A `audit.view` | CF | `startImpersonation`, `endImpersonation` (jeton personnalisé limité) |
| `bulkJobs/{id}` | Import, action groupée, export : `type`, `params`, `input?`, `format?`, `status`, progression, `errors[]`, `output?` | Auteur ; A `audit.view` | Auteur : annulation. Création : CF (permission contrôlée selon le type) | `runBulkJob`, `exportData` → alerte `mass_export` |
| `scheduledReports/{id}` | Rapport automatique : `report`, `frequency` (daily, weekly, monthly), `recipients[]`, `format` | A `reports.view` | A `reports.schedule` | `sendScheduledReports` (Brevo) |

Index :

- `auditLogs` : (target.type, target.id, at desc), (actor.uid, at desc).
- `platformAlerts` : (queue, status, detectedAt desc), (cityId, status, detectedAt desc).
- `internalNotes` : (target.type, target.id, createdAt desc).

### Pilotage du super admin (cahier §1 à §4, `functions/src/admin/pilotage`)

Noms effectivement déployés (remplacent `monitorPlatform` et `sendScheduledReports` cités plus haut) :

| Fonction | Type | Rôle |
|---|---|---|
| `onOrderWrittenPlatformStats` | trigger `orders/{id}` | Met en file `statsQueue/{cityId_AAAAMMJJ}` le recalcul de la ville et du jour (idempotent). |
| `aggregatePlatformStats` | planifiée (chaque minute) | Recalcule `statsDaily` des villes en file, puis pays et plateforme par somme. |
| `refreshPlatformStats` | planifiée (nuit) | Consolide la veille : nouveaux commerces et livreurs, support, abonnements encaissés. |
| `detectAnomalies` | planifiée (15 min) | Alertes par exception et file « à traiter » (`platformAlerts`, dédoublonnage par `dedupKey`, résolution automatique), relevé des livreurs en ligne. |
| `runMonitoringNow`, `handlePlatformAlert`, `updateMonitoringSettings` | callables | Relance immédiate ; prise en charge / résolution / mise à l'écart (motif) auditées ; seuils `settings/monitoring` historisés. |
| `getPilotageOverview`, `getPilotageAnalytics` | callables | Compteurs d'acteurs, activité récente, indicateurs par formule ; analytics par section, dans le périmètre de l'administrateur. |
| `globalSearch` | callable | Recherche universelle groupée par type, droits et villes vérifiés, coordonnées masquées sans `personal_data.view`. |
| `exportData` | callable | Export CSV / Excel / PDF filtré, trace `bulkJobs` (type `export`) + audit + alerte de sécurité si massif. |
| `saveScheduledReport`, `deleteScheduledReport`, `runReportNow`, `runScheduledReports` | callables / planifiée (horaire) | Rapports programmés envoyés par Brevo avec pièce jointe ; aperçu sans envoi (`dryRun`). |

Collections et documents : `statsQueue/{cityId_AAAAMMJJ}` (fonctions uniquement), `settings/monitoring` (`MonitoringSettings`, seuils des alertes, lecture `settings.view`, écriture par `updateMonitoringSettings`).
Index ajoutés : `statsDaily` (scope, cityId, day) pour les responsables de ville ; `platformAlerts` (queue, cityId, detectedAt desc) et (queue, countryId, detectedAt desc) pour les filtres géographiques.

---

## 12. Fraude, conformité, données (`models/compliance.ts`)

| Chemin | Contenu | Lecture | Écriture | Cloud Functions |
|---|---|---|---|---|
| `fraudCases/{id}` | `subjectType` (client, driver, restaurant), `signals[]` (repeated_claims, frequent_not_received, linked_accounts, promo_abuse, off_address_delivery, abnormal_cancellations, shared_account, fake_orders, refund_rate, chargeback), `riskScore`, `status`, `decision?`, `linkedEntities[]` | A `fraud.view` | A `fraud.manage` : statut, attribution. Décision : CF | `scoreFraudSignals` (triggers commandes, remboursements, inscriptions), `decideFraudCase` (blocage, suspension, gel des reversements) |
| `blocklist/{id}` | `type` (phone, email, device, card_fingerprint, iban, ip), `valueHash`, `valuePreview` masqué, `reason`, `expiresAt?`, `active` | A `fraud.view` | A `fraud.manage` | Vérifié à l'inscription, à la commande et au paiement |
| `legalDocuments/{id}` | `type` (terms_client, terms_sale, terms_restaurant, terms_driver, privacy_policy, cookie_policy, legal_notice), `countryId`, `version`, `content`, `status` (draft, published, archived), `requiresReacceptance` | Public si publié ; A `legal.edit` | A `legal.edit` (une version publiée ne peut plus qu'être archivée) | `onLegalPublished` → réacceptation exigée |
| `legalAcceptances/{id}` | Preuve : `userId`, `userType`, `restaurantId?`, `documentId`, `version`, `acceptedAt`, `ipHash?`, `signatureName?` (contrat partenaire) | Soi ; A | Soi (création, version publiée) ; jamais modifiée | — |
| `gdprRequests/{id}` | `type` (access, portability, rectification, erasure, objection), sujet, `status`, `receivedAt`, **`dueAt`** (1 mois), `export?`, `retainedData[]` | Soi ; A `gdpr.handle` | A `gdpr.handle` : suivi. Dépôt : CF | `submitGdprRequest`, `exportUserData`, `anonymizeUser` (conserve factures et comptabilité), `applyRetention` (planifié : durées `settings/retention`) → alerte `gdpr_request` |
| `trash/{id}` | Corbeille : `entity`, `path`, `snapshot`, `children[]`, `restaurantId?`, `deletedBy`, `deletedAt`, **`purgeAt`**, `restoredAt?` | A `trash.view` ; R `menu.edit` (son restaurant) | CF | `moveToTrash`, `restoreFromTrash` (A `trash.restore`, ou le restaurant pour ses éléments), `purgeTrash` (planifié) |
| `backups/{id}` | Export géré Firestore : `kind`, `status`, `bucketPath`, `collections`, taille | A `backups.manage` | CF | `scheduledBackup` (quotidien vers un bucket dédié), `requestBackup` |
| `statsDaily/{scope_scopeId_AAAAMMJJ}` | `scope` (platform, country, city, zone), `scopeId`, `cityId?`, `day`, `orders`, `revenue` (volume d'affaires, ventes restaurants, commissions, frais, abonnements, coût des promotions, remboursements, livreurs, frais de paiement, marge, panier moyen), `delivery`, `actors`, **`funnel`** (ouvertures, vues, ajouts au panier, paiements), `support` | A `dashboard.view` (villes et zones : dans son périmètre) | CF | `aggregatePlatformStats` (horaire et quotidien). Tunnel : événements Firebase Analytics agrégés |

Index :

- `fraudCases` : (status, riskScore desc).
- `gdprRequests` : (status, dueAt).
- `statsDaily` : (scope, scopeId, day).
- `trash` : (restaurantId, deletedAt desc).

Champs exclus de l'indexation (`fieldOverrides`) : `auditLogs.before/after`, `trash.snapshot/children`, `settingsHistory.before/after`.

---

## 13. Correspondance avec le cahier du super admin (31 rubriques)

| # | Rubrique | Collections |
|---|---|---|
| 1 | Tableau de bord | `statsDaily`, `platformAlerts` (alertes et file « à traiter »), `auditLogs` (activité récente) |
| 2 | Recherche globale | `searchKeywords` sur `orders`, `restaurants`, `drivers`, `users` ; `invoices.number`, `supportTickets.number` ; SIRET dans `restaurants/*/private/legal` (via CF) |
| 3 | Analytics | `statsDaily`, `restaurants/*/dailyStats`, `drivers.stats`, `subscriptions`, `statsDaily.funnel` |
| 4 | Rapports et exports | `bulkJobs` (export), `scheduledReports` |
| 5 | Restaurants | `restaurants`, `restaurants/*/private`, `partnerDocuments`, `legalAcceptances`, `restaurantGroups`, `menuIssues`, `internalNotes`, `savedFilters`, `bulkJobs`, `impersonationSessions`, `auditLogs` |
| 6 | Livreurs | `drivers`, `driverPrivate`, `partnerDocuments`, `identityChecks`, `driverSanctions`, `driverEarnings`, `driverSessions`, `zones.live`, `settings/dispatch`, `dispatchOffers` |
| 7 | Clients | `users`, `userPrivate`, `users/*/paymentMethods` (masqués), `walletTransactions`, `refunds`, `loyaltyAccounts`, `promotionRedemptions`, `supportTickets` |
| 8 | Commandes | `orders`, `orders/*/events`, `orderFinancials` |
| 9 | Règles automatiques | `settings/orderRules`, surcharges `countries` et `cities` |
| 10 | Zones et villes | `cities`, `zones`, `surgeRules` |
| 11 | Affichage app client | `cuisineCategories`, `homeSections`, `banners`, `sponsoredPlacements`, `settings/display`, `pages` |
| 12 | Avis | `reviews`, `contentReports` |
| 13 | Support | `supportTickets` (+ messages), `ticketReasons`, `cannedResponses`, `helpArticles`, `conversations` (chat en direct), `settings/support` |
| 14 | Paiements | `settings/payments`, `payments`, `restaurants/*/private/commercial.allowedPaymentMethods`, `driverPrivate.cashBalanceCents` |
| 15 | Finance et reversements | `ledgerEntries`, `payouts`, `payoutHolds`, `orderFinancials`, `promotionRedemptions` (coût des promotions) |
| 16 | Facturation et TVA | `invoices`, `taxReports` (DAC7, TVA, export comptable), `countries.pricing.vat` |
| 17 | Abonnements et commissions | `plans`, `subscriptions`, `commissionRules`, `restaurants/*/private/commercial` |
| 18 | Promotions | `promotions`, `promotionRedemptions`, `settings/promotions` |
| 19 | Fidélité et parrainage | `settings/loyalty`, `settings/referral`, `loyaltyAccounts`, `loyaltyTransactions`, `referrals` |
| 20 | Notifications | `campaigns`, `announcements`, `messageTemplates`, `notificationLogs`, `users.consents` |
| 21 | Mini CRM | `prospects` (+ activities), `salesCommissions` |
| 22 | Paramètres plateforme | `settings/*`, `settingsHistory` |
| 23 | Multi-pays | `countries` |
| 24 | Fonctionnalités | `featureFlags` |
| 25 | Logiciels externes | `integrations`, `posConnections` |
| 26 | Administrateurs internes | `admins`, `adminRoles` |
| 27 | Sécurité et audit | `adminSessions`, `auditLogs`, `securityAlerts`, `settings/security` |
| 28 | Fraude | `fraudCases`, `blocklist`, `userPrivate` |
| 29 | Légal et RGPD | `legalDocuments`, `legalAcceptances`, `users/*/consents`, `gdprRequests`, `settings/retention`, `contentReports` |
| 30 | Santé et maintenance | `serviceStatus`, `incidents`, `settings/maintenance`, `appVersions` |
| 31 | Données et sauvegardes | `backups`, `trash`, `bulkJobs` (export complet), `auditLogs` |

Rubriques du back-office restaurant de la maquette :

| Rubrique | Collections |
|---|---|
| Commandes | `orders` |
| Clients | `restaurants/*/customers` |
| Livreurs | `restaurants/*/couriers` |
| Staff / Équipe | `members`, `staffRoles`, `employees` et gestion d'entreprise (§5) |
| Finances, états du CA, virements, factures | `dailyStats`, `ledgerEntries`, `payouts`, `invoices` |
| Ventes et stocks | `products.stock`, `stockMovements` |
| Produits et menu, options et listes, produits populaires | `sections`, `products`, `options`, `optionGroups` (`salesCount`, `featured`) |
| Notifications push | `campaigns` |
| Codes promo | `promotions` (portée restaurant) |
| Fidélité | `settings/loyalty` |
| Modèles, réseaux sociaux | Contenus du restaurant dans `settings` (à préciser à l'implémentation de l'écran) |
| Messages clients et livreurs | `conversations` |
| Support plateforme | `supportTickets` |
| Paramètres, commandes, horaires, modes de paiement, zones | `settings/*`, `deliveryZones` |

---

## 14. Stockage (Cloud Storage)

Règles : `firebase/rules/storage/`, assemblées dans `firebase/storage.rules`. Chemins : `STORAGE_PATHS`.

| Chemin | Accès |
|---|---|
| `restaurants/{rid}/public/**` | Lecture publique. Écriture : R `menu.edit` / `settings.manage`, A `restaurants.edit`. Images ≤ 5 Mo |
| `restaurants/{rid}/private/**` | Justificatifs. Lecture : R `settings.manage`, A `restaurants.validate`. Dépôt seulement (≤ 10 Mo), jamais remplacés |
| `restaurants/{rid}/team/**` | Documents d'équipe, HACCP, pièces d'absence (≤ 15 Mo) |
| `drivers/{uid}/public/**` | Avatar du livreur, lecture publique |
| `drivers/{uid}/private/**` | Justificatifs et selfies : le livreur et A `drivers.validate` |
| `users/{uid}/avatar/*` | Lecture publique, écriture par soi (≤ 2 Mo) |
| `support/{ticketId}/*` | Demandeur du ticket et A support |
| `conversations/{id}/*` | Participants (images ≤ 5 Mo) |
| `platform/public/**` | Visuels de la plateforme, A `display.edit` |
| `invoices/**`, `exports/**` | Aucun accès direct : URL signée délivrée par Cloud Function |

---

## 15. Hypothèses et décisions

1. **Livraison** : la flotte Ciyou Eats est le cas nominal. Les livreurs propres d'un restaurant (`drivers.type = restaurant`) sont gérés dans le même modèle, avec une commission réduite, derrière le drapeau `restaurant_own_drivers`. Le retrait et le sur place existent dans le modèle, activables par drapeau.
2. **Un restaurant = un point de vente.** Le multi-établissement passe par `restaurantGroups`.
3. **Un seul modèle d'options**, normalisé (`options` + `optionGroups`). Le modèle « groupe à choix intégrés » de la maquette est abandonné.
4. **Stock** : `null` signifie non suivi.
5. **Frais de livraison par zone et par distance**, et non plus un forfait par restaurant comme dans la maquette.
6. **Membres restaurant** : droits lus dans Firestore par les règles (un `get` par requête), plutôt que dans les custom claims. Raison : un groupe peut compter des dizaines d'établissements, et les claims sont limités à 1 000 octets.
7. **Permissions admin** : modifiables dans `adminRoles`, résolues dans `admins/{uid}` par Cloud Function, lues par les règles. Les matrices de `permissions/*.ts` servent d'amorçage.
8. **Numéro de sécurité sociale et IBAN complets** : jamais stockés en clair dans Firestore (4 derniers chiffres ou valeur masquée). Les IBAN sont gérés par Stripe Connect.
9. **Le tunnel de commande** (ouvertures d'app, ajouts au panier) vient de Firebase Analytics, agrégé dans `statsDaily.funnel`. Pas d'événements bruts dans Firestore.
10. **TVA, DAC7, autofacturation des livreurs, conservation des données** : paramétrés selon le droit connu, **à valider par un expert-comptable ou un juriste** avant le lancement.

### 15.1 Champs ajoutés pour les décisions du client (26/09/2026)

Tous optionnels (compatibilité des documents existants). Détail des règles : `docs/DECISIONS_CLIENT.md` et `docs/MODELE_ECONOMIQUE.md` section 0.

| Document | Champs ajoutés |
|---|---|
| `settings/general` | `currency` élargi à `CurrencyCode` ; `supportedLocales` (fr, en, ar) |
| `settings/orderRules` | `acceptanceTimeoutAction` (`cancel_and_refund`), `autoPause { enabled, missedOrdersInARow: 3 }`, `merchantInactivity { enabled, alertAfterDays: 15, removeAfterAlertDays: 30 }`, `customerAbsent.payRestaurant`, `customerAbsent.callViaApp`, `alcohol.locked` (`alcohol.enabled = false`) ; `refundLiability` : toutes les causes au commerce |
| `settings/payments` | `cash.merchantDriversOnly` (espèces seulement avec un livreur salarié du commerce) ; `methods.meal_voucher = false` |
| `settings/referral` | `restaurant.rewardType` (`ad_credit`), récompense 100 € de crédit publicitaire ; programmes client et livreur éteints |
| `settings/promotions` | `capsEnabled` (false : promotions des commerces sans limite) |
| `countries/{id}` | `currency` (EUR, DZD, MAD, TND), `vatValidated`, `vatNote`, `stripeAvailable` ; `pricing` : `commission.billingMode`, `courier.model` (`flat_then_per_km`), `courier.flatDistanceThresholdMeters`, `courier.flatAmountCents`, `courier.perKmMode`, `courier.peakBonusCents`, `courier.hourlyGuaranteeEnabled`, `promotions.capEnabled`, `merchantDelivery` (bornes plateforme : `minFeeCents`, `maxFeeCents`, `minOrderFloorCents`, `minOrderCeilingCents`, `maxRadiusMeters`). Montants en unités mineures de la devise (millimes pour TND) |
| `cities/{id}` | `pricing.courier` : surcharge du barème livreur par ville (forfait, seuil, prix au km, bonus de pointe) |
| `featureFlags/{key}` | `locked` (`alcohol_sales` : éteint et verrouillé) |
| `plans/{code}` | `billingMode` (commission, subscription, hybrid), `commitmentMonths`, `cardRequired`, `gracePeriodDays` ; formules par défaut à 0, sans fonctionnalités |
| `restaurants/{rid}` | `merchantType` (restaurant, grocery, bakery, florist, pharmacy, other), `missedOrdersInARow`, `lastOrderAt`, `inactivityAlertAt` ; `sellsAlcohol` toujours false |
| `restaurants/{rid}/private/commercial` | `billingMode` (surcharge de la formule), `adCreditCents` (crédit publicitaire du parrainage) |
| `restaurants/{rid}/products/{id}` | `saleUnit` (unit, weight, variable), `pricePerKgCents`, `weightStepGrams`, `minWeightGrams`, `maxWeightGrams`, `variablePriceMaxCents`, `vatRateBpsOverride` ; `vatCategory = alcohol` et `containsAlcohol = true` refusés (`checkProductAlcohol`) |
| `orders/{id}` | `items[].saleUnit`, `items[].pricePerKgCents`, `items[].weightGrams`, `items[].actualWeightGrams`, `items[].finalTotalCents`, `amounts.currency` élargi, `closedAs` (`customer_absent`) ; `restaurantSettlement.tipCents` |
| `drivers/{uid}` | `employeeId` (livreur salarié du commerce : fiche employé), `maxDistanceMeters` (distance choisie par le livreur) |
| `driverEarnings/{id}` | `breakdown.model`, `breakdown.flatCents`, `breakdown.peakBonusCents` |

### 15.2 Automatismes décidés par le client (cdc-fix-b, 26/09/2026)

Détail des appels attendus des apps mobiles : `docs/CONTRATS_APPS_MOBILES.md`.

| Document | Champs ou fonctions ajoutés |
|---|---|
| `settings/merchantValidation` | Validation automatique des commerces : `mode` (`off`, `suggest`, `auto`), `requireContract`, `checkRegistrationNumber`, `minDocumentValidityDays`, `registrationDocumentMaxAgeDays`, `requireActiveCity`, `goLive`, `countryIds`, `maxPerDay`. Écrit par `updateMerchantValidation` (équipe centrale, motif, historique, audit). |
| `settings/notificationDelivery` | Envoi réel ou simulation des messages automatiques : `emailLive`, `smsLive`, `pushLive` (tous faux par défaut). Écrit par `updateNotificationDelivery`. |
| `settings/orderRules` | `customerAbsent.autoCloseGraceMinutes`, `lateToleranceMinutes`, `claims { photoRequired, minPhotos, maxPhotos, checkPhotoDate, checkDuplicates, repeatThreshold30d, autoAcceptMaxCents }`. |
| `messageTemplates/{clé}` | Gabarits lus par le serveur (`order_confirmed`, `order_picked_up`, `late_credit_issued`, `restaurant_auto_approved`, `zone_emergency_closure`…) ; liste et textes par défaut dans `PLATFORM_MESSAGE_DEFAULTS`. |
| `orders/{id}` | `customerAbsence { arrivedAt, waitUntil, waitMinutes, calls, lastCallAt, closedAt, closedBy, payDriver, payRestaurant }`, `itemProposals[lineId]`, `proposalDeadline`, `processed.lateCreditDone`, `items[].adjustment` (retrait ou remplacement, `finalTotalCents`). |
| `orderClaims/{id}` | Réclamation : `type`, `lineIds`, `photos[] { path, sha256, width, height, takenAt }`, `photoHashes[]`, `checks[]`, `verdict`, `status`, `claimedCents`, `grantedCents`, `refundId`, `ticketId`. Lecture par le client et le support ; écriture par `submitOrderClaim` et `decideOrderClaim`. Photos dans Storage `claims/{uid}/…`. |
| `supportTickets/{id}` | `claimId` (réclamation à l'origine du ticket). |
| `restaurants/{rid}` | `autoValidation { at, mode, eligible, decided, checks[] }`, `autoValidatedDay`, `inactivityAlertAt`, `inactivityRemovalDueAt`, `removedForInactivityAt`, `sponsoredLabel`, `rankingComputedAt` ; `rankingScore` est désormais calculé (score de base 0 à 1, hors distance). |
| `refunds/{id}` | Remboursements automatiques d'articles retirés (`rf-{commande}-item-{ligne}`), de réclamations (`rf-{commande}-claim-{id}`) et de client absent (`rf-{commande}-absent`) ; champ `lineIds`. |
| `walletTransactions/lc-{commande}` | Avoir de retard automatique (`reason: 'late_delivery'`), imputé selon `refundLiability` (écritures `lc-{commande}-w/-r/-l/-p` dans `ledgerEntries`). |
| `rateLimits/{clé}` | Compteurs anti-abus de l'inscription publique d'un commerce (5 par heure et par adresse IP, écrits par le serveur). |

### 15.3 Argent, promotions, parrainage, espèces (cdc-fix-c, 27/09/2026)

| Document | Champs ou fonctions ajoutés |
|---|---|
| `orders/{id}` | `commission { bps, source (negotiated, group, city, plan, market, subscription), billingMode }` ; `amounts.walletAppliedCents` / `amounts.chargedCents` (avoirs utilisés, montant débité sur le moyen de paiement) ; `amounts.currency` = devise du pays ; `payment.method = 'wallet'` quand le portefeuille couvre tout. |
| `plans/{code}` | `commissionInherit` (la formule laisse le barème du pays s'appliquer). |
| `commissionRules/{id}` | Portée `group` appliquée **à la commande** (plus seulement aux membres présents à la création). |
| `promotionRedemptions/{orderId}` | `status` `applied` → `reversed` à l'annulation (`reversedAt`, `reversedReason`) ; compteurs de l'offre décrémentés (`stats.redemptions`, `discountCents`, `ordersSubtotalCents`, `newCustomers`). |
| `settings/promotions` | `loyalOrdersThreshold` (client « fidèle »), `inactiveDaysDefault` (client « inactif »). |
| `walletTransactions/{wp-,wr-}{commande}` | Débit à la commande (`reason: 'order_payment'`) et retour des avoirs à l'annulation (`type: 'reversal'`) ; écritures `wallet_debit` / `wallet_credit` (compte `customer_wallet`). |
| `invoices/{id}` | `compensation { debitCents, status ('pending', 'done'), settledAt, method? }` : part de la facture mensuelle (abonnement, mises en avant) retenue sur les reversements ; `currency` = devise du pays. |
| `ledgerEntries/{facture}-abo`, `-pub`, `-vir` | Retenue d'abonnement (`subscription_fee`), de mises en avant (`sponsored_placement`) et écriture inverse d'un virement reçu (`manual_adjustment`). |
| `subscriptions/{id}` | `history[].event` : `past_due`, `trial_converted` ; `specialOffer.endsAt` (la remise d'abonnement s'éteint à la fin de l'offre). |
| `payouts/{id}` | `currency`, `provider` (`stripe`, `manual`), `manualReference`. |
| `paymentProviders/{id}` | Prestataire de paiement : `code`, `label`, `countryIds[]`, `currencies[]`, `supports { collect, payout }`, `kinds[]`, `mode` (`api`, `manual`), `enabled`. Lecture : compte connecté ; écriture : `savePaymentProvider` (`payments.configure`). |
| `countries/{id}` | `paymentProviderIds[]` (`setCountryProviders`). |
| `restaurants/{rid}/private/commercial` | `payoutAccount { provider, paymentProviderId, holderName, accountMasked, currency, verified }` (pays sans Stripe), `referralCode`, `referredByRestaurantId`, `adCreditCents` (budget publicitaire). |
| `driverPrivate/{uid}` | `payoutAccount` (pays sans Stripe), `stripeAccountId` / `stripeAccountStatus` (Connect Express du livreur indépendant), `cashBalanceCents` / `cashLimitCents` (caisse du livreur salarié). |
| `cashMovements/{id}` | Caisse d'un livreur salarié : `restaurantId`, `driverId`, `type` (`collected`, `remitted`, `adjustment`), `amountCents`, `balanceAfterCents`, `orderId?` ; `cash-{commande}` (encaissement, idempotent). Lecture : membres du commerce (`couriers.manage`, `finance.view`), finance. |
| `restaurants/{rid}/couriers/{driverId}` | `cashHeldCents`, `cashLimitCents` (reflet de la caisse, lu par le back-office du commerce). |
| `referralCodes/{code}` | Code de parrainage d'un commerce → `ownerId` (aucune lecture client ; `getRestaurantReferralLink` le crée). |
| `referrals/{id}` | `rest-{filleul}` (commerce → commerce) et `cli-{filleul}` (client) ; `referrerName`, `refereeName`, `rejectedAt`, `rejectedReason`, `fraudSignals[]`. Lecture : parrain commerce (`settings.manage`). |
| `loyaltyTransactions/{id}` | `earn-{commande}`, `welcome-{uid}`, `expire-…`, échanges ; `remaining` (points encore utilisables du lot) et `expiresAt` (consommation du plus ancien au plus récent). |
| `messageTemplates/{clé}` | Nouveaux messages émis par le module Argent : `invoice_available`, `restaurant_payout_paid` (relevé détaillé), `driver_payout_paid`, `subscription_payment_due`, `subscription_restricted`, `subscription_suspended`, `subscription_restored`, `cash_limit_reached`. |
| Fonctions | `renewSubscriptions` (nuit), `recordMerchantCashRemittance`, `savePaymentProvider`, `setCountryProviders`, `setRestaurantPayoutAccount`, `setDriverPayoutAccount`, `verifyPayoutAccount`, `markPayoutPaidManually`, `createDriverConnectAccount(+Link)`, `refreshDriverConnectAccountStatus`, `getRestaurantReferralLink`, `applyRestaurantReferralCode`, `applyReferralCode`, `redeemLoyaltyPoints`, `expireLoyalty` (nuit), `onRestaurantActivatedReferral`. |
