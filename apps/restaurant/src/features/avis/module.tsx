import { Star } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useUnansweredReviewsCount } from './lib';

export default defineModule({
  id: 'avis',
  nav: {
    group: 'marketing',
    label: 'Avis clients',
    icon: <Star />,
    order: 40,
    hidden: true, // regroupé dans le hub Marketing (features/marketing)
    badge: useUnansweredReviewsCount,
    keywords: ['note', 'étoiles', 'réputation', 'commentaire', 'réponse'],
  },
  permission: 'reviews.reply',
  routes: [{ path: 'avis', lazy: () => import('./ReviewsPage').then((m) => ({ Component: m.ReviewsPage })) }],
});
