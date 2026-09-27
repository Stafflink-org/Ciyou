import { LayoutDashboard } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'accueil',
  nav: {
    group: 'pilotage',
    label: 'Tableau de bord',
    icon: <LayoutDashboard />,
    order: 0,
    keywords: ['accueil', 'synthèse', 'kpi', 'chiffres clés', 'alertes', 'à traiter', 'activité'],
  },
  permission: 'dashboard.view',
  routes: [
    {
      index: true,
      lazy: () =>
        import('./AccueilPage').then((page) => ({
          Component: page.AccueilPage,
        })),
    },
  ],
});
