import { ClipboardCheck, LayoutTemplate, ListTodo } from 'lucide-react';

export const TASK_NAV = [
  { to: '/equipe/taches', label: 'Tâches', icon: <ListTodo />, end: true },
  { to: '/equipe/taches/checklists', label: 'Checklists du jour', icon: <ClipboardCheck /> },
  { to: '/equipe/taches/modeles', label: 'Modèles', icon: <LayoutTemplate /> },
];
