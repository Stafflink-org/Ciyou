import type { Tone } from '@golink/ui';
import type { AbsenceType } from '@golink/shared';

export const ABSENCE_TONE: Record<AbsenceType, Tone> = {
  paid_leave: 'teal',
  rtt: 'info',
  sick: 'danger',
  unpaid_leave: 'neutral',
  training: 'plum',
  family_event: 'brand',
  other: 'amber',
};

/** Types décomptés d'un solde. */
export const BALANCE_OF: Partial<Record<AbsenceType, 'paidLeaveBalanceDays' | 'rttBalanceDays'>> = {
  paid_leave: 'paidLeaveBalanceDays',
  rtt: 'rttBalanceDays',
};
