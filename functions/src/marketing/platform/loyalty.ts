// Moteur de fidélité de la plateforme (réglages : settings/loyalty, éteint par défaut). Gain de points
// à la livraison, points de bienvenue à la première commande, échange contre du crédit au
// portefeuille (dépensable à la commande), expiration des points selon leur ancienneté.
// Tout est rejouable sans doublon (identifiants de mouvement déterministes).
import {
  COLLECTIONS,
  type LedgerEntry,
  type LoyaltyAccount,
  type LoyaltySettings,
  type LoyaltyTransaction,
  type Order,
  type UserProfile,
  type WalletTransaction,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { assertFeatureOn, isFeatureOn } from '../../lib/features';
import { requireAuth } from '../../lib/permissions';
import { z } from '../../lib/validation';
import { loadLoyaltySettings, pushInApp } from './common';

const DAY_MS = 86_400_000;
const parisDay = (date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

type StoredTx = LoyaltyTransaction & { remaining?: number; expiresAt?: Timestamp | null };

const accountRef = (uid: string) => db.collection(COLLECTIONS.loyaltyAccounts).doc(uid);
const txCol = () => db.collection(COLLECTIONS.loyaltyTransactions);

/** Points gagnés sur une commande : sous-total après remises sur articles × points par euro. */
export function pointsForOrder(order: Pick<Order, 'amounts'>, settings: Pick<LoyaltySettings, 'pointsPerEuro' | 'minOrderCents'>): number {
  const base = order.amounts.subtotalCents - (order.amounts.discount?.onItemsCents ?? 0);
  if (base <= 0 || base < (settings.minOrderCents ?? 0)) return 0;
  return Math.floor((base / 100) * settings.pointsPerEuro);
}

/** Commande livrée : points de gain et de bienvenue. Sans effet tant que le programme est éteint. */
export async function earnLoyaltyPoints(orderId: string, order: Order): Promise<{ earned: number; welcome: number }> {
  const settings = await loadLoyaltySettings();
  if (!settings.enabled || order.closedAs === 'customer_absent') return { earned: 0, welcome: 0 };
  // Interrupteur « Fidélité » (§24) : éteint pour ce commerce, cette ville ou ce pays, aucun point n'est crédité.
  if (!(await isFeatureOn('loyalty', { restaurantId: order.restaurantId, cityId: order.cityId, countryId: order.countryId }))) return { earned: 0, welcome: 0 };
  const earned = pointsForOrder(order, settings);
  const welcome = order.flags?.firstOrder === true ? settings.welcomePoints : 0;
  if (earned <= 0 && welcome <= 0) return { earned: 0, welcome: 0 };
  const uid = order.customerId;
  const now = Timestamp.now();
  const expiresAt = settings.pointsValidityDays ? Timestamp.fromMillis(now.toMillis() + settings.pointsValidityDays * DAY_MS) : null;
  const test = (order as Order & { test?: boolean }).test === true;
  return db.runTransaction(async (tx) => {
    const earnRef = txCol().doc(`earn-${orderId}`);
    const welcomeRef = txCol().doc(`welcome-${uid}`);
    const [account, earnDone, welcomeDone] = await Promise.all([tx.get(accountRef(uid)), tx.get(earnRef), tx.get(welcomeRef)]);
    let gained = 0;
    let gift = 0;
    const base = { accountId: uid, userId: uid, restaurantId: null, createdAt: now, createdBy: 'system', expiresAt, ...(test ? { test: true } : {}) };
    if (earned > 0 && !earnDone.exists) {
      tx.set(earnRef, { ...base, type: 'earn', points: earned, remaining: earned, orderId, valueCents: null });
      gained += earned;
    }
    if (welcome > 0 && !welcomeDone.exists) {
      tx.set(welcomeRef, { ...base, type: 'welcome', points: welcome, remaining: welcome, orderId, valueCents: null });
      gift += welcome;
    }
    if (gained + gift > 0) {
      const current = account.data() as LoyaltyAccount | undefined;
      const next: LoyaltyAccount = { userId: uid, scope: 'platform', restaurantId: null, points: (current?.points ?? 0) + gained + gift, lifetimePoints: (current?.lifetimePoints ?? 0) + gained + gift, tier: current?.tier ?? null, updatedAt: now };
      tx.set(accountRef(uid), next);
    }
    return { earned: gained, welcome: gift };
  });
}

/** Échange de points contre du crédit au portefeuille : palier exact du programme, points les plus anciens d'abord. */
export const redeemLoyaltyPoints = callable(z.object({ points: z.number().int().min(1).max(10_000_000) }), async (data, request) => {
  const caller = requireAuth(request);
  const settings = await loadLoyaltySettings();
  if (!settings.enabled) throw fail.precondition('Le programme de fidélité n’est pas ouvert pour le moment.');
  await assertFeatureOn('loyalty', {}, 'Le programme de fidélité n’est pas ouvert pour le moment.');
  const tier = settings.rewards.find((r) => r.points === data.points);
  if (!tier) throw fail.invalid('Ce palier n’existe pas : choisissez un palier proposé par le programme.');
  const uid = caller.uid;
  const userRef = db.collection(COLLECTIONS.users).doc(uid);
  const sources = await txCol().where('userId', '==', uid).orderBy('createdAt', 'asc').limit(500).get();
  const buckets = sources.docs.filter((d) => ['earn', 'welcome'].includes(String(d.get('type'))) && ((d.get('remaining') as number | undefined) ?? 0) > 0);
  const now = Timestamp.now();
  const walletTxRef = db.collection(COLLECTIONS.walletTransactions).doc();
  const redeemRef = txCol().doc();
  const result = await db.runTransaction(async (tx) => {
    const [account, user] = await Promise.all([tx.get(accountRef(uid)), tx.get(userRef)]);
    const acc = account.data() as LoyaltyAccount | undefined;
    if (!acc || acc.points < data.points) throw fail.precondition(`Il vous manque ${data.points - (acc?.points ?? 0)} points pour ce palier.`);
    const profile = user.data() as UserProfile | undefined;
    if (!profile) throw fail.notFound('Compte');
    // Consommation des points, du plus ancien au plus récent.
    let left = data.points;
    const fresh = await Promise.all(buckets.map((d) => tx.get(d.ref)));
    for (const snap of fresh) {
      if (left <= 0) break;
      const remaining = (snap.get('remaining') as number | undefined) ?? 0;
      if (remaining <= 0) continue;
      const used = Math.min(remaining, left);
      tx.update(snap.ref, { remaining: remaining - used });
      left -= used;
    }
    if (left > 0) throw fail.precondition('Vos points ne sont plus valables : ils ont expiré.');
    const balanceAfter = (profile.walletBalanceCents ?? 0) + tier.valueCents;
    tx.set(redeemRef, { accountId: uid, userId: uid, restaurantId: null, type: 'redeem', points: -data.points, orderId: null, valueCents: tier.valueCents, createdAt: now, createdBy: uid });
    tx.set(accountRef(uid), { ...acc, points: acc.points - data.points, updatedAt: now });
    const wallet: WalletTransaction = { userId: uid, type: 'credit', amountCents: tier.valueCents, balanceAfterCents: balanceAfter, reason: 'loyalty_reward', orderId: null, ticketId: null, refundId: null, expiresAt: null, note: `Échange de ${data.points} points`, createdAt: now, createdBy: 'system' };
    tx.set(walletTxRef, wallet);
    tx.update(userRef, { walletBalanceCents: balanceAfter, updatedAt: now });
    const day = parisDay();
    const base = { currency: 'EUR' as const, bookingDate: day, countryId: 'FR', cityId: null, description: `Fidélité : ${data.points} points échangés`, createdAt: now, createdBy: 'system' };
    const credit: LedgerEntry = { ...base, accountType: 'customer_wallet', accountId: uid, type: 'wallet_credit', amountCents: tier.valueCents };
    tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(`wc-${walletTxRef.id}`), credit);
    // Coût du programme supporté par la plateforme.
    const cost: LedgerEntry = { ...base, accountType: 'platform', accountId: 'golink', type: 'wallet_credit', amountCents: -tier.valueCents };
    tx.set(db.collection(COLLECTIONS.ledgerEntries).doc(`wp-${walletTxRef.id}`), cost);
    return { pointsLeft: acc.points - data.points, balanceCents: balanceAfter, valueCents: tier.valueCents };
  });
  await writeAudit({ actor: actorFromCaller(caller, 'client'), action: 'loyalty.redeemed', target: { type: 'client', id: uid }, after: { points: data.points, valueCents: result.valueCents } });
  return result;
}, { maxInstances: 2, cpu: 'gcf_gen1' });

/** Points expirés : chaque lot de points est périmé à la fin de sa validité (points restants retirés du compte). */
export async function expireLoyaltyPoints(now = Timestamp.now()): Promise<{ users: number; points: number }> {
  const due = await txCol().where('expiresAt', '<=', now).limit(1000).get();
  const byUser = new Map<string, Array<{ ref: FirebaseFirestore.DocumentReference; remaining: number }>>();
  for (const doc of due.docs) {
    const t = doc.data() as StoredTx;
    if (!['earn', 'welcome'].includes(t.type) || (t.remaining ?? 0) <= 0) continue;
    byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), { ref: doc.ref, remaining: t.remaining ?? 0 }]);
  }
  let points = 0;
  for (const [uid, lots] of byUser) {
    const expired = lots.reduce((s, l) => s + l.remaining, 0);
    await db.runTransaction(async (tx) => {
      const account = await tx.get(accountRef(uid));
      const acc = account.data() as LoyaltyAccount | undefined;
      const fresh = await Promise.all(lots.map((l) => tx.get(l.ref)));
      const live = fresh.filter((s) => ((s.get('remaining') as number | undefined) ?? 0) > 0);
      const amount = live.reduce((s, snap) => s + ((snap.get('remaining') as number | undefined) ?? 0), 0);
      if (!acc || amount <= 0) return;
      for (const snap of live) tx.update(snap.ref, { remaining: 0 });
      tx.set(txCol().doc(`expire-${uid}-${now.toMillis()}`), { accountId: uid, userId: uid, restaurantId: null, type: 'expire', points: -amount, orderId: null, valueCents: null, createdAt: now, createdBy: 'system' });
      tx.set(accountRef(uid), { ...acc, points: Math.max(0, acc.points - amount), updatedAt: now });
    });
    points += expired;
    await pushInApp(uid, { title: 'Des points de fidélité ont expiré', body: `${expired} points ont expiré. Utilisez-les avant leur échéance la prochaine fois.`, category: 'account', link: null }, `loyalty-expire-${now.toMillis()}`);
  }
  return { users: byUser.size, points };
}

export const expireLoyalty = onSchedule({ schedule: '10 3 * * *', timeZone: 'Europe/Paris', maxInstances: 1, cpu: 'gcf_gen1', memory: '256MiB', timeoutSeconds: 300 }, async () => {
  const settings = await loadLoyaltySettings();
  if (!settings.enabled) return;
  const result = await expireLoyaltyPoints();
  if (result.points > 0) {
    logger.info('Points de fidélité expirés', result);
    await writeAudit({ actor: SYSTEM_ACTOR, action: 'loyalty.expired', target: { type: 'setting', id: 'loyalty' }, after: result });
  }
});
