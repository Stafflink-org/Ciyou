// Outils communs du domaine RH : références, fiche salarié du compte appelant,
// notifications dans l'application, réglages de paie par défaut.
import {
  COLLECTIONS,
  DEFAULT_PAYROLL_SETTINGS,
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type Employee,
  type PayrollSettings,
  type RestaurantMember,
  type UserNotification,
} from '@golink/shared';
import { db, FieldValue } from '../lib/admin';
import { fail } from '../lib/errors';

type RestaurantSub = keyof typeof SUBCOLLECTIONS.restaurants;

/**
 * Options d'exécution des fonctions RH : fraction de processeur (faible trafic,
 * quota régional de processeurs partagé par toutes les fonctions du projet).
 */
export const HR_RUNTIME = { cpu: 'gcf_gen1' as const, maxInstances: 5 };

/** Fonctions appelables : invocation publique, l'accès est contrôlé dans chaque fonction. */
export const HR_CALLABLE = { ...HR_RUNTIME, invoker: 'public' as const };

export function sub(restaurantId: string, name: RestaurantSub) {
  return db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants[name]);
}

export async function loadEmployee(restaurantId: string, employeeId: string): Promise<Employee> {
  const snap = await sub(restaurantId, 'employees').doc(employeeId).get();
  if (!snap.exists) throw fail.notFound('Salarié');
  return snap.data() as Employee;
}

/** Fiche salarié liée au compte (via members.employeeId, sinon employees.uid). */
export async function employeeOfUser(
  restaurantId: string,
  uid: string,
  member: RestaurantMember | null,
): Promise<{ id: string; employee: Employee } | null> {
  if (member?.employeeId) {
    const snap = await sub(restaurantId, 'employees').doc(member.employeeId).get();
    if (snap.exists) return { id: snap.id, employee: snap.data() as Employee };
  }
  const found = await sub(restaurantId, 'employees').where('uid', '==', uid).limit(1).get();
  const doc = found.docs[0];
  return doc ? { id: doc.id, employee: doc.data() as Employee } : null;
}

export function fullName(employee: Pick<Employee, 'firstName' | 'lastName'>): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

/** Notification dans la cloche du back-office (et de l'app équipe). */
export async function notifyUser(uid: string | null | undefined, title: string, body: string, target: string): Promise<void> {
  if (!uid) return;
  const notification: Omit<UserNotification, 'createdAt'> & { createdAt: FieldValue } = {
    title,
    body,
    category: 'account',
    link: { type: 'page', target },
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.notifications).add(notification);
}


export async function loadPayrollSettings(restaurantId: string): Promise<Omit<PayrollSettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await sub(restaurantId, 'settings').doc(RESTAURANT_SETTINGS_DOCS.payroll).get();
  return { ...DEFAULT_PAYROLL_SETTINGS, ...((snap.data() as Partial<PayrollSettings> | undefined) ?? {}) };
}

/** Adresse de test (domaine réservé .test) : aucun e-mail réel n'est envoyé. */
export function isDeliverableEmail(email: string | null | undefined): email is string {
  return Boolean(email && /@[^@]+\.[a-z]{2,}$/i.test(email) && !/\.(test|example|invalid|localhost)$/i.test(email));
}
