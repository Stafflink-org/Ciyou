import { Share2 } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'reseaux-sociaux',
  nav: { group: 'marketing', label: 'Réseaux sociaux', icon: <Share2 />, order: 50, keywords: ['instagram', 'facebook', 'qr code', 'partage', 'visuel', 'affiche'] },
  permission: 'marketing.manage',
  routes: [{ path: 'reseaux-sociaux', lazy: () => import('./SocialPage').then((m) => ({ Component: m.SocialPage })) }],
});
