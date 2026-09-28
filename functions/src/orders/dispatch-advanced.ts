// Attribution avancée des courses (cahier §6, « Attribution des courses ») :
// - règles plateforme, surchargées par ville puis par zone ;
// - tours successifs à rayon croissant autour du commerce (élargissement) ;
// - préférences du livreur (distance maximale choisie, zones), note minimale,
//   livreurs bloqués par le commerce, espèces, capacité (commandes simultanées) ;
// - mode « attribution directe » (le meilleur livreur est attribué) ou
//   « propositions successives » (un livreur à la fois, délai pour accepter,
//   puis le suivant ; la tâche planifiée fait avancer les propositions expirées).
// Interface identique à `dispatchOrder` du module commandes, qui délègue ici.
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  VEHICLE_LABELS,
  computeCourierPay,
  dispatchRadiusForRound,
  formatDistance,
  haversineMeters,
  maskPhone,
  publicDisplayName,
  resolveDispatchRules,
  type AdminDispatchOrderResult,
  type City,
  type DispatchCandidate,
  type DispatchOffer,
  type DispatchRules,
  type Driver,
  type DriverLocation,
  type MarketPricingConfig,
  type Order,
  type PlatformAlert,
  type Restaurant,
  type Zone,
} from '@golink/shared';
import type { Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { fail } from '../lib/errors';
import { isFeatureOn } from '../lib/features';
import { addEvent, loadMarket, orderRef, orderViewerUids, pricingFor, SYSTEM_EVENT_ACTOR, type EventActor } from './context';

/** Statuts depuis lesquels un livreur peut être attribué. */
export const DISPATCHABLE: readonly Order['status'][] = ['accepted', 'preparing', 'ready'];

/** Vitesse moyenne retenue pour estimer la durée d'une course (m/min, ≈ 15 km/h). */
const METERS_PER_MINUTE = 250;

export interface DispatchContext {
  order: Order;
  restaurant: Restaurant;
  rules: DispatchRules;
  origin: { lat: number; lng: number };
  pricing: MarketPricingConfig;
}

/** Règles applicables à une commande : plateforme → ville → zone. */
export async function loadRulesForOrder(order: Order): Promise<DispatchRules> {
  const [settings, city, zone] = await Promise.all([
    db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.dispatch).get(),
    order.cityId ? db.collection(COLLECTIONS.cities).doc(order.cityId).get() : Promise.resolve(null),
    order.delivery?.zoneId ? db.collection(COLLECTIONS.zones).doc(order.delivery.zoneId).get() : Promise.resolve(null),
  ]);
  return resolveDispatchRules(
    settings.exists ? (settings.data() as Partial<DispatchRules>) : null,
    city?.exists ? ((city.data() as City).dispatch ?? null) : null,
    zone?.exists ? ((zone.data() as Zone).dispatch ?? null) : null,
  );
}

async function loadContext(orderId: string): Promise<DispatchContext> {
  const snap = await orderRef(orderId).get();
  if (!snap.exists) throw fail.notFound('Commande');
  const order = snap.data() as Order;
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).get();
  const restaurant = restaurantSnap.data() as Restaurant;
  const geo = restaurant?.address?.geo;
  if (!geo) throw fail.precondition('L’adresse du commerce n’est pas géolocalisée.');
  const market = await loadMarket(order.countryId, order.cityId);
  return {
    order,
    restaurant,
    rules: await loadRulesForOrder(order),
    origin: { lat: geo.latitude, lng: geo.longitude },
    pricing: pricingFor(order.countryId, market),
  };
}

/**
 * Évalue tous les livreurs de la ville pour une commande : distance au commerce,
 * éligibilité et motif d'exclusion. Trié du meilleur au moins bon.
 */
export async function evaluateCandidates(ctx: DispatchContext, excluded: ReadonlySet<string> = new Set()): Promise<Array<DispatchCandidate & { score: number }>> {
  const { order, rules, origin } = ctx;
  const availabilities = rules.strategy === 'batched' ? ['online', 'on_delivery'] : ['online'];
  const [locations, blockedSnap] = await Promise.all([
    db.collection(COLLECTIONS.driverLocations).where('cityId', '==', order.cityId).where('availability', 'in', availabilities).get(),
    db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).collection(SUBCOLLECTIONS.restaurants.couriers).where('status', '==', 'blocked').get(),
  ]);
  const blocked = new Set(blockedSnap.docs.map((d) => d.id));
  const drivers = locations.empty ? [] : await db.getAll(...locations.docs.map((d) => db.collection(COLLECTIONS.drivers).doc(d.id)));
  const byId = new Map(drivers.map((d) => [d.id, d.data() as Driver | undefined]));
  const deliveryDistance = order.delivery?.distanceMeters ?? 0;
  const zoneId = order.delivery?.zoneId ?? null;

  return locations.docs
    .map((doc) => {
      const location = doc.data() as DriverLocation;
      const driver = byId.get(doc.id);
      const distance = Math.round(haversineMeters(origin, { lat: location.position.latitude, lng: location.position.longitude }));
      const rating = driver?.rating?.average ?? 0;
      const active = driver?.activeOrderIds?.length ?? 0;
      let reason: string | null = null;
      if (!driver) reason = 'Profil introuvable';
      else if (driver.status !== 'active') reason = 'Compte inactif';
      else if (driver.type !== 'platform') reason = 'Livreur salarié d’un commerce';
      else if (driver.blocked) reason = 'Compte bloqué';
      else if (blocked.has(doc.id)) reason = 'Bloqué par ce commerce';
      else if (excluded.has(doc.id)) reason = 'A déjà décliné ou laissé expirer';
      else if (active >= rules.maxConcurrentOrdersPerDriver) reason = 'Capacité atteinte';
      else if (order.payment.method === 'cash' && !driver.acceptsCash) reason = 'N’accepte pas les espèces';
      else if (rules.minDriverRating && driver.rating.count >= 5 && rating < rules.minDriverRating) reason = 'Note insuffisante';
      else if (driver.maxDistanceMeters && distance + deliveryDistance > driver.maxDistanceMeters) reason = 'Au-delà de sa distance maximale';
      else if (distance > rules.maxRadiusMeters) reason = 'Hors du rayon maximal';
      // Score : distance, pondérée par la note si demandé ; hors de ses zones habituelles, léger malus.
      let score = distance;
      if (rules.strategy === 'nearest_with_rating' && rating > 0) score = distance * (1 + ((5 - rating) / 5) * 0.6);
      if (zoneId && driver?.zoneIds?.length && !driver.zoneIds.includes(zoneId)) score += 400;
      if (active > 0) score += 600 * active;
      return {
        driverId: doc.id,
        displayName: driver ? publicDisplayName(driver.firstName, driver.lastName) : doc.id,
        vehicle: driver?.vehicle.type ?? 'bike',
        availability: location.availability,
        distanceMeters: distance,
        rating,
        activeOrders: active,
        eligible: reason === null,
        excludedBecause: reason,
        score: Math.round(score),
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.score - b.score);
}

/** Livreurs ayant déjà décliné ou laissé expirer une proposition pour cette commande. */
async function previousOffers(orderId: string): Promise<{ excluded: Set<string>; open: (DispatchOffer & { id: string }) | null; count: number }> {
  const snap = await db.collection(COLLECTIONS.dispatchOffers).where('orderId', '==', orderId).get();
  const excluded = new Set<string>();
  let open: (DispatchOffer & { id: string }) | null = null;
  const now = Date.now();
  for (const doc of snap.docs) {
    const offer = doc.data() as DispatchOffer;
    if (offer.status === 'declined' || offer.status === 'expired') excluded.add(offer.driverId);
    if (offer.status === 'offered' && offer.expiresAt.toMillis() > now) open = { id: doc.id, ...offer };
  }
  return { excluded, open, count: snap.size };
}

/**
 * Attribue le livreur dans la transaction : commande, profil et position (lecteurs
 * autorisés : client et personnel du commerce), proposition acceptée, événement.
 */
export async function assignDriverInTransaction(
  tx: Transaction,
  input: { orderId: string; driverId: string; actor: EventActor; viewers: string[]; distanceMeters: number | null; offerRef?: FirebaseFirestore.DocumentReference | null; offer?: Omit<DispatchOffer, 'status' | 'respondedAt'> | null; round: number; allowBusy?: boolean },
): Promise<{ assigned: boolean; driverName: string }> {
  const [orderSnap, driverSnap, locationSnap] = await tx.getAll(
    orderRef(input.orderId),
    db.collection(COLLECTIONS.drivers).doc(input.driverId),
    db.collection(COLLECTIONS.driverLocations).doc(input.driverId),
  );
  const order = orderSnap.data() as Order | undefined;
  const driver = driverSnap.data() as Driver | undefined;
  if (!order || !driver) throw fail.notFound('Commande ou livreur');
  if (order.driverId) return { assigned: false, driverName: order.delivery?.driverName ?? '' };
  if (!DISPATCHABLE.includes(order.status)) throw fail.precondition('Cette commande ne peut plus recevoir de livreur.');
  if (driver.status !== 'active') throw fail.precondition('Ce livreur n’est pas actif.');
  if (!input.allowBusy && driver.availability !== 'online') return { assigned: false, driverName: '' };
  const at = Timestamp.now();
  const driverName = publicDisplayName(driver.firstName, driver.lastName);
  const toAssigned = order.status === 'ready';

  tx.update(orderSnap.ref, {
    driverId: input.driverId,
    'delivery.driverId': input.driverId,
    'delivery.driverName': driverName,
    'delivery.driverPhoneMasked': driver.phone ? maskPhone(driver.phone) : null,
    'delivery.driverVehicle': VEHICLE_LABELS[driver.vehicle.type] ?? null,
    'delivery.dispatchStatus': 'assigned',
    'delivery.dispatchRound': input.round,
    'delivery.dispatchOfferId': null,
    'timeline.assigned': at,
    ...(toAssigned ? { status: 'assigned' } : {}),
    updatedAt: at,
  });
  tx.update(driverSnap.ref, { activeOrderIds: FieldValue.arrayUnion(input.orderId), availability: 'on_delivery', updatedAt: at });
  if (locationSnap.exists) {
    const location = locationSnap.data() as DriverLocation;
    // Interrupteur « Suivi du livreur » (§24) : éteint, le client ne voit pas la position (le commerce garde la vue).
    const clientTracking = await isFeatureOn('driver_tracking', { restaurantId: order.restaurantId, cityId: order.cityId, countryId: order.countryId });
    tx.update(locationSnap.ref, {
      activeOrderIds: FieldValue.arrayUnion(input.orderId),
      availability: 'on_delivery',
      visibleTo: [...new Set([...(location.visibleTo ?? []), ...(clientTracking ? [order.customerId] : []), ...input.viewers])],
    });
  }
  if (input.offerRef) tx.update(input.offerRef, { status: 'accepted', respondedAt: at });
  else if (input.offer) tx.set(db.collection(COLLECTIONS.dispatchOffers).doc(), { ...input.offer, status: 'accepted', respondedAt: at } satisfies DispatchOffer);
  addEvent(tx, input.orderId, input.actor, {
    type: 'driver_assigned',
    from: toAssigned ? order.status : null,
    to: toAssigned ? 'assigned' : null,
    visibleToCustomer: true,
    message: `${driverName} prend en charge la commande.`,
    data: { driverId: input.driverId, distanceMeters: input.distanceMeters, round: input.round },
  }, at);
  return { assigned: true, driverName };
}

function offerFor(ctx: DispatchContext, candidate: DispatchCandidate, round: number, at: Timestamp): Omit<DispatchOffer, 'status' | 'respondedAt'> {
  const delivery = ctx.order.delivery?.distanceMeters ?? 0;
  const totalDistanceMeters = candidate.distanceMeters + delivery;
  const estimatedMinutes = Math.max(5, Math.round(totalDistanceMeters / METERS_PER_MINUTE));
  // Estimation de gain affichée au livreur : mêmes paramètres (par ville) que le règlement
  // final, plus le bonus heure de pointe déjà promis à la commande (zone en surcharge).
  const pay = computeCourierPay(
    {
      distanceMeters: totalDistanceMeters,
      durationMinutes: estimatedMinutes,
      surgeBonusCents: ctx.order.delivery?.courierSurgeBonusCents ?? 0,
      tipCents: ctx.order.amounts.tipCents,
    },
    ctx.pricing,
  );
  return {
    orderId: '',
    driverId: candidate.driverId,
    restaurantId: ctx.order.restaurantId,
    cityId: ctx.order.cityId ?? ctx.restaurant.cityId,
    zoneId: ctx.order.delivery?.zoneId ?? null,
    round,
    distanceToRestaurantMeters: candidate.distanceMeters,
    deliveryDistanceMeters: delivery,
    estimatedPayCents: pay.totalCents,
    estimatedMinutes,
    offeredAt: at,
    expiresAt: Timestamp.fromMillis(at.toMillis() + ctx.rules.offerTimeoutSeconds * 1000),
  };
}

/** Alerte « course sans livreur » (une par commande), résolue à l'attribution. */
async function raiseDispatchAlert(ctx: DispatchContext, orderId: string, rounds: number): Promise<void> {
  const ref = db.collection(COLLECTIONS.platformAlerts).doc(`dispatch_failed_${orderId}`);
  const alert: Omit<PlatformAlert, 'detectedAt'> & { detectedAt: FieldValue } = {
    kind: 'dispatch_failed',
    queue: 'alert',
    severity: ctx.order.status === 'ready' ? 'critical' : 'warning',
    title: `Aucun livreur pour ${ctx.order.number}`,
    message: `${ctx.restaurant.name} : aucun livreur disponible après ${rounds} tour${rounds > 1 ? 's' : ''} jusqu’à ${formatDistance(ctx.rules.maxRadiusMeters)}.`,
    target: { type: 'order', id: orderId, label: ctx.order.number },
    countryId: ctx.order.countryId,
    cityId: ctx.order.cityId,
    metric: { value: rounds, threshold: ctx.rules.maxRounds, unit: 'tours' },
    status: 'open',
    dedupKey: `dispatch_failed_${orderId}`,
    detectedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(alert, { merge: true });
}

async function resolveDispatchAlert(orderId: string): Promise<void> {
  const ref = db.collection(COLLECTIONS.platformAlerts).doc(`dispatch_failed_${orderId}`);
  const snap = await ref.get();
  if (snap.exists && snap.get('status') !== 'resolved') await ref.update({ status: 'resolved', resolvedAt: FieldValue.serverTimestamp() });
}

/**
 * Lance (ou poursuit) l'attribution d'une commande. Ne lève pas d'erreur si
 * personne n'est disponible : la commande passe en « aucun livreur disponible ».
 */
export async function advancedDispatchOrder(orderId: string, actor: EventActor = SYSTEM_EVENT_ACTOR): Promise<AdminDispatchOrderResult> {
  const ctx = await loadContext(orderId);
  const { order, rules } = ctx;
  if (order.fulfillment !== 'delivery' || !order.delivery) throw fail.precondition('Cette commande ne nécessite pas de livreur.');
  if (order.delivery.deliveredBy !== 'platform') throw fail.precondition('Cette commande est livrée par les livreurs du commerce.');
  if (order.driverId) return { assigned: true, driverName: order.delivery.driverName ?? null, distanceMeters: null, offered: false, round: order.delivery.dispatchRound ?? 1 };
  if (!DISPATCHABLE.includes(order.status)) throw fail.precondition('Cette commande ne peut plus recevoir de livreur.');

  const history = await previousOffers(orderId);
  if (rules.mode === 'offers' && history.open) {
    return { assigned: false, driverName: null, distanceMeters: null, offered: true, round: history.open.round };
  }
  const candidates = await evaluateCandidates(ctx, history.excluded);
  const viewers = await orderViewerUids(order.restaurantId);
  const at = Timestamp.now();
  const startRound = Math.max(1, rules.mode === 'offers' ? (order.delivery.dispatchRound ?? 1) : 1);
  await orderRef(orderId).update({
    'delivery.courierRequestedAt': order.delivery.courierRequestedAt ?? at,
    'delivery.dispatchStatus': 'searching',
    'delivery.dispatchAttempts': FieldValue.increment(1),
    updatedAt: at,
  });

  const tried = new Set<string>();
  for (let round = startRound; round <= rules.maxRounds; round += 1) {
    const radius = dispatchRadiusForRound(rules, round);
    const inRadius = candidates.filter((c) => c.eligible && c.distanceMeters <= radius && !tried.has(c.driverId));
    if (rules.mode === 'offers') {
      const next = inRadius[0];
      if (!next) continue;
      const offerRef = db.collection(COLLECTIONS.dispatchOffers).doc();
      const offer: DispatchOffer = { ...offerFor(ctx, next, round, at), orderId, status: 'offered', respondedAt: null };
      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(orderRef(orderId))).data() as Order;
        if (fresh.driverId) return;
        tx.set(offerRef, offer);
        tx.update(orderRef(orderId), {
          'delivery.dispatchRound': round,
          'delivery.dispatchRadiusMeters': radius,
          'delivery.dispatchOfferId': offerRef.id,
          updatedAt: at,
        });
        addEvent(tx, orderId, actor, {
          type: 'note_added',
          visibleToCustomer: false,
          message: `Course proposée à ${next.displayName} (tour ${round}, à ${formatDistance(next.distanceMeters)}).`,
          data: { driverId: next.driverId, round, radiusMeters: radius, offerId: offerRef.id },
        }, at);
      });
      return { assigned: false, driverName: null, distanceMeters: next.distanceMeters, offered: true, round };
    }
    for (const candidate of inRadius.slice(0, 6)) {
      tried.add(candidate.driverId);
      const result = await db
        .runTransaction((tx) =>
          assignDriverInTransaction(tx, {
            orderId,
            driverId: candidate.driverId,
            actor,
            viewers,
            distanceMeters: candidate.distanceMeters,
            offer: { ...offerFor(ctx, candidate, round, at), orderId },
            round,
            allowBusy: rules.strategy === 'batched',
          }),
        )
        .catch((error: unknown) => {
          logger.warn('Attribution refusée', { orderId, driverId: candidate.driverId, error: error instanceof Error ? error.message : String(error) });
          return null;
        });
      if (result?.assigned) {
        await orderRef(orderId).update({ 'delivery.dispatchRadiusMeters': radius });
        await resolveDispatchAlert(orderId);
        return { assigned: true, driverName: result.driverName, distanceMeters: candidate.distanceMeters, offered: false, round };
      }
    }
  }

  await orderRef(orderId).update({
    'delivery.dispatchStatus': 'unavailable',
    'delivery.dispatchRound': rules.maxRounds,
    'delivery.dispatchRadiusMeters': rules.maxRadiusMeters,
    'delivery.dispatchOfferId': null,
    updatedAt: Timestamp.now(),
  });
  await raiseDispatchAlert(ctx, orderId, rules.maxRounds);
  return { assigned: false, driverName: null, distanceMeters: null, offered: false, round: rules.maxRounds };
}

/** Aperçu des candidats pour une commande (fiche commande du super admin). */
export async function previewCandidates(orderId: string): Promise<{ rules: DispatchRules; candidates: DispatchCandidate[] }> {
  const ctx = await loadContext(orderId);
  const history = await previousOffers(orderId);
  const candidates = await evaluateCandidates(ctx, history.excluded);
  return { rules: ctx.rules, candidates: candidates.slice(0, 25).map(({ score: _score, ...c }) => c) };
}

/** L'attribution avancée est-elle active ? (settings/dispatch.engine, défaut : oui) */
export async function advancedDispatchEnabled(): Promise<boolean> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.dispatch).get();
  return (snap.get('engine') as DispatchRules['engine'] | undefined) !== 'simple';
}
