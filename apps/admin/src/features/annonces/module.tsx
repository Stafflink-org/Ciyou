import { Megaphone } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'annonces',
  nav: {
    group: 'croissance',
    label: 'Annonces',
    icon: <Megaphone />,
    order: 35,
    keywords: ['back-office restaurant', 'maintenance', 'nouveauté', 'changement de conditions', 'livreurs', 'bandeau'],
  },
  permission: 'announcements.edit',
  routes: [{ path: 'annonces', lazy: () => import('./AnnouncementsPage').then((m) => ({ Component: m.AnnouncementsPage })) }],
});
