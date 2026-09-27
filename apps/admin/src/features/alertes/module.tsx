import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { BellRing } from 'lucide-react';
import { COLLECTIONS, type PlatformAlert } from '@golink/shared';
import { defineModule } from '@/app/define-module';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

/** Pastille : alertes critiques ouvertes sur toute la plateforme. */
function useCriticalAlertsCount(): number | null {
  const { admin, can } = useAdminAccess();
  // Périmètre complet uniquement : les règles exigent un filtre de ville pour les responsables locaux.
  const allowed = can('dashboard.view') && admin.cityIds.length === 0 && admin.countryIds.length === 0;
  const q = useMemo(
    () =>
      allowed
        ? query(collection(db, COLLECTIONS.platformAlerts), where('queue', '==', 'alert'), where('status', '==', 'open'), where('severity', '==', 'critical'))
        : null,
    [allowed],
  );
  const { data } = useCollection<PlatformAlert>(q);
  return data.length || null;
}

export default defineModule({
  id: 'alertes',
  nav: {
    group: 'pilotage',
    label: 'Alertes',
    icon: <BellRing />,
    order: 5,
    badge: useCriticalAlertsCount,
    keywords: ['anomalies', 'à traiter', 'surveillance', 'seuils', 'validation', 'rgpd', 'documents expirés'],
  },
  permission: 'dashboard.view',
  routes: [
    {
      path: 'alertes',
      lazy: () => import('./AlertsPage').then((m) => ({ Component: m.AlertsPage })),
    },
    {
      path: 'alertes/seuils',
      lazy: () =>
        import('./ThresholdsPage').then((m) => ({
          Component: m.ThresholdsPage,
        })),
    },
  ],
});
