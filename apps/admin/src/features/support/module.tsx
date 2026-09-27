import type { ComponentType } from 'react';
import { LifeBuoy } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useSupportQueueCount } from './hooks';

const page = <T,>(loader: () => Promise<T>, pick: (m: T) => ComponentType) => () => loader().then((m) => ({ Component: pick(m) }));

export default defineModule({
  id: 'support',
  nav: {
    group: 'operations',
    label: 'Support et litiges',
    icon: <LifeBuoy />,
    order: 130,
    badge: useSupportQueueCount,
    keywords: ['tickets', 'litiges', 'réclamations', 'remboursement', 'avoir', 'escalade', 'réponses types', 'centre d’aide', 'chat', 'SLA'],
  },
  permission: 'support.view',
  routes: [
    { path: 'support', lazy: page(() => import('./TicketsPage'), (m) => m.TicketsPage) },
    { path: 'support/chat', lazy: page(() => import('./ChatPage'), (m) => m.ChatPage) },
    { path: 'support/statistiques', lazy: page(() => import('./StatsPage'), (m) => m.StatsPage) },
    { path: 'support/aide', lazy: page(() => import('./HelpCenterPage'), (m) => m.HelpCenterPage) },
    { path: 'support/configuration', lazy: page(() => import('./SettingsPage'), (m) => m.SettingsPage) },
    { path: 'support/:ticketId', lazy: page(() => import('./TicketPage'), (m) => m.TicketPage) },
  ],
});
