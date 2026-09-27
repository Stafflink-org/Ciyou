// Synchronisation automatique des claims et des permissions résolues quand
// Firestore change (équipe interne, personnel des restaurants, rôles internes).
import { COLLECTIONS, SUBCOLLECTIONS, type AdminRoleDefinition } from '@golink/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, Timestamp } from '../lib/admin';
import { syncClaims } from '../lib/claims';

function changed(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, keys: string[]): boolean {
  return keys.some((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));
}

export const onAdminWrite = onDocumentWritten(`${COLLECTIONS.admins}/{uid}`, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!changed(before, after, ['role', 'active'])) return;
  await syncClaims(event.params.uid);
});

export const onMemberWrite = onDocumentWritten(
  `${COLLECTIONS.restaurants}/{rid}/${SUBCOLLECTIONS.restaurants.members}/{uid}`,
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!changed(before, after, ['role', 'active'])) return;
    await syncClaims(event.params.uid);
  },
);

/** Un rôle interne modifié : les permissions résolues de ses membres sont mises à jour. */
export const onAdminRoleWrite = onDocumentWritten(`${COLLECTIONS.adminRoles}/{role}`, async (event) => {
  const rawAfter = event.data?.after.data();
  if (!rawAfter || event.params.role === 'super_admin') return;
  if (!changed(event.data?.before.data(), rawAfter, ['permissions'])) return;
  const after = rawAfter as AdminRoleDefinition;
  const admins = await db.collection(COLLECTIONS.admins).where('role', '==', event.params.role).get();
  const writer = db.bulkWriter();
  for (const doc of admins.docs) {
    void writer.update(doc.ref, { permissions: after.permissions, updatedAt: Timestamp.now(), updatedBy: 'system' });
  }
  await writer.close();
});
