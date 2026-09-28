// Produit indisponible (cahier §9) : le commerce signale qu'un article manque en cours de préparation.
// Selon les règles de la ville, un remplacement est proposé au client (il répond dans le délai réglé),
// sinon l'article est retiré et remboursé partiellement. Sans réponse du client, l'article est retiré.
//   - reportItemUnavailable : commerce (ou administrateur habilité) -> remplacement proposé ou retrait
//   - respondToItemProposal : client -> accepte (remplacement) ou refuse (retrait et remboursement)
//   - expireItemProposals   : tâche planifiée -> retrait des propositions sans réponse
// Le client ne paie jamais plus que l'article d'origine ; la différence éventuelle est remboursée.
import { COLLECTIONS, SUBCOLLECTIONS, formatPrice, type ItemProposal, type Order, type OrderItem, type OrderRules, type Product } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { requireAuth } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { z, zId } from '../lib/validation';
import { sendPlatformMessage } from '../notifications/messages';
import { issueAutoRefund } from './auto-refund';
import { cancelOrderInternal } from './cancel';
import { addEvent, eventActorOf, loadMarket, loadOrder, loadOrderRules, orderRef, requireOrderStaff, SYSTEM_EVENT_ACTOR, type EventActor } from './context';
import { ordersCallable as callable } from './runtime';

const ADJUSTABLE: readonly Order['status'][] = ['accepted', 'preparing'];

function lineOf(order: Order, lineId: string): OrderItem {
  const line = order.items.find((i) => i.lineId === lineId);
  if (!line) throw fail.notFound('Article de la commande');
  return line;
}

function lineAmount(item: OrderItem): number {
  return item.finalTotalCents ?? item.totalCents;
}

/** Part de la remise sur articles à déduire du remboursement d'une ligne (le client n'a pas payé cette part). */
function discountShare(order: Order, cents: number): number {
  const subtotal = order.amounts.subtotalCents;
  if (subtotal <= 0) return 0;
  return Math.round((order.amounts.discount.onItemsCents * cents) / subtotal);
}

/** Recalcule la date limite de réponse la plus proche parmi les propositions en attente. */
function nextDeadline(proposals: Record<string, ItemProposal> | null | undefined): Timestamp | null {
  const pending = Object.values(proposals ?? {}).filter((p) => p.status === 'pending');
  if (pending.length === 0) return null;
  return Timestamp.fromMillis(Math.min(...pending.map((p) => p.expiresAt.toMillis())));
}

/** Commission du commerce recalculée quand un article est retiré : elle ne porte que sur ce que le client a payé. */
function scaledSettlement(order: Order, removedNetCents: number): Record<string, number> | null {
  const rs = order.restaurantSettlement;
  if (!rs || rs.commissionBaseCents <= 0 || removedNetCents <= 0) return null;
  const base = Math.max(0, rs.commissionBaseCents - removedNetCents);
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

interface RemovalInput {
  orderId: string;
  lineId: string;
  actor: EventActor;
  reason: string;
  markUnavailable: boolean;
  auditActor: Parameters<typeof writeAudit>[0]['actor'];
  request?: Parameters<typeof writeAudit>[0]['request'];
}

/** Retire un article (indisponible ou refus du remplacement) et rembourse la part payée par le client. */
async function removeItem(input: RemovalInput): Promise<{ refundCents: number; cancelled: boolean }> {
  const order = await loadOrder(input.orderId);
  if (!ADJUSTABLE.includes(order.status)) throw fail.precondition('Cette commande n’est plus en préparation : l’article ne peut plus être retiré.');
  const line = lineOf(order, input.lineId);
  if (line.adjustment) throw fail.precondition('Cet article a déjà été traité.');
  const gross = lineAmount(line);
  const refundCents = Math.max(0, gross - discountShare(order, gross));
  const at = Timestamp.now();

  const remainingAfter = order.items.filter((i) => i.lineId !== input.lineId && i.adjustment?.type !== 'removed').length;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef(input.orderId));
    const current = snap.data() as Order;
    if (!ADJUSTABLE.includes(current.status)) throw fail.precondition('Cette commande n’est plus en préparation.');
    const target = lineOf(current, input.lineId);
    if (target.adjustment) throw fail.precondition('Cet article a déjà été traité.');
    const items = current.items.map((i) => (i.lineId === input.lineId ? { ...i, adjustment: { type: 'removed' as const, replacementName: null, refundCents, at, by: input.actor.uid ?? 'system' } } : i));
    const proposals = { ...(current.itemProposals ?? {}) };
    if (proposals[input.lineId]?.status === 'pending') proposals[input.lineId] = { ...proposals[input.lineId]!, status: 'declined', decidedAt: at };
    tx.update(snap.ref, {
      items,
      ...(Object.keys(proposals).length ? { itemProposals: proposals } : {}),
      proposalDeadline: nextDeadline(proposals),
      ...(scaledSettlement(current, refundCents) ?? {}),
      updatedAt: at,
    });
    addEvent(tx, input.orderId, input.actor, {
      type: 'item_removed',
      from: null,
      to: null,
      visibleToCustomer: true,
      message: `« ${line.name} » retiré de la commande : ${input.reason}`,
      data: { lineId: input.lineId, refundCents },
    }, at);
  });

  if (input.markUnavailable) {
    const productRef = db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).collection(SUBCOLLECTIONS.restaurants.products).doc(line.productId);
    await productRef.update({ available: false, updatedAt: at, updatedBy: input.actor.uid ?? 'system' }).catch(() => undefined);
  }

  let cancelled = false;
  if (remainingAfter === 0) {
    // Plus aucun article à servir : la commande est annulée et le solde remboursé.
    await cancelOrderInternal({ orderId: input.orderId, actor: SYSTEM_EVENT_ACTOR, reason: 'item_unavailable', details: 'Tous les articles sont indisponibles.', restock: false });
    cancelled = true;
  } else if (refundCents > 0) {
    await issueAutoRefund({
      orderId: input.orderId,
      key: `item-${input.lineId}`,
      amountCents: refundCents,
      cause: 'item_unavailable',
      reason: `Article indisponible : ${line.name}`,
      actor: input.actor,
      lineIds: [input.lineId],
    });
  }

  await writeAudit({
    actor: input.auditActor,
    action: 'order.item_removed',
    target: { type: 'order', id: input.orderId, label: `${order.number} · ${order.restaurantName}` },
    reason: input.reason,
    before: { lineId: input.lineId, name: line.name, totalCents: gross },
    after: { removed: true, refundCents, orderCancelled: cancelled },
    countryId: order.countryId,
    cityId: order.cityId ?? null,
    request: input.request,
  });
  if (!cancelled) {
    await sendPlatformMessage(
      'item_removed',
      { uid: order.customerId, type: 'client', name: order.customerName, demo: order.test === true },
      { orderNumber: order.number, itemName: line.name, amount: formatPrice(refundCents) },
      { dedupeKey: `${input.orderId}-${input.lineId}`, link: { type: 'order', target: input.orderId } },
    );
  }
  return { refundCents, cancelled };
}

// ------------------------------------------------------------------ Signalement par le commerce

export const reportItemUnavailable = callable(
  z.object({ orderId: zId, lineId: z.string().trim().min(1).max(64), replacementProductId: zId.nullish() }),
  async (data, request) => {
    const order = await loadOrder(data.orderId);
    const staff = await requireOrderStaff(request, order, 'orders.manage');
    if (!ADJUSTABLE.includes(order.status)) throw fail.precondition('Un article ne peut être signalé indisponible que pendant la préparation.');
    const line = lineOf(order, data.lineId);
    if (line.adjustment) throw fail.precondition('Cet article a déjà été traité.');
    if (order.itemProposals?.[data.lineId]?.status === 'pending') throw fail.precondition('Un remplacement est déjà proposé au client pour cet article.');
    const rules: OrderRules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    const actor = eventActorOf(staff);
    const auditActor = actorFromCaller(staff.caller, staff.kind === 'admin' ? 'admin' : 'restaurant');

    if (data.replacementProductId && rules.itemUnavailable.allowReplacement) {
      const productSnap = await db.collection(COLLECTIONS.restaurants).doc(order.restaurantId).collection(SUBCOLLECTIONS.restaurants.products).doc(data.replacementProductId).get();
      const product = productSnap.data() as Product | undefined;
      if (!product) throw fail.notFound('Produit de remplacement');
      if (!product.available || product.containsAlcohol || product.vatCategory === 'alcohol') throw fail.precondition('Ce produit ne peut pas être proposé en remplacement.');
      if (product.stock !== null && product.stock !== undefined && product.stock < line.quantity) throw fail.precondition('Stock insuffisant pour ce produit de remplacement.');
      if (productSnap.id === line.productId) throw fail.invalid('Choisissez un autre produit que l’article indisponible.');
      const at = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(at.toMillis() + rules.itemUnavailable.replacementTimeoutSeconds * 1000);
      const proposal: ItemProposal = {
        lineId: data.lineId,
        status: 'pending',
        productName: line.name,
        replacementProductId: productSnap.id,
        replacementName: product.name,
        replacementUnitPriceCents: product.priceCents,
        proposedAt: at,
        proposedBy: actor.uid ?? 'restaurant',
        expiresAt,
        decidedAt: null,
      };
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef(data.orderId));
        const current = snap.data() as Order;
        if (!ADJUSTABLE.includes(current.status) || lineOf(current, data.lineId).adjustment) throw fail.precondition('Cet article a déjà été traité.');
        const proposals = { ...(current.itemProposals ?? {}), [data.lineId]: proposal };
        tx.update(snap.ref, { itemProposals: proposals, proposalDeadline: nextDeadline(proposals), updatedAt: at });
        addEvent(tx, data.orderId, actor, {
          type: 'item_proposed',
          from: null,
          to: null,
          visibleToCustomer: true,
          message: `« ${line.name} » est indisponible : « ${product.name} » proposé en remplacement.`,
          data: { lineId: data.lineId, replacementProductId: productSnap.id, expiresAt: expiresAt.toMillis() },
        }, at);
      });
      await writeAudit({
        actor: auditActor,
        action: 'order.item_replacement_proposed',
        target: { type: 'order', id: data.orderId, label: `${order.number} · ${order.restaurantName}` },
        reason: `« ${line.name} » indisponible`,
        after: { lineId: data.lineId, replacement: product.name, expiresAt: expiresAt.toDate().toISOString() },
        countryId: order.countryId,
        cityId: order.cityId ?? null,
        request,
      });
      await sendPlatformMessage(
        'item_replacement_proposed',
        { uid: order.customerId, type: 'client', name: order.customerName, demo: order.test === true },
        { restaurantName: order.restaurantName, orderNumber: order.number, itemName: line.name, replacementName: product.name, minutes: Math.round(rules.itemUnavailable.replacementTimeoutSeconds / 60) },
        { dedupeKey: `${data.orderId}-${data.lineId}`, link: { type: 'order', target: data.orderId } },
      );
      return { status: 'proposed' as const, expiresAt: expiresAt.toMillis(), refundCents: 0 };
    }

    const removed = await removeItem({ orderId: data.orderId, lineId: data.lineId, actor, reason: 'article indisponible', markUnavailable: true, auditActor, request });
    return { status: removed.cancelled ? ('order_cancelled' as const) : ('removed' as const), expiresAt: null, refundCents: removed.refundCents };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

// ------------------------------------------------------------------ Réponse du client

export const respondToItemProposal = callable(
  z.object({ orderId: zId, lineId: z.string().trim().min(1).max(64), accept: z.boolean() }),
  async (data, request) => {
    const caller = requireAuth(request);
    const order = await loadOrder(data.orderId);
    if (order.customerId !== caller.uid) throw fail.forbidden();
    const proposal = order.itemProposals?.[data.lineId];
    if (!proposal || proposal.status !== 'pending') throw fail.precondition('Aucun remplacement n’est en attente pour cet article.');
    if (proposal.expiresAt.toMillis() < Date.now()) throw fail.precondition('Le délai de réponse est dépassé : l’article a été retiré.');
    const actor: EventActor = { type: 'customer', uid: caller.uid, name: order.customerName };
    const auditActor = actorFromCaller(caller, 'client');

    if (!data.accept) {
      const removed = await removeItem({ orderId: data.orderId, lineId: data.lineId, actor, reason: 'remplacement refusé par le client', markUnavailable: true, auditActor, request });
      return { status: 'removed' as const, refundCents: removed.refundCents };
    }

    const line = lineOf(order, data.lineId);
    const oldTotal = lineAmount(line);
    const newTotal = Math.min(oldTotal, proposal.replacementUnitPriceCents * line.quantity);
    const difference = oldTotal - newTotal;
    const refundCents = Math.max(0, difference - discountShare(order, difference));
    const at = Timestamp.now();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef(data.orderId));
      const current = snap.data() as Order;
      if (!ADJUSTABLE.includes(current.status)) throw fail.precondition('Cette commande n’est plus en préparation.');
      const stored = current.itemProposals?.[data.lineId];
      if (!stored || stored.status !== 'pending') throw fail.precondition('Ce remplacement a déjà été traité.');
      const items = current.items.map((i) =>
        i.lineId === data.lineId
          ? { ...i, finalTotalCents: newTotal, adjustment: { type: 'replaced' as const, replacementName: proposal.replacementName, refundCents, at, by: caller.uid } }
          : i,
      );
      const proposals = { ...(current.itemProposals ?? {}), [data.lineId]: { ...stored, status: 'accepted' as const, decidedAt: at } };
      tx.update(snap.ref, { items, itemProposals: proposals, proposalDeadline: nextDeadline(proposals), ...(scaledSettlement(current, refundCents) ?? {}), updatedAt: at });
      addEvent(tx, data.orderId, actor, {
        type: 'item_replaced',
        from: null,
        to: null,
        visibleToCustomer: true,
        message: `« ${line.name} » remplacé par « ${proposal.replacementName} » avec l’accord du client.`,
        data: { lineId: data.lineId, refundCents },
      }, at);
    });
    if (refundCents > 0) {
      await issueAutoRefund({ orderId: data.orderId, key: `item-${data.lineId}`, amountCents: refundCents, cause: 'item_unavailable', reason: `Remplacement plus économique : ${line.name}`, actor, lineIds: [data.lineId] });
    }
    await writeAudit({
      actor: auditActor,
      action: 'order.item_replaced',
      target: { type: 'order', id: data.orderId, label: `${order.number} · ${order.restaurantName}` },
      reason: 'Remplacement accepté par le client',
      before: { lineId: data.lineId, name: line.name, totalCents: oldTotal },
      after: { replacement: proposal.replacementName, totalCents: newTotal, refundCents },
      countryId: order.countryId,
      cityId: order.cityId ?? null,
      request,
    });
    return { status: 'replaced' as const, refundCents };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);

// ------------------------------------------------------------------ Sans réponse : retrait

/** Tâche planifiée : les propositions dont le délai est écoulé sont retirées et remboursées. */
export async function expireItemProposals(now: Timestamp): Promise<number> {
  const snap = await db.collection(COLLECTIONS.orders).where('proposalDeadline', '<=', now).limit(50).get();
  let count = 0;
  for (const doc of snap.docs) {
    const order = doc.data() as Order;
    for (const proposal of Object.values(order.itemProposals ?? {})) {
      if (proposal.status !== 'pending' || proposal.expiresAt.toMillis() > now.toMillis()) continue;
      try {
        await removeItem({
          orderId: doc.id,
          lineId: proposal.lineId,
          actor: SYSTEM_EVENT_ACTOR,
          reason: 'sans réponse du client dans le délai',
          markUnavailable: true,
          auditActor: SYSTEM_ACTOR,
        });
        count += 1;
      } catch (error) {
        logger.warn('Retrait automatique d’un article impossible', { orderId: doc.id, lineId: proposal.lineId, error: error instanceof Error ? error.message : String(error) });
        // La commande a pu changer d'étape : la proposition est clôturée pour ne pas être rejouée.
        await doc.ref.update({ [`itemProposals.${proposal.lineId}.status`]: 'expired', proposalDeadline: null }).catch(() => undefined);
      }
    }
  }
  return count;
}
