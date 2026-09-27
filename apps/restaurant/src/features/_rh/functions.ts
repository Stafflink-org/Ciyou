// Cloud Functions du domaine RH (région europe-west1), typées.
import type { PayslipAdjustment } from '@golink/shared';
import { callFunction } from '@/lib/firestore';

export type ClockAction = 'in' | 'out' | 'break_start' | 'break_end';

export const clockEvent = callFunction<
  {
    restaurantId: string;
    action: ClockAction;
    employeeId?: string;
    source?: 'mobile' | 'tablet' | 'backoffice';
    location?: { latitude: number; longitude: number; accuracy?: number };
  },
  { entryId: string; state: 'working' | 'on_break' | 'off'; workedMinutes?: number }
>('clockEvent');

export const correctTimeEntry = callFunction<
  {
    restaurantId: string;
    employeeId: string;
    date: string;
    clockIn: string;
    clockOut: string | null;
    breaks: Array<{ start: string; end: string }>;
    notes?: string | null;
    reason: string;
  },
  { entryId: string }
>('correctTimeEntry');

export const validateWeek = callFunction<
  { restaurantId: string; weekStart: string; employeeIds: string[]; action: 'validate' | 'reject' | 'reopen' | 'employee_validate'; comment?: string },
  { updated: number }
>('validateWeek');

export const publishSchedule = callFunction<
  { restaurantId: string; weekStart: string; action?: 'publish' | 'unpublish'; employeeIds?: string[]; notify?: boolean },
  { updated: number }
>('publishSchedule');

export const reviewShiftChangeRequest = callFunction<
  { restaurantId: string; requestId: string; decision: 'approve' | 'reject'; reason?: string; startTime?: string; endTime?: string },
  { status: 'approved' | 'rejected' }
>('reviewShiftChangeRequest');

export const reviewAbsence = callFunction<
  {
    restaurantId: string;
    absenceId: string;
    decision: 'approve' | 'reject' | 'revoke';
    reason?: string;
    allowNegativeBalance?: boolean;
    removeShifts?: boolean;
  },
  { durationDays: number; removedShifts: number }
>('reviewAbsence');

export interface PayrollRunResult {
  computed: number;
  skipped: number;
  openEntries: number;
  unvalidatedEntries: number;
  grossCents: number;
  netCents: number;
  employerCostCents: number;
}

export const computePayroll = callFunction<{ restaurantId: string; period: string; employeeIds?: string[] }, PayrollRunResult>('computePayroll');

export const savePayslipAdjustments = callFunction<
  { restaurantId: string; payslipId: string; adjustments: PayslipAdjustment[] },
  { netCents: number; grossCents: number }
>('savePayslipAdjustments');

export const setPayslipStatus = callFunction<{ restaurantId: string; payslipIds: string[]; status: 'validated' | 'generated' }, { updated: number }>(
  'setPayslipStatus',
);

export const sendPayslips = callFunction<{ restaurantId: string; payslipIds: string[] }, { sent: number; emailed: number; skipped: string[] }>(
  'sendPayslips',
);

export const generatePayslipPdf = callFunction<{ restaurantId: string; payslipId: string }, { fileName: string; base64: string }>('generatePayslipPdf');

export const exportHaccpRegister = callFunction<
  { restaurantId: string; from?: string; to?: string; exportId?: string },
  { exportId: string; fileName: string; base64: string }
>('exportHaccpRegister');

/** Enregistre un fichier renvoyé en base64 par une fonction. */
export function downloadBase64(base64: string, fileName: string, type = 'application/pdf'): void {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
