import { Gift } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'annonces',
  nav: {
    group: 'marketing',
    label: 'Offres sur vos plats',
    icon: <Gift />,
    order: 11,
    keywords: ['offre', 'annonce', 'plat', 'gratuit', 'offert', '2e', 'bogo'],
    hidden: true, // regroupé dans le hub Marketing (features/marketing)
  },
  permission: 'marketing.manage',
  routes: [{ path: 'annonces', lazy: () => import('./AnnoncesPage').then((m) => ({ Component: m.AnnoncesPage })) }],
});
