// Planning : publication d'une semaine (avec notification des salariés) et
// traitement des demandes de modification de créneau.
import type { Shift, ShiftChangeRequest } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import { HR_CALLABLE, fullName, loadEmployee, notifyUser, sub } from './common';
import { addDays, formatDuration, formatLongDay, mondayOf, shiftMinutes } from './time';

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');
const zHourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide');

export const publishSchedule = callable(
  z.object({
    restaurantId: zId,
    weekStart: zDay,
    action: z.enum(['publish', 'unpublish']).default('publish'),
    /** Limiter à certains salariés (vide : toute l'équipe). */
    employeeIds: z.array(zId).max(200).optional(),
    notify: z.boolean().default(true),
  }),
  async (data, request) => {
    if (mondayOf(data.weekStart) !== data.weekStart) throw fail.invalid('La semaine doit commencer un lundi.');
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'planning.manage');
    const weekEnd = addDays(data.weekStart, 6);
    const snap = await sub(data.restaurantId, 'shifts').where('date', '>=', data.weekStart).where('date', '<=', weekEnd).get();
    const wanted = data.employeeIds && data.employeeIds.length > 0 ? new Set(data.employeeIds) : null;
    const publish = data.action === 'publish';
    const targets = snap.docs.filter((doc) => {
      const shift = doc.data() as Shift;
      return (!wanted || wanted.has(shift.employeeId)) && shift.published !== publish;
    });
    if (targets.length === 0) {
      throw fail.precondition(publish ? 'Tous les créneaux de cette semaine sont déjà publiés.' : 'Aucun créneau publié à retirer cette semaine.');
    }

    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      for (const doc of targets.slice(i, i + 400)) {
        batch.update(doc.ref, { published: publish, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.caller.uid });
      }
      await batch.commit();
    }

    // Une notification par salarié concerné, avec son volume horaire de la semaine.
    if (publish && data.notify) {
      const perEmployee = new Map<string, { uid: string | null; minutes: number; count: number }>();
      for (const doc of snap.docs) {
        const shift = doc.data() as Shift;
        if (wanted && !wanted.has(shift.employeeId)) continue;
        const current = perEmployee.get(shift.employeeId) ?? { uid: shift.employeeUid ?? null, minutes: 0, count: 0 };
        current.minutes += shiftMinutes(shift.startTime, shift.endTime, shift.breakMinutes);
        current.count += 1;
        perEmployee.set(shift.employeeId, current);
      }
      await Promise.all(
        [...perEmployee.values()].map((item) =>
          notifyUser(
            item.uid,
            'Votre planning est publié',
            `Semaine du ${formatLongDay(data.weekStart)} : ${item.count} service${item.count > 1 ? 's' : ''}, ${formatDuration(item.minutes)} au total.`,
            '/equipe/planning',
          ),
        ),
      );
    }

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: publish ? 'schedule.published' : 'schedule.unpublished',
      target: { type: 'restaurant', id: data.restaurantId, label: `Planning du ${data.weekStart}` },
      after: { shifts: targets.length },
      request,
    });
    return { updated: targets.length };
  },
  HR_CALLABLE,
);

export const reviewShiftChangeRequest = callable(
  z.object({
    restaurantId: zId,
    requestId: zId,
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(500).optional(),
    /** Ajustement des horaires accordés (sinon ceux demandés). */
    startTime: zHourMinute.optional(),
    endTime: zHourMinute.optional(),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'planning.manage');
    if (data.decision === 'reject' && (data.reason ?? '').length < 3) throw fail.invalid('Indiquez le motif du refus.');
    const requestRef = sub(data.restaurantId, 'shiftChangeRequests').doc(data.requestId);

    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) throw fail.notFound('Demande');
      const change = snap.data() as ShiftChangeRequest;
      if (change.status !== 'pending') throw fail.precondition('Cette demande a déjà été traitée.');
      const shiftRef = change.shiftId ? sub(data.restaurantId, 'shifts').doc(change.shiftId) : null;
      const shiftSnap = shiftRef ? await tx.get(shiftRef) : null;

      tx.update(requestRef, {
        status: data.decision === 'approve' ? 'approved' : 'rejected',
        reviewedBy: actor.caller.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        rejectionReason: data.decision === 'reject' ? data.reason : null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.caller.uid,
      });
      if (data.decision === 'approve') {
        const times = { startTime: data.startTime ?? change.startTime, endTime: data.endTime ?? change.endTime };
        if (shiftRef && shiftSnap?.exists) {
          tx.update(shiftRef, { date: change.date, ...times, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.caller.uid });
        } else {
          const shift: Omit<Shift, 'createdAt' | 'updatedAt'> & { createdAt: FieldValue; updatedAt: FieldValue } = {
            employeeId: change.employeeId,
            employeeUid: change.employeeUid ?? null,
            date: change.date,
            ...times,
            breakMinutes: 20,
            position: null,
            notes: 'Créé à partir d’une demande du salarié.',
            published: true,
            templateId: null,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actor.caller.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor.caller.uid,
          };
          tx.set(sub(data.restaurantId, 'shifts').doc(), shift);
        }
      }
      return change;
    });

    const employee = await loadEmployee(data.restaurantId, outcome.employeeId).catch(() => null);
    await notifyUser(
      outcome.employeeUid,
      data.decision === 'approve' ? 'Demande de modification acceptée' : 'Demande de modification refusée',
      data.decision === 'approve'
        ? `Votre créneau du ${formatLongDay(outcome.date)} a été mis à jour.`
        : `Votre demande pour le ${formatLongDay(outcome.date)} a été refusée : ${data.reason}`,
      '/equipe/planning',
    );
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: data.decision === 'approve' ? 'shift_change.approved' : 'shift_change.rejected',
      target: { type: 'restaurant', id: data.restaurantId, label: employee ? `${fullName(employee)} · ${outcome.date}` : outcome.date },
      reason: data.reason ?? null,
      request,
    });
    return { status: data.decision === 'approve' ? 'approved' : 'rejected' };
  },
  HR_CALLABLE,
);
