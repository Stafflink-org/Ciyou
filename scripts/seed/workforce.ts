// Gestion d'entreprise de trois établissements : équipe, planning, pointages,
// validations hebdomadaires, absences, paie, tâches, documents et HACCP.
import {
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type Absence,
  type CompanyDocument,
  type ContractType,
  type Employee,
  type EmployeeAvailability,
  type HaccpCleaningLog,
  type HaccpCleaningTask,
  type HaccpEquipment,
  type HaccpNonConformity,
  type HaccpReception,
  type HaccpSettings,
  type HaccpTemperatureLog,
  type PayrollSettings,
  type Payslip,
  type Shift,
  type ShiftChangeRequest,
  type ShiftTemplate,
  type Task,
  type TaskComment,
  type TaskTemplate,
  type TimeEntry,
  type WeekValidation,
} from '@golink/shared';
import { account } from './accounts';
import { tracked, type SeedContext } from './context';
import { addDays, minutesAfter, mondayOf, parisTime, ts, weekday } from './lib';

interface StaffSeed {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  contract: ContractType;
  weeklyHours: number;
  hourlyRateCents: number;
  uid?: string;
  color: string;
}

const TEAMS: Record<string, StaffSeed[]> = {
  'mina-kitchen': [
    { id: 'e1', firstName: 'Sofia', lastName: 'Martin', position: 'Manager', contract: 'cdi', weeklyHours: 39, hourlyRateCents: 1650, uid: account('manager').uid, color: '#19343b' },
    { id: 'e2', firstName: 'Youssef', lastName: 'Karim', position: 'Cuisinier', contract: 'cdi', weeklyHours: 35, hourlyRateCents: 1420, uid: account('employee').uid, color: '#e8784b' },
    { id: 'e3', firstName: 'Inès', lastName: 'Morel', position: 'Serveuse', contract: 'cdd', weeklyHours: 30, hourlyRateCents: 1212, uid: 'seed-staff-mina-service', color: '#6e9d8b' },
    { id: 'e4', firstName: 'Rami', lastName: 'Aziz', position: 'Commis de cuisine', contract: 'apprenticeship', weeklyHours: 35, hourlyRateCents: 900, color: '#9b85ba' },
    { id: 'e5', firstName: 'Léna', lastName: 'Fischer', position: 'Plonge', contract: 'extra', weeklyHours: 16, hourlyRateCents: 1212, color: '#c39d6b' },
    { id: 'e6', firstName: 'Omar', lastName: 'Belkacem', position: 'Second de cuisine', contract: 'cdi', weeklyHours: 39, hourlyRateCents: 1540, color: '#577b90' },
  ],
  'onda-pasta-club': [
    { id: 'e1', firstName: 'Giulia', lastName: 'Rossi', position: 'Cheffe', contract: 'cdi', weeklyHours: 39, hourlyRateCents: 1700, color: '#e2b84d' },
    { id: 'e2', firstName: 'Matteo', lastName: 'Colin', position: 'Cuisinier', contract: 'cdi', weeklyHours: 35, hourlyRateCents: 1400, color: '#19343b' },
    { id: 'e3', firstName: 'Clara', lastName: 'Weber', position: 'Serveuse', contract: 'cdd', weeklyHours: 24, hourlyRateCents: 1212, color: '#d58f9d' },
    { id: 'e4', firstName: 'Hugo', lastName: 'Lambert', position: 'Commis', contract: 'cdi', weeklyHours: 35, hourlyRateCents: 1250, color: '#6e9d8b' },
  ],
  'kumo-ramen': [
    { id: 'e1', firstName: 'Kenji', lastName: 'Morel', position: 'Chef propriétaire', contract: 'cdi', weeklyHours: 40, hourlyRateCents: 2200, color: '#6e9d8b' },
    { id: 'e2', firstName: 'Sara', lastName: 'Pereira', position: 'Cuisinière', contract: 'cdi', weeklyHours: 40, hourlyRateCents: 1650, color: '#e8784b' },
    { id: 'e3', firstName: 'Tom', lastName: 'Hoffmann', position: 'Service', contract: 'cdd', weeklyHours: 30, hourlyRateCents: 1500, color: '#577b90' },
    { id: 'e4', firstName: 'Ana', lastName: 'Ferreira', position: 'Plonge', contract: 'cdi', weeklyHours: 30, hourlyRateCents: 1450, color: '#9b85ba' },
  ],
};

const SLOTS = [
  { start: '10:30', end: '15:00', minutes: 270 },
  { start: '17:30', end: '23:00', minutes: 330 },
  { start: '10:30', end: '23:00', minutes: 630 },
];

export function seedWorkforce(ctx: SeedContext): { employees: number; shifts: number } {
  const { w, rng, nowTs } = ctx;
  let employeesCount = 0;
  let shiftsCount = 0;
  for (const [rid, team] of Object.entries(TEAMS)) {
    const base = `restaurants/${rid}`;
    const sub = (name: keyof typeof SUBCOLLECTIONS.restaurants, id: string) => w.doc(`${base}/${SUBCOLLECTIONS.restaurants[name]}/${id}`);
    const managerUid = rid === 'mina-kitchen' ? account('manager').uid : rid === 'onda-pasta-club' ? account('owner').uid : `seed-owner-${rid}`;
    const since = ts(parisTime(addDays(ctx.today, -110), 9 * 60));

    for (const e of team) {
      const employee: Employee = {
        uid: e.uid ?? null,
        firstName: e.firstName,
        lastName: e.lastName,
        email: `${e.firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${e.lastName.toLowerCase()}@${rid}.test`,
        phone: `+33 6 ${rng.digits(2)} ${rng.digits(2)} ${rng.digits(2)} ${rng.digits(2)}`,
        position: e.position,
        department: /cuisin|chef|commis|plonge|second/i.test(e.position) ? 'Cuisine' : e.position === 'Manager' ? 'Direction' : 'Salle',
        contractType: e.contract,
        status: rid === 'onda-pasta-club' && e.id === 'e3' ? 'on_leave' : 'active',
        hireDate: addDays(ctx.today, -rng.int(120, 900)),
        endDate: e.contract === 'cdd' ? addDays(ctx.today, rng.int(40, 160)) : null,
        weeklyHours: e.weeklyHours,
        hourlyRateCents: e.hourlyRateCents,
        classification: 'HCR niveau II, échelon 2',
        coefficient: null,
        socialCategory: e.position.includes('Manager') || e.position.startsWith('Chef') ? 'supervisor' : 'employee',
        socialSecurityLast4: rng.digits(4),
        withholdingTaxRateBps: rng.pick([0, 150, 380, 720]),
        paidLeaveBalanceDays: Math.round(rng.float(3, 22) * 10) / 10,
        rttBalanceDays: 0,
        color: e.color,
        clockPinHash: null,
        ...tracked(since, managerUid),
      };
      w.set(sub('employees', e.id), employee);
      employeesCount += 1;
    }

    // Planning : 14 jours passés, 14 jours à venir.
    const templates: ShiftTemplate = {
      name: 'Semaine type',
      description: 'Deux équipes : midi et soir, renfort le week-end.',
      active: true,
      slots: [
        { dayOfWeek: null, startTime: '10:30', endTime: '15:00', breakMinutes: 20, position: 'Midi' },
        { dayOfWeek: null, startTime: '17:30', endTime: '23:00', breakMinutes: 20, position: 'Soir' },
      ],
      ...tracked(since, managerUid),
    };
    w.set(sub('shiftTemplates', 'semaine-type'), templates);

    for (let offset = -14; offset <= 13; offset += 1) {
      const day = addDays(ctx.today, offset);
      if (weekday(day) === 6) continue;
      team.forEach((e, i) => {
        if ((i + offset + 20) % 5 === 4 && e.weeklyHours < 39) return;
        const slot = SLOTS[e.weeklyHours >= 39 && weekday(day) >= 4 ? 2 : (i + offset + 20) % 2] ?? SLOTS[0]!;
        const shiftId = `${e.id}_${day}`;
        const shift: Shift = {
          employeeId: e.id,
          employeeUid: e.uid ?? null,
          date: day,
          startTime: slot.start,
          endTime: slot.end,
          breakMinutes: 20,
          position: /cuisin|chef|commis|second/i.test(e.position) ? 'Cuisine' : 'Salle',
          notes: null,
          published: offset <= 7,
          templateId: 'semaine-type',
          ...tracked(since, managerUid),
        };
        w.set(sub('shifts', shiftId), shift);
        shiftsCount += 1;

        // Pointage des jours passés.
        if (offset < 0 || (offset === 0 && ctx.now > parisTime(day, 16 * 60))) {
          const [sh = 10, sm = 0] = slot.start.split(':').map(Number);
          const clockIn = parisTime(day, sh * 60 + sm + rng.int(-6, 9));
          const worked = slot.minutes - 20 + rng.int(-10, 25);
          const clockOut = minutesAfter(clockIn, worked + 20);
          const status: TimeEntry['status'] = offset < -7 ? 'validated' : offset === -1 && i === 1 ? 'corrected' : 'pending';
          const entry: TimeEntry = {
            employeeId: e.id,
            employeeUid: e.uid ?? null,
            date: day,
            clockIn: { at: ts(clockIn), location: null, accuracyMeters: null, source: 'tablet' },
            clockOut: offset === 0 && ctx.now < clockOut ? null : { at: ts(clockOut), location: null, accuracyMeters: null, source: 'tablet' },
            breaks: [{ start: ts(minutesAfter(clockIn, 150)), end: ts(minutesAfter(clockIn, 170)) }],
            workedMinutes: worked,
            overtimeMinutes: Math.max(0, worked - slot.minutes + 20),
            nightMinutes: slot.end === '23:00' ? 60 : 0,
            status,
            shiftId,
            notes: status === 'corrected' ? 'Oubli de pointage à la sortie, corrigé par la manager.' : null,
            modifiedBy: status === 'corrected' ? managerUid : null,
            updatedAt: ts(clockOut),
            createdAt: ts(clockIn),
          };
          w.set(sub('timeEntries', shiftId), entry);
          if (status === 'corrected') {
            w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.timeEntries}/${shiftId}/${SUBCOLLECTIONS.timeEntries.history}/h1`), {
              field: 'clockOut', oldValue: null, newValue: slot.end, changedBy: managerUid, changedAt: nowTs, reason: 'Oubli de pointage',
            });
          }
        }
      });
    }

    // Validations hebdomadaires des deux dernières semaines.
    for (const weeksAgo of [1, 2]) {
      const weekStart = addDays(mondayOf(ctx.today), -7 * weeksAgo);
      for (const e of team) {
        const worked = e.weeklyHours * 60 + rng.int(-90, 180);
        const validation: WeekValidation = {
          employeeId: e.id,
          employeeUid: e.uid ?? null,
          weekStart,
          weekEnd: addDays(weekStart, 6),
          workedMinutes: worked,
          overtimeMinutes: Math.max(0, worked - e.weeklyHours * 60),
          status: weeksAgo === 2 ? 'manager_validated' : e.id === 'e1' ? 'employee_validated' : 'pending',
          employeeComment: null,
          managerComment: null,
          validatedBy: weeksAgo === 2 ? managerUid : null,
          validatedAt: weeksAgo === 2 ? ts(parisTime(addDays(weekStart, 8), 10 * 60)) : null,
          updatedAt: nowTs,
        };
        w.set(sub('weekValidations', `${e.id}_${weekStart}`), validation);
      }
    }

    // Disponibilités de la semaine prochaine et demande de modification.
    const nextMonday = addDays(mondayOf(ctx.today), 7);
    for (const e of team.slice(1, 3)) {
      for (let d = 0; d < 6; d += 1) {
        const availability: EmployeeAvailability = {
          employeeId: e.id, employeeUid: e.uid ?? null, date: addDays(nextMonday, d),
          morning: rng.chance(0.7), afternoon: rng.chance(0.5), evening: rng.chance(0.8), locked: false, updatedAt: nowTs,
        };
        w.set(sub('availabilities', `${e.id}_${addDays(nextMonday, d)}`), availability);
      }
    }
    const change: ShiftChangeRequest = {
      employeeId: team[1]?.id ?? 'e2',
      employeeUid: team[1]?.uid ?? null,
      shiftId: `${team[1]?.id ?? 'e2'}_${addDays(ctx.today, 3)}`,
      date: addDays(ctx.today, 3),
      startTime: '17:30',
      endTime: '23:00',
      note: 'Rendez-vous médical le midi, je peux faire le soir à la place.',
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      ...tracked(nowTs, team[1]?.uid ?? null),
    };
    w.set(sub('shiftChangeRequests', 'demande-1'), change);

    // Absences.
    const absences: Array<[string, Absence['type'], number, number, Absence['status']]> = [
      ['e3', 'paid_leave', 10, 14, 'approved'],
      ['e2', 'sick', -9, -8, 'approved'],
      ['e4', 'paid_leave', 20, 26, 'pending'],
      ['e1', 'training', 5, 5, 'approved'],
    ];
    absences.forEach(([eid, type, from, to, status], i) => {
      const e = team.find((x) => x.id === eid);
      if (!e) return;
      const absence: Absence = {
        employeeId: eid,
        employeeUid: e.uid ?? null,
        type,
        startDate: addDays(ctx.today, from),
        endDate: addDays(ctx.today, to),
        halfDayStart: false,
        halfDayEnd: false,
        durationDays: to - from + 1,
        reason: type === 'training' ? 'Formation hygiène alimentaire (HACCP)' : null,
        attachment: null,
        status,
        approvedBy: status === 'approved' ? managerUid : null,
        approvedAt: status === 'approved' ? nowTs : null,
        rejectionReason: null,
        ...tracked(ts(parisTime(addDays(ctx.today, Math.min(from, 0) - 5), 10 * 60)), e.uid ?? managerUid),
      };
      w.set(sub('absences', `absence-${i + 1}`), absence);
    });

    // Paie : réglages HCR et bulletins des deux derniers mois.
    const payroll: PayrollSettings = {
      country: 'FR',
      collectiveAgreement: 'HCR (IDCC 1979)',
      nafCode: '5610A',
      weeklyLegalHours: 39,
      applyHcrOvertime: true,
      overtimeRatesBps: { first: 1000, second: 2000, beyond: 5000 },
      nightWindow: { from: '22:00', to: '07:00' },
      nightBonusBps: 1000,
      sundayBonusBps: 0,
      holidayBonusBps: 10000,
      mealAllowance: { enabled: true, mealsPerDay: 1, rateCents: 427 },
      healthInsurance: { monthlyCents: 4200, employerShareBps: 5000 },
      accidentRateBps: 230,
      payDay: 5,
      paidLeaveDaysPerYear: 25,
      updatedAt: nowTs,
      updatedBy: managerUid,
    };
    w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.settings}/${RESTAURANT_SETTINGS_DOCS.payroll}`), payroll);
    const thisMonth = ctx.today.slice(0, 7);
    const months = [1, 2].map((back) => {
      const [y, m] = thisMonth.split('-').map(Number) as [number, number];
      const date = new Date(Date.UTC(y, m - 1 - back, 1));
      return date.toISOString().slice(0, 7);
    });
    for (const [mi, period] of months.entries()) {
      for (const e of team) {
        const hours = Math.round((e.weeklyHours * 52) / 12);
        const gross = hours * e.hourlyRateCents + (e.weeklyHours > 35 ? 4 * 4 * Math.round(e.hourlyRateCents * 1.1) : 0);
        const employeeContrib = Math.round(gross * 0.22);
        const employerContrib = Math.round(gross * 0.3);
        const taxable = gross - employeeContrib + Math.round(gross * 0.02);
        const withholding = Math.round(taxable * 0.02);
        const payslip: Payslip = {
          employeeId: e.id,
          employeeUid: e.uid ?? null,
          period,
          status: mi === 0 ? 'validated' : 'sent',
          hours: { regular: hours, overtime10: e.weeklyHours > 35 ? 16 : 0, overtime20: 0, overtime50: 0, night: 8, sunday: 0, holiday: 0 },
          grossCents: gross,
          bonusCents: 0,
          mealAllowanceCents: 22 * 427,
          deductionsCents: 0,
          employeeContributionsCents: employeeContrib,
          employerContributionsCents: employerContrib,
          taxableNetCents: taxable,
          withholdingTaxCents: withholding,
          netCents: gross - employeeContrib - withholding,
          contributions: [
            { label: 'Sécurité sociale maladie', baseCents: gross, employeeRateBps: 0, employerRateBps: 700 },
            { label: 'Retraite complémentaire', baseCents: gross, employeeRateBps: 401, employerRateBps: 601 },
            { label: 'Assurance chômage', baseCents: gross, employeeRateBps: 0, employerRateBps: 405 },
          ],
          pdf: null,
          generatedAt: ts(parisTime(`${period}-28`, 9 * 60)),
          validatedAt: ts(parisTime(`${period}-28`, 15 * 60)),
          validatedBy: managerUid,
          sentAt: mi === 0 ? null : ts(parisTime(addDays(`${period}-28`, 8), 9 * 60)),
        };
        w.set(sub('payslips', `${e.id}_${period}`), payslip);
      }
    }

    // Tâches.
    const assignee = (i: number) => team[i]?.uid ?? managerUid;
    const tasks: Array<[string, Task['priority'], Task['status'], number, number[], string[]]> = [
      ['Inventaire de la chambre froide', 'high', 'in_progress', 1, [1, 5], ['stock']],
      ['Mettre à jour les allergènes de la carte d’automne', 'urgent', 'todo', 3, [0], ['carte', 'conformité']],
      ['Commander les emballages isothermes', 'medium', 'todo', 5, [0], ['achats']],
      ['Former Rami à la découpe', 'medium', 'review', 7, [5, 3], ['formation']],
      ['Nettoyage approfondi de la hotte', 'high', 'done', -3, [1, 4], ['hygiène']],
      ['Photos des nouveaux plats pour l’app', 'low', 'todo', 12, [0, 2], ['marketing']],
    ];
    tasks.forEach(([title, priority, status, due, who, tags], i) => {
      const ids = [...new Set(who.map(assignee))];
      const task: Task = {
        title,
        description: null,
        priority,
        status,
        dueDate: addDays(ctx.today, due),
        tags,
        assigneeIds: ids,
        assigneeStatus: Object.fromEntries(ids.map((id) => [id, status])),
        templateId: null,
        recurrence: title.startsWith('Nettoyage') ? { frequency: 'monthly', until: null } : null,
        ...tracked(ts(parisTime(addDays(ctx.today, -10 + i), 9 * 60)), managerUid),
      };
      w.set(sub('tasks', `tache-${i + 1}`), task);
      if (i === 0) {
        const comment: TaskComment = { authorId: assignee(1), authorName: `${team[1]?.firstName} ${team[1]?.lastName}`, body: 'Commencé ce matin, il reste les produits laitiers.', createdAt: nowTs };
        w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.tasks}/tache-1/${SUBCOLLECTIONS.tasks.comments}/c1`), comment);
      }
    });
    const taskTemplate: TaskTemplate = { title: 'Contrôle des dates limites', description: 'Vérifier les DLC en chambre froide et retirer les produits périmés.', priority: 'high', tags: ['hygiène'], dueOffsetDays: 0, active: true, ...tracked(since, managerUid) };
    w.set(sub('taskTemplates', 'controle-dlc'), taskTemplate);

    // Documents de l'entreprise.
    const docs: Array<[string, CompanyDocument['category'], CompanyDocument['visibleToRoles']]> = [
      ['Règlement intérieur', 'rules', ['owner', 'manager', 'kitchen', 'service', 'employee']],
      ['Procédure d’ouverture et de fermeture', 'procedure', ['owner', 'manager', 'kitchen', 'service']],
      ['Plan de maîtrise sanitaire', 'legal', ['owner', 'manager', 'kitchen']],
    ];
    docs.forEach(([name, category, roles], i) => {
      const file = ctx.files.storedPdf(`restaurants/${rid}/team/documents/document-${i + 1}.pdf`, name, [`Établissement : ${rid}`, 'Version 2026'], since, managerUid);
      const doc: CompanyDocument = { name, category, file, visibleToRoles: roles, ...tracked(since, managerUid) };
      w.set(sub('documents', `document-${i + 1}`), doc);
    });

    if (rid !== 'onda-pasta-club') seedHaccp(ctx, base, managerUid, team);
  }
  return { employees: employeesCount, shifts: shiftsCount };
}

function seedHaccp(ctx: SeedContext, base: string, managerUid: string, team: StaffSeed[]): void {
  const { w, rng, nowTs } = ctx;
  const sub = (name: keyof typeof SUBCOLLECTIONS.restaurants, id: string) => w.doc(`${base}/${SUBCOLLECTIONS.restaurants[name]}/${id}`);
  const since = ts(parisTime(addDays(ctx.today, -100), 9 * 60));
  const settings: HaccpSettings = { enabled: true, responsibleEmployeeId: team[0]?.id ?? null, temperatureReminderTimes: ['10:00', '17:00'], updatedAt: nowTs, updatedBy: managerUid };
  w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.settings}/${RESTAURANT_SETTINGS_DOCS.haccp}`), settings);

  const equipments: Array<[string, HaccpEquipment['kind'], number, number]> = [
    ['Chambre froide positive', 'cold_room', 0, 4],
    ['Réfrigérateur du passe', 'fridge', 0, 4],
    ['Congélateur', 'freezer', -25, -18],
    ['Bain-marie', 'hot_holding', 63, 90],
  ];
  equipments.forEach(([name, kind, min, max], i) => {
    const id = `equipement-${i + 1}`;
    const equipment: HaccpEquipment = { name, code: `EQ-${i + 1}`, area: kind === 'hot_holding' ? 'Passe' : 'Cuisine', kind, minTemp: min, maxTemp: max, readingsPerDay: 2, active: true, ...tracked(since, managerUid) };
    w.set(sub('haccpEquipments', id), equipment);
    for (let d = -14; d <= 0; d += 1) {
      for (const [slot, minutes] of [['m', 10 * 60], ['s', 17 * 60]] as const) {
        const at = parisTime(addDays(ctx.today, d), minutes + rng.int(0, 25));
        if (at > ctx.now) continue;
        const outOfRange = i === 1 && d === -4 && slot === 's';
        const value = outOfRange ? 6.8 : Math.round(rng.float(min + (max - min) * 0.2, max - (max - min) * 0.15) * 10) / 10;
        const log: HaccpTemperatureLog = {
          equipmentId: id,
          value,
          inRange: !outOfRange,
          comment: outOfRange ? 'Porte restée entrouverte pendant le service.' : null,
          correctiveAction: outOfRange ? 'Porte fermée, contrôle refait 30 minutes plus tard : 3,6 °C.' : null,
          recordedBy: team[1]?.uid ?? managerUid,
          recordedAt: ts(at),
          verifiedBy: d < -1 ? managerUid : null,
          verifiedAt: d < -1 ? ts(minutesAfter(at, 60)) : null,
        };
        w.set(sub('haccpTemperatureLogs', `${id}_${addDays(ctx.today, d)}_${slot}`), log);
      }
    }
  });

  const nc: HaccpNonConformity = {
    title: 'Température hors seuil au réfrigérateur du passe',
    description: 'Relevé de 6,8 °C lors du contrôle du soir.',
    severity: 'minor',
    status: 'resolved',
    source: { type: 'temperature', id: `equipement-2_${addDays(ctx.today, -4)}_s` },
    correctiveActions: [{ text: 'Joint de porte remplacé par le frigoriste.', by: managerUid, at: ts(parisTime(addDays(ctx.today, -3), 11 * 60)) }],
    declaredBy: team[1]?.uid ?? managerUid,
    declaredAt: ts(parisTime(addDays(ctx.today, -4), 17 * 60 + 20)),
    resolvedBy: managerUid,
    resolvedAt: ts(parisTime(addDays(ctx.today, -3), 11 * 60)),
  };
  w.set(sub('haccpNonConformities', 'nc-1'), nc);

  const receptions: Array<[string, string, number, HaccpReception['status']]> = [
    ['Metro Metz', 'Blancs de poulet fermier', 2.8, 'accepted'],
    ['Primeurs de Lorraine', 'Herbes fraîches et citrons', 8, 'accepted'],
    ['Pomona', 'Crème fraîche 5 L', 7.4, 'refused'],
  ];
  receptions.forEach(([supplier, product, temp, status], i) => {
    const reception: HaccpReception = {
      supplierName: supplier,
      productName: product,
      category: 'Frais',
      lotNumber: `LOT-${rng.digits(6)}`,
      useByDate: addDays(ctx.today, 5 + i),
      quantityLabel: null,
      temperature: temp,
      checks: { supplierIdentified: true, labelingConform: true, packagingIntact: status !== 'refused', useByChecked: true, temperatureConform: status !== 'refused', quantityChecked: true },
      labelPhoto: null,
      status,
      notes: status === 'refused' ? 'Température à réception supérieure à 4 °C : produit refusé et retourné.' : null,
      receivedBy: team[1]?.uid ?? managerUid,
      receivedAt: ts(parisTime(addDays(ctx.today, -i - 1), 9 * 60 + 15)),
      decidedBy: managerUid,
      decidedAt: ts(parisTime(addDays(ctx.today, -i - 1), 9 * 60 + 30)),
    };
    w.set(sub('haccpReceptions', `reception-${i + 1}`), reception);
  });

  const cleaning: Array<[string, string, HaccpCleaningTask['frequency']]> = [
    ['Plans de travail', 'Cuisine', 'after_service'],
    ['Sols de la cuisine', 'Cuisine', 'daily'],
    ['Hotte et filtres', 'Cuisine', 'weekly'],
    ['Chambre froide', 'Réserve', 'weekly'],
  ];
  cleaning.forEach(([name, area, frequency], i) => {
    const task: HaccpCleaningTask = { area, name, frequency, product: 'Détergent désinfectant alimentaire', method: 'Nettoyer, rincer, désinfecter, laisser sécher.', assignedEmployeeId: team[(i % (team.length - 1)) + 1]?.id ?? null, active: true, ...tracked(since, managerUid) };
    w.set(sub('haccpCleaningTasks', `nettoyage-${i + 1}`), task);
    for (let d = -6; d <= -1; d += 1) {
      if (frequency === 'weekly' && d !== -3) continue;
      const log: HaccpCleaningLog = { taskId: `nettoyage-${i + 1}`, doneBy: team[1]?.uid ?? managerUid, doneAt: ts(parisTime(addDays(ctx.today, d), 23 * 60 - 10)), comment: null };
      w.set(sub('haccpCleaningLogs', `nettoyage-${i + 1}_${addDays(ctx.today, d)}`), log);
    }
  });

  w.set(sub('haccpPestVisits', 'visite-1'), {
    provider: 'Hygiène Services Lorraine', visitDate: addDays(ctx.today, -21), areasInspected: 'Cuisine, réserve, local poubelles',
    observations: 'Aucune trace d’activité. Postes d’appâtage contrôlés.', report: null, nextVisitDate: addDays(ctx.today, 70), createdBy: managerUid, createdAt: nowTs,
  });
  w.set(sub('haccpAudits', 'audit-1'), {
    visitDate: addDays(ctx.today, -45), label: 'Audit interne trimestriel', kind: 'internal', result: 'to_improve',
    notes: 'Traçabilité des étiquettes à améliorer sur les préparations maison.', report: null, performedBy: managerUid, createdAt: nowTs,
  });
  for (const e of team.slice(1)) {
    w.set(sub('haccpPersonnelChecks', `${e.id}_${ctx.today}`), {
      employeeId: e.id, date: ctx.today, cleanUniform: true, handWashing: true, noSymptoms: true, hairProtected: e.id !== 'e5', validatedBy: managerUid, validatedAt: nowTs,
    });
  }
}
