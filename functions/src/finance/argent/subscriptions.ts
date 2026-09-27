// Modèle économique (cahier §17) : formules, barèmes de commission versionnés,
// cycle de vie des abonnements et relances des impayés.
import {
  COLLECTIONS,
  PLAN_FEATURE_KEYS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type CommissionRule,
  type Plan,
  type PlanCode,
  type Restaurant,
  type Subscription,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit, type AuditActor } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import { raiseAlert, resolveAlert } from './alerts';
import { loadDunning, restoreSubscription, settleInvoiceByTransfer, settleSubscriptionDebts } from './billing';
import { addDays, DAY_MS, euros, parisTime } from './common';
import { messageRestaurantFinance } from './notify';
import { ARGENT_RUNTIME, argentCallable } from './runtime';

const zBps = z.number().int().min(0).max(10_000);
const zPlanCode = z.enum(['basic', 'pro', 'premium']);

// ------------------------------------------------------------------ Formules

export const updatePlan = argentCallable(
  z.object({
    code: zPlanCode,
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(400),
    active: z.boolean(),
    countryIds: z.array(z.string().length(2)).max(10),
    monthlyPriceHtCents: z.number().int().min(0).max(10_000_000),
    yearlyPriceHtCents: z.number().int().min(0).max(100_000_000).nullable(),
    trialDays: z.number().int().min(0).max(365),
    billingMode: z.enum(['commission', 'subscription', 'hybrid']),
    commitmentMonths: z.number().int().min(0).max(60),
    cardRequired: z.boolean(),
    gracePeriodDays: z.number().int().min(0).max(120),
    commission: z.object({ platformDeliveryBps: zBps, restaurantDeliveryBps: zBps, pickupBps: zBps }),
    /** La formule laisse le barème du pays s'appliquer (les taux ci-dessus sont alors ignorés). */
    commissionInherit: z.boolean().optional(),
    rankingBoost: z.number().min(0).max(10),
    maxDeliveryRadiusMeters: z.number().int().min(500).max(50_000),
    includedOutlets: z.number().int().min(1).max(500),
    features: z.array(z.enum(PLAN_FEATURE_KEYS)).max(PLAN_FEATURE_KEYS.length),
    limits: z.object({
      maxProducts: z.number().int().min(1).max(100_000).nullable(),
      maxStaff: z.number().int().min(1).max(10_000).nullable(),
      maxPromotions: z.number().int().min(1).max(10_000).nullable(),
    }),
    order: z.number().int().min(0).max(100),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'plans.edit');
    const { reason, ...values } = data;
    const ref = db.collection(COLLECTIONS.plans).doc(data.code);
    const snap = await ref.get();
    const before = snap.exists ? (snap.data() as Plan) : null;
    const now = Timestamp.now();
    await ref.set({ ...values, stripePriceId: before?.stripePriceId ?? null, updatedAt: now, updatedBy: caller.uid, ...(before ? {} : { createdAt: now, createdBy: caller.uid }) }, { merge: true });
    const changedFields = Object.keys(values).filter((key) => JSON.stringify((before as Record<string, unknown> | null)?.[key]) !== JSON.stringify((values as Record<string, unknown>)[key]));
    const pick = (obj: Record<string, unknown> | null) => Object.fromEntries(changedFields.map((k) => [k, obj?.[k] ?? null]));
    await db.collection(COLLECTIONS.settingsHistory).add({ docPath: `${COLLECTIONS.plans}/${data.code}`, changedFields, before: pick(before as Record<string, unknown> | null), after: pick(values as Record<string, unknown>), reason, changedBy: caller.uid, changedAt: FieldValue.serverTimestamp() });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'plan.updated', target: { type: 'setting', id: `plans/${data.code}`, label: data.name }, reason, before: pick(before as Record<string, unknown> | null), after: pick(values as Record<string, unknown>), request, sensitive: true });
    return { changedFields };
  },
);

// ------------------------------------------------------------------ Commissions

function commissionTargets(scope: CommissionRule['scope'], scopeId: string): DocumentReference | null {
  switch (scope) {
    case 'country':
      return db.collection(COLLECTIONS.countries).doc(scopeId);
    case 'city':
      return db.collection(COLLECTIONS.cities).doc(scopeId);
    case 'plan':
      return db.collection(COLLECTIONS.plans).doc(scopeId);
    case 'restaurant':
      return db.collection(COLLECTIONS.restaurants).doc(scopeId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial);
    default:
      return null;
  }
}

/** Application du barème au document qui fait foi pour le calcul des commandes. */
function applyRates(scope: CommissionRule['scope'], rates: { platformDeliveryBps: number; restaurantDeliveryBps: number; pickupBps: number } | null, reason: string, validTo: Timestamp | null, uid: string) {
  const now = Timestamp.now();
  switch (scope) {
    case 'country':
      return rates ? { 'pricing.commission.platformDeliveryBps': rates.platformDeliveryBps, 'pricing.commission.restaurantDeliveryBps': rates.restaurantDeliveryBps, 'pricing.commission.pickupBps': rates.pickupBps, updatedAt: now, updatedBy: uid } : null;
    case 'city':
      // Taux de la ville : surcharge du barème du marché pour les trois modes.
      return { 'pricing.commission': rates ? { platformDeliveryBps: rates.platformDeliveryBps, restaurantDeliveryBps: rates.restaurantDeliveryBps, pickupBps: rates.pickupBps } : FieldValue.delete(), commissionOverrideBps: null, updatedAt: now, updatedBy: uid };
    case 'plan':
      return rates ? { commission: rates, updatedAt: now, updatedBy: uid } : null;
    case 'restaurant':
      return { negotiatedCommission: rates ? { ...rates, reason, validUntil: validTo } : null, updatedAt: now, updatedBy: uid };
    default:
      return null;
  }
}

async function scopeLabel(scope: CommissionRule['scope'], scopeId: string): Promise<{ countryId: string; cityId: string | null; label: string }> {
  if (scope === 'country') {
    const snap = await db.collection(COLLECTIONS.countries).doc(scopeId).get();
    if (!snap.exists) throw fail.notFound('Pays');
    return { countryId: scopeId, cityId: null, label: String(snap.get('name') ?? scopeId) };
  }
  if (scope === 'city') {
    const snap = await db.collection(COLLECTIONS.cities).doc(scopeId).get();
    if (!snap.exists) throw fail.notFound('Ville');
    return { countryId: String(snap.get('countryId')), cityId: scopeId, label: String(snap.get('name') ?? scopeId) };
  }
  if (scope === 'plan') return { countryId: 'FR', cityId: null, label: `Formule ${scopeId}` };
  if (scope === 'restaurant') {
    const snap = await db.collection(COLLECTIONS.restaurants).doc(scopeId).get();
    if (!snap.exists) throw fail.notFound('Commerce');
    const r = snap.data() as Restaurant;
    return { countryId: r.countryId, cityId: r.cityId, label: r.name };
  }
  const snap = await db.collection(COLLECTIONS.restaurantGroups).doc(scopeId).get();
  if (!snap.exists) throw fail.notFound('Groupe');
  return { countryId: String(snap.get('countryId') ?? 'FR'), cityId: null, label: String(snap.get('name') ?? scopeId) };
}

export const updateCommissionRule = argentCallable(
  z.discriminatedUnion('action', [
    z.object({
      action: z.literal('create'),
      scope: z.enum(['country', 'city', 'plan', 'group', 'restaurant']),
      scopeId: zId,
      platformDeliveryBps: zBps,
      restaurantDeliveryBps: zBps,
      pickupBps: zBps,
      validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      reason: zReason,
    }),
    z.object({ action: z.literal('end'), ruleId: zId, reason: zReason }),
  ]),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'commissions.edit');
    const actor = actorFromCaller(caller, 'admin');
    const now = Timestamp.now();

    if (data.action === 'end') {
      const ref = db.collection(COLLECTIONS.commissionRules).doc(data.ruleId);
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound('Barème');
      const rule = snap.data() as CommissionRule;
      if (rule.validTo && rule.validTo.toMillis() <= now.toMillis()) throw fail.precondition('Ce barème est déjà clos.');
      if (rule.scope === 'country' || rule.scope === 'plan') throw fail.precondition('Le barème par défaut d’un pays ou d’une formule se remplace, il ne se clôt pas.');
      const info = await scopeLabel(rule.scope, rule.scopeId);
      assertAdminCovers(admin, info.cityId);
      const batch = db.batch();
      batch.update(ref, { validTo: now, updatedAt: now, updatedBy: caller.uid, endReason: data.reason });
      const target = commissionTargets(rule.scope, rule.scopeId);
      const patch = applyRates(rule.scope, null, data.reason, null, caller.uid);
      if (target && patch) {
        if (rule.scope === 'city') batch.update(target, patch);
        else batch.set(target, patch, { merge: true });
      }
      if (rule.scope === 'group') {
        const members = await db.collection(COLLECTIONS.restaurants).where('groupId', '==', rule.scopeId).get();
        for (const doc of members.docs) batch.set(commissionTargets('restaurant', doc.id) as DocumentReference, { negotiatedCommission: null, updatedAt: now, updatedBy: caller.uid }, { merge: true });
      }
      await batch.commit();
      await writeAudit({ actor, action: 'commission_rule.ended', target: { type: rule.scope === 'restaurant' ? 'restaurant' : 'setting', id: rule.scopeId, label: info.label }, reason: data.reason, before: { platformDeliveryBps: rule.platformDeliveryBps, restaurantDeliveryBps: rule.restaurantDeliveryBps, pickupBps: rule.pickupBps }, countryId: info.countryId, cityId: info.cityId, request, sensitive: true });
      return { ruleId: data.ruleId };
    }

    const info = await scopeLabel(data.scope, data.scopeId);
    assertAdminCovers(admin, info.cityId);
    const rates = { platformDeliveryBps: data.platformDeliveryBps, restaurantDeliveryBps: data.restaurantDeliveryBps, pickupBps: data.pickupBps };
    const validTo = data.validTo ? Timestamp.fromDate(parisTime(addDays(data.validTo, 1), 0)) : null;
    if (validTo && validTo.toMillis() <= now.toMillis()) throw fail.invalid('La date de fin doit être dans le futur.');
    const ruleRef = db.collection(COLLECTIONS.commissionRules).doc();
    const previous = await db.collection(COLLECTIONS.commissionRules).where('scope', '==', data.scope).where('scopeId', '==', data.scopeId).orderBy('validFrom', 'desc').limit(5).get();
    const active = previous.docs.find((d) => {
      const r = d.data() as CommissionRule;
      return !r.validTo || r.validTo.toMillis() > now.toMillis();
    });
    const groupMembers = data.scope === 'group' ? (await db.collection(COLLECTIONS.restaurants).where('groupId', '==', data.scopeId).get()).docs : [];

    await db.runTransaction(async (tx) => {
      if (active) tx.update(active.ref, { validTo: now, updatedAt: now, updatedBy: caller.uid });
      const rule: CommissionRule = {
        scope: data.scope,
        scopeId: data.scopeId,
        countryId: info.countryId,
        ...rates,
        validFrom: now,
        validTo,
        reason: data.reason,
        supersedesId: active?.id ?? null,
        createdAt: now,
        createdBy: caller.uid,
        updatedAt: now,
        updatedBy: caller.uid,
      };
      tx.set(ruleRef, { ...rule, scopeLabel: info.label, cityId: info.cityId });
      const target = commissionTargets(data.scope, data.scopeId);
      const patch = applyRates(data.scope, rates, data.reason, validTo, caller.uid);
      if (target && patch) {
        if (data.scope === 'country' || data.scope === 'city') tx.update(target, patch);
        else tx.set(target, patch, { merge: true });
      }
      for (const doc of groupMembers) tx.set(commissionTargets('restaurant', doc.id) as DocumentReference, { negotiatedCommission: { ...rates, reason: `Groupe : ${data.reason}`, validUntil: validTo }, updatedAt: now, updatedBy: caller.uid }, { merge: true });
    });
    const before = active ? (active.data() as CommissionRule) : null;
    await writeAudit({
      actor,
      action: 'commission_rule.created',
      target: { type: data.scope === 'restaurant' ? 'restaurant' : data.scope === 'city' ? 'city' : data.scope === 'country' ? 'country' : 'setting', id: data.scopeId, label: info.label },
      reason: data.reason,
      before: before ? { platformDeliveryBps: before.platformDeliveryBps, restaurantDeliveryBps: before.restaurantDeliveryBps, pickupBps: before.pickupBps } : null,
      after: { ...rates, validTo: data.validTo ?? null },
      countryId: info.countryId,
      cityId: info.cityId,
      request,
      sensitive: true,
    });
    return { ruleId: ruleRef.id, supersedesId: active?.id ?? null };
  },
);

// ------------------------------------------------------------------ Cycle de vie

function subscriberRefs(sub: Subscription) {
  const rRef = db.collection(COLLECTIONS.restaurants).doc(sub.subscriberId);
  return { rRef, cRef: rRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial) };
}

type DunningKind = NonNullable<Subscription['dunning']['log']>[number]['kind'];

function logEntry(kind: DunningKind, note: string | null) {
  return { at: Timestamp.now(), kind, note };
}

/**
 * Nouvelle tentative de règlement : l'abonnement n'est pas prélevé par carte, il est retenu
 * sur les reversements. La tentative regarde si le solde à reverser du commerce couvre
 * maintenant la facture ; si oui, elle est compensée et l'abonnement rétabli.
 */
async function attemptCharge(sub: Subscription): Promise<{ ok: boolean; note: string }> {
  const result = await settleSubscriptionDebts(sub.subscriberId);
  if (result.settled > 0) return { ok: true, note: `Facture compensée sur les reversements (${euros(result.dueCents)}).` };
  if (result.dueCents === 0) return { ok: true, note: 'Aucune facture en attente : abonnement à jour.' };
  return { ok: false, note: `Solde à reverser insuffisant : ${euros(Math.max(0, result.balanceCents))} disponibles pour ${euros(result.dueCents)} dus.` };
}

async function setStatus(subRef: DocumentReference, sub: Subscription, status: Subscription['status'], patch: Record<string, unknown>, history: Subscription['history'][number] | null): Promise<void> {
  const { cRef } = subscriberRefs(sub);
  const batch = db.batch();
  batch.update(subRef, { status, ...patch, ...(history ? { history: FieldValue.arrayUnion(history) } : {}), updatedAt: Timestamp.now() });
  batch.set(cRef, { subscriptionStatus: status, updatedAt: Timestamp.now(), updatedBy: history?.by ?? 'system' }, { merge: true });
  await batch.commit();
}

/** Une étape de relance : nouvelle tentative, puis restriction, puis suspension. */
async function dunningStep(subRef: DocumentReference, sub: Subscription, settings: Awaited<ReturnType<typeof loadDunning>>, actor: AuditActor): Promise<string> {
  const now = Timestamp.now();
  const attempt = await attemptCharge(sub);
  const attempts = (sub.dunning?.attempts ?? 0) + 1;
  if (attempt.ok) {
    // La compensation a rétabli l'abonnement ; sinon (règlement hors plateforme), on le rétablit ici.
    await restoreSubscription(sub.subscriberId, 'Paiement régularisé', actor.uid);
    await subRef.update({ 'dunning.log': FieldValue.arrayUnion(logEntry('retry_succeeded', attempt.note)) });
    return 'Paiement régularisé';
  }
  const log: Array<ReturnType<typeof logEntry>> = [logEntry('retry_failed', attempt.note)];
  let status: Subscription['status'] = sub.status === 'active' || sub.status === 'trialing' ? 'past_due' : sub.status;
  const patch: Record<string, unknown> = {
    'dunning.attempts': attempts,
    'dunning.lastAttemptAt': now,
    'dunning.nextRetryAt': Timestamp.fromMillis(now.toMillis() + settings.retryIntervalDays * DAY_MS),
    'dunning.firstFailedAt': sub.dunning?.firstFailedAt ?? now,
  };
  let history: Subscription['history'][number] | null = null;
  if (attempts >= settings.maxAttempts && status === 'past_due') {
    status = 'restricted';
    patch['dunning.restrictedAt'] = now;
    log.push(logEntry('restricted', `Fonctionnalités coupées : ${settings.restrictedFeatures.join(', ') || 'aucune'}`));
    history = { at: now, event: 'restricted', planCode: sub.planCode, by: actor.uid, reason: `${attempts} tentatives de prélèvement en échec` };
  } else if (status === 'restricted' && sub.dunning?.restrictedAt) {
    const plan = (await db.collection(COLLECTIONS.plans).doc(sub.planCode).get()).data() as Plan | undefined;
    const grace = plan?.gracePeriodDays ?? 0;
    if (now.toMillis() - sub.dunning.restrictedAt.toMillis() >= grace * DAY_MS) {
      status = 'suspended';
      patch['dunning.suspendedAt'] = now;
      patch['dunning.nextRetryAt'] = null;
      log.push(logEntry('suspended', `Délai de grâce de ${grace} jour${grace > 1 ? 's' : ''} écoulé`));
      history = { at: now, event: 'suspended', planCode: sub.planCode, by: actor.uid, reason: 'Impayé non régularisé' };
    }
  }
  if (settings.emailReminders && sub.status !== 'suspended') {
    const restaurantRow = (await db.collection(COLLECTIONS.restaurants).doc(sub.subscriberId).get()).data() as (Restaurant & { seed?: boolean; test?: boolean }) | undefined;
    const demo = restaurantRow?.seed === true || restaurantRow?.test === true;
    const pending = await db.collection(COLLECTIONS.invoices).where('recipient.id', '==', sub.subscriberId).where('compensation.status', '==', 'pending').limit(20).get();
    const dueCents = pending.docs.reduce((sum, d) => sum + ((d.get('compensation.debitCents') as number | undefined) ?? 0), 0);
    const numbers = pending.docs.map((d) => String(d.get('number') ?? d.id)).join(', ');
    const stage = status === 'suspended' ? 'subscription_suspended' : status === 'restricted' ? 'subscription_restricted' : 'subscription_payment_due';
    const graceDays = settings.retryIntervalDays * Math.max(1, settings.maxAttempts - attempts);
    await messageRestaurantFinance(
      sub.subscriberId,
      stage,
      {
        restaurantName: restaurantRow?.name ?? '',
        amount: euros(dueCents || sub.priceHtCents),
        invoiceNumber: numbers,
        features: settings.restrictedFeatures.join(', ') || 'aucune',
        date: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date(now.toMillis() + graceDays * DAY_MS)),
      },
      { dedupeKey: `${stage}-${subRef.id}-${attempts}`, ctaUrl: null },
      demo,
    );
    log.push(logEntry('reminder_sent', stage));
  }
  patch['dunning.log'] = FieldValue.arrayUnion(...log);
  await setStatus(subRef, sub, status, patch, history);
  if (settings.holdPayouts && status !== sub.status && status === 'restricted') {
    const existing = await db.collection(COLLECTIONS.payoutHolds).where('beneficiaryId', '==', sub.subscriberId).where('active', '==', true).limit(1).get();
    if (existing.empty) {
      await db.collection(COLLECTIONS.payoutHolds).add({ beneficiaryType: 'restaurant', beneficiaryId: sub.subscriberId, beneficiaryName: null, countryId: sub.countryId, cityId: sub.cityId ?? null, reason: 'unpaid_subscription', details: 'Abonnement impayé (relances automatiques).', active: true, releasedAt: null, releasedBy: null, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });
    }
  }
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(sub.subscriberId).get()).get('name') as string | undefined;
  await raiseAlert({
    kind: 'subscription_unpaid',
    severity: status === 'suspended' ? 'critical' : 'warning',
    title: `Abonnement impayé : ${restaurant ?? sub.subscriberId}`,
    message: `${attempts} tentative${attempts > 1 ? 's' : ''} en échec — statut ${status === 'suspended' ? 'suspendu' : status === 'restricted' ? 'restreint' : 'impayé'}.`,
    target: { type: 'subscription', id: subRef.id, label: restaurant ?? null },
    countryId: sub.countryId,
    cityId: sub.cityId ?? null,
    metric: { value: attempts, threshold: settings.maxAttempts, unit: 'tentatives' },
    dedupKey: `subscription_unpaid:${subRef.id}`,
  });
  return attempt.note;
}

export const runDunning = onSchedule({ schedule: '0 8 * * *', timeZone: 'Europe/Paris', ...ARGENT_RUNTIME, timeoutSeconds: 540, secrets: [...EMAIL_SECRETS] }, async () => {
  const settings = await loadDunning();
  if (!settings.enabled) return;
  const due = await db.collection(COLLECTIONS.subscriptions).where('status', 'in', ['past_due', 'restricted']).limit(500).get();
  const now = Date.now();
  for (const doc of due.docs) {
    const sub = doc.data() as Subscription;
    const next = sub.dunning?.nextRetryAt?.toMillis() ?? 0;
    if (next > now || (sub as Subscription & { test?: boolean }).test) continue;
    try {
      await dunningStep(doc.ref, sub, settings, SYSTEM_ACTOR);
    } catch (error) {
      logger.error('Relance d’abonnement en échec', { subscriptionId: doc.id, error: String(error) });
    }
  }
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const manageSubscription = argentCallable(
  z.object({
    subscriptionId: zId,
    action: z.enum(['cancel', 'cancel_now', 'reactivate', 'extend_trial', 'suspend', 'restore', 'retry_payment', 'mark_paid', 'special_offer', 'clear_offer']),
    reason: zReason,
    days: z.number().int().min(1).max(365).nullish(),
    discountBps: zBps.nullish(),
    freeUntil: z.string().regex(DAY).nullish(),
    commissionReductionBps: z.number().int().min(0).max(5000).nullish(),
    offerEndsAt: z.string().regex(DAY).nullish(),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'subscriptions.manage');
    const ref = db.collection(COLLECTIONS.subscriptions).doc(data.subscriptionId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Abonnement');
    const sub = snap.data() as Subscription;
    assertAdminCovers(admin, sub.cityId ?? null);
    const actor = actorFromCaller(caller, 'admin');
    const now = Timestamp.now();
    const { cRef } = subscriberRefs(sub);
    const history = (event: Subscription['history'][number]['event'], planCode: PlanCode = sub.planCode) => ({ at: now, event, planCode, by: caller.uid, reason: data.reason });
    let result: Record<string, unknown> = {};

    switch (data.action) {
      case 'cancel': {
        if (sub.status === 'cancelled') throw fail.precondition('Cet abonnement est déjà résilié.');
        await ref.update({ cancelAtPeriodEnd: true, cancelReason: data.reason, history: FieldValue.arrayUnion(history('cancel_scheduled')), updatedAt: now, updatedBy: caller.uid });
        result = { effectiveAt: sub.currentPeriodEnd.toMillis() };
        break;
      }
      case 'cancel_now': {
        if (sub.status === 'cancelled') throw fail.precondition('Cet abonnement est déjà résilié.');
        await setStatus(ref, sub, 'cancelled', { cancelAtPeriodEnd: false, cancelledAt: now, cancelReason: data.reason, pendingChange: null, 'dunning.nextRetryAt': null, updatedBy: caller.uid }, history('cancelled'));
        await resolveAlert(`subscription_unpaid:${ref.id}`);
        break;
      }
      case 'reactivate': {
        if (sub.status !== 'cancelled' && !sub.cancelAtPeriodEnd) throw fail.precondition('Cet abonnement n’est pas résilié.');
        const periodEnd = new Date(now.toMillis());
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + (sub.billingCycle === 'yearly' ? 12 : 1));
        const renewal = sub.status === 'cancelled' ? { currentPeriodStart: now, currentPeriodEnd: Timestamp.fromDate(periodEnd) } : {};
        await setStatus(ref, sub, 'active', { cancelAtPeriodEnd: false, cancelledAt: null, cancelReason: null, ...renewal, updatedBy: caller.uid }, history('reactivated'));
        break;
      }
      case 'extend_trial': {
        if (!data.days) throw fail.invalid('Indiquez le nombre de jours.');
        const base = sub.trialEndsAt && sub.trialEndsAt.toMillis() > now.toMillis() ? sub.trialEndsAt.toMillis() : now.toMillis();
        const trialEndsAt = Timestamp.fromMillis(base + data.days * DAY_MS);
        await setStatus(ref, sub, sub.status === 'active' || sub.status === 'trialing' ? 'trialing' : sub.status, { trialEndsAt, updatedBy: caller.uid }, history('trial_extended'));
        result = { trialEndsAt: trialEndsAt.toMillis() };
        break;
      }
      case 'suspend': {
        if (sub.status === 'suspended' || sub.status === 'cancelled') throw fail.precondition('Cet abonnement est déjà suspendu ou résilié.');
        await setStatus(ref, sub, 'suspended', { 'dunning.suspendedAt': now, updatedBy: caller.uid }, history('suspended'));
        break;
      }
      case 'restore':
      case 'mark_paid': {
        if (!['past_due', 'restricted', 'suspended'].includes(sub.status)) throw fail.precondition('Cet abonnement n’est pas en impayé ni suspendu.');
        await setStatus(ref, sub, 'active', { dunning: { attempts: 0, lastAttemptAt: now, nextRetryAt: null, restrictedAt: null, firstFailedAt: null, suspendedAt: null, log: [...(sub.dunning?.log ?? []), logEntry('restored', data.reason)] }, updatedBy: caller.uid }, history('restored'));
        if (data.action === 'mark_paid') {
          const pendingInvoices = await db.collection(COLLECTIONS.invoices).where('recipient.id', '==', sub.subscriberId).where('compensation.status', '==', 'pending').limit(50).get();
          for (const doc of pendingInvoices.docs) await settleInvoiceByTransfer(doc.id, data.reason, caller.uid);
          const overdue = await db.collection(COLLECTIONS.invoices).where('subscriptionId', '==', data.subscriptionId).where('status', '==', 'overdue').limit(20).get();
          const batch = db.batch();
          for (const doc of overdue.docs) batch.update(doc.ref, { status: 'paid', paidAt: now });
          const failed = await db.collection(COLLECTIONS.payments).where('subscriptionId', '==', data.subscriptionId).where('status', '==', 'failed').limit(20).get();
          for (const doc of failed.docs) batch.update(doc.ref, { status: 'paid', failureCode: null, failureMessage: null, updatedAt: now });
          await batch.commit();
          result = { invoicesSettled: overdue.size + pendingInvoices.size };
        }
        const holds = await db.collection(COLLECTIONS.payoutHolds).where('beneficiaryId', '==', sub.subscriberId).where('active', '==', true).get();
        for (const hold of holds.docs) if (hold.get('reason') === 'unpaid_subscription') await hold.ref.update({ active: false, releasedAt: now, releasedBy: caller.uid });
        await resolveAlert(`subscription_unpaid:${ref.id}`);
        break;
      }
      case 'retry_payment': {
        if (!['past_due', 'restricted', 'suspended'].includes(sub.status)) throw fail.precondition('Aucun impayé à relancer sur cet abonnement.');
        const note = await dunningStep(ref, sub, await loadDunning(), actor);
        result = { note };
        break;
      }
      case 'special_offer': {
        if (!data.offerEndsAt) throw fail.invalid('Indiquez la date de fin de l’offre.');
        if (!data.discountBps && !data.freeUntil && !data.commissionReductionBps) throw fail.invalid('Choisissez au moins un avantage (remise, gratuité ou réduction de commission).');
        const endsAt = Timestamp.fromDate(parisTime(addDays(data.offerEndsAt, 1), 0));
        if (endsAt.toMillis() <= now.toMillis()) throw fail.invalid('La fin de l’offre doit être dans le futur.');
        const freeUntil = data.freeUntil ? Timestamp.fromDate(parisTime(addDays(data.freeUntil, 1), 0)) : null;
        const batch = db.batch();
        batch.update(ref, { specialOffer: { discountBps: data.discountBps ?? 0, freeUntil, reason: data.reason, endsAt }, history: FieldValue.arrayUnion(history('offer_applied')), updatedAt: now, updatedBy: caller.uid });
        batch.set(cRef, { specialOffer: { commissionReductionBps: data.commissionReductionBps ?? 0, subscriptionFreeUntil: freeUntil, reason: data.reason, endsAt }, updatedAt: now, updatedBy: caller.uid }, { merge: true });
        await batch.commit();
        break;
      }
      case 'clear_offer': {
        const batch = db.batch();
        batch.update(ref, { specialOffer: null, history: FieldValue.arrayUnion(history('offer_removed')), updatedAt: now, updatedBy: caller.uid });
        batch.set(cRef, { specialOffer: null, updatedAt: now, updatedBy: caller.uid }, { merge: true });
        await batch.commit();
        break;
      }
    }
    const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(sub.subscriberId).get()).get('name') as string | undefined;
    await writeAudit({ actor, action: `subscription.${data.action}`, target: { type: 'subscription', id: data.subscriptionId, label: restaurant ?? sub.subscriberId }, reason: data.reason, before: { status: sub.status, planCode: sub.planCode }, after: { action: data.action, ...result }, countryId: sub.countryId, cityId: sub.cityId ?? null, request, sensitive: true });
    return { ok: true, ...result };
  },
  { secrets: [...EMAIL_SECRETS] },
);

/** Résiliations programmées arrivées à échéance (chaque nuit). */
export const applyScheduledCancellations = onSchedule({ schedule: '20 0 * * *', timeZone: 'Europe/Paris', ...ARGENT_RUNTIME }, async () => {
  const now = Timestamp.now();
  const due = await db.collection(COLLECTIONS.subscriptions).where('cancelAtPeriodEnd', '==', true).limit(300).get();
  for (const doc of due.docs) {
    const sub = doc.data() as Subscription;
    if (sub.status === 'cancelled' || sub.currentPeriodEnd.toMillis() > now.toMillis()) continue;
    await setStatus(doc.ref, sub, 'cancelled', { cancelAtPeriodEnd: false, cancelledAt: now }, { at: now, event: 'cancelled', planCode: sub.planCode, by: 'system', reason: sub.cancelReason ?? 'Résiliation en fin de période' });
    await writeAudit({ actor: SYSTEM_ACTOR, action: 'subscription.cancelled', target: { type: 'subscription', id: doc.id }, reason: sub.cancelReason ?? null, countryId: sub.countryId, cityId: sub.cityId ?? null });
  }
});

