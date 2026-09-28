import { ClipboardList } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'reglages-commandes',
  nav: {
    group: 'configuration',
    label: 'Réglages des commandes',
    icon: <ClipboardList />,
    order: 30,
    keywords: ['préparation', 'acceptation automatique', 'retrait', 'livraison', 'sur place', 'programmées', 'minimum'],
    hidden: true, // regroupé dans le hub Paramètres (features/parametres)
  },
  permission: 'settings.manage',
  routes: [{ path: 'reglages-commandes', lazy: () => import('./ReglagesCommandesPage').then((m) => ({ Component: m.ReglagesCommandesPage })) }],
});
