// Classement des commerces (cahier §11) appliqué côté serveur : le score de base
// (`restaurants.rankingScore`, 0 à 1, hors distance) est recalculé chaque nuit et à chaque
// changement des pondérations, à partir des réglages du super admin (`settings/display`).
// Il alimente l'ordre de la liste de l'app client ; la mention légale « Sponsorisé »
// est portée par `restaurants.sponsoredLabel` (texte réglable, obligatoire).
import {
  COLLECTIONS,
  DEFAULT_RANKING_WEIGHTS,
  SETTINGS_DOCS,
  baseRankingScore,
  type DisplaySettings,
  type Restaurant,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { z } from '../../lib/validation';
import { requireAdmin } from '../../lib/permissions';
import { EXPERIENCE_RUNTIME, experienceCallable } from './common';

export interface RankingReport {
  restaurants: number;
  updated: number;
  sponsored: number;
}

/** Recalcule le score de base et la mention « Sponsorisé » de tous les commerces en ligne. */
export async function recomputeRankingScores(): Promise<RankingReport> {
  const settings = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.display).get()).data() as Partial<DisplaySettings> | undefined;
  const weights = { ...DEFAULT_RANKING_WEIGHTS, ...(settings?.ranking ?? {}) };
  const label = settings?.sponsoredLabel?.trim() || 'Sponsorisé';
  const snap = await db.collection(COLLECTIONS.restaurants).where('status', '==', 'active').get();
  const docs = snap.docs.filter((d) => !(d.data() as Restaurant).deletedAt);
  // La popularité est relative aux commerces de la même ville.
  const maxByCity = new Map<string, number>();
  for (const d of docs) {
    const r = d.data() as Restaurant;
    maxByCity.set(r.cityId, Math.max(maxByCity.get(r.cityId) ?? 0, r.ordersCount ?? 0));
  }
  const nowMs = Date.now();
  const report: RankingReport = { restaurants: docs.length, updated: 0, sponsored: 0 };
  let batch = db.batch();
  let pending = 0;
  for (const d of docs) {
    const r = d.data() as Restaurant & { sponsoredLabel?: string | null };
    const score = baseRankingScore(
      { ratingAverage: r.rating?.average ?? 0, ratingCount: r.rating?.count ?? 0, ordersCount: r.ordersCount ?? 0, planCode: r.planCode, sponsored: r.sponsored === true, launchedAtMs: r.launchedAt?.toMillis() ?? null },
      { maxOrders: maxByCity.get(r.cityId) ?? 0, nowMs },
      weights,
    );
    const sponsoredLabel = r.sponsored === true ? label : null;
    if (r.sponsored === true) report.sponsored += 1;
    if (r.rankingScore === score && (r.sponsoredLabel ?? null) === sponsoredLabel) continue;
    batch.update(d.ref, { rankingScore: score, sponsoredLabel, rankingComputedAt: Timestamp.fromMillis(nowMs) });
    report.updated += 1;
    pending += 1;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return report;
}

export const computeRankingScores = onSchedule(
  { schedule: '20 3 * * *', timeZone: 'Europe/Paris', retryCount: 1, ...EXPERIENCE_RUNTIME },
  async () => {
    const report = await recomputeRankingScores();
    logger.info('Classement recalculé', { ...report });
    await writeAudit({ actor: SYSTEM_ACTOR, action: 'ranking.recomputed', target: { type: 'other', id: 'ranking', label: 'Classement des commerces' }, after: { ...report } });
  },
);

/** « Recalculer maintenant » depuis l'écran Classement. */
export const refreshRankingScores = experienceCallable(z.object({}), async (_data, request) => {
  const { caller } = await requireAdmin(request, 'display.edit');
  const report = await recomputeRankingScores();
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'ranking.recomputed', target: { type: 'other', id: 'ranking', label: 'Classement des commerces' }, after: { ...report }, request });
  return report;
});
