import { Palmtree } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'absences',
  nav: { group: 'equipe', label: 'Absences', icon: <Palmtree />, order: 40, keywords: ['congés', 'CP', 'RTT', 'maladie', 'arrêt', 'vacances', 'soldes'], feature: 'absences' },
  permission: 'absences.self',
  routes: [{ path: 'equipe/absences', lazy: () => import('./AbsencesPage').then((m) => ({ Component: m.AbsencesPage })) }],
});
