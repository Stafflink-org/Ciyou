import { Clock3 } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'pointages',
  nav: { group: 'equipe', label: 'Pointages', icon: <Clock3 />, order: 30, keywords: ['pointeuse', 'badgeuse', 'heures', 'arrivée', 'sortie', 'pause'], feature: 'timeclock' },
  permission: 'timeclock.self',
  routes: [{ path: 'equipe/pointages', lazy: () => import('./PointagesPage').then((m) => ({ Component: m.PointagesPage })) }],
});
