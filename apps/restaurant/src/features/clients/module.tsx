import { Users } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'clients',
  nav: { group: 'clients', label: 'Clients', icon: <Users />, order: 10, keywords: ['CRM', 'fidèles', 'inactifs', 'bloquer', 'notes'] },
  permission: 'customers.view',
  routes: [
    { path: 'clients', lazy: () => import('./ClientsPage').then((page) => ({ Component: page.ClientsPage })) },
    { path: 'clients/:customerId', lazy: () => import('./ClientsPage').then((page) => ({ Component: page.ClientsPage })) },
  ],
});
