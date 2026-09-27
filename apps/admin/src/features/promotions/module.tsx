import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { TicketPercent } from 'lucide-react';
import { COLLECTIONS, type Promotion } from '@golink/shared';
import { defineModule } from '@/app/define-module';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';

/** Pastille : offres de restaurants en attente de validation. */
function usePendingPromotionsCount(): number | null {
  const { can } = useAdminAccess();
  const allowed = can('promotions.edit');
  const q = useMemo(() => (allowed ? query(collection(db, COLLECTIONS.promotions), where('status', '==', 'pending_review')) : null), [allowed]);
  const { data } = useCollection<Promotion>(q);
  return data.length || null;
}

export default defineModule({
  id: 'promotions',
  nav: {
    group: 'croissance',
    label: 'Promotions',
    icon: <TicketPercent />,
    order: 10,
    badge: usePendingPromotionsCount,
    keywords: ['offres', 'codes promo', 'réduction', 'remise', 'livraison offerte', 'validation', 'coût'],
  },
  permission: 'promotions.view',
  routes: [
    { path: 'promotions', lazy: () => import('./PromotionsPage').then((m) => ({ Component: m.PromotionsPage })) },
    { path: 'promotions/regles', lazy: () => import('./RulesPage').then((m) => ({ Component: m.RulesPage })) },
    { path: 'promotions/:promotionId', lazy: () => import('./PromotionPage').then((m) => ({ Component: m.PromotionPage })) },
  ],
});
