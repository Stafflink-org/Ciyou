// Offres automatiques sur un plat (« 1 acheté, 1 offert », « Le 2e à -50 % ») : financées par le
// commerce, distinctes des campagnes de communication (functions/src/marketing/restaurant/campaigns.ts)
// et des codes promo (functions/src/marketing/restaurant/promotions.ts). Aucune limite de nombre.
import {
  checkProductAlcohol,
  COLLECTIONS,
  PRODUCT_OFFER_KINDS,
  PRODUCT_OFFER_RULES,
  SUBCOLLECTIONS,
  type Product,
  type ProductOffer,
} from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireRestaurantAccess, type RestaurantActor } from '../../lib/permissions';
import { z, zId } from '../../lib/validation';
import { moveToTrash } from '../../platform/backups';
import { loadRestaurant, type RestaurantDoc } from './helpers';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ).');
const DAY_MS = 86_400_000;

function offersRef(restaurantId: string) {
  return db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.productOffers);
}

function auditBase(actor: RestaurantActor, restaurant: RestaurantDoc) {
  return {
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
  };
}

/** Le plat choisi est vendable : disponible, en stock (ou stock non suivi), jamais alcoolisé (§G2). */
async function assertProductEligible(restaurantId: string, productId: string): Promise<Product> {
  const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.products).doc(productId).get();
  if (!snap.exists) throw fail.notFound('Plat');
  const product = snap.data() as Product;
  if (!product.available) throw fail.precondition(`« ${product.name} » n’est pas disponible : rendez-le disponible avant de créer une offre.`);
  if (product.stock !== null && product.stock !== undefined && product.stock <= 0) {
    throw fail.precondition(`« ${product.name} » est en rupture de stock.`);
  }
  const alcohol = checkProductAlcohol(product);
  if (alcohol.blocked) throw fail.precondition(`« ${product.name} » ne peut pas faire l’objet d’une offre : vente d’alcool interdite sur Ciyou Eats.`);
  return product;
}

const fieldsSchema = z.object({
  kind: z.enum(PRODUCT_OFFER_KINDS),
  productId: zId,
  title: z.string().trim().min(PRODUCT_OFFER_RULES.titleMin, `Le titre doit contenir au moins ${PRODUCT_OFFER_RULES.titleMin} caractères.`).max(PRODUCT_OFFER_RULES.titleMax),
  message: z.string().trim().min(PRODUCT_OFFER_RULES.messageMin, `Le message doit contenir au moins ${PRODUCT_OFFER_RULES.messageMin} caractères.`).max(PRODUCT_OFFER_RULES.messageMax),
  startDay: day,
  endDay: day.nullable(),
});

function validateDates(f: z.output<typeof fieldsSchema>) {
  if (f.endDay !== null) {
    if (f.endDay < f.startDay) throw fail.invalid('La date de fin doit être postérieure à la date de début.');
    const startMs = Date.parse(f.startDay);
    const endMs = Date.parse(f.endDay);
    if (endMs - startMs > PRODUCT_OFFER_RULES.maxDurationDays * DAY_MS) throw fail.invalid('Une offre ne peut pas durer plus d’un an.');
  }
}

/** Création ou modification d'une offre (une offre désactivée par Ciyou Eats ne peut plus être modifiée). */
export const saveProductOffer = callable(
  z.discriminatedUnion('mode', [
    fieldsSchema.extend({ mode: z.literal('create'), restaurantId: zId }),
    fieldsSchema.extend({ mode: z.literal('edit'), restaurantId: zId, offerId: zId }),
  ]),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage');
    const restaurant = await loadRestaurant(data.restaurantId);
    validateDates(data);
    const product = await assertProductEligible(data.restaurantId, data.productId);
    const now = Timestamp.now();

    if (data.mode === 'create') {
      const ref = offersRef(data.restaurantId).doc();
      const offer: ProductOffer = {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        kind: data.kind,
        productId: data.productId,
        productName: product.name,
        title: data.title,
        message: data.message,
        startDay: data.startDay,
        endDay: data.endDay,
        active: true,
        disabledByPlatform: null,
        ordersCount: 0,
        discountTotalCents: 0,
        createdAt: now,
        createdBy: actor.caller.uid,
        updatedAt: now,
        updatedBy: actor.caller.uid,
      };
      await ref.set(offer);
      await writeAudit({
        ...auditBase(actor, restaurant),
        action: 'product_offer.created',
        target: { type: 'productOffer', id: ref.id, label: data.title },
        after: { kind: data.kind, productId: data.productId, startDay: data.startDay, endDay: data.endDay },
        request,
      });
      return { offerId: ref.id };
    }

    const ref = offersRef(data.restaurantId).doc(data.offerId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Offre');
    const current = snap.data() as ProductOffer;
    if (current.disabledByPlatform) throw fail.precondition('Cette offre a été désactivée par Ciyou Eats : elle ne peut plus être modifiée.');
    const patch = {
      kind: data.kind,
      productId: data.productId,
      productName: product.name,
      title: data.title,
      message: data.message,
      startDay: data.startDay,
      endDay: data.endDay,
      updatedAt: now,
      updatedBy: actor.caller.uid,
    };
    await ref.update(patch);
    await writeAudit({
      ...auditBase(actor, restaurant),
      action: 'product_offer.updated',
      target: { type: 'productOffer', id: ref.id, label: data.title },
      before: { kind: current.kind, productId: current.productId, startDay: current.startDay, endDay: current.endDay },
      after: { kind: data.kind, productId: data.productId, startDay: data.startDay, endDay: data.endDay },
      request,
    });
    return { offerId: ref.id };
  },
);

/** Mise en pause / relance par le commerce (une offre désactivée par Ciyou Eats reste éteinte). */
export const toggleProductOffer = callable(
  z.object({ restaurantId: zId, offerId: zId, active: z.boolean() }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage');
    const restaurant = await loadRestaurant(data.restaurantId);
    const ref = offersRef(data.restaurantId).doc(data.offerId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Offre');
    const current = snap.data() as ProductOffer;
    if (current.disabledByPlatform) throw fail.precondition('Cette offre a été désactivée par Ciyou Eats : elle ne peut pas être relancée.');
    const now = Timestamp.now();
    await ref.update({ active: data.active, updatedAt: now, updatedBy: actor.caller.uid });
    await writeAudit({
      ...auditBase(actor, restaurant),
      action: data.active ? 'product_offer.resumed' : 'product_offer.paused',
      target: { type: 'productOffer', id: ref.id, label: current.title },
      before: { active: current.active },
      after: { active: data.active },
      request,
    });
    return { offerId: ref.id, active: data.active };
  },
);

/** Suppression (corbeille générique §31, restaurable pendant le délai réglé). */
export const deleteProductOffer = callable(
  z.object({ restaurantId: zId, offerId: zId }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage');
    const restaurant = await loadRestaurant(data.restaurantId);
    const ref = offersRef(data.restaurantId).doc(data.offerId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Offre');
    const current = snap.data() as ProductOffer;
    await moveToTrash({
      entity: { type: 'productOffer', id: ref.id, label: current.title },
      path: ref.path,
      snapshot: current as unknown as Record<string, unknown>,
      restaurantId: restaurant.id,
      deletedBy: actor.caller.uid,
      reason: 'Suppression par le commerce',
    });
    await ref.delete();
    await writeAudit({
      ...auditBase(actor, restaurant),
      action: 'product_offer.deleted',
      target: { type: 'productOffer', id: ref.id, label: current.title },
      before: { kind: current.kind, productId: current.productId },
      request,
    });
    return { offerId: ref.id, status: 'deleted' as const };
  },
);
