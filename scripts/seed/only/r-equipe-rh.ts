// Données complémentaires « Équipe & RH » (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/r-equipe-rh.ts
// - annuaire de l'équipe (staffDirectory) reconstruit depuis les fiches et les membres ;
// - checklists types (ouverture, service, fermeture) et réalisations des 7 derniers jours ;
// - documents salariés (contrats, attestations) des établissements de démonstration ;
// - bulletins de démonstration recalculés par le moteur de paie (détail des lignes
//   et des cotisations), statuts et dates conservés.
// Chaque document écrit porte `seed: true`.
import {
  DEFAULT_PAYROLL_SETTINGS,
  RESTAURANT_SETTINGS_DOCS,
  STAFF_ROLE_LABELS,
  computePayroll,
  SUBCOLLECTIONS,
  type ChecklistItem,
  type ChecklistKind,
  type ChecklistRun,
  type ChecklistTemplate,
  type Employee,
  type EmployeeDocument,
  type Absence,
  type Payslip,
  type PayrollSettings,
  type RestaurantMember,
  type TimeEntry,
  type StaffDirectoryEntry,
} from '@golink/shared';
import { bucket, db } from '../../lib/admin.mjs';
import { simplePdf } from '../files';
import { addDays, mondayOf, parisDay, parisTime, ts, weekday } from '../lib';

const PALETTE = ['#19343b', '#e8784b', '#4a846c', '#9467a5', '#4a7fbb', '#e09b24', '#31968b', '#d6533f'];
const colorFor = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!;
};

const now = new Date();
const today = parisDay(now);
const nowTs = ts(now);

function items(prefix: string, labels: Array<[string, boolean?]>): ChecklistItem[] {
  return labels.map(([label, critical], i) => ({ id: `${prefix}-${i + 1}`, label, critical: Boolean(critical) }));
}

const TEMPLATES: Array<{ id: string; name: string; kind: ChecklistKind; dueTime: string; description: string; items: ChecklistItem[] }> = [
  {
    id: 'ouverture-cuisine',
    name: 'Ouverture de la cuisine',
    kind: 'opening',
    dueTime: '10:15',
    description: 'À réaliser avant le premier service, par la première personne arrivée.',
    items: items('ouv', [
      ['Allumer la hotte et les équipements de cuisson'],
      ['Relever les températures des enceintes froides', true],
      ['Contrôler les DLC des préparations de la veille', true],
      ['Lavage des mains, tenue propre, cheveux protégés', true],
      ['Mise en place du passe et des emballages de livraison'],
      ['Ouvrir le service sur la tablette GoLink et tester le son'],
    ]),
  },
  {
    id: 'mise-en-place-soir',
    name: 'Mise en place du service du soir',
    kind: 'service',
    dueTime: '18:15',
    description: 'Préparer le coup de feu : réassort et zone de retrait des livreurs.',
    items: items('srv', [
      ['Réassort des sacs isothermes et des emballages'],
      ['Vérifier sauces, garnitures et accompagnements'],
      ['Zone de retrait livreurs propre et dégagée'],
      ['Contrôler le temps de préparation affiché dans GoLink'],
    ]),
  },
  {
    id: 'fermeture',
    name: 'Fermeture',
    kind: 'closing',
    dueTime: '23:15',
    description: 'Clôture de la journée : hygiène, sécurité et fermeture du service.',
    items: items('fer', [
      ['Filmer, dater et étiqueter les préparations', true],
      ['Nettoyer et désinfecter les plans de travail', true],
      ['Vider et nettoyer la plonge'],
      ['Sortir les poubelles et nettoyer le local'],
      ['Couper le gaz, la hotte et les équipements', true],
      ['Fermer le service GoLink et mettre la tablette en charge'],
    ]),
  },
];

async function commit(writes: Array<[FirebaseFirestore.DocumentReference, Record<string, unknown>]>): Promise<void> {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, data] of writes.slice(i, i + 400)) batch.set(ref, { ...data, seed: true });
    await batch.commit();
  }
}

const MONTHLY_CONTRACTS: readonly Employee['contractType'][] = ['cdi', 'cdd', 'apprenticeship'];

function monthDays(period: string): string[] {
  const days: string[] = [];
  for (let day = `${period}-01`; day.startsWith(period); day = addDays(day, 1)) days.push(day);
  return days;
}

/** Recalcule les bulletins de démonstration avec le moteur de paie (statuts et dates conservés). */
async function recomputePayslips(rid: string): Promise<number> {
  const base = `restaurants/${rid}`;
  const [payslipsSnap, employeesSnap, settingsSnap, absencesSnap] = await Promise.all([
    db.collection(`${base}/${SUBCOLLECTIONS.restaurants.payslips}`).where('seed', '==', true).get(),
    db.collection(`${base}/${SUBCOLLECTIONS.restaurants.employees}`).get(),
    db.doc(`${base}/${SUBCOLLECTIONS.restaurants.settings}/${RESTAURANT_SETTINGS_DOCS.payroll}`).get(),
    db.collection(`${base}/${SUBCOLLECTIONS.restaurants.absences}`).where('status', '==', 'approved').get(),
  ]);
  const settings = { ...DEFAULT_PAYROLL_SETTINGS, ...((settingsSnap.data() as Partial<PayrollSettings> | undefined) ?? {}) };
  const employees = new Map(employeesSnap.docs.map((d) => [d.id, d.data() as Employee]));
  const absences = absencesSnap.docs.map((d) => d.data() as Absence);
  let count = 0;
  for (const doc of payslipsSnap.docs) {
    const payslip = doc.data() as Payslip;
    const employee = employees.get(payslip.employeeId);
    if (!employee) continue;
    const days = monthDays(payslip.period);
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const entriesSnap = await db
      .collection(`${base}/${SUBCOLLECTIONS.restaurants.timeEntries}`)
      .where('employeeId', '==', payslip.employeeId)
      .where('date', '>=', first)
      .where('date', '<=', last)
      .get();
    const entries = entriesSnap.docs.map((d) => d.data() as TimeEntry).filter((e) => e.clockIn && e.clockOut);
    // Sans pointage sur le mois : semaines conformes au contrat.
    const weekly = new Map<string, number>();
    let workedDays = 0;
    let nightMinutes = 0;
    if (entries.length > 0) {
      for (const entry of entries) {
        weekly.set(mondayOf(entry.date), (weekly.get(mondayOf(entry.date)) ?? 0) + (entry.workedMinutes ?? 0));
        nightMinutes += entry.nightMinutes ?? 0;
        if ((entry.workedMinutes ?? 0) > 0) workedDays += 1;
      }
    } else {
      for (const day of days) if (weekday(day) === 0) weekly.set(day, Math.round(employee.weeklyHours * 60));
      workedDays = Math.round((Math.min(5, employee.weeklyHours / 7) * 52) / 12);
    }
    let paidAbsenceDays = 0;
    let unpaidAbsenceDays = 0;
    for (const absence of absences) {
      if (absence.employeeId !== payslip.employeeId || absence.endDate < first || absence.startDate > last) continue;
      const counted = days.filter((day) => day >= absence.startDate && day <= absence.endDate && weekday(day) < 5).length;
      if (['paid_leave', 'rtt', 'training', 'family_event'].includes(absence.type)) paidAbsenceDays += counted;
      else unpaidAbsenceDays += counted;
    }
    const amounts = computePayroll({
      employee: {
        hourlyRateCents: employee.hourlyRateCents,
        weeklyHours: employee.weeklyHours,
        socialCategory: employee.socialCategory,
        withholdingTaxRateBps: employee.withholdingTaxRateBps ?? null,
        monthly: MONTHLY_CONTRACTS.includes(employee.contractType) && employee.hireDate <= first && (!employee.endDate || employee.endDate >= last),
      },
      rules: settings,
      weeklyWorkedMinutes: [...weekly.values()],
      nightMinutes,
      sundayMinutes: 0,
      holidayMinutes: 0,
      workedDays,
      paidAbsenceDays,
      unpaidAbsenceDays,
      adjustments: payslip.adjustments ?? [],
    });
    await doc.ref.update({
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
      contributions: amounts.contributions.map((c) => ({ label: c.label, baseCents: c.baseCents, employeeRateBps: c.employeeRateBps, employerRateBps: c.employerRateBps })),
      lines: amounts.lines,
      workedDays,
      paidAbsenceDays,
      unpaidAbsenceDays,
      adjustments: payslip.adjustments ?? [],
      employeeSnapshot: {
        fullName: `${employee.firstName} ${employee.lastName}`,
        position: employee.position,
        contractType: employee.contractType,
        hireDate: employee.hireDate,
        classification: employee.classification ?? null,
        socialSecurityLast4: employee.socialSecurityLast4 ?? null,
        hourlyRateCents: employee.hourlyRateCents,
        weeklyHours: employee.weeklyHours,
      },
      pdf: null,
    });
    count += 1;
  }
  return count;
}

async function main(): Promise<void> {
  const restaurants = await db.collection('restaurants').select('name').get();
  let directory = 0;
  let templates = 0;
  let runs = 0;
  let documents = 0;
  let payslips = 0;

  for (const restaurant of restaurants.docs) {
    const rid = restaurant.id;
    const base = `restaurants/${rid}`;
    const [employeesSnap, membersSnap] = await Promise.all([
      db.collection(`${base}/${SUBCOLLECTIONS.restaurants.employees}`).get(),
      db.collection(`${base}/${SUBCOLLECTIONS.restaurants.members}`).get(),
    ]);
    const writes: Array<[FirebaseFirestore.DocumentReference, Record<string, unknown>]> = [];
    const dirCollection = db.collection(`${base}/${SUBCOLLECTIONS.restaurants.staffDirectory}`);

    // 1. Annuaire.
    const linkedUids = new Set<string>();
    for (const doc of employeesSnap.docs) {
      const e = doc.data() as Employee;
      if (e.uid) linkedUids.add(e.uid);
      const entry: StaffDirectoryEntry = {
        kind: 'employee',
        employeeId: doc.id,
        uid: e.uid ?? null,
        firstName: e.firstName,
        lastName: e.lastName,
        displayName: `${e.firstName} ${e.lastName}`,
        position: e.position ?? null,
        department: e.department ?? null,
        color: e.color || colorFor(doc.id),
        contractType: e.contractType,
        weeklyHours: e.weeklyHours,
        active: e.status !== 'terminated' && e.status !== 'inactive',
        updatedAt: nowTs,
      };
      writes.push([dirCollection.doc(doc.id), entry as unknown as Record<string, unknown>]);
    }
    for (const doc of membersSnap.docs) {
      const m = doc.data() as RestaurantMember;
      if (linkedUids.has(doc.id) || (m.employeeId && employeesSnap.docs.some((e) => e.id === m.employeeId))) continue;
      const [firstName = m.displayName, ...rest] = (m.displayName || 'Membre').split(' ');
      const entry: StaffDirectoryEntry = {
        kind: 'member',
        employeeId: null,
        uid: doc.id,
        firstName,
        lastName: rest.join(' '),
        displayName: m.displayName || 'Membre',
        position: STAFF_ROLE_LABELS[m.role] ?? null,
        department: null,
        color: colorFor(doc.id),
        contractType: null,
        weeklyHours: null,
        active: m.active,
        updatedAt: nowTs,
      };
      writes.push([dirCollection.doc(`m_${doc.id}`), entry as unknown as Record<string, unknown>]);
    }
    directory += writes.length;

    // 2. Checklists (établissements avec une équipe).
    if (!employeesSnap.empty) {
      const doers = employeesSnap.docs.map((d) => d.data() as Employee).filter((e) => e.uid);
      const fallback = membersSnap.docs.find((d) => (d.data() as RestaurantMember).role !== 'owner') ?? membersSnap.docs[0];
      const doer = (i: number) => {
        const e = doers[i % Math.max(doers.length, 1)];
        return e ? { uid: e.uid!, name: `${e.firstName} ${e.lastName}` } : { uid: fallback?.id ?? 'system', name: 'Équipe' };
      };
      const managerUid = fallback?.id ?? 'system';
      TEMPLATES.forEach((t, order) => {
        const template: ChecklistTemplate = {
          name: t.name,
          kind: t.kind,
          description: t.description,
          items: t.items,
          daysOfWeek: [],
          dueTime: t.dueTime,
          active: true,
          order,
          createdAt: ts(new Date(now.getTime() - 60 * 86_400_000)),
          createdBy: managerUid,
          updatedAt: nowTs,
          updatedBy: managerUid,
        };
        writes.push([db.doc(`${base}/${SUBCOLLECTIONS.restaurants.checklistTemplates}/${t.id}`), template as unknown as Record<string, unknown>]);
        templates += 1;

        for (let d = -6; d <= 0; d += 1) {
          const day = addDays(today, d);
          const [hh = 10, mm = 0] = t.dueTime.split(':').map(Number);
          const due = parisTime(day, hh * 60 + mm);
          if (d === 0 && due > now && t.kind !== 'opening') continue;
          const person = doer(d + order + 7);
          const partial = d === 0 || (d === -2 && t.kind === 'closing');
          const runItems = t.items.map((item, i) => {
            const done = !partial || i < Math.ceil(t.items.length / 2);
            return {
              ...item,
              done,
              doneBy: done ? person.uid : null,
              doneByName: done ? person.name : null,
              doneAt: done ? ts(new Date(due.getTime() - (t.items.length - i) * 3 * 60_000)) : null,
            };
          });
          const completed = runItems.every((item) => item.done);
          const run: ChecklistRun = {
            templateId: t.id,
            templateName: t.name,
            kind: t.kind,
            date: day,
            items: runItems,
            completed,
            completedAt: completed ? ts(due) : null,
            completedBy: completed ? person.uid : null,
            comment: d === -2 && t.kind === 'closing' ? 'Plonge en panne : vidange faite le lendemain matin.' : null,
            updatedAt: ts(due),
            updatedBy: person.uid,
          };
          if (weekday(day) === 6 && t.kind === 'service') continue;
          writes.push([db.doc(`${base}/${SUBCOLLECTIONS.restaurants.checklistRuns}/${t.id}_${day}`), run as unknown as Record<string, unknown>]);
          runs += 1;
        }
      });

      // 3. Documents salariés : contrat de chaque salarié, attestation HACCP pour la cuisine.
      for (const doc of employeesSnap.docs) {
        const e = doc.data() as Employee;
        const hired = e.hireDate;
        const specs: Array<{ id: string; name: string; type: EmployeeDocument['type']; expiresAt: string | null; visible: boolean }> = [
          { id: 'contrat', name: `Contrat de travail ${e.contractType.toUpperCase()}`, type: 'contract', expiresAt: e.endDate ?? null, visible: true },
        ];
        if (e.department === 'Cuisine') {
          specs.push({ id: 'formation-haccp', name: 'Attestation de formation hygiène (HACCP)', type: 'certificate', expiresAt: addDays(today, 400), visible: true });
        }
        specs.push({ id: 'visite-medicale', name: 'Visite d’information et de prévention', type: 'medical', expiresAt: addDays(today, doc.id === 'e3' ? 21 : 700), visible: false });
        for (const spec of specs) {
          const path = `restaurants/${rid}/team/employees/${doc.id}/${spec.id}.pdf`;
          const body = simplePdf(spec.name, [`Salarié : ${e.firstName} ${e.lastName}`, `Poste : ${e.position}`, `Date d’entrée : ${hired}`, `Établissement : ${restaurant.get('name')}`]);
          await bucket.file(path).save(body, { resumable: false, contentType: 'application/pdf', metadata: { metadata: { seed: 'true' } } });
          const at = ts(parisTime(hired, 10 * 60));
          const document: EmployeeDocument = {
            employeeId: doc.id,
            employeeUid: e.uid ?? null,
            name: spec.name,
            type: spec.type,
            file: { path, url: null, contentType: 'application/pdf', size: body.length, name: `${spec.id}.pdf`, uploadedAt: at, uploadedBy: managerUid },
            expiresAt: spec.expiresAt,
            visibleToEmployee: spec.visible,
            createdAt: at,
            createdBy: managerUid,
            updatedAt: at,
            updatedBy: managerUid,
          };
          writes.push([db.doc(`${base}/${SUBCOLLECTIONS.restaurants.employeeDocuments}/${doc.id}_${spec.id}`), document as unknown as Record<string, unknown>]);
          documents += 1;
        }
      }
    }

    await commit(writes);
    payslips += await recomputePayslips(rid);
  }
  console.log(`Équipe & RH : ${directory} entrées d’annuaire, ${templates} checklists, ${runs} réalisations, ${documents} documents salariés, ${payslips} bulletins recalculés.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
