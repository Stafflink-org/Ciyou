// Plan de maîtrise sanitaire (HACCP) de l'établissement. Sous-collections de
// restaurants/{rid}. Les allergènes des plats sont portés par les produits (menu.ts).
import type {
  HaccpCleaningFrequency,
  HaccpNonConformityStatus,
  HaccpReceptionStatus,
  HaccpSeverity,
} from '../constants/enums';
import type { StoredFile, Timestamp, Tracked } from './common';

/** haccpEquipments/{id} : enceinte froide ou chaude suivie en température. */
export interface HaccpEquipment extends Tracked {
  name: string;
  code?: string | null;
  area: string;
  kind: 'fridge' | 'freezer' | 'cold_room' | 'hot_holding' | 'other';
  minTemp?: number | null;
  maxTemp?: number | null;
  /** Nombre de relevés attendus par jour. */
  readingsPerDay: number;
  active: boolean;
}

/** haccpTemperatureLogs/{id}. */
export interface HaccpTemperatureLog {
  equipmentId: string;
  value: number;
  /** Conformité calculée à l'enregistrement selon les seuils de l'équipement. */
  inRange: boolean;
  comment?: string | null;
  correctiveAction?: string | null;
  recordedBy: string;
  recordedAt: Timestamp;
  verifiedBy?: string | null;
  verifiedAt?: Timestamp | null;
}

/** haccpReceptions/{id} : contrôle à réception des marchandises. */
export interface HaccpReception {
  supplierName: string;
  productName: string;
  category?: string | null;
  lotNumber?: string | null;
  useByDate?: string | null;
  quantityLabel?: string | null;
  temperature?: number | null;
  checks: {
    supplierIdentified: boolean;
    labelingConform: boolean;
    packagingIntact: boolean;
    useByChecked: boolean;
    temperatureConform: boolean;
    quantityChecked: boolean;
  };
  labelPhoto?: StoredFile | null;
  status: HaccpReceptionStatus;
  notes?: string | null;
  receivedBy: string;
  receivedAt: Timestamp;
  decidedBy?: string | null;
  decidedAt?: Timestamp | null;
}

/** haccpNonConformities/{id} et ses actions correctives. */
export interface HaccpNonConformity {
  title: string;
  description?: string | null;
  severity: HaccpSeverity;
  status: HaccpNonConformityStatus;
  source?: { type: 'temperature' | 'reception' | 'cleaning' | 'pest' | 'audit' | 'other'; id?: string | null } | null;
  correctiveActions: Array<{ text: string; by: string; at: Timestamp }>;
  declaredBy: string;
  declaredAt: Timestamp;
  resolvedBy?: string | null;
  resolvedAt?: Timestamp | null;
}

/** haccpCleaningTasks/{id} : plan de nettoyage. */
export interface HaccpCleaningTask extends Tracked {
  area: string;
  name: string;
  frequency: HaccpCleaningFrequency;
  product?: string | null;
  method?: string | null;
  assignedEmployeeId?: string | null;
  active: boolean;
}

/** haccpCleaningLogs/{id}. */
export interface HaccpCleaningLog {
  taskId: string;
  doneBy: string;
  doneAt: Timestamp;
  comment?: string | null;
}

/** haccpPestVisits/{id} : passage du prestataire nuisibles. */
export interface HaccpPestVisit {
  provider: string;
  visitDate: string;
  areasInspected?: string | null;
  observations?: string | null;
  report?: StoredFile | null;
  nextVisitDate?: string | null;
  createdBy: string;
  createdAt: Timestamp;
}

/** haccpPestReports/{id} : signalement interne de nuisibles. */
export interface HaccpPestReport {
  area: string;
  kind: 'evidence' | 'sighting' | 'other';
  description: string;
  status: 'open' | 'treated';
  reportedBy: string;
  reportedAt: Timestamp;
  resolvedBy?: string | null;
  resolvedAt?: Timestamp | null;
}

/** haccpPersonnelChecks/{employeeId_AAAA-MM-JJ} : contrôle hygiène du personnel. */
export interface HaccpPersonnelCheck {
  employeeId: string;
  date: string;
  cleanUniform: boolean;
  handWashing: boolean;
  noSymptoms: boolean;
  hairProtected: boolean;
  validatedBy?: string | null;
  validatedAt?: Timestamp | null;
}

/** haccpDocuments/{id} : plan de maîtrise sanitaire, fiches, attestations de formation. */
export interface HaccpDocument {
  category: 'sanitary_plan' | 'control_sheet' | 'training' | 'supplier' | 'other';
  name: string;
  file: StoredFile;
  uploadedBy: string;
  uploadedAt: Timestamp;
}

/** haccpAudits/{id} : audit interne ou contrôle officiel. */
export interface HaccpAudit {
  visitDate: string;
  label: string;
  kind: 'internal' | 'official';
  result: 'compliant' | 'non_compliant' | 'to_improve';
  notes?: string | null;
  report?: StoredFile | null;
  performedBy: string;
  createdAt: Timestamp;
}

/** haccpExports/{id} : export PDF du registre sur une période. */
export interface HaccpExport {
  periodStart: string;
  periodEnd: string;
  file: StoredFile;
  generatedBy: string;
  generatedAt: Timestamp;
}

/** restaurants/{rid}/settings/haccp. */
export interface HaccpSettings {
  enabled: boolean;
  responsibleEmployeeId?: string | null;
  temperatureReminderTimes: string[];
  updatedAt: Timestamp;
  updatedBy: string;
}
