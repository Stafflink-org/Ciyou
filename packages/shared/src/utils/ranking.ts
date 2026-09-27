// Classement des commerces dans l'app client (cahier §11) : score de 0 à 1 selon les
// pondérations réglées par le super admin. La distance dépend du client : le serveur stocke
// un score de base sans distance (`rankingScore`) et l'app y ajoute la proximité avec
// `finalRankingScore`. Un commerce en mise en avant payante affiche toujours la mention
// « Sponsorisé » (obligation légale), portée par `sponsoredLabel`.
import type { PlanCode } from '../pricing/plans';

export interface RankingWeights {
  distanceWeight: number;
  ratingWeight: number;
  popularityWeight: number;
  planWeight: number;
  sponsoredWeight: number;
  /** Un commerce lancé depuis moins de N jours reçoit un coup de pouce. */
  newRestaurantBoostDays: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  distanceWeight: 0.3,
  ratingWeight: 0.25,
  popularityWeight: 0.2,
  planWeight: 0.1,
  sponsoredWeight: 0.15,
  newRestaurantBoostDays: 30,
};

/** Poids relatif de chaque formule dans le score (0 à 1). */
export const PLAN_RANKING_SCORE: Record<PlanCode, number> = { basic: 0.33, pro: 0.66, premium: 1 };

/** Coup de pouce accordé aux nouveaux commerces (part du score final). */
export const NEW_RESTAURANT_BOOST = 0.05;

export interface RankingInput {
  ratingAverage: number;
  ratingCount: number;
  ordersCount: number;
  planCode: PlanCode;
  sponsored: boolean;
  /** Mise en ligne (ms) ; absent = pas de coup de pouce. */
  launchedAtMs?: number | null;
}

export interface RankingContext {
  /** Plus grand nombre de commandes parmi les commerces comparés (popularité relative). */
  maxOrders: number;
  nowMs: number;
}

/**
 * Score de base 0 à 1, hors distance : les poids restants sont renormalisés, de sorte que la
 * valeur stockée reste comparable d'un commerce à l'autre quelle que soit la part de la distance.
 */
export function baseRankingScore(input: RankingInput, ctx: RankingContext, weights: RankingWeights): number {
  const withoutDistance = weights.ratingWeight + weights.popularityWeight + weights.planWeight + weights.sponsoredWeight;
  if (withoutDistance <= 0) return 0;
  // Une note s'appuie sur assez d'avis : en dessous de 5 avis elle est tirée vers la note neutre (3,5).
  const confidence = Math.min(1, input.ratingCount / 5);
  const rating = ((input.ratingAverage * confidence + 3.5 * (1 - confidence)) / 5) * weights.ratingWeight;
  const popularity = (ctx.maxOrders > 0 ? Math.min(1, input.ordersCount / ctx.maxOrders) : 0) * weights.popularityWeight;
  const plan = (PLAN_RANKING_SCORE[input.planCode] ?? 0) * weights.planWeight;
  const sponsored = input.sponsored ? weights.sponsoredWeight : 0;
  const isNew = Boolean(input.launchedAtMs) && ctx.nowMs - (input.launchedAtMs as number) < weights.newRestaurantBoostDays * 86_400_000;
  const score = (rating + popularity + plan + sponsored) / withoutDistance + (isNew ? NEW_RESTAURANT_BOOST : 0);
  return Math.round(Math.min(1, score) * 10_000) / 10_000;
}

/** Score final côté app : score de base pondéré et proximité (1 = sur place, 0 = distance maximale). */
export function finalRankingScore(baseScore: number, proximity: number, weights: RankingWeights): number {
  const p = Math.max(0, Math.min(1, proximity));
  return baseScore * (1 - weights.distanceWeight) + p * weights.distanceWeight;
}
