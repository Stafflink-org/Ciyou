import { Gem } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'abonnement',
  nav: {
    group: 'configuration',
    label: 'Abonnement',
    icon: <Gem />,
    order: 100,
    hidden: true, // regroupé dans le hub Paiement (features/paiement)
    keywords: ['formule', 'basic', 'pro', 'premium', 'commission', 'factures d’abonnement'],
  },
  permission: 'finance.view',
  routes: [{ path: 'abonnement', lazy: () => import('./AbonnementPage').then((m) => ({ Component: m.AbonnementPage })) }],
});
