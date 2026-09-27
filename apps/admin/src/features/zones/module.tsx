import { Map } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'zones',
  nav: {
    group: 'operations',
    label: 'Zones et villes',
    icon: <Map />,
    order: 40,
    keywords: ['carte', 'polygone', 'tarifs', 'horaires de service', 'fermeture d’urgence', 'heures de pointe', 'majoration', 'lancement'],
  },
  permission: 'zones.edit',
  routes: [
    { path: 'zones', lazy: () => import('./ZonesPage').then((m) => ({ Component: m.ZonesPage })) },
    { path: 'zones/:zoneId', lazy: () => import('./ZonesPage').then((m) => ({ Component: m.ZonesPage })) },
    { path: 'villes/:cityId', lazy: () => import('./ZonesPage').then((m) => ({ Component: m.ZonesPage })) },
  ],
});
