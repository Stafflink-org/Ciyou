// Lectures HACCP de l'établissement actif et navigation de la rubrique.
import { Timestamp, limit, orderBy, query, where, type CollectionReference, type Query } from 'firebase/firestore';
import {
  Bug,
  FileArchive,
  LayoutDashboard,
  ShieldAlert,
  SprayCan,
  Thermometer,
  Truck,
  UserCheck,
  Wheat,
} from 'lucide-react';
import {
  paths,
  type HaccpAudit,
  type HaccpCleaningLog,
  type HaccpCleaningTask,
  type HaccpDocument,
  type HaccpEquipment,
  type HaccpExport,
  type HaccpNonConformity,
  type HaccpPestReport,
  type HaccpPestVisit,
  type HaccpReception,
  type HaccpTemperatureLog,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';
import { parseDay } from '../_rh/dates';
import type { SubNavItem } from '../_rh/ui';

export const HACCP_NAV: SubNavItem[] = [
  { to: '/equipe/haccp', label: 'Tableau de bord', icon: <LayoutDashboard />, end: true },
  { to: '/equipe/haccp/temperatures', label: 'Températures', icon: <Thermometer /> },
  { to: '/equipe/haccp/receptions', label: 'Réceptions', icon: <Truck /> },
  { to: '/equipe/haccp/nettoyage', label: 'Nettoyage', icon: <SprayCan /> },
  { to: '/equipe/haccp/non-conformites', label: 'Non-conformités', icon: <ShieldAlert /> },
  { to: '/equipe/haccp/personnel', label: 'Hygiène du personnel', icon: <UserCheck /> },
  { to: '/equipe/haccp/nuisibles', label: 'Nuisibles', icon: <Bug /> },
  { to: '/equipe/haccp/allergenes', label: 'Allergènes', icon: <Wheat /> },
  { to: '/equipe/haccp/registre', label: 'Registre', icon: <FileArchive /> },
];

export const EQUIPMENT_KIND_LABELS: Record<HaccpEquipment['kind'], string> = {
  fridge: 'Réfrigérateur',
  freezer: 'Congélateur',
  cold_room: 'Chambre froide',
  hot_holding: 'Maintien au chaud',
  other: 'Autre',
};

export function sinceDays(days: number): Timestamp {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return Timestamp.fromDate(date);
}

export function startOfDay(day: string): Timestamp {
  return Timestamp.fromDate(parseDay(day));
}

function useSub<T>(name: Parameters<typeof paths.restaurantSub>[1], build: (col: CollectionReference) => Query | null) {
  const { restaurantId } = useRestaurantAccess();
  return useCollection<T>(build(collectionAt(paths.restaurantSub(restaurantId, name))));
}

export const useEquipments = () => useSub<HaccpEquipment>('haccpEquipments', (c) => query(c, orderBy('name')));
export const useTemperatureLogs = (days: number) =>
  useSub<HaccpTemperatureLog>('haccpTemperatureLogs', (c) => query(c, where('recordedAt', '>=', sinceDays(days)), orderBy('recordedAt', 'desc'), limit(1000)));
export const useReceptions = (days: number) =>
  useSub<HaccpReception>('haccpReceptions', (c) => query(c, where('receivedAt', '>=', sinceDays(days)), orderBy('receivedAt', 'desc'), limit(300)));
export const useCleaningTasks = () => useSub<HaccpCleaningTask>('haccpCleaningTasks', (c) => query(c, orderBy('area')));
export const useCleaningLogs = (days: number) =>
  useSub<HaccpCleaningLog>('haccpCleaningLogs', (c) => query(c, where('doneAt', '>=', sinceDays(days)), orderBy('doneAt', 'desc'), limit(1000)));
export const useNonConformities = () => useSub<HaccpNonConformity>('haccpNonConformities', (c) => query(c, orderBy('declaredAt', 'desc'), limit(200)));
export const usePestVisits = () => useSub<HaccpPestVisit>('haccpPestVisits', (c) => query(c, orderBy('visitDate', 'desc'), limit(50)));
export const usePestReports = () => useSub<HaccpPestReport>('haccpPestReports', (c) => query(c, orderBy('reportedAt', 'desc'), limit(100)));
export const useHaccpDocuments = () => useSub<HaccpDocument>('haccpDocuments', (c) => query(c, orderBy('uploadedAt', 'desc'), limit(100)));
export const useAudits = () => useSub<HaccpAudit>('haccpAudits', (c) => query(c, orderBy('visitDate', 'desc'), limit(50)));

export function useExports() {
  const can = useCan();
  return useSub<HaccpExport>('haccpExports', (c) => (can('haccp.manage') ? query(c, orderBy('generatedAt', 'desc'), limit(50)) : null));
}

/** Plage conforme ? */
export function inRange(equipment: Pick<HaccpEquipment, 'minTemp' | 'maxTemp'>, value: number): boolean {
  return (equipment.minTemp === null || equipment.minTemp === undefined || value >= equipment.minTemp) && (equipment.maxTemp === null || equipment.maxTemp === undefined || value <= equipment.maxTemp);
}

export function formatTemp(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
}

export function rangeLabel(equipment: Pick<HaccpEquipment, 'minTemp' | 'maxTemp'>): string {
  const min = equipment.minTemp ?? null;
  const max = equipment.maxTemp ?? null;
  if (min !== null && max !== null) return `${min} à ${max} °C`;
  if (max !== null) return `≤ ${max} °C`;
  if (min !== null) return `≥ ${min} °C`;
  return 'Sans seuil';
}

/** Une tâche de nettoyage est-elle à jour selon sa fréquence ? */
export function cleaningDue(task: Pick<HaccpCleaningTask, 'frequency'>, lastDone: Date | null, now = new Date()): boolean {
  if (!lastDone) return true;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const windowDays = task.frequency === 'weekly' ? 7 : task.frequency === 'monthly' ? 30 : 0;
  const threshold = new Date(startOfToday);
  threshold.setDate(threshold.getDate() - Math.max(0, windowDays - 1));
  return lastDone < (windowDays === 0 ? startOfToday : threshold);
}
