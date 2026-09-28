import { Radar } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'flotte',
  nav: {
    group: 'operations',
    label: 'Flotte en direct',
    icon: <Radar />,
    order: 20,
    keywords: ['carte', 'livreurs en ligne', 'disponibles', 'en course', 'manque de livreurs', 'vue par zone'],
  },
  permission: 'drivers.view',
  routes: [{ path: 'flotte', lazy: () => import('./FleetPage').then((m) => ({ Component: m.FleetPage })) }],
});
