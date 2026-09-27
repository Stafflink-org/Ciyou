import { Megaphone } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'campagnes',
  nav: { group: 'marketing', label: 'Campagnes', icon: <Megaphone />, order: 20, keywords: ['notification', 'push', 'e-mail', 'newsletter', 'envoi'] },
  permission: 'marketing.manage',
  routes: [{ path: 'campagnes', lazy: () => import('./CampaignsPage').then((m) => ({ Component: m.CampaignsPage })) }],
});
