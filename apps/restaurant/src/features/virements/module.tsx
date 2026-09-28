import { Banknote } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'virements',
  nav: { group: 'finances', label: 'Virements', icon: <Banknote />, order: 30, keywords: ['reversement', 'relevé', 'paiement', 'Stripe', 'retenue'] },
  permission: 'finance.view',
  routes: [
    { path: 'virements', lazy: () => import('./VirementsPage').then((page) => ({ Component: page.VirementsPage })) },
    { path: 'virements/:payoutId', lazy: () => import('./VirementsPage').then((page) => ({ Component: page.VirementsPage })) },
  ],
});
