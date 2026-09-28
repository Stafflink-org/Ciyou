// Changement de formule d'abonnement demandé par le restaurant.
// Passage à une formule supérieure : effet immédiat (essai offert s'il n'a jamais
// été utilisé). Passage à une formule inférieure : programmé en fin de période.
// Choisir à nouveau la formule actuelle annule un changement programmé.
import {
  COLLECTIONS,
  DEFAULT_PLANS,
  type Plan,
  type PlanCode,
  type Restaurant,
  type RestaurantCommercial,
  type Subscription,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import { commercialRef, fallbackPlan, restaurantRef, CONFIG_FUNCTION_OPTIONS, CONFIG_TRIGGER_OPTIONS } from './config-context';

const DAY_MS = 86_400_000;
const BLOCKING_STATUSES: Subscription['status'][] = ['past_due', 'restricted', 'suspended'];

/** Rang d'une formule (Basic < Pro < Premium) : ordre du catalogue, sinon ordre par défaut. */
function defaultRank(code: PlanCode): number {
  return Math.max(0, DEFAULT_PLANS.findIndex((p) => p.code === code));
}

async function planPrice(
  code: PlanCode,
): Promise<{ price: number; trialDays: number; name: string; active: boolean; countryIds: string[]; rank: number }> {
  const snap = await db.collection(COLLECTIONS.plans).doc(code).get();
  if (snap.exists) {
    const plan = snap.data() as Plan;
    return {
      price: plan.monthlyPriceHtCents,
      trialDays: plan.trialDays,
      name: plan.name,
      active: plan.active,
      countryIds: plan.countryIds ?? [],
      rank: defaultRank(code),
    };
  }
  const fallback = fallbackPlan(code);
  return { price: fallback.monthlyPriceHtCents, trialDays: fallback.trialDays, name: fallback.name, active: true, countryIds: [], rank: defaultRank(code) };
}

function addMonth(ms: number): number {
  const date = new Date(ms);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime();
}

const schema = z.object({
  restaurantId: zId,
  planCode: z.enum(DEFAULT_PLANS.map((p) => p.code) as [PlanCode, ...PlanCode[]]),
  reason: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
});

export const changePlan = callable(schema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'finance.view', 'subscriptions.manage');
  if (actor.kind === 'member' && actor.member.role !== 'owner') {
    throw fail.forbidden('Seul le propriétaire peut changer la formule d’abonnement.');
  }
  const target = await planPrice(data.planCode);
  const rRef = restaurantRef(data.restaurantId);
  const cRef = commercialRef(data.restaurantId);
  const now = Timestamp.now();
  const uid = actor.caller.uid;

  const outcome = await db.runTransaction(async (tx) => {
    const [rSnap, cSnap] = await Promise.all([tx.get(rRef), tx.get(cRef)]);
    if (!rSnap.exists) throw fail.notFound('Restaurant');
    const restaurant = rSnap.data() as Restaurant;
    const commercial = cSnap.exists ? (cSnap.data() as RestaurantCommercial) : null;
    if (!target.active || (target.countryIds.length > 0 && !target.countryIds.includes(restaurant.countryId))) {
      throw fail.precondition('Cette formule n’est pas proposée dans votre pays.');
    }
    const currentCode = commercial?.planCode ?? restaurant.planCode;
    const current = await planPrice(currentCode);

    const subRef: DocumentReference = commercial?.subscriptionId
      ? db.collection(COLLECTIONS.subscriptions).doc(commercial.subscriptionId)
      : db.collection(COLLECTIONS.subscriptions).doc(`sub-${data.restaurantId}`);
    const subSnap = await tx.get(subRef);
    const subscription = subSnap.exists ? (subSnap.data() as Subscription) : null;
    if (subscription && BLOCKING_STATUSES.includes(subscription.status)) {
      throw fail.precondition('Votre abonnement présente un impayé : réglez-le avant de changer de formule.');
    }

    // Même formule : annulation d'un éventuel changement programmé.
    if (data.planCode === currentCode) {
      if (!subscription?.pendingChange) throw fail.precondition('C’est déjà votre formule actuelle.');
      tx.update(subRef, { pendingChange: null, updatedAt: now, updatedBy: uid });
      return { kind: 'cancelled' as const, restaurant, from: currentCode, effectiveAt: null };
    }

    const upgrade = target.rank > current.rank;
    if (!upgrade) {
      // Formule inférieure : effet à la fin de la période en cours.
      const effectiveAt = subscription?.currentPeriodEnd ?? now;
      if (!subscription || effectiveAt.toMillis() <= now.toMillis()) {
        applyPlan(tx, { rRef, cRef, subRef, subscription, restaurant, planCode: data.planCode, price: target.price, uid, now, event: 'downgraded', reason: data.reason });
        return { kind: 'applied' as const, restaurant, from: currentCode, effectiveAt: now };
      }
      tx.update(subRef, {
        pendingChange: { planCode: data.planCode, effectiveAt, requestedAt: now, requestedBy: uid, reason: data.reason },
        updatedAt: now,
        updatedBy: uid,
      });
      return { kind: 'scheduled' as const, restaurant, from: currentCode, effectiveAt };
    }

    // Formule supérieure : immédiat, avec essai si jamais utilisé.
    const trialEligible = target.trialDays > 0 && !subscription?.trialEndsAt;
    applyPlan(tx, {
      rRef,
      cRef,
      subRef,
      subscription,
      restaurant,
      planCode: data.planCode,
      price: target.price,
      uid,
      now,
      event: 'upgraded',
      reason: data.reason,
      trialEndsAt: trialEligible ? Timestamp.fromMillis(now.toMillis() + target.trialDays * DAY_MS) : null,
    });
    return { kind: 'applied' as const, restaurant, from: currentCode, effectiveAt: now, trial: trialEligible };
  });

  await writeAudit({
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action: outcome.kind === 'cancelled' ? 'subscription.change_cancelled' : outcome.kind === 'scheduled' ? 'subscription.change_scheduled' : 'subscription.plan_changed',
    target: { type: 'restaurant', id: data.restaurantId, label: outcome.restaurant.name },
    reason: data.reason,
    before: { planCode: outcome.from },
    after: { planCode: data.planCode, effectiveAt: outcome.effectiveAt?.toMillis() ?? null },
    countryId: outcome.restaurant.countryId,
    cityId: outcome.restaurant.cityId,
    sensitive: true,
    request,
  });
  return {
    status: outcome.kind,
    planCode: data.planCode,
    effectiveAt: outcome.effectiveAt?.toMillis() ?? null,
    trial: 'trial' in outcome ? Boolean(outcome.trial) : false,
  };
},
  CONFIG_FUNCTION_OPTIONS,
);

interface ApplyInput {
  rRef: DocumentReference;
  cRef: DocumentReference;
  subRef: DocumentReference;
  subscription: Subscription | null;
  restaurant: Restaurant;
  planCode: PlanCode;
  price: number;
  uid: string;
  now: Timestamp;
  event: 'upgraded' | 'downgraded';
  reason: string | null;
  trialEndsAt?: Timestamp | null;
}

function applyPlan(tx: Transaction, input: ApplyInput): void {
  const { now, uid } = input;
  const historyEntry = { at: now, event: input.event, planCode: input.planCode, by: uid, reason: input.reason };
  const status: Subscription['status'] = input.trialEndsAt ? 'trialing' : 'active';
  if (input.subscription) {
    tx.update(input.subRef, {
      planCode: input.planCode,
      priceHtCents: input.price,
      status,
      ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
      pendingChange: null,
      history: [...(input.subscription.history ?? []), historyEntry],
      updatedAt: now,
      updatedBy: uid,
    });
  } else {
    const periodEnd = Timestamp.fromMillis(addMonth(now.toMillis()));
    const subscription: Subscription = {
      subscriberType: 'restaurant',
      subscriberId: input.rRef.id,
      restaurantIds: [input.rRef.id],
      planCode: input.planCode,
      status,
      billingCycle: 'monthly',
      priceHtCents: input.price,
      trialEndsAt: input.trialEndsAt ?? null,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      cancelReason: null,
      specialOffer: null,
      dunning: { attempts: 0, lastAttemptAt: null, nextRetryAt: null, restrictedAt: null },
      history: [{ ...historyEntry, event: 'created' }],
      stripeSubscriptionId: null,
      pendingChange: null,
      countryId: input.restaurant.countryId,
      cityId: input.restaurant.cityId,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    };
    tx.set(input.subRef, subscription);
  }
  tx.set(
    input.cRef,
    { planCode: input.planCode, subscriptionId: input.subRef.id, subscriptionStatus: status, updatedAt: now, updatedBy: uid },
    { merge: true },
  );
  tx.update(input.rRef, { planCode: input.planCode, updatedAt: now, updatedBy: uid });
}

/** Chaque nuit : application des changements de formule arrivés à échéance. */
export const applyPendingPlanChanges = onSchedule({ ...CONFIG_TRIGGER_OPTIONS, schedule: '15 0 * * *', timeZone: 'Europe/Paris' }, async () => {
  const now = Timestamp.now();
  const due = await db.collection(COLLECTIONS.subscriptions).where('pendingChange.effectiveAt', '<=', now).limit(200).get();
  for (const doc of due.docs) {
    const sub = doc.data() as Subscription;
    const change = sub.pendingChange;
    if (!change || sub.subscriberType !== 'restaurant') continue;
    try {
      const target = await planPrice(change.planCode);
      await db.runTransaction(async (tx) => {
        const rRef = restaurantRef(sub.subscriberId);
        const rSnap = await tx.get(rRef);
        if (!rSnap.exists) return;
        applyPlan(tx, {
          rRef,
          cRef: commercialRef(sub.subscriberId),
          subRef: doc.ref,
          subscription: sub,
          restaurant: rSnap.data() as Restaurant,
          planCode: change.planCode,
          price: target.price,
          uid: 'system',
          now,
          event: 'downgraded',
          reason: change.reason ?? null,
        });
      });
      await writeAudit({
        actor: SYSTEM_ACTOR,
        action: 'subscription.plan_changed',
        target: { type: 'restaurant', id: sub.subscriberId },
        before: { planCode: sub.planCode },
        after: { planCode: change.planCode },
        countryId: sub.countryId,
        cityId: sub.cityId ?? null,
      });
    } catch (error) {
      logger.error('Changement de formule non appliqué', { subscriptionId: doc.id, error: String(error) });
    }
  }
});
