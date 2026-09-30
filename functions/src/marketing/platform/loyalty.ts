// Moteur de fidélité de la plateforme (réglages : settings/loyalty, éteint par défaut). Gain de points
// à la livraison, points de bienvenue à la première commande, échange contre du crédit au
// portefeuille (dépensable à la commande), expiration des points selon leur ancienneté.
// Tout est rejouable sans doublon (identifiants de mouvement déterministes).
import {
  COLLECTIONS,
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type LedgerEntry,
  type LoyaltyAccount,
  type LoyaltySettings,
  type LoyaltyTransaction,
  type Order,
  type RestaurantLoyaltySettings,
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

/** Points gagnés sur une commande selon le programme d'un restaurant (mêmes règles de calcul que
 * `pointsForOrder`, mais avec les paramètres propres au commerce : `earnPoints` points tous les
 * `everyCents`). */
function pointsForOrderRestaurant(order: Pick<Order, 'amounts'>, program: Pick<RestaurantLoyaltySettings, 'earnPoints' | 'everyCents'>): number {
  const base = order.amounts.subtotalCents - (order.amounts.discount?.onItemsCents ?? 0);
  if (base <= 0 || program.everyCents <= 0) return 0;
  return Math.floor((base / program.everyCents) * program.earnPoints);
}

/**
 * Commande livrée : points de gain et de bienvenue, à la fois pour le programme de la plateforme
 * (`settings/loyalty`, éteint par défaut) ET pour le programme propre au restaurant s'il en a activé
 * un (`restaurants/{rid}/settings/loyalty`, `saveLoyaltyProgram`). Les deux sont indépendants : un
 * restaurant peut avoir son propre programme même si celui de la plateforme reste éteint, du moment
 * que `settings/loyalty.allowRestaurantPrograms` l'autorise (c'est la condition posée à l'écriture du
 * programme par `saveLoyaltyProgram`, revérifiée ici à la lecture). Compte séparé par restaurant
 * (`loyaltyAccounts/{uid}_{restaurantId}`, `scope:'restaurant'`) : les points d'un commerce ne sont
 * utilisables que chez lui (pas de redemption inter-commerces).
 */
export async function earnLoyaltyPoints(orderId: string, order: Order): Promise<{ earned: number; welcome: number; restaurantEarned: number; restaurantWelcome: number }> {
  const none = { earned: 0, welcome: 0, restaurantEarned: 0, restaurantWelcome: 0 };
  if (order.closedAs === 'customer_absent') return none;
  // Interrupteur « Fidélité » (§24) : éteint pour ce commerce, cette ville ou ce pays, aucun point n'est crédité (aucun des deux programmes).
  if (!(await isFeatureOn('loyalty', { restaurantId: order.restaurantId, cityId: order.cityId, countryId: order.countryId }))) return none;
  const settings = await loadLoyaltySettings();
  const uid = order.customerId;
  const now = Timestamp.now();
  const test = (order as Order & { test?: boolean }).test === true;

  let earned = 0;
  let welcome = 0;
  if (settings.enabled) {
    const platformEarned = pointsForOrder(order, settings);
    const platformWelcome = order.flags?.firstOrder === true ? settings.welcomePoints : 0;
    if (platformEarned > 0 || platformWelcome > 0) {
      const expiresAt = settings.pointsValidityDays ? Timestamp.fromMillis(now.toMillis() + settings.pointsValidityDays * DAY_MS) : null;
      const result = await db.runTransaction(async (tx) => {
        const earnRef = txCol().doc(`earn-${orderId}`);
        const welcomeRef = txCol().doc(`welcome-${uid}`);
        const [account, earnDone, welcomeDone] = await Promise.all([tx.get(accountRef(uid)), tx.get(earnRef), tx.get(welcomeRef)]);
        let gained = 0;
        let gift = 0;
        const base = { accountId: uid, userId: uid, restaurantId: null, createdAt: now, createdBy: 'system', expiresAt, ...(test ? { test: true } : {}) };
        if (platformEarned > 0 && !earnDone.exists) {
          tx.set(earnRef, { ...base, type: 'earn', points: platformEarned, remaining: platformEarned, orderId, valueCents: null });
          gained += platformEarned;
        }
        if (platformWelcome > 0 && !welcomeDone.exists) {
          tx.set(welcomeRef, { ...base, type: 'welcome', points: platformWelcome, remaining: platformWelcome, orderId, valueCents: null });
          gift += platformWelcome;
        }
        if (gained + gift > 0) {
          const current = account.data() as LoyaltyAccount | undefined;
          const next: LoyaltyAccount = { userId: uid, scope: 'platform', restaurantId: null, points: (current?.points ?? 0) + gained + gift, lifetimePoints: (current?.lifetimePoints ?? 0) + gained + gift, tier: current?.tier ?? null, updatedAt: now };
          tx.set(accountRef(uid), next);
        }
        return { earned: gained, welcome: gift };
      });
      earned = result.earned;
      welcome = result.welcome;
    }
  }

  let restaurantEarned = 0;
  let restaurantWelcome = 0;
  if (settings.allowRestaurantPrograms) {
    const programSnap = await db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.loyalty).get();
    const program = programSnap.data() as RestaurantLoyaltySettings | undefined;
    if (program?.enabled) {
      const rEarned = pointsForOrderRestaurant(order, program);
      const rWelcome = order.flags?.firstOrder === true ? program.welcomePoints : 0;
      if (rEarned > 0 || rWelcome > 0) {
        const accId = `${uid}_${order.restaurantId}`;
        const rExpiresAt = program.pointsValidityDays ? Timestamp.fromMillis(now.toMillis() + program.pointsValidityDays * DAY_MS) : null;
        const result = await db.runTransaction(async (tx) => {
          const earnRef = txCol().doc(`earn-${orderId}-r`);
          const welcomeRef = txCol().doc(`welcome-${accId}`);
          const [account, earnDone, welcomeDone] = await Promise.all([tx.get(accountRef(accId)), tx.get(earnRef), tx.get(welcomeRef)]);
          let gained = 0;
          let gift = 0;
          const base = { accountId: accId, userId: uid, restaurantId: order.restaurantId, createdAt: now, createdBy: 'system', expiresAt: rExpiresAt, ...(test ? { test: true } : {}) };
          if (rEarned > 0 && !earnDone.exists) {
            tx.set(earnRef, { ...base, type: 'earn', points: rEarned, remaining: rEarned, orderId, valueCents: null });
            gained += rEarned;
          }
          if (rWelcome > 0 && !welcomeDone.exists) {
            tx.set(welcomeRef, { ...base, type: 'welcome', points: rWelcome, remaining: rWelcome, orderId, valueCents: null });
            gift += rWelcome;
          }
          if (gained + gift > 0) {
            const current = account.data() as LoyaltyAccount | undefined;
            const next: LoyaltyAccount = { userId: uid, scope: 'restaurant', restaurantId: order.restaurantId, points: (current?.points ?? 0) + gained + gift, lifetimePoints: (current?.lifetimePoints ?? 0) + gained + gift, tier: current?.tier ?? null, updatedAt: now };
            tx.set(accountRef(accId), next);
          }
          return { earned: gained, welcome: gift };
        });
        restaurantEarned = result.earned;
        restaurantWelcome = result.welcome;
      }
    }
  }

  return { earned, welcome, restaurantEarned, restaurantWelcome };
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

/**
 * Points expirés : chaque lot de points est périmé à la fin de sa validité (points restants retirés
 * du compte). Regroupement par **compte** (`accountId`), pas par utilisateur : depuis l'ajout du
 * programme propre aux restaurants, un même client peut avoir plusieurs comptes de points
 * (`{uid}` pour la plateforme, `{uid}_{restaurantId}` par commerce) — grouper par `userId` seul
 * ferait expirer les points d'un commerce sur le compte plateforme du client (correctif : l'ancien
 * code utilisait `accountRef(uid)`, or `accountId` peut différer de `userId`).
 */
export async function expireLoyaltyPoints(now = Timestamp.now()): Promise<{ users: number; points: number }> {
  const due = await txCol().where('expiresAt', '<=', now).limit(1000).get();
  const byAccount = new Map<string, { userId: string; lots: Array<{ ref: FirebaseFirestore.DocumentReference; remaining: number }> }>();
  for (const doc of due.docs) {
    const t = doc.data() as StoredTx;
    if (!['earn', 'welcome'].includes(t.type) || (t.remaining ?? 0) <= 0) continue;
    const entry = byAccount.get(t.accountId) ?? { userId: t.userId, lots: [] };
    entry.lots.push({ ref: doc.ref, remaining: t.remaining ?? 0 });
    byAccount.set(t.accountId, entry);
  }
  let points = 0;
  const notified = new Set<string>();
  for (const [accountId, { userId, lots }] of byAccount) {
    const expired = lots.reduce((s, l) => s + l.remaining, 0);
    await db.runTransaction(async (tx) => {
      const account = await tx.get(accountRef(accountId));
      const acc = account.data() as LoyaltyAccount | undefined;
      const fresh = await Promise.all(lots.map((l) => tx.get(l.ref)));
      const live = fresh.filter((s) => ((s.get('remaining') as number | undefined) ?? 0) > 0);
      const amount = live.reduce((s, snap) => s + ((snap.get('remaining') as number | undefined) ?? 0), 0);
      if (!acc || amount <= 0) return;
      for (const snap of live) tx.update(snap.ref, { remaining: 0 });
      tx.set(txCol().doc(`expire-${accountId}-${now.toMillis()}`), { accountId, userId, restaurantId: acc.restaurantId ?? null, type: 'expire', points: -amount, orderId: null, valueCents: null, createdAt: now, createdBy: 'system' });
      tx.set(accountRef(accountId), { ...acc, points: Math.max(0, acc.points - amount), updatedAt: now });
    });
    points += expired;
    if (!notified.has(userId)) {
      notified.add(userId);
      await pushInApp(userId, { title: 'Des points de fidélité ont expiré', body: `${expired} points ont expiré. Utilisez-les avant leur échéance la prochaine fois.`, category: 'account', link: null }, `loyalty-expire-${now.toMillis()}`);
    }
  }
  return { users: notified.size, points };
}

export const expireLoyalty = onSchedule({ schedule: '10 3 * * *', timeZone: 'Europe/Paris', maxInstances: 1, cpu: 'gcf_gen1', memory: '256MiB', timeoutSeconds: 300 }, async () => {
  const settings = await loadLoyaltySettings();
  // Le programme plateforme ET les programmes des restaurants sont deux interrupteurs indépendants
  // (voir `earnLoyaltyPoints`) : n'ignorer l'expiration que si aucun des deux ne peut avoir de points en cours.
  if (!settings.enabled && !settings.allowRestaurantPrograms) return;
  const result = await expireLoyaltyPoints();
  if (result.points > 0) {
    logger.info('Points de fidélité expirés', result);
    await writeAudit({ actor: SYSTEM_ACTOR, action: 'loyalty.expired', target: { type: 'setting', id: 'loyalty' }, after: result });
  }
});
