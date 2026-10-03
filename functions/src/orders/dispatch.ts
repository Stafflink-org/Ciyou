// Attribution des livreurs. Version simple : le livreur Ciyou Eats disponible le plus
// proche du restaurant est attribué directement (proposition acceptée tracée dans
// dispatchOffers). Le dispatch avancé (propositions, élargissement du rayon) peut
// remplacer `dispatchOrder` en conservant la même signature.
import { logger } from 'firebase-functions/v2';
import { assertDriverCanTakeOrder } from '../finance/argent/cash';
import {
  buildSearchKeywords,
  COLLECTIONS,
  SUBCOLLECTIONS,
  VEHICLE_LABELS,
  computeCourierPay,
  haversineMeters,
  maskPhone,
  publicDisplayName,
  type DispatchOffer,
  type Driver,
  type DriverLocation,
  type Order,
  type RequestCourierResult,
  type Restaurant,
  type RestaurantCourier,
} from '@golink/shared';
import type { Transaction } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { ordersCallable as callable } from './runtime';
import { advancedDispatchEnabled, advancedDispatchOrder } from './dispatch-advanced';
import { fail } from '../lib/errors';
import { requireAuth } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import {
  addEvent,
  eventActorOf,
  loadDispatchRules,
  loadMarket,
  loadOrder,
  orderRef,
  orderViewerUids,
  pricingFor,
  requireOrderStaff,
  SYSTEM_EVENT_ACTOR,
  type EventActor,
} from './context';

/** Statuts depuis lesquels un livreur peut être attribué. */
const ASSIGNABLE: readonly Order['status'][] = ['accepted', 'preparing', 'ready'];

function driverRef(driverId: string) {
  return db.collection(COLLECTIONS.drivers).doc(driverId);
}

function locationRef(driverId: string) {
  return db.collection(COLLECTIONS.driverLocations).doc(driverId);
}

/**
 * Attribue le livreur dans la transaction : commande, profil et position du
 * livreur (lecteurs autorisés : client et personnel du restaurant), événement.
 */
export async function assignInTransaction(
  tx: Transaction,
  input: { orderId: string; driverId: string; actor: EventActor; viewers: string[]; distanceMeters: number | null; offer?: Omit<DispatchOffer, 'status' | 'respondedAt'> },
): Promise<{ assigned: boolean; driverName: string }> {
  const [orderSnap, driverSnap, locationSnap] = await tx.getAll(orderRef(input.orderId), driverRef(input.driverId), locationRef(input.driverId));
  const order = orderSnap.data() as Order | undefined;
  const driver = driverSnap.data() as Driver | undefined;
  if (!order || !driver) throw fail.notFound('Commande ou livreur');
  if (order.driverId) return { assigned: false, driverName: order.delivery?.driverName ?? '' };
  if (!ASSIGNABLE.includes(order.status)) throw fail.precondition('Cette commande ne peut plus recevoir de livreur.');
  if (driver.status !== 'active') throw fail.precondition('Ce livreur n’est pas actif.');
  const at = Timestamp.now();
  const driverName = publicDisplayName(driver.firstName, driver.lastName);
  const toAssigned = order.status === 'ready';
  // §8 cahier : la recherche « Toutes les commandes » doit aussi trouver une commande
  // par nom de livreur — le livreur n'est connu qu'à l'attribution, donc ses mots-clés
  // sont ajoutés ici (fusionnés, pas remplacés, pour garder numéro/client/commerce/adresse).
  const searchKeywords = [...new Set([...(order.searchKeywords ?? []), ...buildSearchKeywords(driverName)])];

  tx.update(orderSnap.ref, {
    driverId: input.driverId,
    'delivery.driverId': input.driverId,
    'delivery.driverName': driverName,
    'delivery.driverPhoneMasked': driver.phone ? maskPhone(driver.phone) : null,
    'delivery.driverVehicle': VEHICLE_LABELS[driver.vehicle.type] ?? null,
    'delivery.dispatchStatus': 'assigned',
    'timeline.assigned': at,
    searchKeywords,
    ...(toAssigned ? { status: 'assigned' } : {}),
    updatedAt: at,
  });
  tx.update(driverSnap.ref, {
    activeOrderIds: FieldValue.arrayUnion(input.orderId),
    availability: 'on_delivery',
    updatedAt: at,
  });
  if (locationSnap.exists) {
    tx.update(locationSnap.ref, {
      activeOrderIds: FieldValue.arrayUnion(input.orderId),
      availability: 'on_delivery',
      visibleTo: [...new Set([...(((locationSnap.data() as DriverLocation).visibleTo) ?? []), order.customerId, ...input.viewers])],
    });
  }
  if (input.offer) {
    const offer: DispatchOffer = { ...input.offer, status: 'accepted', respondedAt: at };
    tx.set(db.collection(COLLECTIONS.dispatchOffers).doc(), offer);
  }
  addEvent(tx, input.orderId, input.actor, {
    type: 'driver_assigned',
    from: toAssigned ? order.status : null,
    to: toAssigned ? 'assigned' : null,
    visibleToCustomer: true,
    message: `${driverName} prend en charge la commande.`,
    data: { driverId: input.driverId, distanceMeters: input.distanceMeters },
  }, at);
  return { assigned: true, driverName };
}

/** Retire la commande du livreur (livraison terminée ou annulée), dans la transaction. */
export function releaseDriverInTransaction(tx: Transaction, driverId: string, orderId: string, driver: Driver | undefined, location: DriverLocation | undefined): void {
  const remaining = (driver?.activeOrderIds ?? []).filter((id) => id !== orderId);
  if (driver) {
    tx.update(driverRef(driverId), {
      activeOrderIds: FieldValue.arrayRemove(orderId),
      ...(remaining.length === 0 && driver.availability === 'on_delivery' ? { availability: 'online' } : {}),
      updatedAt: Timestamp.now(),
    });
  }
  if (location) {
    tx.update(locationRef(driverId), {
      activeOrderIds: FieldValue.arrayRemove(orderId),
      ...(remaining.length === 0 ? { visibleTo: [], availability: location.availability === 'on_delivery' ? 'online' : location.availability } : {}),
    });
  }
}

/** Lecture (dans la transaction) du livreur et de sa position avant libération. */
export async function readDriver(tx: Transaction, driverId: string): Promise<{ driver: Driver | undefined; location: DriverLocation | undefined }> {
  const [d, l] = await tx.getAll(driverRef(driverId), locationRef(driverId));
  return { driver: d.data() as Driver | undefined, location: l.data() as DriverLocation | undefined };
}

/**
 * Recherche et attribue le livreur Ciyou Eats disponible le plus proche. Interface
 * stable pour le module de dispatch avancé. Ne lève pas d'erreur si personne
 * n'est disponible : la commande passe en « aucun livreur disponible ».
 */
export async function dispatchOrder(orderId: string, actor: EventActor = SYSTEM_EVENT_ACTOR): Promise<RequestCourierResult> {
  // Moteur avancé (tours, élargissement, propositions successives) sauf si le super admin choisit le moteur simple.
  if (await advancedDispatchEnabled()) {
    const advanced = await advancedDispatchOrder(orderId, actor);
    return { assigned: advanced.assigned, driverName: advanced.driverName, distanceMeters: advanced.distanceMeters };
  }
  const order = await loadOrder(orderId);
  if (order.fulfillment !== 'delivery' || !order.delivery) throw fail.precondition('Cette commande ne nécessite pas de livreur.');
  if (order.delivery.deliveredBy !== 'platform') throw fail.precondition('Cette commande est livrée par vos propres livreurs.');
  if (order.driverId) return { assigned: true, driverName: order.delivery.driverName ?? null, distanceMeters: null };
  if (!ASSIGNABLE.includes(order.status)) throw fail.precondition('Cette commande ne peut plus recevoir de livreur.');

  const [restaurantSnap, market, blockedSnap] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).get(),
    loadMarket(order.countryId, order.cityId),
    db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).collection(SUBCOLLECTIONS.restaurants.couriers).where('status', '==', 'blocked').get(),
  ]);
  const restaurant = restaurantSnap.data() as Restaurant;
  const rules = await loadDispatchRules(market);
  const origin = restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : null;
  if (!origin) throw fail.precondition('L’adresse du restaurant n’est pas géolocalisée.');
  const blocked = new Set(blockedSnap.docs.map((d) => d.id));

  const locations = await db.collection(COLLECTIONS.driverLocations).where('cityId', '==', order.cityId).where('availability', '==', 'online').get();
  const candidates = locations.docs
    .filter((d) => !blocked.has(d.id))
    .map((d) => {
      const l = d.data() as DriverLocation;
      return { id: d.id, distance: haversineMeters(origin, { lat: l.position.latitude, lng: l.position.longitude }) };
    })
    .filter((c) => c.distance <= rules.maxRadiusMeters)
    .sort((a, b) => a.distance - b.distance);

  const viewers = await orderViewerUids(order.restaurantId);
  const pricing = pricingFor(order.countryId, market);
  const at = Timestamp.now();
  await orderRef(orderId).update({
    'delivery.courierRequestedAt': order.delivery.courierRequestedAt ?? at,
    'delivery.dispatchStatus': 'searching',
    'delivery.dispatchAttempts': FieldValue.increment(1),
    updatedAt: at,
  });

  for (const candidate of candidates.slice(0, 8)) {
    const driverSnap = await driverRef(candidate.id).get();
    const driver = driverSnap.data() as Driver | undefined;
    if (!driver || driver.status !== 'active' || driver.type !== 'platform') continue;
    if (driver.activeOrderIds.length >= rules.maxConcurrentOrdersPerDriver) continue;
    if (order.payment.method === 'cash' && !driver.acceptsCash) continue;
    // Distance maximale choisie par le livreur (docs/DECISIONS_CLIENT.md) : déjà vérifiée par le
    // moteur avancé (dispatch-advanced.ts), oubliée ici — ce moteur simple reste sélectionnable
    // (settings/dispatch.engine).
    if (driver.maxDistanceMeters && candidate.distance + (order.delivery?.distanceMeters ?? 0) > driver.maxDistanceMeters) continue;
    const result = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(driverRef(candidate.id));
      const d = fresh.data() as Driver | undefined;
      if (!d || d.availability !== 'online' || d.activeOrderIds.length > 0) return null;
      const deliveryDistanceMeters = order.delivery?.distanceMeters ?? 0;
      const estimatedMinutes = Math.round((candidate.distance + deliveryDistanceMeters) / 250);
      // Estimation de gain (par ville) : mêmes paramètres que le règlement final, y compris le
      // bonus heure de pointe (`isPeak`, distinct de `courierSurgeBonusCents` — voir même
      // correctif dans dispatch-advanced.ts::offerFor).
      const pay = computeCourierPay(
        {
          distanceMeters: candidate.distance + deliveryDistanceMeters,
          durationMinutes: estimatedMinutes,
          surgeBonusCents: order.delivery?.courierSurgeBonusCents ?? 0,
          isPeak: order.delivery?.courierIsPeak === true,
          tipCents: order.amounts.tipCents,
        },
        pricing,
      );
      return assignInTransaction(tx, {
        orderId,
        driverId: candidate.id,
        actor,
        viewers,
        distanceMeters: candidate.distance,
        offer: {
          orderId,
          driverId: candidate.id,
          restaurantId: order.restaurantId,
          cityId: order.cityId ?? restaurant.cityId,
          zoneId: order.delivery?.zoneId ?? null,
          round: 1,
          distanceToRestaurantMeters: candidate.distance,
          deliveryDistanceMeters,
          estimatedPayCents: pay.totalCents,
          estimatedMinutes,
          offeredAt: at,
          expiresAt: Timestamp.fromMillis(at.toMillis() + rules.offerTimeoutSeconds * 1000),
        },
      });
    });
    if (result?.assigned) return { assigned: true, driverName: result.driverName, distanceMeters: candidate.distance };
  }

  await orderRef(orderId).update({ 'delivery.dispatchStatus': 'unavailable', updatedAt: Timestamp.now() });
  return { assigned: false, driverName: null, distanceMeters: null };
}

/** Demande manuelle d'un livreur Ciyou Eats depuis le back-office. */
export const requestCourier = callable(z.object({ orderId: zId }), async (data, request): Promise<RequestCourierResult> => {
  const order = await loadOrder(data.orderId);
  const actor = await requireOrderStaff(request, order, 'orders.manage');
  return dispatchOrder(data.orderId, eventActorOf(actor));
});

/** Attribution d'un livreur propre du restaurant (livraisons assurées par le restaurant). */
export const assignOwnCourier = callable(z.object({ orderId: zId, driverId: zId }), async (data, request) => {
  const order = await loadOrder(data.orderId);
  const actor = await requireOrderStaff(request, order, 'orders.manage');
  if (order.fulfillment !== 'delivery' || order.delivery?.deliveredBy !== 'restaurant') {
    throw fail.precondition('Cette commande est livrée par un livreur Ciyou Eats.');
  }
  const [courierSnap, driverSnap] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).collection(SUBCOLLECTIONS.restaurants.couriers).doc(data.driverId).get(),
    driverRef(data.driverId).get(),
  ]);
  const courier = courierSnap.data() as RestaurantCourier | undefined;
  const driver = driverSnap.data() as Driver | undefined;
  if (!courier || courier.relation !== 'own' || courier.status !== 'active') throw fail.precondition('Ce livreur ne fait pas partie de vos livreurs actifs.');
  if (!driver || driver.type !== 'restaurant' || !driver.restaurantIds.includes(order.restaurantId)) throw fail.precondition('Ce livreur ne fait pas partie de vos livreurs.');
  // Commande payée en espèces : le livreur doit y être autorisé et sa caisse rester sous le plafond.
  await assertDriverCanTakeOrder(data.driverId, order);
  const viewers = await orderViewerUids(order.restaurantId);
  const result = await db.runTransaction((tx) =>
    assignInTransaction(tx, { orderId: data.orderId, driverId: data.driverId, actor: eventActorOf(actor), viewers, distanceMeters: null }),
  );
  if (!result.assigned) throw fail.precondition('Un livreur est déjà attribué à cette commande.');
  return { driverName: result.driverName };
});

/**
 * Le livreur annule lui-même son acceptation avant de récupérer la commande (app
 * livreur, écran de détail après acceptation — document client « Points à corriger »,
 * App livreur §1). Possible uniquement tant qu'il n'a pas encore récupéré la commande
 * ; la recherche d'un autre livreur Ciyou Eats repart ensuite automatiquement, comme
 * après un refus d'offre (`respondToOffer`). Les livreurs propres du restaurant
 * (`deliveredBy: 'restaurant'`) ne passent pas par ce flux.
 */
export const cancelDriverAssignment = callable(z.object({ orderId: zId }), async (data, request) => {
  const caller = requireAuth(request);
  const order = await loadOrder(data.orderId);
  if (order.driverId !== caller.uid) throw fail.forbidden();
  if (order.fulfillment !== 'delivery' || order.delivery?.deliveredBy !== 'platform') {
    throw fail.precondition('Cette commande n’est pas livrée par la flotte Ciyou Eats.');
  }
  if (order.status !== 'assigned') throw fail.precondition('Vous ne pouvez plus annuler : la commande a déjà été récupérée.');
  const actor: EventActor = { type: 'driver', uid: caller.uid, name: order.delivery?.driverName ?? caller.name };

  await db.runTransaction(async (tx) => {
    const state = await readDriver(tx, caller.uid);
    const fresh = (await tx.get(orderRef(data.orderId))).data() as Order;
    if (fresh.driverId !== caller.uid) throw fail.precondition('Cette commande ne vous est plus attribuée.');
    if (fresh.status !== 'assigned') throw fail.precondition('Vous ne pouvez plus annuler : la commande a déjà été récupérée.');
    // Offre marquée « cancelled » (et non laissée « accepted ») pour que le moteur de dispatch
    // avancé l'exclue de la relance immédiate (`previousOffers`, dispatch-advanced.ts) — sans
    // quoi, livreur unique disponible sur la ville, il se retrouverait réattribué à lui-même.
    // Si aucune offre n'existe pour ce livreur sur cette commande (attribution directe, sans
    // passer par le cycle offre/acceptation), une offre « cancelled » est créée pour porter
    // cette exclusion malgré tout.
    const acceptedOffers = await tx.get(
      db.collection(COLLECTIONS.dispatchOffers).where('orderId', '==', data.orderId).where('driverId', '==', caller.uid).where('status', '==', 'accepted'),
    );
    const at = Timestamp.now();
    if (acceptedOffers.empty) {
      tx.set(db.collection(COLLECTIONS.dispatchOffers).doc(), {
        orderId: data.orderId,
        driverId: caller.uid,
        restaurantId: fresh.restaurantId,
        cityId: fresh.cityId,
        zoneId: fresh.delivery?.zoneId ?? null,
        round: fresh.delivery?.dispatchRound ?? 1,
        status: 'cancelled',
        distanceToRestaurantMeters: 0,
        deliveryDistanceMeters: fresh.delivery?.distanceMeters ?? 0,
        estimatedPayCents: 0,
        estimatedMinutes: 0,
        offeredAt: at,
        expiresAt: at,
        respondedAt: at,
      });
    } else {
      for (const doc of acceptedOffers.docs) tx.update(doc.ref, { status: 'cancelled', respondedAt: at });
    }
    releaseDriverInTransaction(tx, caller.uid, data.orderId, state.driver, state.location);
    tx.update(orderRef(data.orderId), {
      driverId: null,
      'delivery.driverId': null,
      'delivery.driverName': null,
      'delivery.driverPhoneMasked': null,
      'delivery.driverVehicle': null,
      'delivery.dispatchStatus': null,
      'delivery.dispatchRound': 0,
      'delivery.dispatchOfferId': null,
      status: 'ready',
      updatedAt: at,
    });
    addEvent(tx, data.orderId, actor, {
      type: 'driver_unassigned',
      from: 'assigned',
      to: 'ready',
      visibleToCustomer: false,
      message: 'Le livreur a annulé son acceptation.',
      data: { driverId: caller.uid },
    }, at);
  });

  await advancedDispatchOrder(data.orderId, SYSTEM_EVENT_ACTOR).catch((error: unknown) =>
    logger.warn('Relance après annulation du livreur impossible', { orderId: data.orderId, error: String(error) }),
  );
  return { status: 'ready' as const };
});
