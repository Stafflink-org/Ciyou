// Absences : décision du responsable (acceptation, refus, annulation d'une
// absence acceptée), mise à jour des soldes et du planning.
import { ABSENCE_TYPE_LABELS, type Absence, type AbsenceType, type Employee } from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { assertFeatureAllowed } from '../finance/argent/entitlements';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import { HR_CALLABLE, fullName, loadPayrollSettings, notifyUser, sub } from './common';
import { daysBetween, formatLongDay, isHoliday, weekdayOf } from './time';

/** Types d'absence décomptés d'un solde. */
const BALANCE_FIELD: Partial<Record<AbsenceType, 'paidLeaveBalanceDays' | 'rttBalanceDays'>> = {
  paid_leave: 'paidLeaveBalanceDays',
  rtt: 'rttBalanceDays',
};

/**
 * Jours décomptés : jours ouvrés (lundi-vendredi) si le contrat prévoit 25 jours
 * de congés par an, jours ouvrables (lundi-samedi) sinon ; fériés exclus.
 */
export function countAbsenceDays(absence: Pick<Absence, 'startDate' | 'endDate' | 'halfDayStart' | 'halfDayEnd'>, workingDaysOnly: boolean): number {
  const days = daysBetween(absence.startDate, absence.endDate).filter((day) => {
    const weekday = weekdayOf(day);
    return weekday !== 6 && !(workingDaysOnly && weekday === 5) && !isHoliday(day);
  });
  let total = days.length;
  if (absence.halfDayStart && days[0] === absence.startDate) total -= 0.5;
  if (absence.halfDayEnd && days[days.length - 1] === absence.endDate && absence.endDate !== absence.startDate) total -= 0.5;
  return Math.max(0, total);
}

export const reviewAbsence = callable(
  z.object({
    restaurantId: zId,
    absenceId: zId,
    decision: z.enum(['approve', 'reject', 'revoke']),
    reason: z.string().trim().max(500).optional(),
    allowNegativeBalance: z.boolean().default(false),
    /** Retire du planning les créneaux couverts par l'absence acceptée. */
    removeShifts: z.boolean().default(true),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'absences.manage');
    await assertFeatureAllowed(data.restaurantId, 'absences');
    if (data.decision !== 'approve' && (data.reason ?? '').length < 3) throw fail.invalid('Indiquez un motif.');
    const settings = await loadPayrollSettings(data.restaurantId);
    const absenceRef = sub(data.restaurantId, 'absences').doc(data.absenceId);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(absenceRef);
      if (!snap.exists) throw fail.notFound('Absence');
      const absence = snap.data() as Absence;
      const employeeRef = sub(data.restaurantId, 'employees').doc(absence.employeeId);
      const employeeSnap = await tx.get(employeeRef);
      if (!employeeSnap.exists) throw fail.notFound('Salarié');
      const employee = employeeSnap.data() as Employee;
      const balanceField = BALANCE_FIELD[absence.type];
      const duration = countAbsenceDays(absence, settings.paidLeaveDaysPerYear <= 25);

      if (data.decision === 'approve') {
        if (absence.status !== 'pending') throw fail.precondition('Seule une demande en attente peut être acceptée.');
        if (balanceField) {
          const balance = employee[balanceField] ?? 0;
          if (balance < duration && !data.allowNegativeBalance) {
            throw fail.precondition(
              `Solde insuffisant : ${balance.toLocaleString('fr-FR')} j disponible(s) pour ${duration.toLocaleString('fr-FR')} j demandé(s).`,
            );
          }
          tx.update(employeeRef, { [balanceField]: Math.round((balance - duration) * 100) / 100, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.caller.uid });
        }
        tx.update(absenceRef, {
          status: 'approved',
          durationDays: duration,
          approvedBy: actor.caller.uid,
          approvedAt: FieldValue.serverTimestamp(),
          rejectionReason: null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.caller.uid,
        });
      } else if (data.decision === 'reject') {
        if (absence.status !== 'pending') throw fail.precondition('Seule une demande en attente peut être refusée.');
        tx.update(absenceRef, {
          status: 'rejected',
          rejectionReason: data.reason,
          approvedBy: actor.caller.uid,
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.caller.uid,
        });
      } else {
        if (absence.status !== 'approved') throw fail.precondition('Seule une absence acceptée peut être annulée.');
        if (balanceField) {
          const balance = employee[balanceField] ?? 0;
          tx.update(employeeRef, {
            [balanceField]: Math.round((balance + (absence.durationDays ?? duration)) * 100) / 100,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor.caller.uid,
          });
        }
        tx.update(absenceRef, {
          status: 'cancelled',
          rejectionReason: data.reason,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.caller.uid,
        });
      }
      return { absence, employee, duration };
    });

    // Planning : les créneaux couverts par l'absence sont retirés.
    let removedShifts = 0;
    if (data.decision === 'approve' && data.removeShifts) {
      const shifts = await sub(data.restaurantId, 'shifts')
        .where('employeeId', '==', result.absence.employeeId)
        .where('date', '>=', result.absence.startDate)
        .where('date', '<=', result.absence.endDate)
        .get();
      if (!shifts.empty) {
        const batch = db.batch();
        shifts.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        removedShifts = shifts.size;
      }
    }

    const label = ABSENCE_TYPE_LABELS[result.absence.type];
    const period =
      result.absence.startDate === result.absence.endDate
        ? `le ${formatLongDay(result.absence.startDate)}`
        : `du ${formatLongDay(result.absence.startDate)} au ${formatLongDay(result.absence.endDate)}`;
    await notifyUser(
      result.absence.employeeUid,
      data.decision === 'approve' ? 'Absence acceptée' : data.decision === 'reject' ? 'Absence refusée' : 'Absence annulée',
      data.decision === 'approve' ? `${label} ${period} : demande acceptée.` : `${label} ${period} : ${data.reason}`,
      '/equipe/absences',
    );
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: `absence.${data.decision === 'approve' ? 'approved' : data.decision === 'reject' ? 'rejected' : 'revoked'}`,
      target: { type: 'restaurant', id: data.restaurantId, label: `${fullName(result.employee)} · ${label}` },
      reason: data.reason ?? null,
      after: { startDate: result.absence.startDate, endDate: result.absence.endDate, durationDays: result.duration, removedShifts },
      request,
    });
    return { durationDays: result.duration, removedShifts };
  },
  HR_CALLABLE,
);
