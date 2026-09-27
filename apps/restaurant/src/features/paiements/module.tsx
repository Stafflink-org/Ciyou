import { CreditCard } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'paiements',
  nav: {
    group: 'configuration',
    label: 'Moyens de paiement',
    icon: <CreditCard />,
    order: 50,
    keywords: ['carte', 'espèces', 'titres-restaurant', 'apple pay', 'encaissement'],
  },
  permission: 'settings.manage',
  routes: [{ path: 'paiements', lazy: () => import('./PaiementsPage').then((m) => ({ Component: m.PaiementsPage })) }],
});
