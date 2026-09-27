// Promotions à la commande : offre saisie par code ou offre automatique la plus
// avantageuse, ciblage (nouveaux, inactifs depuis X jours, fidèles), limites, et
// libération de l'utilisation quand la commande est annulée.
import {
  COLLECTIONS,
  type FulfillmentMode,
  type Order,
  type Promotion,
  type PromotionRedemption,
  type Restaurant,
  type UserProfile,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { fail } from '../lib/errors';
import { loadPromotionSettings } from '../marketing/platform/common';

type WithId<T> = T & { id: string };
const DAY_MS = 86_400_000;

export interface PromotionContext {
  restaurant: WithId<Restaurant>;
  fulfillment: FulfillmentMode;
  uid: string;
  profile: UserProfile | null;
  nowMs: number;
}

export interface PromotionRules {
  /** Nombre de commandes livrées à partir duquel un client est « fidèle ». */
  loyalOrdersThreshold: number;
  /** Jours sans commande par défaut d'une offre « clients inactifs ». */
  inactiveDaysDefault: number;
}

export async function loadPromotionRules(): Promise<PromotionRules> {
  const settings = await loadPromotionSettings();
  return { loyalOrdersThreshold: settings.loyalOrdersThreshold ?? 5, inactiveDaysDefault: settings.inactiveDaysDefault ?? 30 };
}

/** L'offre vise-t-elle ce commerce, cette heure et ce mode de commande ? */
export function promotionApplies(p: Promotion, ctx: PromotionContext): boolean {
  const r = ctx.restaurant;
  const inScope =
    (p.scope === 'platform' && (p.restaurantIds.length === 0 || p.restaurantIds.includes(r.id))) ||
    (p.scope === 'country' && p.countryId === r.countryId) ||
    (p.scope === 'city' && p.cityIds.includes(r.cityId)) ||
    (p.scope === 'restaurant' && p.restaurantId === r.id);
  const inTime = p.startsAt.toMillis() <= ctx.nowMs && (!p.endsAt || p.endsAt.toMillis() > ctx.nowMs);
  return inScope && inTime && (p.modes.length === 0 || p.modes.includes(ctx.fulfillment));
}

/** Ciblage du client : message de refus, ou null si l'offre lui est ouverte. */
export function targetIssue(p: Promotion, ctx: PromotionContext, rules: PromotionRules): string | null {
  const orders = ctx.profile?.stats?.ordersCount ?? 0;
  switch (p.target) {
    case 'new_customers':
      return orders > 0 ? 'Ce code est réservé à une première commande.' : null;
    case 'inactive_customers': {
      const days = p.inactiveDays ?? rules.inactiveDaysDefault;
      const last = ctx.profile?.stats?.lastOrderAt?.toMillis() ?? null;
      // Un client qui n'a jamais commandé n'est pas « inactif » : c'est un nouveau client.
      if (last === null || (ctx.nowMs - last) / DAY_MS < days) return `Cette offre est réservée aux clients qui n’ont pas commandé depuis ${days} jours.`;
      return null;
    }
    case 'loyal_customers':
      return orders < rules.loyalOrdersThreshold ? `Cette offre est réservée aux clients fidèles (${rules.loyalOrdersThreshold} commandes ou plus).` : null;
    default:
      return null;
  }
}

async function customerUses(promotionId: string, uid: string): Promise<number> {
  const used = await db
    .collection(COLLECTIONS.promotionRedemptions)
    .where('promotionId', '==', promotionId)
    .where('userId', '==', uid)
    .where('status', '==', 'applied')
    .count()
    .get();
  return used.data().count;
}

/** Limites d'utilisation (lecture rapide avant devis ; recontrôlées dans la transaction de commande). */
export async function usageIssue(p: WithId<Promotion>, uid: string): Promise<string | null> {
  if (p.totalUsageLimit && p.stats.redemptions >= p.totalUsageLimit) return 'Ce code promo a atteint sa limite d’utilisation.';
  if ((await customerUses(p.id, uid)) >= Math.max(1, p.perCustomerLimit)) return 'Vous avez déjà utilisé ce code promo.';
  return null;
}

/** Offre saisie par le client. */
export async function loadPromotionByCode(code: string, ctx: PromotionContext, rules: PromotionRules): Promise<WithId<Promotion>> {
  const snap = await db.collection(COLLECTIONS.promotions).where('code', '==', code).where('status', '==', 'active').limit(5).get();
  const promo = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Promotion) })).find((p) => promotionApplies(p, ctx));
  if (!promo) throw fail.precondition('Ce code promo n’est pas valable pour cette commande.', { code: 'promo_invalid' });
  const usage = await usageIssue(promo, ctx.uid);
  if (usage) throw fail.precondition(usage, { code: 'promo_invalid' });
  const target = targetIssue(promo, ctx, rules);
  if (target) throw fail.precondition(target, { code: 'promo_invalid' });
  return promo;
}

/**
 * Sans code saisi : parmi les offres automatiques (sans code) éligibles, celle qui
 * fait économiser le plus au client. `estimate` renvoie la remise obtenue (0 = inapplicable,
 * par exemple minimum de panier non atteint).
 */
export async function pickAutomaticPromotion(ctx: PromotionContext, rules: PromotionRules, estimate: (p: Promotion) => number): Promise<WithId<Promotion> | null> {
  const snap = await db.collection(COLLECTIONS.promotions).where('status', '==', 'active').limit(300).get();
  const ranked = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Promotion) }))
    .filter((p) => !p.code && promotionApplies(p, ctx) && !targetIssue(p, ctx, rules) && !(p.totalUsageLimit && p.stats.redemptions >= p.totalUsageLimit))
    .map((p) => ({ p, discount: estimate(p) }))
    .filter((x) => x.discount > 0)
    .sort((a, b) => b.discount - a.discount);
  for (const { p } of ranked) {
    if (!(await usageIssue(p, ctx.uid))) return p;
  }
  return null;
}

/**
 * Libère l'utilisation d'une offre quand la commande est annulée : le quota du client et le
 * total de l'offre sont rendus, les compteurs de suivi redescendent. Rejouable sans doublon.
 */
export async function releasePromotion(orderId: string, order: Order): Promise<boolean> {
  if (!order.promotionId) return false;
  const redemptionRef = db.collection(COLLECTIONS.promotionRedemptions).doc(orderId);
  const promotionRef = db.collection(COLLECTIONS.promotions).doc(order.promotionId);
  return db.runTransaction(async (tx) => {
    const redemption = await tx.get(redemptionRef);
    if (!redemption.exists || (redemption.data() as PromotionRedemption).status !== 'applied') return false;
    const r = redemption.data() as PromotionRedemption;
    tx.update(redemptionRef, { status: 'reversed', reversedAt: Timestamp.now(), reversedReason: 'Commande annulée' });
    tx.update(promotionRef, {
      'stats.redemptions': FieldValue.increment(-1),
      'stats.discountCents': FieldValue.increment(-r.discountCents),
      'stats.ordersSubtotalCents': FieldValue.increment(-order.amounts.subtotalCents),
      ...(order.flags?.firstOrder ? { 'stats.newCustomers': FieldValue.increment(-1) } : {}),
    });
    return true;
  });
}
