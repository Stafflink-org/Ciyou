// Règles de croissance modifiables dans le super admin : encadrement des promotions
// des restaurants, programme de fidélité, parrainages, primes des commerciaux.
import { COLLECTIONS, SETTINGS_DOCS, type AdminPermission } from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zReason } from '../../lib/validation';

const cents = (max: number) => z.number().int().min(0).max(max);

const promotions = z.object({
  capsEnabled: z.boolean(),
  restaurantMaxPercentBps: z.number().int().min(100).max(10_000),
  restaurantMaxFixedCents: cents(50_000),
  restaurantRequiresReview: z.boolean(),
  maxActivePerRestaurant: z.number().int().min(1).max(50),
  loyalOrdersThreshold: z.number().int().min(2).max(500).optional(),
  inactiveDaysDefault: z.number().int().min(7).max(365).optional(),
});

const loyalty = z
  .object({
    enabled: z.boolean(),
    pointsPerEuro: z.number().min(0.1).max(100),
    welcomePoints: z.number().int().min(0).max(10_000),
    rewards: z
      .array(z.object({ points: z.number().int().min(10).max(1_000_000), valueCents: cents(100_000).refine((v) => v >= 50, 'Valeur minimale : 0,50 €.') }))
      .min(1, 'Ajoutez au moins un palier d’échange.')
      .max(8),
    pointsValidityDays: z.number().int().min(30).max(1825).nullable(),
    allowRestaurantPrograms: z.boolean(),
    minOrderCents: cents(100_000),
    maxRedeemBps: z.number().int().min(500).max(10_000),
    maxRestaurantReturnBps: z.number().int().min(100).max(10_000),
  })
  .superRefine((value, ctx) => {
    const points = value.rewards.map((r) => r.points);
    if (new Set(points).size !== points.length) ctx.addIssue({ code: 'custom', message: 'Deux paliers ne peuvent pas demander le même nombre de points.', path: ['rewards'] });
  });

const referral = z.object({
  client: z.object({ enabled: z.boolean(), referrerRewardCents: cents(20_000), refereeRewardCents: cents(20_000), minFirstOrderCents: cents(100_000) }),
  restaurant: z.object({ enabled: z.boolean(), rewardCents: cents(200_000), qualifyingOrders: z.number().int().min(0).max(1000), rewardType: z.enum(['ad_credit', 'cash']) }),
  driver: z.object({ enabled: z.boolean(), rewardCents: cents(100_000), qualifyingDeliveries: z.number().int().min(1).max(1000) }),
});

const campaigns = z.object({
  maxSendsPer7Days: z.number().int().min(1).max(50),
  sendWindow: z
    .object({ fromHour: z.number().int().min(0).max(23), toHour: z.number().int().min(1).max(24) })
    .refine((w) => w.fromHour < w.toHour, { message: 'L’heure de début doit précéder l’heure de fin.' }),
});

const crm = z.object({
  signupBonusCents: cents(500_000),
  revenueShareBps: z.number().int().min(0).max(5000),
  revenueShareMonths: z.number().int().min(0).max(36),
  defaultFollowUpDays: z.number().int().min(1).max(60),
  followUpReminders: z.boolean(),
});

const schema = z.discriminatedUnion('section', [
  z.object({ section: z.literal('promotions'), values: promotions, reason: zReason }),
  z.object({ section: z.literal('loyalty'), values: loyalty, reason: zReason }),
  z.object({ section: z.literal('referral'), values: referral, reason: zReason }),
  z.object({ section: z.literal('crm'), values: crm, reason: zReason }),
  z.object({ section: z.literal('campaignRules'), values: campaigns, reason: zReason }),
]);

const PERMISSION: Record<z.output<typeof schema>['section'], AdminPermission> = {
  promotions: 'promotions.edit',
  loyalty: 'loyalty.edit',
  referral: 'loyalty.edit',
  crm: 'crm.manage_team',
  campaignRules: 'notifications.send',
};

const LABELS: Record<z.output<typeof schema>['section'], string> = {
  promotions: 'Règles des promotions restaurants',
  loyalty: 'Programme de fidélité',
  referral: 'Parrainage',
  crm: 'Rémunération des commerciaux',
  campaignRules: 'Règles des campagnes restaurants',
};

/** Enregistre une section de réglages de croissance (réglage plateforme, motif obligatoire). */
export const updateGrowthSettings = callable(schema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, PERMISSION[data.section]);
  if (admin.role !== 'super_admin' && (admin.cityIds.length > 0 || admin.countryIds.length > 0)) {
    throw fail.forbidden('Ces règles s’appliquent à toute la plateforme : elles sont réservées à l’équipe centrale.');
  }
  const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS[data.section]);
  const before = (await ref.get()).data() ?? null;
  const now = Timestamp.now();
  await ref.set({ ...data.values, updatedAt: now, updatedBy: caller.uid }, { merge: true });
  const strip = (v: Record<string, unknown> | null) => {
    if (!v) return null;
    const { updatedAt: _u, updatedBy: _b, ...rest } = v;
    return rest;
  };
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'settings.updated',
    target: { type: 'setting', id: SETTINGS_DOCS[data.section], label: LABELS[data.section] },
    reason: data.reason,
    before: strip(before),
    after: data.values as Record<string, unknown>,
    request,
  });
  return { section: data.section };
});
