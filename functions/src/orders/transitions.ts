// Avancement des commandes : acceptation (avec temps de préparation), début de
// préparation, commande prête, prolongation, remise au client par code,
// récupération et livraison par le livreur, confirmation du paiement.
import { COLLECTIONS, PREP_MINUTES_MAX, PREP_MINUTES_MIN, type Order, type OrderStatus } from '@golink/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { GeoPoint } from 'firebase-admin/firestore';
import { db, Timestamp } from '../lib/admin';
import { ordersCallable as callable } from './runtime';
import { fail } from '../lib/errors';
import { requireAuth } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { z, zId } from '../lib/validation';
import { cancelBySystem } from './cancel';
import { addEvent, eventActorOf, loadMarket, loadOrder, loadOrderRules, orderRef, requireOrderStaff, type EventActor, type NewEvent } from './context';
import { readDriver, releaseDriverInTransaction } from './dispatch';
import { capturePayment, refreshIntentStatus } from './payment';

const orderIdSchema = z.object({ orderId: zId });

/** Vérifie et applique une transition dans une transaction (statut relu). */
async function transition(
  orderId: string,
  actor: EventActor,
  expected: readonly OrderStatus[],
  build: (order: Order, at: Timestamp) => {
    to: OrderStatus;
    fields?: Record<string, unknown>;
    message?: string | null;
    data?: Record<string, string | number | boolean | null> | null;
    /** Événements complémentaires (code vérifié…). */
    extra?: NewEvent[];
  },
): Promise<Order> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef(orderId));
    const order = snap.data() as Order | undefined;
    if (!order) throw fail.notFound('Commande');
    if (!expected.includes(order.status)) {
      throw fail.precondition(order.status === 'cancelled' ? 'Cette commande a été annulée.' : 'Cette commande a déjà changé d’étape. La liste vient d’être actualisée.');
    }
    const at = Timestamp.now();
    const step = build(order, at);
    tx.update(snap.ref, { status: step.to, [`timeline.${step.to}`]: at, updatedAt: at, ...(step.fields ?? {}) });
    for (const event of step.extra ?? []) addEvent(tx, orderId, actor, event, at);
    addEvent(tx, orderId, actor, { type: 'status_changed', from: order.status, to: step.to, visibleToCustomer: true, message: step.message ?? null, data: step.data ?? null }, at);
    return order;
  });
}

/** Acceptation par le restaurant : encaissement puis lancement de la préparation. */
export const acceptOrder = callable(
  z.object({ orderId: zId, prepMinutes: z.number().int().min(PREP_MINUTES_MIN).max(PREP_MINUTES_MAX) }),
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    const actor = await requireOrderStaff(request, order, 'orders.manage');
    if (order.status !== 'new') throw fail.precondition('Cette commande a déjà été traitée.');
    if (order.payment.status === 'requires_action' || order.payment.status === 'pending' && order.payment.method !== 'cash') {
      throw fail.precondition('Le paiement du client n’est pas encore confirmé.');
    }
    // L'encaissement précède l'acceptation : un paiement refusé annule la commande.
    const paymentStatus = await capturePayment(data.orderId, order);
    if (paymentStatus === 'failed') {
      await cancelBySystem(data.orderId, 'payment_failed', 'Encaissement refusé par la banque du client.');
      throw fail.precondition('Le paiement du client a été refusé : la commande est annulée et le client prévenu.');
    }
    const eventActor = eventActorOf(actor);
    await transition(data.orderId, eventActor, ['new'], (current, at) => {
      const readyAt = at.toMillis() + data.prepMinutes * 60_000;
      const travel = current.delivery ? Math.max(5, Math.round(current.delivery.distanceMeters / 250) + 3) : 0;
      return {
        to: 'preparing',
        fields: {
          'timeline.accepted': at,
          prepMinutes: data.prepMinutes,
          acceptDeadline: null,
          'payment.status': paymentStatus,
          ...(paymentStatus === 'paid' && !current.payment.paidAt ? { 'payment.paidAt': at } : {}),
          ...(current.delivery
            ? {
                'delivery.promisedFrom': Timestamp.fromMillis(readyAt + travel * 60_000),
                'delivery.promisedTo': Timestamp.fromMillis(readyAt + (travel + 10) * 60_000),
                'delivery.estimatedArrivalAt': Timestamp.fromMillis(readyAt + (travel + 5) * 60_000),
              }
            : {}),
        },
        message: `Commande acceptée · prête dans ${data.prepMinutes} min environ.`,
        data: { prepMinutes: data.prepMinutes },
      };
    });
    return { status: 'preparing' as const };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

/** Commande acceptée (programmée) : lancement de la préparation. */
export const startPreparation = callable(orderIdSchema, async (data, request) => {
  const order = await loadOrder(data.orderId);
  const actor = await requireOrderStaff(request, order, 'orders.manage');
  await transition(data.orderId, eventActorOf(actor), ['accepted'], () => ({ to: 'preparing', message: 'Préparation lancée.' }));
  return { status: 'preparing' as const };
});

/** Commande prête : au comptoir (retrait, sur place) ou en attente du livreur. */
export const markOrderReady = callable(orderIdSchema, async (data, request) => {
  const order = await loadOrder(data.orderId);
  const actor = await requireOrderStaff(request, order, 'orders.manage');
  if (Object.values(order.itemProposals ?? {}).some((p) => p.status === 'pending')) {
    throw fail.precondition('Un remplacement attend la réponse du client : patientez avant de marquer la commande prête.');
  }
  let next: OrderStatus = 'ready';
  await transition(data.orderId, eventActorOf(actor), ['accepted', 'preparing'], (current, at) => {
    // Livreur déjà attribué : la commande l'attend directement.
    next = current.fulfillment === 'delivery' && current.driverId ? 'assigned' : 'ready';
    return {
      to: next,
      fields: next === 'assigned' ? { 'timeline.ready': at } : {},
      message: current.fulfillment === 'delivery' ? 'Commande prête, en attente du livreur.' : 'Commande prête : le client peut venir la chercher.',
    };
  });
  return { status: next };
});

/** Allonge la préparation en cours (dans la limite des règles). */
export const extendPrepTime = callable(
  z.object({ orderId: zId, minutes: z.number().int().min(1).max(60) }),
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    const actor = await requireOrderStaff(request, order, 'orders.manage');
    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    const total = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef(data.orderId));
      const current = snap.data() as Order;
      if (!['accepted', 'preparing'].includes(current.status)) throw fail.precondition('La préparation n’est plus en cours.');
      const extended = current.prepExtendedMinutes + data.minutes;
      if (extended > rules.maxPrepExtensionMinutes) {
        throw fail.precondition(`Vous pouvez prolonger une préparation de ${rules.maxPrepExtensionMinutes} minutes au plus.`);
      }
      const at = Timestamp.now();
      const shift = data.minutes * 60_000;
      const delivery = current.delivery;
      tx.update(snap.ref, {
        prepExtendedMinutes: extended,
        updatedAt: at,
        ...(delivery?.promisedTo ? { 'delivery.promisedTo': Timestamp.fromMillis(delivery.promisedTo.toMillis() + shift) } : {}),
        ...(delivery?.promisedFrom ? { 'delivery.promisedFrom': Timestamp.fromMillis(delivery.promisedFrom.toMillis() + shift) } : {}),
        ...(delivery?.estimatedArrivalAt ? { 'delivery.estimatedArrivalAt': Timestamp.fromMillis(delivery.estimatedArrivalAt.toMillis() + shift) } : {}),
      });
      addEvent(tx, data.orderId, eventActorOf(actor), {
        type: 'prep_time_extended',
        from: null,
        to: null,
        visibleToCustomer: true,
        message: `Préparation prolongée de ${data.minutes} min.`,
        data: { minutes: data.minutes, totalExtended: extended },
      }, at);
      return extended;
    });
    return { prepExtendedMinutes: total };
  },
);

function sameCode(expected: string | null | undefined, given: string): boolean {
  return Boolean(expected) && expected?.trim().toUpperCase() === given.trim().toUpperCase();
}

/** Remise au client en retrait : le code communiqué au client est vérifié. */
export const confirmPickup = callable(
  z.object({ orderId: zId, code: z.string().trim().min(1, 'Saisissez le code communiqué au client.').max(12) }),
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    const actor = await requireOrderStaff(request, order, 'orders.manage');
    if (order.fulfillment === 'delivery') throw fail.precondition('Cette commande est remise par le livreur.');
    if (order.status !== 'ready') throw fail.precondition('La commande doit être prête avant d’être remise au client.');
    if (!order.pickupCode) throw fail.precondition('Aucun code de retrait n’est enregistré pour cette commande.');
    if (!sameCode(order.pickupCode, data.code)) throw fail.invalid('Ce code ne correspond pas à la commande.');
    const eventActor = eventActorOf(actor);
    await transition(data.orderId, eventActor, ['ready'], (current, at) => ({
      to: 'delivered',
      fields: {
        pickupVerified: true,
        ...(current.payment.method === 'cash' ? { 'payment.status': 'paid', 'payment.paidAt': at } : {}),
      },
      message: 'Commande remise au client.',
      extra: [{ type: 'pickup_code_verified', from: null, to: null, visibleToCustomer: false, message: 'Code de retrait vérifié.', data: null }],
    }));
    if (order.payment.method === 'cash' && order.payment.paymentId) {
      await db.collection(COLLECTIONS.payments).doc(order.payment.paymentId).set({ status: 'paid', updatedAt: Timestamp.now() }, { merge: true });
    }
    return { status: 'delivered' as const };
  },
);

/** Le livreur a récupéré la commande au restaurant. */
export const markOrderPickedUp = callable(orderIdSchema, async (data, request) => {
  const order = await loadOrder(data.orderId);
  const eventActor = await courierActor(request, order);
  if (order.fulfillment !== 'delivery' || !order.driverId) throw fail.precondition('Aucun livreur n’est attribué à cette commande.');
  await transition(data.orderId, eventActor, ['assigned', 'ready'], (current, at) => ({
    to: 'picked_up',
    fields: current.timeline.assigned ? {} : { 'timeline.assigned': at },
    message: 'Commande récupérée par le livreur.',
  }));
  return { status: 'picked_up' as const };
});

/** Acteur autorisé pour les étapes du livreur : le livreur attribué, ou le restaurant pour ses propres livreurs. */
export async function courierActor(request: CallableRequest<unknown>, order: Order): Promise<EventActor> {
  const caller = requireAuth(request);
  if (order.driverId && caller.uid === order.driverId) return { type: 'driver', uid: caller.uid, name: order.delivery?.driverName ?? caller.name };
  const actor = await requireOrderStaff(request, order, 'orders.manage');
  if (actor.kind === 'member' && order.delivery?.deliveredBy !== 'restaurant') {
    throw fail.precondition('Cette étape est validée par le livreur GoLink.');
  }
  return eventActorOf(actor);
}

/**
 * Clôture : livraison remise au client (livreur, code demandé si requis) ou
 * commande sur place servie (restaurant).
 */
export const completeOrder = callable(
  z.object({
    orderId: zId,
    code: z.string().trim().max(12).nullish(),
    /** Position du livreur au moment de la remise (§28, détection « hors adresse »). */
    geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  }),
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    let eventActor: EventActor;
    let expected: OrderStatus[];
    if (order.fulfillment === 'delivery') {
      eventActor = await courierActor(request, order);
      expected = ['picked_up'];
      if (order.delivery?.handoverCodeRequired && eventActor.type === 'driver' && !sameCode(order.pickupCode, data.code ?? '')) {
        throw fail.invalid('Code de remise incorrect : demandez au client le code affiché dans son application.');
      }
    } else if (order.fulfillment === 'dine_in') {
      eventActor = eventActorOf(await requireOrderStaff(request, order, 'orders.manage'));
      expected = ['ready'];
    } else {
      throw fail.precondition('Une commande à emporter se remet avec le code de retrait du client.');
    }
    const lateTolerance = (await loadOrderRules(await loadMarket(order.countryId, order.cityId))).lateToleranceMinutes ?? 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef(data.orderId));
      const current = snap.data() as Order;
      if (!expected.includes(current.status)) throw fail.precondition('Cette commande a déjà changé d’étape.');
      const driverState = current.driverId ? await readDriver(tx, current.driverId) : null;
      const at = Timestamp.now();
      const promisedTo = current.delivery?.promisedTo?.toMillis() ?? null;
      const lateMinutes = promisedTo ? Math.max(0, Math.round((at.toMillis() - promisedTo) / 60_000)) : 0;
      tx.update(snap.ref, {
        status: 'delivered',
        'timeline.delivered': at,
        updatedAt: at,
        'flags.late': lateMinutes > lateTolerance,
        'flags.lateMinutes': lateMinutes,
        ...(current.payment.method === 'cash' ? { 'payment.status': 'paid', 'payment.paidAt': at } : {}),
        ...(current.delivery
          ? {
              'delivery.proof': {
                type: current.delivery.handoverCodeRequired ? 'code' : 'handover',
                value: null,
                at,
                geo: data.geo ? new GeoPoint(data.geo.lat, data.geo.lng) : null,
              },
              'delivery.estimatedArrivalAt': at,
            }
          : {}),
      });
      addEvent(tx, data.orderId, eventActor, {
        type: 'status_changed',
        from: current.status,
        to: 'delivered',
        visibleToCustomer: true,
        message: current.fulfillment === 'delivery' ? 'Commande livrée.' : 'Commande servie.',
        data: lateMinutes > 0 ? { lateMinutes } : null,
      }, at);
      if (current.driverId && driverState) releaseDriverInTransaction(tx, current.driverId, data.orderId, driverState.driver, driverState.location);
    });
    if (order.payment.method === 'cash' && order.payment.paymentId) {
      await db.collection(COLLECTIONS.payments).doc(order.payment.paymentId).set({ status: 'paid', updatedAt: Timestamp.now() }, { merge: true });
    }
    return { status: 'delivered' as const };
  },
);

/** Après une authentification forte (3-D Secure) dans l'app : la commande est transmise au restaurant. */
export const confirmOrderPayment = callable(
  orderIdSchema,
  async (data, request) => {
    const caller = requireAuth(request);
    const order = await loadOrder(data.orderId);
    if (order.customerId !== caller.uid) throw fail.forbidden();
    if (order.payment.status !== 'requires_action' && order.payment.status !== 'pending') return { status: order.payment.status };
    const snap = order.payment.paymentId ? await db.collection(COLLECTIONS.payments).doc(order.payment.paymentId).get() : null;
    const intentId = snap?.get('providerIntentId') as string | undefined;
    if (!intentId) throw fail.precondition('Paiement introuvable.');
    const status = await refreshIntentStatus(intentId);
    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(orderRef(data.orderId))).data() as Order;
      const at = Timestamp.now();
      const ready = status === 'authorized' || status === 'paid';
      tx.update(orderRef(data.orderId), {
        'payment.status': status,
        updatedAt: at,
        ...(ready && current.status === 'new' ? { acceptDeadline: Timestamp.fromMillis(at.toMillis() + rules.acceptanceTimeoutSeconds * 1000) } : {}),
      });
      addEvent(tx, data.orderId, { type: 'customer', uid: caller.uid, name: order.customerName }, { type: 'payment_updated', from: null, to: null, visibleToCustomer: true, message: ready ? 'Paiement confirmé.' : 'Paiement non confirmé.', data: { status } }, at);
    });
    await snap?.ref.set({ status, updatedAt: Timestamp.now() }, { merge: true });
    return { status };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);
