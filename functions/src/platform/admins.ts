// Administrateurs internes (cahier §26) : rôle, périmètre géographique, plafond de
// remboursement, activation ; matrice des permissions par rôle. L'invitation passe
// par `inviteAdmin` (core). Chaque changement de droits est audité et signalé.
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  COLLECTIONS,
  CITY_SCOPED_ROLES,
  type AdminPermission,
  type AdminRoleDefinition,
  type AdminUser,
} from '@golink/shared';
import { auth, db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { syncClaims } from '../lib/claims';
import { fail } from '../lib/errors';
import { z, zId, zReason } from '../lib/validation';
import { resolveAdminPermissions } from '../core/users';
import { resolveCityScope } from '../lib/permissions';
import { platformCallable, raiseSecurityAlert, recordSettingsChange, requireSecureAdmin } from './runtime';

const zCents = z.number().int().min(0).max(100_000_000);

export const updateAdminRole = platformCallable(
  z.object({
    adminId: zId,
    role: z.enum(ADMIN_ROLES),
    cityIds: z.array(zId).max(30),
    countryIds: z.array(zId).max(10),
    /** null : plafond du rôle. */
    refundLimitCents: zCents.nullable(),
    active: z.boolean(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller, admin } = await requireSecureAdmin(request, 'admins.manage');
    const ref = db.collection(COLLECTIONS.admins).doc(data.adminId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Administrateur');
    const before = snap.data() as AdminUser;
    const touchesSuper = before.role === 'super_admin' || data.role === 'super_admin';
    if (touchesSuper && admin.role !== 'super_admin') throw fail.forbidden('Seul un super administrateur peut modifier un super administrateur.');
    // Ne couvrait à l'origine que role/active : un titulaire de `admins.manage` pouvait s'appeler
    // lui-même avec le même rôle pour élargir son propre périmètre (cityIds/countryIds) ou relever
    // son propre plafond de remboursement personnel — auto-élévation de privilèges.
    const sameCityIds = [...before.cityIds].sort().join(',') === [...data.cityIds].sort().join(',');
    const sameCountryIds = [...before.countryIds].sort().join(',') === [...data.countryIds].sort().join(',');
    const sameRefundLimit = (before.refundLimitCents ?? null) === data.refundLimitCents;
    if (data.adminId === caller.uid && (data.role !== before.role || !data.active || !sameCityIds || !sameCountryIds || !sameRefundLimit)) {
      throw fail.forbidden('Vous ne pouvez pas modifier votre propre rôle, périmètre, plafond de remboursement, ni désactiver votre compte.');
    }
    const scopedCityIds = await resolveCityScope(data.role, data.cityIds, data.countryIds);
    if ((CITY_SCOPED_ROLES as readonly string[]).includes(data.role) && scopedCityIds.length === 0) {
      throw fail.invalid('Un responsable de ville doit avoir au moins une ville dans son périmètre.');
    }
    if (before.role === 'super_admin' && (data.role !== 'super_admin' || !data.active)) {
      const supers = await db.collection(COLLECTIONS.admins).where('role', '==', 'super_admin').where('active', '==', true).get();
      if (supers.size <= 1) throw fail.precondition('Il doit rester au moins un super administrateur actif.');
    }

    const permissions = data.role === before.role ? before.permissions : await resolveAdminPermissions(data.role);
    const after = {
      role: data.role,
      permissions,
      cityIds: scopedCityIds,
      countryIds: data.countryIds,
      refundLimitCents: data.refundLimitCents,
      active: data.active,
    };
    const change = await recordSettingsChange({
      docPath: `${COLLECTIONS.admins}/${data.adminId}`,
      before: { role: before.role, cityIds: before.cityIds, countryIds: before.countryIds, refundLimitCents: before.refundLimitCents ?? null, active: before.active },
      after: { role: data.role, cityIds: scopedCityIds, countryIds: data.countryIds, refundLimitCents: data.refundLimitCents, active: data.active },
      reason: data.reason,
      caller,
    });
    if (change.fields.length === 0) return { changedFields: [] };
    await ref.update({ ...after, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await syncClaims(data.adminId);
    if (!data.active && before.active) {
      await auth.revokeRefreshTokens(data.adminId).catch(() => undefined);
      const open = await db.collection(COLLECTIONS.adminSessions).where('adminId', '==', data.adminId).where('revokedAt', '==', null).get();
      const batch = db.batch();
      for (const doc of open.docs) batch.update(doc.ref, { revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid, revokeReason: 'Compte désactivé' });
      await batch.commit();
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: !data.active && before.active ? 'admin.deactivated' : data.active && !before.active ? 'admin.reactivated' : 'admin.updated',
      target: { type: 'admin', id: data.adminId, label: before.email },
      reason: data.reason,
      before: change.before,
      after: change.after,
      sensitive: true,
      request,
    });
    if (change.fields.includes('role') || change.fields.includes('active')) {
      await raiseSecurityAlert({
        type: 'permission_change',
        adminId: data.adminId,
        severity: data.role === 'super_admin' && before.role !== 'super_admin' ? 'warning' : 'info',
        details: `Droits de ${before.displayName} modifiés par ${admin.displayName} (${change.fields.join(', ')}) : ${data.reason}`,
      });
    }
    return { changedFields: change.fields };
  },
);

/** Matrice des permissions d'un rôle (sauf super administrateur, qui a tout). */
export const updateAdminRoleDefinition = platformCallable(
  z.object({
    role: z.enum(ADMIN_ROLES).exclude(['super_admin']),
    label: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300),
    permissions: z.array(z.enum(ADMIN_PERMISSIONS)).max(ADMIN_PERMISSIONS.length),
    defaultRefundLimitCents: zCents,
    /** Ignoré : le masquage découle de la permission « Données personnelles non masquées » (source unique). */
    maskPersonalData: z.boolean().optional(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'admins.manage');
    const ref = db.collection(COLLECTIONS.adminRoles).doc(data.role);
    const snap = await ref.get();
    const before = (snap.data() ?? null) as AdminRoleDefinition | null;
    const permissions = [...new Set(data.permissions)].sort() as AdminPermission[];
    const next = {
      role: data.role,
      label: data.label,
      description: data.description,
      permissions,
      defaultRefundLimitCents: data.defaultRefundLimitCents,
      // Source unique : sans la permission personal_data.view, les coordonnées et données bancaires sont masquées.
      maskPersonalData: !permissions.includes('personal_data.view'),
    };
    const change = await recordSettingsChange({
      docPath: `${COLLECTIONS.adminRoles}/${data.role}`,
      before: before ? { label: before.label, description: before.description, permissions: [...before.permissions].sort(), defaultRefundLimitCents: before.defaultRefundLimitCents, maskPersonalData: before.maskPersonalData } : null,
      after: next,
      reason: data.reason,
      caller,
    });
    if (change.fields.length === 0) return { changedFields: [], affectedAdmins: 0 };
    // onAdminRoleWrite propage les permissions aux comptes de ce rôle.
    await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    const members = await db.collection(COLLECTIONS.admins).where('role', '==', data.role).count().get();
    const added = permissions.filter((p) => !before?.permissions.includes(p));
    const removed = (before?.permissions ?? []).filter((p) => !permissions.includes(p));
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'admin_role.updated',
      target: { type: 'setting', id: `${COLLECTIONS.adminRoles}/${data.role}`, label: data.label },
      reason: data.reason,
      before: { ...change.before, permissions: undefined, removed },
      after: { ...change.after, permissions: undefined, added },
      sensitive: true,
      request,
    });
    if (added.length || removed.length) {
      await raiseSecurityAlert({
        type: 'permission_change',
        severity: 'info',
        details: `Rôle « ${data.label} » : ${added.length} permission${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''}, ${removed.length} retirée${removed.length > 1 ? 's' : ''} (${data.reason}).`,
      });
    }
    return { changedFields: change.fields, affectedAdmins: members.data().count };
  },
);
