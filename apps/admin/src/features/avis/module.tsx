import type { ComponentType } from 'react';
import { Star } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useModerationQueueCount } from './hooks';

const page = <T,>(loader: () => Promise<T>, pick: (m: T) => ComponentType) => () => loader().then((m) => ({ Component: pick(m) }));

export default defineModule({
  id: 'avis',
  nav: {
    group: 'operations',
    label: 'Avis et notes',
    icon: <Star />,
    order: 120,
    badge: useModerationQueueCount,
    keywords: ['notes', 'modération', 'signalements', 'insultes', 'réponses', 'qualité', 'DSA'],
  },
  permission: 'reviews.view',
  routes: [
    { path: 'avis', lazy: page(() => import('./ReviewsPage'), (m) => m.ReviewsPage) },
    { path: 'avis/qualite', lazy: page(() => import('./QualityPage'), (m) => m.QualityPage) },
    { path: 'avis/signalements', lazy: page(() => import('./ReportsPage'), (m) => m.ReportsPage) },
    { path: 'avis/filtre', lazy: page(() => import('./FilterPage'), (m) => m.FilterPage) },
    { path: 'avis/:orderId', lazy: page(() => import('./ReviewsPage'), (m) => m.ReviewsPage) },
  ],
});
