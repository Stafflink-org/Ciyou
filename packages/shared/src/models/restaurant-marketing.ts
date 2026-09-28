// Marketing et relation client d'un établissement : profil social et kit de
// partage, messages automatiques, réponses types.
import type { AutoMessageKey, ReplyTemplateKind, SocialNetwork } from '../constants/restaurant-marketing';
import type { Timestamp, Tracked } from './common';

/**
 * restaurants/{rid}/marketing/social : comptes publics de l'établissement et
 * texte d'accompagnement du kit de partage. Lecture publique (fiche client).
 */
export interface RestaurantSocialProfile {
  links: Partial<Record<SocialNetwork, string>>;
  /** Texte proposé avec le lien de partage (réseaux, messageries). */
  shareMessage: string;
  hashtags: string[];
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface AutoMessageSetting {
  enabled: boolean;
  body: string;
}

/** restaurants/{rid}/marketing/autoMessages : messages envoyés automatiquement (Cloud Functions). */
export interface RestaurantAutoMessages {
  messages: Partial<Record<AutoMessageKey, AutoMessageSetting>>;
  updatedAt: Timestamp;
  updatedBy: string;
}

/** restaurants/{rid}/replyTemplates/{id} : réponse type réutilisable (avis, messagerie). */
export interface ReplyTemplate extends Tracked {
  kind: ReplyTemplateKind;
  title: string;
  body: string;
  /** Notes d'avis pour lesquelles la réponse est suggérée (1 à 5). */
  ratings: number[];
  /** Raccourci de saisie, ex. « /merci ». */
  shortcut?: string | null;
  usageCount: number;
  lastUsedAt?: Timestamp | null;
}

// ------------------------------------------------------------------ Offres sur un plat

/** Types d'offre automatique sur un plat : « 1 acheté, 1 offert » et « Le 2e à -50 % ». */
export const PRODUCT_OFFER_KINDS = ['bogo', 'half_second'] as const;
export type ProductOfferKind = (typeof PRODUCT_OFFER_KINDS)[number];

/** Statut calculé d'une offre (jamais stocké) : en ligne, programmée, en pause, terminée, désactivée par Ciyou Eats. */
export const PRODUCT_OFFER_STATUSES = ['live', 'scheduled', 'paused', 'ended', 'disabled'] as const;
export type ProductOfferStatus = (typeof PRODUCT_OFFER_STATUSES)[number];

/** Désactivation d'une offre par l'équipe Ciyou Eats (abus, plat non conforme…) : le commerce ne peut pas la réactiver. */
export interface ProductOfferModeration {
  reason: string;
  by: string;
  byName?: string | null;
  at: Timestamp;
}

/**
 * restaurants/{rid}/productOffers/{offerId} : offre automatique sur un plat, financée par le
 * commerce, distincte des campagnes de communication. Écriture par Cloud Functions uniquement ;
 * les champs de marché (pays, ville) et le nom du commerce sont recopiés pour la vue du super admin.
 */
export interface ProductOffer extends Tracked {
  restaurantId: string;
  restaurantName: string;
  countryId: string;
  cityId: string;
  kind: ProductOfferKind;
  productId: string;
  productName: string;
  /** Titre affiché au client (3 à 70 caractères). */
  title: string;
  /** Message d'accroche (10 à 180 caractères). */
  message: string;
  /** Période AAAA-MM-JJ incluse ; fin nulle = sans date de fin. */
  startDay: string;
  endDay: string | null;
  /** Mise en pause par le commerce. */
  active: boolean;
  /** Désactivation par Ciyou Eats (prime sur `active`). */
  disabledByPlatform?: ProductOfferModeration | null;
  /** Compteurs tenus par les fonctions de commande. */
  ordersCount?: number;
  discountTotalCents?: number;
}

/** Statut d'une offre à une date donnée (AAAA-MM-JJ, fuseau du marché). */
export function productOfferStatus(offer: Pick<ProductOffer, 'active' | 'startDay' | 'endDay' | 'disabledByPlatform'>, today: string): ProductOfferStatus {
  if (offer.disabledByPlatform) return 'disabled';
  if (offer.endDay && offer.endDay < today) return 'ended';
  if (!offer.active) return 'paused';
  if (offer.startDay > today) return 'scheduled';
  return 'live';
}
