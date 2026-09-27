import { FileBarChart } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'rapports',
  nav: {
    group: 'pilotage',
    label: 'Rapports et exports',
    icon: <FileBarChart />,
    order: 30,
    keywords: ['export', 'csv', 'excel', 'pdf', 'comptabilité', 'investisseurs', 'rapport automatique', 'e-mail'],
  },
  permission: 'reports.view',
  routes: [
    { path: 'rapports', lazy: () => import('./ExportsPage').then((m) => ({ Component: m.ExportsPage })) },
    { path: 'rapports/programmes', lazy: () => import('./ScheduledReportsPage').then((m) => ({ Component: m.ScheduledReportsPage })) },
  ],
});
