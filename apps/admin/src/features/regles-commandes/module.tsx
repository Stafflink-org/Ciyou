import { Workflow } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'regles-commandes',
  nav: {
    group: 'operations',
    label: 'Règles automatiques',
    icon: <Workflow />,
    order: 30,
    keywords: ['délai d’acceptation', 'annulation', 'remboursement', 'client absent', 'avoir', 'retard', 'commandes programmées', 'alcool'],
  },
  permission: 'orders.view',
  routes: [{ path: 'regles-commandes', lazy: () => import('./OrderRulesPage').then((m) => ({ Component: m.OrderRulesPage })) }],
});
