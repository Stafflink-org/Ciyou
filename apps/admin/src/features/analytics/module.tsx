import { ChartNoAxesCombined } from 'lucide-react';
import { defineModule } from '@/app/define-module';

const page = () => import('./AnalyticsPage').then((m) => ({ Component: m.AnalyticsPage }));

export default defineModule({
  id: 'analytics',
  nav: {
    group: 'pilotage',
    label: 'Analytics',
    icon: <ChartNoAxesCombined />,
    order: 20,
    keywords: [
      'statistiques',
      'croissance',
      'rétention',
      'classement',
      'top',
      'flop',
      'livreurs',
      'villes',
      'heures de pointe',
      'mrr',
      'churn',
      'tunnel',
      'conversion',
    ],
  },
  permission: 'analytics.view',
  routes: [
    { path: 'analytics', lazy: page },
    { path: 'analytics/:section', lazy: page },
  ],
});
