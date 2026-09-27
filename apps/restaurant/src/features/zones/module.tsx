import { MapPinned } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'zones',
  nav: {
    group: 'configuration',
    label: 'Zones de livraison',
    icon: <MapPinned />,
    order: 40,
    keywords: ['rayon', 'carte', 'frais de livraison', 'secteur', 'livreurs'],
  },
  permission: 'zones.manage',
  routes: [{ path: 'zones', lazy: () => import('./ZonesPage').then((m) => ({ Component: m.ZonesPage })) }],
});
