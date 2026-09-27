import { ShoppingBag } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useDispatchFailedCount } from './hooks';

export default defineModule({
  id: 'commandes',
  nav: {
    group: 'operations',
    label: 'Commandes',
    icon: <ShoppingBag />,
    order: 10,
    badge: useDispatchFailedCount,
    keywords: ['litige', 'chronologie', 'volumes', 'anomalies', 'en direct', 'GL-'],
  },
  permission: 'orders.view',
  routes: [
    { path: 'commandes', lazy: () => import('./OrdersPage').then((m) => ({ Component: m.OrdersPage })) },
    { path: 'commandes/direct', lazy: () => import('./LivePage').then((m) => ({ Component: m.LivePage })) },
    { path: 'commandes/anomalies', lazy: () => import('./AnomaliesPage').then((m) => ({ Component: m.AnomaliesPage })) },
    { path: 'commandes/:orderId', lazy: () => import('./OrderPage').then((m) => ({ Component: m.OrderPage })) },
  ],
});
