import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { Send } from 'lucide-react';
import { COLLECTIONS, type Campaign } from '@golink/shared';
import { defineModule } from '@/app/define-module';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

/** Pastille : envois de la plateforme programmés. */
function useScheduledCount(): number | null {
  const { can } = useAdminAccess();
  const allowed = can('notifications.send');
  const q = useMemo(
    () => (allowed ? query(collection(db, COLLECTIONS.campaigns), where('scope', '==', 'platform'), where('status', '==', 'scheduled')) : null),
    [allowed],
  );
  const { data } = useCollection<Campaign>(q);
  return data.length || null;
}

export default defineModule({
  id: 'communication',
  nav: {
    group: 'croissance',
    label: 'Notifications et envois',
    icon: <Send />,
    order: 30,
    badge: useScheduledCount,
    keywords: ['push', 'e-mail', 'sms', 'campagne', 'messages automatiques', 'modèles', 'consentement', 'programmation', 'journal'],
  },
  permission: 'notifications.send',
  routes: [
    { path: 'communication', lazy: () => import('./CampaignsPage').then((m) => ({ Component: m.CampaignsPage })) },
    { path: 'communication/nouveau', lazy: () => import('./CampaignPage').then((m) => ({ Component: m.CampaignPage })) },
    { path: 'communication/messages-automatiques', lazy: () => import('./TemplatesPage').then((m) => ({ Component: m.TemplatesPage })) },
    { path: 'communication/journal', lazy: () => import('./LogsPage').then((m) => ({ Component: m.LogsPage })) },
    { path: 'communication/consentements', lazy: () => import('./ConsentsPage').then((m) => ({ Component: m.ConsentsPage })) },
    { path: 'communication/regles', lazy: () => import('./RulesPage').then((m) => ({ Component: m.RulesPage })) },
    { path: 'communication/:campaignId', lazy: () => import('./CampaignPage').then((m) => ({ Component: m.CampaignPage })) },
  ],
});
