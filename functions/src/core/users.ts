// Provisionnement des comptes et attribution des rôles.
import {
  ADMIN_ROLES,
  COLLECTIONS,
  DEFAULT_ADMIN_ROLE_PERMISSIONS,
  type AdminPermission,
  type AdminRole,
  type AdminRoleDefinition,
  type AdminUser,
  type UserRole,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import * as functionsV1 from 'firebase-functions/v1';
import { FIREBASE_REGION } from '@golink/shared';
import { buildUserProfile, ensureUserProfile, splitDisplayName } from '../lib/accounts';
import { auth, db, Timestamp } from '../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { syncClaims } from '../lib/claims';
import { fail } from '../lib/errors';
import { assertCityScopeValid, requireAdmin, resolveCityScope } from '../lib/permissions';
import { hashValue, isBlocked } from '../platform/fraud';
import { z, zId, zReason } from '../lib/validation';

/**
 * Liste de blocage (§28) consultée à l'inscription : un e-mail ou un téléphone
 * bloqué désactive le compte Auth immédiatement et le marque « blocked ». Aucune
 * fonction ne peut empêcher la création du compte Auth lui-même (fait par le
 * SDK client avant ce déclencheur) : le blocage est donc appliqué juste après.
 */
async function applySignupBlocklist(uid: string, email: string | null, phone: string | null): Promise<void> {
  const hit =
    (email && (await isBlocked('email', email))) || (phone && (await isBlocked('phone', phone)));
  if (!hit) return;
  const now = Timestamp.now();
  await Promise.all([
    auth.updateUser(uid, { disabled: true }).catch(() => undefined),
    auth.revokeRefreshTokens(uid).catch(() => undefined),
    db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .set({ status: 'blocked', blockedReason: 'Inscription refusée : liste de blocage Ciyou Eats.', blockedAt: now, blockedBy: 'system', updatedAt: now, updatedBy: 'system' }, { merge: true }),
  ]);
  await writeAudit({
    actor: SYSTEM_ACTOR,
    action: 'user.blocked_at_signup',
    target: { type: 'client', id: uid, label: email ?? phone ?? uid },
    after: { reason: 'blocklist_match' },
    sensitive: true,
  });
  logger.warn('Inscription bloquée (liste de blocage)', { uid });
}

/**
 * Création d'un compte (inscription client, invitation, script) : profil
 * users/{uid}, données privées et claims par défaut. N'écrase jamais un profil
 * ni des claims déjà posés (invitation, données de démonstration).
 */
export const onUserCreate = functionsV1
  .region(FIREBASE_REGION)
  .auth.user()
  .onCreate(async (user) => {
    const fresh = await auth.getUser(user.uid);
    const claimedRole = fresh.customClaims?.role as UserRole | undefined;
    const { firstName, lastName } = splitDisplayName(fresh.displayName);
    const created = await ensureUserProfile(
      user.uid,
      buildUserProfile({
        role: claimedRole ?? 'client',
        firstName,
        lastName,
        email: fresh.email ?? '',
        emailVerified: fresh.emailVerified,
        phone: fresh.phoneNumber ?? null,
      }),
    );
    if (!claimedRole) await syncClaims(user.uid);
    if (fresh.phoneNumber) {
      // Empreinte du téléphone : sert à détecter les comptes multiples liés au même numéro (§28).
      await db
        .collection(COLLECTIONS.userPrivate)
        .doc(user.uid)
        .set({ phoneHash: hashValue(fresh.phoneNumber), updatedAt: Timestamp.now() }, { merge: true })
        .catch(() => undefined);
    }
    await applySignupBlocklist(user.uid, fresh.email ?? null, fresh.phoneNumber ?? null);
    logger.info('Compte provisionné', { uid: user.uid, profileCreated: created });
  });

/** Permissions d'un rôle interne : définition éditable (adminRoles) ou matrice par défaut. */
export async function resolveAdminPermissions(role: AdminRole): Promise<AdminPermission[]> {
  const snap = await db.collection(COLLECTIONS.adminRoles).doc(role).get();
  if (snap.exists) return [...(snap.data() as AdminRoleDefinition).permissions];
  return [...DEFAULT_ADMIN_ROLE_PERMISSIONS[role]];
}

const setUserRoleSchema = z
  .object({
    uid: zId,
    role: z.enum(['client', 'driver', 'admin']),
    adminRole: z.enum(ADMIN_ROLES).optional(),
    cityIds: z.array(zId).max(50).default([]),
    countryIds: z.array(zId).max(10).default([]),
    reason: zReason,
  })
  .refine((d) => d.role !== 'admin' || d.adminRole, { message: 'Précisez le rôle interne', path: ['adminRole'] });

/**
 * Attribue le rôle d'un compte (client, livreur ou équipe interne). L'accès
 * restaurant se donne par invitation (inviteRestaurantMember).
 */
export const setUserRole = callable(setUserRoleSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'admins.manage');
  if (data.uid === caller.uid) throw fail.forbidden('Vous ne pouvez pas modifier votre propre rôle.');
  if (data.adminRole === 'super_admin' && admin.role !== 'super_admin') {
    throw fail.forbidden('Seul un super administrateur peut nommer un super administrateur.');
  }

  const scopedCityIds = data.role === 'admin' && data.adminRole ? await resolveCityScope(data.adminRole, data.cityIds, data.countryIds) : data.cityIds;
  if (data.role === 'admin' && data.adminRole) await assertCityScopeValid(data.adminRole, scopedCityIds);
  const record = await auth.getUser(data.uid).catch(() => null);
  if (!record) throw fail.notFound('Compte');

  const adminRef = db.collection(COLLECTIONS.admins).doc(data.uid);
  const previous = await adminRef.get();
  const before = previous.exists ? (previous.data() as AdminUser) : null;
  if (before?.role === 'super_admin' && admin.role !== 'super_admin') {
    throw fail.forbidden('Seul un super administrateur peut modifier un super administrateur.');
  }
  const now = Timestamp.now();

  if (data.role === 'admin' && data.adminRole) {
    const adminDoc: AdminUser = {
      uid: data.uid,
      email: record.email ?? '',
      displayName: record.displayName ?? record.email ?? data.uid,
      role: data.adminRole,
      permissions: await resolveAdminPermissions(data.adminRole),
      active: true,
      countryIds: data.countryIds,
      cityIds: scopedCityIds,
      refundLimitCents: before?.refundLimitCents ?? null,
      mfaEnrolled: before?.mfaEnrolled ?? false,
      lastLoginAt: before?.lastLoginAt ?? null,
      lastLoginIp: before?.lastLoginIp ?? null,
      createdAt: before?.createdAt ?? now,
      createdBy: before?.createdBy ?? caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    await adminRef.set(adminDoc);
  } else {
    if (before?.active) await adminRef.update({ active: false, updatedAt: now, updatedBy: caller.uid });
    await db
      .collection(COLLECTIONS.users)
      .doc(data.uid)
      .set({ role: data.role, updatedAt: now, updatedBy: caller.uid }, { merge: true });
  }

  const claims = await syncClaims(data.uid, data.role === 'admin' ? undefined : data.role);
  // Déconnexion des sessions ouvertes : le nouveau rôle s'applique à la prochaine connexion.
  await auth.revokeRefreshTokens(data.uid);

  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'user.role_changed',
    target: { type: data.role === 'admin' ? 'admin' : data.role === 'driver' ? 'driver' : 'client', id: data.uid, label: record.email ?? null },
    reason: data.reason,
    before: { role: record.customClaims?.role ?? null, adminRole: before?.active ? before.role : null },
    after: { role: claims?.role ?? data.role, adminRole: data.adminRole ?? null, cityIds: data.cityIds },
    sensitive: true,
    request,
  });
  return { uid: data.uid, role: claims?.role ?? data.role };
});
