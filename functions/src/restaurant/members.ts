// Accès au back-office d'un établissement : rôle et permissions d'un membre,
// retrait d'accès, rôles personnalisés. Un membre ne peut jamais accorder une
// permission qu'il n'a pas, ni modifier le propriétaire ou son propre accès.
import {
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  RESTAURANT_PERMISSIONS,
  STAFF_ROLES,
  SUBCOLLECTIONS,
  memberHasPermission,
  type RestaurantMember,
  type RestaurantPermission,
  type StaffRoleDefinition,
} from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { syncClaims } from '../lib/claims';
import { fail } from '../lib/errors';
import { requireRestaurantAccess, type RestaurantActor } from '../lib/permissions';
import { z, zId, zReason } from '../lib/validation';
import { loadRestaurant, restaurantRef, CONFIG_FUNCTION_OPTIONS } from './config-context';

const zPermission = z.enum(RESTAURANT_PERMISSIONS);

function membersCol(restaurantId: string) {
  return restaurantRef(restaurantId).collection(SUBCOLLECTIONS.restaurants.members);
}

function rolesCol(restaurantId: string) {
  return restaurantRef(restaurantId).collection(SUBCOLLECTIONS.restaurants.staffRoles);
}

/** Vérifie qu'un membre non propriétaire n'accorde que des permissions qu'il détient. */
function assertCanGrant(actor: RestaurantActor, permissions: readonly RestaurantPermission[]): void {
  if (actor.kind !== 'member' || actor.member.role === 'owner') return;
  const missing = permissions.filter((p) => !memberHasPermission(actor.member, p));
  if (missing.length > 0) {
    throw fail.forbidden('Vous ne pouvez pas accorder des droits que vous ne possédez pas vous-même.');
  }
}

function assertCanManage(actor: RestaurantActor, target: RestaurantMember): void {
  if (target.role === 'owner') throw fail.forbidden('L’accès du propriétaire ne peut pas être modifié.');
  if (actor.kind !== 'member') return;
  if (actor.caller.uid === target.uid) throw fail.forbidden('Vous ne pouvez pas modifier votre propre accès.');
  if (target.role === 'manager' && actor.member.role !== 'owner') {
    throw fail.forbidden('Seul le propriétaire peut modifier l’accès d’un manager.');
  }
}

function actorType(actor: RestaurantActor) {
  return actor.kind === 'admin' ? ('admin' as const) : ('restaurant' as const);
}

// ------------------------------------------------------------------ Rôle et permissions

const setPermissionsSchema = z.object({
  restaurantId: zId,
  uid: zId,
  role: z.enum(STAFF_ROLES).exclude(['owner']),
  customRoleId: zId.nullish(),
  /** Rôle « personnalisé » sans modèle : liste explicite des permissions. */
  permissions: z.array(zPermission).max(RESTAURANT_PERMISSIONS.length).nullish(),
  /** Rétablit un accès retiré. */
  reactivate: z.boolean().optional(),
});

export const setMemberPermissions = callable(setPermissionsSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'team.manage', 'restaurants.edit');
  const restaurant = await loadRestaurant(data.restaurantId);
  const ref = membersCol(data.restaurantId).doc(data.uid);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Membre');
  const target = snap.data() as RestaurantMember;
  assertCanManage(actor, target);
  if (data.role === 'manager' && actor.kind === 'member' && !['owner', 'manager'].includes(actor.member.role)) {
    throw fail.forbidden('Seuls le propriétaire et les managers peuvent nommer un manager.');
  }

  let permissions: RestaurantPermission[];
  let customRoleId: string | null = null;
  if (data.role === 'custom') {
    if (data.customRoleId) {
      const roleSnap = await rolesCol(data.restaurantId).doc(data.customRoleId).get();
      if (!roleSnap.exists) throw fail.notFound('Rôle personnalisé');
      permissions = [...(roleSnap.data() as StaffRoleDefinition).permissions];
      customRoleId = data.customRoleId;
    } else if (data.permissions && data.permissions.length > 0) {
      permissions = [...new Set(data.permissions)];
    } else {
      throw fail.invalid('Choisissez un rôle personnalisé ou au moins une permission.');
    }
  } else {
    permissions = [...DEFAULT_STAFF_ROLE_PERMISSIONS[data.role]];
  }
  assertCanGrant(actor, permissions);

  const now = Timestamp.now();
  const reactivating = !target.active;
  if (reactivating && !data.reactivate) throw fail.precondition('Cet accès a été retiré : rétablissez-le d’abord.');
  await ref.update({
    role: data.role,
    customRoleId,
    permissions,
    active: true,
    ...(reactivating ? { revokedAt: null, revokedBy: null, revokeReason: null } : {}),
    permissionsUpdatedAt: now,
    permissionsUpdatedBy: actor.caller.uid,
  });
  if (reactivating) await syncClaims(data.uid);

  await writeAudit({
    actor: actorFromCaller(actor.caller, actorType(actor)),
    action: reactivating ? 'restaurant.member_reactivated' : 'restaurant.member_permissions_updated',
    target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
    before: { uid: data.uid, role: target.role, customRoleId: target.customRoleId ?? null, permissions: target.permissions, active: target.active },
    after: { uid: data.uid, role: data.role, customRoleId, permissions, active: true },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    sensitive: true,
    request,
  });
  return { role: data.role, permissions };
},
  CONFIG_FUNCTION_OPTIONS,
);

// ------------------------------------------------------------------ Retrait d'accès

export const revokeMember = callable(
  z.object({ restaurantId: zId, uid: zId, reason: zReason }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'team.manage', 'restaurants.edit');
    const restaurant = await loadRestaurant(data.restaurantId);
    const ref = membersCol(data.restaurantId).doc(data.uid);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Membre');
    const target = snap.data() as RestaurantMember;
    assertCanManage(actor, target);
    if (!target.active) throw fail.precondition('Cet accès est déjà retiré.');

    const now = Timestamp.now();
    await ref.update({ active: false, onDuty: false, revokedAt: now, revokedBy: actor.caller.uid, revokeReason: data.reason });
    // Les claims sont aussi recalculés par onMemberWrite ; l'appel direct rend le retrait immédiat.
    await syncClaims(data.uid);

    await writeAudit({
      actor: actorFromCaller(actor.caller, actorType(actor)),
      action: 'restaurant.member_revoked',
      target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
      reason: data.reason,
      before: { uid: data.uid, email: target.email, role: target.role, active: true },
      after: { uid: data.uid, active: false },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      sensitive: true,
      request,
    });
    return { revoked: true };
  },
  CONFIG_FUNCTION_OPTIONS,
);

// ------------------------------------------------------------------ Rôles personnalisés

const roleSchema = z.object({
  restaurantId: zId,
  roleId: zId.optional(),
  name: z.string().trim().min(2, 'Nom trop court').max(40),
  description: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
  permissions: z.array(zPermission).min(1, 'Choisissez au moins une permission').max(RESTAURANT_PERMISSIONS.length),
});

/** Crée ou modifie un rôle personnalisé et répercute ses permissions sur les membres qui l'ont. */
export const saveStaffRole = callable(roleSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'team.manage', 'restaurants.edit');
  const permissions = [...new Set(data.permissions)];
  assertCanGrant(actor, permissions);
  const restaurant = await loadRestaurant(data.restaurantId);
  const col = rolesCol(data.restaurantId);
  const now = Timestamp.now();
  const uid = actor.caller.uid;

  const duplicate = await col.where('name', '==', data.name).limit(2).get();
  if (duplicate.docs.some((d) => d.id !== data.roleId)) throw fail.alreadyExists('Un rôle porte déjà ce nom.');

  let roleId = data.roleId;
  let before: StaffRoleDefinition | null = null;
  let affected = 0;
  if (roleId) {
    const ref = col.doc(roleId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Rôle');
    before = snap.data() as StaffRoleDefinition;
    if (before.system) throw fail.forbidden('Les rôles fournis par GoLink ne sont pas modifiables.');
    const members = await membersCol(data.restaurantId).where('customRoleId', '==', roleId).get();
    const batch = db.batch();
    batch.update(ref, { name: data.name, description: data.description, permissions, updatedAt: now, updatedBy: uid });
    for (const member of members.docs) {
      batch.update(member.ref, { permissions, permissionsUpdatedAt: now, permissionsUpdatedBy: uid });
    }
    await batch.commit();
    affected = members.size;
  } else {
    const count = await col.count().get();
    if (count.data().count >= 20) throw fail.precondition('20 rôles personnalisés au maximum.');
    const ref = col.doc();
    roleId = ref.id;
    const role: StaffRoleDefinition = {
      name: data.name,
      description: data.description,
      permissions,
      system: false,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    } as StaffRoleDefinition;
    await ref.set(role);
  }

  await writeAudit({
    actor: actorFromCaller(actor.caller, actorType(actor)),
    action: before ? 'restaurant.staff_role_updated' : 'restaurant.staff_role_created',
    target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
    before: before ? { roleId, name: before.name, permissions: before.permissions } : null,
    after: { roleId, name: data.name, permissions, membersUpdated: affected },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    request,
  });
  return { roleId, membersUpdated: affected };
},
  CONFIG_FUNCTION_OPTIONS,
);

export const deleteStaffRole = callable(
  z.object({ restaurantId: zId, roleId: zId }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'team.manage', 'restaurants.edit');
    const restaurant = await loadRestaurant(data.restaurantId);
    const ref = rolesCol(data.restaurantId).doc(data.roleId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Rôle');
    const role = snap.data() as StaffRoleDefinition;
    if (role.system) throw fail.forbidden('Les rôles fournis par GoLink ne sont pas supprimables.');
    const members = await membersCol(data.restaurantId).where('customRoleId', '==', data.roleId).where('active', '==', true).limit(1).get();
    if (!members.empty) throw fail.precondition('Ce rôle est encore attribué : changez d’abord le rôle des membres concernés.');
    await ref.delete();
    await writeAudit({
      actor: actorFromCaller(actor.caller, actorType(actor)),
      action: 'restaurant.staff_role_deleted',
      target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
      before: { roleId: data.roleId, name: role.name, permissions: role.permissions },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
    return { deleted: true };
  },
  CONFIG_FUNCTION_OPTIONS,
);
