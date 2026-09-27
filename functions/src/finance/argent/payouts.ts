// Reversements des commerces et des livreurs.
// - buildPayouts (planifiée chaque nuit) regroupe les mouvements du grand livre non
//   encore reversés, selon le calendrier (settings/payouts, surcharge par commerce).
// - executePayouts (planifiée) et executePayout (manuelle) virent le net par Stripe
//   Connect (transfert vers le compte connecté, mode test ou live selon la clé).
// - holdPayouts / releasePayoutHold suspendent et rétablissent les reversements.
// - createAdjustment et recordCashRemittance écrivent des mouvements manuels motivés.
import {
  COLLECTIONS,
  PAYOUT_HOLD_REASONS,
  RESTAURANT_PRIVATE_DOCS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type BuildPayoutsResult,
  type DriverPrivate,
  type LedgerEntry,
  type Payout,
  type PayoutHold,
  type PayoutSettings,
  type Restaurant,
  type RestaurantCommercial,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit, type AuditActor } from '../../lib/audit';
import { APP_URLS } from '../../lib/config';
import { currencyOfCountry, stripeCurrency } from '../../lib/currency';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { EMAIL_SECRETS, STRIPE_SECRET_KEY } from '../../lib/secrets';
import { sendPlatformMessage } from '../../notifications/messages';
import { getStripe, isStripeLiveMode } from '../../lib/stripe';
import { z, zId, zReason } from '../../lib/validation';
import { raiseAlert, resolveAlert } from './alerts';
import { addDays, chunk, euros, loadCountry, parisDay, parisTime, weekdayOf, zDay } from './common';
import { settleSubscriptionDebts } from './billing';
import { cashLimitOf, mirrorCourierCash } from './cash';
import { messageRestaurantFinance } from './notify';
import { ARGENT_RUNTIME, argentCallable } from './runtime';

type Beneficiary = 'restaurant' | 'driver';

const DEFAULT_SCHEDULE: Omit<PayoutSettings, 'updatedAt' | 'updatedBy'> = {
  restaurants: { frequency: 'weekly', dayOfWeek: 0, minimumCents: 1000, delayDays: 2 },
  drivers: { frequency: 'weekly', dayOfWeek: 0, minimumCents: 500, delayDays: 1 },
};

async function loadSchedule(): Promise<Omit<PayoutSettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.payouts).get();
  const data = snap.exists ? (snap.data() as PayoutSettings) : null;
  return {
    restaurants: { ...DEFAULT_SCHEDULE.restaurants, ...(data?.restaurants ?? {}) },
    drivers: { ...DEFAULT_SCHEDULE.drivers, ...(data?.drivers ?? {}) },
  };
}

/** Le calendrier déclenche-t-il un reversement le jour `day` ? */
function isPayoutDay(day: string, frequency: 'weekly' | 'biweekly' | 'monthly', dayOfWeek: number): boolean {
  if (frequency === 'monthly') return day.endsWith('-01');
  if (weekdayOf(day) !== dayOfWeek) return false;
  if (frequency === 'weekly') return true;
  // Tous les 15 jours : semaines paires depuis le 5 janvier 2026 (lundi de référence).
  const weeks = Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse('2026-01-05T00:00:00Z')) / (7 * 86_400_000));
  return weeks % 2 === 0;
}

const accountTypesOf = (type: Beneficiary): LedgerEntry['accountType'][] => (type === 'restaurant' ? ['restaurant'] : ['driver', 'driver_cash']);

function breakdown(entries: LedgerEntry[]) {
  let gross = 0;
  let commission = 0;
  let refunds = 0;
  let adjustments = 0;
  let tips = 0;
  let cash = 0;
  let net = 0;
  for (const e of entries) {
    net += e.amountCents;
    switch (e.type) {
      case 'order_revenue':
      case 'delivery_fee':
      case 'courier_earning':
      case 'courier_bonus':
      case 'hourly_guarantee_topup':
        gross += e.amountCents;
        break;
      case 'courier_tip':
        tips += e.amountCents;
        break;
      case 'commission':
        commission += -e.amountCents;
        break;
      case 'refund_charge':
        refunds += -e.amountCents;
        break;
      case 'cash_collected':
      case 'cash_remitted':
        cash += -e.amountCents;
        break;
      default:
        adjustments += e.amountCents;
    }
  }
  return { gross, commission, refunds, adjustments, tips, cash, net };
}

interface BeneficiaryInfo {
  name: string;
  countryId: string;
  cityId: string | null;
  blocked: boolean;
  frequency: 'weekly' | 'biweekly' | 'monthly' | null;
}

async function beneficiaryInfo(type: Beneficiary, id: string): Promise<BeneficiaryInfo | null> {
  if (type === 'restaurant') {
    const ref = db.collection(COLLECTIONS.restaurants).doc(id);
    const [snap, commercial] = await Promise.all([ref.get(), ref.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).get()]);
    if (!snap.exists) return null;
    const r = snap.data() as Restaurant;
    const c = commercial.exists ? (commercial.data() as RestaurantCommercial) : null;
    return { name: r.name, countryId: r.countryId, cityId: r.cityId, blocked: c?.payoutsBlocked === true, frequency: c?.payoutFrequency ?? null };
  }
  const [snap, priv] = await Promise.all([db.collection(COLLECTIONS.drivers).doc(id).get(), db.collection(COLLECTIONS.driverPrivate).doc(id).get()]);
  if (!snap.exists) return null;
  const d = snap.data() as { firstName: string; lastName: string; countryId: string; cityId: string };
  return { name: `${d.firstName} ${d.lastName}`.trim(), countryId: d.countryId, cityId: d.cityId, blocked: priv.exists && (priv.data() as DriverPrivate).payoutsBlocked === true, frequency: null };
}

async function activeHold(type: Beneficiary, id: string): Promise<{ id: string; hold: PayoutHold } | null> {
  const snap = await db.collection(COLLECTIONS.payoutHolds).where('beneficiaryId', '==', id).where('active', '==', true).limit(5).get();
  const doc = snap.docs.find((d) => d.get('beneficiaryType') === type);
  return doc ? { id: doc.id, hold: doc.data() as PayoutHold } : null;
}

/** Reversement automatique par Stripe Connect, ou virement manuel là où Stripe n'est pas disponible. */
export async function payoutProviderOf(countryId: string): Promise<'stripe' | 'manual'> {
  const country = await loadCountry(countryId);
  return country?.stripeAvailable === false ? 'manual' : 'stripe';
}

export interface BuildOptions {
  type: Beneficiary;
  until: string;
  beneficiaryId?: string | null;
  dryRun?: boolean;
  /** Ignorer le calendrier (reversement manuel). */
  force?: boolean;
  actorUid: string;
}

export async function runBuildPayouts(options: BuildOptions): Promise<BuildPayoutsResult> {
  const schedule = await loadSchedule();
  const rule = options.type === 'restaurant' ? schedule.restaurants : schedule.drivers;
  const entriesByAccount = new Map<string, Array<{ id: string; entry: LedgerEntry }>>();
  for (const accountType of accountTypesOf(options.type)) {
    let query = db.collection(COLLECTIONS.ledgerEntries).where('accountType', '==', accountType).where('payoutId', '==', null).where('bookingDate', '<=', options.until);
    if (options.beneficiaryId) query = query.where('accountId', '==', options.beneficiaryId);
    const snap = await query.limit(10_000).get();
    for (const doc of snap.docs) {
      const entry = doc.data() as LedgerEntry;
      const list = entriesByAccount.get(entry.accountId) ?? [];
      list.push({ id: doc.id, entry });
      entriesByAccount.set(entry.accountId, list);
    }
  }

  const result: BuildPayoutsResult = { created: 0, skippedBelowMinimum: 0, skippedHeld: 0, totalNetCents: 0, preview: [] };
  for (const [accountId, list] of entriesByAccount) {
    const info = await beneficiaryInfo(options.type, accountId);
    if (!info) continue;
    const frequency = info.frequency ?? rule.frequency;
    if (!options.force && !isPayoutDay(addDays(options.until, 1), frequency, rule.dayOfWeek)) continue;
    const sums = breakdown(list.map((x) => x.entry));
    const hold = await activeHold(options.type, accountId);
    const held = Boolean(hold) || info.blocked;
    if (!held && sums.net < rule.minimumCents) {
      result.skippedBelowMinimum += 1;
      result.preview.push({ beneficiaryId: accountId, beneficiaryName: info.name, netCents: sums.net, entries: list.length, status: 'below_minimum' });
      continue;
    }
    if (sums.net <= 0) {
      result.skippedBelowMinimum += 1;
      result.preview.push({ beneficiaryId: accountId, beneficiaryName: info.name, netCents: sums.net, entries: list.length, status: 'below_minimum' });
      continue;
    }
    if (held) result.skippedHeld += 1;
    result.preview.push({ beneficiaryId: accountId, beneficiaryName: info.name, netCents: sums.net, entries: list.length, status: held ? 'on_hold' : 'scheduled' });
    result.totalNetCents += sums.net;
    if (options.dryRun) continue;

    const periodStart = list.reduce((min, x) => (x.entry.bookingDate < min ? x.entry.bookingDate : min), options.until);
    const payoutId = `po-${options.type === 'restaurant' ? 'r' : 'd'}-${accountId}-${options.until}`;
    const ref = db.collection(COLLECTIONS.payouts).doc(payoutId);
    const now = Timestamp.now();
    const payout: Payout = {
      countryId: info.countryId,
      cityId: info.cityId,
      beneficiaryType: options.type,
      beneficiaryId: accountId,
      beneficiaryName: info.name,
      periodStart,
      periodEnd: options.until,
      grossCents: sums.gross,
      commissionCents: sums.commission,
      refundsChargedCents: sums.refunds,
      adjustmentsCents: sums.adjustments,
      tipsCents: sums.tips,
      cashDeductedCents: sums.cash,
      netCents: sums.net,
      entriesCount: list.length,
      status: held ? 'on_hold' : 'scheduled',
      currency: await currencyOfCountry(info.countryId),
      provider: await payoutProviderOf(info.countryId),
      scheduledFor: Timestamp.fromDate(parisTime(addDays(options.until, 1 + rule.delayDays), 9)),
      paidAt: null,
      providerTransferId: null,
      failureReason: null,
      holdId: hold?.id ?? null,
      statementInvoiceId: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await ref.create(payout);
    } catch {
      // Déjà construit (relance du traitement) : on ne recompte pas.
      continue;
    }
    for (const part of chunk(list, 450)) {
      const batch = db.batch();
      for (const { id } of part) batch.update(db.collection(COLLECTIONS.ledgerEntries).doc(id), { payoutId });
      await batch.commit();
    }
    // Rattachement de la répartition des commandes au reversement.
    const orderIds = [...new Set(list.map((x) => x.entry.orderId).filter((v): v is string => Boolean(v)))];
    for (const part of chunk(orderIds, 450)) {
      const batch = db.batch();
      for (const orderId of part) {
        batch.set(db.collection(COLLECTIONS.orderFinancials).doc(orderId), options.type === 'restaurant' ? { restaurantPayoutId: payoutId } : { driverPayoutId: payoutId }, { merge: true });
      }
      await batch.commit();
    }
    result.created += 1;
    // Les retenues d'abonnement incluses dans ce reversement sont compensées : factures payées, abonnement rétabli.
    if (options.type === 'restaurant' && !options.dryRun) await settleSubscriptionDebts(accountId, options.actorUid).catch((error) => logger.error('Compensation d’abonnement en échec', { accountId, error: String(error) }));
  }
  return result;
}

// ------------------------------------------------------------------ Exécution (Stripe Connect)

async function connectedAccount(payout: Payout): Promise<{ accountId: string | null; ready: boolean }> {
  if (payout.beneficiaryType === 'restaurant') {
    const snap = await db.collection(COLLECTIONS.restaurants).doc(payout.beneficiaryId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).get();
    const c = snap.exists ? (snap.data() as RestaurantCommercial) : null;
    return { accountId: c?.stripeAccountId ?? null, ready: c?.stripeAccountStatus === 'enabled' };
  }
  const snap = await db.collection(COLLECTIONS.driverPrivate).doc(payout.beneficiaryId).get();
  const p = snap.exists ? (snap.data() as DriverPrivate) : null;
  return { accountId: p?.stripeAccountId ?? null, ready: p?.stripeAccountStatus === 'enabled' };
}

function stripeFailure(error: unknown): string {
  const e = error as { code?: string; message?: string; raw?: { message?: string } };
  switch (e?.code) {
    case 'balance_insufficient':
      return 'Solde de la plateforme insuffisant chez Stripe pour ce virement.';
    case 'account_invalid':
    case 'resource_missing':
      return 'Le compte Stripe du bénéficiaire est introuvable ou invalide.';
    case 'insufficient_capabilities_for_transfer':
      return 'Le compte Stripe du bénéficiaire ne peut pas encore recevoir de virements.';
    default:
      return `Virement refusé par Stripe${e?.message ? ` : ${e.message}` : '.'}`;
  }
}

export async function executeOne(payoutId: string, actor: AuditActor, request?: CallableRequest<unknown>): Promise<{ status: Payout['status']; failureReason: string | null }> {
  const ref = db.collection(COLLECTIONS.payouts).doc(payoutId);
  // Verrouillage : passage en « en cours » dans une transaction (un seul exécuteur).
  const payout = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail.notFound('Reversement');
    const current = snap.data() as Payout;
    if (!['scheduled', 'failed'].includes(current.status)) {
      throw fail.precondition(current.status === 'on_hold' ? 'Ce reversement est bloqué : levez le blocage avant de le verser.' : 'Ce reversement n’est plus à verser.');
    }
    tx.update(ref, { status: 'processing', updatedAt: Timestamp.now(), failureReason: null });
    return current;
  });

  const finish = async (status: Payout['status'], extra: Record<string, unknown>) => {
    await ref.update({ status, updatedAt: Timestamp.now(), ...extra });
  };

  const hold = await activeHold(payout.beneficiaryType, payout.beneficiaryId);
  if (hold) {
    await finish('on_hold', { holdId: hold.id });
    return { status: 'on_hold', failureReason: null };
  }
  if ((payout.provider ?? (await payoutProviderOf(payout.countryId))) === 'manual') {
    await finish('scheduled', {});
    throw fail.precondition('Ce reversement se vire à la main (pays sans Stripe) : effectuez le virement puis utilisez « Marquer comme viré » avec la référence bancaire.');
  }
  const account = await connectedAccount(payout);
  let failureReason: string | null = null;
  let transferId: string | null = null;
  if (payout.netCents <= 0) failureReason = 'Montant net nul ou négatif : rien à verser.';
  else if (!account.accountId) failureReason = payout.beneficiaryType === 'restaurant' ? 'Le commerce n’a pas encore activé son compte de paiement Stripe.' : 'Le livreur n’a pas encore activé son compte de paiement Stripe.';
  else if (!account.ready) failureReason = 'Le compte Stripe du bénéficiaire est incomplet : vérification d’identité ou coordonnées bancaires en attente.';
  else {
    try {
      const attempt = Number((payout as Payout & { attempts?: number }).attempts ?? 0) + 1;
      const transfer = await getStripe().transfers.create(
        {
          amount: payout.netCents,
          currency: stripeCurrency(payout.currency ?? (await currencyOfCountry(payout.countryId))),
          destination: account.accountId,
          transfer_group: payoutId,
          description: `Reversement GoLink ${payout.periodStart} → ${payout.periodEnd}`,
          metadata: { payoutId, beneficiaryType: payout.beneficiaryType, beneficiaryId: payout.beneficiaryId, platform: 'golink' },
        },
        { idempotencyKey: `payout-${payoutId}-${attempt}` },
      );
      transferId = transfer.id;
      await ref.update({ attempts: attempt });
    } catch (error) {
      failureReason = stripeFailure(error);
      logger.warn('Virement Stripe refusé', { payoutId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failureReason) {
    await finish('failed', { failureReason, attempts: FieldValue.increment(1) });
    await raiseAlert({
      kind: 'payout_failed',
      severity: 'warning',
      title: `Reversement en échec : ${payout.beneficiaryName}`,
      message: `${euros(payout.netCents)} — ${failureReason}`,
      target: { type: 'payout', id: payoutId, label: payout.beneficiaryName },
      countryId: payout.countryId,
      cityId: payout.cityId ?? null,
      metric: null,
      dedupKey: `payout_failed:${payoutId}`,
    });
    await writeAudit({ actor, action: 'payout.failed', target: { type: 'payout', id: payoutId, label: payout.beneficiaryName }, after: { failureReason }, countryId: payout.countryId, cityId: payout.cityId ?? null, request, sensitive: true });
    return { status: 'failed', failureReason };
  }

  await finalizePaid(payoutId, payout, actor, { transferId, manualReference: null, live: isStripeLiveMode() }, request);
  return { status: 'paid', failureReason: null };
}

/** Reversement effectué : statut, écriture de virement au grand livre, alerte levée, audit et relevé au bénéficiaire. */
export async function finalizePaid(
  payoutId: string,
  payout: Payout,
  actor: AuditActor,
  info: { transferId: string | null; manualReference: string | null; live: boolean },
  request?: CallableRequest<unknown>,
): Promise<void> {
  const ref = db.collection(COLLECTIONS.payouts).doc(payoutId);
  const paidAt = Timestamp.now();
  const currency = payout.currency ?? (await currencyOfCountry(payout.countryId));
  await db.runTransaction(async (tx) => {
    tx.update(ref, { status: 'paid', paidAt, providerTransferId: info.transferId ?? info.manualReference, manualReference: info.manualReference, updatedAt: paidAt, failureReason: null });
    const entry: LedgerEntry = {
      countryId: payout.countryId,
      cityId: payout.cityId ?? null,
      accountType: payout.beneficiaryType === 'restaurant' ? 'restaurant' : 'driver',
      accountId: payout.beneficiaryId,
      type: 'payout',
      amountCents: -payout.netCents,
      currency,
      vatCents: null,
      payoutId,
      description: `Virement ${payout.periodStart} → ${payout.periodEnd}`,
      bookingDate: parisDay(paidAt.toDate()),
      createdAt: paidAt,
      createdBy: actor.uid,
    };
    tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(`${payoutId}-vir`), entry);
  });
  await resolveAlert(`payout_failed:${payoutId}`);
  await writeAudit({ actor, action: 'payout.paid', target: { type: 'payout', id: payoutId, label: payout.beneficiaryName }, after: { netCents: payout.netCents, transferId: info.transferId, manualReference: info.manualReference, live: info.live }, countryId: payout.countryId, cityId: payout.cityId ?? null, request, sensitive: true });
  await notifyPayoutPaid(payoutId, payout).catch((error) => logger.warn('Relevé non envoyé', { payoutId, error: String(error) }));
}

/** Relevé remis au bénéficiaire après le virement : message automatique (texte modifiable dans le super admin). */
async function notifyPayoutPaid(payoutId: string, payout: Payout): Promise<void> {
  const flags = payout as Payout & { seed?: boolean; test?: boolean };
  const demo = flags.seed === true || flags.test === true;
  const period = `du ${payout.periodStart.split('-').reverse().join('/')} au ${payout.periodEnd.split('-').reverse().join('/')}`;
  if (payout.beneficiaryType === 'restaurant') {
    await messageRestaurantFinance(
      payout.beneficiaryId,
      'restaurant_payout_paid',
      {
        amount: euros(payout.netCents),
        period,
        sales: euros(payout.grossCents),
        commission: euros(payout.commissionCents),
        refunds: euros(payout.refundsChargedCents),
        adjustments: euros(payout.adjustmentsCents),
        reference: payoutId,
      },
      { dedupeKey: payoutId, ctaUrl: `${APP_URLS.restaurant}/finances/virements`, ctaLabel: 'Voir le relevé détaillé' },
      demo,
    );
    return;
  }
  await sendPlatformMessage('driver_payout_paid', { uid: payout.beneficiaryId, type: 'driver', demo }, { amount: euros(payout.netCents), period }, { dedupeKey: payoutId });
}

// ------------------------------------------------------------------ Planification

export const buildPayouts = onSchedule(
  { schedule: '30 2 * * *', timeZone: 'Europe/Paris', ...ARGENT_RUNTIME, timeoutSeconds: 540 },
  async () => {
    const until = addDays(parisDay(new Date()), -1);
    for (const type of ['restaurant', 'driver'] as const) {
      const result = await runBuildPayouts({ type, until, actorUid: 'system' });
      logger.info('Reversements construits', { type, until, created: result.created, held: result.skippedHeld, below: result.skippedBelowMinimum });
    }
  },
);

export const executePayouts = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'Europe/Paris', ...ARGENT_RUNTIME, timeoutSeconds: 540, secrets: [STRIPE_SECRET_KEY, ...EMAIL_SECRETS] },
  async () => {
    const due = await db.collection(COLLECTIONS.payouts).where('status', '==', 'scheduled').where('scheduledFor', '<=', Timestamp.now()).limit(300).get();
    for (const doc of due.docs) {
      // Documents de test et données de démonstration : versement manuel uniquement.
      const flags = doc.data() as { test?: boolean; seed?: boolean; provider?: string };
      if (flags.test || flags.seed || flags.provider === 'manual') continue;
      try {
        await executeOne(doc.id, SYSTEM_ACTOR);
      } catch (error) {
        logger.error('Reversement non exécuté', { payoutId: doc.id, error: String(error) });
      }
    }
  },
);

// ------------------------------------------------------------------ Appels manuels

async function scopedPayout(snap: DocumentSnapshot, admin: Parameters<typeof assertAdminCovers>[0]): Promise<Payout> {
  if (!snap.exists) throw fail.notFound('Reversement');
  const payout = snap.data() as Payout;
  assertAdminCovers(admin, payout.cityId ?? null);
  return payout;
}

export const buildPayoutsNow = argentCallable(
  z.object({
    beneficiaryType: z.enum(['restaurant', 'driver']),
    until: z.string().regex(zDay).nullish(),
    beneficiaryId: zId.nullish(),
    dryRun: z.boolean().optional(),
    /** Motif : obligatoire pour une construction réelle (mouvement d'argent). */
    reason: zReason.nullish(),
  }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'finance.payouts');
    if (!data.dryRun && !data.reason) throw fail.invalid('Indiquez le motif de la construction manuelle des reversements.');
    const until = data.until ?? addDays(parisDay(new Date()), -1);
    if (until > parisDay(new Date())) throw fail.invalid('La période ne peut pas se terminer dans le futur.');
    const result = await runBuildPayouts({ type: data.beneficiaryType, until, beneficiaryId: data.beneficiaryId ?? null, dryRun: data.dryRun, force: true, actorUid: caller.uid });
    if (!data.dryRun && result.created > 0) {
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'payouts.built',
        target: { type: 'other', id: `payouts-${data.beneficiaryType}-${until}`, label: `Reversements jusqu’au ${until}` },
        reason: data.reason ?? null,
        after: { created: result.created, totalNetCents: result.totalNetCents, beneficiaryId: data.beneficiaryId ?? null },
        request,
        sensitive: true,
      });
    }
    return result;
  },
  { timeoutSeconds: 300 },
);

export const executePayout = argentCallable(
  z.object({ payoutId: zId, reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'finance.payouts');
    const payout = await scopedPayout(await db.collection(COLLECTIONS.payouts).doc(data.payoutId).get(), admin);
    // Trace de la décision manuelle avec son motif, avant le mouvement d'argent.
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'payout.manual_execution',
      target: { type: 'payout', id: data.payoutId, label: payout.beneficiaryName },
      reason: data.reason,
      after: { netCents: payout.netCents ?? null, status: payout.status },
      countryId: payout.countryId,
      cityId: payout.cityId ?? null,
      request,
      sensitive: true,
    });
    return executeOne(data.payoutId, actorFromCaller(caller, 'admin'), request);
  },
  { secrets: [STRIPE_SECRET_KEY, ...EMAIL_SECRETS] },
);

export const cancelPayout = argentCallable(z.object({ payoutId: zId, reason: zReason }), async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'finance.payouts');
  const ref = db.collection(COLLECTIONS.payouts).doc(data.payoutId);
  const payout = await scopedPayout(await ref.get(), admin);
  if (!['scheduled', 'failed', 'on_hold'].includes(payout.status)) throw fail.precondition('Seul un reversement non versé peut être annulé.');
  // Les mouvements redeviennent « à reverser » et seront repris au prochain reversement.
  const entries = await db.collection(COLLECTIONS.ledgerEntries).where('payoutId', '==', data.payoutId).limit(10_000).get();
  for (const part of chunk(entries.docs, 450)) {
    const batch = db.batch();
    for (const doc of part) batch.update(doc.ref, { payoutId: null });
    await batch.commit();
  }
  await ref.update({ status: 'cancelled', failureReason: data.reason, updatedAt: Timestamp.now() });
  await resolveAlert(`payout_failed:${data.payoutId}`);
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'payout.cancelled', target: { type: 'payout', id: data.payoutId, label: payout.beneficiaryName }, reason: data.reason, before: { status: payout.status }, after: { status: 'cancelled', entriesReleased: entries.size }, countryId: payout.countryId, cityId: payout.cityId ?? null, request, sensitive: true });
  return { entriesReleased: entries.size };
});

// ------------------------------------------------------------------ Blocages

function blockedFlagRef(type: Beneficiary, id: string) {
  return type === 'restaurant'
    ? db.collection(COLLECTIONS.restaurants).doc(id).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial)
    : db.collection(COLLECTIONS.driverPrivate).doc(id);
}

export const holdPayouts = argentCallable(
  z.object({
    beneficiaryType: z.enum(['restaurant', 'driver']),
    beneficiaryId: zId,
    reason: z.enum(PAYOUT_HOLD_REASONS),
    details: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'finance.hold');
    const info = await beneficiaryInfo(data.beneficiaryType, data.beneficiaryId);
    if (!info) throw fail.notFound(data.beneficiaryType === 'restaurant' ? 'Commerce' : 'Livreur');
    assertAdminCovers(admin, info.cityId);
    if (await activeHold(data.beneficiaryType, data.beneficiaryId)) throw fail.alreadyExists('Les reversements de ce bénéficiaire sont déjà bloqués.');
    const now = Timestamp.now();
    const holdRef = db.collection(COLLECTIONS.payoutHolds).doc();
    const hold: PayoutHold & { beneficiaryName: string; countryId: string; cityId: string | null } = {
      beneficiaryType: data.beneficiaryType,
      beneficiaryId: data.beneficiaryId,
      beneficiaryName: info.name,
      countryId: info.countryId,
      cityId: info.cityId,
      reason: data.reason,
      details: data.details,
      active: true,
      releasedAt: null,
      releasedBy: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    const pending = await db.collection(COLLECTIONS.payouts).where('beneficiaryId', '==', data.beneficiaryId).where('status', 'in', ['scheduled', 'failed']).limit(200).get();
    const batch = db.batch();
    batch.set(holdRef, hold);
    batch.set(blockedFlagRef(data.beneficiaryType, data.beneficiaryId), { payoutsBlocked: true, payoutsBlockedReason: data.details, updatedAt: now, updatedBy: caller.uid }, { merge: true });
    for (const doc of pending.docs) if (doc.get('beneficiaryType') === data.beneficiaryType) batch.update(doc.ref, { status: 'on_hold', holdId: holdRef.id, updatedAt: now });
    await batch.commit();
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'payout.hold_created', target: { type: data.beneficiaryType === 'restaurant' ? 'restaurant' : 'driver', id: data.beneficiaryId, label: info.name }, reason: data.details, after: { reason: data.reason, payoutsHeld: pending.size }, countryId: info.countryId, cityId: info.cityId, request, sensitive: true });
    return { holdId: holdRef.id, payoutsHeld: pending.size };
  },
);

export const releasePayoutHold = argentCallable(z.object({ holdId: zId, reason: zReason }), async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'finance.hold');
  const ref = db.collection(COLLECTIONS.payoutHolds).doc(data.holdId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Blocage');
  const hold = snap.data() as PayoutHold & { beneficiaryName?: string; cityId?: string | null; countryId?: string };
  if (!hold.active) throw fail.precondition('Ce blocage est déjà levé.');
  assertAdminCovers(admin, hold.cityId ?? null);
  const now = Timestamp.now();
  const held = await db.collection(COLLECTIONS.payouts).where('holdId', '==', data.holdId).limit(200).get();
  const batch = db.batch();
  batch.update(ref, { active: false, releasedAt: now, releasedBy: caller.uid, releaseReason: data.reason, updatedAt: now, updatedBy: caller.uid });
  batch.set(blockedFlagRef(hold.beneficiaryType, hold.beneficiaryId), { payoutsBlocked: false, payoutsBlockedReason: null, updatedAt: now, updatedBy: caller.uid }, { merge: true });
  for (const doc of held.docs) if (doc.get('status') === 'on_hold') batch.update(doc.ref, { status: 'scheduled', holdId: null, updatedAt: now });
  await batch.commit();
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'payout.hold_released', target: { type: hold.beneficiaryType === 'restaurant' ? 'restaurant' : 'driver', id: hold.beneficiaryId, label: hold.beneficiaryName ?? null }, reason: data.reason, after: { payoutsReleased: held.size }, countryId: hold.countryId ?? null, cityId: hold.cityId ?? null, request, sensitive: true });
  return { payoutsReleased: held.size };
});

// ------------------------------------------------------------------ Mouvements manuels

export const createAdjustment = argentCallable(
  z.object({
    beneficiaryType: z.enum(['restaurant', 'driver']),
    beneficiaryId: zId,
    amountCents: z.number().int().refine((v) => v !== 0, 'Le montant ne peut pas être nul').refine((v) => Math.abs(v) <= 10_000_000, 'Montant trop élevé'),
    label: z.string().trim().min(3, 'Indiquez un libellé').max(120),
    reason: zReason,
    orderId: zId.nullish(),
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'finance.adjust');
    const info = await beneficiaryInfo(data.beneficiaryType, data.beneficiaryId);
    if (!info) throw fail.notFound(data.beneficiaryType === 'restaurant' ? 'Commerce' : 'Livreur');
    assertAdminCovers(admin, info.cityId);
    const now = Timestamp.now();
    const ref = db.collection(COLLECTIONS.ledgerEntries).doc();
    const entry: LedgerEntry = {
      countryId: info.countryId,
      cityId: info.cityId,
      accountType: data.beneficiaryType,
      accountId: data.beneficiaryId,
      type: 'manual_adjustment',
      amountCents: data.amountCents,
      currency: await currencyOfCountry(info.countryId),
      vatCents: null,
      orderId: data.orderId ?? null,
      payoutId: null,
      description: data.label,
      reason: data.reason,
      bookingDate: parisDay(now.toDate()),
      createdAt: now,
      createdBy: caller.uid,
    };
    await ref.set(entry);
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'ledger.adjustment_created', target: { type: data.beneficiaryType === 'restaurant' ? 'restaurant' : 'driver', id: data.beneficiaryId, label: info.name }, reason: data.reason, after: { amountCents: data.amountCents, label: data.label, entryId: ref.id }, countryId: info.countryId, cityId: info.cityId, request, sensitive: true });
    return { entryId: ref.id };
  },
);

export const recordCashRemittance = argentCallable(
  z.object({ driverId: zId, amountCents: z.number().int().min(1).max(1_000_000), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'finance.adjust');
    const info = await beneficiaryInfo('driver', data.driverId);
    if (!info) throw fail.notFound('Livreur');
    assertAdminCovers(admin, info.cityId);
    const privRef = db.collection(COLLECTIONS.driverPrivate).doc(data.driverId);
    const now = Timestamp.now();
    const balance = await db.runTransaction(async (tx: Transaction) => {
      const snap = await tx.get(privRef);
      const current = snap.exists ? Number(snap.get('cashBalanceCents') ?? 0) : 0;
      if (data.amountCents > current) throw fail.precondition(`Le livreur ne détient que ${euros(current)} en espèces.`);
      tx.set(privRef, { cashBalanceCents: current - data.amountCents, updatedAt: now }, { merge: true });
      const entry: LedgerEntry = {
        countryId: info.countryId,
        cityId: info.cityId,
        accountType: 'driver_cash',
        accountId: data.driverId,
        type: 'cash_remitted',
        amountCents: data.amountCents,
        currency: await currencyOfCountry(info.countryId),
        vatCents: null,
        // Repris au prochain reversement : compense la retenue des espèces encaissées.
        payoutId: null,
        description: 'Espèces remises à GoLink',
        reason: data.reason,
        bookingDate: parisDay(now.toDate()),
        createdAt: now,
        createdBy: caller.uid,
      };
      tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(), entry);
      tx.set(db.collection(COLLECTIONS.cashMovements).doc(), { countryId: info.countryId, cityId: info.cityId, restaurantId: (snap.get('restaurantId') as string | undefined) ?? 'golink', driverId: data.driverId, driverName: info.name, type: 'remitted', amountCents: -data.amountCents, balanceAfterCents: current - data.amountCents, note: data.reason, createdAt: now, createdBy: caller.uid });
      return current - data.amountCents;
    });
    const restaurantOfDriver = ((await db.collection(COLLECTIONS.drivers).doc(data.driverId).get()).get('restaurantIds') as string[] | undefined)?.[0];
    if (restaurantOfDriver) await mirrorCourierCash(restaurantOfDriver, data.driverId, balance, await cashLimitOf((await privRef.get()).data() as DriverPrivate | undefined)).catch(() => undefined);
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'driver.cash_remitted', target: { type: 'driver', id: data.driverId, label: info.name }, reason: data.reason, after: { amountCents: data.amountCents, cashBalanceCents: balance }, countryId: info.countryId, cityId: info.cityId, request, sensitive: true });
    return { cashBalanceCents: balance };
  },
);
