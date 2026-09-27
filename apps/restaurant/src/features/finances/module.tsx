import { Landmark } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'finances',
  nav: {
    group: 'finances',
    label: 'Finances & ventes',
    icon: <Landmark />,
    order: 10,
    keywords: ['chiffre d’affaires', 'ventes', 'commission', 'net', 'panier moyen', 'export'],
  },
  permission: 'finance.view',
  routes: [{ path: 'finances', lazy: () => import('./FinancesPage').then((page) => ({ Component: page.FinancesPage })) }],
});
