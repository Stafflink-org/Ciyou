import { HeartHandshake } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'fidelite',
  nav: {
    group: 'croissance',
    label: 'Fidélité et parrainage',
    icon: <HeartHandshake />,
    order: 20,
    keywords: ['points', 'récompenses', 'parrain', 'filleul', 'bouche-à-oreille', 'crédit publicitaire', 'prime'],
  },
  permission: 'loyalty.edit',
  routes: [
    { path: 'fidelite', lazy: () => import('./LoyaltyPage').then((m) => ({ Component: m.LoyaltyPage })) },
    { path: 'fidelite/parrainage', lazy: () => import('./ReferralPage').then((m) => ({ Component: m.ReferralPage })) },
  ],
});
