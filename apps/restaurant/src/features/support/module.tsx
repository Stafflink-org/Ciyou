import { Headphones } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useSupportUnreadCount } from './lib';

export default defineModule({
  id: 'support',
  nav: {
    group: 'messagerie',
    label: 'Support Ciyou Eats',
    icon: <Headphones />,
    order: 20,
    badge: useSupportUnreadCount,
    keywords: ['aide', 'ticket', 'réclamation', 'centre d’aide', 'contact'],
  },
  permission: 'support.use',
  routes: [
    { path: 'support', lazy: () => import('./SupportPage').then((m) => ({ Component: m.SupportPage })) },
    { path: 'support/:ticketId', lazy: () => import('./TicketPage').then((m) => ({ Component: m.TicketPage })) },
  ],
});
