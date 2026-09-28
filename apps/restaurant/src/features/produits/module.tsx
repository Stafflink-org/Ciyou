import { UtensilsCrossed } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'produits',
  nav: {
    group: 'carte',
    label: 'Produits & menu',
    icon: <UtensilsCrossed />,
    order: 10,
    keywords: ['carte', 'menu', 'sections', 'plats', 'allergènes', 'import', 'csv'],
  },
  permission: 'menu.view',
  routes: [
    { path: 'produits', lazy: () => import('./ProductsPage').then((m) => ({ Component: m.ProductsPage })) },
    { path: 'produits/nouveau', lazy: () => import('./ProductEditorPage').then((m) => ({ Component: m.ProductEditorPage })) },
    { path: 'produits/:productId', lazy: () => import('./ProductEditorPage').then((m) => ({ Component: m.ProductEditorPage })) },
  ],
});
