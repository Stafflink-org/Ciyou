import { FileCheck } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useDocumentsBadge } from './hooks';

export default defineModule({
  id: 'documents',
  nav: {
    group: 'configuration',
    label: 'Documents & contrat',
    icon: <FileCheck />,
    order: 80,
    hidden: true, // regroupé dans le hub Paramètres (features/parametres)
    badge: useDocumentsBadge,
    keywords: ['kbis', 'pièce d’identité', 'rib', 'licence', 'justificatifs', 'contrat partenaire', 'kyc'],
  },
  permission: 'settings.manage',
  routes: [{ path: 'documents', lazy: () => import('./DocumentsPage').then((m) => ({ Component: m.DocumentsPage })) }],
});
