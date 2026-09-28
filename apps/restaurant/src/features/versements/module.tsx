import { Landmark } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'versements',
  nav: {
    group: 'configuration',
    label: 'Compte de versement',
    icon: <Landmark />,
    order: 90,
    hidden: true, // regroupé dans le hub Paiement (features/paiement)
    keywords: ['stripe', 'iban', 'banque', 'versements', 'virements', 'reversements'],
  },
  permission: 'finance.view',
  routes: [{ path: 'versements', lazy: () => import('./VersementsPage').then((m) => ({ Component: m.VersementsPage })) }],
});
