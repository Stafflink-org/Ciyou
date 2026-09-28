// Permissions du personnel d'un restaurant (back-office restaurant et app équipe).
// Le propriétaire a toutes les permissions ; les autres rôles reçoivent un jeu
// par défaut, ajustable par rôle personnalisé.
import type { StaffRole } from '../constants/enums';

export const RESTAURANT_PERMISSIONS = [
  'dashboard.view',
  'orders.view',
  'orders.manage',
  'orders.cancel',
  'menu.view',
  'menu.edit',
  'stock.edit',
  'customers.view',
  'customers.manage',
  'couriers.manage',
  'finance.view',
  'invoices.view',
  'marketing.manage',
  'reviews.reply',
  'messages.use',
  'support.use',
  'settings.manage',
  'zones.manage',
  'team.view',
  'team.manage',
  'planning.view',
  'planning.manage',
  'timeclock.self',
  'timeclock.manage',
  'absences.self',
  'absences.manage',
  'payroll.view',
  'payroll.manage',
  'tasks.view',
  'tasks.manage',
  'documents.view',
  'documents.manage',
  'haccp.record',
  'haccp.manage',
] as const;

export type RestaurantPermission = (typeof RESTAURANT_PERMISSIONS)[number];

/** Permissions de base de tout salarié ayant un accès. */
const SELF_SERVICE: readonly RestaurantPermission[] = [
  'planning.view',
  'timeclock.self',
  'absences.self',
  'tasks.view',
  'documents.view',
];

export const DEFAULT_STAFF_ROLE_PERMISSIONS: Record<StaffRole, readonly RestaurantPermission[]> = {
  owner: RESTAURANT_PERMISSIONS,
  manager: RESTAURANT_PERMISSIONS.filter((p) => p !== 'payroll.manage'),
  kitchen: [...SELF_SERVICE, 'dashboard.view', 'orders.view', 'orders.manage', 'menu.view', 'stock.edit', 'haccp.record'],
  service: [
    ...SELF_SERVICE,
    'dashboard.view',
    'orders.view',
    'orders.manage',
    'menu.view',
    'customers.view',
    'messages.use',
    'haccp.record',
  ],
  accountant: [...SELF_SERVICE, 'dashboard.view', 'orders.view', 'finance.view', 'invoices.view', 'payroll.view', 'payroll.manage'],
  employee: SELF_SERVICE,
  custom: [],
};

export function memberHasPermission(
  member: { role: StaffRole; permissions: readonly RestaurantPermission[]; active: boolean },
  permission: RestaurantPermission,
): boolean {
  if (!member.active) return false;
  return member.role === 'owner' || member.permissions.includes(permission);
}
