import { Heart } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'fidelite',
  nav: {
    group: 'marketing',
    label: 'Fidélité',
    icon: <Heart />,
    order: 30,
    keywords: ['points', 'récompense', 'programme', 'carte de fidélité'],
    hidden: true, // regroupé dans le hub Marketing (features/marketing)
    feature: 'loyalty',
  },
  permission: 'marketing.manage',
  routes: [{ path: 'fidelite', lazy: () => import('./LoyaltyPage').then((m) => ({ Component: m.LoyaltyPage })) }],
});
