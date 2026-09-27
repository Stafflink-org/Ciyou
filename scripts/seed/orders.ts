// Historique de commandes sur 90 jours, calculé avec le moteur de tarification
// partagé : devis client, répartition, paiements, grand livre, avis,
// remboursements, gains livreurs et agrégats des tableaux de bord.
import {
  COLLECTIONS,
  DEFAULT_PRICING_BY_COUNTRY,
  SUBCOLLECTIONS,
  allocateRefund,
  buildSearchKeywords,
  computeQuote,
  computeSettlement,
  formatOrderNumber,
  generateFourDigitCode,
  haversineMeters,
  maskPhone,
  publicDisplayName,
  type CancelReason,
  type DailyStats,
  type DriverEarning,
  type FulfillmentMode,
  type LedgerEntry,
  type Order,
  type OrderEvent,
  type OrderFinancials,
  type OrderItem,
  type OrderStatus,
  type Payment,
  type PaymentMethod,
  type PromotionInput,
  type PromotionRedemption,
  type Quote,
  type Refund,
  type RefundCause,
  type RestaurantCourier,
  type RestaurantCustomer,
  type RestaurantDailyStats,
  type Review,
  type Settlement,
} from '@golink/shared';
import type { SeedContext } from './context';
import { addDays, dayKey, minutesAfter, parisDay, parisTime, ts, weekday } from './lib';
import type { ClientRuntime, DriverRuntime } from './people';
import type { RestaurantRuntime } from './restaurants';

/** Part des commandes moyennes du catalogue réellement générées (volume de démonstration). */
const VOLUME = 0.6;
const DAYS = 90;
/** Événements détaillés conservés pour les commandes récentes uniquement. */
const EVENTS_DAYS = 10;

export interface SeededOrder {
  id: string;
  number: string;
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  customerName: string;
  driverId: string | null;
  cityId: string;
  countryId: string;
  status: OrderStatus;
  placedAt: Date;
  deliveredAt: Date | null;
  totalCents: number;
  fulfillment: FulfillmentMode;
  refunded: boolean;
  late: boolean;
  settlement: Settlement | null;
  commissionBps: number;
  promotionId: string | null;
  /** Part d'un remboursement imputée au restaurant. */
  restaurantChargeCents: number;
  quote: Quote;
  paymentMethod: PaymentMethod;
}

export interface OrdersOutcome {
  orders: SeededOrder[];
  productSales: Map<string, number>;
  restaurantStats: Map<string, { orders: number; ratings: number[] }>;
  refundsCount: number;
  reviewsCount: number;
}

const WEEKDAY_FACTOR = [0.8, 0.85, 0.92, 0.97, 1.22, 1.32, 1.05];
const CAFE_WEEKDAY_FACTOR = [0.9, 0.9, 0.95, 0.95, 1.05, 1.4, 1.3];

const REVIEW_COMMENTS = {
  5: ['Parfait, comme d’habitude.', 'Plats encore chauds, livreur très aimable.', 'Excellent, les portions sont généreuses.', 'Un régal, je recommande.', 'Toujours aussi bon, merci !'],
  4: ['Très bon, livraison un peu longue.', 'Bon repas, il manquait juste un peu de sauce.', 'Bonne adresse, je recommanderai.'],
  3: ['Correct sans plus.', 'Plat un peu tiède à l’arrivée.', 'Bon mais un article a été oublié.'],
  2: ['Commande arrivée froide.', 'Trop d’attente pour un plat moyen.'],
  1: ['Commande incomplète et livrée en retard.', 'Très déçu cette fois-ci.'],
} as const;

interface Draft {
  restaurant: RestaurantRuntime;
  client: ClientRuntime;
  placedAt: Date;
  day: string;
}

function hourlyMinutes(ctx: SeedContext, profile: RestaurantRuntime['seed']['profile']): number {
  const { rng } = ctx;
  const clamp = (v: number, a: number, b: number) => Math.round(Math.min(b, Math.max(a, v)));
  if (profile === 'cafe') {
    return rng.chance(0.6) ? clamp(rng.normal(9.6 * 60, 55), 7 * 60 + 45, 12 * 60) : clamp(rng.normal(15.5 * 60, 60), 13 * 60, 18 * 60 + 15);
  }
  return rng.chance(0.44) ? clamp(rng.normal(12.75 * 60, 32), 11 * 60 + 35, 14 * 60 + 15) : clamp(rng.normal(20 * 60, 48), 18 * 60 + 35, 22 * 60 + 20);
}

function isOpenDay(profile: RestaurantRuntime['seed']['profile'], day: string): boolean {
  const wd = weekday(day);
  return profile === 'cafe' ? wd !== 0 : wd !== 6;
}

export function seedOrders(
  ctx: SeedContext,
  restaurants: RestaurantRuntime[],
  clients: ClientRuntime[],
  drivers: DriverRuntime[],
): OrdersOutcome {
  const { rng, w } = ctx;
  const active = restaurants.filter((r) => r.seed.status !== 'onboarding');
  const clientsByCity = new Map<string, ClientRuntime[]>();
  for (const c of clients) clientsByCity.set(c.cityId, [...(clientsByCity.get(c.cityId) ?? []), c]);
  const platformDrivers = new Map<string, DriverRuntime[]>();
  for (const d of drivers.filter((x) => x.type === 'platform' && x.onboardingStatus === 'approved')) {
    platformDrivers.set(d.cityId, [...(platformDrivers.get(d.cityId) ?? []), d]);
  }

  // 1. Tirage des commandes (jour, heure, client).
  const drafts: Draft[] = [];
  for (let offset = DAYS - 1; offset >= 0; offset -= 1) {
    const day = addDays(ctx.today, -offset);
    const growth = 0.62 + 0.48 * ((DAYS - 1 - offset) / (DAYS - 1));
    for (const r of active) {
      if (!isOpenDay(r.seed.profile, day)) continue;
      const factor = (r.seed.profile === 'cafe' ? CAFE_WEEKDAY_FACTOR : WEEKDAY_FACTOR)[weekday(day)] ?? 1;
      const expected = r.seed.dailyOrders * VOLUME * growth * factor;
      const count = Math.max(0, Math.round(rng.normal(expected, Math.sqrt(expected))));
      const pool = clientsByCity.get(r.seed.cityId) ?? [];
      for (let i = 0; i < count; i += 1) {
        const placedAt = parisTime(day, hourlyMinutes(ctx, r.seed.profile));
        if (placedAt > ctx.now) continue;
        const client = rng.weighted(pool.map((c) => [c, c.weight] as const));
        drafts.push({ restaurant: r, client, placedAt, day });
      }
    }
  }
  drafts.sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());

  const outcome: OrdersOutcome = { orders: [], productSales: new Map(), restaurantStats: new Map(), refundsCount: 0, reviewsCount: 0 };
  const restaurantDaily = new Map<string, RestaurantDailyStats>();
  const platformDaily = new Map<string, DailyStats>();
  const crm = new Map<string, RestaurantCustomer & { rid: string }>();
  const couriers = new Map<string, RestaurantCourier & { rid: string }>();
  const seenCustomers = new Set<string>();
  const ordersPerClient = new Map<string, number>();

  // 2. Construction de chaque commande (numérotation continue).
  let sequence = 10000;
  drafts.forEach((draft, index) => {
    const { restaurant: r, client, placedAt, day } = draft;
    const config = DEFAULT_PRICING_BY_COUNTRY[r.countryId];
    if (!config) throw new Error(`Tarification absente : ${r.countryId}`);
    const firstOrder = !seenCustomers.has(client.uid);
    seenCustomers.add(client.uid);
    ordersPerClient.set(client.uid, (ordersPerClient.get(client.uid) ?? 0) + 1);

    // Mode et livreur.
    const fulfillment: FulfillmentMode = rng.chance(r.seed.pickupShare) ? 'pickup' : 'delivery';
    const deliveredBy = fulfillment === 'delivery' ? (r.seed.deliveredBy === 'both' && rng.chance(0.3) ? 'restaurant' : 'platform') : 'restaurant';
    const address = rng.pick(client.addresses);
    const distanceMeters = Math.round(haversineMeters(r.seed.location, address.point) * 1.25);

    // Panier.
    const linesCount = rng.weighted([[1, 3], [2, 4], [3, 2], [4, 1]] as const);
    const chosen = new Set<string>();
    const items: OrderItem[] = [];
    for (let l = 0; l < linesCount; l += 1) {
      const product = rng.weighted(r.products.map((p) => [p, p.popularity] as const));
      if (chosen.has(product.id)) continue;
      chosen.add(product.id);
      const quantity = rng.chance(0.82) ? 1 : 2;
      const options: OrderItem['options'] = [];
      for (const g of product.groups) {
        const picks = g.min > 0 ? g.min : rng.chance(0.3) ? 1 : 0;
        for (const option of rng.shuffle(g.options).slice(0, picks)) {
          options.push({ optionId: option.id, groupId: g.id, groupName: g.name, name: option.name, priceCents: option.priceCents, quantity: 1 });
        }
      }
      const optionsPriceCents = options.reduce((s, o) => s + o.priceCents * o.quantity, 0);
      items.push({
        lineId: `l${l + 1}`,
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        unitPriceCents: product.priceCents,
        quantity,
        options,
        optionsPriceCents,
        totalCents: (product.priceCents + optionsPriceCents) * quantity,
        vatCategory: product.vat,
        containsAlcohol: false,
        comment: rng.chance(0.08) ? rng.pick(['Sans oignon, merci.', 'Bien cuit s’il vous plaît.', 'Sauce à part.']) : null,
        adjustment: null,
      });
    }

    // Paiement, pourboire, promotion, majoration.
    const hour = Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(placedAt));
    const lunch = hour < 15;
    const paymentMethod: PaymentMethod = rng.weighted([
      ['card', 55],
      ['apple_pay', 17],
      ['google_pay', 13],
      ['cash', fulfillment === 'delivery' ? 7 : 0],
      ['meal_voucher', r.countryId === 'FR' && lunch && weekday(day) < 5 ? 10 : 0],
    ] as const);
    const tipCents = fulfillment === 'delivery' && deliveredBy === 'platform' && paymentMethod !== 'cash' && rng.chance(0.34) ? rng.pick([100, 100, 200, 200, 300, 500]) : 0;
    let promotion: PromotionInput | undefined;
    let promotionId: string | null = null;
    let promoCode: string | null = null;
    if (firstOrder && rng.chance(0.55)) {
      promotion = { kind: 'percentage', value: 2000, maxDiscountCents: 800, minSubtotalCents: 1500, funding: 'platform' };
      promotionId = 'promo-bienvenue20';
      promoCode = 'BIENVENUE20';
    } else if (rng.chance(0.05)) {
      promotion = { kind: 'fixed', value: 300, minSubtotalCents: 2000, funding: 'restaurant' };
      promotionId = `promo-${r.seed.id}`;
    } else if (fulfillment === 'delivery' && r.seed.cityId === 'metz' && weekday(day) === 1 && rng.chance(0.4)) {
      promotion = { kind: 'free_delivery', value: 0, minSubtotalCents: 2000, funding: 'shared', restaurantShareBps: 5000 };
      promotionId = 'promo-mardi-metz';
    }
    const peak = (weekday(day) === 4 || weekday(day) === 5) && hour >= 19 && hour < 22;
    const surge = fulfillment === 'delivery' && deliveredBy === 'platform' && peak ? { multiplierBps: 12000, courierBonusCents: 100 } : undefined;

    const quote = computeQuote(
      {
        lines: items.map((i) => ({ unitPriceCents: i.unitPriceCents, optionsPriceCents: i.optionsPriceCents, quantity: i.quantity, vatCategory: i.vatCategory })),
        fulfillment,
        deliveredBy,
        distanceMeters,
        deliveryFeeOverrideCents: deliveredBy === 'restaurant' && fulfillment === 'delivery' ? 250 : undefined,
        surge,
        promotion,
        tipCents,
      },
      config,
    );
    if (quote.issues.includes('promo_minimum_not_reached')) {
      promotion = undefined;
      promotionId = null;
      promoCode = null;
    }
    if (!quote.ok) return;
    sequence += 1;
    const number = formatOrderNumber(sequence);
    const id = `o-${sequence}`;
    for (const item of items) {
      const key = `${r.seed.id}/${item.productId}`;
      outcome.productSales.set(key, (outcome.productSales.get(key) ?? 0) + item.quantity);
    }

    // Statut et chronologie.
    const minutesAgo = (ctx.now.getTime() - placedAt.getTime()) / 60_000;
    const prep = Math.max(6, Math.round(rng.normal(r.seed.prepMinutes, 4)));
    const travel = fulfillment === 'delivery' ? Math.max(5, Math.round(distanceMeters / 260 + rng.int(2, 6))) : 0;
    const acceptedAt = minutesAfter(placedAt, rng.float(0.6, 3.5));
    const readyAt = minutesAfter(acceptedAt, prep);
    const assignedAt = minutesAfter(readyAt, -rng.int(2, 7));
    const pickedAt = minutesAfter(readyAt, rng.float(1, 6));
    const deliveredAt = fulfillment === 'delivery' ? minutesAfter(pickedAt, travel) : minutesAfter(readyAt, rng.int(3, 18));
    const promisedFrom = minutesAfter(placedAt, r.seed.etaMinutes.min);
    const promisedTo = minutesAfter(placedAt, r.seed.etaMinutes.max);
    const totalMinutes = (deliveredAt.getTime() - placedAt.getTime()) / 60_000;

    let status: OrderStatus = 'delivered';
    let cancelReason: CancelReason | null = null;
    if (minutesAgo < totalMinutes) {
      const steps: Array<[OrderStatus, Date]> = [['new', placedAt], ['accepted', acceptedAt], ['preparing', minutesAfter(acceptedAt, 0.5)], ['ready', readyAt]];
      if (fulfillment === 'delivery' && deliveredBy === 'platform') steps.splice(3, 0, ['assigned', assignedAt]);
      if (fulfillment === 'delivery') steps.push(['picked_up', pickedAt]);
      status = steps.filter(([, at]) => at <= ctx.now).pop()?.[0] ?? 'new';
    } else {
      const roll = rng.next();
      if (roll < 0.022) cancelReason = 'customer_request';
      else if (roll < 0.037) cancelReason = 'restaurant_rejected';
      else if (roll < 0.047) cancelReason = 'item_unavailable';
      else if (roll < 0.055) cancelReason = 'restaurant_timeout';
      else if (roll < 0.06 && fulfillment === 'delivery') cancelReason = 'no_driver_available';
      if (cancelReason) status = 'cancelled';
    }
    const isDelivered = status === 'delivered';
    const isCancelled = status === 'cancelled';
    const late = isDelivered && deliveredAt > promisedTo && fulfillment === 'delivery';
    const lateMinutes = late ? Math.round((deliveredAt.getTime() - promisedTo.getTime()) / 60_000) : 0;

    // Livreur.
    let driver: DriverRuntime | null = null;
    if (fulfillment === 'delivery' && status !== 'new' && status !== 'accepted' && !(isCancelled && cancelReason !== 'no_driver_available' && rng.chance(0.8))) {
      if (deliveredBy === 'platform') {
        const pool = (platformDrivers.get(r.seed.cityId) ?? []).filter((d) => d.status === 'active' || d.createdAt < placedAt);
        driver = pool.length ? rng.pick(pool) : null;
      } else {
        const own = drivers.filter((d) => d.restaurantIds.includes(r.seed.id));
        driver = own.length ? rng.pick(own) : null;
      }
      if (cancelReason === 'no_driver_available') driver = null;
      if (status === 'preparing' && deliveredBy === 'platform') driver = null;
    }

    // Répartition financière (commandes livrées).
    const commissionBps = fulfillment === 'pickup' ? r.commission.pickup : deliveredBy === 'platform' ? r.commission.platform : r.commission.own;
    const settlement = computeSettlement(
      {
        quote,
        paymentMethod,
        commissionBps,
        courier: fulfillment === 'delivery' && deliveredBy === 'platform' ? { distanceMeters, durationMinutes: travel } : undefined,
        surgeCourierBonusCents: surge?.courierBonusCents,
      },
      config,
    );

    // Remboursement partiel éventuel.
    let refundCents = 0;
    let refundCause: RefundCause | null = null;
    if (isDelivered && minutesAgo > 90 && rng.chance(late && lateMinutes > 20 ? 0.35 : 0.025)) {
      refundCause = late && lateMinutes > 20 ? 'delivery_late' : rng.pick(['missing_item', 'food_quality', 'missing_item'] as const);
      const line = items[0];
      refundCents = refundCause === 'delivery_late' ? Math.min(500, quote.totalCents) : refundCause === 'missing_item' && line ? line.unitPriceCents + line.optionsPriceCents : Math.round(quote.subtotalCents / 2);
    }
    const cancelRefund = isCancelled ? quote.totalCents : 0;
    let restaurantChargeCents = 0;
    const refunded = refundCents > 0 || isCancelled;

    // Client et restaurant : agrégats.
    if (isDelivered) {
      client.stats.orders += 1;
      client.stats.spent += quote.totalCents - refundCents;
      client.stats.first ??= placedAt;
      client.stats.last = placedAt;
      if (refundCents > 0) client.stats.refunds += 1;
      if ((ordersPerClient.get(client.uid) ?? 0) >= 3) client.favorites.add(r.seed.id);
    } else if (isCancelled) {
      client.stats.cancelled += 1;
    }
    const customerName = publicDisplayName(client.firstName, client.lastName);
    const events: Array<Omit<OrderEvent, 'at'> & { at: Date }> = [];
    const timeline: Order['timeline'] = { placedAt: ts(placedAt) };
    const push = (to: OrderStatus, at: Date, from: OrderStatus | null, actor: OrderEvent['actor'], message: string | null = null) => {
      if (at > ctx.now) return;
      timeline[to] = ts(at);
      events.push({ type: 'status_changed', from, to, actor, actorId: null, actorName: null, message, data: null, visibleToCustomer: true, at });
    };
    events.push({ type: 'created', from: null, to: 'new', actor: 'customer', actorId: client.uid, actorName: customerName, message: null, data: null, visibleToCustomer: true, at: placedAt });
    timeline.new = ts(placedAt);
    const STATUS_ORDER = ['new', 'accepted', 'preparing', 'assigned', 'ready', 'picked_up', 'delivered'] as const;
    const reached = (s: OrderStatus) => isDelivered || (!isCancelled && STATUS_ORDER.indexOf(s as (typeof STATUS_ORDER)[number]) <= STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]));
    if (isCancelled) {
      const cancelAt = cancelReason === 'restaurant_timeout' ? minutesAfter(placedAt, 5) : minutesAfter(placedAt, rng.float(1, 6));
      if (cancelReason === 'customer_request' || cancelReason === 'no_driver_available') push('accepted', acceptedAt, 'new', 'restaurant');
      push('cancelled', cancelAt, timeline.accepted ? 'accepted' : 'new', cancelReason === 'customer_request' ? 'customer' : cancelReason === 'restaurant_timeout' || cancelReason === 'no_driver_available' ? 'system' : 'restaurant', null);
    } else {
      if (reached('accepted')) push('accepted', acceptedAt, 'new', 'restaurant');
      if (reached('preparing')) push('preparing', minutesAfter(acceptedAt, 0.5), 'accepted', 'restaurant');
      if (driver && deliveredBy === 'platform' && reached('assigned')) {
        timeline.assigned = ts(assignedAt);
        events.push({ type: 'driver_assigned', from: null, to: null, actor: 'system', actorId: null, actorName: null, message: `${publicDisplayName(driver.firstName, driver.lastName)} prend en charge la commande.`, data: { driverId: driver.uid }, visibleToCustomer: true, at: assignedAt });
      }
      if (reached('ready')) push('ready', readyAt, 'preparing', 'restaurant');
      if (fulfillment === 'delivery' && reached('picked_up')) push('picked_up', pickedAt, 'ready', 'driver');
      if (isDelivered) {
        push('delivered', deliveredAt, fulfillment === 'delivery' ? 'picked_up' : 'ready', fulfillment === 'delivery' ? 'driver' : 'restaurant');
        if (fulfillment === 'delivery') events.push({ type: 'delivery_proof', from: null, to: null, actor: 'driver', actorId: driver?.uid ?? null, actorName: null, message: 'Commande remise en main propre.', data: null, visibleToCustomer: true, at: deliveredAt });
      }
    }

    const order: Order = {
      number,
      countryId: r.countryId,
      cityId: r.seed.cityId,
      restaurantId: r.seed.id,
      restaurantName: r.seed.name,
      restaurantGroupId: r.seed.groupId ?? null,
      customerId: client.uid,
      customerName,
      customerPhoneMasked: maskPhone(client.phone),
      status,
      fulfillment,
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
        walletAppliedCents: 0,
        totalCents: quote.totalCents,
        chargedCents: quote.totalCents,
        refundedCents: refundCents + cancelRefund,
        itemsVat: quote.itemsVat,
        currency: 'EUR',
      },
      payment: {
        method: paymentMethod,
        status: isCancelled ? (paymentMethod === 'cash' ? 'cancelled' : 'refunded') : refundCents > 0 ? 'partially_refunded' : paymentMethod === 'cash' && !isDelivered ? 'pending' : 'paid',
        paymentId: `pay-${id}`,
        label: paymentMethod === 'card' ? client.cardLabel : null,
        paidAt: paymentMethod === 'cash' ? (isDelivered ? ts(deliveredAt) : null) : ts(placedAt),
      },
      promotionId,
      promoCode,
      delivery:
        fulfillment === 'delivery'
          ? {
              address: { line1: address.line1, line2: null, postalCode: address.postalCode, city: address.city, countryCode: address.countryCode, geo: null, geohash: null, placeId: null, label: address.label, details: null, instructions: null },
              geo: { latitude: address.point.lat, longitude: address.point.lng },
              zoneId: r.zoneIds[0] ?? null,
              distanceMeters,
              deliveredBy,
              driverId: driver?.uid ?? null,
              driverName: driver ? publicDisplayName(driver.firstName, driver.lastName) : null,
              driverPhoneMasked: driver ? maskPhone(driver.phone) : null,
              driverVehicle: driver?.vehicle ?? null,
              promisedFrom: ts(promisedFrom),
              promisedTo: ts(promisedTo),
              estimatedArrivalAt: ts(isDelivered ? deliveredAt : minutesAfter(placedAt, (r.seed.etaMinutes.min + r.seed.etaMinutes.max) / 2)),
              proof: isDelivered ? { type: 'handover', value: null, at: ts(deliveredAt) } : null,
              handoverCodeRequired: quote.totalCents > 6000,
            }
          : null,
      pickupCode: fulfillment === 'pickup' ? generateFourDigitCode(() => rng.next()) : null,
      pickupVerified: fulfillment === 'pickup' && isDelivered,
      customerNote: rng.chance(0.1) ? rng.pick(['Merci de ne pas sonner, bébé qui dort.', 'Code porte 2580B.', 'Laisser devant la porte.']) : null,
      scheduledFor: null,
      prepMinutes: prep,
      prepExtendedMinutes: 0,
      containsAlcohol: false,
      ageConfirmed: false,
      timeline,
      acceptDeadline: ts(minutesAfter(placedAt, 5)),
      cancellation: isCancelled && cancelReason
        ? {
            reason: cancelReason,
            details: null,
            by: cancelReason === 'customer_request' ? 'customer' : cancelReason === 'restaurant_timeout' || cancelReason === 'no_driver_available' ? 'system' : 'restaurant',
            byUid: cancelReason === 'customer_request' ? client.uid : null,
            at: timeline.cancelled ?? ts(placedAt),
            refundCents: cancelRefund,
          }
        : null,
      flags: { late, lateMinutes, refunded, disputed: refundCause === 'food_quality', fraudSuspected: client.uid === 'seed-client-017' && refundCents > 0, firstOrder },
      reviewId: null,
      ticketIds: [],
      conversationId: null,
      source: { app: rng.weighted([['client_ios', 5], ['client_android', 4], ['client_web', 1]] as const), appVersion: '1.4.0' },
      driverId: driver?.uid ?? null,
      searchKeywords: buildSearchKeywords(number, customerName, r.seed.name),
      createdAt: ts(placedAt),
      updatedAt: ts(events[events.length - 1]?.at ?? placedAt),
    };

    // Avis.
    let review: Review | null = null;
    if (isDelivered && minutesAgo > 120 && rng.chance(0.32)) {
      const base = r.seed.rating + (late ? -0.9 : 0) + (refundCents > 0 ? -1.4 : 0);
      const rating = Math.max(1, Math.min(5, Math.round(rng.normal(base, 0.55)))) as 1 | 2 | 3 | 4 | 5;
      const flagged = index % 97 === 0;
      review = {
        orderId: id,
        restaurantId: r.seed.id,
        driverId: deliveredBy === 'platform' ? (driver?.uid ?? null) : null,
        customerId: client.uid,
        customerDisplayName: customerName,
        countryId: r.countryId,
        cityId: r.seed.cityId,
        restaurantRating: rating,
        driverRating: deliveredBy === 'platform' && driver ? (Math.max(3, Math.min(5, Math.round(rng.normal(4.7, 0.5)))) as 3 | 4 | 5) : null,
        comment: rng.chance(0.65) ? (flagged ? 'Service nul, appelez-moi au 06 12 34 56 78 pour en parler.' : rng.pick(REVIEW_COMMENTS[rating])) : null,
        tags: rating >= 4 ? ['bon_rapport_qualite_prix'] : ['temperature'],
        status: flagged ? 'pending_moderation' : 'published',
        autoModeration: flagged ? { flagged: true, reasons: ['personal_data'] } : { flagged: false, reasons: [] },
        moderation: null,
        reply: rating <= 3 && rng.chance(0.6) ? { text: 'Merci pour votre retour, nous sommes désolés. Nous en avons parlé en cuisine pour que cela ne se reproduise pas.', by: r.ownerUid, at: ts(minutesAfter(deliveredAt, 300)), status: 'published' } : null,
        reportsCount: flagged ? 1 : 0,
        createdAt: ts(minutesAfter(deliveredAt, rng.int(20, 240))),
        updatedAt: ts(minutesAfter(deliveredAt, rng.int(20, 300))),
      };
      order.reviewId = id;
      outcome.reviewsCount += 1;
      const stats = outcome.restaurantStats.get(r.seed.id) ?? { orders: 0, ratings: [] };
      stats.ratings.push(rating);
      outcome.restaurantStats.set(r.seed.id, stats);
      if (driver && review.driverRating) driver.stats.ratings.push(review.driverRating);
    }
    const stats = outcome.restaurantStats.get(r.seed.id) ?? { orders: 0, ratings: [] };
    if (isDelivered) stats.orders += 1;
    outcome.restaurantStats.set(r.seed.id, stats);

    // ------------------------------------------------------------ Écritures
    w.set(w.doc(`${COLLECTIONS.orders}/${id}`), order);
    if (review) w.set(w.doc(`${COLLECTIONS.reviews}/${id}`), review);
    if (placedAt >= parisTime(addDays(ctx.today, -EVENTS_DAYS), 0)) {
      events.forEach((e, i) => w.set(w.doc(`${COLLECTIONS.orders}/${id}/${SUBCOLLECTIONS.orders.events}/e${String(i + 1).padStart(2, '0')}`), { ...e, at: ts(e.at) }));
    }
    const payment: Payment = {
      countryId: r.countryId,
      cityId: r.seed.cityId,
      purpose: 'order',
      orderId: id,
      subscriptionId: null,
      invoiceId: null,
      payerType: 'client',
      payerId: client.uid,
      restaurantId: r.seed.id,
      method: paymentMethod,
      amountCents: quote.totalCents,
      currency: 'EUR',
      status: order.payment.status,
      provider: paymentMethod === 'cash' ? 'cash' : 'stripe',
      providerIntentId: paymentMethod === 'cash' ? null : `pi_seed_${sequence}`,
      providerChargeId: paymentMethod === 'cash' ? null : `ch_seed_${sequence}`,
      cardFingerprint: null,
      cardLabel: order.payment.label ?? null,
      feeCents: settlement.payment.totalCents,
      failureCode: null,
      failureMessage: null,
      attempts: 1,
      refundedCents: refundCents + cancelRefund,
      createdAt: ts(placedAt),
      updatedAt: order.updatedAt,
    };
    w.set(w.doc(`${COLLECTIONS.payments}/pay-${id}`), payment);

    const bookingDate = parisDay(isDelivered ? deliveredAt : placedAt);
    const ledger = (suffix: string, entry: Omit<LedgerEntry, 'currency' | 'bookingDate' | 'createdAt' | 'createdBy' | 'countryId' | 'cityId' | 'orderId'>) => {
      const doc: LedgerEntry = { ...entry, currency: 'EUR', bookingDate, orderId: id, countryId: r.countryId, cityId: r.seed.cityId, createdAt: ts(isDelivered ? deliveredAt : placedAt), createdBy: 'system' };
      w.set(w.doc(`${COLLECTIONS.ledgerEntries}/${id}-${suffix}`), doc);
    };
    const weekStart = addDays(bookingDate, -weekday(bookingDate));
    const restaurantPayoutId = `po-r-${r.seed.id}-${weekStart}`;
    const driverPayoutId = driver ? `po-d-${driver.uid}-${weekStart}` : null;

    if (isDelivered) {
      const financials: OrderFinancials = {
        orderId: id,
        orderNumber: number,
        countryId: r.countryId,
        cityId: r.seed.cityId,
        restaurantId: r.seed.id,
        driverId: driver?.uid ?? null,
        commissionBps,
        commissionSource: r.commission.source === 'negotiated' ? 'negotiated' : 'plan',
        settlement,
        refunds: [],
        finalMarginCents: settlement.platform.marginCents,
        restaurantPayoutId,
        driverPayoutId,
        deliveredAt: ts(deliveredAt),
        computedAt: ts(deliveredAt),
      };
      ledger('ca', { accountType: 'restaurant', accountId: r.seed.id, type: 'order_revenue', amountCents: settlement.restaurant.grossCents - settlement.restaurant.discountFundedCents + settlement.restaurant.deliveryFeeCents, vatCents: null, payoutId: restaurantPayoutId, description: `Ventes ${number}` });
      ledger('com', { accountType: 'restaurant', accountId: r.seed.id, type: 'commission', amountCents: -settlement.restaurant.commissionTtcCents, vatCents: settlement.restaurant.commissionVatCents, payoutId: restaurantPayoutId, description: `Commission ${number}` });
      if (settlement.courier && driver) {
        ledger('liv', { accountType: 'driver', accountId: driver.uid, type: 'courier_earning', amountCents: settlement.courier.earningsCents, vatCents: null, payoutId: driverPayoutId, description: `Course ${number}` });
        if (settlement.courier.tipCents > 0) ledger('pb', { accountType: 'driver', accountId: driver.uid, type: 'courier_tip', amountCents: settlement.courier.tipCents, vatCents: null, payoutId: driverPayoutId, description: `Pourboire ${number}` });
        const earning: DriverEarning = {
          driverId: driver.uid,
          cityId: r.seed.cityId,
          kind: 'delivery',
          orderId: id,
          breakdown: settlement.courier,
          amountCents: settlement.courier.earningsCents,
          tipCents: settlement.courier.tipCents,
          distanceMeters,
          durationMinutes: travel,
          payoutId: driverPayoutId,
          earnedAt: ts(deliveredAt),
          note: null,
        };
        w.set(w.doc(`${COLLECTIONS.driverEarnings}/${id}`), earning);
      }
      if (paymentMethod === 'cash' && driver) {
        ledger('esp', { accountType: 'driver_cash', accountId: driver.uid, type: 'cash_collected', amountCents: -quote.totalCents, vatCents: null, payoutId: driverPayoutId, description: `Espèces encaissées ${number}` });
      }
      if (refundCents > 0 && refundCause) {
        const allocation = allocateRefund(refundCents, refundCause);
        restaurantChargeCents = allocation.restaurantCents;
        const refundId = `rf-${id}`;
        const refund: Refund = {
          orderId: id,
          orderNumber: number,
          countryId: r.countryId,
          cityId: r.seed.cityId,
          customerId: client.uid,
          restaurantId: r.seed.id,
          driverId: driver?.uid ?? null,
          ticketId: null,
          amountCents: refundCents,
          method: refundCause === 'delivery_late' ? 'wallet_credit' : 'original_payment',
          cause: refundCause,
          allocation,
          items: refundCause === 'missing_item' ? [{ lineId: 'l1', quantity: 1, amountCents: refundCents }] : null,
          status: 'processed',
          automatic: refundCause === 'delivery_late',
          reason: refundCause === 'delivery_late' ? `Retard de ${lateMinutes} minutes` : refundCause === 'missing_item' ? 'Article manquant signalé par le client' : 'Qualité du plat contestée',
          requestedBy: refundCause === 'delivery_late' ? 'system' : client.uid,
          requestedAt: ts(minutesAfter(deliveredAt, 25)),
          approvedBy: refundCause === 'delivery_late' ? 'system' : 'test-support',
          approvedAt: ts(minutesAfter(deliveredAt, 40)),
          rejectionReason: null,
          providerRefundId: refundCause === 'delivery_late' ? null : `re_seed_${sequence}`,
          creditNoteId: null,
          processedAt: ts(minutesAfter(deliveredAt, 42)),
        };
        w.set(w.doc(`${COLLECTIONS.refunds}/${refundId}`), refund);
        financials.refunds.push({ refundId, amountCents: refundCents, restaurantCents: allocation.restaurantCents, courierCents: allocation.courierCents, platformCents: allocation.platformCents });
        financials.finalMarginCents -= allocation.platformCents;
        if (allocation.restaurantCents > 0) ledger('rb', { accountType: 'restaurant', accountId: r.seed.id, type: 'refund_charge', amountCents: -allocation.restaurantCents, vatCents: null, payoutId: restaurantPayoutId, refundId, description: `Remboursement imputé ${number}` });
        outcome.refundsCount += 1;
      }
      w.set(w.doc(`${COLLECTIONS.orderFinancials}/${id}`), financials);
      if (promotionId && quote.discount.totalCents > 0) {
        const redemption: PromotionRedemption = {
          promotionId,
          code: promoCode,
          userId: client.uid,
          orderId: id,
          restaurantId: r.seed.id,
          cityId: r.seed.cityId,
          discountCents: quote.discount.totalCents,
          platformFundedCents: quote.discount.platformFundedCents,
          restaurantFundedCents: quote.discount.restaurantFundedCents,
          status: 'applied',
          createdAt: ts(placedAt),
        };
        w.set(w.doc(`${COLLECTIONS.promotionRedemptions}/${id}`), redemption);
      }

      // Livreur : statistiques et journées.
      if (driver) {
        driver.stats.deliveries += 1;
        driver.stats.minutes += Math.round((deliveredAt.getTime() - (timeline.assigned?.toDate() ?? pickedAt).getTime()) / 60_000);
        if (!late) driver.stats.onTime += 1;
        if (settlement.courier) {
          driver.stats.earnings += settlement.courier.earningsCents;
          driver.stats.tips += settlement.courier.tipCents;
        }
        const dd = driver.days.get(day) ?? { deliveries: 0, minutes: 0, earnings: 0, first: pickedAt, last: deliveredAt };
        dd.deliveries += 1;
        dd.minutes += travel + 8;
        dd.earnings += settlement.courier?.earningsCents ?? 0;
        if (pickedAt < dd.first) dd.first = pickedAt;
        if (deliveredAt > dd.last) dd.last = deliveredAt;
        driver.days.set(day, dd);
        const ck = `${r.seed.id}/${driver.uid}`;
        const courier = couriers.get(ck) ?? {
          rid: r.seed.id,
          driverId: driver.uid,
          displayName: publicDisplayName(driver.firstName, driver.lastName),
          relation: driver.type === 'restaurant' ? 'own' : 'platform',
          status: 'active',
          note: null,
          deliveriesCount: 0,
          lastDeliveryAt: null,
          updatedAt: ts(deliveredAt),
          updatedBy: 'system',
        };
        courier.deliveriesCount += 1;
        courier.lastDeliveryAt = ts(deliveredAt);
        courier.updatedAt = ts(deliveredAt);
        couriers.set(ck, courier);
      }
    }

    // CRM restaurant.
    const crmKey = `${r.seed.id}/${client.uid}`;
    const fiche = crm.get(crmKey) ?? {
      rid: r.seed.id,
      userId: client.uid,
      displayName: customerName,
      phoneMasked: maskPhone(client.phone),
      blocked: false,
      blockedReason: null,
      internalNote: null,
      tags: [],
      ordersCount: 0,
      totalSpentCents: 0,
      averageBasketCents: 0,
      firstOrderAt: null,
      lastOrderAt: null,
      updatedAt: ts(placedAt),
    };
    const newCustomerForRestaurant = fiche.ordersCount === 0;
    if (isDelivered) {
      fiche.ordersCount += 1;
      fiche.totalSpentCents += quote.subtotalCents;
      fiche.averageBasketCents = Math.round(fiche.totalSpentCents / fiche.ordersCount);
      fiche.firstOrderAt ??= ts(placedAt);
      fiche.lastOrderAt = ts(placedAt);
      fiche.updatedAt = ts(placedAt);
      if (fiche.ordersCount >= 6) fiche.tags = ['Fidèle'];
    }
    crm.set(crmKey, fiche);

    // Agrégats du jour : restaurant.
    const rdKey = `${r.seed.id}/${day}`;
    const rd = restaurantDaily.get(rdKey) ?? {
      day,
      ordersCount: 0,
      deliveredCount: 0,
      cancelledCount: 0,
      rejectedCount: 0,
      lateCount: 0,
      salesCents: 0,
      netPayoutCents: 0,
      commissionCents: 0,
      discountFundedCents: 0,
      averageBasketCents: 0,
      averagePrepMinutes: 0,
      byMode: {},
      byPayment: {},
      byHour: Array.from({ length: 24 }, () => 0),
      newCustomers: 0,
      updatedAt: ctx.nowTs,
    };
    rd.ordersCount += 1;
    rd.byHour[hour] = (rd.byHour[hour] ?? 0) + 1;
    rd.byMode[fulfillment] = (rd.byMode[fulfillment] ?? 0) + 1;
    if (newCustomerForRestaurant && isDelivered) rd.newCustomers += 1;
    if (isCancelled) {
      rd.cancelledCount += 1;
      if (cancelReason === 'restaurant_rejected' || cancelReason === 'restaurant_timeout') rd.rejectedCount += 1;
    }
    if (isDelivered) {
      rd.deliveredCount += 1;
      if (late) rd.lateCount += 1;
      rd.salesCents += quote.subtotalCents;
      rd.netPayoutCents += settlement.restaurant.payoutCents;
      rd.commissionCents += settlement.restaurant.commissionHtCents;
      rd.discountFundedCents += settlement.restaurant.discountFundedCents;
      rd.averageBasketCents = Math.round(rd.salesCents / rd.deliveredCount);
      rd.averagePrepMinutes = Math.round((rd.averagePrepMinutes * (rd.deliveredCount - 1) + prep) / rd.deliveredCount);
      rd.byPayment[paymentMethod] = (rd.byPayment[paymentMethod] ?? 0) + quote.totalCents;
    }
    restaurantDaily.set(rdKey, rd);

    // Agrégats du jour : plateforme, pays, ville.
    for (const [scope, scopeId] of [['platform', 'all'], ['country', r.countryId], ['city', r.seed.cityId]] as const) {
      const key = `${scope}_${scopeId}_${dayKey(day)}`;
      const s = platformDaily.get(key) ?? emptyDaily(scope, scopeId, scope === 'city' ? r.seed.cityId : null, day, ctx);
      s.orders.placed += 1;
      s.orders.byHour[hour] = (s.orders.byHour[hour] ?? 0) + 1;
      s.orders.byMode[fulfillment] = (s.orders.byMode[fulfillment] ?? 0) + 1;
      if (isCancelled) {
        s.orders.cancelled += 1;
        if (cancelReason === 'restaurant_rejected') s.orders.rejected += 1;
      }
      if (isDelivered) {
        s.orders.delivered += 1;
        if (late) s.orders.late += 1;
        s.revenue.gmvCents += quote.totalCents;
        s.revenue.restaurantSalesCents += quote.subtotalCents;
        s.revenue.commissionHtCents += settlement.platform.commissionHtCents;
        s.revenue.feesHtCents += settlement.platform.serviceFeeHtCents + settlement.platform.smallOrderFeeHtCents + settlement.platform.deliveryFeeHtCents;
        s.revenue.promoCostCents += settlement.platform.promoCostCents;
        s.revenue.refundsCents += refundCents;
        s.revenue.courierCostCents += settlement.platform.courierCostCents;
        s.revenue.paymentFeesCents += settlement.platform.paymentCostCents;
        s.revenue.marginCents += settlement.platform.marginCents;
        s.revenue.averageBasketCents = Math.round(s.revenue.gmvCents / s.orders.delivered);
        const n = s.orders.delivered;
        s.delivery.averagePrepMinutes = Math.round((s.delivery.averagePrepMinutes * (n - 1) + prep) / n);
        if (fulfillment === 'delivery') {
          s.delivery.averageMinutes = Math.round((s.delivery.averageMinutes * (n - 1) + totalMinutes) / n);
          s.delivery.averageDistanceMeters = Math.round((s.delivery.averageDistanceMeters * (n - 1) + distanceMeters) / n);
        }
        s.delivery.onTimeRate = Math.round(((n - s.orders.late) / n) * 1000) / 1000;
        if (firstOrder) s.actors.customersNew += 1;
        s.actors.customersActive += 1;
      }
      platformDaily.set(key, s);
    }

    outcome.orders.push({
      id,
      number,
      restaurantId: r.seed.id,
      restaurantName: r.seed.name,
      customerId: client.uid,
      customerName,
      driverId: driver?.uid ?? null,
      cityId: r.seed.cityId,
      countryId: r.countryId,
      status,
      placedAt,
      deliveredAt: isDelivered ? deliveredAt : null,
      totalCents: quote.totalCents,
      fulfillment,
      refunded,
      late,
      settlement: isDelivered ? settlement : null,
      commissionBps,
      promotionId: quote.discount.totalCents > 0 ? promotionId : null,
      restaurantChargeCents,
      quote,
      paymentMethod,
    });
  });

  // 3. Agrégats.
  for (const [key, rd] of restaurantDaily) {
    const [rid] = key.split('/');
    w.set(w.doc(`${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.dailyStats}/${dayKey(rd.day)}`), rd);
  }
  for (const [key, s] of platformDaily) {
    s.funnel = { appOpens: s.orders.placed * 11, restaurantViews: s.orders.placed * 6, addToCart: Math.round(s.orders.placed * 2.1), checkoutStarted: Math.round(s.orders.placed * 1.35), paid: s.orders.placed };
    s.actors.restaurantsActive = new Set(outcome.orders.filter((o) => parisDay(o.placedAt) === s.day && (s.scope === 'platform' || o.countryId === s.scopeId || o.cityId === s.scopeId)).map((o) => o.restaurantId)).size;
    w.set(w.doc(`${COLLECTIONS.statsDaily}/${key}`), s);
  }
  for (const f of crm.values()) {
    const { rid, ...fiche } = f;
    if (fiche.ordersCount === 0) continue;
    w.set(w.doc(`${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.customers}/${fiche.userId}`), fiche);
  }
  for (const c of couriers.values()) {
    const { rid, ...courier } = c;
    w.set(w.doc(`${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.couriers}/${courier.driverId}`), courier);
  }
  return outcome;
}

function emptyDaily(scope: DailyStats['scope'], scopeId: string, cityId: string | null, day: string, ctx: SeedContext): DailyStats {
  return {
    scope,
    scopeId,
    cityId,
    day,
    orders: { placed: 0, delivered: 0, cancelled: 0, rejected: 0, late: 0, byMode: {}, byHour: Array.from({ length: 24 }, () => 0) },
    revenue: {
      gmvCents: 0, restaurantSalesCents: 0, commissionHtCents: 0, feesHtCents: 0, subscriptionsHtCents: 0, promoCostCents: 0,
      refundsCents: 0, courierCostCents: 0, paymentFeesCents: 0, marginCents: 0, averageBasketCents: 0,
    },
    delivery: { averageMinutes: 0, averagePrepMinutes: 0, onTimeRate: 1, averageDistanceMeters: 0 },
    actors: { restaurantsActive: 0, restaurantsNew: 0, customersNew: 0, customersActive: 0, driversNew: 0, driversOnlinePeak: 0 },
    funnel: { appOpens: 0, restaurantViews: 0, addToCart: 0, checkoutStarted: 0, paid: 0 },
    support: { ticketsOpened: 0, ticketsResolved: 0, averageResolutionMinutes: 0 },
    updatedAt: ctx.nowTs,
  };
}
