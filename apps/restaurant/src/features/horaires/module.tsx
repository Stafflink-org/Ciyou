import { Clock3 } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'horaires',
  nav: {
    group: 'configuration',
    label: 'Horaires',
    icon: <Clock3 />,
    order: 20,
    keywords: ['ouverture', 'fermeture', 'jours fériés', 'créneaux', 'pause', 'congés'],
    hidden: true, // regroupé dans le hub Paramètres (features/parametres)
  },
  permission: 'settings.manage',
  routes: [{ path: 'horaires', lazy: () => import('./HorairesPage').then((m) => ({ Component: m.HorairesPage })) }],
});
