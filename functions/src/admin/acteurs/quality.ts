// Score de qualité des commerces (annulations, refus, retards, avis, carte) et
// agrégats glissants sur 30 jours, recalculés chaque nuit ou à la demande.
import {
  COLLECTIONS,
  computeQualityScore,
  type Restaurant,
  type RestaurantDailyStats,
  type RestaurantMetrics30d,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { requireAdmin } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { ACTEURS_SCHEDULE_RUNTIME, TIMEZONE, acteursCallable, addDaysIso, loadRestaurantFor, parisDay } from './common';

function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10_000) : 0;
}

/** Recalcule les agrégats et le score d'un commerce. */
export async function computeRestaurantScore(id: string, restaurant: Restaurant): Promise<{ score: number; metrics: RestaurantMetrics30d }> {
  const from = addDaysIso(parisDay(), -29);
  const ref = db.collection(COLLECTIONS.restaurants).doc(id);
  const [statsSnap, issuesSnap] = await Promise.all([
    ref.collection('dailyStats').where('day', '>=', from).get(),
    db.collection(COLLECTIONS.menuIssues).where('restaurantId', '==', id).where('status', '==', 'open').count().get(),
  ]);
  const totals = { ordersCount: 0, deliveredCount: 0, cancelledCount: 0, rejectedCount: 0, lateCount: 0, salesCents: 0, commissionCents: 0 };
  statsSnap.docs.forEach((d) => {
    const s = d.data() as RestaurantDailyStats;
    totals.ordersCount += s.ordersCount ?? 0;
    totals.deliveredCount += s.deliveredCount ?? 0;
    totals.cancelledCount += s.cancelledCount ?? 0;
    totals.rejectedCount += s.rejectedCount ?? 0;
    totals.lateCount += s.lateCount ?? 0;
    totals.salesCents += s.salesCents ?? 0;
    totals.commissionCents += s.commissionCents ?? 0;
  });
  const openMenuIssues = issuesSnap.data().count;
  const metrics: RestaurantMetrics30d = {
    from,
    ...totals,
    cancelRateBps: rate(totals.cancelledCount, totals.ordersCount),
    rejectRateBps: rate(totals.rejectedCount, totals.ordersCount),
    lateRateBps: rate(totals.lateCount, Math.max(1, totals.deliveredCount)),
    openMenuIssues,
    computedAt: Timestamp.now(),
  };
  const { score, breakdown } = computeQualityScore({
    ordersCount: totals.ordersCount,
    cancelRateBps: metrics.cancelRateBps,
    rejectRateBps: metrics.rejectRateBps,
    lateRateBps: metrics.lateRateBps,
    ratingAverage: restaurant.rating?.average ?? 0,
    ratingCount: restaurant.rating?.count ?? 0,
    openMenuIssues,
  });
  await ref.update({ metrics30d: metrics, qualityBreakdown: breakdown, qualityScore: score });
  return { score, metrics };
}

export async function computeAllRestaurantScores(): Promise<{ computed: number; failed: number }> {
  const snap = await db.collection(COLLECTIONS.restaurants).get();
  let computed = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Restaurant;
    if (data.deletedAt) continue;
    try {
      await computeRestaurantScore(doc.id, data);
      computed += 1;
    } catch (error) {
      failed += 1;
      logger.error('Score de qualité non calculé', { restaurantId: doc.id, error: String(error) });
    }
  }
  return { computed, failed };
}

export const computeRestaurantScores = onSchedule(
  { schedule: 'every day 04:15', timeZone: TIMEZONE, ...ACTEURS_SCHEDULE_RUNTIME },
  async () => {
    const result = await computeAllRestaurantScores();
    logger.info('Scores de qualité recalculés', result);
  },
);

/** Recalcul à la demande (un commerce, ou tous pour un super administrateur). */
export const refreshRestaurantScores = acteursCallable(
  z.object({ restaurantId: zId.nullish() }),
  async (data, request) => {
    const { admin } = await requireAdmin(request, 'restaurants.view');
    if (data.restaurantId) {
      const restaurant = await loadRestaurantFor(admin, data.restaurantId);
      const { score } = await computeRestaurantScore(restaurant.id, restaurant.data);
      return { computed: 1, failed: 0, score };
    }
    if (admin.role !== 'super_admin' && admin.cityIds.length > 0) {
      const snap = await db.collection(COLLECTIONS.restaurants).where('cityId', 'in', admin.cityIds.slice(0, 30)).get();
      let computed = 0;
      for (const d of snap.docs) {
        await computeRestaurantScore(d.id, d.data() as Restaurant);
        computed += 1;
      }
      return { computed, failed: 0, score: null };
    }
    return { ...(await computeAllRestaurantScores()), score: null };
  },
  { timeoutSeconds: 300, memory: '512MiB' },
);
