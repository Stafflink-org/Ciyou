import { ListTodo } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'taches',
  nav: { group: 'equipe', label: 'Tâches', icon: <ListTodo />, order: 60, keywords: ['to-do', 'checklist', 'ouverture', 'fermeture', 'missions'] },
  permission: 'tasks.view',
  routes: [
    { path: 'equipe/taches', lazy: () => import('./TasksPage').then((m) => ({ Component: m.TasksPage })) },
    { path: 'equipe/taches/checklists', lazy: () => import('./ChecklistsPage').then((m) => ({ Component: m.ChecklistsPage })) },
    { path: 'equipe/taches/modeles', lazy: () => import('./TemplatesPage').then((m) => ({ Component: m.TemplatesPage })) },
  ],
});
