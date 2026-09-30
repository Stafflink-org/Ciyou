import { Users } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'employes',
  nav: { group: 'equipe', label: 'Employés', icon: <Users />, order: 10, keywords: ['salariés', 'contrats', 'fiches', 'personnel', 'RH'], feature: 'team' },
  permission: 'team.view',
  routes: [
    { path: 'equipe/employes', lazy: () => import('./EmployeesPage').then((m) => ({ Component: m.EmployeesPage })) },
    { path: 'equipe/employes/:employeeId', lazy: () => import('./EmployeePage').then((m) => ({ Component: m.EmployeePage })) },
  ],
});
