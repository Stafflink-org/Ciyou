// Custom claims calculés à partir de Firestore, seule source de vérité :
// admins/{uid} (équipe interne) et restaurants/{rid}/members/{uid} (personnel).
import {
  COLLECTIONS,
  MAX_CLAIMED_RESTAURANTS,
  SUBCOLLECTIONS,
  type AdminUser,
  type AuthClaims,
  type RestaurantMember,
  type UserRole,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { auth, db, FieldValue } from './admin';
import { isAuthError } from './errors';

/**
 * Calcule les claims d'un compte. `baseRole` (client ou livreur) s'applique
 * à défaut d'accès interne ou restaurant ; sinon le rôle stocké est conservé.
 */
export async function computeClaims(uid: string, baseRole?: 'client' | 'driver'): Promise<AuthClaims> {
  const [adminSnap, memberSnaps, userSnap, driverSnap] = await Promise.all([
    db.collection(COLLECTIONS.admins).doc(uid).get(),
    db.collectionGroup(SUBCOLLECTIONS.restaurants.members).where('uid', '==', uid).get(),
    db.collection(COLLECTIONS.users).doc(uid).get(),
    db.collection(COLLECTIONS.drivers).doc(uid).get(),
  ]);

  const claims: AuthClaims = {};
  const admin = adminSnap.exists ? (adminSnap.data() as AdminUser) : null;
  if (admin?.active) {
    claims.role = 'admin';
    claims.adminRole = admin.role;
  }

  const memberships = memberSnaps.docs
    .map((d) => d.data() as RestaurantMember)
    .filter((m) => m.active)
    .sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
  if (memberships.length > 0) {
    claims.restaurants = Object.fromEntries(
      memberships.slice(0, MAX_CLAIMED_RESTAURANTS).map((m) => [m.restaurantId, m.role]),
    );
    if (memberships.length > MAX_CLAIMED_RESTAURANTS) claims.restaurantsTruncated = true;
    claims.role ??= 'restaurant';
  }

  if (!claims.role) {
    const stored = userSnap.exists ? (userSnap.get('role') as UserRole | undefined) : undefined;
    claims.role = baseRole ?? (driverSnap.exists || stored === 'driver' ? 'driver' : 'client');
  }
  return claims;
}

function normalize(c: AuthClaims): AuthClaims {
  return {
    role: c.role,
    adminRole: c.adminRole,
    restaurants: c.restaurants,
    restaurantsTruncated: c.restaurantsTruncated,
  };
}

/**
 * Recalcule et pose les claims d'un compte, puis aligne `users/{uid}.role`.
 * Sans effet si le compte Auth n'existe pas (données importées sans compte).
 */
export async function syncClaims(uid: string, baseRole?: 'client' | 'driver'): Promise<AuthClaims | null> {
  let current: Record<string, unknown> | undefined;
  try {
    current = (await auth.getUser(uid)).customClaims;
  } catch (error) {
    if (isAuthError(error, 'user-not-found')) return null;
    throw error;
  }
  const claims = normalize(await computeClaims(uid, baseRole));
  const serialized = JSON.parse(JSON.stringify(claims)) as Record<string, unknown>;
  if (JSON.stringify(serialized) !== JSON.stringify(normalize((current ?? {}) as AuthClaims))) {
    await auth.setCustomUserClaims(uid, serialized);
    logger.info('Claims mis à jour', { uid, role: claims.role });
  }
  const userRef = db.collection(COLLECTIONS.users).doc(uid);
  const user = await userRef.get();
  if (user.exists && user.get('role') !== claims.role) {
    await userRef.update({ role: claims.role, updatedAt: FieldValue.serverTimestamp() });
  }
  return claims;
}
