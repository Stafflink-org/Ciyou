import { Search } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'recherche',
  nav: {
    group: 'pilotage',
    label: 'Recherche',
    icon: <Search />,
    order: 10,
    keywords: ['chercher', 'trouver', 'commande', 'siret', 'e-mail', 'téléphone', 'facture', 'ticket'],
  },
  permission: 'search.use',
  routes: [{ path: 'recherche', lazy: () => import('./SearchPage').then((m) => ({ Component: m.SearchPage })) }],
});
