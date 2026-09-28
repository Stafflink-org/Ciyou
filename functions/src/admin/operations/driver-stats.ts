// Performance des livreurs (§6) : `drivers.stats` jamais calculé jusqu'ici. Recalcul
// nocturne, à partir des commandes livrées/annulées et des propositions de course des
// 30 derniers jours (pas d'écriture au fil de l'eau : plus sûr et moins coûteux que des
// compteurs incrémentaux sur le chemin chaud de la commande et de l'attribution).
import { COLLECTIONS, type DispatchOffer, type Order } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { minutesBetween } from '../../orders/context';
import { OPS_SCHEDULE_RUNTIME, TIMEZONE } from './common';

const WINDOW_DAYS = 30;

interface Accumulator {
  deliveries: number;
  cancellations: number;
  assigned: number;
  onTime: number;
  deliveryMinutesTotal: number;
  deliveryMinutesCount: number;
  offered: number;
  accepted: number;
}

function empty(): Accumulator {
  return { deliveries: 0, cancellations: 0, assigned: 0, onTime: 0, deliveryMinutesTotal: 0, deliveryMinutesCount: 0, offered: 0, accepted: 0 };
}

/** Recalcule `drivers.stats` de tous les livreurs actifs (§6) sur une fenêtre glissante de 30 jours. */
export const computeDriverStats = onSchedule(
  { schedule: '15 3 * * *', timeZone: TIMEZONE, ...OPS_SCHEDULE_RUNTIME, timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const since = Timestamp.fromMillis(Date.now() - WINDOW_DAYS * 86_400_000);
    const byDriver = new Map<string, Accumulator>();
    const get = (id: string) => byDriver.get(id) ?? (byDriver.set(id, empty()), byDriver.get(id)!);

    const orders = await db
      .collection(COLLECTIONS.orders)
      .where('createdAt', '>=', since)
      .where('fulfillment', '==', 'delivery')
      .get();
    for (const doc of orders.docs) {
      const order = doc.data() as Order;
      if (!order.driverId || order.delivery?.deliveredBy !== 'platform') continue;
      const acc = get(order.driverId);
      acc.assigned += 1;
      if (order.status === 'delivered') {
        acc.deliveries += 1;
        if (!order.flags.late) acc.onTime += 1;
        const minutes = minutesBetween(order.timeline.picked_up ?? order.timeline.assigned, order.timeline.delivered);
        if (minutes !== null && minutes > 0 && minutes < 240) {
          acc.deliveryMinutesTotal += minutes;
          acc.deliveryMinutesCount += 1;
        }
      } else if (order.status === 'cancelled' && (order.cancellation?.by === 'driver' || order.cancellation?.reason === 'address_unreachable')) {
        acc.cancellations += 1;
      }
    }

    const offers = await db.collection(COLLECTIONS.dispatchOffers).where('offeredAt', '>=', since).get();
    for (const doc of offers.docs) {
      const offer = doc.data() as DispatchOffer;
      if (offer.status === 'offered') continue; // en attente : ni accepté ni refusé
      const acc = get(offer.driverId);
      acc.offered += 1;
      if (offer.status === 'accepted') acc.accepted += 1;
    }

    // N'écrit que les livreurs qui existent réellement (une commande de démonstration
    // peut référencer un identifiant livreur qui n'a pas (ou plus) de fiche).
    const driverIds = [...byDriver.keys()];
    const existing = new Set<string>();
    for (let i = 0; i < driverIds.length; i += 300) {
      const chunk = driverIds.slice(i, i + 300).map((id) => db.collection(COLLECTIONS.drivers).doc(id));
      if (chunk.length === 0) continue;
      const snaps = await db.getAll(...chunk);
      for (const snap of snaps) if (snap.exists) existing.add(snap.id);
    }

    let updated = 0;
    let batch = db.batch();
    let pending = 0;
    for (const [driverId, acc] of byDriver) {
      if (!existing.has(driverId)) continue;
      const stats = {
        deliveries: acc.deliveries,
        acceptanceRate: acc.offered > 0 ? Math.round((acc.accepted / acc.offered) * 1000) / 1000 : 0,
        cancellationRate: acc.assigned > 0 ? Math.round((acc.cancellations / acc.assigned) * 1000) / 1000 : 0,
        onTimeRate: acc.deliveries > 0 ? Math.round((acc.onTime / acc.deliveries) * 1000) / 1000 : 0,
        averageDeliveryMinutes: acc.deliveryMinutesCount > 0 ? Math.round(acc.deliveryMinutesTotal / acc.deliveryMinutesCount) : 0,
      };
      batch.update(db.collection(COLLECTIONS.drivers).doc(driverId), { stats });
      updated += 1;
      pending += 1;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending) await batch.commit();
    logger.info('Statistiques livreurs recalculées', { drivers: updated, windowDays: WINDOW_DAYS });
  },
);
