import { BellRing } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'notifications',
  nav: {
    group: 'configuration',
    label: 'Notifications',
    icon: <BellRing />,
    order: 60,
    keywords: ['son', 'alertes', 'e-mails', 'sms', 'sonnerie'],
    hidden: true, // regroupé dans le hub Paramètres (features/parametres)
  },
  permission: 'settings.manage',
  routes: [{ path: 'notifications', lazy: () => import('./NotificationsPage').then((m) => ({ Component: m.NotificationsPage })) }],
});
