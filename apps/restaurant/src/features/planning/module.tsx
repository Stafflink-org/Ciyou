import { CalendarDays } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'planning',
  nav: { group: 'equipe', label: 'Planning', icon: <CalendarDays />, order: 20, keywords: ['horaires', 'services', 'semaine', 'shifts', 'roulement'], feature: 'planning' },
  permission: 'planning.view',
  routes: [{ path: 'equipe/planning', lazy: () => import('./PlanningPage').then((m) => ({ Component: m.PlanningPage })) }],
});
