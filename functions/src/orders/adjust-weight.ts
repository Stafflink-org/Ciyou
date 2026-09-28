// Ajustement à la préparation d'un article vendu au poids ou à prix variable (cahier
// weight-based-pricing) : le commerce entre le poids réellement pesé, ou fixe le prix final
// (plafonné au prix variable maximal pré-autorisé à la commande). Le client ne paie jamais plus
// que le montant autorisé à la commande (même principe que le retrait d'un article indisponible,
// cf. item-unavailable.ts) : un écart à la baisse est remboursé automatiquement, un écart à la
// hausse (poids réel supérieur à l'estimation) est absorbé par le commerce, jamais refacturé.
import { COLLECTIONS, SUBCOLLECTIONS, formatPrice, type Order, type OrderItem, type Product } from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { z, zId } from '../lib/validation';
import { sendPlatformMessage } from '../notifications/messages';
import { issueAutoRefund } from './auto-refund';
import { addEvent, eventActorOf, loadOrder, orderRef, requireOrderStaff } from './context';
import { ordersCallable as callable } from './runtime';

const ADJUSTABLE: readonly Order['status'][] = ['accepted', 'preparing'];

function lineOf(order: Order, lineId: string): OrderItem {
  const line = order.items.find((i) => i.lineId === lineId);
  if (!line) throw fail.notFound('Article de la commande');
  return line;
}

/** Part de la remise sur articles à déduire du remboursement d'une ligne (le client n'a pas payé cette part). */
function discountShare(order: Order, cents: number): number {
  const subtotal = order.amounts.subtotalCents;
  if (subtotal <= 0 || cents <= 0) return 0;
  return Math.round((order.amounts.discount.onItemsCents * cents) / subtotal);
}

/** Commission du commerce recalculée quand un remboursement réduit ce que le client a payé pour cette ligne. */
function scaledSettlement(order: Order, refundedNetCents: number): Record<string, number> | null {
  const rs = order.restaurantSettlement;
  if (!rs || rs.commissionBaseCents <= 0 || refundedNetCents <= 0) return null;
  const base = Math.max(0, rs.commissionBaseCents - refundedNetCents);
  const ratio = base / rs.commissionBaseCents;
  const ht = Math.round(rs.commissionHtCents * ratio);
  const vat = Math.round(rs.commissionVatCents * ratio);
  return {
    'restaurantSettlement.commissionBaseCents': base,
    'restaurantSettlement.commissionHtCents': ht,
    'restaurantSettlement.commissionVatCents': vat,
    'restaurantSettlement.commissionTtcCents': ht + vat,
    'restaurantSettlement.payoutCents': rs.payoutCents + (rs.commissionTtcCents - (ht + vat)),
  };
}

export const adjustOrderItemWeight = callable(
  z.object({
    orderId: zId,
    lineId: z.string().trim().min(1).max(64),
    /** Article vendu au poids : poids réellement pesé (grammes). */
    actualWeightGrams: z.number().positive().max(100_000).optional(),
    /** Article à prix variable : prix final (centimes), plafonné au prix maximal pré-autorisé. */
    actualPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  }),
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    const staff = await requireOrderStaff(request, order, 'orders.manage');
    if (!ADJUSTABLE.includes(order.status)) throw fail.precondition('Le poids ou le prix ne peut être ajusté que pendant la préparation.');
    const line = lineOf(order, data.lineId);
    if (line.adjustment) throw fail.precondition('Cet article a déjà été traité.');
    if (line.finalTotalCents != null) throw fail.precondition('Le poids ou le prix de cet article a déjà été ajusté.');
    if (line.saleUnit !== 'weight' && line.saleUnit !== 'variable') {
      throw fail.precondition('Cet article n’est pas vendu au poids ni à prix variable.');
    }

    const productSnap = await db
      .collection(COLLECTIONS.restaurants)
      .doc(order.restaurantId)
      .collection(SUBCOLLECTIONS.restaurants.products)
      .doc(line.productId)
      .get();
    const product = productSnap.data() as Product | undefined;

    let newUnitCents: number;
    let actualWeightGrams: number | null = null;
    if (line.saleUnit === 'weight') {
      if (data.actualWeightGrams == null) throw fail.invalid('Indiquez le poids réellement pesé.');
      actualWeightGrams = Math.round(data.actualWeightGrams);
      // Même calcul que `lineUnitPriceCents` (moteur de tarification) : prix au kg × poids réel.
      const pricePerKgCents = line.pricePerKgCents ?? product?.pricePerKgCents ?? 0;
      newUnitCents = Math.round((pricePerKgCents * actualWeightGrams) / 1000);
    } else {
      if (data.actualPriceCents == null) throw fail.invalid('Indiquez le prix final de cet article.');
      const ceiling = product?.variablePriceMaxCents ?? line.unitPriceCents;
      if (data.actualPriceCents > ceiling) {
        throw fail.invalid(`Le prix final ne peut pas dépasser ${formatPrice(ceiling)} (montant autorisé à la commande).`);
      }
      newUnitCents = data.actualPriceCents;
    }

    const oldTotal = line.totalCents;
    // Le client ne paie jamais plus que le montant autorisé à la commande : un écart à la hausse
    // (poids réel supérieur à l'estimation) est absorbé par le commerce, jamais refacturé.
    const computedTotal = (newUnitCents + line.optionsPriceCents) * line.quantity;
    const newTotal = Math.min(oldTotal, Math.max(0, computedTotal));
    const grossDiff = oldTotal - newTotal;
    const refundCents = Math.max(0, grossDiff - discountShare(order, grossDiff));
    const at = Timestamp.now();
    const actor = eventActorOf(staff);
    const auditActor = actorFromCaller(staff.caller, staff.kind === 'admin' ? 'admin' : 'restaurant');

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef(data.orderId));
      const current = snap.data() as Order;
      if (!ADJUSTABLE.includes(current.status)) throw fail.precondition('Cette commande n’est plus en préparation.');
      const target = lineOf(current, data.lineId);
      if (target.finalTotalCents != null || target.adjustment) throw fail.precondition('Cet article a déjà été traité.');
      const items = current.items.map((i) => (i.lineId === data.lineId ? { ...i, actualWeightGrams, finalTotalCents: newTotal } : i));
      tx.update(snap.ref, { items, ...(scaledSettlement(current, grossDiff) ?? {}), updatedAt: at });
      addEvent(
        tx,
        data.orderId,
        actor,
        {
          type: 'item_weight_adjusted',
          from: null,
          to: null,
          visibleToCustomer: true,
          message:
            line.saleUnit === 'weight'
              ? `« ${line.name} » pesé : ${actualWeightGrams} g, ${formatPrice(newTotal)}.`
              : `« ${line.name} » : prix final fixé à ${formatPrice(newTotal)}.`,
          data: { lineId: data.lineId, actualWeightGrams, finalTotalCents: newTotal, refundCents },
        },
        at,
      );
    });

    if (refundCents > 0) {
      await issueAutoRefund({
        orderId: data.orderId,
        key: `weight-${data.lineId}`,
        amountCents: refundCents,
        cause: 'weight_adjustment',
        reason: line.saleUnit === 'weight' ? `Poids réel constaté : ${line.name}` : `Prix final fixé : ${line.name}`,
        actor,
        lineIds: [data.lineId],
      });
    }

    await writeAudit({
      actor: auditActor,
      action: 'order.item_weight_adjusted',
      target: { type: 'order', id: data.orderId, label: `${order.number} · ${order.restaurantName}` },
      reason: line.saleUnit === 'weight' ? `Pesée : ${actualWeightGrams} g` : 'Prix final fixé',
      before: { lineId: data.lineId, name: line.name, totalCents: oldTotal },
      after: { finalTotalCents: newTotal, refundCents, actualWeightGrams },
      countryId: order.countryId,
      cityId: order.cityId ?? null,
      request,
    });

    if (refundCents > 0) {
      await sendPlatformMessage(
        'item_weight_adjusted',
        { uid: order.customerId, type: 'client', name: order.customerName, demo: order.test === true },
        { orderNumber: order.number, itemName: line.name, amount: formatPrice(refundCents) },
        { dedupeKey: `${data.orderId}-weight-${data.lineId}`, link: { type: 'order', target: data.orderId } },
      );
    }

    return { finalTotalCents: newTotal, refundCents };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);
