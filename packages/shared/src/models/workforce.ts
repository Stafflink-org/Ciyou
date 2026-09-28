// Gestion d'entreprise du restaurant : accès au back-office, rôles, employés,
// planning, pointages, validation hebdomadaire, absences, paie, tâches, documents.
// Toutes les collections sont sous restaurants/{rid}.
import type {
  AbsenceType,
  ContractType,
  EmployeeStatus,
  PayslipStatus,
  RequestStatus,
  StaffRole,
  TaskPriority,
  TaskStatus,
  TimeEntryStatus,
  WeekValidationStatus,
} from '../constants/enums';
import type { ChecklistKind } from '../constants/enums';
import type { RestaurantPermission } from '../permissions/restaurant';
import type { Cents } from '../pricing/money';
import type { GeoPoint, StoredFile, Timestamp, Tracked } from './common';

/**
 * restaurants/{rid}/members/{uid} : accès d'un compte au back-office.
 * Écrit uniquement par Cloud Function (invitation, changement de rôle) ;
 * `permissions` est résolu depuis le rôle et lu par les règles de sécurité.
 */
export interface RestaurantMember {
  uid: string;
  restaurantId: string;
  groupId?: string | null;
  displayName: string;
  email: string;
  role: StaffRole;
  /** Rôle personnalisé (restaurants/{rid}/staffRoles/{id}) quand role = custom. */
  customRoleId?: string | null;
  permissions: RestaurantPermission[];
  active: boolean;
  /** « En service » dans l'équipe (maquette : bascule en service / hors service). */
  onDuty: boolean;
  employeeId?: string | null;
  invitedBy: string;
  invitedAt: Timestamp;
  joinedAt?: Timestamp | null;
  lastAccessAt?: Timestamp | null;
  /** Retrait d'accès (le document est conservé pour l'historique). */
  revokedAt?: Timestamp | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
  /** Dernière modification du rôle ou des permissions. */
  permissionsUpdatedAt?: Timestamp | null;
  permissionsUpdatedBy?: string | null;
}

/** restaurants/{rid}/staffRoles/{id} : rôle personnalisé et ses permissions. */
export interface StaffRoleDefinition extends Tracked {
  name: string;
  description?: string | null;
  permissions: RestaurantPermission[];
  system: boolean;
}

/** restaurants/{rid}/employees/{id} : fiche salarié (avec ou sans accès au back-office). */
export interface Employee extends Tracked {
  uid?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  position: string;
  department?: string | null;
  contractType: ContractType;
  status: EmployeeStatus;
  hireDate: string;
  endDate?: string | null;
  weeklyHours: number;
  hourlyRateCents: Cents;
  /** Classification conventionnelle (HCR : niveau, échelon). */
  classification?: string | null;
  coefficient?: number | null;
  socialCategory: 'employee' | 'supervisor' | 'executive';
  /** Numéro de sécurité sociale : stocké chiffré côté Cloud Function, ici seulement les 4 derniers chiffres. */
  socialSecurityLast4?: string | null;
  withholdingTaxRateBps?: number | null;
  paidLeaveBalanceDays: number;
  rttBalanceDays: number;
  color: string;
  /** Code PIN de pointage sur tablette (haché). */
  clockPinHash?: string | null;
}

/** restaurants/{rid}/employeeDocuments/{id} : contrats, pièces, attestations. */
export interface EmployeeDocument extends Tracked {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  name: string;
  type: 'contract' | 'amendment' | 'identity' | 'certificate' | 'medical' | 'payslip' | 'other';
  file: StoredFile;
  expiresAt?: string | null;
  visibleToEmployee: boolean;
}

/** restaurants/{rid}/availabilities/{employeeId_AAAA-MM-JJ} : disponibilités déclarées. */
export interface EmployeeAvailability {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  date: string;
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
  locked: boolean;
  updatedAt: Timestamp;
}

/** restaurants/{rid}/shifts/{id} : créneau de planning. */
export interface Shift extends Tracked {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  position?: string | null;
  notes?: string | null;
  published: boolean;
  templateId?: string | null;
}

/** restaurants/{rid}/shiftTemplates/{id} : semaine type ou service type. */
export interface ShiftTemplate extends Tracked {
  name: string;
  description?: string | null;
  active: boolean;
  slots: Array<{
    /** 0 = lundi … 6 = dimanche ; null = n'importe quel jour. */
    dayOfWeek: number | null;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    position?: string | null;
  }>;
}

/** restaurants/{rid}/shiftChangeRequests/{id} : demande de modification par l'employé. */
export interface ShiftChangeRequest extends Tracked {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  shiftId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  note?: string | null;
  status: RequestStatus;
  reviewedBy?: string | null;
  reviewedAt?: Timestamp | null;
  rejectionReason?: string | null;
}

export interface ClockPoint {
  at: Timestamp;
  location?: GeoPoint | null;
  accuracyMeters?: number | null;
  source: 'mobile' | 'tablet' | 'backoffice';
  /** Distance à l'établissement au moment du pointage (si la position est connue). */
  distanceMeters?: number | null;
  /** Auteur du pointage quand il est saisi pour le compte du salarié. */
  recordedBy?: string | null;
}

/** restaurants/{rid}/timeEntries/{employeeId_AAAA-MM-JJ} : pointage de la journée. */
export interface TimeEntry {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  date: string;
  clockIn?: ClockPoint | null;
  clockOut?: ClockPoint | null;
  breaks: Array<{ start: Timestamp; end?: Timestamp | null }>;
  workedMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  status: TimeEntryStatus;
  shiftId?: string | null;
  notes?: string | null;
  modifiedBy?: string | null;
  updatedAt: Timestamp;
  createdAt: Timestamp;
}

/** restaurants/{rid}/timeEntries/{id}/history/{hid} : historique des corrections (non modifiable). */
export interface TimeEntryHistory {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: Timestamp;
  reason?: string | null;
  changedByName?: string | null;
}

/** restaurants/{rid}/weekValidations/{employeeId_AAAA-MM-JJ} (lundi de la semaine). */
export interface WeekValidation {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  weekStart: string;
  weekEnd: string;
  workedMinutes: number;
  overtimeMinutes: number;
  status: WeekValidationStatus;
  employeeComment?: string | null;
  managerComment?: string | null;
  validatedBy?: string | null;
  validatedAt?: Timestamp | null;
  updatedAt: Timestamp;
}

/** restaurants/{rid}/absences/{id}. */
export interface Absence extends Tracked {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  type: AbsenceType;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  durationDays: number;
  reason?: string | null;
  attachment?: StoredFile | null;
  status: RequestStatus;
  approvedBy?: string | null;
  approvedAt?: Timestamp | null;
  rejectionReason?: string | null;
}

/** restaurants/{rid}/payslips/{employeeId_AAAA-MM}. Montants en centimes. */
export interface Payslip {
  employeeId: string;
  /** Compte de l'employé (dénormalisé pour les règles d'accès « ses propres données »). */
  employeeUid?: string | null;
  period: string;
  status: PayslipStatus;
  hours: {
    regular: number;
    overtime10: number;
    overtime20: number;
    overtime50: number;
    night: number;
    sunday: number;
    holiday: number;
  };
  grossCents: Cents;
  bonusCents: Cents;
  mealAllowanceCents: Cents;
  deductionsCents: Cents;
  employeeContributionsCents: Cents;
  employerContributionsCents: Cents;
  taxableNetCents: Cents;
  withholdingTaxCents: Cents;
  netCents: Cents;
  contributions: Array<{ label: string; baseCents: Cents; employeeRateBps: number; employerRateBps: number }>;
  pdf?: StoredFile | null;
  generatedAt: Timestamp;
  validatedAt?: Timestamp | null;
  validatedBy?: string | null;
  sentAt?: Timestamp | null;
  /** Lignes de rémunération détaillées (bulletin PDF). */
  lines?: PayslipLine[];
  /** Jours travaillés et jours d'absence retenus sur la période. */
  workedDays?: number;
  paidAbsenceDays?: number;
  unpaidAbsenceDays?: number;
  /** Instantané de la fiche au moment du calcul (bulletin). */
  employeeSnapshot?: PayslipEmployeeSnapshot | null;
  /** Primes et retenues saisies par le gestionnaire de paie. */
  adjustments?: PayslipAdjustment[];
}

/** Ligne de rémunération d'un bulletin : quantité (heures, jours) × taux = montant. */
export interface PayslipLine {
  label: string;
  quantity?: number | null;
  unitCents?: Cents | null;
  amountCents: Cents;
  kind: 'base' | 'overtime' | 'bonus' | 'allowance' | 'absence' | 'other';
}

export interface PayslipAdjustment {
  label: string;
  /** Positif : prime (soumise à cotisations) ; négatif : retenue sur le net. */
  amountCents: Cents;
  kind: 'bonus' | 'deduction';
}

export interface PayslipEmployeeSnapshot {
  fullName: string;
  position: string;
  contractType: ContractType;
  hireDate: string;
  classification?: string | null;
  socialSecurityLast4?: string | null;
  hourlyRateCents: Cents;
  weeklyHours: number;
}

/** restaurants/{rid}/settings/payroll : paramètres de paie (convention HCR par défaut). */
export interface PayrollSettings {
  country: string;
  collectiveAgreement: string;
  nafCode?: string | null;
  weeklyLegalHours: 35 | 39;
  applyHcrOvertime: boolean;
  overtimeRatesBps: { first: number; second: number; beyond: number };
  nightWindow: { from: string; to: string };
  nightBonusBps: number;
  sundayBonusBps: number;
  holidayBonusBps: number;
  mealAllowance: { enabled: boolean; mealsPerDay: number; rateCents?: Cents | null };
  healthInsurance: { monthlyCents: Cents; employerShareBps: number };
  accidentRateBps: number;
  payDay: number;
  paidLeaveDaysPerYear: number;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/tasks/{id}. */
export interface Task extends Tracked {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string | null;
  tags: string[];
  /** Comptes (uid) des assignés. */
  assigneeIds: string[];
  /** Statut individuel par assigné (clé = uid). */
  assigneeStatus: Record<string, TaskStatus>;
  templateId?: string | null;
  recurrence?: { frequency: 'daily' | 'weekly' | 'monthly'; until?: string | null } | null;
}

/** restaurants/{rid}/tasks/{id}/comments/{cid}. */
export interface TaskComment {
  authorId: string;
  authorName: string;
  body: string;
  createdAt: Timestamp;
}

/** restaurants/{rid}/taskTemplates/{id}. */
export interface TaskTemplate extends Tracked {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  tags: string[];
  dueOffsetDays?: number | null;
  active: boolean;
}

/** restaurants/{rid}/documents/{id} : documents de l'entreprise (règlement, procédures…). */
export interface CompanyDocument extends Tracked {
  name: string;
  category: 'rules' | 'procedure' | 'training' | 'legal' | 'supplier' | 'other';
  file: StoredFile;
  visibleToRoles: StaffRole[];
  description?: string | null;
  /** Archivé : masqué des listes (les documents ne sont jamais supprimés). */
  archived?: boolean;
}

/**
 * restaurants/{rid}/staffDirectory/{id} : annuaire de l'équipe lisible par tous
 * les membres (noms, poste, couleur), sans donnée sensible. Tenu à jour par les
 * triggers onEmployeeDirectorySync et onMemberDirectorySync.
 * Identifiant : identifiant de la fiche salarié, ou « m_<uid> » pour un membre sans fiche.
 */
export interface StaffDirectoryEntry {
  kind: 'employee' | 'member';
  employeeId?: string | null;
  uid?: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  position?: string | null;
  department?: string | null;
  color: string;
  contractType?: ContractType | null;
  weeklyHours?: number | null;
  active: boolean;
  updatedAt: Timestamp;
}

export interface ChecklistItem {
  id: string;
  label: string;
  /** Point critique : signalé s'il n'est pas coché. */
  critical?: boolean;
}

/** restaurants/{rid}/checklistTemplates/{id} : checklist type (ouverture, fermeture…). */
export interface ChecklistTemplate extends Tracked {
  name: string;
  kind: ChecklistKind;
  description?: string | null;
  items: ChecklistItem[];
  /** Jours concernés (0 = lundi … 6 = dimanche) ; vide = tous les jours. */
  daysOfWeek: number[];
  /** Heure indicative de réalisation (HH:MM). */
  dueTime?: string | null;
  active: boolean;
  order: number;
}

/** restaurants/{rid}/checklistRuns/{templateId_AAAA-MM-JJ} : réalisation d'une checklist un jour donné. */
export interface ChecklistRun {
  templateId: string;
  templateName: string;
  kind: ChecklistKind;
  date: string;
  items: Array<ChecklistItem & { done: boolean; doneBy?: string | null; doneByName?: string | null; doneAt?: Timestamp | null }>;
  completed: boolean;
  completedAt?: Timestamp | null;
  completedBy?: string | null;
  comment?: string | null;
  updatedAt: Timestamp;
  updatedBy: string;
}
