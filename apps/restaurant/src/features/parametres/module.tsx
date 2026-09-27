import { Settings2 } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useSetupBadge } from './kit/setup';

export default defineModule({
  id: 'parametres',
  nav: {
    group: 'configuration',
    label: 'Paramètres',
    icon: <Settings2 />,
    order: 0,
    badge: useSetupBadge,
    keywords: ['configuration', 'réglages', 'mise en route', 'profil'],
  },
  permission: 'settings.manage',
  routes: [{ path: 'parametres', lazy: () => import('./ParametresPage').then((m) => ({ Component: m.ParametresPage })) }],
});
