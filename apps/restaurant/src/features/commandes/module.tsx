import { ClipboardList } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { usePendingOrdersCount } from './hooks';

export default defineModule({
  id: 'commandes',
  nav: {
    group: 'commandes',
    label: 'Commandes',
    icon: <ClipboardList />,
    order: 10,
    badge: usePendingOrdersCount,
    keywords: ['service', 'tickets', 'cuisine', 'suivi', 'livreur', 'historique', 'retrait'],
  },
  permission: 'orders.view',
  routes: [
    { path: 'commandes', lazy: () => import('./OrdersPage').then((m) => ({ Component: m.OrdersPage })) },
    { path: 'commandes/historique', lazy: () => import('./HistoryPage').then((m) => ({ Component: m.HistoryPage })) },
    { path: 'commandes/suivi', lazy: () => import('./LivePage').then((m) => ({ Component: m.LivePage })) },
    { path: 'commandes/:orderId', lazy: () => import('./OrderPage').then((m) => ({ Component: m.OrderPage })) },
  ],
});
