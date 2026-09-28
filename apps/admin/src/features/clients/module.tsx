import { Users } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'clients',
  nav: {
    group: 'acteurs',
    label: 'Clients',
    icon: <Users />,
    order: 30,
    keywords: ['comptes', 'avoirs', 'blocage', 'rgpd', 'remboursements', 'risque'],
  },
  permission: 'customers.view',
  routes: [
    { path: 'clients', lazy: () => import('./ClientsPage').then((m) => ({ Component: m.ClientsPage })) },
    { path: 'clients/:userId', lazy: () => import('./ClientPage').then((m) => ({ Component: m.ClientPage })) },
  ],
});
