import { ReceiptText } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useOverdueInvoicesCount } from './hooks';

export default defineModule({
  id: 'facturation',
  nav: {
    group: 'argent',
    label: 'Facturation et TVA',
    icon: <ReceiptText />,
    order: 30,
    badge: useOverdueInvoicesCount,
    keywords: ['factures', 'avoirs', 'tva', 'dac7', 'déclaration', 'export comptable', 'relevés livreurs', 'justificatifs'],
  },
  permission: 'invoices.view',
  routes: [
    { path: 'facturation', lazy: () => import('./InvoicesPage').then((m) => ({ Component: m.InvoicesPage })) },
    { path: 'facturation/declarations', lazy: () => import('./DeclarationsPage').then((m) => ({ Component: m.DeclarationsPage })) },
    { path: 'facturation/tva', lazy: () => import('./VatPage').then((m) => ({ Component: m.VatPage })) },
  ],
});
