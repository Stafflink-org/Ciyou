// Outils communs du domaine « carte » : références, accès, noms uniques, traçabilité.
import { COLLECTIONS, SUBCOLLECTIONS, normalizeText, type EntityRef } from '@golink/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DocumentData } from 'firebase-admin/firestore';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { requireRestaurantAccess, type RestaurantActor } from '../lib/permissions';

/**
 * Ressources des fonctions de la carte : fraction de vCPU (profil « 1re génération »),
 * suffisante pour ces écritures courtes et économe du quota de CPU du projet.
 */
export const MENU_RUNTIME = { cpu: 'gcf_gen1', memory: '256MiB' } as const;

export type MenuSub = 'sections' | 'products' | 'options' | 'optionGroups' | 'stockMovements';

export function restaurantRef(restaurantId: string) {
  return db.collection(COLLECTIONS.restaurants).doc(restaurantId);
}

export function menuCollection(restaurantId: string, sub: MenuSub) {
  return restaurantRef(restaurantId).collection(SUBCOLLECTIONS.restaurants[sub]);
}

export interface MenuContext {
  actor: RestaurantActor;
  restaurant: DocumentData;
}

/**
 * Accès à la carte d'un restaurant : membre disposant de `permission`, ou
 * administrateur `restaurants.edit` couvrant la ville. Vérifie l'existence du restaurant.
 */
export async function requireMenuAccess(
  request: CallableRequest<unknown>,
  restaurantId: string,
  permission: 'menu.edit' | 'stock.edit',
): Promise<MenuContext> {
  const actor = await requireRestaurantAccess(request, restaurantId, permission, 'restaurants.edit');
  const snap = await restaurantRef(restaurantId).get();
  if (!snap.exists) throw fail.notFound('Restaurant');
  return { actor, restaurant: snap.data() ?? {} };
}

/** Champs de traçabilité d'une écriture serveur au nom de l'appelant. */
export function trackedUpdate(uid: string) {
  return { updatedAt: FieldValue.serverTimestamp(), updatedBy: uid };
}

export function trackedCreate(uid: string) {
  return {
    createdAt: FieldValue.serverTimestamp(),
    createdBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  };
}

/** Clé de comparaison des noms (sections uniques, rapprochement à l'import). */
export function nameKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}

/**
 * Nom libre dérivé de `base` : « Base (copie) », puis « Base (copie 2) »… en
 * respectant la longueur maximale.
 */
export function uniqueCopyName(base: string, taken: Set<string>, maxLength: number, label = 'copie'): string {
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ` (${label})` : ` (${label} ${index})`;
    const candidate = `${base.slice(0, maxLength - suffix.length).trim()}${suffix}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  throw fail.precondition('Impossible de trouver un nom libre pour la copie.');
}

/** Journal d'audit des opérations de carte (toujours tracées pour l'équipe interne). */
export async function auditMenu(
  request: CallableRequest<unknown>,
  context: MenuContext,
  action: string,
  target: EntityRef,
  details: { reason?: string | null; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } = {},
): Promise<void> {
  await writeAudit({
    actor: actorFromCaller(context.actor.caller, context.actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action,
    target,
    reason: details.reason ?? null,
    before: details.before ?? null,
    after: details.after ?? null,
    countryId: (context.restaurant.countryId as string | undefined) ?? null,
    cityId: (context.restaurant.cityId as string | undefined) ?? null,
    request,
  });
}

/** Découpe une liste en paquets (lots d'écriture Firestore limités à 500 opérations). */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
