import { Landmark } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useFailedPayoutsCount } from './hooks';

export default defineModule({
  id: 'finance',
  nav: {
    group: 'argent',
    label: 'Finance et reversements',
    icon: <Landmark />,
    order: 20,
    badge: useFailedPayoutsCount,
    keywords: ['reversements', 'virements', 'grand livre', 'commissions', 'solde', 'blocage', 'ajustement', 'répartition'],
  },
  permission: 'finance.view',
  routes: [
    { path: 'finance', lazy: () => import('./FinanceOverviewPage').then((m) => ({ Component: m.FinanceOverviewPage })) },
    { path: 'finance/reversements', lazy: () => import('./PayoutsPage').then((m) => ({ Component: m.PayoutsPage })) },
    { path: 'finance/reversements/:payoutId', lazy: () => import('./PayoutPage').then((m) => ({ Component: m.PayoutPage })) },
    { path: 'finance/repartition', lazy: () => import('./BreakdownPage').then((m) => ({ Component: m.BreakdownPage })) },
    { path: 'finance/grand-livre', lazy: () => import('./LedgerPage').then((m) => ({ Component: m.LedgerPage })) },
    { path: 'finance/blocages', lazy: () => import('./HoldsPage').then((m) => ({ Component: m.HoldsPage })) },
  ],
});
