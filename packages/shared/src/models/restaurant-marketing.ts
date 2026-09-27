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
