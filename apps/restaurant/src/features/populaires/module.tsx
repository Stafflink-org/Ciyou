import { Star } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'populaires',
  nav: {
    group: 'marketing',
    label: 'Produits mis en avant',
    icon: <Star />,
    order: 5,
    keywords: ['vitrine', 'populaires', 'best-sellers', 'classement', 'ventes'],
  },
  permission: 'menu.view',
  routes: [{ path: 'produits-populaires', lazy: () => import('./PopularPage').then((m) => ({ Component: m.PopularPage })) }],
});
