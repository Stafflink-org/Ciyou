// Espèces des livreurs salariés du commerce (décision client : espèces uniquement avec un
// livreur salarié rattaché au commerce comme employé). L'argent reste chez le commerce :
// le livreur encaisse à la livraison, détient la caisse, puis la remet au commerce. Ce module
// suit le solde détenu par livreur, applique le plafond et enregistre les remises.
import { COLLECTIONS, SETTINGS_DOCS, SUBCOLLECTIONS, type CashMovement, type Driver, type DriverPrivate, type Order, type PaymentSettings } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { requireRestaurantAccess } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { messageRestaurantFinance } from './notify';
import { euros } from './common';
import { argentCallable } from './runtime';

const DEFAULT_LIMIT_CENTS = 15_000;

/** Plafond d'espèces détenues : propre au livreur, sinon réglage plateforme (settings/payments.cash). */
export async function cashLimitOf(priv: Partial<DriverPrivate> | null | undefined): Promise<number> {
  if (priv?.cashLimitCents && priv.cashLimitCents > 0) return priv.cashLimitCents;
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.payments).get();
  const cash = (snap.data() as Partial<PaymentSettings> | undefined)?.cash;
  return cash?.driverCashLimitCents && cash.driverCashLimitCents > 0 ? cash.driverCashLimitCents : DEFAULT_LIMIT_CENTS;
}

/**
 * Le livreur peut-il prendre cette commande ? Une commande payée en espèces exige que les
 * espèces soient autorisées pour lui et que sa caisse soit sous le plafond.
 */
export async function assertDriverCanTakeOrder(driverId: string, order: Pick<Order, 'payment'>): Promise<void> {
  if (order.payment.method !== 'cash') return;
  const [driverSnap, privSnap] = await Promise.all([db.collection(COLLECTIONS.drivers).doc(driverId).get(), db.collection(COLLECTIONS.driverPrivate).doc(driverId).get()]);
  const driver = driverSnap.data() as Driver | undefined;
  if (!driver?.acceptsCash) throw fail.precondition('Ce livreur n’est pas autorisé à encaisser des espèces : choisissez un autre livreur ou faites autoriser les espèces pour lui.');
  const priv = privSnap.exists ? (privSnap.data() as DriverPrivate) : null;
  const balance = priv?.cashBalanceCents ?? 0;
  const limit = await cashLimitOf(priv);
  if (balance >= limit) {
    throw fail.precondition(`${driver.displayName} détient ${euros(balance)} en espèces (plafond ${euros(limit)}) : enregistrez sa remise de caisse avant de lui confier une commande payée en espèces.`);
  }
}

/** Reflet du solde d'espèces sur la fiche livreur du commerce (lue par le back-office du commerce). */
export async function mirrorCourierCash(restaurantId: string, driverId: string, balanceCents: number, limitCents: number): Promise<void> {
  await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.couriers).doc(driverId).set({ cashHeldCents: balanceCents, cashLimitCents: limitCents }, { merge: true });
}

/**
 * Commande livrée et payée en espèces par un livreur salarié du commerce : la caisse du livreur
 * augmente du montant encaissé. Idempotent (mouvement à identifiant déterministe).
 */
export async function trackMerchantCash(orderId: string, order: Order): Promise<{ tracked: boolean; balanceCents: number }> {
  const collected = order.payment.method === 'cash' && order.closedAs !== 'customer_absent' ? order.amounts.chargedCents : 0;
  const driverId = order.driverId ?? order.delivery?.driverId ?? null;
  if (collected <= 0 || !driverId || order.fulfillment !== 'delivery' || order.delivery?.deliveredBy !== 'restaurant') return { tracked: false, balanceCents: 0 };
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  const driver = driverSnap.data() as Driver | undefined;
  if (!driver || driver.type !== 'restaurant') return { tracked: false, balanceCents: 0 };
  const privRef = db.collection(COLLECTIONS.driverPrivate).doc(driverId);
  const movementRef = db.collection(COLLECTIONS.cashMovements).doc(`cash-${orderId}`);
  const test = (order as Order & { test?: boolean }).test === true;
  const result = await db.runTransaction(async (tx) => {
    const [existing, privSnap] = await Promise.all([tx.get(movementRef), tx.get(privRef)]);
    if (existing.exists) return { created: false, balance: (existing.data() as CashMovement).balanceAfterCents };
    const balance = ((privSnap.get('cashBalanceCents') as number | undefined) ?? 0) + collected;
    const movement: CashMovement = {
      countryId: order.countryId,
      cityId: order.cityId,
      restaurantId: order.restaurantId,
      driverId,
      driverName: driver.displayName,
      type: 'collected',
      amountCents: collected,
      balanceAfterCents: balance,
      orderId,
      orderNumber: order.number,
      note: `Espèces encaissées ${order.number}`,
      createdAt: Timestamp.now(),
      createdBy: 'system',
    };
    tx.set(movementRef, { ...movement, ...(test ? { test: true } : {}) });
    tx.set(privRef, { cashBalanceCents: balance, updatedAt: Timestamp.now() }, { merge: true });
    return { created: true, balance };
  });
  if (result.created) {
    const limit = await cashLimitOf((await privRef.get()).data() as DriverPrivate | undefined);
    await mirrorCourierCash(order.restaurantId, driverId, result.balance, limit).catch((error) => logger.warn('Solde d’espèces non reflété', { orderId, error: String(error) }));
    if (result.balance >= limit) {
      await messageRestaurantFinance(order.restaurantId, 'cash_limit_reached', { driverName: driver.displayName, amount: euros(result.balance), limit: euros(limit) }, { dedupeKey: `${driverId}-${orderId}` }, test).catch((error) => logger.warn('Alerte plafond d’espèces non remise', { orderId, error: String(error) }));
    }
  }
  return { tracked: result.created, balanceCents: result.balance };
}

/**
 * Remise de caisse : le livreur salarié remet ses espèces au commerce. Enregistrée par le
 * commerce (ou par l'équipe Ciyou Eats), motif facultatif pour le commerce, audit systématique.
 */
export const recordMerchantCashRemittance = argentCallable(
  z.object({ restaurantId: zId, driverId: zId, amountCents: z.number().int().min(1).max(5_000_000), note: z.string().trim().max(200).nullish() }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'couriers.manage', 'finance.adjust');
    const driverSnap = await db.collection(COLLECTIONS.drivers).doc(data.driverId).get();
    const driver = driverSnap.data() as Driver | undefined;
    if (!driver || driver.type !== 'restaurant' || !driver.restaurantIds.includes(data.restaurantId)) throw fail.precondition('Ce livreur ne fait pas partie des livreurs salariés de ce commerce.');
    const privRef = db.collection(COLLECTIONS.driverPrivate).doc(data.driverId);
    const movementRef = db.collection(COLLECTIONS.cashMovements).doc();
    const now = Timestamp.now();
    const balance = await db.runTransaction(async (tx) => {
      const snap = await tx.get(privRef);
      const current = (snap.get('cashBalanceCents') as number | undefined) ?? 0;
      if (data.amountCents > current) throw fail.precondition(`Ce livreur ne détient que ${euros(current)} en espèces.`);
      const next = current - data.amountCents;
      tx.set(privRef, { cashBalanceCents: next, updatedAt: now }, { merge: true });
      const movement: CashMovement = { countryId: driver.countryId, cityId: driver.cityId, restaurantId: data.restaurantId, driverId: data.driverId, driverName: driver.displayName, type: 'remitted', amountCents: -data.amountCents, balanceAfterCents: next, note: data.note ?? 'Remise de caisse', createdAt: now, createdBy: actor.caller.uid };
      tx.set(movementRef, movement);
      return next;
    });
    await mirrorCourierCash(data.restaurantId, data.driverId, balance, await cashLimitOf((await privRef.get()).data() as DriverPrivate | undefined));
    await writeAudit({ actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'), action: 'driver.cash_remitted', target: { type: 'driver', id: data.driverId, label: driver.displayName }, after: { amountCents: data.amountCents, cashBalanceCents: balance, restaurantId: data.restaurantId }, countryId: driver.countryId, cityId: driver.cityId, request, sensitive: true });
    return { cashBalanceCents: balance, movementId: movementRef.id };
  },
);
