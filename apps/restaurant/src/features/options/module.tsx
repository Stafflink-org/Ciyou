import { ListChecks } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'options',
  nav: {
    group: 'carte',
    label: 'Options & listes',
    icon: <ListChecks />,
    order: 20,
    keywords: ['suppléments', 'sauces', 'cuisson', 'choix', 'modificateurs'],
  },
  permission: 'menu.view',
  routes: [{ path: 'options', lazy: () => import('./OptionsPage').then((m) => ({ Component: m.OptionsPage })) }],
});
