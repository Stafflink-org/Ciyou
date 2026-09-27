import { CreditCard } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'paiements',
  nav: {
    group: 'argent',
    label: 'Paiements',
    icon: <CreditCard />,
    order: 10,
    keywords: ['moyens de paiement', 'carte', 'espèces', 'pourboires', 'paiements échoués', 'remboursements', 'frais'],
  },
  permission: 'payments.view',
  routes: [
    { path: 'paiements', lazy: () => import('./TransactionsPage').then((m) => ({ Component: m.TransactionsPage })) },
    { path: 'paiements/moyens', lazy: () => import('./MethodsPage').then((m) => ({ Component: m.MethodsPage })) },
    { path: 'paiements/especes', lazy: () => import('./CashPage').then((m) => ({ Component: m.CashPage })) },
    { path: 'paiements/prestataires', lazy: () => import('./ProvidersPage').then((m) => ({ Component: m.ProvidersPage })) },
    { path: 'paiements/regles', lazy: () => import('./RulesPage').then((m) => ({ Component: m.RulesPage })) },
  ],
});
