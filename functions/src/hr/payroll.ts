// Paie : calcul des bulletins d'un mois (pointages, absences, réglages HCR),
// primes et retenues, validation, envoi aux salariés et bulletin PDF.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  computePayroll as computePayslipAmounts,
  memberHasPermission,
  type Absence,
  type AbsenceType,
  type Employee,
  type Payslip,
  type PayslipAdjustment,
  type Restaurant,
  type RestaurantLegal,
  type StoredFile,
  type TimeEntry,
} from '@golink/shared';
import { db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { sendEmail } from '../lib/brevo';
import { renderEmail } from '../lib/email-layout';
import { fail } from '../lib/errors';
import { loadMember, requireAuth, requireRestaurantAccess } from '../lib/permissions';
import { EMAIL_SECRETS } from '../lib/secrets';
import { z, zId } from '../lib/validation';
import { countAbsenceDays } from './absences';
import { HR_CALLABLE, fullName, isDeliverableEmail, loadEmployee, loadPayrollSettings, notifyUser, sub } from './common';
import { renderPayslipPdf } from './payslip-pdf';
import { formatMonth, isHoliday, mondayOf, monthBounds, weekdayOf } from './time';
import { APP_URLS } from '../lib/config';

const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Période invalide (AAAA-MM)');
const PAID_ABSENCES: readonly AbsenceType[] = ['paid_leave', 'rtt', 'training', 'family_event'];
const MONTHLY_CONTRACTS: readonly Employee['contractType'][] = ['cdi', 'cdd', 'apprenticeship'];

type PayslipWrite = Omit<Payslip, 'generatedAt' | 'validatedAt' | 'sentAt'> & {
  generatedAt: FieldValue;
  validatedAt: null;
  sentAt: null;
};

/** Calcule le bulletin d'un salarié pour un mois, à partir des données en base. */
async function buildPayslip(
  restaurantId: string,
  employeeId: string,
  employee: Employee,
  period: string,
  adjustments: PayslipAdjustment[],
): Promise<{ payslip: PayslipWrite; openEntries: number; unvalidatedEntries: number }> {
  const settings = await loadPayrollSettings(restaurantId);
  const { first, last } = monthBounds(period);

  const entriesSnap = await sub(restaurantId, 'timeEntries').where('employeeId', '==', employeeId).where('date', '>=', first).where('date', '<=', last).get();
  const entries = entriesSnap.docs.map((doc) => doc.data() as TimeEntry);
  const closed = entries.filter((entry) => entry.clockIn && entry.clockOut);
  const weekly = new Map<string, number>();
  let nightMinutes = 0;
  let sundayMinutes = 0;
  let holidayMinutes = 0;
  let workedDays = 0;
  for (const entry of closed) {
    const minutes = entry.workedMinutes ?? 0;
    weekly.set(mondayOf(entry.date), (weekly.get(mondayOf(entry.date)) ?? 0) + minutes);
    nightMinutes += entry.nightMinutes ?? 0;
    if (weekdayOf(entry.date) === 6) sundayMinutes += minutes;
    if (isHoliday(entry.date)) holidayMinutes += minutes;
    if (minutes > 0) workedDays += 1;
  }

  const absencesSnap = await sub(restaurantId, 'absences').where('employeeId', '==', employeeId).where('startDate', '<=', last).get();
  let paidAbsenceDays = 0;
  let unpaidAbsenceDays = 0;
  for (const doc of absencesSnap.docs) {
    const absence = doc.data() as Absence;
    if (absence.status !== 'approved' || absence.endDate < first) continue;
    const days = countAbsenceDays(
      {
        startDate: absence.startDate < first ? first : absence.startDate,
        endDate: absence.endDate > last ? last : absence.endDate,
        halfDayStart: absence.startDate >= first && absence.halfDayStart,
        halfDayEnd: absence.endDate <= last && absence.halfDayEnd,
      },
      settings.paidLeaveDaysPerYear <= 25,
    );
    if (PAID_ABSENCES.includes(absence.type)) paidAbsenceDays += days;
    else unpaidAbsenceDays += days;
  }

  const amounts = computePayslipAmounts({
    employee: {
      hourlyRateCents: employee.hourlyRateCents,
      weeklyHours: employee.weeklyHours,
      socialCategory: employee.socialCategory,
      withholdingTaxRateBps: employee.withholdingTaxRateBps ?? null,
      // Mensualisation des contrats de travail sur un mois complet ; extras, stages,
      // intérim et mois d'entrée ou de sortie : paiement des heures pointées.
      monthly: MONTHLY_CONTRACTS.includes(employee.contractType) && employee.hireDate <= first && (!employee.endDate || employee.endDate >= last),
    },
    rules: settings,
    weeklyWorkedMinutes: [...weekly.values()],
    nightMinutes,
    sundayMinutes,
    holidayMinutes,
    workedDays,
    paidAbsenceDays,
    unpaidAbsenceDays,
    adjustments,
  });

  const payslip: PayslipWrite = {
    employeeId,
    employeeUid: employee.uid ?? null,
    period,
    status: 'generated',
    hours: amounts.hours,
    grossCents: amounts.grossCents,
    bonusCents: amounts.bonusCents,
    mealAllowanceCents: amounts.mealAllowanceCents,
    deductionsCents: amounts.deductionsCents,
    employeeContributionsCents: amounts.employeeContributionsCents,
    employerContributionsCents: amounts.employerContributionsCents,
    taxableNetCents: amounts.taxableNetCents,
    withholdingTaxCents: amounts.withholdingTaxCents,
    netCents: amounts.netCents,
    contributions: amounts.contributions.map((c) => ({
      label: c.label,
      baseCents: c.baseCents,
      employeeRateBps: c.employeeRateBps,
      employerRateBps: c.employerRateBps,
    })),
    lines: amounts.lines,
    workedDays,
    paidAbsenceDays,
    unpaidAbsenceDays,
    adjustments,
    employeeSnapshot: {
      fullName: fullName(employee),
      position: employee.position,
      contractType: employee.contractType,
      hireDate: employee.hireDate,
      classification: employee.classification ?? null,
      socialSecurityLast4: employee.socialSecurityLast4 ?? null,
      hourlyRateCents: employee.hourlyRateCents,
      weeklyHours: employee.weeklyHours,
    },
    pdf: null,
    generatedAt: FieldValue.serverTimestamp(),
    validatedAt: null,
    validatedBy: null,
    sentAt: null,
  };
  return {
    payslip,
    openEntries: entries.length - closed.length,
    unvalidatedEntries: closed.filter((entry) => entry.status !== 'validated').length,
  };
}

// ---------------------------------------------------------------------------
// Calcul du mois
// ---------------------------------------------------------------------------

export const computePayroll = callable(
  z.object({
    restaurantId: zId,
    period: zPeriod,
    /** Salariés à calculer (vide : tous les salariés actifs ou en congé). */
    employeeIds: z.array(zId).max(200).optional(),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'payroll.manage');
    const { first, last } = monthBounds(data.period);
    const employeesSnap = await sub(data.restaurantId, 'employees').get();
    const wanted = data.employeeIds && data.employeeIds.length > 0 ? new Set(data.employeeIds) : null;
    const employees = employeesSnap.docs
      .map((doc) => ({ id: doc.id, employee: doc.data() as Employee }))
      .filter(({ id, employee }) => {
        if (wanted) return wanted.has(id);
        if (employee.hireDate > last) return false;
        if (employee.endDate && employee.endDate < first) return false;
        return employee.status !== 'terminated' || (employee.endDate ?? '') >= first;
      });
    if (employees.length === 0) throw fail.precondition('Aucun salarié à rémunérer sur cette période.');

    let computed = 0;
    let skipped = 0;
    let openEntries = 0;
    let unvalidatedEntries = 0;
    let grossCents = 0;
    let netCents = 0;
    let employerCostCents = 0;
    for (const { id, employee } of employees) {
      const ref = sub(data.restaurantId, 'payslips').doc(`${id}_${data.period}`);
      const existing = await ref.get();
      const current = existing.exists ? (existing.data() as Payslip) : null;
      if (current && (current.status === 'validated' || current.status === 'sent')) {
        skipped += 1;
        continue;
      }
      const result = await buildPayslip(data.restaurantId, id, employee, data.period, current?.adjustments ?? []);
      await ref.set(result.payslip);
      computed += 1;
      openEntries += result.openEntries;
      unvalidatedEntries += result.unvalidatedEntries;
      grossCents += result.payslip.grossCents;
      netCents += result.payslip.netCents;
      employerCostCents += result.payslip.grossCents + result.payslip.employerContributionsCents;
    }

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'payroll.computed',
      target: { type: 'restaurant', id: data.restaurantId, label: `Paie ${formatMonth(data.period)}` },
      after: { computed, skipped, grossCents, netCents },
      request,
    });
    return { computed, skipped, openEntries, unvalidatedEntries, grossCents, netCents, employerCostCents };
  },
  HR_CALLABLE,
);

// ---------------------------------------------------------------------------
// Primes et retenues
// ---------------------------------------------------------------------------

export const savePayslipAdjustments = callable(
  z.object({
    restaurantId: zId,
    payslipId: zId,
    adjustments: z
      .array(
        z.object({
          label: z.string().trim().min(2).max(80),
          amountCents: z.number().int().min(1).max(10_000_00),
          kind: z.enum(['bonus', 'deduction']),
        }),
      )
      .max(12),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'payroll.manage');
    const ref = sub(data.restaurantId, 'payslips').doc(data.payslipId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Bulletin');
    const current = snap.data() as Payslip;
    if (current.status === 'validated' || current.status === 'sent') throw fail.precondition('Ce bulletin est validé : repassez-le en brouillon pour le modifier.');
    const employee = await loadEmployee(data.restaurantId, current.employeeId);
    const result = await buildPayslip(data.restaurantId, current.employeeId, employee, current.period, data.adjustments);
    await ref.set(result.payslip);
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'payslip.adjusted',
      target: { type: 'restaurant', id: data.restaurantId, label: `${fullName(employee)} · ${current.period}` },
      before: { adjustments: current.adjustments ?? [] },
      after: { adjustments: data.adjustments, netCents: result.payslip.netCents },
      request,
    });
    return { netCents: result.payslip.netCents, grossCents: result.payslip.grossCents };
  },
  HR_CALLABLE,
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const setPayslipStatus = callable(
  z.object({
    restaurantId: zId,
    payslipIds: z.array(zId).min(1).max(200),
    status: z.enum(['validated', 'generated']),
  }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'payroll.manage');
    let updated = 0;
    const batch = db.batch();
    for (const id of data.payslipIds) {
      const ref = sub(data.restaurantId, 'payslips').doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const payslip = snap.data() as Payslip;
      if (payslip.status === 'sent') continue;
      if (payslip.status === data.status) continue;
      batch.update(ref, {
        status: data.status,
        validatedAt: data.status === 'validated' ? FieldValue.serverTimestamp() : null,
        validatedBy: data.status === 'validated' ? actor.caller.uid : null,
        pdf: null,
      });
      updated += 1;
    }
    if (updated === 0) throw fail.precondition('Aucun bulletin à mettre à jour (les bulletins envoyés ne sont plus modifiables).');
    await batch.commit();
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: data.status === 'validated' ? 'payslip.validated' : 'payslip.reopened',
      target: { type: 'restaurant', id: data.restaurantId, label: `${updated} bulletin(s)` },
      after: { payslipIds: data.payslipIds },
      request,
    });
    return { updated };
  },
  HR_CALLABLE,
);

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

async function renderAndStore(restaurantId: string, payslipId: string, payslip: Payslip, by: string, store: boolean): Promise<{ buffer: Buffer; file: StoredFile | null }> {
  const [restaurantSnap, legalSnap, settings] = await Promise.all([
    db.collection(COLLECTIONS.restaurants).doc(restaurantId).get(),
    db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal).get(),
    loadPayrollSettings(restaurantId),
  ]);
  const restaurant = restaurantSnap.data() as Restaurant | undefined;
  const legal = legalSnap.data() as RestaurantLegal | undefined;
  const [year, month] = payslip.period.split('-').map(Number) as [number, number];
  const nextMonth = new Date(Date.UTC(year, month, Math.min(settings.payDay, 28))).toISOString().slice(0, 10);
  const buffer = renderPayslipPdf({
    payslip,
    employer: {
      name: restaurant?.name ?? 'Établissement',
      legalName: legal?.legalName ?? null,
      siret: legal?.siret ?? null,
      nafCode: settings.nafCode ?? null,
      address: legal?.registeredAddress ?? restaurant?.address ?? null,
      collectiveAgreement: settings.collectiveAgreement,
    },
    employeeFallbackName: payslip.employeeId,
    payDate: nextMonth,
  });
  if (!store) return { buffer, file: null };
  const path = `restaurants/${restaurantId}/payroll/${payslip.period}/${payslipId}.pdf`;
  await storage.bucket().file(path).save(buffer, { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'private, max-age=0' } });
  const file: StoredFile = {
    path,
    url: null,
    contentType: 'application/pdf',
    size: buffer.length,
    name: `bulletin-${payslip.period}.pdf`,
    uploadedAt: Timestamp.now(),
    uploadedBy: by,
  };
  await sub(restaurantId, 'payslips').doc(payslipId).update({ pdf: file });
  return { buffer, file };
}

/**
 * Bulletin PDF : le gestionnaire de paie le (re)génère ; le salarié télécharge
 * son propre bulletin une fois validé. Renvoie le fichier encodé en base64.
 */
export const generatePayslipPdf = callable(
  z.object({ restaurantId: zId, payslipId: zId }),
  async (data, request) => {
    const caller = requireAuth(request);
    const member = await loadMember(data.restaurantId, caller.uid);
    if (!member?.active) throw fail.forbidden();
    const snap = await sub(data.restaurantId, 'payslips').doc(data.payslipId).get();
    if (!snap.exists) throw fail.notFound('Bulletin');
    const payslip = snap.data() as Payslip;
    const manager = memberHasPermission(member, 'payroll.view');
    const own = payslip.employeeUid === caller.uid && (payslip.status === 'validated' || payslip.status === 'sent');
    if (!manager && !own) throw fail.forbidden();

    let buffer: Buffer | null = null;
    if (payslip.pdf?.path) {
      const [exists] = await storage.bucket().file(payslip.pdf.path).exists();
      if (exists) [buffer] = await storage.bucket().file(payslip.pdf.path).download();
    }
    if (!buffer) {
      const store = payslip.status === 'validated' || payslip.status === 'sent';
      buffer = (await renderAndStore(data.restaurantId, data.payslipId, payslip, caller.uid, store)).buffer;
    }
    const name = (payslip.employeeSnapshot?.fullName ?? payslip.employeeId).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-');
    return { fileName: `bulletin-${payslip.period}-${name}.pdf`, base64: buffer.toString('base64') };
  },
  HR_CALLABLE,
);

// ---------------------------------------------------------------------------
// Envoi aux salariés
// ---------------------------------------------------------------------------

export const sendPayslips = callable(
  z.object({ restaurantId: zId, payslipIds: z.array(zId).min(1).max(200) }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'payroll.manage');
    const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get()).data() as Restaurant | undefined;
    let sent = 0;
    let emailed = 0;
    const skipped: string[] = [];
    for (const id of data.payslipIds) {
      const ref = sub(data.restaurantId, 'payslips').doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const payslip = snap.data() as Payslip;
      if (payslip.status !== 'validated') {
        skipped.push(payslip.employeeSnapshot?.fullName ?? payslip.employeeId);
        continue;
      }
      await renderAndStore(data.restaurantId, id, payslip, actor.caller.uid, true);
      await ref.update({ status: 'sent', sentAt: FieldValue.serverTimestamp() });
      sent += 1;
      const month = formatMonth(payslip.period);
      await notifyUser(payslip.employeeUid, 'Votre bulletin de paie est disponible', `Bulletin de ${month.toLowerCase()} : net à payer ${(payslip.netCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}.`, '/equipe/paie');

      const employee = await loadEmployee(data.restaurantId, payslip.employeeId).catch(() => null);
      if (employee && isDeliverableEmail(employee.email)) {
        const message = renderEmail({
          preheader: `Votre bulletin de ${month.toLowerCase()} est disponible.`,
          eyebrow: 'Paie',
          title: 'Votre bulletin de paie est disponible',
          paragraphs: [
            `Bonjour ${employee.firstName},`,
            `Votre bulletin de paie de ${month.toLowerCase()} établi par ${restaurant?.name ?? 'votre établissement'} est disponible dans votre espace Ciyou Eats.`,
          ],
          details: [
            { label: 'Période', value: month },
            { label: 'Net à payer', value: (payslip.netCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) },
          ],
          cta: { label: 'Consulter mon bulletin', url: `${APP_URLS.restaurant}/equipe/paie` },
          footerReason: `Vous recevez cet e-mail car ${restaurant?.name ?? 'votre employeur'} gère votre paie avec Ciyou Eats.`,
        });
        const result = await sendEmail({
          to: { email: employee.email, name: fullName(employee) },
          message: { ...message, subject: `Bulletin de paie de ${month.toLowerCase()}` },
          recipientType: 'restaurant',
          recipientId: employee.uid ?? payslip.employeeId,
          templateKey: 'payslip_available',
        });
        if (result.ok) emailed += 1;
      }
    }
    if (sent === 0) throw fail.precondition('Seuls les bulletins validés peuvent être envoyés.');
    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'payslip.sent',
      target: { type: 'restaurant', id: data.restaurantId, label: `${sent} bulletin(s)` },
      after: { sent, emailed, skipped },
      request,
    });
    return { sent, emailed, skipped };
  },
  { ...HR_CALLABLE, secrets: EMAIL_SECRETS },
);


