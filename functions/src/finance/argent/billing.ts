// Cycle de vie réel des abonnements : conversion de l'essai, renouvellement de la
// période, compensation des frais d'abonnement sur les reversements du commerce et
// régularisation des impayés. Il n'y a pas de prélèvement carte : l'abonnement et les
// mises en avant facturées sont retenus sur les reversements (écritures négatives du
// grand livre) ; tant que le solde à reverser du commerce ne les couvre pas, la facture
// reste « à compenser » et l'abonnement passe en impayé (relances, restriction, suspension).
import {
  COLLECTIONS,
  DEFAULT_DUNNING_SETTINGS,
  RESTAURANT_PRIVATE_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type DunningSettings,
  type Invoice,
  type LedgerEntry,
  type Restaurant,
  type Subscription,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { raiseAlert, resolveAlert } from './alerts';
import { DAY_MS, euros } from './common';
import { messageRestaurantFinance } from './notify';
import { ARGENT_RUNTIME } from './runtime';

const UNPAID = ['past_due', 'restricted', 'suspended'] as const;

/** Solde à reverser d'un commerce : somme des mouvements du grand livre non encore reversés (ventes − retenues). */
export async function restaurantBalanceCents(restaurantId: string): Promise<number> {
  const snap = await db.collection(COLLECTIONS.ledgerEntries).where('accountType', '==', 'restaurant').where('accountId', '==', restaurantId).where('payoutId', '==', null).limit(20_000).get();
  return snap.docs.reduce((sum, doc) => sum + ((doc.get('amountCents') as number | undefined) ?? 0), 0);
}

/** Écritures de retenue d'une facture (abonnement, mises en avant), au grand livre du commerce. */
export function feeLedgerEntries(input: {
  invoiceId: string;
  restaurantId: string;
  subscriptionId: string | null;
  countryId: string;
  cityId: string | null;
  currency: LedgerEntry['currency'];
  subscriptionTtcCents: number;
  sponsoredTtcCents: number;
  bookingDate: string;
  issuedAt: Timestamp;
  test: boolean;
}): Array<{ id: string; entry: LedgerEntry & { test?: boolean } }> {
  const base = { countryId: input.countryId, cityId: input.cityId, accountType: 'restaurant' as const, accountId: input.restaurantId, currency: input.currency, vatCents: null, invoiceId: input.invoiceId, subscriptionId: input.subscriptionId, payoutId: null, bookingDate: input.bookingDate, createdAt: input.issuedAt, createdBy: 'system', ...(input.test ? { test: true } : {}) };
  const out: Array<{ id: string; entry: LedgerEntry & { test?: boolean } }> = [];
  if (input.subscriptionTtcCents !== 0) out.push({ id: `${input.invoiceId}-abo`, entry: { ...base, type: 'subscription_fee', amountCents: -input.subscriptionTtcCents, description: 'Abonnement Ciyou Eats' } });
  if (input.sponsoredTtcCents !== 0) out.push({ id: `${input.invoiceId}-pub`, entry: { ...base, type: 'sponsored_placement', amountCents: -input.sponsoredTtcCents, description: 'Mises en avant Ciyou Eats' } });
  return out;
}

async function subscriptionsOf(restaurantId: string) {
  const snap = await db.collection(COLLECTIONS.subscriptions).where('subscriberId', '==', restaurantId).limit(5).get();
  return snap.docs.filter((d) => d.get('subscriberType') === 'restaurant');
}

/** Rétablit un abonnement impayé une fois la dette compensée ou réglée. */
export async function restoreSubscription(restaurantId: string, reason: string, actorUid: string): Promise<boolean> {
  const restored: string[] = [];
  for (const doc of await subscriptionsOf(restaurantId)) {
    const sub = doc.data() as Subscription;
    if (!(UNPAID as readonly string[]).includes(sub.status)) continue;
    const now = Timestamp.now();
    const rRef = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
    const batch = db.batch();
    batch.update(doc.ref, {
      status: 'active',
      dunning: { attempts: 0, lastAttemptAt: now, nextRetryAt: null, restrictedAt: null, firstFailedAt: null, suspendedAt: null, log: [...(sub.dunning?.log ?? []), { at: now, kind: 'restored', note: reason }] },
      history: FieldValue.arrayUnion({ at: now, event: 'restored', planCode: sub.planCode, by: actorUid, reason }),
      updatedAt: now,
    });
    batch.set(rRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial), { subscriptionStatus: 'active', updatedAt: now, updatedBy: actorUid }, { merge: true });
    await batch.commit();
    await resolveAlert(`subscription_unpaid:${doc.id}`);
    restored.push(doc.id);
  }
  if (restored.length === 0) return false;
  const holds = await db.collection(COLLECTIONS.payoutHolds).where('beneficiaryId', '==', restaurantId).where('active', '==', true).get();
  for (const hold of holds.docs) {
    if (hold.get('reason') === 'unpaid_subscription') await hold.ref.update({ active: false, releasedAt: Timestamp.now(), releasedBy: actorUid });
  }
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get()).data() as (Restaurant & { test?: boolean }) | undefined;
  await messageRestaurantFinance(restaurantId, 'subscription_restored', { restaurantName: restaurant?.name ?? '' }, { dedupeKey: `restored-${restored[0]}-${Date.now()}` }, restaurant?.test === true);
  await writeAudit({ actor: SYSTEM_ACTOR, action: 'subscription.restored', target: { type: 'restaurant', id: restaurantId, label: restaurant?.name ?? null }, reason, after: { subscriptions: restored }, countryId: restaurant?.countryId ?? null, cityId: restaurant?.cityId ?? null });
  return true;
}

export interface SettleResult {
  settled: number;
  balanceCents: number;
  dueCents: number;
}

/**
 * Compense les factures en attente d'un commerce quand son solde à reverser (retenues
 * comprises) redevient positif ou nul, puis rétablit son abonnement s'il était impayé.
 */
export async function settleSubscriptionDebts(restaurantId: string, actorUid = 'system'): Promise<SettleResult> {
  const pending = await db.collection(COLLECTIONS.invoices).where('recipient.id', '==', restaurantId).where('compensation.status', '==', 'pending').limit(50).get();
  if (pending.empty) return { settled: 0, balanceCents: 0, dueCents: 0 };
  const dueCents = pending.docs.reduce((s, d) => s + (((d.data() as Invoice).compensation?.debitCents) ?? 0), 0);
  const balanceCents = await restaurantBalanceCents(restaurantId);
  if (balanceCents < 0) return { settled: 0, balanceCents, dueCents };
  const now = Timestamp.now();
  const batch = db.batch();
  for (const doc of pending.docs) batch.update(doc.ref, { status: 'paid', paidAt: now, 'compensation.status': 'done', 'compensation.settledAt': now });
  await batch.commit();
  await restoreSubscription(restaurantId, 'Facture compensée sur les reversements', actorUid);
  return { settled: pending.size, balanceCents, dueCents };
}

/** Le commerce a-t-il des retenues d'abonnement en attente de compensation ? */
export async function hasPendingCompensation(restaurantId: string): Promise<boolean> {
  const snap = await db.collection(COLLECTIONS.invoices).where('recipient.id', '==', restaurantId).where('compensation.status', '==', 'pending').limit(1).get();
  return !snap.empty;
}

/**
 * Renouvelle chaque nuit les abonnements : fin d'essai (conversion en abonnement actif) et
 * nouvelle période quand la précédente est écoulée. La facturation suit le calendrier mensuel.
 */
export async function runRenewals(now = Timestamp.now(), only: string[] | null = null): Promise<{ converted: number; renewed: number }> {
  let converted = 0;
  let renewed = 0;
  const trials = await db.collection(COLLECTIONS.subscriptions).where('status', '==', 'trialing').limit(500).get();
  for (const doc of trials.docs) {
    const sub = doc.data() as Subscription & { test?: boolean };
    if (only ? !only.includes(sub.subscriberId) : sub.test) continue;
    if (!sub.trialEndsAt || sub.trialEndsAt.toMillis() > now.toMillis()) continue;
    const end = new Date(now.toMillis());
    end.setUTCMonth(end.getUTCMonth() + (sub.billingCycle === 'yearly' ? 12 : 1));
    const rRef = db.collection(COLLECTIONS.restaurants).doc(sub.subscriberId);
    const batch = db.batch();
    batch.update(doc.ref, { status: 'active', currentPeriodStart: now, currentPeriodEnd: Timestamp.fromDate(end), history: FieldValue.arrayUnion({ at: now, event: 'trial_converted', planCode: sub.planCode, by: 'system', reason: 'Fin de l’essai gratuit : abonnement payant' }), updatedAt: now });
    batch.set(rRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial), { subscriptionStatus: 'active', updatedAt: now, updatedBy: 'system' }, { merge: true });
    await batch.commit();
    await writeAudit({ actor: SYSTEM_ACTOR, action: 'subscription.trial_converted', target: { type: 'subscription', id: doc.id }, countryId: sub.countryId, cityId: sub.cityId ?? null });
    converted += 1;
  }
  const active = await db.collection(COLLECTIONS.subscriptions).where('status', 'in', ['active', 'past_due', 'restricted']).where('currentPeriodEnd', '<=', now).limit(500).get();
  for (const doc of active.docs) {
    const sub = doc.data() as Subscription & { test?: boolean };
    if (only ? !only.includes(sub.subscriberId) : sub.test) continue;
    if (sub.cancelAtPeriodEnd) continue;
    const cycleMonths = sub.billingCycle === 'yearly' ? 12 : 1;
    // Avance par périodes entières jusqu'à dépasser l'instant présent (rattrapage après une interruption).
    let start = sub.currentPeriodEnd.toDate();
    let end = new Date(start);
    do {
      start = new Date(end);
      end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + cycleMonths);
    } while (end.getTime() <= now.toMillis());
    await doc.ref.update({ currentPeriodStart: Timestamp.fromDate(start), currentPeriodEnd: Timestamp.fromDate(end), history: FieldValue.arrayUnion({ at: now, event: 'renewed', planCode: sub.planCode, by: 'system', reason: 'Renouvellement de la période' }), updatedAt: now });
    renewed += 1;
  }
  return { converted, renewed };
}

export const renewSubscriptions = onSchedule({ schedule: '40 0 * * *', timeZone: 'Europe/Paris', ...ARGENT_RUNTIME, timeoutSeconds: 300 }, async () => {
  const result = await runRenewals();
  if (result.converted || result.renewed) logger.info('Abonnements renouvelés', result);
});

export async function loadDunning(): Promise<Omit<DunningSettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.dunning).get();
  return { ...DEFAULT_DUNNING_SETTINGS, ...(snap.exists ? (snap.data() as Partial<DunningSettings>) : {}) };
}

/**
 * Ouvre l'impayé : la facture d'abonnement n'a pas pu être retenue sur les reversements.
 * L'abonnement passe en « impayé » (les relances, la restriction et la suspension suivent
 * les règles de relance), une alerte remonte au tableau de bord et le commerce est prévenu.
 */
export async function openSubscriptionDebt(input: { restaurantId: string; invoiceId: string; invoiceNumber: string; debitCents: number; demo: boolean }): Promise<void> {
  const settings = await loadDunning();
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(input.restaurantId).get()).data() as Restaurant | undefined;
  const now = Timestamp.now();
  const subs = await subscriptionsOf(input.restaurantId);
  const nextRetryAt = Timestamp.fromMillis(now.toMillis() + settings.retryIntervalDays * DAY_MS);
  let subscriptionId: string | null = null;
  for (const doc of subs) {
    const sub = doc.data() as Subscription;
    if (!['active', 'trialing'].includes(sub.status)) continue;
    subscriptionId = doc.id;
    const rRef = db.collection(COLLECTIONS.restaurants).doc(input.restaurantId);
    const batch = db.batch();
    batch.update(doc.ref, {
      status: 'past_due',
      dunning: { attempts: 0, lastAttemptAt: null, nextRetryAt, restrictedAt: null, firstFailedAt: now, suspendedAt: null, log: [...(sub.dunning?.log ?? []), { at: now, kind: 'retry_failed', note: `Facture ${input.invoiceNumber} non compensée : solde à reverser insuffisant.` }] },
      history: FieldValue.arrayUnion({ at: now, event: 'past_due', planCode: sub.planCode, by: 'system', reason: `Facture ${input.invoiceNumber} impayée` }),
      updatedAt: now,
    });
    batch.set(rRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial), { subscriptionStatus: 'past_due', updatedAt: now, updatedBy: 'system' }, { merge: true });
    await batch.commit();
    break;
  }
  await raiseAlert({
    kind: 'subscription_unpaid',
    severity: 'warning',
    title: `Abonnement impayé : ${restaurant?.name ?? input.restaurantId}`,
    message: `Facture ${input.invoiceNumber} (${euros(input.debitCents)}) non compensée : le solde à reverser du commerce est insuffisant.`,
    target: subscriptionId ? { type: 'subscription', id: subscriptionId, label: restaurant?.name ?? null } : { type: 'restaurant', id: input.restaurantId, label: restaurant?.name ?? null },
    countryId: restaurant?.countryId ?? null,
    cityId: restaurant?.cityId ?? null,
    metric: { value: input.debitCents, threshold: 0, unit: 'centimes' },
    dedupKey: subscriptionId ? `subscription_unpaid:${subscriptionId}` : `subscription_unpaid:${input.restaurantId}`,
  });
  const days = settings.retryIntervalDays * settings.maxAttempts;
  await messageRestaurantFinance(
    input.restaurantId,
    'subscription_payment_due',
    { invoiceNumber: input.invoiceNumber, amount: euros(input.debitCents), date: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date(now.toMillis() + days * DAY_MS)) },
    { dedupeKey: `due-${input.invoiceId}`, ctaUrl: null },
    input.demo,
  );
}

/**
 * Règlement d'une facture en attente de compensation hors reversement (virement reçu) : la
 * retenue au grand livre est annulée par une écriture inverse, la facture est marquée payée
 * et l'abonnement rétabli si plus rien n'est dû.
 */
export async function settleInvoiceByTransfer(invoiceId: string, reason: string, actorUid: string): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.invoices).doc(invoiceId);
  const now = Timestamp.now();
  const invoice = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as Invoice | undefined;
    if (!data || data.compensation?.status !== 'pending') return null;
    const debit = data.compensation.debitCents;
    tx.update(ref, { status: 'paid', paidAt: now, 'compensation.status': 'done', 'compensation.settledAt': now, 'compensation.method': 'transfer' });
    const entry: LedgerEntry = {
      countryId: data.countryId,
      cityId: data.cityId ?? null,
      accountType: 'restaurant',
      accountId: data.recipient.id,
      type: 'manual_adjustment',
      amountCents: debit,
      currency: data.currency,
      vatCents: null,
      invoiceId,
      subscriptionId: data.subscriptionId ?? null,
      payoutId: null,
      description: `Facture ${data.number} réglée par virement`,
      reason,
      bookingDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now.toDate()),
      createdAt: now,
      createdBy: actorUid,
    };
    tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(`${invoiceId}-vir`), entry);
    return data;
  });
  if (!invoice) return false;
  if (!(await hasPendingCompensation(invoice.recipient.id))) await restoreSubscription(invoice.recipient.id, reason, actorUid);
  return true;
}
