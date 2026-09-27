import { Bike } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'livreurs',
  nav: { group: 'clients', label: 'Livreurs', icon: <Bike />, order: 20, keywords: ['coursier', 'livraison', 'bloquer', 'inviter', 'flotte'] },
  permission: 'couriers.manage',
  routes: [
    { path: 'livreurs', lazy: () => import('./LivreursPage').then((page) => ({ Component: page.LivreursPage })) },
    { path: 'livreurs/:driverId', lazy: () => import('./LivreursPage').then((page) => ({ Component: page.LivreursPage })) },
  ],
});
