import type { ComponentType } from 'react';
import { Store } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useValidationQueueCount } from './hooks';

const page = <T,>(loader: () => Promise<T>, pick: (m: T) => ComponentType) => () => loader().then((m) => ({ Component: pick(m) }));

export default defineModule({
  id: 'restaurants',
  nav: {
    group: 'acteurs',
    label: 'Restaurants',
    icon: <Store />,
    order: 10,
    badge: useValidationQueueCount,
    keywords: ['commerces', 'partenaires', 'validation', 'documents', 'commission', 'suspension', 'import', 'groupes', 'chaînes', 'qualité', 'allergènes'],
  },
  permission: 'restaurants.view',
  routes: [
    { path: 'restaurants', lazy: page(() => import('./RestaurantsPage'), (m) => m.RestaurantsPage) },
    { path: 'restaurants/validation', lazy: page(() => import('./ValidationPage'), (m) => m.ValidationPage) },
    { path: 'restaurants/qualite', lazy: page(() => import('./QualityPage'), (m) => m.QualityPage) },
    { path: 'restaurants/groupes', lazy: page(() => import('./GroupsPage'), (m) => m.GroupsPage) },
    { path: 'restaurants/import', lazy: page(() => import('./ImportPage'), (m) => m.ImportPage) },
    { path: 'restaurants/:restaurantId', lazy: page(() => import('./RestaurantPage'), (m) => m.RestaurantPage) },
  ],
});
