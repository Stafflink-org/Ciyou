import { FileText } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'factures',
  nav: {
    group: 'finances',
    label: 'Factures',
    icon: <FileText />,
    order: 40,
    keywords: ['facture', 'avoir', 'TVA', 'commission', 'abonnement', 'PDF'],
    hidden: true, // regroupé dans le hub Paiement (features/paiement)
  },
  permission: 'invoices.view',
  routes: [
    { path: 'factures', lazy: () => import('./FacturesPage').then((page) => ({ Component: page.FacturesPage })) },
    { path: 'factures/:invoiceId', lazy: () => import('./FacturesPage').then((page) => ({ Component: page.FacturesPage })) },
  ],
});
