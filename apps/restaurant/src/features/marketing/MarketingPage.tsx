// Hub Marketing (plan V2 §3.3) : un seul lien de menu, des cartes vers les rubriques
// marketing existantes (aucune duplication de code, pas d'onglets pour garder la
// lisibilité). Chaque rubrique reste une page à part entière, accessible aussi par son
// URL directe ; son fil d'Ariane propose « Retour à Marketing ».
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BadgePercent, FileText, Gift, Heart, Megaphone, Share2, Star } from 'lucide-react';
import { Badge, Card, PageContainer, PageHeader, Skeleton } from '@golink/ui';
import { AccessDeniedPanel, useDocumentTitle } from '@golink/web';
import type { PlanFeatureKey, RestaurantPermission } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { useEntitlements } from '@/auth/useEntitlements';
import { productOfferStatus, today, useRestaurantOffers } from '../annonces/lib';
import { displayStatus, useRestaurantPromotions } from '../promotions/lib';
import { useRestaurantCampaigns } from '../campagnes/lib';
import { useUnansweredReviewsCount } from '../avis/lib';

interface MarketingCard {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  permission: RestaurantPermission;
  /** Fonctionnalité de formule requise en plus de la permission (absente : toujours proposée, comme Réseaux sociaux et Annonces). */
  feature?: PlanFeatureKey;
  summary: ReactNode;
  loading?: boolean;
}

/** Hub « Marketing » : cartes vers les rubriques de communication et de fidélisation existantes. */
export function MarketingPage() {
  useDocumentTitle('Marketing · Ciyou Eats Restaurant');
  const { restaurant } = useRestaurantAccess();
  const can = useCan();
  const { hasFeature } = useEntitlements();

  const offers = useRestaurantOffers();
  const promotions = useRestaurantPromotions();
  const campaigns = useRestaurantCampaigns();
  const unanswered = useUnansweredReviewsCount();

  const liveOffers = offers.data.filter((o) => productOfferStatus(o, today()) === 'live').length;
  const activePromotions = promotions.data.filter((p) => ['active', 'scheduled', 'paused'].includes(displayStatus(p))).length;
  const scheduledCampaigns = campaigns.data.filter((c) => c.status === 'scheduled').length;

  const cards: MarketingCard[] = [
    {
      href: '/annonces',
      label: 'Annonces & offres',
      description: '« Offert » ou « -50 % » sur un plat, sans code à saisir.',
      icon: <Gift />,
      permission: 'marketing.manage',
      loading: offers.loading,
      summary: offers.loading ? '…' : `${liveOffers} offre${liveOffers > 1 ? 's' : ''} en ligne`,
    },
    {
      href: '/promotions',
      label: 'Codes promo',
      description: 'Remises à code, plafonnées par la plateforme.',
      icon: <BadgePercent />,
      permission: 'marketing.manage',
      feature: 'promo_codes',
      loading: promotions.loading,
      summary: promotions.loading ? '…' : `${activePromotions} code${activePromotions > 1 ? 's' : ''} actif${activePromotions > 1 ? 's' : ''}`,
    },
    {
      href: '/produits-populaires',
      label: 'Produits mis en avant',
      description: 'Vos incontournables en tête de votre vitrine.',
      icon: <Star />,
      permission: 'menu.view',
      summary: 'Ordre géré par vos ventes',
    },
    {
      href: '/campagnes',
      label: 'Campagnes',
      description: 'Notifications et e-mails, immédiats ou programmés.',
      icon: <Megaphone />,
      permission: 'marketing.manage',
      feature: 'push_campaigns',
      loading: campaigns.loading,
      summary: campaigns.loading ? '…' : scheduledCampaigns > 0 ? `${scheduledCampaigns} programmée${scheduledCampaigns > 1 ? 's' : ''}` : 'Aucune campagne programmée',
    },
    {
      href: '/fidelite',
      label: 'Fidélité',
      description: 'Points cumulés et récompenses à chaque commande.',
      icon: <Heart />,
      permission: 'marketing.manage',
      feature: 'loyalty',
      summary: 'Programme configurable',
    },
    {
      href: '/avis',
      label: 'Avis clients',
      description: 'Répondez publiquement et signalez les abus.',
      icon: <Star />,
      permission: 'reviews.reply',
      summary: unanswered ? `${unanswered} avis sans réponse` : 'Tous les avis ont une réponse',
    },
    {
      href: '/reseaux-sociaux',
      label: 'Réseaux sociaux',
      description: 'Lien de commande, QR code et visuels prêts à publier.',
      icon: <Share2 />,
      permission: 'marketing.manage',
      summary: 'Visuels et QR code',
    },
    {
      href: '/modeles',
      label: 'Modèles',
      description: 'Réponses types et messages automatiques.',
      icon: <FileText />,
      permission: 'marketing.manage',
      summary: 'Gabarits réutilisables',
    },
  ];

  const visible = cards.filter((card) => can(card.permission) && (!card.feature || hasFeature(card.feature)));

  if (visible.length === 0) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Marketing" title="Marketing" description={`Communication, fidélisation et réputation de ${restaurant.name}.`} />
        <AccessDeniedPanel description="Vous n’avez pas accès aux rubriques marketing de cet établissement." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Marketing"
        title="Marketing"
        description={`Faites connaître ${restaurant.name}, fidélisez vos clients et suivez votre réputation, au même endroit.`}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((card) => (
          <Link key={card.href} to={card.href} className="group rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Card interactive className="flex h-full items-start gap-4 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-fg-muted transition-colors group-hover:bg-primary-soft group-hover:text-primary-soft-fg [&_svg]:size-5">
                {card.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">{card.label}</span>
                  <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-xs text-fg-subtle">{card.description}</span>
                {card.loading ? <Skeleton className="mt-3 h-5 w-32" /> : <Badge className="mt-3 max-w-full truncate">{card.summary}</Badge>}
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
