// Création d'une commande à partir du panier du client : tout est recalculé et
// contrôlé côté serveur (prix, options, stock, promotion, zone, horaires,
// minimum), puis la commande est numérotée et le paiement autorisé.
import {
  ACTIVE_ORDER_STATUSES,
  ALCOHOL_BLOCK_MESSAGES,
  COLLECTIONS,
  DEFAULT_PLANS,
  FEATURE_LABELS,
  FULFILLMENT_MODES,
  PAYMENT_METHODS,
  RESTAURANT_PRIVATE_DOCS,
  RESTAURANT_SETTINGS_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  buildSearchKeywords,
  checkProductAlcohol,
  computeProductOffersDiscount,
  effectiveMinOrderCents,
  computeQuote,
  computeSettlement,
  formatOrderNumber,
  formatPrice,
  generateFourDigitCode,
  haversineMeters,
  isCashAllowed,
  isPointInPolygon,
  maskPhone,
  publicDisplayName,
  productOfferStatus,
  type Counter,
  type FeatureKey,
  type MenuOption,
  type Order,
  type OrderFinancials,
  type LedgerEntry,
  type OrderItem,
  type OptionGroup,
  type Payment,
  type PaymentMethod,
  type PaymentSettings,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type Product,
  type ProductOffer,
  type Promotion,
  type PromotionInput,
  type PromotionRedemption,
  type QuoteIssueCode,
  type Restaurant,
  type RestaurantCommercial,
  type RestaurantCustomer,
  type RestaurantDeliveryZone,
  type RestaurantOrderSettings,
  type StockMovement,
  type UserAddress,
  type UserProfile,
  type MerchantZoneTerms,
  type WalletTransaction,
  type Zone,
} from '@golink/shared';
import { GeoPoint, type DocumentReference } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { ordersCallable as callable } from './runtime';
import { fail } from '../lib/errors';
import { loadFeatureFlags, resolveFeature, scopeOfRestaurant } from '../lib/features';
import { requireAuth } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { getStripe } from '../lib/stripe';
import { z, zId } from '../lib/validation';
import { addEvent, isOpenAt, loadMarket, loadOrderRules, localClock, orderRef, pricingFor, SYSTEM_EVENT_ACTOR } from './context';
import { loadGroupRule, loadPlan, resolveOrderCommission } from './commission';
import { loadPromotionByCode, loadPromotionRules, pickAutomaticPromotion } from './promotions';
import { authorizePayment, captureAuthorizedIntent, CardRefusedError, recordRefusedPayment, retrieveCardFingerprint, STRIPE_METHODS, type Authorization } from './payment';
import { hashValue, isBlocked } from '../platform/fraud';
import { assertMinimumVersion, assertNotInMaintenance } from '../lib/platform-status';
import { assertLegalReaccepted } from '../lib/legal';

/** Message de fermeture d'urgence dans la langue du client (repli : français). */
function closureText(closure: { message: { fr?: string; en?: string; ar?: string } }, locale: string | undefined): string | null {
  const text = (closure.message as Record<string, string | undefined>)[locale ?? 'fr'] ?? closure.message.fr;
  return text && text.trim() ? text : null;
}

const schema = z.object({
  restaurantId: zId,
  fulfillment: z.enum(FULFILLMENT_MODES),
  lines: z
    .array(
      z.object({
        productId: zId,
        quantity: z.number().int().min(1).max(50),
        options: z
          .array(z.object({ optionId: zId, groupId: zId, quantity: z.number().int().min(1).max(10).optional() }))
          .max(40)
          .optional(),
        comment: z.string().trim().max(200).nullish(),
        /** Vente au poids : poids réellement souhaité (grammes), requis pour un article `weight`. */
        weightGrams: z.number().positive().max(100_000).optional(),
      }),
    )
    .min(1, 'Votre panier est vide.')
    .max(40),
  addressId: zId.nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentMethodId: z.string().trim().max(120).nullish(),
  promoCode: z.string().trim().toUpperCase().max(24).nullish(),
  /** Régler tout ou partie de la commande avec le solde d'avoirs Ciyou Eats du client. */
  useWallet: z.boolean().optional(),
  tipCents: z.number().int().min(0).max(1_000_000).optional(),
  customerNote: z.string().trim().max(300).nullish(),
  scheduledFor: z.iso.datetime({ offset: true }).nullish(),
  ageConfirmed: z.boolean().optional(),
  source: z.enum(['client_ios', 'client_android', 'client_web']).optional(),
  clientRequestId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  /** Empreinte de l'appareil (posée par l'application, si disponible) : consultée sur la liste de blocage (§28). */
  deviceId: z.string().trim().min(4).max(200).nullish(),
  /** Version de l'application appelante (§30, mise à jour forcée). */
  appVersion: z.string().trim().regex(/^\d+\.\d+\.\d+$/).nullish(),
  /** Total du dernier devis affiché au client : revalidé à ±2 centimes avant le paiement (§A3). */
  expectedTotalCents: z.number().int().min(0).nullish(),
});

/** Tolérance de revalidation du total avant paiement (§A3) : arrondis, ne bloque jamais pour rien. */
const TOTAL_TOLERANCE_CENTS = 2;

const QUOTE_MESSAGES: Partial<Record<QuoteIssueCode, string>> = {
  empty_cart: 'Votre panier est vide.',
  out_of_delivery_range: 'Cette adresse est hors de la zone de livraison du restaurant.',
  distance_required: 'Indiquez une adresse de livraison.',
};

/** Facteur route / vol d'oiseau pour estimer la distance de livraison. */
const ROAD_FACTOR = 1.25;
/** Vitesse moyenne d'un livreur en ville (mètres par minute). */
const COURIER_METERS_PER_MINUTE = 250;
/** Au-delà de ce total, le client remet un code au livreur. */
const HANDOVER_CODE_THRESHOLD_CENTS = 6000;

type WithId<T> = T & { id: string };

/**
 * Zone de livraison du commerce contenant l'adresse (décision client : frais et
 * minimum fixés par le commerce sur sa zone). `undefined` : le commerce n'a défini
 * aucune zone, la tarification de la ville s'applique ; `null` : adresse hors zones.
 */
async function findMerchantZone(
  restaurantId: string,
  origin: { lat: number; lng: number },
  point: { lat: number; lng: number },
): Promise<WithId<RestaurantDeliveryZone> | null | undefined> {
  const snap = await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.deliveryZones)
    .where('enabled', '==', true)
    .get();
  if (snap.empty) return undefined;
  const zones = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as RestaurantDeliveryZone) }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const crowMeters = haversineMeters(origin, point);
  return (
    zones.find((z) =>
      z.type === 'polygon'
        ? Boolean(z.polygon && z.polygon.length >= 3 && isPointInPolygon(point, z.polygon))
        : z.radiusMeters != null && crowMeters <= z.radiusMeters,
    ) ?? null
  );
}

export const placeOrder = callable(
  schema,
  async (data: PlaceOrderInput, request): Promise<PlaceOrderResult> => {
    const caller = requireAuth(request);
    const uid = caller.uid;
    // Mode maintenance et version minimale (§30) : source unique, blocage réel.
    await assertNotInMaintenance('client');
    await assertMinimumVersion('client', data.appVersion);

    // Double envoi : on renvoie la commande déjà créée.
    const existing = await db
      .collection(COLLECTIONS.orders)
      .where('customerId', '==', uid)
      .where('clientRequestId', '==', data.clientRequestId)
      .limit(1)
      .get();
    const already = existing.docs[0];
    if (already) {
      const o = already.data() as Order;
      return { orderId: already.id, number: o.number, status: o.status, totalCents: o.amounts.totalCents, chargedCents: o.amounts.chargedCents, payment: { status: o.payment.status, clientSecret: null } };
    }

    // ---------------------------------------------------------------- Contexte
    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(data.restaurantId);
    const [userSnap, restaurantSnap, crmSnap, settingsSnap, commercialSnap, paymentSettingsSnap] = await Promise.all([
      db.collection(COLLECTIONS.users).doc(uid).get(),
      restaurantRef.get(),
      restaurantRef.collection(SUBCOLLECTIONS.restaurants.customers).doc(uid).get(),
      restaurantRef.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.orders).get(),
      restaurantRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).get(),
      db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.payments).get(),
    ]);
    if (!restaurantSnap.exists) throw fail.notFound('Restaurant');
    const restaurant = { id: restaurantSnap.id, ...(restaurantSnap.data() as Restaurant) };
    const profile = userSnap.exists ? (userSnap.data() as UserProfile & { test?: boolean }) : null;
    if (profile && profile.status !== 'active') throw fail.forbidden('Votre compte ne permet pas de passer commande. Contactez le support Ciyou Eats.');
    if (crmSnap.exists && (crmSnap.data() as RestaurantCustomer).blocked) {
      throw fail.forbidden('Ce restaurant n’accepte pas vos commandes pour le moment.');
    }
    // Liste de blocage (§28) : consultée à chaque commande (téléphone, e-mail, appareil).
    const blockChecks = await Promise.all([
      profile?.email ? isBlocked('email', profile.email) : Promise.resolve(false),
      profile?.phone ? isBlocked('phone', profile.phone) : Promise.resolve(false),
      data.deviceId ? isBlocked('device', data.deviceId) : Promise.resolve(false),
    ]);
    if (blockChecks.some(Boolean)) throw fail.forbidden('Votre compte ne permet pas de passer commande. Contactez le support Ciyou Eats.');
    // Réacceptation forcée des CGU/CGV (§29) : bloque seulement si une version plus récente exige une réacceptation.
    await assertLegalReaccepted(profile, 'terms_client', restaurant.countryId);
    const isTest = profile?.test === true;
    const orderSettings = settingsSnap.exists ? (settingsSnap.data() as RestaurantOrderSettings) : null;
    const commercial = commercialSnap.exists ? (commercialSnap.data() as RestaurantCommercial) : null;
    const paymentSettings = paymentSettingsSnap.exists ? (paymentSettingsSnap.data() as PaymentSettings) : null;
    const market = await loadMarket(restaurant.countryId, restaurant.cityId);
    const rules = await loadOrderRules(market);
    const config = pricingFor(restaurant.countryId, market);
    const now = new Date();

    // ---------------------------------------------------------------- Ouverture
    if (restaurant.status !== 'active' || restaurant.deletedAt) throw fail.precondition('Ce restaurant ne prend pas de commandes.');
    if (restaurant.visibleInApp === false) throw fail.precondition('Ce restaurant ne prend pas de commandes.', { code: 'restaurant_hidden' });
    if (!restaurant.isOpen) throw fail.precondition(`${restaurant.name} a mis ses commandes en pause. Réessayez un peu plus tard.`);
    // Lancement ville par ville : seules les villes actives sont opérables (décision client).
    if (market.city && !market.city.active) throw fail.precondition('Le service Ciyou Eats n’est pas encore ouvert dans cette ville.');
    if (market.city?.emergencyClosure?.active) throw fail.precondition(closureText(market.city.emergencyClosure, profile?.locale) ?? 'La livraison est momentanément suspendue dans votre ville.');
    if (!restaurant.fulfillmentModes.includes(data.fulfillment)) throw fail.precondition('Ce mode de commande n’est pas proposé par le restaurant.');
    // Interrupteurs de fonctionnalités (§24) : lus à chaque commande, sans nouvelle version des applications.
    const flags = await loadFeatureFlags();
    const featureScope = scopeOfRestaurant(restaurant, restaurant.id);
    const on = (key: FeatureKey): boolean => resolveFeature(flags.get(key), featureScope);
    const fulfillmentFlag: FeatureKey = data.fulfillment === 'delivery' ? 'delivery' : data.fulfillment === 'pickup' ? 'pickup' : 'dine_in';
    if (!on(fulfillmentFlag)) throw fail.precondition(`« ${FEATURE_LABELS[fulfillmentFlag]} » n’est pas disponible pour le moment.`);
    if (data.scheduledFor && !on('scheduled_orders')) throw fail.precondition('Les commandes programmées ne sont pas disponibles pour le moment.');
    if ((data.tipCents ?? 0) > 0 && !on('tips')) throw fail.precondition('Les pourboires ne sont pas proposés pour le moment.');
    // Abonnement suspendu pour impayé : plus de nouvelles commandes tant que le commerce n'a pas régularisé.
    if (commercial?.subscriptionStatus === 'suspended') throw fail.precondition(`${restaurant.name} est momentanément indisponible.`);

    let scheduledFor: Date | null = null;
    if (data.scheduledFor) {
      scheduledFor = new Date(data.scheduledFor);
      const lead = (scheduledFor.getTime() - now.getTime()) / 60_000;
      if (!rules.scheduledOrders?.enabled || orderSettings?.scheduledOrders === false) throw fail.precondition('Ce restaurant n’accepte pas les commandes programmées.');
      if (lead < rules.scheduledOrders.minLeadMinutes) throw fail.invalid(`Programmez la commande au moins ${rules.scheduledOrders.minLeadMinutes} minutes à l’avance.`);
      if (lead > rules.scheduledOrders.maxDaysAhead * 1440) throw fail.invalid(`Programmez la commande au plus ${rules.scheduledOrders.maxDaysAhead} jours à l’avance.`);
    }
    const serviceAt = scheduledFor ?? now;
    // Les comptes de démonstration (test: true) peuvent commander hors horaires pour les essais.
    if (!isTest) {
      if (!scheduledFor && !restaurant.acceptingOrders) throw fail.precondition(`${restaurant.name} est fermé pour le moment.`);
      if (!isOpenAt(restaurant.hoursSummary, serviceAt)) throw fail.precondition(`${restaurant.name} est fermé à cette heure-là.`);
      if (data.fulfillment === 'delivery' && market.city && !isOpenAt(market.city.serviceHours, serviceAt)) {
        throw fail.precondition('La livraison n’est pas assurée à cette heure-là dans votre ville.');
      }
    }

    // ---------------------------------------------------------------- Livraison
    let address: UserAddress | null = null;
    let distanceMeters = 0;
    let zone: WithId<Zone> | null = null;
    let merchantZone: WithId<RestaurantDeliveryZone> | null = null;
    let deliveredBy: 'platform' | 'restaurant' = 'platform';
    if (data.fulfillment === 'delivery') {
      if (!data.addressId) throw fail.invalid('Indiquez une adresse de livraison.');
      const addressSnap = await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.addresses).doc(data.addressId).get();
      if (!addressSnap.exists) throw fail.notFound('Adresse');
      address = addressSnap.data() as UserAddress;
      const point = { lat: address.geo.latitude, lng: address.geo.longitude };
      const origin = restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : null;
      if (!origin) throw fail.precondition('L’adresse du restaurant n’est pas géolocalisée.');
      distanceMeters = Math.round(haversineMeters(origin, point) * ROAD_FACTOR);
      const zonesSnap = await db.collection(COLLECTIONS.zones).where('cityId', '==', restaurant.cityId).where('active', '==', true).get();
      const zones = zonesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Zone) }));
      zone = zones.find((z) => isPointInPolygon(point, z.polygon)) ?? null;
      if (!zone) throw fail.precondition('Cette adresse est hors de la zone de livraison.');
      if (zone.emergencyClosure?.active) throw fail.precondition(closureText(zone.emergencyClosure, profile?.locale) ?? 'La livraison est momentanément suspendue dans votre quartier.');
      if (!isTest && zone.serviceHours && !isOpenAt(zone.serviceHours, serviceAt)) throw fail.precondition('La livraison n’est pas assurée à cette heure-là dans votre quartier.');
      const planRadius = DEFAULT_PLANS.find((p) => p.code === restaurant.planCode)?.maxDeliveryRadiusMeters ?? config.delivery.maxDistanceMeters;
      const maxDistance = Math.min(zone.maxDeliveryDistanceMeters, config.delivery.maxDistanceMeters, planRadius);
      if (distanceMeters > maxDistance) throw fail.precondition('Cette adresse est trop éloignée du restaurant.');
      if (restaurant.deliveredBy === 'restaurant') deliveredBy = 'restaurant';
      else if (restaurant.deliveredBy === 'both' && restaurant.ownDeliveryRadiusMeters && distanceMeters <= restaurant.ownDeliveryRadiusMeters) deliveredBy = 'restaurant';
      const found = await findMerchantZone(restaurant.id, origin, point);
      if (found === null) throw fail.precondition(`Cette adresse est hors de la zone de livraison de ${restaurant.name}.`);
      merchantZone = found ?? null;
    }

    // ---------------------------------------------------------------- Panier
    const productIds = [...new Set(data.lines.map((l) => l.productId))];
    const productRefs = productIds.map((id) => restaurantRef.collection(SUBCOLLECTIONS.restaurants.products).doc(id));
    const productSnaps = await db.getAll(...productRefs);
    const products = new Map<string, Product>();
    for (const snap of productSnaps) if (snap.exists) products.set(snap.id, snap.data() as Product);

    const groupIds = [...new Set(data.lines.flatMap((l) => (l.options ?? []).map((o) => o.groupId)).concat([...products.values()].flatMap((p) => p.optionGroupIds)))];
    const groupSnaps = groupIds.length ? await db.getAll(...groupIds.map((id) => restaurantRef.collection(SUBCOLLECTIONS.restaurants.optionGroups).doc(id))) : [];
    const groups = new Map<string, OptionGroup>();
    for (const snap of groupSnaps) if (snap.exists) groups.set(snap.id, snap.data() as OptionGroup);
    const optionIds = [...new Set([...groups.values()].flatMap((g) => g.optionIds))];
    const optionSnaps = optionIds.length ? await db.getAll(...optionIds.map((id) => restaurantRef.collection(SUBCOLLECTIONS.restaurants.options).doc(id))) : [];
    const options = new Map<string, MenuOption>();
    for (const snap of optionSnaps) if (snap.exists) options.set(snap.id, snap.data() as MenuOption);

    const items: OrderItem[] = data.lines.map((line, index) => {
      const product = products.get(line.productId);
      if (!product) throw fail.precondition('Un article de votre panier n’existe plus. Mettez votre panier à jour.', { code: 'cart_changed' });
      if (!product.available) throw fail.precondition(`« ${product.name} » n’est plus disponible.`, { code: 'cart_changed' });
      // Vente d'alcool interdite sur Ciyou Eats (décision client), quel que soit le paramétrage.
      const alcohol = checkProductAlcohol(product);
      if (alcohol.blocked) {
        const reason = alcohol.reasons[0];
        throw fail.precondition(`« ${product.name} » ne peut pas être commandé. ${reason ? ALCOHOL_BLOCK_MESSAGES[reason] : ''}`.trim());
      }
      const chosen = line.options ?? [];
      const snapshotOptions: OrderItem['options'] = [];
      for (const groupId of product.optionGroupIds) {
        const group = groups.get(groupId);
        if (!group?.enabled) continue;
        const picks = chosen.filter((o) => o.groupId === groupId);
        const count = picks.reduce((s, o) => s + (o.quantity ?? 1), 0);
        if (count < group.min) throw fail.invalid(`« ${product.name} » : choisissez au moins ${group.min} option(s) dans « ${group.name} ».`);
        if (count > group.max) throw fail.invalid(`« ${product.name} » : ${group.max} option(s) au maximum dans « ${group.name} ».`);
        if (!group.multiple && picks.length > 1) throw fail.invalid(`« ${product.name} » : un seul choix possible dans « ${group.name} ».`);
        for (const pick of picks) {
          if (!group.optionIds.includes(pick.optionId)) throw fail.invalid('Option invalide pour cet article.');
          if ((pick.quantity ?? 1) > 1 && !group.allowQuantity) throw fail.invalid(`« ${group.name} » : chaque option ne peut être choisie qu’une fois.`);
          const option = options.get(pick.optionId);
          if (!option?.enabled) throw fail.precondition(`Une option de « ${product.name} » n’est plus disponible.`);
          snapshotOptions.push({ optionId: pick.optionId, groupId, groupName: group.name, name: option.name, priceCents: option.priceCents, quantity: pick.quantity ?? 1 });
        }
      }
      if (chosen.some((o) => !product.optionGroupIds.includes(o.groupId))) throw fail.invalid('Option invalide pour cet article.');
      const optionsPriceCents = snapshotOptions.reduce((s, o) => s + o.priceCents * o.quantity, 0);

      // Vente au poids ou à prix variable (cahier weight-based-pricing) : le prix affiché sur la
      // carte n'est qu'indicatif, le montant réellement dû se calcule ici (et sera confirmé par le
      // commerce à la préparation via adjustOrderItemWeight).
      const saleUnit = product.saleUnit ?? 'unit';
      let weightGrams: number | null = null;
      let unitPriceCents = product.priceCents;
      if (saleUnit === 'weight') {
        const requested = line.weightGrams ?? product.minWeightGrams ?? product.weightStepGrams ?? null;
        if (!requested || requested <= 0) throw fail.invalid(`Indiquez le poids souhaité pour « ${product.name} ».`);
        if (product.minWeightGrams != null && requested < product.minWeightGrams) {
          throw fail.invalid(`« ${product.name} » : ${requested} g est inférieur au poids minimum (${product.minWeightGrams} g).`);
        }
        if (product.maxWeightGrams != null && requested > product.maxWeightGrams) {
          throw fail.invalid(`« ${product.name} » : ${requested} g dépasse le poids maximum (${product.maxWeightGrams} g).`);
        }
        weightGrams = Math.round(requested);
        // Même calcul que `lineUnitPriceCents` (moteur de tarification) : prix au kg × poids réel.
        unitPriceCents = Math.round(((product.pricePerKgCents ?? 0) * weightGrams) / 1000);
      } else if (saleUnit === 'variable') {
        // Montant maximal pré-autorisé : le prix final, toujours inférieur ou égal, est fixé par le
        // commerce à la préparation (adjustOrderItemWeight) et l'écart est remboursé automatiquement.
        unitPriceCents = product.variablePriceMaxCents ?? product.priceCents;
      }

      return {
        lineId: `l${index + 1}`,
        productId: line.productId,
        name: product.name,
        imageUrl: product.image?.thumbUrl ?? product.image?.url ?? null,
        unitPriceCents,
        quantity: line.quantity,
        options: snapshotOptions,
        optionsPriceCents,
        totalCents: (unitPriceCents + optionsPriceCents) * line.quantity,
        vatCategory: product.vatCategory,
        containsAlcohol: false,
        saleUnit: saleUnit !== 'unit' ? saleUnit : undefined,
        pricePerKgCents: saleUnit === 'weight' ? (product.pricePerKgCents ?? null) : undefined,
        weightGrams: saleUnit === 'weight' ? weightGrams : undefined,
        comment: line.comment || null,
        adjustment: null,
      };
    });
    const containsAlcohol = false;

    // ---------------------------------------------------------------- Offres sur un plat (B4)
    // « 1 acheté, 1 offert » / « le 2e à -50 % » (functions/src/marketing/restaurant/offers.ts),
    // financées à 100 % par le commerce. En concurrence avec une promotion (code ou automatique) :
    // seule la remise la plus avantageuse pour le client s'applique au final (pas de cumul, voir plus bas).
    const cartProductIds = new Set(items.map((i) => i.productId));
    const offersSnap = cartProductIds.size
      ? await restaurantRef.collection(SUBCOLLECTIONS.restaurants.productOffers).where('active', '==', true).get()
      : null;
    const offerToday = serviceAt.toISOString().slice(0, 10);
    const offerByProductId = new Map<string, { id: string; offer: ProductOffer }>();
    for (const snap of offersSnap?.docs ?? []) {
      const offer = snap.data() as ProductOffer;
      if (!cartProductIds.has(offer.productId)) continue;
      if (productOfferStatus(offer, offerToday) !== 'live') continue;
      const existing = offerByProductId.get(offer.productId);
      // Une seule offre par plat en principe ; en cas de doublon, « offert » prime déjà dans
      // computeProductOffersDiscount, on privilégie donc la lecture d'une offre bogo ici aussi.
      if (!existing || offer.kind === 'bogo') offerByProductId.set(offer.productId, { id: snap.id, offer });
    }
    const offerDiscountResult = offerByProductId.size
      ? computeProductOffersDiscount(
          items.map((i) => ({ productId: i.productId, unitPriceCents: i.unitPriceCents, quantity: i.quantity })),
          [...offerByProductId.values()].map(({ offer }) => ({ productId: offer.productId, kind: offer.kind })),
        )
      : { totalDiscountCents: 0, byProduct: {} as Record<string, number>, appliedOfferProductIds: [] as string[] };

    // ---------------------------------------------------------------- Pourboire
    // Réglage de la plateforme (settings/payments.tips) : activation et plafond ; le plafond du pays s'applique aussi au devis.
    if ((data.tipCents ?? 0) > 0 && paymentSettings?.tips) {
      if (paymentSettings.tips.enabled === false) throw fail.precondition('Les pourboires ne sont pas proposés pour le moment.');
      if (paymentSettings.tips.maxCents > 0 && (data.tipCents ?? 0) > paymentSettings.tips.maxCents) throw fail.precondition(`Le pourboire est limité à ${formatPrice(paymentSettings.tips.maxCents)}.`);
    }

    // ---------------------------------------------------------------- Devis
    const merchantZoneTerms: MerchantZoneTerms | null = merchantZone
      ? { feeCents: merchantZone.feeCents, minOrderCents: merchantZone.minOrderCents ?? null, freeAboveCents: merchantZone.freeAboveCents ?? null }
      : null;
    const baseMinOrderCents = Math.max(commercial?.minOrderOverrideCents ?? restaurant.minOrderCents ?? 0, merchantZoneTerms ? 0 : (zone?.minOrderCents ?? 0));
    const minOrderCents =
      effectiveMinOrderCents({ minOrderCents: baseMinOrderCents, merchantZone: merchantZoneTerms, fulfillment: data.fulfillment }, config) ?? baseMinOrderCents;
    const surge = zone?.currentSurge && zone.currentSurge.until.toMillis() > now.getTime() ? zone.currentSurge : null;
    // Frais de livraison : zone du commerce en priorité, sinon anciens réglages.
    const deliveryFeeOverrideCents =
      data.fulfillment !== 'delivery' || merchantZoneTerms
        ? undefined
        : deliveredBy === 'restaurant'
          ? (restaurant.ownDeliveryFeeCents ?? undefined)
          : (commercial?.deliveryFeeOverrideCents ?? undefined);
    const promotionInputOf = (p: Promotion): PromotionInput => ({
      kind: p.kind,
      value: p.value,
      maxDiscountCents: p.maxDiscountCents ?? null,
      minSubtotalCents: p.minSubtotalCents,
      funding: p.funding,
      restaurantShareBps: p.restaurantShareBps ?? undefined,
    });
    const runQuote = (promo: PromotionInput | undefined) =>
      computeQuote(
        {
          lines: items.map((i) => ({ unitPriceCents: i.unitPriceCents, optionsPriceCents: i.optionsPriceCents, quantity: i.quantity, vatCategory: i.vatCategory })),
          fulfillment: data.fulfillment,
          deliveredBy,
          distanceMeters: data.fulfillment === 'delivery' ? distanceMeters : undefined,
          zoneTiers: zone?.deliveryTiers ?? undefined,
          deliveryFeeOverrideCents: deliveryFeeOverrideCents ?? undefined,
          merchantZone: data.fulfillment === 'delivery' ? merchantZoneTerms : null,
          minOrderCents: baseMinOrderCents,
          surge: surge ? { multiplierBps: surge.multiplierBps, courierBonusCents: surge.courierBonusCents } : undefined,
          promotion: promo,
          tipCents: data.tipCents ?? 0,
        },
        config,
      );

    // ---------------------------------------------------------------- Promotion
    // Code saisi : contrôlé et refusé avec un message clair. Sans code : l'offre automatique la plus avantageuse.
    const promoRules = await loadPromotionRules();
    const promoContext = { restaurant, fulfillment: data.fulfillment, uid, profile, nowMs: now.getTime() };
    let promotion: WithId<Promotion> | null = null;
    if (data.promoCode) {
      if (!on('promotions')) throw fail.precondition('Les promotions ne sont pas disponibles pour le moment.');
      promotion = await loadPromotionByCode(data.promoCode, promoContext, promoRules);
    } else if (on('promotions') && runQuote(undefined).ok) {
      promotion = await pickAutomaticPromotion(promoContext, promoRules, (p) => {
        const trial = runQuote(promotionInputOf(p));
        return trial.ok && !trial.issues.includes('promo_minimum_not_reached') ? trial.discount.totalCents : 0;
      });
    }
    let promotionInput = promotion ? promotionInputOf(promotion) : undefined;
    // Offre sur un plat vs promotion : seule la plus avantageuse pour le client s'applique (§B4).
    // L'offre est toujours financée à 100 % par le commerce (`funding: 'restaurant'`), comme la
    // remise elle-même (packages/shared/src/pricing/product-offers.ts).
    let appliedProductOffer = false;
    if (offerDiscountResult.totalDiscountCents > 0) {
      const offerPromotionInput: PromotionInput = { kind: 'fixed', value: offerDiscountResult.totalDiscountCents, maxDiscountCents: null, funding: 'restaurant', restaurantShareBps: 10_000 };
      const offerQuote = runQuote(offerPromotionInput);
      const promoQuote = promotionInput ? runQuote(promotionInput) : null;
      if (offerQuote.ok && (!promoQuote || !promoQuote.ok || promoQuote.issues.includes('promo_minimum_not_reached') || offerQuote.discount.totalCents > promoQuote.discount.totalCents)) {
        appliedProductOffer = true;
        promotionInput = offerPromotionInput;
        promotion = null; // l'offre l'emporte : pas de code/promo auto appliqué (pas de rédemption promo à écrire).
      }
    }
    const quote = runQuote(promotionInput);
    if (!quote.ok) {
      const blocking = quote.issues.find((i) => QUOTE_MESSAGES[i] || i === 'below_minimum_order');
      if (blocking === 'below_minimum_order') throw fail.precondition(`Le minimum de commande est de ${formatPrice(minOrderCents)}.`);
      throw fail.precondition((blocking && QUOTE_MESSAGES[blocking]) ?? 'Votre commande ne peut pas être validée.');
    }
    if (promotion && quote.issues.includes('promo_minimum_not_reached')) {
      throw fail.precondition(`Ce code promo s’applique dès ${formatPrice(promotion.minSubtotalCents)} d’achat.`, { code: 'promo_invalid' });
    }
    // Revalidation avant paiement (§A3) : le total recalculé doit correspondre au devis affiché au
    // client, à ±2 centimes (arrondis) ; sinon la commande n'est pas créée mais le panier reste intact
    // côté client (aucune donnée n'est modifiée ici, l'app doit simplement rafraîchir son devis).
    if (data.expectedTotalCents != null && Math.abs(quote.totalCents - data.expectedTotalCents) > TOTAL_TOLERANCE_CENTS) {
      throw fail.precondition('Le total de votre commande a changé. Vérifiez votre panier avant de valider.', {
        code: 'total_changed',
        expectedTotalCents: data.expectedTotalCents,
        totalCents: quote.totalCents,
      });
    }

    // ---------------------------------------------------------------- Portefeuille
    // Avoirs, gestes commerciaux et récompenses : dépensables à la commande, en tout ou partie.
    const walletAllowed = paymentSettings?.methods?.wallet !== false && (market.country?.paymentMethods?.wallet ?? true);
    const walletBalanceCents = Math.max(0, profile?.walletBalanceCents ?? 0);
    if (data.useWallet && walletBalanceCents === 0) throw fail.precondition('Votre solde d’avoirs Ciyou Eats est vide.');
    const walletAppliedCents = data.useWallet && walletAllowed ? Math.min(walletBalanceCents, quote.totalCents) : 0;
    const chargedCents = quote.totalCents - walletAppliedCents;
    // Le solde couvre toute la commande : aucun autre moyen de paiement n'est nécessaire.
    const method: PaymentMethod = walletAppliedCents > 0 && chargedCents === 0 ? 'wallet' : data.paymentMethod;

    // ---------------------------------------------------------------- Paiement
    if (method !== 'wallet') {
      const allowedByPlatform = (paymentSettings?.methods?.[method] ?? true) && (market.country?.paymentMethods?.[method] ?? true);
      const allowedByRestaurant = restaurant.acceptedPaymentMethods.includes(method) && (!commercial || commercial.allowedPaymentMethods.includes(method));
      if (!allowedByPlatform || !allowedByRestaurant) throw fail.precondition('Ce moyen de paiement n’est pas accepté pour cette commande.');
      if ((method === 'card' || method === 'apple_pay' || method === 'google_pay') && !on('card_payment')) throw fail.precondition('Le paiement par carte n’est pas disponible pour le moment.');
      if (method === 'cash' && !on('cash_payment')) throw fail.precondition('Le paiement en espèces n’est pas disponible pour le moment.');
      // Espèces : uniquement avec un livreur salarié du commerce (décision client).
      if (method === 'cash' && !isCashAllowed({ fulfillment: data.fulfillment, deliveredBy, cashEnabled: paymentSettings?.cash?.enabled !== false })) {
        throw fail.precondition(
          data.fulfillment === 'delivery'
            ? 'Le paiement en espèces n’est possible qu’avec les livreurs du commerce. Payez en ligne pour cette commande.'
            : 'Le paiement en espèces n’est pas disponible pour cette commande.',
        );
      }
      if (STRIPE_METHODS.includes(method) && !data.paymentMethodId) throw fail.invalid('Choisissez un moyen de paiement.');
    }

    // Commission : négociée > ville > formule > pays, mode de facturation (commission OU abonnement), offre spéciale.
    const plan = await loadPlan(restaurant.planCode);
    const groupRule = await loadGroupRule(restaurant.groupId, now.getTime());
    const resolution = resolveOrderCommission({ fulfillment: data.fulfillment, deliveredBy, config, market, plan, commercial, groupRule, nowMs: now.getTime() });
    const commissionBps = resolution.bps;
    const commissionSource: OrderFinancials['commissionSource'] = resolution.source;
    const travelMinutes = data.fulfillment === 'delivery' ? Math.max(5, Math.round(distanceMeters / COURIER_METERS_PER_MINUTE) + 3) : 0;
    // Bonus d'heure de pointe (§6) : heure locale de la ville comparée aux heures réglées pour le pays/la ville.
    const localHour = Math.floor(localClock(serviceAt, market.city?.timezone ?? 'Europe/Paris').minutes / 60);
    const isPeak = (config.courier.peakHours ?? []).includes(localHour);
    const settlement = computeSettlement(
      {
        quote,
        paymentMethod: method,
        commissionBps,
        courier: data.fulfillment === 'delivery' && deliveredBy === 'platform' ? { distanceMeters, durationMinutes: travelMinutes, isPeak } : undefined,
        surgeCourierBonusCents: surge?.courierBonusCents,
        walletAppliedCents,
      },
      config,
    );

    let authorization: Authorization | null = null;
    if (STRIPE_METHODS.includes(method) && chargedCents > 0) {
      // Nouvelles tentatives d'un paiement refusé : limitées par heure et par client (settings/payments.failedPaymentRetry).
      const retryLimit = paymentSettings?.failedPaymentRetry?.maxAttempts ?? 0;
      const failuresRef = db.collection('rateLimits').doc(`payfail_${uid}_${now.toISOString().slice(0, 13)}`);
      if (retryLimit > 0 && ((await failuresRef.get()).get('count') as number | undefined ?? 0) >= retryLimit) {
        throw fail.precondition('Trop de paiements refusés récemment. Réessayez dans une heure ou contactez le support Ciyou Eats.');
      }
      if (data.paymentMethodId) {
        const fingerprint = await retrieveCardFingerprint(data.paymentMethodId);
        if (fingerprint && (await isBlocked('card_fingerprint', fingerprint))) {
          throw fail.forbidden('Ce moyen de paiement ne peut pas être utilisé. Contactez le support Ciyou Eats.');
        }
      }
      try {
        authorization = await authorizePayment({
          amountCents: chargedCents,
          currency: config.currency,
          paymentMethodId: data.paymentMethodId ?? '',
          requestId: `${uid}-${data.clientRequestId}`,
          customerId: uid,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
        });
      } catch (error) {
        if (error instanceof CardRefusedError) {
          await recordRefusedPayment({ uid, clientRequestId: data.clientRequestId, restaurant, method, amountCents: chargedCents, currency: config.currency, failureCode: error.failureCode, message: error.message, isTest });
          throw fail.precondition('Paiement refusé par votre banque. Essayez un autre moyen de paiement.');
        }
        throw error;
      }
      if (authorization.status === 'failed' || authorization.status === 'cancelled') {
        await recordRefusedPayment({ uid, clientRequestId: data.clientRequestId, restaurant, method, amountCents: chargedCents, currency: config.currency, failureCode: authorization.status, message: 'Paiement refusé à l’autorisation.', isTest });
        throw fail.precondition('Paiement refusé. Essayez un autre moyen de paiement.');
      }
    }

    // Acceptation automatique (réglage restaurant `autoAccept`) : l'encaissement doit être déclenché
    // ici, exactement comme à l'acceptation manuelle (cf. transitions.ts::acceptOrder) — sinon le
    // paiement reste seulement autorisé (bloqué sur la carte du client) et n'est jamais capturé.
    // Si l'encaissement échoue, la commande est quand même créée mais PAS acceptée automatiquement :
    // l'autorisation reste valide, le restaurant devra l'accepter manuellement (nouvel essai d'encaissement).
    let capturedProviderChargeId: string | null = null;
    let autoAcceptCaptureFailed = false;
    if (orderSettings?.autoAccept === true && !scheduledFor && authorization && authorization.status === 'authorized' && authorization.intentId) {
      const captured = await captureAuthorizedIntent(authorization.intentId, `order-capture-${uid}-${data.clientRequestId}`, `${restaurant.id}/${uid}/${data.clientRequestId}`);
      if (captured.status === 'failed') {
        autoAcceptCaptureFailed = true;
      } else {
        authorization = { ...authorization, status: captured.status };
        capturedProviderChargeId = captured.providerChargeId;
      }
    }

    // ---------------------------------------------------------------- Écriture
    const prepMinutes = (orderSettings?.prepMinutes ?? restaurant.prepMinutes ?? rules.defaultPrepMinutes) + (restaurant.busyExtraMinutes ?? 0);
    const customerName = profile ? publicDisplayName(profile.firstName, profile.lastName) : caller.name;
    const paymentReady = !authorization || authorization.status === 'authorized' || authorization.status === 'paid';
    const autoAccept = orderSettings?.autoAccept === true && !scheduledFor && paymentReady && !autoAcceptCaptureFailed;

    let result: PlaceOrderResult;
    try {
      result = await db.runTransaction(async (tx) => {
        const counterRef = db.collection(COLLECTIONS.counters).doc('orders');
        const counterSnap = await tx.get(counterRef);
        // Plafond de commandes simultanées (§A1) : comptées dans la transaction pour éviter que deux
        // commandes concurrentes ne dépassent toutes les deux le plafond au même instant.
        const maxConcurrentOrders = orderSettings?.maxConcurrentOrders ?? rules.merchantDefaults?.maxConcurrentOrders ?? 12;
        if (maxConcurrentOrders > 0) {
          const activeSnap = await tx.get(
            db.collection(COLLECTIONS.orders).where('restaurantId', '==', restaurant.id).where('status', 'in', [...ACTIVE_ORDER_STATUSES]).limit(maxConcurrentOrders),
          );
          if (activeSnap.size >= maxConcurrentOrders) {
            throw fail.precondition(
              `${restaurant.name} a déjà ${activeSnap.size} commande${activeSnap.size > 1 ? 's' : ''} en cours et ne peut pas en accepter de nouvelle pour le moment. Réessayez dans quelques minutes.`,
              { code: 'max_concurrent_orders' },
            );
          }
        }
        const stockSnaps = await tx.getAll(...productRefs);
        // Portefeuille et offre : relus dans la transaction (deux commandes simultanées ne doivent pas dépasser le solde ni les limites).
        const userRef = db.collection(COLLECTIONS.users).doc(uid);
        const walletSnap = walletAppliedCents > 0 ? await tx.get(userRef) : null;
        const promotionRef = promotion ? db.collection(COLLECTIONS.promotions).doc(promotion.id) : null;
        const promotionSnap = promotionRef ? await tx.get(promotionRef) : null;
        const usesSnap = promotion
          ? await tx.get(
              db.collection(COLLECTIONS.promotionRedemptions).where('promotionId', '==', promotion.id).where('userId', '==', uid).where('status', '==', 'applied').limit(Math.max(1, promotion.perCustomerLimit)),
            )
          : null;
        if (walletSnap && ((walletSnap.get('walletBalanceCents') as number | undefined) ?? 0) < walletAppliedCents) {
          throw fail.precondition('Votre solde d’avoirs a changé : vérifiez le montant réglé avec vos avoirs avant de valider.');
        }
        if (promotion && promotionSnap && usesSnap) {
          const fresh = promotionSnap.data() as Promotion | undefined;
          if (!fresh || fresh.status !== 'active') throw fail.precondition('Cette offre n’est plus disponible.', { code: 'promo_invalid' });
          if (fresh.totalUsageLimit && fresh.stats.redemptions >= fresh.totalUsageLimit) throw fail.precondition('Cette offre a atteint sa limite d’utilisation.', { code: 'promo_invalid' });
          if (usesSnap.size >= Math.max(1, fresh.perCustomerLimit)) throw fail.precondition('Vous avez déjà utilisé cette offre.', { code: 'promo_invalid' });
        }
        const sequence = ((counterSnap.data() as Counter | undefined)?.value ?? 10000) + 1;
        const number = formatOrderNumber(sequence);
        const id = `o-${sequence}`;
        const at = Timestamp.now();

        // Stock (suivi uniquement si stock != null et fonctionnalité « stock » active).
        const stockTracked = on('stock_management');
        const wanted = new Map<string, number>();
        for (const item of items) wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
        const movements: Array<{ ref: DocumentReference; stock: number; product: Product; qty: number }> = [];
        for (const snap of stockSnaps) {
          const product = snap.data() as Product | undefined;
          const qty = wanted.get(snap.id) ?? 0;
          // Suivi de stock désactivé (§24) : les quantités ne bloquent plus la commande.
          if (!stockTracked || !product || qty === 0 || product.stock === null || product.stock === undefined) continue;
          if (product.stock < qty) {
            throw fail.precondition(product.stock === 0 ? `« ${product.name} » est en rupture de stock.` : `Il ne reste que ${product.stock} « ${product.name} ».`, { code: 'stock_changed' });
          }
          movements.push({ ref: snap.ref, stock: product.stock - qty, product, qty });
        }

        const pickupCode =
          data.fulfillment !== 'delivery' || quote.totalCents > HANDOVER_CODE_THRESHOLD_CENTS || containsAlcohol ? generateFourDigitCode() : null;
        // Code de collecte livreur ↔ commerce (voir docs/CONTRAT_MODULES.md §11) : distinct du
        // code de remise au client (`pickupCode`), généré pour toute commande en livraison.
        const collectionCode = data.fulfillment === 'delivery' ? generateFourDigitCode() : null;
        const etaMin = (restaurant.etaMinutes?.min ?? prepMinutes + travelMinutes) + (restaurant.busyExtraMinutes ?? 0);
        const etaMax = (restaurant.etaMinutes?.max ?? prepMinutes + travelMinutes + 10) + (restaurant.busyExtraMinutes ?? 0);
        const base = (scheduledFor ?? now).getTime();
        const promisedFrom = Timestamp.fromMillis(scheduledFor ? base - 5 * 60_000 : base + (data.fulfillment === 'delivery' ? etaMin : prepMinutes) * 60_000);
        const promisedTo = Timestamp.fromMillis(scheduledFor ? base + 10 * 60_000 : base + (data.fulfillment === 'delivery' ? etaMax : prepMinutes + 10) * 60_000);
        const status: Order['status'] = scheduledFor ? 'scheduled' : autoAccept ? 'preparing' : 'new';
        const paymentId = `pay-${id}`;
        const paymentStatus = authorization?.status ?? (method === 'cash' && chargedCents > 0 ? 'pending' : 'paid');

        const order: Order = {
          number,
          countryId: restaurant.countryId,
          cityId: restaurant.cityId,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          restaurantGroupId: restaurant.groupId ?? null,
          customerId: uid,
          customerName,
          customerPhoneMasked: profile?.phone ? maskPhone(profile.phone) : null,
          status,
          fulfillment: data.fulfillment,
          items,
          itemsCount: quote.itemsCount,
          amounts: {
            subtotalCents: quote.subtotalCents,
            serviceFeeCents: quote.serviceFeeCents,
            smallOrderFeeCents: quote.smallOrderFeeCents,
            deliveryFeeCents: quote.deliveryFeeCents,
            surgeFeeCents: quote.surgeFeeCents,
            discount: quote.discount,
            tipCents: quote.tipCents,
            walletAppliedCents,
            totalCents: quote.totalCents,
            chargedCents,
            refundedCents: 0,
            itemsVat: quote.itemsVat,
            currency: config.currency,
          },
          payment: { method, status: paymentStatus, paymentId, label: authorization?.label ?? null, paidAt: paymentStatus === 'paid' ? at : null },
          promotionId: promotion?.id ?? null,
          promoCode: promotion ? data.promoCode ?? null : null,
          delivery:
            data.fulfillment === 'delivery' && address
              ? {
                  address: {
                    line1: address.line1,
                    line2: address.line2 ?? null,
                    postalCode: address.postalCode,
                    city: address.city,
                    countryCode: address.countryCode,
                    geo: null,
                    geohash: address.geohash ?? null,
                    placeId: address.placeId ?? null,
                    label: address.label,
                    details: [address.floor ? `Étage ${address.floor}` : null, address.doorCode ? `Code ${address.doorCode}` : null, address.details].filter(Boolean).join(' · ') || null,
                    instructions: address.instructions ?? null,
                  },
                  geo: new GeoPoint(address.geo.latitude, address.geo.longitude),
                  zoneId: zone?.id ?? null,
                  distanceMeters,
                  deliveredBy,
                  driverId: null,
                  driverName: null,
                  driverPhoneMasked: null,
                  driverVehicle: null,
                  promisedFrom,
                  promisedTo,
                  estimatedArrivalAt: promisedTo,
                  proof: null,
                  handoverCodeRequired: pickupCode !== null,
                  collectionCode,
                  collectionVerified: false,
                  courierRequestedAt: null,
                  dispatchStatus: null,
                  dispatchAttempts: 0,
                  courierSurgeBonusCents: deliveredBy === 'platform' ? (surge?.courierBonusCents ?? null) : null,
                  courierIsPeak: deliveredBy === 'platform' ? isPeak : false,
                }
              : null,
          pickupCode,
          pickupVerified: false,
          customerNote: data.customerNote || null,
          scheduledFor: scheduledFor ? Timestamp.fromDate(scheduledFor) : null,
          prepMinutes,
          prepExtendedMinutes: 0,
          containsAlcohol,
          ageConfirmed: data.ageConfirmed === true,
          timeline: { placedAt: at, ...(scheduledFor ? { scheduled: at } : { new: at }), ...(autoAccept ? { accepted: at, preparing: at } : {}) },
          acceptDeadline: status === 'new' && paymentReady ? Timestamp.fromMillis(at.toMillis() + rules.acceptanceTimeoutSeconds * 1000) : null,
          cancellation: null,
          flags: { late: false, lateMinutes: 0, refunded: false, disputed: false, fraudSuspected: false, firstOrder: (profile?.stats?.ordersCount ?? 0) === 0 },
          reviewId: null,
          ticketIds: [],
          conversationId: null,
          source: { app: data.source ?? 'client_web', appVersion: data.appVersion ?? null },
          driverId: null,
          searchKeywords: buildSearchKeywords(number, customerName, restaurant.name, address?.line1, address?.city),
          createdAt: at,
          updatedAt: at,
          restaurantSettlement: settlement.restaurant,
          commission: { bps: commissionBps, source: commissionSource, billingMode: resolution.billingMode },
          clientRequestId: data.clientRequestId,
          processed: null,
          ...(isTest ? { test: true } : {}),
        };
        tx.set(orderRef(id), order);
        addEvent(tx, id, { type: 'customer', uid, name: customerName }, { type: 'created', from: null, to: status, visibleToCustomer: true, message: null, data: merchantZone ? { merchantZoneId: merchantZone.id, merchantZoneName: merchantZone.name } : null }, at);
        if (autoAccept) {
          addEvent(tx, id, SYSTEM_EVENT_ACTOR, { type: 'status_changed', from: 'new', to: 'preparing', visibleToCustomer: true, message: 'Commande acceptée automatiquement.', data: { prepMinutes } }, at);
        }

        const payment: Payment = {
          countryId: restaurant.countryId,
          cityId: restaurant.cityId,
          purpose: 'order',
          orderId: id,
          subscriptionId: null,
          invoiceId: null,
          payerType: 'client',
          payerId: uid,
          restaurantId: restaurant.id,
          method,
          amountCents: chargedCents,
          currency: config.currency,
          status: paymentStatus,
          provider: method === 'cash' ? 'cash' : method === 'wallet' ? 'wallet' : 'stripe',
          providerIntentId: authorization?.intentId ?? null,
          providerChargeId: capturedProviderChargeId,
          cardFingerprint: authorization?.fingerprint ?? null,
          cardLabel: authorization?.label ?? null,
          feeCents: settlement.payment.totalCents,
          failureCode: null,
          failureMessage: null,
          attempts: 1,
          refundedCents: 0,
          createdAt: at,
          updatedAt: at,
        };
        tx.set(db.collection(COLLECTIONS.payments).doc(paymentId), { ...payment, ...(isTest ? { test: true } : {}) });

        for (const m of movements) {
          tx.update(m.ref, { stock: m.stock, updatedAt: at, updatedBy: 'system' });
          const movement: StockMovement = { productId: m.ref.id, productName: m.product.name, delta: -m.qty, stockAfter: m.stock, reason: 'order', orderId: id, note: number, createdAt: at, createdBy: 'system' };
          tx.set(restaurantRef.collection(SUBCOLLECTIONS.restaurants.stockMovements).doc(), movement);
        }

        if (promotion && quote.discount.totalCents > 0) {
          const redemption: PromotionRedemption = {
            promotionId: promotion.id,
            code: data.promoCode ?? null,
            userId: uid,
            orderId: id,
            restaurantId: restaurant.id,
            cityId: restaurant.cityId,
            discountCents: quote.discount.totalCents,
            platformFundedCents: quote.discount.platformFundedCents,
            restaurantFundedCents: quote.discount.restaurantFundedCents,
            status: 'applied',
            createdAt: at,
          };
          tx.set(db.collection(COLLECTIONS.promotionRedemptions).doc(id), redemption);
          tx.update(db.collection(COLLECTIONS.promotions).doc(promotion.id), {
            'stats.redemptions': FieldValue.increment(1),
            'stats.discountCents': FieldValue.increment(quote.discount.totalCents),
            'stats.ordersSubtotalCents': FieldValue.increment(quote.subtotalCents),
            ...(order.flags.firstOrder ? { 'stats.newCustomers': FieldValue.increment(1) } : {}),
          });
        }
        if (appliedProductOffer && quote.discount.totalCents > 0) {
          // Une offre par plat concerné (§B4) : compteurs tenus par la fonction (visibles côté commerce et super admin, H1).
          for (const productId of offerDiscountResult.appliedOfferProductIds) {
            const matched = offerByProductId.get(productId);
            const discountForProduct = offerDiscountResult.byProduct[productId] ?? 0;
            if (!matched || discountForProduct <= 0) continue;
            tx.update(restaurantRef.collection(SUBCOLLECTIONS.restaurants.productOffers).doc(matched.id), {
              ordersCount: FieldValue.increment(1),
              discountTotalCents: FieldValue.increment(discountForProduct),
            });
          }
        }
        if (walletSnap && walletAppliedCents > 0) {
          const balanceAfter = ((walletSnap.get('walletBalanceCents') as number | undefined) ?? 0) - walletAppliedCents;
          tx.update(userRef, { walletBalanceCents: balanceAfter, updatedAt: at });
          const debit: WalletTransaction = { userId: uid, type: 'debit', amountCents: walletAppliedCents, balanceAfterCents: balanceAfter, reason: 'order_payment', orderId: id, ticketId: null, refundId: null, expiresAt: null, note: `Commande ${number}`, createdAt: at, createdBy: 'system' };
          tx.set(db.collection(COLLECTIONS.walletTransactions).doc(`wp-${id}`), debit);
          const ledger: LedgerEntry = { countryId: restaurant.countryId, cityId: restaurant.cityId, accountType: 'customer_wallet', accountId: uid, type: 'wallet_debit', amountCents: -walletAppliedCents, currency: config.currency, orderId: id, description: `Avoirs utilisés ${number}`, bookingDate: at.toDate().toISOString().slice(0, 10), createdAt: at, createdBy: 'system' };
          tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(`wp-${id}`), { ...ledger, ...(isTest ? { test: true } : {}) });
        }
        tx.set(counterRef, { value: sequence, prefix: 'GL-', updatedAt: at }, { merge: true });
        tx.update(restaurantRef, { lastOrderAt: at });

        return {
          orderId: id,
          number,
          status,
          totalCents: quote.totalCents,
          chargedCents: quote.totalCents,
          payment: { status: paymentStatus, clientSecret: authorization?.clientSecret ?? null },
        };
      });
    } catch (error) {
      // Stock épuisé entre-temps, etc. : l'autorisation bancaire est libérée.
      if (authorization?.intentId) await getStripe().paymentIntents.cancel(authorization.intentId).catch(() => undefined);
      throw error;
    }
    // Empreintes appareil/carte : mémorisées pour détecter les comptes multiples liés (§28).
    const privateUpdate: Record<string, unknown> = {};
    if (authorization?.fingerprint) privateUpdate.cardFingerprints = FieldValue.arrayUnion(authorization.fingerprint);
    if (data.deviceId) privateUpdate.deviceHashes = FieldValue.arrayUnion(hashValue(data.deviceId));
    if (Object.keys(privateUpdate).length) {
      privateUpdate.updatedAt = Timestamp.now();
      await db
        .collection(COLLECTIONS.userPrivate)
        .doc(uid)
        .set(privateUpdate, { merge: true })
        .catch(() => undefined);
    }
    return result;
  },
  { secrets: [STRIPE_SECRET_KEY] },
);
