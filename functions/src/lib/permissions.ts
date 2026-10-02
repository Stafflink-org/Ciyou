// Contrôles d'accès des fonctions appelables. Le rôle vient des custom claims ;
// les permissions fines sont relues dans Firestore (comme les règles de sécurité),
// pour qu'un retrait de droit prenne effet immédiatement.
import {
  CITY_SCOPED_ROLES,
  COLLECTIONS,
  SUBCOLLECTIONS,
  adminHasPermission,
  memberHasPermission,
  type AdminPermission,
  type AdminUser,
  type AuthClaims,
  type RestaurantMember,
  type RestaurantPermission,
} from '@golink/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db } from './admin';
import { fail } from './errors';
import { assertAdminMfa } from './mfa';

export interface Caller {
  uid: string;
  email: string | null;
  name: string;
  claims: AuthClaims;
}

export function getCaller(request: CallableRequest<unknown>): Caller | null {
  if (!request.auth) return null;
  const token = request.auth.token;
  const email = typeof token.email === 'string' ? token.email : null;
  const name = typeof token.name === 'string' && token.name ? token.name : (email ?? request.auth.uid);
  const claims: AuthClaims = {
    role: token.role as AuthClaims['role'],
    adminRole: token.adminRole as AuthClaims['adminRole'],
    restaurants: token.restaurants as AuthClaims['restaurants'],
    restaurantsTruncated: token.restaurantsTruncated === true,
  };
  return { uid: request.auth.uid, email, name, claims };
}

export function requireAuth(request: CallableRequest<unknown>): Caller {
  const caller = getCaller(request);
  if (!caller) throw fail.unauthenticated();
  return caller;
}

export async function loadAdmin(uid: string): Promise<AdminUser | null> {
  const snap = await db.collection(COLLECTIONS.admins).doc(uid).get();
  return snap.exists ? (snap.data() as AdminUser) : null;
}

/**
 * Membre actif de l'équipe interne, avec la permission demandée le cas échéant.
 * La double authentification de la session est contrôlée ici, pour toutes les fonctions
 * d'administration ; seules les fonctions d'enrôlement et de suivi de session la sautent
 * (`skipMfa`), puisqu'elles servent justement à la valider.
 */
export async function requireAdmin(
  request: CallableRequest<unknown>,
  permission?: AdminPermission,
  options: { skipMfa?: boolean } = {},
): Promise<{ caller: Caller; admin: AdminUser; sessionId: string | null }> {
  const caller = requireAuth(request);
  if (caller.claims.role !== 'admin') throw fail.forbidden();
  const admin = await loadAdmin(caller.uid);
  if (!admin?.active) throw fail.forbidden('Votre accès administrateur est désactivé.');
  if (permission && !adminHasPermission(admin, permission)) throw fail.forbidden();
  const sessionId = options.skipMfa ? null : await assertAdminMfa(request, caller.uid, admin);
  return { caller, admin, sessionId };
}

/**
 * Un rôle limité par ville (responsable de ville) doit avoir au moins une ville existante :
 * une liste vide signifie « toutes les villes » et donnerait un accès total.
 */
export async function assertCityScopeValid(role: string, cityIds: readonly string[]): Promise<void> {
  if (!(CITY_SCOPED_ROLES as readonly string[]).includes(role)) return;
  if (cityIds.length === 0) throw fail.invalid('Un responsable de ville doit avoir au moins une ville dans son périmètre.');
  const cities = await Promise.all(cityIds.map((id) => db.collection(COLLECTIONS.cities).doc(id).get()));
  const unknown = cityIds.filter((_, i) => !cities[i]?.exists);
  if (unknown.length) throw fail.invalid(`Ville inconnue : ${unknown.join(', ')}.`);
}

/**
 * Périmètre par pays : un administrateur limité à des pays (sans ville précisée) est ramené aux villes
 * de ces pays, ce qui fait appliquer partout le contrôle par ville (fonctions et règles). Les villes
 * créées plus tard dans ces pays sont ajoutées par `saveCity`.
 */
export async function resolveCityScope(role: string, cityIds: readonly string[], countryIds: readonly string[]): Promise<string[]> {
  if (role === 'super_admin' || cityIds.length > 0 || countryIds.length === 0) return [...cityIds];
  const cities = await Promise.all(countryIds.map((countryId) => db.collection(COLLECTIONS.cities).where('countryId', '==', countryId).get()));
  const ids = [...new Set(cities.flatMap((snap) => snap.docs.map((d) => d.id)))];
  if (ids.length === 0) throw fail.invalid('Aucune ville dans les pays choisis : ajoutez d’abord une ville ou retirez le périmètre pays.');
  return ids.slice(0, 200);
}

/** Vérifie que la ville est dans le périmètre de l'administrateur (liste vide = toutes). */
export function assertAdminCovers(admin: AdminUser, cityId: string | null | undefined): void {
  if (admin.role === 'super_admin' || admin.cityIds.length === 0) return;
  if (!cityId || !admin.cityIds.includes(cityId)) {
    throw fail.forbidden('Cette ville est hors de votre périmètre.');
  }
}

/** Variante par pays (ressources scopées par pays, pas de ville) : voir assertAdminCovers. */
export function assertAdminCoversCountry(admin: AdminUser, countryId: string | null | undefined): void {
  if (admin.role === 'super_admin' || admin.countryIds.length === 0) return;
  if (!countryId || !admin.countryIds.includes(countryId)) {
    throw fail.forbidden('Ce pays est hors de votre périmètre.');
  }
}

export async function loadMember(restaurantId: string, uid: string): Promise<RestaurantMember | null> {
  const snap = await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.members)
    .doc(uid)
    .get();
  return snap.exists ? (snap.data() as RestaurantMember) : null;
}

export type RestaurantActor =
  | { kind: 'member'; caller: Caller; member: RestaurantMember }
  | { kind: 'admin'; caller: Caller; admin: AdminUser };

/**
 * Accès à un restaurant : membre actif disposant de `permission`, ou, si
 * `adminPermission` est fourni, administrateur disposant de celle-ci et
 * couvrant la ville du restaurant.
 */
export async function requireRestaurantAccess(
  request: CallableRequest<unknown>,
  restaurantId: string,
  permission: RestaurantPermission,
  adminPermission?: AdminPermission,
): Promise<RestaurantActor> {
  const caller = requireAuth(request);
  const member = await loadMember(restaurantId, caller.uid);
  if (member && memberHasPermission(member, permission)) return { kind: 'member', caller, member };
  if (adminPermission && caller.claims.role === 'admin') {
    const admin = await loadAdmin(caller.uid);
    if (admin?.active && adminHasPermission(admin, adminPermission)) {
      await assertAdminMfa(request, caller.uid, admin);
      const restaurant = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
      if (!restaurant.exists) throw fail.notFound('Restaurant');
      assertAdminCovers(admin, restaurant.get('cityId') as string | undefined);
      return { kind: 'admin', caller, admin };
    }
  }
  throw fail.forbidden();
}
