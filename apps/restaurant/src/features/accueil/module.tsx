import { House } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'accueil',
  nav: { group: 'pilotage', label: 'Accueil', icon: <House />, order: 0, keywords: ['tableau de bord', 'résumé'] },
  permission: 'dashboard.view',
  routes: [{ index: true, lazy: () => import('./AccueilPage').then((page) => ({ Component: page.AccueilPage })) }],
});
