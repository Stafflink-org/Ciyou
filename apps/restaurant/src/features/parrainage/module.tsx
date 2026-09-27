import { Handshake } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'parrainage',
  nav: { group: 'marketing', label: 'Parrainage', icon: <Handshake />, order: 40, keywords: ['parrain', 'lien', 'crédit publicitaire', 'inscrire un commerce', 'code'] },
  permission: 'settings.manage',
  routes: [{ path: 'parrainage', lazy: () => import('./ReferralPage').then((m) => ({ Component: m.ReferralPage })) }],
});
