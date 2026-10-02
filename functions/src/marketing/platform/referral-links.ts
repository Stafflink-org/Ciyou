// Parcours de création des parrainages : lien et code d'un commerce parrain (100 € de budget
// publicitaire quand le commerce parrainé est validé, montant réglable), code du client.
// Le document `referrals` est créé ici ; la récompense est versée par referrals.ts.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  formatPrice,
  generateReferralCode,
  type Referral,
  type Restaurant,
  type RestaurantCommercial,
  type RestaurantLegal,
  type UserProfile,
} from '@golink/shared';
import { randomInt } from 'node:crypto';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { APP_URLS } from '../../lib/config';
import { fail } from '../../lib/errors';
import { assertFeatureOn, isFeatureOn } from '../../lib/features';
import { requireAuth, requireRestaurantAccess } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { loadReferralSettings } from './common';

/** Peu d'instances et fraction de processeur : quota de processeurs de la région partagé. */
const LIGHT_RUNTIME = { maxInstances: 2, cpu: 'gcf_gen1' } as const;

const randomCode = (): string => `GL-${generateReferralCode(() => randomInt(0, 1_000_000) / 1_000_000).slice(0, 6)}`;

export const normalizeCode = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '');

const commercialRef = (restaurantId: string) => db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial);
const legalRef = (restaurantId: string) => db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal);

/** Code de parrainage du commerce, créé à la première demande (un code par commerce, jamais réattribué). */
export async function ensureRestaurantReferralCode(restaurantId: string): Promise<string> {
  const existing = (await commercialRef(restaurantId).get()).get('referralCode') as string | undefined;
  if (existing) return existing;
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get()).data() as Restaurant | undefined;
  if (!restaurant) throw fail.notFound('Commerce');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    try {
      await db.collection(COLLECTIONS.referralCodes).doc(code).create({ kind: 'restaurant', ownerId: restaurantId, countryId: restaurant.countryId, createdAt: Timestamp.now() });
    } catch (error) {
      if ((error as { code?: number }).code === 6) continue;
      throw error;
    }
    await commercialRef(restaurantId).set({ referralCode: code }, { merge: true });
    return code;
  }
  throw fail.unavailable('Impossible de créer un code de parrainage pour le moment. Réessayez.');
}

export type LinkOutcome = { applied: true; referralId: string; status: Referral['status'] } | { applied: false; reason: string };

/**
 * Rattache un commerce (filleul) au commerce dont il utilise le code. Refuse les auto-parrainages
 * (même compte gérant, même SIRET, même téléphone) : le parrainage est alors enregistré « refusé »
 * avec les signaux relevés, visible de l'équipe.
 */
export async function linkRestaurantReferral(refereeId: string, rawCode: string): Promise<LinkOutcome> {
  const code = normalizeCode(rawCode);
  const settings = (await loadReferralSettings()).restaurant;
  if (!settings.enabled) return { applied: false, reason: 'program_disabled' };
  const codeSnap = await db.collection(COLLECTIONS.referralCodes).doc(code).get();
  if (!codeSnap.exists || codeSnap.get('kind') !== 'restaurant') return { applied: false, reason: 'code_unknown' };
  const referrerId = String(codeSnap.get('ownerId'));
  if (referrerId === refereeId) return { applied: false, reason: 'self' };
  const [referrerSnap, refereeSnap, referrerLegal, refereeLegal] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).doc(referrerId).get(),
    db.collection(COLLECTIONS.restaurants).doc(refereeId).get(),
    legalRef(referrerId).get(),
    legalRef(refereeId).get(),
  ]);
  const referrer = referrerSnap.data() as Restaurant | undefined;
  const referee = refereeSnap.data() as Restaurant | undefined;
  if (!referrer || !referee) return { applied: false, reason: 'restaurant_missing' };
  if (referrer.status !== 'active') return { applied: false, reason: 'referrer_inactive' };
  // Interrupteur « Parrainage » (§24) : vérifié ICI (dans la fonction partagée), pas seulement chez
  // l'appelant — `restaurantSignup` appelait cette fonction directement sans jamais le vérifier,
  // contrairement à `applyRestaurantReferralCode` (après coup) qui le vérifiait déjà avant d'appeler.
  if (!(await isFeatureOn('referral', { restaurantId: refereeId, cityId: referee.cityId, countryId: referee.countryId }))) {
    return { applied: false, reason: 'feature_off' };
  }

  const signals: string[] = [];
  const a = referrerLegal.data() as Partial<RestaurantLegal> | undefined;
  const b = refereeLegal.data() as Partial<RestaurantLegal> | undefined;
  if (referrer.ownerId && referrer.ownerId === referee.ownerId) signals.push('même compte gérant');
  if (a?.siret && b?.siret && a.siret.replace(/\s/g, '') === b.siret.replace(/\s/g, '')) signals.push('même SIRET');
  if (a?.managerPhone && b?.managerPhone && a.managerPhone.replace(/\D/g, '') === b.managerPhone.replace(/\D/g, '')) signals.push('même téléphone du gérant');
  if (a?.managerEmail && b?.managerEmail && a.managerEmail.toLowerCase() === b.managerEmail.toLowerCase()) signals.push('même e-mail du gérant');

  const now = Timestamp.now();
  const referral: Referral = {
    program: 'restaurant',
    referrerId,
    referrerType: 'restaurant',
    refereeId,
    refereeType: 'restaurant',
    referrerName: referrer.name,
    refereeName: referee.name,
    code,
    status: signals.length ? 'rejected' : 'pending',
    qualifyingOrderId: null,
    referrerRewardCents: 0,
    refereeRewardCents: 0,
    cityId: referee.cityId,
    countryId: referee.countryId,
    createdAt: now,
    qualifiedAt: null,
    rewardedAt: null,
    ...(signals.length ? { rejectedAt: now, rejectedReason: 'Auto-parrainage détecté', fraudSignals: signals } : {}),
  };
  const ref = db.collection(COLLECTIONS.referrals).doc(`rest-${refereeId}`);
  try {
    await ref.create(referral);
  } catch (error) {
    if ((error as { code?: number }).code === 6) return { applied: false, reason: 'already_linked' };
    throw error;
  }
  await commercialRef(refereeId).set({ referredByRestaurantId: referrerId }, { merge: true });
  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: signals.length ? 'referral.rejected' : 'referral.created',
    target: { type: 'restaurant', id: refereeId, label: referee.name },
    after: { program: 'restaurant', referrerId, code, status: referral.status, fraudSignals: signals },
    countryId: referee.countryId,
    cityId: referee.cityId,
  });
  return { applied: true, referralId: ref.id, status: referral.status };
}

const REASON_MESSAGES: Record<string, string> = {
  program_disabled: 'Le parrainage entre commerces n’est pas ouvert pour le moment.',
  code_unknown: 'Ce code de parrainage n’existe pas.',
  self: 'Vous ne pouvez pas utiliser votre propre code.',
  restaurant_missing: 'Commerce introuvable.',
  referrer_inactive: 'Le commerce qui vous parraine n’est plus actif sur Ciyou Eats.',
  already_linked: 'Un code de parrainage est déjà enregistré pour ce commerce.',
  feature_off: 'Le parrainage n’est pas ouvert pour le moment.',
};

/** Lien et code de parrainage du commerce, avec la récompense annoncée (montant réglable). */
export const getRestaurantReferralLink = callable(z.object({ restaurantId: zId }), async (data, request) => {
  await requireRestaurantAccess(request, data.restaurantId, 'settings.manage', 'restaurants.commercial');
  const settings = (await loadReferralSettings()).restaurant;
  const code = await ensureRestaurantReferralCode(data.restaurantId);
  const commercial = (await commercialRef(data.restaurantId).get()).data() as RestaurantCommercial | undefined;
  return {
    code,
    url: `${APP_URLS.restaurant}/inscription?parrain=${code}`,
    enabled: settings.enabled,
    rewardCents: settings.rewardCents,
    rewardLabel: formatPrice(settings.rewardCents),
    rewardType: settings.rewardType ?? 'ad_credit',
    qualifyingOrders: settings.qualifyingOrders,
    adCreditCents: commercial?.adCreditCents ?? 0,
  };
}, LIGHT_RUNTIME);

/** Un commerce déjà inscrit renseigne le code de son parrain (une seule fois). */
export const applyRestaurantReferralCode = callable(z.object({ restaurantId: zId, code: z.string().trim().min(4).max(20) }), async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'settings.manage', 'restaurants.commercial');
  // Interrupteur « Parrainage » : vérifié dans `linkRestaurantReferral` elle-même (reason
  // `feature_off`), commun à tous les appelants.
  const outcome = await linkRestaurantReferral(data.restaurantId, data.code);
  if (!outcome.applied) throw fail.precondition(REASON_MESSAGES[outcome.reason] ?? 'Ce code ne peut pas être utilisé.');
  void actor;
  return { referralId: outcome.referralId, accepted: outcome.status === 'pending' };
}, LIGHT_RUNTIME);

/** Le client saisit le code de parrainage d'un autre client (avant sa première commande). */
export const applyReferralCode = callable(z.object({ code: z.string().trim().min(4).max(20) }), async (data, request) => {
  const caller = requireAuth(request);
  const settings = (await loadReferralSettings()).client;
  if (!settings.enabled) throw fail.precondition('Le parrainage n’est pas ouvert pour le moment.');
  await assertFeatureOn('referral', {}, 'Le parrainage n’est pas ouvert pour le moment.');
  const code = normalizeCode(data.code);
  const meRef = db.collection(COLLECTIONS.users).doc(caller.uid);
  const referrerQuery = await db.collection(COLLECTIONS.users).where('referralCode', '==', code).limit(1).get();
  const referrerDoc = referrerQuery.docs[0];
  if (!referrerDoc) throw fail.precondition('Ce code de parrainage n’existe pas.');
  if (referrerDoc.id === caller.uid) throw fail.precondition('Vous ne pouvez pas utiliser votre propre code.');
  const referrer = referrerDoc.data() as UserProfile;
  if (referrer.status !== 'active') throw fail.precondition('Ce code n’est plus valable.');

  const now = Timestamp.now();
  const ref = db.collection(COLLECTIONS.referrals).doc(`cli-${caller.uid}`);
  const result = await db.runTransaction(async (tx) => {
    const [me, existing] = await Promise.all([tx.get(meRef), tx.get(ref)]);
    const profile = me.data() as UserProfile | undefined;
    if (!profile) throw fail.notFound('Compte');
    if (existing.exists || profile.referredBy) throw fail.precondition('Un code de parrainage est déjà enregistré sur votre compte.');
    if ((profile.stats?.ordersCount ?? 0) > 0) throw fail.precondition('Le code de parrainage se saisit avant votre première commande.');
    // Auto-parrainage : même numéro de téléphone que le parrain.
    const samePhone = Boolean(profile.phone && referrer.phone && profile.phone.replace(/\D/g, '') === referrer.phone.replace(/\D/g, ''));
    const referral: Referral = {
      program: 'client',
      referrerId: referrerDoc.id,
      referrerType: 'client',
      refereeId: caller.uid,
      refereeType: 'client',
      code,
      status: samePhone ? 'rejected' : 'pending',
      qualifyingOrderId: null,
      referrerRewardCents: 0,
      refereeRewardCents: 0,
      cityId: profile.cityId ?? null,
      countryId: profile.countryId ?? null,
      createdAt: now,
      qualifiedAt: null,
      rewardedAt: null,
      ...(samePhone ? { rejectedAt: now, rejectedReason: 'Auto-parrainage détecté', fraudSignals: ['même téléphone'] } : {}),
    };
    tx.create(ref, referral);
    if (!samePhone) tx.update(meRef, { referredBy: referrerDoc.id, updatedAt: now });
    return referral.status;
  });
  await writeAudit({ actor: actorFromCaller(caller, 'client'), action: result === 'rejected' ? 'referral.rejected' : 'referral.created', target: { type: 'client', id: caller.uid }, after: { program: 'client', referrerId: referrerDoc.id, code, status: result } });
  if (result === 'rejected') throw fail.precondition('Ce code ne peut pas être utilisé avec votre compte.');
  return { referralId: ref.id, rewardCents: settings.refereeRewardCents, minFirstOrderCents: settings.minFirstOrderCents };
}, LIGHT_RUNTIME);
