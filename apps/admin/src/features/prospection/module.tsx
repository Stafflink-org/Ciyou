import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { Target } from 'lucide-react';
import { COLLECTIONS, type Prospect } from '@golink/shared';
import { useAuth } from '@golink/web';
import { defineModule } from '@/app/define-module';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { toMillis, useCollection } from '@/lib/firestore';

/** Pastille : relances échues du commercial connecté. */
function useDueFollowUps(): number | null {
  const { can } = useAdminAccess();
  const { user } = useAuth();
  const allowed = can('crm.view') && Boolean(user);
  const q = useMemo(() => (allowed && user ? query(collection(db, COLLECTIONS.prospects), where('ownerId', '==', user.uid)) : null), [allowed, user]);
  const { data } = useCollection<Prospect>(q);
  const now = Date.now();
  return data.filter((p) => p.stage !== 'signed_up' && p.stage !== 'lost' && (toMillis(p.nextFollowUpAt) ?? Infinity) <= now).length || null;
}

export default defineModule({
  id: 'prospection',
  nav: {
    group: 'croissance',
    label: 'Prospection',
    icon: <Target />,
    order: 40,
    badge: useDueFollowUps,
    keywords: ['crm', 'prospects', 'commerciaux', 'démo', 'relances', 'pipeline', 'kanban', 'commissions', 'acquisition'],
  },
  permission: 'crm.view',
  routes: [
    { path: 'prospection', lazy: () => import('./PipelinePage').then((m) => ({ Component: m.PipelinePage })) },
    { path: 'prospection/commerciaux', lazy: () => import('./SalesTeamPage').then((m) => ({ Component: m.SalesTeamPage })) },
    { path: 'prospection/:prospectId', lazy: () => import('./ProspectPage').then((m) => ({ Component: m.ProspectPage })) },
  ],
});
