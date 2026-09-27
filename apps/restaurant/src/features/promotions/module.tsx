import { BadgePercent } from 'lucide-react';
import { defineModule } from '@/app/define-module';

export default defineModule({
  id: 'promotions',
  nav: { group: 'marketing', label: 'Codes promo', icon: <BadgePercent />, order: 10, keywords: ['promotion', 'remise', 'réduction', 'offre', 'code'] },
  permission: 'marketing.manage',
  routes: [
    { path: 'promotions', lazy: () => import('./PromotionsPage').then((m) => ({ Component: m.PromotionsPage })) },
    { path: 'promotions/:promotionId', lazy: () => import('./PromotionPage').then((m) => ({ Component: m.PromotionPage })) },
  ],
});
