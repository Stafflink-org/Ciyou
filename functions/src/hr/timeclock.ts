// Pointages : entrée, sortie et pauses (clockEvent), corrections tracées
// (correctTimeEntry) et validation hebdomadaire (validateWeek).
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  haversineMeters,
  memberHasPermission,
  type ClockPoint,
  type Employee,
  type Restaurant,
  type Shift,
  type TimeEntry,
  type TimeEntryHistory,
  type WeekValidation,
} from '@golink/shared';
import { GeoPoint, type Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { assertFeatureAllowed } from '../finance/argent/entitlements';
import { fail } from '../lib/errors';
import { loadMember, requireAuth, requireRestaurantAccess } from '../lib/permissions';
import { z, zId, zReason } from '../lib/validation';
import { HR_CALLABLE, employeeOfUser, fullName, loadEmployee, loadPayrollSettings, sub } from './common';
import {
  addDays,
  formatDuration,
  hourMinuteToMinutes,
  mondayOf,
  nightMinutes,
  parisDateAt,
  parisDay,
  parisHourMinute,
  shiftMinutes,
  totalMinutes,
  workedIntervals,
} from './time';

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');
const zHourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide');

/** Distance au-delà de laquelle un pointage mobile est signalé. */
const GEOFENCE_METERS = 300;
const LEGAL_WEEK_MINUTES = 35 * 60;

type StoredBreak = { start: AdminTimestamp; end?: AdminTimestamp | null };

/** Minutes prévues au planning ce jour-là (sinon durée journalière du contrat). */
async function plannedMinutes(restaurantId: string, employeeId: string, employee: Employee, day: string): Promise<{ minutes: number; shiftId: string | null }> {
  const shifts = await sub(restaurantId, 'shifts').where('employeeId', '==', employeeId).where('date', '==', day).get();
  if (shifts.empty) return { minutes: Math.round((employee.weeklyHours * 60) / 5), shiftId: null };
  const list = shifts.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Shift) }));
  return {
    minutes: list.reduce((total, shift) => total + shiftMinutes(shift.startTime, shift.endTime, shift.breakMinutes), 0),
    shiftId: list[0]?.id ?? null,
  };
}

/** Recalcule les compteurs d'une journée pointée et close. */
function computeTotals(
  clockIn: Date,
  clockOut: Date,
  breaks: Array<{ start: Date; end: Date | null }>,
  window: { from: string; to: string },
  planned: number,
): { workedMinutes: number; nightMinutes: number; overtimeMinutes: number } {
  const intervals = workedIntervals(clockIn, clockOut, breaks);
  const worked = totalMinutes(intervals);
  return { workedMinutes: worked, nightMinutes: nightMinutes(intervals, window), overtimeMinutes: Math.max(0, worked - planned) };
}

const toDates = (breaks: StoredBreak[]) => breaks.map((b) => ({ start: b.start.toDate(), end: b.end ? b.end.toDate() : null }));

// ---------------------------------------------------------------------------
// Pointage
// ---------------------------------------------------------------------------

export const clockEvent = callable(
  z.object({
    restaurantId: zId,
    action: z.enum(['in', 'out', 'break_start', 'break_end']),
    /** Pointage pour le compte d'un salarié (droit timeclock.manage). */
    employeeId: zId.optional(),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000).optional(),
      })
      .optional(),
    source: z.enum(['mobile', 'tablet', 'backoffice']).default('backoffice'),
  }),
  async (data, request) => {
    const caller = requireAuth(request);
    const member = await loadMember(data.restaurantId, caller.uid);
    if (!member?.active) throw fail.forbidden();
    await assertFeatureAllowed(data.restaurantId, 'timeclock');

    const own = await employeeOfUser(data.restaurantId, caller.uid, member);
    let employeeId: string;
    let employee: Employee;
    let onBehalf = false;
    if (data.employeeId && data.employeeId !== own?.id) {
      if (!memberHasPermission(member, 'timeclock.manage')) throw fail.forbidden();
      employeeId = data.employeeId;
      employee = await loadEmployee(data.restaurantId, employeeId);
      onBehalf = true;
    } else {
      if (!memberHasPermission(member, 'timeclock.self') && !memberHasPermission(member, 'timeclock.manage')) throw fail.forbidden();
      if (!own) throw fail.precondition('Aucune fiche salarié n’est associée à votre compte. Demandez à votre responsable de la relier.');
      employeeId = own.id;
      employee = own.employee;
    }
    if (employee.status === 'terminated') throw fail.precondition('Ce salarié est sorti des effectifs.');

    const settings = await loadPayrollSettings(data.restaurantId);
    const now = new Date();
    const today = parisDay(now);
    const planned = await plannedMinutes(data.restaurantId, employeeId, employee, today);

    let distanceMeters: number | null = null;
    if (data.location) {
      const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get()).data() as Restaurant | undefined;
      const geo = restaurant?.address?.geo;
      if (geo) {
        distanceMeters = Math.round(
          haversineMeters({ lat: geo.latitude, lng: geo.longitude }, { lat: data.location.latitude, lng: data.location.longitude }),
        );
      }
    }
    const point = (): Omit<ClockPoint, 'at'> & { at: AdminTimestamp } => ({
      at: Timestamp.fromDate(now),
      location: data.location ? new GeoPoint(data.location.latitude, data.location.longitude) : null,
      accuracyMeters: data.location?.accuracy ?? null,
      source: onBehalf ? 'backoffice' : data.source,
      distanceMeters,
      recordedBy: onBehalf ? caller.uid : null,
    });

    const todayRef = sub(data.restaurantId, 'timeEntries').doc(`${employeeId}_${today}`);
    const yesterdayRef = sub(data.restaurantId, 'timeEntries').doc(`${employeeId}_${addDays(today, -1)}`);

    const result = await db.runTransaction(async (tx) => {
      const [todaySnap, yesterdaySnap] = await Promise.all([tx.get(todayRef), tx.get(yesterdayRef)]);
      const todayEntry = todaySnap.exists ? (todaySnap.data() as TimeEntry) : null;
      const yesterdayEntry = yesterdaySnap.exists ? (yesterdaySnap.data() as TimeEntry) : null;
      const isOpen = (entry: TimeEntry | null) => Boolean(entry?.clockIn && !entry.clockOut);

      if (data.action === 'in') {
        if (isOpen(todayEntry)) {
          throw fail.precondition(`Déjà en service depuis ${parisHourMinute((todayEntry!.clockIn!.at as unknown as AdminTimestamp).toDate())}.`);
        }
        if (isOpen(yesterdayEntry)) {
          const since = (yesterdayEntry!.clockIn!.at as unknown as AdminTimestamp).toDate();
          if (now.getTime() - since.getTime() < 16 * 3_600_000) {
            throw fail.precondition('Le service commencé hier n’est pas clôturé : pointez d’abord la sortie.');
          }
        }
        if (todayEntry?.clockIn && todayEntry.clockOut) {
          // Reprise après une coupure : la coupure devient une pause.
          const breaks = [...(todayEntry.breaks as unknown as StoredBreak[]), { start: todayEntry.clockOut.at as unknown as AdminTimestamp, end: Timestamp.fromDate(now) }];
          tx.update(todayRef, { clockOut: null, breaks, status: 'open', updatedAt: FieldValue.serverTimestamp() });
          return { entryId: todayRef.id, state: 'working' as const };
        }
        const entry = {
          employeeId,
          employeeUid: employee.uid ?? null,
          date: today,
          clockIn: point(),
          clockOut: null,
          breaks: [],
          workedMinutes: 0,
          overtimeMinutes: 0,
          nightMinutes: 0,
          status: 'open',
          shiftId: planned.shiftId,
          notes: distanceMeters !== null && distanceMeters > GEOFENCE_METERS ? `Entrée pointée à ${distanceMeters} m de l’établissement.` : null,
          modifiedBy: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        tx.set(todayRef, entry);
        return { entryId: todayRef.id, state: 'working' as const };
      }

      const ref = isOpen(todayEntry) ? todayRef : isOpen(yesterdayEntry) ? yesterdayRef : null;
      const entry = ref === todayRef ? todayEntry : ref === yesterdayRef ? yesterdayEntry : null;
      if (!ref || !entry?.clockIn) throw fail.precondition('Aucun service en cours : pointez d’abord votre arrivée.');
      const breaks = [...(entry.breaks as unknown as StoredBreak[])];
      const openBreak = breaks.findIndex((b) => !b.end);

      if (data.action === 'break_start') {
        if (openBreak >= 0) throw fail.precondition('Une pause est déjà en cours.');
        breaks.push({ start: Timestamp.fromDate(now), end: null });
        tx.update(ref, { breaks, updatedAt: FieldValue.serverTimestamp() });
        return { entryId: ref.id, state: 'on_break' as const };
      }
      if (data.action === 'break_end') {
        if (openBreak < 0) throw fail.precondition('Aucune pause en cours.');
        breaks[openBreak] = { start: breaks[openBreak]!.start, end: Timestamp.fromDate(now) };
        tx.update(ref, { breaks, updatedAt: FieldValue.serverTimestamp() });
        return { entryId: ref.id, state: 'working' as const };
      }

      // Sortie : la pause en cours est close à l'heure de sortie.
      if (openBreak >= 0) breaks[openBreak] = { start: breaks[openBreak]!.start, end: Timestamp.fromDate(now) };
      const clockIn = (entry.clockIn.at as unknown as AdminTimestamp).toDate();
      const totals = computeTotals(clockIn, now, toDates(breaks), settings.nightWindow, ref === todayRef ? planned.minutes : Math.round((employee.weeklyHours * 60) / 5));
      const outPoint = point();
      const farNote = distanceMeters !== null && distanceMeters > GEOFENCE_METERS ? `Sortie pointée à ${distanceMeters} m de l’établissement.` : null;
      tx.update(ref, {
        clockOut: outPoint,
        breaks,
        ...totals,
        status: 'pending',
        notes: [entry.notes, farNote].filter(Boolean).join(' ') || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { entryId: ref.id, state: 'off' as const, workedMinutes: totals.workedMinutes };
    });

    if (onBehalf) {
      await writeAudit({
        actor: actorFromCaller(caller, 'restaurant'),
        action: `time_entry.clock_${data.action}`,
        target: { type: 'restaurant', id: data.restaurantId, label: fullName(employee) },
        after: { employeeId, action: data.action },
        request,
      });
    }
    return result;
  },
  HR_CALLABLE,
);

// ---------------------------------------------------------------------------
// Correction par un responsable
// ---------------------------------------------------------------------------

export const correctTimeEntry = callable(
  z.object({
    restaurantId: zId,
    employeeId: zId,
    date: zDay,
    clockIn: zHourMinute,
    clockOut: zHourMinute.nullable(),
    breaks: z.array(z.object({ start: zHourMinute, end: zHourMinute })).max(6).default([]),
    notes: z.string().trim().max(500).nullable().optional(),
    reason: zReason,
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'timeclock.manage');
    await assertFeatureAllowed(data.restaurantId, 'timeclock');
    const employee = await loadEmployee(data.restaurantId, data.employeeId);
    const weekStart = mondayOf(data.date);
    const validation = await sub(data.restaurantId, 'weekValidations').doc(`${data.employeeId}_${weekStart}`).get();
    if (validation.exists && (validation.data() as WeekValidation).status === 'manager_validated') {
      throw fail.precondition('Cette semaine est validée : rouvrez-la avant de corriger un pointage.');
    }

    // Heures « HH:MM » → instants ; tout horaire antérieur à l'entrée est le lendemain.
    const inMinutes = hourMinuteToMinutes(data.clockIn);
    const at = (value: string) => {
      const minutes = hourMinuteToMinutes(value);
      return parisDateAt(data.date, minutes < inMinutes ? minutes + 24 * 60 : minutes);
    };
    const clockIn = parisDateAt(data.date, inMinutes);
    const clockOut = data.clockOut ? at(data.clockOut) : null;
    if (clockOut && clockOut.getTime() - clockIn.getTime() > 16 * 3_600_000) throw fail.invalid('Une journée ne peut pas dépasser 16 heures.');
    if (clockOut && clockOut.getTime() <= clockIn.getTime()) throw fail.invalid('La sortie doit suivre l’entrée.');
    const breaks = data.breaks.map((b) => ({ start: at(b.start), end: at(b.end) }));
    for (const pause of breaks) {
      if (pause.end <= pause.start) throw fail.invalid('Chaque pause doit se terminer après son début.');
      if (clockOut && pause.end > clockOut) throw fail.invalid('Les pauses doivent être comprises dans la journée pointée.');
    }

    const settings = await loadPayrollSettings(data.restaurantId);
    const planned = await plannedMinutes(data.restaurantId, data.employeeId, employee, data.date);
    const ref = sub(data.restaurantId, 'timeEntries').doc(`${data.employeeId}_${data.date}`);
    const changedByName = actor.kind === 'member' ? actor.member.displayName : actor.caller.name;

    const describeBreaks = (list: Array<{ start: Date; end: Date | null }>) =>
      list.length === 0 ? 'Aucune' : list.map((b) => `${parisHourMinute(b.start)}–${b.end ? parisHourMinute(b.end) : '…'}`).join(', ');

    const before = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as TimeEntry) : null;
      const oldIn = existing?.clockIn ? parisHourMinute((existing.clockIn.at as unknown as AdminTimestamp).toDate()) : null;
      const oldOut = existing?.clockOut ? parisHourMinute((existing.clockOut.at as unknown as AdminTimestamp).toDate()) : null;
      const oldBreaks = existing ? describeBreaks(toDates(existing.breaks as unknown as StoredBreak[])) : 'Aucune';
      const totals = clockOut
        ? computeTotals(clockIn, clockOut, breaks, settings.nightWindow, planned.minutes)
        : { workedMinutes: 0, nightMinutes: 0, overtimeMinutes: 0 };
      const point = (date: Date, previous?: ClockPoint | null) => ({
        at: Timestamp.fromDate(date),
        location: previous?.location ?? null,
        accuracyMeters: previous?.accuracyMeters ?? null,
        source: previous?.source ?? 'backoffice',
        distanceMeters: previous?.distanceMeters ?? null,
        recordedBy: actor.caller.uid,
      });
      tx.set(
        ref,
        {
          employeeId: data.employeeId,
          employeeUid: employee.uid ?? null,
          date: data.date,
          clockIn: point(clockIn, existing?.clockIn),
          clockOut: clockOut ? point(clockOut, existing?.clockOut) : null,
          breaks: breaks.map((b) => ({ start: Timestamp.fromDate(b.start), end: Timestamp.fromDate(b.end) })),
          ...totals,
          status: clockOut ? 'corrected' : 'open',
          shiftId: existing?.shiftId ?? planned.shiftId,
          notes: data.notes === undefined ? (existing?.notes ?? null) : data.notes,
          modifiedBy: actor.caller.uid,
          updatedAt: FieldValue.serverTimestamp(),
          ...(existing ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
      const changes: Array<[string, string | null, string | null]> = [
        ['clockIn', oldIn, data.clockIn],
        ['clockOut', oldOut, data.clockOut],
        ['breaks', oldBreaks, describeBreaks(breaks)],
      ];
      for (const [field, oldValue, newValue] of changes) {
        if (oldValue === newValue) continue;
        const history: Omit<TimeEntryHistory, 'changedAt'> & { changedAt: FieldValue } = {
          field,
          oldValue,
          newValue,
          changedBy: actor.caller.uid,
          changedByName,
          changedAt: FieldValue.serverTimestamp(),
          reason: data.reason,
        };
        tx.set(ref.collection(SUBCOLLECTIONS.timeEntries.history).doc(), history);
      }
      return { clockIn: oldIn, clockOut: oldOut, breaks: oldBreaks };
    });

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'time_entry.corrected',
      target: { type: 'restaurant', id: data.restaurantId, label: `${fullName(employee)} · ${data.date}` },
      reason: data.reason,
      before,
      after: { clockIn: data.clockIn, clockOut: data.clockOut, breaks: describeBreaks(breaks) },
      request,
    });
    return { entryId: ref.id };
  },
  HR_CALLABLE,
);

// ---------------------------------------------------------------------------
// Validation hebdomadaire
// ---------------------------------------------------------------------------

export const validateWeek = callable(
  z.object({
    restaurantId: zId,
    weekStart: zDay,
    employeeIds: z.array(zId).min(1).max(100),
    action: z.enum(['validate', 'reject', 'reopen', 'employee_validate']),
    comment: z.string().trim().max(500).optional(),
  }),
  async (data, request) => {
    if (mondayOf(data.weekStart) !== data.weekStart) throw fail.invalid('La semaine doit commencer un lundi.');
    const caller = requireAuth(request);
    const member = await loadMember(data.restaurantId, caller.uid);
    if (!member?.active) throw fail.forbidden();
    if (data.action === 'employee_validate') {
      const own = await employeeOfUser(data.restaurantId, caller.uid, member);
      if (!own || data.employeeIds.length !== 1 || data.employeeIds[0] !== own.id) throw fail.forbidden();
    } else if (!memberHasPermission(member, 'timeclock.manage')) {
      throw fail.forbidden();
    }
    await assertFeatureAllowed(data.restaurantId, 'timeclock');
    if (data.action === 'reject' && (data.comment ?? '').length < 3) throw fail.invalid('Indiquez le motif du refus.');

    const weekEnd = addDays(data.weekStart, 6);
    const names: string[] = [];
    let updated = 0;
    for (const employeeId of data.employeeIds) {
      const employee = await loadEmployee(data.restaurantId, employeeId);
      const entries = await sub(data.restaurantId, 'timeEntries')
        .where('employeeId', '==', employeeId)
        .where('date', '>=', data.weekStart)
        .where('date', '<=', weekEnd)
        .get();
      const list = entries.docs.map((doc) => ({ ref: doc.ref, entry: doc.data() as TimeEntry }));
      if ((data.action === 'validate' || data.action === 'employee_validate') && list.some(({ entry }) => entry.clockIn && !entry.clockOut)) {
        throw fail.precondition(`${fullName(employee)} a un service non clôturé cette semaine : corrigez-le avant de valider.`);
      }
      const worked = list.reduce((total, { entry }) => total + (entry.workedMinutes ?? 0), 0);
      const validationRef = sub(data.restaurantId, 'weekValidations').doc(`${employeeId}_${data.weekStart}`);
      const current = await validationRef.get();
      const currentStatus = current.exists ? (current.data() as WeekValidation).status : 'pending';
      if (data.action === 'employee_validate' && currentStatus === 'manager_validated') {
        throw fail.precondition('Cette semaine a déjà été validée par votre responsable.');
      }

      const batch = db.batch();
      const status =
        data.action === 'validate' ? 'manager_validated' : data.action === 'reject' ? 'rejected' : data.action === 'reopen' ? 'pending' : 'employee_validated';
      batch.set(
        validationRef,
        {
          employeeId,
          employeeUid: employee.uid ?? null,
          weekStart: data.weekStart,
          weekEnd,
          workedMinutes: worked,
          overtimeMinutes: Math.max(0, worked - LEGAL_WEEK_MINUTES),
          status,
          ...(data.action === 'employee_validate'
            ? { employeeComment: data.comment ?? null }
            : {
                managerComment: data.comment ?? null,
                validatedBy: data.action === 'validate' ? caller.uid : null,
                validatedAt: data.action === 'validate' ? FieldValue.serverTimestamp() : null,
              }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      for (const { ref, entry } of list) {
        if (data.action === 'validate' && entry.status !== 'validated' && entry.clockOut) batch.update(ref, { status: 'validated', updatedAt: FieldValue.serverTimestamp() });
        if (data.action === 'reopen' && entry.status === 'validated') batch.update(ref, { status: 'pending', updatedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
      names.push(`${fullName(employee)} (${formatDuration(worked)})`);
      updated += 1;
    }

    if (data.action !== 'employee_validate') {
      await writeAudit({
        actor: actorFromCaller(caller, 'restaurant'),
        action: `time_week.${data.action === 'validate' ? 'validated' : data.action === 'reject' ? 'rejected' : 'reopened'}`,
        target: { type: 'restaurant', id: data.restaurantId, label: `Semaine du ${data.weekStart}` },
        reason: data.comment ?? null,
        after: { employees: names },
        request,
      });
    }
    return { updated };
  },
  HR_CALLABLE,
);


