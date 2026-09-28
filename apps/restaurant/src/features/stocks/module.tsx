import { Boxes } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useSoldOutCount } from './hooks';

export default defineModule({
  id: 'stocks',
  nav: {
    group: 'carte',
    label: 'Ventes & stocks',
    icon: <Boxes />,
    order: 30,
    badge: useSoldOutCount,
    keywords: ['inventaire', 'rupture', 'quantités', 'réception', 'pertes'],
  },
  permission: 'menu.view',
  routes: [{ path: 'stocks', lazy: () => import('./StocksPage').then((m) => ({ Component: m.StocksPage })) }],
});
