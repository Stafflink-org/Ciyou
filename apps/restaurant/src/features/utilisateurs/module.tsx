import { ShieldCheck } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'utilisateurs',
  nav: {
    group: 'configuration',
    label: 'Utilisateurs & accès',
    icon: <ShieldCheck />,
    order: 70,
    keywords: ['membres', 'rôles', 'permissions', 'inviter', 'accès', 'révoquer'],
    hidden: true, // regroupé dans le hub Paramètres (features/parametres)
  },
  permission: 'team.view',
  routes: [{ path: 'utilisateurs', lazy: () => import('./UtilisateursPage').then((m) => ({ Component: m.UtilisateursPage })) }],
});
