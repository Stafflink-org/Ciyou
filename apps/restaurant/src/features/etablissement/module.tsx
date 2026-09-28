import { Store } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'etablissement',
  nav: {
    group: 'configuration',
    label: 'Établissement',
    icon: <Store />,
    order: 10,
    keywords: ['profil', 'adresse', 'logo', 'photos', 'siret', 'tva', 'mentions légales', 'allergènes'],
    hidden: true, // regroupé dans le hub Paramètres (features/parametres)
  },
  permission: 'settings.manage',
  routes: [{ path: 'etablissement', lazy: () => import('./EtablissementPage').then((m) => ({ Component: m.EtablissementPage })) }],
});
