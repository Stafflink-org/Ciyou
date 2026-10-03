// Espèces, Tickets Restaurant et montants carte encaissés en personne par les livreurs
// salariés du commerce (décision client : paiement à la livraison uniquement avec un livreur
// salarié rattaché au commerce comme employé). L'argent reste chez le commerce : le livreur
// encaisse à la livraison (le moyen réel — espèces, ticket papier ou carte via son terminal —
// est saisi à la remise, voir `Order.payment.collectedAs`), détient la caisse, puis la remet
// au commerce. Ce module suit le solde détenu par livreur et par moyen, applique le plafond
// (espèces seulement, décision client d'origine) et enregistre les remises.
import { COLLECTED_PAYMENT_METHODS, COLLECTIONS, SETTINGS_DOCS, SUBCOLLECTIONS, type CashMovement, type CollectedPaymentMethod, type Driver, type DriverPrivate, type Order, type PaymentSettings } from '@golink/shared';
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

/** Champ de solde détenu (driverPrivate) et libellé pour chaque moyen encaissé en personne. */
const BALANCE_FIELD: Record<CollectedPaymentMethod, 'cashBalanceCents' | 'mealVoucherBalanceCents' | 'cardTerminalBalanceCents'> = {
  cash: 'cashBalanceCents',
  meal_voucher: 'mealVoucherBalanceCents',
  card: 'cardTerminalBalanceCents',
};
const MIRROR_FIELD: Record<CollectedPaymentMethod, 'cashHeldCents' | 'mealVoucherHeldCents' | 'cardTerminalHeldCents'> = {
  cash: 'cashHeldCents',
  meal_voucher: 'mealVoucherHeldCents',
  card: 'cardTerminalHeldCents',
};
const METHOD_LABELS: Record<CollectedPaymentMethod, string> = { cash: 'espèces', meal_voucher: 'tickets restaurant', card: 'carte' };

function balanceOf(priv: Partial<DriverPrivate> | null | undefined, method: CollectedPaymentMethod): number {
  return (priv?.[BALANCE_FIELD[method]] as number | undefined) ?? 0;
}

/** Plafond d'espèces détenues (espèces seulement) : propre au livreur, sinon réglage plateforme (settings/payments.cash). */
export async function cashLimitOf(priv: Partial<DriverPrivate> | null | undefined): Promise<number> {
  if (priv?.cashLimitCents && priv.cashLimitCents > 0) return priv.cashLimitCents;
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.payments).get();
  const cash = (snap.data() as Partial<PaymentSettings> | undefined)?.cash;
  return cash?.driverCashLimitCents && cash.driverCashLimitCents > 0 ? cash.driverCashLimitCents : DEFAULT_LIMIT_CENTS;
}

/**
 * Le livreur peut-il prendre cette commande ? Une commande payée à la livraison exige que les
 * espèces soient autorisées pour lui et que sa caisse d'espèces soit sous le plafond (le moyen
 * réel n'est connu qu'à la remise ; le plafond, décision client d'origine, ne porte que sur les
 * espèces, Tickets Restaurant et carte n'ayant pas le même risque de perte).
 */
export async function assertDriverCanTakeOrder(driverId: string, order: Pick<Order, 'payment'>): Promise<void> {
  if (order.payment.method !== 'cash') return;
  const [driverSnap, privSnap] = await Promise.all([db.collection(COLLECTIONS.drivers).doc(driverId).get(), db.collection(COLLECTIONS.driverPrivate).doc(driverId).get()]);
  const driver = driverSnap.data() as Driver | undefined;
  if (!driver?.acceptsCash) throw fail.precondition('Ce livreur n’est pas autorisé à encaisser des espèces : choisissez un autre livreur ou faites autoriser les espèces pour lui.');
  const priv = privSnap.exists ? (privSnap.data() as DriverPrivate) : null;
  const balance = balanceOf(priv, 'cash');
  const limit = await cashLimitOf(priv);
  if (balance >= limit) {
    throw fail.precondition(`${driver.displayName} détient ${euros(balance)} en espèces (plafond ${euros(limit)}) : enregistrez sa remise de caisse avant de lui confier une commande payée en espèces.`);
  }
}

/** Reflet du solde détenu (un moyen) sur la fiche livreur du commerce (lue par le back-office). */
export async function mirrorCourierBalance(restaurantId: string, driverId: string, method: CollectedPaymentMethod, balanceCents: number, cashLimitCents?: number): Promise<void> {
  await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.couriers)
    .doc(driverId)
    .set({ [MIRROR_FIELD[method]]: balanceCents, ...(method === 'cash' && cashLimitCents !== undefined ? { cashLimitCents } : {}) }, { merge: true });
}

/**
 * Commande livrée et payée à la livraison par un livreur salarié du commerce : la caisse du
 * livreur augmente du montant encaissé, sur le moyen réellement utilisé (espèces par défaut,
 * rétrocompatible). Idempotent (mouvement à identifiant déterministe).
 */
export async function trackMerchantCash(orderId: string, order: Order): Promise<{ tracked: boolean; balanceCents: number }> {
  const collected = order.payment.method === 'cash' && order.closedAs !== 'customer_absent' ? order.amounts.chargedCents : 0;
  const driverId = order.driverId ?? order.delivery?.driverId ?? null;
  if (collected <= 0 || !driverId || order.fulfillment !== 'delivery' || order.delivery?.deliveredBy !== 'restaurant') return { tracked: false, balanceCents: 0 };
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  const driver = driverSnap.data() as Driver | undefined;
  if (!driver || driver.type !== 'restaurant') return { tracked: false, balanceCents: 0 };
  const method: CollectedPaymentMethod = order.payment.collectedAs ?? 'cash';
  const field = BALANCE_FIELD[method];
  const privRef = db.collection(COLLECTIONS.driverPrivate).doc(driverId);
  const movementRef = db.collection(COLLECTIONS.cashMovements).doc(`cash-${orderId}`);
  const test = (order as Order & { test?: boolean }).test === true;
  const result = await db.runTransaction(async (tx) => {
    const [existing, privSnap] = await Promise.all([tx.get(movementRef), tx.get(privRef)]);
    if (existing.exists) return { created: false, balance: (existing.data() as CashMovement).balanceAfterCents };
    const previousBalance = (privSnap.get(field) as number | undefined) ?? 0;
    const balance = previousBalance + collected;
    const movement: CashMovement = {
      countryId: order.countryId,
      cityId: order.cityId,
      restaurantId: order.restaurantId,
      driverId,
      driverName: driver.displayName,
      type: 'collected',
      method,
      amountCents: collected,
      balanceAfterCents: balance,
      orderId,
      orderNumber: order.number,
      note: `${method === 'cash' ? 'Espèces' : method === 'meal_voucher' ? 'Tickets restaurant' : 'Carte'} encaissés ${order.number}`,
      createdAt: Timestamp.now(),
      createdBy: 'system',
    };
    tx.set(movementRef, { ...movement, ...(test ? { test: true } : {}) });
    tx.set(privRef, { [field]: balance, ...(method === 'cash' && previousBalance <= 0 ? { cashSinceAt: Timestamp.now() } : {}), updatedAt: Timestamp.now() }, { merge: true });
    return { created: true, balance };
  });
  if (result.created) {
    const priv = (await privRef.get()).data() as DriverPrivate | undefined;
    const limit = method === 'cash' ? await cashLimitOf(priv) : undefined;
    await mirrorCourierBalance(order.restaurantId, driverId, method, result.balance, limit).catch((error) => logger.warn('Solde détenu non reflété', { orderId, method, error: String(error) }));
    if (method === 'cash' && limit !== undefined && result.balance >= limit) {
      await messageRestaurantFinance(order.restaurantId, 'cash_limit_reached', { driverName: driver.displayName, amount: euros(result.balance), limit: euros(limit) }, { dedupeKey: `${driverId}-${orderId}` }, test).catch((error) => logger.warn('Alerte plafond d’espèces non remise', { orderId, error: String(error) }));
    }
  }
  return { tracked: result.created, balanceCents: result.balance };
}

/**
 * Remise de caisse (espèces uniquement, montant partiel ou total) : le livreur salarié remet
 * ses espèces au commerce. Enregistrée par le commerce (ou par l'équipe Ciyou Eats), motif
 * facultatif, audit systématique. Pour les Tickets Restaurant et la carte (pas de plafond, pas
 * de remise partielle attendue), voir `resetDriverCashBalance`.
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
      tx.set(privRef, { cashBalanceCents: next, cashSinceAt: next > 0 ? now : null, lastCashRemittanceAt: now, updatedAt: now }, { merge: true });
      const movement: CashMovement = { countryId: driver.countryId, cityId: driver.cityId, restaurantId: data.restaurantId, driverId: data.driverId, driverName: driver.displayName, type: 'remitted', method: 'cash', amountCents: -data.amountCents, balanceAfterCents: next, note: data.note ?? 'Remise de caisse', createdAt: now, createdBy: actor.caller.uid };
      tx.set(movementRef, movement);
      return next;
    });
    await mirrorCourierBalance(data.restaurantId, data.driverId, 'cash', balance, await cashLimitOf((await privRef.get()).data() as DriverPrivate | undefined));
    await writeAudit({ actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'), action: 'driver.cash_remitted', target: { type: 'driver', id: data.driverId, label: driver.displayName }, after: { amountCents: data.amountCents, cashBalanceCents: balance, restaurantId: data.restaurantId }, countryId: driver.countryId, cityId: driver.cityId, request, sensitive: true });
    return { cashBalanceCents: balance, movementId: movementRef.id };
  },
);

/**
 * Remise à zéro en un geste d'un solde détenu par un livreur salarié (document client « Points
 * à corriger », Backoffice resto #6) : un bouton par moyen (espèces, Tickets Restaurant, carte).
 * Pour les espèces, préférer `recordMerchantCashRemittance` pour une remise partielle ; ce
 * callable couvre le cas « tout remis d'un coup », identique pour les 3 moyens.
 */
export const resetDriverCashBalance = argentCallable(
  z.object({ restaurantId: zId, driverId: zId, method: z.enum(COLLECTED_PAYMENT_METHODS), note: z.string().trim().max(200).nullish() }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'couriers.manage', 'finance.adjust');
    const driverSnap = await db.collection(COLLECTIONS.drivers).doc(data.driverId).get();
    const driver = driverSnap.data() as Driver | undefined;
    if (!driver || driver.type !== 'restaurant' || !driver.restaurantIds.includes(data.restaurantId)) throw fail.precondition('Ce livreur ne fait pas partie des livreurs salariés de ce commerce.');
    const field = BALANCE_FIELD[data.method];
    const privRef = db.collection(COLLECTIONS.driverPrivate).doc(data.driverId);
    const movementRef = db.collection(COLLECTIONS.cashMovements).doc();
    const now = Timestamp.now();
    const previous = await db.runTransaction(async (tx) => {
      const snap = await tx.get(privRef);
      const current = (snap.get(field) as number | undefined) ?? 0;
      if (current <= 0) throw fail.precondition(`Ce livreur ne détient rien en ${METHOD_LABELS[data.method]}.`);
      tx.set(privRef, { [field]: 0, ...(data.method === 'cash' ? { cashSinceAt: null, lastCashRemittanceAt: now } : {}), updatedAt: now }, { merge: true });
      const movement: CashMovement = { countryId: driver.countryId, cityId: driver.cityId, restaurantId: data.restaurantId, driverId: data.driverId, driverName: driver.displayName, type: 'remitted', method: data.method, amountCents: -current, balanceAfterCents: 0, note: data.note ?? 'Remise à zéro', createdAt: now, createdBy: actor.caller.uid };
      tx.set(movementRef, movement);
      return current;
    });
    await mirrorCourierBalance(data.restaurantId, data.driverId, data.method, 0, data.method === 'cash' ? await cashLimitOf((await privRef.get()).data() as DriverPrivate | undefined) : undefined);
    await writeAudit({ actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'), action: 'driver.cash_remitted', target: { type: 'driver', id: data.driverId, label: driver.displayName }, after: { amountCents: previous, method: data.method, restaurantId: data.restaurantId }, countryId: driver.countryId, cityId: driver.cityId, request, sensitive: true });
    return { balanceCents: 0, movementId: movementRef.id };
  },
);
