// Données de démonstration du marketing et de la messagerie du back-office restaurant :
// réponses types, messages automatiques, profil social, comptes de fidélité,
// offres, campagnes, conversations, tickets support, motifs et articles d'aide.
// Idempotent (identifiants fixes, préfixe « rmm- ») : npx tsx scripts/seed/only/r-marketing-messagerie.ts
import { Timestamp, type DocumentReference } from '@google-cloud/firestore';
import {
  AUTO_MESSAGE_DEFINITIONS,
  COLLECTIONS,
  RESTAURANT_MARKETING_DOCS,
  SUBCOLLECTIONS,
  formatTicketNumber,
  type Campaign,
  type Conversation,
  type ConversationMessage,
  type HelpArticle,
  type LoyaltyAccount,
  type Promotion,
  type ReplyTemplate,
  type RestaurantAutoMessages,
  type RestaurantCustomer,
  type RestaurantSocialProfile,
  type SupportTicket,
  type TicketMessage,
  type TicketReason,
} from '@golink/shared';
import { db, PROJECT_ID } from '../../lib/admin.mjs';

const MARK = { seed: true, seedModule: 'r-marketing-messagerie' };
const OWNER = 'test-owner-haddad';
const MANAGER = 'test-manager-mina';
const SUPPORT = 'test-support';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();
const at = (offsetMs: number) => Timestamp.fromMillis(now + offsetMs);
const tracked = (offset: number, by: string) => ({ createdAt: at(offset), createdBy: by, updatedAt: at(offset), updatedBy: by });

const writes: Array<[DocumentReference, object]> = [];
const put = (path: string, data: object) => writes.push([db.doc(path), { ...data, ...MARK }]);

/** Prochain créneau d'envoi à 11 h 30, heure de Paris (demain). */
function tomorrowParis(hour: number, minute: number): Timestamp {
  const d = new Date(now + DAY);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const hours = Number(offset.replace('GMT', '') || '0');
  return Timestamp.fromMillis(Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`) - hours * HOUR);
}

// ------------------------------------------------------------------ Réponses types
const TEMPLATES: Array<[string, ReplyTemplate['kind'], string, string, number[], string | null, number]> = [
  ['merci-5', 'review_reply', 'Merci pour un avis 5 étoiles', 'Merci beaucoup {{prenom}} ! Toute l’équipe de {{restaurant}} est ravie que vous vous soyez régalé. À très vite !', [5], '/merci', 14],
  ['merci-4', 'review_reply', 'Avis positif avec une remarque', 'Merci {{prenom}} pour votre retour et votre remarque, que nous avons transmise en cuisine. Au plaisir de vous régaler à nouveau chez {{restaurant}}.', [4], '/merci4', 6],
  ['excuses', 'review_reply', 'Excuses et engagement', 'Bonjour {{prenom}}, nous sommes sincèrement désolés que votre commande n’ait pas été à la hauteur. Nous avons revu ce point avec l’équipe pour que cela ne se reproduise pas. N’hésitez pas à nous écrire via la messagerie Ciyou Eats.', [1, 2, 3], '/excuses', 4],
  ['retard', 'customer_message', 'Retard en cuisine', 'Bonjour {{prenom}}, petit contretemps en cuisine : votre commande {{commande}} part dans une dizaine de minutes. Merci de votre patience !', [], '/retard', 9],
  ['allergenes', 'customer_message', 'Question sur les allergènes', 'Bonjour {{prenom}}, la liste complète des allergènes est indiquée sur chaque plat dans l’application. Pour toute allergie sévère, dites-le-nous : nous adaptons la préparation.', [], '/allergenes', 3],
  ['sans-oignon', 'customer_message', 'Demande de personnalisation', 'C’est noté {{prenom}}, nous préparons votre commande {{commande}} selon votre demande.', [], '/note', 11],
  ['pret', 'driver_message', 'Commande prête au comptoir', 'Bonjour {{livreur}}, la commande {{commande}} est prête, elle vous attend au comptoir.', [], '/pret', 17],
  ['entree', 'driver_message', 'Accès au restaurant', 'Bonjour {{livreur}}, entrez par la porte principale, place Darche, et demandez la commande {{commande}} au comptoir.', [], '/acces', 5],
];

for (const rid of ['mina-kitchen', 'lune-coffee', 'onda-pasta-club']) {
  TEMPLATES.forEach(([id, kind, title, body, ratings, shortcut, uses], i) => {
    const template: ReplyTemplate = {
      kind,
      title,
      body,
      ratings,
      shortcut,
      usageCount: rid === 'mina-kitchen' ? uses : Math.round(uses / 3),
      lastUsedAt: uses > 0 ? at(-(i + 1) * 7 * HOUR) : null,
      ...tracked(-20 * DAY, OWNER),
    };
    put(`${COLLECTIONS.restaurants}/${rid}/${SUBCOLLECTIONS.restaurants.replyTemplates}/rmm-${id}`, template);
  });
}

// ------------------------------------------------------------------ Messages automatiques et profil social
const autoMessages: RestaurantAutoMessages = {
  messages: {
    order_accepted: { enabled: true, body: AUTO_MESSAGE_DEFINITIONS.order_accepted.defaultBody },
    order_delayed: { enabled: true, body: AUTO_MESSAGE_DEFINITIONS.order_delayed.defaultBody },
    order_ready_pickup: { enabled: true, body: AUTO_MESSAGE_DEFINITIONS.order_ready_pickup.defaultBody },
    order_delivered_thanks: { enabled: false, body: AUTO_MESSAGE_DEFINITIONS.order_delivered_thanks.defaultBody },
    driver_order_ready: { enabled: true, body: AUTO_MESSAGE_DEFINITIONS.driver_order_ready.defaultBody },
    review_thanks: { enabled: false, body: AUTO_MESSAGE_DEFINITIONS.review_thanks.defaultBody },
  },
  updatedAt: at(-3 * DAY),
  updatedBy: OWNER,
};
put(`${COLLECTIONS.restaurants}/mina-kitchen/${SUBCOLLECTIONS.restaurants.marketing}/${RESTAURANT_MARKETING_DOCS.autoMessages}`, autoMessages);

const social: RestaurantSocialProfile = {
  links: {
    instagram: 'https://instagram.com/minakitchen.longwy',
    facebook: 'https://facebook.com/minakitchenlongwy',
    google: 'https://g.page/mina-kitchen-longwy',
  },
  shareMessage: 'Houmous maison, falafels croustillants et grillades du Levant : commandez chez Mina Kitchen sur Ciyou Eats, livré chez vous à Longwy.',
  hashtags: ['#MinaKitchen', '#Longwy', '#CuisineLevantine', '#Ciyou Eats'],
  updatedAt: at(-5 * DAY),
  updatedBy: OWNER,
};
put(`${COLLECTIONS.restaurants}/mina-kitchen/${SUBCOLLECTIONS.restaurants.marketing}/${RESTAURANT_MARKETING_DOCS.social}`, social);

// ------------------------------------------------------------------ Offres
const baseStats = { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 };
const promoBase = {
  scope: 'restaurant' as const,
  countryId: 'FR',
  cityIds: ['longwy'],
  restaurantId: 'mina-kitchen',
  restaurantIds: [],
  funding: 'restaurant' as const,
  restaurantShareBps: null,
  accent: '#e8784b',
  totalUsageLimit: null,
  inactiveDays: null,
  maxDiscountCents: null,
  submittedAt: null,
  approvedAt: null,
  pausedAt: null,
  endedAt: null,
  reviewNote: null,
  showcase: false,
  stats: baseStats,
};
const promotions: Array<Promotion & { id: string }> = [
  {
    ...promoBase,
    id: 'rmm-promo-mina-bienvenue',
    title: { fr: 'Bienvenue chez Mina Kitchen' },
    description: { fr: '15 % sur votre première commande, jusqu’à 6 € de remise.' },
    code: 'MINABIENVENUE',
    kind: 'percentage',
    value: 1500,
    maxDiscountCents: 600,
    minSubtotalCents: 1500,
    target: 'new_customers',
    modes: ['delivery', 'pickup'],
    perCustomerLimit: 1,
    startsAt: at(-1 * DAY),
    endsAt: at(45 * DAY),
    status: 'active',
    submittedAt: at(-2 * DAY),
    approvedAt: at(-1 * DAY),
    reviewNote: 'Conforme aux règles de la plateforme.',
    ...tracked(-2 * DAY, OWNER),
  },
  {
    ...promoBase,
    id: 'rmm-promo-mina-soiree',
    title: { fr: 'Soirée du jeudi' },
    description: { fr: '5 € offerts dès 25 € le jeudi soir.' },
    code: 'JEUDI5',
    kind: 'fixed',
    value: 500,
    minSubtotalCents: 2500,
    target: 'everyone',
    modes: ['delivery'],
    perCustomerLimit: 2,
    totalUsageLimit: 150,
    startsAt: at(2 * DAY),
    endsAt: at(60 * DAY),
    // Publication immédiate (validation Ciyou Eats désactivée) : l'offre démarre dans deux jours.
    status: 'active',
    submittedAt: at(-2 * HOUR),
    approvedAt: at(-2 * HOUR),
    ...tracked(-3 * HOUR, MANAGER),
  },
  {
    ...promoBase,
    id: 'rmm-promo-mina-livraison',
    title: { fr: 'Livraison offerte aux habitués' },
    description: { fr: 'Pour nos clients fidèles, dès 20 €.' },
    code: null,
    kind: 'free_delivery',
    value: 0,
    minSubtotalCents: 2000,
    target: 'loyal_customers',
    modes: ['delivery'],
    perCustomerLimit: 4,
    startsAt: at(1 * DAY),
    endsAt: at(31 * DAY),
    status: 'draft',
    ...tracked(-1 * DAY, MANAGER),
  },
  {
    ...promoBase,
    id: 'rmm-promo-mina-moitie',
    title: { fr: 'Moitié prix sur toute la carte' },
    description: null,
    code: 'MOITIE',
    kind: 'percentage',
    value: 5000,
    minSubtotalCents: 0,
    target: 'inactive_customers',
    inactiveDays: 60,
    modes: ['delivery', 'pickup'],
    perCustomerLimit: 1,
    startsAt: at(-4 * DAY),
    endsAt: at(10 * DAY),
    // Mise en pause par l'établissement après quelques jours.
    status: 'paused',
    submittedAt: at(-5 * DAY),
    approvedAt: at(-5 * DAY),
    pausedAt: at(-1 * DAY),
    ...tracked(-5 * DAY, OWNER),
  },
];
for (const { id, ...promotion } of promotions) put(`${COLLECTIONS.promotions}/${id}`, promotion);

// ------------------------------------------------------------------ Campagnes
const emptyStats = { targeted: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 };
const campaigns: Array<Campaign & { id: string }> = [
  {
    id: 'rmm-campagne-mina-weekend',
    scope: 'restaurant',
    restaurantId: 'mina-kitchen',
    name: 'Relance des inactifs',
    channel: 'push',
    title: 'Vous nous manquez !',
    body: 'Cela fait un moment : vos falafels préférés vous attendent chez Mina Kitchen. Commandez ce midi, livré en 30 minutes.',
    emailSubject: null,
    emailHtml: null,
    link: { type: 'restaurant', target: 'mina-kitchen' },
    audience: { userType: 'client', restaurantIds: ['mina-kitchen'], segment: 'inactive', inactiveDays: 45, marketing: true },
    promotionId: null,
    status: 'scheduled',
    scheduledAt: tomorrowParis(11, 30),
    sentAt: null,
    stats: { ...emptyStats, targeted: 9 },
    testMode: false,
    cancelledAt: null,
    failureReason: null,
    ...tracked(-4 * HOUR, MANAGER),
  },
  {
    id: 'rmm-campagne-mina-nouveau-plat',
    scope: 'restaurant',
    restaurantId: 'mina-kitchen',
    name: 'Lancement du chawarma',
    channel: 'email',
    title: 'Nouveau : notre chawarma maison',
    body: 'Poulet mariné 24 heures, sauce toum et pickles maison : notre chawarma arrive à la carte cette semaine. Soyez les premiers à le goûter !',
    emailSubject: 'Le chawarma maison arrive chez Mina Kitchen',
    emailHtml: null,
    link: { type: 'promotion', target: 'rmm-promo-mina-bienvenue' },
    audience: { userType: 'client', restaurantIds: ['mina-kitchen'], segment: 'all', inactiveDays: null, marketing: true },
    promotionId: 'rmm-promo-mina-bienvenue',
    status: 'draft',
    scheduledAt: null,
    sentAt: null,
    stats: { ...emptyStats, targeted: 26 },
    testMode: true,
    cancelledAt: null,
    failureReason: null,
    ...tracked(-1 * DAY, OWNER),
  },
  {
    id: 'rmm-campagne-mina-rentree',
    scope: 'restaurant',
    restaurantId: 'mina-kitchen',
    name: 'Menus de la rentrée',
    channel: 'email',
    title: 'La rentrée a bon goût',
    body: 'Nos formules du midi sont de retour : mezzé, plat et dessert, livrés au bureau en moins de 35 minutes.',
    emailSubject: 'Vos formules du midi sont de retour',
    emailHtml: null,
    link: { type: 'restaurant', target: 'mina-kitchen' },
    audience: { userType: 'client', restaurantIds: ['mina-kitchen'], segment: 'all', inactiveDays: null, marketing: true },
    promotionId: null,
    status: 'sent',
    scheduledAt: at(-14 * DAY),
    sentAt: at(-14 * DAY),
    stats: { targeted: 27, sent: 27, delivered: 26, opened: 12, clicked: 5, failed: 1 },
    testMode: false,
    cancelledAt: null,
    failureReason: null,
    ...tracked(-15 * DAY, OWNER),
  },
];
for (const { id, ...campaign } of campaigns) put(`${COLLECTIONS.campaigns}/${id}`, campaign);

// ------------------------------------------------------------------ Conversations (fils ouverts)
interface ThreadSeed {
  id: string;
  type: Conversation['type'];
  orderId: string;
  orderNumber: string;
  counterpart: { uid: string; name: string; role: 'client' | 'driver' };
  messages: Array<[string, 'restaurant' | 'client' | 'driver', string, number, string | null]>;
  unreadForTeam: number;
}
const threads: ThreadSeed[] = [
  {
    id: 'conv-o-12858',
    type: 'restaurant_client',
    orderId: 'o-12858',
    orderNumber: 'GL-12858',
    counterpart: { uid: 'seed-client-033', name: 'Amel A.', role: 'client' },
    messages: [
      ['m1', 'client', 'Bonjour, est-ce que le houmous contient de l’ail ? Mon fils y est allergique.', -95 * MIN, null],
      ['m2', 'restaurant', 'Bonjour Amel, oui notre houmous maison contient de l’ail. Nous pouvons vous préparer une portion nature, sans ail ni citron.', -88 * MIN, 'Sofia Martin'],
      ['m3', 'client', 'Parfait, merci beaucoup ! Je le note pour la prochaine commande.', -40 * MIN, null],
      ['m4', 'client', 'Et vous faites des plateaux pour 10 personnes le samedi midi ?', -12 * MIN, null],
    ],
    unreadForTeam: 2,
  },
  {
    id: 'conv-o-12852',
    type: 'restaurant_client',
    orderId: 'o-12852',
    orderNumber: 'GL-12852',
    counterpart: { uid: 'seed-client-028', name: 'Paul C.', role: 'client' },
    messages: [
      ['m1', 'client', 'Bonsoir, je suis au 3e étage sans ascenseur, le livreur peut m’appeler en arrivant ?', -26 * HOUR, null],
      ['m2', 'restaurant', 'Bonsoir Paul, c’est transmis au livreur. Bon appétit !', -25.9 * HOUR, 'Mina Haddad'],
    ],
    unreadForTeam: 0,
  },
  {
    id: 'convd-o-12858',
    type: 'restaurant_driver',
    orderId: 'o-12858',
    orderNumber: 'GL-12858',
    counterpart: { uid: 'seed-driver-006', name: 'Ana B.', role: 'driver' },
    messages: [
      ['m1', 'driver', 'Bonjour, je suis devant le restaurant, la commande GL-12858 est prête ?', -70 * MIN, null],
      ['m2', 'restaurant', 'Bonjour Ana, encore 2 minutes, on termine le sac. Merci !', -68 * MIN, 'Sofia Martin'],
      ['m3', 'driver', 'Super, j’attends au comptoir.', -67 * MIN, null],
    ],
    unreadForTeam: 1,
  },
  {
    id: 'convd-o-12835',
    type: 'restaurant_driver',
    orderId: 'o-12835',
    orderNumber: 'GL-12835',
    counterpart: { uid: 'seed-driver-002', name: 'Mateus H.', role: 'driver' },
    messages: [
      ['m1', 'restaurant', 'Bonjour Mateus, la commande GL-12835 contient une boisson chaude : merci de la garder bien droite.', -20 * HOUR, 'Mina Haddad'],
      ['m2', 'driver', 'Bien reçu, je fais attention.', -19.9 * HOUR, null],
    ],
    unreadForTeam: 0,
  },
];
for (const t of threads) {
  const staff = [OWNER, MANAGER];
  const last = t.messages[t.messages.length - 1]!;
  const conversation: Conversation & { orderNumber: string; lastSenderRole: string } = {
    type: t.type,
    restaurantId: 'mina-kitchen',
    orderId: t.orderId,
    orderNumber: t.orderNumber,
    ticketId: null,
    participantIds: [t.counterpart.uid, ...staff],
    participants: {
      [t.counterpart.uid]: { name: t.counterpart.name, role: t.counterpart.role },
      [OWNER]: { name: 'Mina Kitchen', role: 'restaurant' },
      [MANAGER]: { name: 'Mina Kitchen', role: 'restaurant' },
    },
    lastMessage: last[2],
    lastMessageAt: at(last[3]),
    lastSenderRole: last[1],
    unread: { [OWNER]: t.unreadForTeam, [MANAGER]: t.unreadForTeam, [t.counterpart.uid]: 0 },
    closed: false,
    createdAt: at(t.messages[0]![3] - MIN),
  };
  put(`${COLLECTIONS.conversations}/${t.id}`, conversation);
  t.messages.forEach(([mid, role, text, offset, name], index) => {
    const mine = role === 'restaurant';
    const senderId = mine ? (name === 'Sofia Martin' ? MANAGER : OWNER) : t.counterpart.uid;
    const unreadByTeam = !mine && index >= t.messages.length - t.unreadForTeam;
    const message: ConversationMessage = {
      senderId,
      senderRole: role,
      senderName: mine ? name : t.counterpart.name,
      text,
      attachments: [],
      readBy: mine ? [senderId, t.counterpart.uid] : unreadByTeam ? [senderId] : [senderId, OWNER, MANAGER],
      createdAt: at(offset),
      auto: null,
      processedAt: at(offset),
    };
    put(`${COLLECTIONS.conversations}/${t.id}/${SUBCOLLECTIONS.conversations.messages}/${mid}`, message);
  });
}

// ------------------------------------------------------------------ Support : motifs, articles, tickets
const reasons: Array<[string, string, TicketReason['defaultPriority'], boolean, number]> = [
  ['restaurant-litige-commande', 'Litige sur une commande', 'normal', true, 8],
  ['restaurant-livreur', 'Problème avec un livreur', 'high', true, 9],
  ['restaurant-technique', 'Problème technique sur le back-office', 'normal', false, 10],
  ['restaurant-visibilite', 'Visibilité, offres et campagnes', 'low', false, 11],
];
for (const [id, label, defaultPriority, requiresOrder, order] of reasons) {
  put(`${COLLECTIONS.ticketReasons}/${id}`, { label: { fr: label }, audience: ['restaurant'], defaultPriority, requiresOrder, order, active: true } satisfies TicketReason);
}

const articles: Array<[string, string, string, string, string[]]> = [
  ['promo-creer', 'Marketing', 'Créer un code promo ou une offre automatique', 'Dans Marketing › Codes promo, cliquez sur « Nouvelle offre ». Choisissez le type de remise (pourcentage, montant fixe ou livraison offerte), les clients concernés, le panier minimum et la période.\n\nUn code se partage (réseaux, flyers, campagne) ; une offre automatique s’applique d’office et s’affiche sur votre fiche. Les remises sont à la charge de votre établissement et déduites de vos reversements.', ['promotion', 'code']],
  ['promo-validation', 'Marketing', 'Pourquoi mon offre est-elle « en validation » ?', 'Ciyou Eats vérifie chaque nouvelle offre avant sa publication, en général sous 24 heures ouvrées : plafonds de remise, cohérence du panier minimum, clarté du titre. En cas de refus, le motif s’affiche sur l’offre : modifiez-la puis soumettez-la à nouveau.', ['validation', 'refus']],
  ['campagnes', 'Marketing', 'Envoyer une campagne à mes clients', 'Marketing › Campagnes permet d’envoyer une notification ou un e-mail à vos clients, tout de suite ou à une date choisie. Seuls les clients ayant accepté de recevoir des offres sont contactés. Les envois sont possibles de 9 h à 21 h, trois fois par semaine au plus.', ['notification', 'e-mail']],
  ['avis-repondre', 'Avis', 'Répondre aux avis de vos clients', 'Chaque avis peut recevoir une réponse publique. Remerciez les avis positifs et proposez une solution aux avis négatifs : une réponse courtoise rassure les futurs clients. Vos réponses types (Marketing › Modèles) vous font gagner du temps.', ['avis', 'réponse']],
  ['avis-signaler', 'Avis', 'Signaler un avis abusif', 'Un avis injurieux, mensonger ou contenant des données personnelles peut être signalé depuis la page Avis clients. La modération Ciyou Eats examine chaque signalement ; un avis négatif mais sincère reste publié.', ['signalement', 'modération']],
  ['messagerie', 'Messagerie', 'Échanger avec un client ou un livreur', 'Chaque commande ouvre un fil de discussion pendant 7 jours. Depuis Messagerie › Messages, répondez aux questions de vos clients, prévenez un livreur ou joignez une photo. Les messages automatiques se règlent dans Marketing › Modèles.', ['message', 'livreur']],
  ['fidelite', 'Marketing', 'Lancer votre programme de fidélité', 'Dans Marketing › Fidélité, choisissez combien de points vos clients gagnent par euro dépensé et les récompenses débloquées à chaque palier. Ciyou Eats plafonne le retour client à 20 % des dépenses pour protéger votre marge.', ['points', 'récompense']],
];
articles.forEach(([id, category, title, body, tags], i) => {
  const article: HelpArticle = {
    title: { fr: title },
    body: { fr: body },
    category,
    audience: ['restaurant'],
    tags,
    published: true,
    order: 20 + i,
    views: 40 + i * 13,
    helpfulYes: 12 + i * 3,
    helpfulNo: i % 3,
    ...tracked(-30 * DAY, 'test-super-admin'),
  };
  put(`${COLLECTIONS.helpArticles}/aide-restaurant-${id}`, article);
});

interface TicketSeed {
  id: string;
  seq: number;
  status: SupportTicket['status'];
  reasonId: string;
  subject: string;
  orderId: string | null;
  priority: SupportTicket['priority'];
  created: number;
  messages: Array<[TicketMessage['authorType'], string, number, TicketMessage['action']]>;
  unreadByRequester: number;
  satisfaction: SupportTicket['satisfaction'];
}
const tickets: TicketSeed[] = [
  {
    id: 'rmm-ticket-mina-carte',
    seq: 4601,
    status: 'waiting_customer',
    reasonId: 'carte-menu',
    subject: 'Mise en avant de la nouvelle carte d’automne',
    orderId: null,
    priority: 'low',
    created: -30 * HOUR,
    messages: [
      ['requester', 'Bonjour, nous lançons notre carte d’automne lundi. Est-il possible de mettre en avant nos nouveaux plats dans l’application ?', -30 * HOUR, null],
      ['agent', 'Bonjour Mina, avec plaisir ! Envoyez-nous 3 à 5 photos de vos nouveaux plats (format paysage, 1600 px minimum) et nous les ajouterons à la sélection « Nouveautés » de Longwy.', -26 * HOUR, null],
    ],
    unreadByRequester: 1,
    satisfaction: null,
  },
  {
    id: 'rmm-ticket-mina-remboursement',
    seq: 4602,
    status: 'resolved',
    reasonId: 'restaurant-litige-commande',
    subject: 'Remboursement contesté sur la commande GL-12796',
    orderId: 'o-12796',
    priority: 'normal',
    created: -3 * DAY,
    messages: [
      ['requester', 'Bonjour, le client a été remboursé pour retard sur la GL-12796 mais la commande était prête à l’heure : le retard vient de la livraison. Pouvez-vous vérifier l’imputation ?', -3 * DAY, null],
      ['agent', 'Bonjour, vous avez raison : le livreur est arrivé avec 22 minutes de retard. Le remboursement est désormais imputé à la plateforme et ne sera pas déduit de votre reversement.', -3 * DAY + 50 * MIN, { type: 'refund', detail: 'Imputation corrigée : 0,00 € à votre charge' }],
    ],
    unreadByRequester: 0,
    satisfaction: null,
  },
  {
    id: 'rmm-ticket-mina-tablette',
    seq: 4603,
    status: 'closed',
    reasonId: 'restaurant-technique',
    subject: 'Sonnerie des nouvelles commandes inaudible',
    orderId: null,
    priority: 'normal',
    created: -12 * DAY,
    messages: [
      ['requester', 'Bonjour, depuis la mise à jour la sonnerie des nouvelles commandes ne se déclenche plus sur notre tablette.', -12 * DAY, null],
      ['agent', 'Bonjour, il faut réautoriser le son dans le navigateur : touchez l’icône de cadenas à gauche de l’adresse, puis « Son : autoriser ». Dites-nous si c’est réglé.', -12 * DAY + 35 * MIN, null],
      ['requester', 'C’est réglé, merci pour la rapidité !', -12 * DAY + 2 * HOUR, null],
    ],
    unreadByRequester: 0,
    satisfaction: { score: 5, comment: 'Réponse claire et rapide.', at: at(-11 * DAY) },
  },
];
for (const t of tickets) {
  const last = t.messages[t.messages.length - 1]!;
  const firstAgent = t.messages.find((m) => m[0] === 'agent');
  const resolvedAt = t.status === 'resolved' || t.status === 'closed' ? at(last[2]) : null;
  const ticket: SupportTicket = {
    number: formatTicketNumber(t.seq),
    requesterType: 'restaurant',
    requesterId: OWNER,
    requesterName: 'Mina Kitchen · Mina Haddad',
    restaurantId: 'mina-kitchen',
    driverId: null,
    orderId: t.orderId,
    countryId: 'FR',
    cityId: 'longwy',
    reasonId: t.reasonId,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    channel: 'backoffice',
    assigneeId: SUPPORT,
    escalated: false,
    escalatedTo: null,
    escalatedAt: null,
    firstResponseAt: firstAgent ? at(firstAgent[2]) : null,
    firstResponseDueAt: at(t.created + 60 * MIN),
    resolutionDueAt: at(t.created + 24 * HOUR),
    resolvedAt,
    closedAt: t.status === 'closed' ? at(last[2] + HOUR) : null,
    refundIds: [],
    compensationCents: 0,
    satisfaction: t.satisfaction,
    tags: [],
    lastMessageAt: at(last[2]),
    lastMessagePreview: last[1].slice(0, 137),
    unreadByRequester: t.unreadByRequester,
    unreadBySupport: 0,
    ...tracked(t.created, OWNER),
  };
  put(`${COLLECTIONS.supportTickets}/${t.id}`, ticket);
  t.messages.forEach(([authorType, body, offset, action], i) => {
    const message: TicketMessage = {
      authorType,
      authorId: authorType === 'agent' ? SUPPORT : OWNER,
      authorName: authorType === 'agent' ? 'Malik (support Ciyou Eats)' : 'Mina Haddad',
      body,
      internal: false,
      attachments: [],
      action,
      createdAt: at(offset),
    };
    put(`${COLLECTIONS.supportTickets}/${t.id}/${SUBCOLLECTIONS.supportTickets.messages}/m${i + 1}`, message);
  });
}

// ------------------------------------------------------------------ Écriture
async function main() {
  console.log(`Seed r-marketing-messagerie → projet ${PROJECT_ID}`);

  // Comptes de fidélité des clients de Mina Kitchen (portée restaurant).
  const customers = await db.collection(`${COLLECTIONS.restaurants}/mina-kitchen/${SUBCOLLECTIONS.restaurants.customers}`).get();
  let members = 0;
  for (const doc of customers.docs) {
    const c = doc.data() as RestaurantCustomer;
    if (c.ordersCount < 1) continue;
    const lifetime = Math.floor(c.totalSpentCents / 100) + 20;
    const redeemed = Math.floor(lifetime / 100) * 100 * (c.ordersCount >= 6 ? 1 : 0);
    const account: LoyaltyAccount = {
      userId: doc.id,
      scope: 'restaurant',
      restaurantId: 'mina-kitchen',
      points: lifetime - redeemed,
      lifetimePoints: lifetime,
      tier: null,
      updatedAt: c.lastOrderAt ?? at(-DAY),
    };
    put(`${COLLECTIONS.loyaltyAccounts}/${doc.id}_mina-kitchen`, account);
    members += 1;
  }

  // Programme de fidélité de Mina Kitchen avec plusieurs paliers.
  writes.push([
    db.doc(`${COLLECTIONS.restaurants}/mina-kitchen/${SUBCOLLECTIONS.restaurants.settings}/loyalty`),
    {
      rewards: [
        { points: 100, rewardCents: 500, label: 'Le mezzé offert' },
        { points: 250, rewardCents: 1500, label: null },
      ],
      pointsValidityDays: 365,
    },
  ]);

  // Numérotation des tickets : le compteur dépasse les numéros utilisés ici.
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`${COLLECTIONS.counters}/tickets`);
    const current = ((await tx.get(ref)).get('value') as number | undefined) ?? 0;
    const max = Math.max(...tickets.map((t) => t.seq));
    if (current < max) tx.set(ref, { value: max, prefix: 'T-', updatedAt: Timestamp.now() }, { merge: true });
  });

  const writer = db.bulkWriter();
  for (const [ref, data] of writes) {
    const merge = ref.path.endsWith('/settings/loyalty');
    void writer.set(ref, data, merge ? { merge: true } : {});
  }
  await writer.close();
  console.log(`${writes.length} documents écrits (dont ${members} comptes de fidélité).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
