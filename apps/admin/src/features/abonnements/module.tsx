import { Layers } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useUnpaidSubscriptionsCount } from './hooks';

export default defineModule({
  id: 'abonnements',
  nav: {
    group: 'argent',
    label: 'Abonnements et commissions',
    icon: <Layers />,
    order: 40,
    badge: useUnpaidSubscriptionsCount,
    keywords: ['formules', 'basic', 'pro', 'premium', 'commissions', 'impayés', 'relances', 'offre spéciale', 'essai'],
  },
  permission: 'subscriptions.manage',
  routes: [
    { path: 'abonnements', lazy: () => import('./SubscriptionsPage').then((m) => ({ Component: m.SubscriptionsPage })) },
    { path: 'abonnements/formules', lazy: () => import('./PlansPage').then((m) => ({ Component: m.PlansPage })) },
    { path: 'abonnements/commissions', lazy: () => import('./CommissionsPage').then((m) => ({ Component: m.CommissionsPage })) },
    { path: 'abonnements/relances', lazy: () => import('./DunningPage').then((m) => ({ Component: m.DunningPage })) },
  ],
});
