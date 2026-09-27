// Programme de fidélité d'un établissement : règles de gain et paliers de
// récompense, dans les limites du programme Ciyou Eats (settings/loyalty).
import {
  COLLECTIONS,
  RESTAURANT_LOYALTY_RULES,
  RESTAURANT_SETTINGS_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type LoyaltySettings,
  type RestaurantLoyaltySettings,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { assertFeatureOn, scopeOfRestaurant } from '../../lib/features';
import { requireRestaurantAccess } from '../../lib/permissions';
import { assertFeatureAllowed } from '../../finance/argent/entitlements';
import { z, zId } from '../../lib/validation';
import { loadRestaurant } from './helpers';

const RULES = RESTAURANT_LOYALTY_RULES;

const schema = z.object({
  restaurantId: zId,
  enabled: z.boolean(),
  earnPoints: z.number().int().min(1, 'Indiquez au moins 1 point.').max(100),
  everyCents: z.number().int().min(RULES.minEveryCents, 'Le montant de référence doit être d’au moins 0,50 €.').max(10_000),
  welcomePoints: z.number().int().min(0).max(RULES.maxWelcomePoints),
  rewards: z
    .array(
      z.object({
        points: z.number().int().min(10, 'Un palier compte au moins 10 points.').max(RULES.maxThresholdPoints),
        rewardCents: z.number().int().min(50, 'Une récompense vaut au moins 0,50 €.').max(10_000),
        label: z.string().trim().max(40).nullable().default(null),
      }),
    )
    .min(1, 'Ajoutez au moins un palier de récompense.')
    .max(RULES.maxRewards),
  pointsValidityDays: z.number().int().min(30).max(730).nullable(),
});

export const saveLoyaltyProgram = callable(schema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage', 'restaurants.edit');
  const restaurant = await loadRestaurant(data.restaurantId);
  if (data.enabled) {
    await assertFeatureAllowed(restaurant.id, 'loyalty');
    await assertFeatureOn('loyalty', scopeOfRestaurant(restaurant, data.restaurantId), 'La fidélité est désactivée par Ciyou Eats pour cet établissement.');
  }

  const platform = (await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.loyalty).get()).data() as LoyaltySettings | undefined;
  if (data.enabled && platform && !platform.allowRestaurantPrograms) {
    throw fail.precondition('Les programmes de fidélité des établissements sont momentanément désactivés par Ciyou Eats.');
  }
  // Plafond du taux de retour, paramétrable par le super admin (valeur par défaut identique à l'ancienne constante).
  const maxReturnBps = platform?.maxRestaurantReturnBps ?? RULES.maxReturnBps;

  const rewards = [...data.rewards].sort((a, b) => a.points - b.points);
  rewards.forEach((reward, index) => {
    const previous = rewards[index - 1];
    if (previous && reward.points === previous.points) throw fail.invalid('Deux paliers ne peuvent pas avoir le même nombre de points.');
    if (previous && reward.rewardCents <= previous.rewardCents) {
      throw fail.invalid('Chaque palier doit offrir une récompense plus élevée que le précédent.');
    }
    // Montant à dépenser pour atteindre le palier, et taux de retour correspondant.
    const spendCents = (reward.points / data.earnPoints) * data.everyCents;
    if ((reward.rewardCents / spendCents) * 10_000 > maxReturnBps) {
      throw fail.invalid(`Le palier de ${reward.points} points rend plus de ${maxReturnBps / 100} % des dépenses : augmentez les points nécessaires ou baissez la récompense.`);
    }
  });
  const first = rewards[0];
  if (!first) throw fail.invalid('Ajoutez au moins un palier de récompense.');

  const ref = db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurant.id)
    .collection(SUBCOLLECTIONS.restaurants.settings)
    .doc(RESTAURANT_SETTINGS_DOCS.loyalty);
  const before = (await ref.get()).data() as RestaurantLoyaltySettings | undefined;
  const program: RestaurantLoyaltySettings = {
    enabled: data.enabled,
    earnPoints: data.earnPoints,
    everyCents: data.everyCents,
    welcomePoints: data.welcomePoints,
    thresholdPoints: first.points,
    rewardCents: first.rewardCents,
    rewards: rewards.map((r) => ({ points: r.points, rewardCents: r.rewardCents, label: r.label || null })),
    pointsValidityDays: data.pointsValidityDays,
    updatedAt: Timestamp.now(),
    updatedBy: actor.caller.uid,
  };
  await ref.set(program);
  await writeAudit({
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action: before?.enabled !== data.enabled ? (data.enabled ? 'loyalty.enabled' : 'loyalty.disabled') : 'loyalty.updated',
    target: { type: 'restaurant', id: restaurant.id, label: restaurant.name },
    before: before
      ? { enabled: before.enabled, earnPoints: before.earnPoints, everyCents: before.everyCents, thresholdPoints: before.thresholdPoints, rewardCents: before.rewardCents }
      : null,
    after: { enabled: program.enabled, earnPoints: program.earnPoints, everyCents: program.everyCents, rewards: program.rewards },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    request,
  });
  return { enabled: program.enabled };
});
