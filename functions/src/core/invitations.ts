// Invitations : équipe interne (super admin) et personnel des restaurants.
// Un nouveau compte reçoit un lien de définition du mot de passe ; un compte
// existant reçoit un lien de connexion. L'accès est actif dès l'invitation,
// `joinedAt` est renseigné à la première connexion (acceptInvitation).
import {
  ADMIN_ROLES,
  COLLECTIONS,
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  STAFF_ROLES,
  SUBCOLLECTIONS,
  type AdminUser,
  type Restaurant,
  type RestaurantMember,
  type RestaurantPermission,
  type StaffRoleDefinition,
} from '@golink/shared';
import { buildUserProfile, ensureUserProfile, getOrCreateAuthUser } from '../lib/accounts';
import { auth, db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { sendEmail } from '../lib/brevo';
import { callable } from '../lib/callable';
import { syncClaims } from '../lib/claims';
import { APP_URLS } from '../lib/config';
import { adminInvitationEmail, memberInvitationEmail } from '../lib/emails';
import { fail } from '../lib/errors';
import { assertCityScopeValid, requireAdmin, resolveCityScope, requireAuth, requireRestaurantAccess } from '../lib/permissions';
import { EMAIL_SECRETS } from '../lib/secrets';
import { assertFeatureAllowed, assertWithinLimit } from '../finance/argent/entitlements';
import { z, zEmail, zId, zName, zReason } from '../lib/validation';
import { resolveAdminPermissions } from './users';

/**
 * Lien envoyé par e-mail. Compte existant : page `next` de l'application.
 * Nouveau compte : page « définir le mot de passe » de l'application, avec le
 * code d'action Firebase (`oobCode`) et la page à ouvrir ensuite (`suite`).
 */
async function invitationLink(email: string, newAccount: boolean, appUrl: string, next: string): Promise<string> {
  if (!newAccount) return new URL(next, appUrl).toString();
  const actionLink = await auth.generatePasswordResetLink(email);
  const oobCode = new URL(actionLink).searchParams.get('oobCode');
  if (!oobCode) throw fail.internal();
  const link = new URL('/definir-mot-de-passe', appUrl);
  link.searchParams.set('oobCode', oobCode);
  if (next !== '/') link.searchParams.set('suite', next);
  return link.toString();
}

// ------------------------------------------------------------------ Équipe interne

const inviteAdminSchema = z.object({
  email: zEmail,
  firstName: zName,
  lastName: zName,
  adminRole: z.enum(ADMIN_ROLES),
  cityIds: z.array(zId).max(50).default([]),
  countryIds: z.array(zId).max(10).default([]),
  /** Motif de l'invitation (audit). */
  reason: zReason,
});

export const inviteAdmin = callable(
  inviteAdminSchema,
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'admins.manage');
    if (data.adminRole === 'super_admin' && admin.role !== 'super_admin') {
      throw fail.forbidden('Seul un super administrateur peut inviter un super administrateur.');
    }
    // Un responsable de ville sans ville verrait tout (liste vide = toutes les villes) : refusé.
    const cityIds = await resolveCityScope(data.adminRole, data.cityIds, data.countryIds);
    await assertCityScopeValid(data.adminRole, cityIds);
    const displayName = `${data.firstName} ${data.lastName}`;
    const { user, created } = await getOrCreateAuthUser({ email: data.email, displayName });

    const ref = db.collection(COLLECTIONS.admins).doc(user.uid);
    const existing = await ref.get();
    if (existing.exists && (existing.data() as AdminUser).active) {
      throw fail.alreadyExists('Ce compte fait déjà partie de l’équipe interne.');
    }
    const now = Timestamp.now();
    const adminDoc: AdminUser = {
      uid: user.uid,
      email: data.email,
      displayName,
      role: data.adminRole,
      permissions: await resolveAdminPermissions(data.adminRole),
      active: true,
      countryIds: data.countryIds,
      cityIds,
      refundLimitCents: null,
      mfaEnrolled: false,
      lastLoginAt: null,
      lastLoginIp: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    await ref.set(adminDoc);
    await ensureUserProfile(
      user.uid,
      buildUserProfile({ role: 'admin', firstName: data.firstName, lastName: data.lastName, email: data.email, emailVerified: user.emailVerified }),
    );
    await syncClaims(user.uid);

    const link = await invitationLink(data.email, created, APP_URLS.admin, '/');
    const email = await sendEmail({
      to: { email: data.email, name: displayName },
      message: adminInvitationEmail({ firstName: data.firstName, inviterName: caller.name, role: data.adminRole, link, newAccount: created }),
      recipientType: 'admin',
      recipientId: user.uid,
      templateKey: 'admin_invitation',
    });

    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'admin.invited',
      target: { type: 'admin', id: user.uid, label: data.email },
      after: { role: data.adminRole, cityIds, countryIds: data.countryIds },
      reason: data.reason,
      sensitive: true,
      request,
    });
    return { uid: user.uid, newAccount: created, emailSent: email.ok };
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Personnel restaurant

const inviteMemberSchema = z.object({
  restaurantId: zId,
  email: zEmail,
  firstName: zName,
  lastName: zName,
  role: z.enum(STAFF_ROLES).exclude(['owner']),
  customRoleId: zId.optional(),
  employeeId: zId.optional(),
});

async function resolveStaffPermissions(
  restaurantId: string,
  role: RestaurantMember['role'],
  customRoleId: string | undefined,
): Promise<RestaurantPermission[]> {
  if (role !== 'custom') return [...DEFAULT_STAFF_ROLE_PERMISSIONS[role]];
  if (!customRoleId) throw fail.invalid('Choisissez le rôle personnalisé à attribuer.');
  const snap = await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.staffRoles)
    .doc(customRoleId)
    .get();
  if (!snap.exists) throw fail.notFound('Rôle personnalisé');
  return [...(snap.data() as StaffRoleDefinition).permissions];
}

export const inviteRestaurantMember = callable(
  inviteMemberSchema,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'team.manage', 'restaurants.edit');
    const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get();
    if (!restaurantSnap.exists) throw fail.notFound('Restaurant');
    const restaurant = restaurantSnap.data() as Restaurant;
    // Formule : nombre de comptes équipe limité, gestion d'équipe incluse.
    await assertFeatureAllowed(data.restaurantId, 'team');
    const activeMembers = await restaurantSnap.ref.collection(SUBCOLLECTIONS.restaurants.members).where('active', '==', true).count().get();
    await assertWithinLimit(data.restaurantId, 'maxStaff', activeMembers.data().count, 'comptes d’équipe');
    // Un manager ne peut pas créer un accès plus large que le sien.
    if (actor.kind === 'member' && actor.member.role !== 'owner' && data.role === 'manager' && actor.member.role !== 'manager') {
      throw fail.forbidden('Seuls le propriétaire et les managers peuvent inviter un manager.');
    }

    const permissions = await resolveStaffPermissions(data.restaurantId, data.role, data.customRoleId);
    const displayName = `${data.firstName} ${data.lastName}`;
    const { user, created } = await getOrCreateAuthUser({ email: data.email, displayName });

    const memberRef = restaurantSnap.ref.collection(SUBCOLLECTIONS.restaurants.members).doc(user.uid);
    const existing = await memberRef.get();
    if (existing.exists && (existing.data() as RestaurantMember).active) {
      throw fail.alreadyExists('Cette personne a déjà accès à cet établissement.');
    }
    const now = Timestamp.now();
    const member: RestaurantMember = {
      uid: user.uid,
      restaurantId: data.restaurantId,
      groupId: restaurant.groupId ?? null,
      displayName,
      email: data.email,
      role: data.role,
      customRoleId: data.role === 'custom' ? (data.customRoleId ?? null) : null,
      permissions,
      active: true,
      onDuty: false,
      employeeId: data.employeeId ?? null,
      invitedBy: actor.caller.uid,
      invitedAt: now,
      joinedAt: null,
      lastAccessAt: null,
    };
    await memberRef.set(member);
    if (data.employeeId) {
      await restaurantSnap.ref
        .collection(SUBCOLLECTIONS.restaurants.employees)
        .doc(data.employeeId)
        .set({ uid: user.uid, updatedAt: now, updatedBy: actor.caller.uid }, { merge: true });
    }
    await ensureUserProfile(
      user.uid,
      buildUserProfile({
        role: 'restaurant',
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        emailVerified: user.emailVerified,
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
      }),
    );
    await syncClaims(user.uid);

    const next = `/invitation?restaurant=${encodeURIComponent(data.restaurantId)}`;
    const link = await invitationLink(data.email, created, APP_URLS.restaurant, next);
    const email = await sendEmail({
      to: { email: data.email, name: displayName },
      message: memberInvitationEmail({
        firstName: data.firstName,
        restaurantName: restaurant.name,
        inviterName: actor.caller.name,
        role: data.role,
        link,
        newAccount: created,
      }),
      recipientType: 'restaurant',
      recipientId: user.uid,
      templateKey: 'restaurant_member_invitation',
    });

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'restaurant.member_invited',
      target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
      after: { uid: user.uid, email: data.email, role: data.role },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
    return { uid: user.uid, newAccount: created, emailSent: email.ok };
  },
  { secrets: EMAIL_SECRETS },
);

export const acceptInvitation = callable(z.object({ restaurantId: zId }), async (data, request) => {
  const caller = requireAuth(request);
  const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(data.restaurantId);
  const memberRef = restaurantRef.collection(SUBCOLLECTIONS.restaurants.members).doc(caller.uid);
  const [restaurantSnap, memberSnap] = await Promise.all([restaurantRef.get(), memberRef.get()]);
  if (!restaurantSnap.exists || !memberSnap.exists) throw fail.notFound('Invitation');
  const member = memberSnap.data() as RestaurantMember;
  if (!member.active) throw fail.forbidden('Cet accès a été désactivé par l’établissement.');

  const now = Timestamp.now();
  const firstAccess = !member.joinedAt;
  await memberRef.update({ joinedAt: member.joinedAt ?? now, lastAccessAt: now });
  // Le lien reçu par e-mail prouve la détention de l'adresse.
  if (firstAccess) await auth.updateUser(caller.uid, { emailVerified: true });
  const claims = await syncClaims(caller.uid);

  const restaurant = restaurantSnap.data() as Restaurant;
  if (firstAccess) {
    await writeAudit({
      actor: actorFromCaller(caller, 'restaurant'),
      action: 'restaurant.member_joined',
      target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
      after: { uid: caller.uid, role: member.role },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
  }
  return {
    restaurantId: data.restaurantId,
    restaurantName: restaurant.name,
    role: member.role,
    firstAccess,
    // L'application rafraîchit le jeton si les claims ont changé.
    claimsUpdated: claims?.restaurants?.[data.restaurantId] !== caller.claims.restaurants?.[data.restaurantId],
  };
});
