import { Megaphone } from 'lucide-react';
import { defineModule } from '@/app/define-module';
import { useUnansweredReviewsCount } from '../avis/lib';

export default defineModule({
  id: 'marketing',
  nav: {
    group: 'marketing',
    label: 'Marketing',
    icon: <Megaphone />,
    order: 10,
    // Pastille reprise de « Avis clients » (seule rubrique agrégée avec un compteur) :
    // un avis sans réponse reste visible dès l'entrée du hub.
    badge: useUnansweredReviewsCount,
    keywords: [
      'offre',
      'annonce',
      'codes promo',
      'produits mis en avant',
      'campagnes',
      'fidélité',
      'avis clients',
      'réseaux sociaux',
      'modèles',
      'communication',
    ],
  },
  // Aucune permission au niveau du hub : chaque carte applique la sienne
  // (marketing.manage, reviews.reply, menu.view) et se masque sinon.
  routes: [{ path: 'marketing', lazy: () => import('./MarketingPage').then((m) => ({ Component: m.MarketingPage })) }],
});
