// Corrections de carte faites par l'équipe interne (anomalies signalées automatiquement) :
// clôture d'une anomalie et correction d'un produit. Écritures réservées à ces fonctions
// (les règles Firestore n'autorisent plus l'équipe à écrire dans la carte) : motif
// obligatoire, journal d'audit avec l'état avant et après.
import { ALLERGENS, COLLECTIONS, SUBCOLLECTIONS, findAlcoholTerm, type MenuIssue, type Product } from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { acteursCallable, auditRestaurant, loadRestaurantFor } from './common';

export const resolveMenuIssue = acteursCallable(
  z.object({ issueId: z.string().trim().min(1).max(200), status: z.enum(['fixed', 'ignored']), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.edit');
    const ref = db.collection(COLLECTIONS.menuIssues).doc(data.issueId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Anomalie');
    const issue = snap.data() as MenuIssue;
    if (issue.status !== 'open') throw fail.precondition('Cette anomalie est déjà traitée.');
    const restaurant = await loadRestaurantFor(admin, issue.restaurantId);
    await ref.update({ status: data.status, resolvedAt: Timestamp.now(), resolvedBy: caller.uid, resolutionNote: data.reason });
    await auditRestaurant(caller, restaurant, 'menu_issue.resolved', {
      reason: data.reason,
      before: { status: 'open', type: issue.type, productId: issue.productId ?? null },
      after: { status: data.status },
      request,
    });
    return { status: data.status };
  },
);

export const fixRestaurantProduct = acteursCallable(
  z.object({
    restaurantId: zId,
    productId: zId,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).nullable(),
    allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length),
    available: z.boolean(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.edit');
    const restaurant = await loadRestaurantFor(admin, data.restaurantId);
    const ref = restaurant.ref.collection(SUBCOLLECTIONS.restaurants.products).doc(data.productId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Produit');
    const before = snap.data() as Product;
    // La vente d'alcool est interdite par décision de la direction.
    const alcohol = findAlcoholTerm(data.name, data.description);
    if (alcohol && data.available) throw fail.invalid(`Mention « ${alcohol} » détectée : la vente d’alcool est interdite. Retirez la mention ou rendez le produit indisponible.`);
    const allergens = [...new Set(data.allergens)];
    await ref.update({
      name: data.name,
      description: data.description,
      allergens,
      allergensDeclared: true,
      available: data.available,
      updatedAt: Timestamp.now(),
      updatedBy: caller.uid,
    });
    await auditRestaurant(caller, restaurant, 'product.fixed_by_admin', {
      reason: data.reason,
      before: { name: before.name, description: before.description ?? null, allergens: before.allergens ?? [], available: before.available },
      after: { name: data.name, description: data.description, allergens, available: data.available },
      request,
    });
    return { productId: data.productId };
  },
);
