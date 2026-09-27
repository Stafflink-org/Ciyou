// Annuaire de l'équipe (staffDirectory) : copie non sensible des fiches salariés
// et des membres sans fiche, lisible par tout le personnel (planning, tâches,
// HACCP). Quand un compte est relié à une fiche, employeeUid est propagé.
import { STAFF_ROLE_LABELS, type Employee, type RestaurantMember, type StaffDirectoryEntry } from '@golink/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../lib/admin';
import { HR_RUNTIME, sub } from './common';

const PALETTE = ['#19343b', '#e8784b', '#4a846c', '#9467a5', '#4a7fbb', '#e09b24', '#31968b', '#d6533f'];

function colorFor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!;
}

export function employeeDirectoryEntry(employeeId: string, employee: Employee): Omit<StaffDirectoryEntry, 'updatedAt'> {
  return {
    kind: 'employee',
    employeeId,
    uid: employee.uid ?? null,
    firstName: employee.firstName,
    lastName: employee.lastName,
    displayName: `${employee.firstName} ${employee.lastName}`.trim(),
    position: employee.position ?? null,
    department: employee.department ?? null,
    color: employee.color || colorFor(employeeId),
    contractType: employee.contractType ?? null,
    weeklyHours: employee.weeklyHours ?? null,
    active: employee.status !== 'terminated' && employee.status !== 'inactive',
  };
}

export function memberDirectoryEntry(uid: string, member: RestaurantMember): Omit<StaffDirectoryEntry, 'updatedAt'> {
  const [firstName = member.displayName, ...rest] = member.displayName.split(' ');
  return {
    kind: 'member',
    employeeId: null,
    uid,
    firstName,
    lastName: rest.join(' '),
    displayName: member.displayName,
    position: STAFF_ROLE_LABELS[member.role] ?? null,
    department: null,
    color: colorFor(uid),
    contractType: null,
    weeklyHours: null,
    active: member.active,
  };
}

/** Collections portant employeeId / employeeUid à réaligner quand le compte lié change. */
const LINKED = ['shifts', 'timeEntries', 'absences', 'payslips', 'weekValidations', 'employeeDocuments', 'availabilities', 'shiftChangeRequests'] as const;

export const onEmployeeDirectorySync = onDocumentWritten({ document: 'restaurants/{rid}/employees/{employeeId}', ...HR_RUNTIME }, async (event) => {
  const { rid, employeeId } = event.params;
  const before = event.data?.before.exists ? (event.data.before.data() as Employee) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as Employee) : null;
  const ref = sub(rid, 'staffDirectory').doc(employeeId);
  if (!after) {
    await ref.delete();
    return;
  }
  await ref.set({ ...employeeDirectoryEntry(employeeId, after), updatedAt: FieldValue.serverTimestamp() });

  // Le membre relié n'a plus besoin de son entrée « membre sans fiche ».
  if (after.uid) await sub(rid, 'staffDirectory').doc(`m_${after.uid}`).delete();

  const previousUid = before?.uid ?? null;
  const nextUid = after.uid ?? null;
  if (before && previousUid !== nextUid) {
    for (const name of LINKED) {
      const snap = await sub(rid, name).where('employeeId', '==', employeeId).limit(500).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach((doc) => batch.update(doc.ref, { employeeUid: nextUid }));
        await batch.commit();
      }
    }
    if (previousUid) {
      const member = await sub(rid, 'members').doc(previousUid).get();
      if (member.exists && !(member.data() as RestaurantMember).employeeId) {
        await sub(rid, 'staffDirectory').doc(`m_${previousUid}`).set({
          ...memberDirectoryEntry(previousUid, member.data() as RestaurantMember),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
});

export const onMemberDirectorySync = onDocumentWritten({ document: 'restaurants/{rid}/members/{uid}', ...HR_RUNTIME }, async (event) => {
  const { rid, uid } = event.params;
  const after = event.data?.after.exists ? (event.data.after.data() as RestaurantMember) : null;
  const ref = sub(rid, 'staffDirectory').doc(`m_${uid}`);
  if (!after) {
    await ref.delete();
    return;
  }
  const linked = after.employeeId
    ? (await sub(rid, 'employees').doc(after.employeeId).get()).exists
    : !(await sub(rid, 'employees').where('uid', '==', uid).limit(1).get()).empty;
  if (linked) {
    await ref.delete();
    return;
  }
  await ref.set({ ...memberDirectoryEntry(uid, after), updatedAt: FieldValue.serverTimestamp() });
});
