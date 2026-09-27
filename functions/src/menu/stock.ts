// Ajustements de stock : réception, perte, inventaire, correction, activation du suivi.
// Transaction unique : lecture des produits, nouveau stock, mouvement historisé.
import { MANUAL_STOCK_REASONS, type Product, type StockMovement } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { assertFeatureOn } from '../lib/features';
import { z, zId } from '../lib/validation';
import { menuCollection, requireMenuAccess, trackedUpdate, MENU_RUNTIME } from './common';

const MAX_STOCK = 99_999;

const adjustment = z.object({
  productId: zId,
  /** add / remove : variation ; set : valeur comptée ; track / untrack : suivi du stock. */
  mode: z.enum(['add', 'remove', 'set', 'track', 'untrack']),
  quantity: z.number().int().min(0).max(MAX_STOCK).nullish(),
  lowStockThreshold: z.number().int().min(0).max(9_999).nullish(),
});

const schema = z.object({
  restaurantId: zId,
  reason: z.enum(MANUAL_STOCK_REASONS),
  note: z.string().trim().max(240).nullish(),
  items: z.array(adjustment).min(1).max(200),
});

export interface AdjustStockResult {
  results: Array<{ productId: string; stock: number | null; delta: number }>;
  movements: number;
}

export const adjustStock = callable(schema, async (data, request): Promise<AdjustStockResult> => {
  const context = await requireMenuAccess(request, data.restaurantId, 'stock.edit');
  await assertFeatureOn('stock_management', { restaurantId: data.restaurantId }, 'La gestion de stock est désactivée par Ciyou Eats.');
  const uid = context.actor.caller.uid;
  const ids = [...new Set(data.items.map((item) => item.productId))];
  if (ids.length !== data.items.length) throw fail.invalid('Un même produit apparaît plusieurs fois dans l’ajustement.');

  const products = menuCollection(data.restaurantId, 'products');
  const movements = menuCollection(data.restaurantId, 'stockMovements');

  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...ids.map((id) => products.doc(id)));
    const results: AdjustStockResult['results'] = [];
    let movementCount = 0;

    snaps.forEach((snap, index) => {
      const item = data.items[index]!;
      if (!snap.exists) throw fail.notFound('Produit');
      const product = snap.data() as Product;
      const current = product.stock;
      let next: number | null = current;

      switch (item.mode) {
        case 'untrack':
          next = null;
          break;
        case 'track':
          next = current ?? item.quantity ?? 0;
          break;
        case 'set':
          if (item.quantity == null) throw fail.invalid(`Indiquez la quantité comptée pour « ${product.name} ».`);
          next = item.quantity;
          break;
        case 'add':
        case 'remove': {
          if (current === null) throw fail.precondition(`Le stock de « ${product.name} » n’est pas suivi : activez d’abord le suivi.`);
          const quantity = item.quantity ?? 0;
          if (quantity === 0) throw fail.invalid(`Indiquez une quantité pour « ${product.name} ».`);
          next = item.mode === 'add' ? current + quantity : current - quantity;
          if (next < 0) throw fail.precondition(`Stock insuffisant pour « ${product.name} » : ${current} en stock.`);
          if (next > MAX_STOCK) throw fail.invalid(`Le stock de « ${product.name} » ne peut pas dépasser ${MAX_STOCK}.`);
          break;
        }
      }

      const patch: Record<string, unknown> = { stock: next, ...trackedUpdate(uid) };
      if (item.lowStockThreshold != null) patch.lowStockThreshold = item.lowStockThreshold;
      tx.update(snap.ref, patch);

      const delta = (next ?? 0) - (current ?? 0);
      // Un mouvement n'est historisé que pour une variation réelle d'un stock suivi.
      if (next !== null && (delta !== 0 || item.mode === 'set' || (item.mode === 'track' && current === null))) {
        const movement: Omit<StockMovement, 'createdAt'> & { createdAt: FieldValue } = {
          productId: snap.id,
          productName: product.name,
          delta,
          stockAfter: next,
          reason: item.mode === 'track' && current === null ? 'inventory' : data.reason,
          orderId: null,
          note: data.note || null,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: uid,
        };
        tx.set(movements.doc(), movement);
        movementCount += 1;
      }
      results.push({ productId: snap.id, stock: next, delta });
    });

    return { results, movements: movementCount };
  });
}, MENU_RUNTIME);
