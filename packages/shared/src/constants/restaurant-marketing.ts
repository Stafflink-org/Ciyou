// Marketing et relation client côté restaurant : réseaux sociaux, réponses types,
// messages automatiques, segments de campagne et garde-fous communs au
// back-office restaurant et aux Cloud Functions.
import type { Cents } from '../pricing/money';

const values = <const T extends readonly string[]>(list: T): T => list;

// ------------------------------------------------------------------ Réseaux sociaux
export const SOCIAL_NETWORKS = values(['instagram', 'facebook', 'tiktok', 'google', 'website', 'whatsapp']);
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  google: 'Fiche Google',
  website: 'Site web',
  whatsapp: 'WhatsApp',
};

/** Préfixes acceptés pour chaque réseau (contrôlés par les règles et le front). */
export const SOCIAL_NETWORK_HOSTS: Record<SocialNetwork, readonly string[]> = {
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'fb.com', 'm.facebook.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  google: ['g.page', 'maps.app.goo.gl', 'goo.gl', 'google.com', 'www.google.com', 'maps.google.com', 'business.google.com'],
  website: [],
  whatsapp: ['wa.me', 'api.whatsapp.com'],
};

// ------------------------------------------------------------------ Réponses types
export const REPLY_TEMPLATE_KINDS = values(['review_reply', 'customer_message', 'driver_message']);
export type ReplyTemplateKind = (typeof REPLY_TEMPLATE_KINDS)[number];

export const REPLY_TEMPLATE_KIND_LABELS: Record<ReplyTemplateKind, string> = {
  review_reply: 'Réponse à un avis',
  customer_message: 'Message à un client',
  driver_message: 'Message à un livreur',
};

/** Variables utilisables dans une réponse type ou un message automatique. */
export const MESSAGE_VARIABLES = {
  prenom: 'Prénom du client',
  restaurant: 'Nom de l’établissement',
  commande: 'Numéro de commande',
  code: 'Code de retrait',
  minutes: 'Minutes de retard annoncées',
  livreur: 'Prénom du livreur',
} as const;
export type MessageVariable = keyof typeof MESSAGE_VARIABLES;

// ------------------------------------------------------------------ Messages automatiques
export const AUTO_MESSAGE_KEYS = values([
  'order_accepted',
  'order_delayed',
  'order_ready_pickup',
  'order_delivered_thanks',
  'driver_order_ready',
  'review_thanks',
]);
export type AutoMessageKey = (typeof AUTO_MESSAGE_KEYS)[number];

export interface AutoMessageDefinition {
  label: string;
  description: string;
  audience: 'client' | 'driver';
  /** Déclencheur lisible, affiché dans le back-office. */
  trigger: string;
  variables: readonly MessageVariable[];
  defaultBody: string;
}

export const AUTO_MESSAGE_DEFINITIONS: Record<AutoMessageKey, AutoMessageDefinition> = {
  order_accepted: {
    label: 'Commande acceptée',
    description: 'Un mot d’accueil envoyé dans la conversation dès que la commande est acceptée.',
    audience: 'client',
    trigger: 'À l’acceptation de la commande',
    variables: ['prenom', 'restaurant', 'commande'],
    defaultBody: 'Bonjour {{prenom}}, merci pour votre commande {{commande}} ! L’équipe de {{restaurant}} s’en occupe dès maintenant.',
  },
  order_delayed: {
    label: 'Préparation prolongée',
    description: 'Prévient le client lorsque le temps de préparation est rallongé.',
    audience: 'client',
    trigger: 'Quand le temps de préparation est rallongé',
    variables: ['prenom', 'commande', 'minutes'],
    defaultBody: 'Bonjour {{prenom}}, petit contretemps en cuisine : votre commande {{commande}} aura environ {{minutes}} minutes de retard. Merci de votre patience !',
  },
  order_ready_pickup: {
    label: 'Commande prête (retrait)',
    description: 'Indique au client que sa commande à emporter l’attend au comptoir.',
    audience: 'client',
    trigger: 'Commande à emporter prête',
    variables: ['prenom', 'commande', 'code'],
    defaultBody: 'Bonne nouvelle {{prenom}} : votre commande {{commande}} vous attend au comptoir. Présentez le code {{code}} à l’équipe.',
  },
  order_delivered_thanks: {
    label: 'Remerciement après livraison',
    description: 'Un remerciement envoyé une fois la commande livrée ou retirée.',
    audience: 'client',
    trigger: 'Commande livrée ou retirée',
    variables: ['prenom', 'restaurant'],
    defaultBody: 'Merci {{prenom}} d’avoir choisi {{restaurant}} ! Bon appétit, et à très vite.',
  },
  driver_order_ready: {
    label: 'Commande prête (livreur)',
    description: 'Prévient le livreur assigné que la commande l’attend.',
    audience: 'driver',
    trigger: 'Commande en livraison prête',
    variables: ['livreur', 'commande'],
    defaultBody: 'Bonjour {{livreur}}, la commande {{commande}} est prête et vous attend au comptoir.',
  },
  review_thanks: {
    label: 'Remerciement des avis positifs',
    description: 'Réponse publique automatique aux avis de 4 et 5 étoiles restés sans réponse.',
    audience: 'client',
    trigger: 'Avis de 4 ou 5 étoiles publié',
    variables: ['prenom', 'restaurant'],
    defaultBody: 'Merci beaucoup {{prenom}} pour ce retour ! Toute l’équipe de {{restaurant}} est ravie que vous vous soyez régalé.',
  },
};

/** Remplace les variables {{nom}} d'un message ; les variables inconnues restent visibles. */
export function renderMessageTemplate(body: string, vars: Partial<Record<MessageVariable, string>>): string {
  return body.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key as MessageVariable];
    return value === undefined || value === '' ? match : value;
  });
}

/** Variables utilisées dans un texte qui ne font pas partie de la liste autorisée. */
export function unknownMessageVariables(body: string, allowed: readonly string[]): string[] {
  const found = [...body.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1] ?? '');
  return [...new Set(found.filter((key) => !allowed.includes(key)))];
}

// ------------------------------------------------------------------ Campagnes restaurant
export const RESTAURANT_CAMPAIGN_SEGMENTS = values(['all', 'new', 'loyal', 'inactive']);
export type RestaurantCampaignSegment = (typeof RESTAURANT_CAMPAIGN_SEGMENTS)[number];

export const RESTAURANT_CAMPAIGN_SEGMENT_LABELS: Record<RestaurantCampaignSegment, string> = {
  all: 'Tous mes clients',
  new: 'Nouveaux clients',
  loyal: 'Clients fidèles',
  inactive: 'Clients inactifs',
};

export const RESTAURANT_CAMPAIGN_SEGMENT_HINTS: Record<RestaurantCampaignSegment, string> = {
  all: 'Toute personne ayant déjà commandé chez vous.',
  new: 'Une seule commande, passée il y a moins de 30 jours.',
  loyal: 'Au moins 4 commandes chez vous.',
  inactive: 'Aucune commande depuis le nombre de jours choisi.',
};

/** Règles communes aux campagnes des restaurants (appliquées par Cloud Function). */
export const RESTAURANT_CAMPAIGN_RULES = {
  titleMax: 60,
  bodyMax: 240,
  subjectMax: 90,
  /** Nombre maximal d'envois par établissement sur 7 jours glissants. */
  maxSendsPer7Days: 3,
  /** Plage d'envoi autorisée (heure de Paris) : pas de sollicitation la nuit. */
  sendWindow: { fromHour: 9, toHour: 21 },
  /** Délai maximal de programmation. */
  maxScheduleDays: 60,
  loyalMinOrders: 4,
  newMaxAgeDays: 30,
  inactiveDefaultDays: 45,
} as const;

// ------------------------------------------------------------------ Fidélité
/** Garde-fous du programme de fidélité d'un établissement. */
export const RESTAURANT_LOYALTY_RULES = {
  maxRewards: 4,
  /** Taux de retour client maximal (remise / montant à dépenser), en points de base. */
  maxReturnBps: 2000,
  minEveryCents: 50 as Cents,
  maxWelcomePoints: 500,
  maxThresholdPoints: 10_000,
} as const;

// ------------------------------------------------------------------ Avis
export const REVIEW_REPORT_REASONS = values(['fake', 'harassment', 'hate', 'personal_data', 'spam', 'illegal', 'other']);
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

export const REVIEW_REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  fake: 'Avis mensonger ou sans commande réelle',
  harassment: 'Harcèlement ou menaces',
  hate: 'Propos haineux ou discriminatoires',
  personal_data: 'Données personnelles exposées',
  spam: 'Publicité ou spam',
  illegal: 'Contenu illicite',
  other: 'Autre motif',
};

/** Étiquettes d'avis (saisies par les clients) et leurs libellés. */
export const REVIEW_TAG_LABELS: Record<string, string> = {
  bon_rapport_qualite_prix: 'Bon rapport qualité-prix',
  rapide: 'Rapide',
  chaud: 'Servi chaud',
  genereux: 'Portions généreuses',
  emballage_soigne: 'Emballage soigné',
  froid: 'Arrivé froid',
  temperature: 'Température des plats',
  en_retard: 'En retard',
  article_manquant: 'Article manquant',
  portions_petites: 'Portions trop petites',
};

// ------------------------------------------------------------------ Promotions restaurant
/** Limites fixes des promotions restaurant (les plafonds variables sont dans settings/promotions). */
export const RESTAURANT_PROMOTION_RULES = {
  titleMax: 80,
  descriptionMax: 240,
  maxDurationDays: 366,
  maxPerCustomerLimit: 50,
  maxTotalUsageLimit: 100_000,
  maxMinSubtotalCents: 20_000 as Cents,
  inactiveDaysMin: 14,
  inactiveDaysMax: 365,
} as const;

// ------------------------------------------------------------------ Liens publics
/** Site public GoLink (pages établissement partageables). */
export const CLIENT_WEB_URL = 'https://golink.fr';
/** Schéma de l'app client (liens profonds). */
export const CLIENT_APP_SCHEME = 'golink-client';

/** Lien web partageable d'un établissement (redirige vers l'app si elle est installée). */
export function restaurantPublicUrl(slug: string, campaign?: string): string {
  const url = `${CLIENT_WEB_URL}/r/${encodeURIComponent(slug)}`;
  return campaign ? `${url}?utm_source=${encodeURIComponent(campaign)}&utm_medium=partage` : url;
}

/** Lien profond ouvrant directement l'établissement dans l'app client. */
export function restaurantAppDeepLink(restaurantId: string): string {
  return `${CLIENT_APP_SCHEME}://restaurant/${encodeURIComponent(restaurantId)}`;
}
