// Données complémentaires « Expérience client et support » du super admin
// (exécution seule, idempotente, identifiants stables, `seed: true`) :
//   npx tsx scripts/seed/only/a-experience-support.ts            (écrit)
//   npx tsx scripts/seed/only/a-experience-support.ts --dry-run  (affiche sans écrire)
//
// 1. Catalogue de mise en avant payante et emplacements vendus (statistiques).
// 2. Termes du filtre automatique des avis ; avis retenus, masqués, réponse signalée.
// 3. FAQ structurée publiée (versionnée) et page de brouillon.
// 4. Réponses types et articles du centre d'aide supplémentaires.
// 5. Historique de tickets sur 90 jours (délais, satisfaction, gestes), tickets
//    ouverts récents, remboursement en attente de validation, chats du support.
import { Timestamp } from '@google-cloud/firestore';
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  formatTicketNumber,
  type CannedResponse,
  type ContentPage,
  type ContentPageVersion,
  type ContentReport,
  type Conversation,
  type ConversationMessage,
  type FaqItem,
  type HelpArticle,
  type ModerationTerm,
  type Order,
  type Refund,
  type Review,
  type SponsoredOffer,
  type SponsoredPlacement,
  type SupportTicket,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';

const DRY_RUN = process.argv.includes('--dry-run');
const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ts = (ms: number) => Timestamp.fromMillis(Math.round(ms));
const SEED = { seed: true } as const;

type Write = { path: string; data: Record<string, unknown>; merge?: boolean };
const writes: Write[] = [];
const put = (path: string, data: object, merge = false) => writes.push({ path, data: { ...data, ...SEED }, merge });

/** Générateur pseudo-aléatoire déterministe (idempotence du contenu). */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}

const superAdmin = account('superAdmin').uid;
const support = account('support').uid;
const finance = account('finance').uid;
const tracked = (at: number, by = superAdmin) => ({ createdAt: ts(at), createdBy: by, updatedAt: ts(at), updatedBy: by });

// ------------------------------------------------------------------ 1. Mise en avant payante

function sponsored(orders: Array<Order & { id: string }>): void {
  const offers: Array<SponsoredOffer & { id: string }> = [
    { id: 'offre-accueil-7j', slot: 'home_featured', label: 'Sélection de l’accueil · 7 jours', description: 'Présence dans le carrousel « Coups de cœur » de la ville.', cityIds: null, durationDays: 7, priceHtCents: 4900, maxConcurrent: 3, active: true, order: 0, ...tracked(NOW - 60 * DAY) },
    { id: 'offre-tete-accueil-7j', slot: 'home_top', label: 'En tête de l’accueil · 7 jours', description: 'Première position de la page d’accueil.', cityIds: null, durationDays: 7, priceHtCents: 9900, maxConcurrent: 1, active: true, order: 1, ...tracked(NOW - 60 * DAY) },
    { id: 'offre-recherche-14j', slot: 'search_top', label: 'En tête des recherches · 14 jours', description: 'Remonté en tête des résultats de recherche pertinents.', cityIds: null, durationDays: 14, priceHtCents: 7900, maxConcurrent: 2, active: true, order: 2, ...tracked(NOW - 60 * DAY) },
    { id: 'offre-categorie-30j', slot: 'category_top', label: 'En tête de catégorie · 30 jours', description: 'Premier commerce affiché dans sa catégorie.', cityIds: null, durationDays: 30, priceHtCents: 12900, maxConcurrent: 1, active: true, order: 3, ...tracked(NOW - 60 * DAY) },
    { id: 'offre-banniere-luxembourg', slot: 'banner', label: 'Bannière Luxembourg · 7 jours', description: 'Bannière sponsorisée du carrousel d’accueil.', cityIds: ['luxembourg'], durationDays: 7, priceHtCents: 14900, maxConcurrent: 2, active: false, order: 4, ...tracked(NOW - 60 * DAY) },
  ];
  for (const { id, ...o } of offers) put(`${COLLECTIONS.sponsoredOffers}/${id}`, o);

  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const ordersBy = new Map<string, number>();
  for (const o of orders) ordersBy.set(o.restaurantId, (ordersBy.get(o.restaurantId) ?? 0) + 1);
  const rows: Array<[string, string, string, string, string, number, number, SponsoredPlacement['billing'], SponsoredPlacement['status']]> = [
    ['emplacement-kumo-accueil', 'kumo-ramen', 'Kumo Ramen', 'luxembourg', 'offre-accueil-7j', -3, 7, 'invoice', 'active'],
    ['emplacement-mina-recherche', 'mina-kitchen', 'Mina Kitchen', 'longwy', 'offre-recherche-14j', -5, 14, 'ad_credit', 'active'],
    ['emplacement-santo-tete', 'santo-smash', 'Santo Smash', 'metz', 'offre-tete-accueil-7j', 4, 7, 'invoice', 'scheduled'],
    ['emplacement-nami-accueil', 'nami-sushi-bar', 'Nami Sushi Bar', 'luxembourg', 'offre-accueil-7j', -24, 7, 'invoice', 'ended'],
    ['emplacement-casa-categorie', 'casa-arepa', 'Casa Arepa', 'longwy', 'offre-categorie-30j', -52, 30, 'offered', 'ended'],
    ['emplacement-pho-accueil', 'le-petit-pho', 'Le Petit Pho', 'metz', 'offre-accueil-7j', -12, 7, 'invoice', 'cancelled'],
  ];
  const r = rng(7);
  for (const [id, restaurantId, name, cityId, offerId, startIn, days, billing, status] of rows) {
    const offer = offers.find((o) => o.id === offerId)!;
    const start = startOfDay(NOW + startIn * DAY);
    const elapsed = Math.max(0, Math.min(days, (NOW - start) / DAY));
    const impressions = status === 'scheduled' || status === 'cancelled' ? 0 : Math.round(elapsed * r.int(380, 720));
    const clicks = Math.round(impressions * (0.035 + r.next() * 0.04));
    const list = offer.priceHtCents * (days / offer.durationDays);
    const placement: SponsoredPlacement = {
      restaurantId, restaurantName: name, cityId, countryId: cityId === 'luxembourg' ? 'LU' : 'FR', slot: offer.slot,
      categoryId: offer.slot === 'category_top' ? 'latino' : null, offerId,
      priceHtCents: billing === 'invoice' ? list : 0, listPriceHtCents: list, adCreditUsedCents: billing === 'ad_credit' ? list : 0, billing,
      startsAt: ts(start), endsAt: ts(start + days * DAY), status, invoiceId: null,
      impressions, clicks, orders: Math.round(clicks * (0.18 + r.next() * 0.1)),
      cancellation: status === 'cancelled' ? { reason: 'Fermeture exceptionnelle du restaurant pour travaux.', by: superAdmin, at: ts(start - DAY) } : null,
      ...tracked(start - 3 * DAY),
    };
    put(`${COLLECTIONS.sponsoredPlacements}/${id}`, placement);
  }
  // Drapeau « sponsorisé » cohérent avec les emplacements en cours.
  for (const rid of ['kumo-ramen', 'mina-kitchen']) put(`${COLLECTIONS.restaurants}/${rid}`, { sponsored: true }, true);
}

// ------------------------------------------------------------------ 2. Avis et modération

function moderation(orders: Array<Order & { id: string }>, reviewed: Set<string>): void {
  const terms: Array<[string, ModerationTerm['category'], ModerationTerm['action'], number]> = [
    ['radin', 'insult', 'flag', 3],
    ['empoisonneur', 'other', 'block', 1],
    ['concurrent', 'spam', 'flag', 0],
  ];
  terms.forEach(([term, category, action, hits], i) => {
    const doc: ModerationTerm = { term, category, action, active: true, hits, ...tracked(NOW - (40 - i) * DAY) };
    put(`${COLLECTIONS.moderationTerms}/terme-${term}`, doc);
  });

  const candidates = orders.filter((o) => !reviewed.has(o.id) && o.customerId.startsWith('seed-client') && o.driverId).slice(0, 6);
  const texts: Array<{ rating: 1 | 2 | 3 | 4 | 5; driver: 1 | 2 | 3 | 4 | 5; comment: string; status: Review['status']; reasons: string[]; flagged: boolean }> = [
    { rating: 1, driver: 1, comment: 'Livreur complètement connard, il m’a jeté le sac devant la porte.', status: 'pending_moderation', reasons: ['Insulte'], flagged: true },
    { rating: 2, driver: 3, comment: 'Plat froid. Appelez-moi au 06 45 12 78 90 pour me rembourser.', status: 'pending_moderation', reasons: ['Données personnelles'], flagged: true },
    { rating: 1, driver: 4, comment: 'Des empoisonneurs, j’ai été malade toute la nuit.', status: 'pending_moderation', reasons: ['Autre'], flagged: true },
    { rating: 1, driver: 2, comment: 'Nul, allez plutôt chez le concurrent d’à côté, www.autre-resto.fr', status: 'hidden', reasons: ['Publicité, lien'], flagged: true },
    { rating: 3, driver: 4, comment: 'Correct mais un peu radin sur les portions.', status: 'published', reasons: ['Insulte'], flagged: true },
    { rating: 2, driver: 5, comment: 'Commande incomplète, il manquait le dessert.', status: 'published', reasons: [], flagged: false },
  ];
  candidates.forEach((o, i) => {
    const t = texts[i]!;
    const at = (o.timeline?.delivered?.toMillis() ?? o.createdAt.toMillis()) + 40 * MIN;
    const review: Review = {
      orderId: o.id, restaurantId: o.restaurantId, driverId: o.driverId ?? null, customerId: o.customerId, customerDisplayName: o.customerName,
      countryId: o.countryId, cityId: o.cityId!, restaurantRating: t.rating, driverRating: t.driver, comment: t.comment, tags: [],
      status: t.status, autoModeration: { flagged: t.flagged, reasons: t.reasons },
      moderation: t.status === 'hidden' ? { action: 'hidden', reason: 'Publicité pour un concurrent et lien externe.', by: support, at: ts(at + 3 * HOUR) } : null,
      reply: i === 5 ? { text: 'Encore un client qui ment pour avoir un geste. Ce dessert était bien dans le sac, arrêtez vos mensonges.', by: o.restaurantId, at: ts(at + 5 * HOUR), status: 'published' } : null,
      reportsCount: i === 5 ? 1 : 0,
      createdAt: ts(at),
      updatedAt: ts(at + HOUR),
    };
    put(`${COLLECTIONS.reviews}/${o.id}`, { ...review, seedModule: 'a-experience-support' });
    if (i === 5) {
      const report: ContentReport = {
        targetType: 'review_reply', targetPath: `${COLLECTIONS.reviews}/${o.id}`, restaurantId: o.restaurantId, reporterId: o.customerId, reporterType: 'client',
        reason: 'harassment', details: 'Le restaurant me traite de menteur publiquement alors que le dessert manquait vraiment.', status: 'open', decision: null, createdAt: ts(at + 8 * HOUR),
      };
      put(`${COLLECTIONS.contentReports}/signalement-reponse-${o.id}`, report);
    }
  });
}

// ------------------------------------------------------------------ 3. Pages

function pages(): void {
  const faq: FaqItem[] = [
    { id: 'q1', category: 'Commandes', question: 'Comment suivre ma commande ?', answer: 'Depuis l’onglet **Commandes**, suivez chaque étape : acceptation, préparation, puis la position du livreur en temps réel.' },
    { id: 'q2', category: 'Commandes', question: 'Puis-je annuler ma commande ?', answer: 'Oui, tant que le restaurant ne l’a pas acceptée : le remboursement est intégral. Ensuite, contactez le support depuis le détail de la commande.' },
    { id: 'q3', category: 'Réclamations', question: 'Il manque un article, que faire ?', answer: 'Signalez-le depuis le détail de la commande dans les **48 heures**, avec une photo du sac :\n\n- remboursement sur votre moyen de paiement,\n- ou avoir immédiat sur votre compte Ciyou Eats.' },
    { id: 'q4', category: 'Paiement', question: 'Quels moyens de paiement sont acceptés ?', answer: 'Carte bancaire, Apple Pay et Google Pay. Les espèces ne sont possibles qu’avec les livreurs salariés du commerce.' },
    { id: 'q5', category: 'Livraison', question: 'Que se passe-t-il si je suis absent ?', answer: 'Le livreur vous appelle et patiente **10 minutes**. Sans réponse, la commande est clôturée sans remboursement.' },
    { id: 'q6', category: 'Compte', question: 'Comment supprimer mon compte ?', answer: 'Dans **Profil > Confidentialité > Supprimer mon compte**. Vos factures sont conservées pendant la durée légale.' },
  ];
  const at = NOW - 20 * DAY;
  const page: ContentPage = {
    slug: 'faq', kind: 'faq', title: { fr: 'Questions fréquentes' }, body: { fr: '' }, faqItems: faq, audience: ['public', 'client'],
    published: true, order: 3, version: 2, publishedAt: ts(at + 5 * DAY), publishedBy: superAdmin, archivedAt: null, draft: null, ...tracked(at),
  };
  put(`${COLLECTIONS.pages}/faq`, page);
  const v1: ContentPageVersion = { version: 1, title: page.title, body: page.body, faqItems: faq.slice(0, 4), audience: page.audience, changeSummary: 'Première version', publishedAt: ts(at), publishedBy: superAdmin, publishedByName: 'Claire Vautrin' };
  const v2: ContentPageVersion = { version: 2, title: page.title, body: page.body, faqItems: faq, audience: page.audience, changeSummary: 'Ajout : client absent, suppression du compte', publishedAt: ts(at + 5 * DAY), publishedBy: superAdmin, publishedByName: 'Claire Vautrin' };
  put(`${COLLECTIONS.pages}/faq/${SUBCOLLECTIONS.pages.versions}/1`, v1);
  put(`${COLLECTIONS.pages}/faq/${SUBCOLLECTIONS.pages.versions}/2`, v2);

  const body = '## Qui sommes-nous ?\n\nCiyou Eats relie les commerces indépendants de la Grande Région à leurs clients.\n\n## Nos engagements\n\n- des commissions transparentes,\n- **100 %** des pourboires reversés aux livreurs,\n- un support disponible 24 h/24, 7 j/7.\n\n> Une question ? Écrivez-nous depuis l’application, rubrique Aide.';
  const draft: ContentPage = {
    slug: 'nos-engagements', kind: 'page', title: { fr: 'Nos engagements' }, body: { fr: '' }, faqItems: null, audience: ['public'], published: false, order: 4, version: 0,
    publishedAt: null, publishedBy: null, archivedAt: null,
    draft: { title: { fr: 'Nos engagements' }, body: { fr: body }, faqItems: null, audience: ['public'], updatedAt: ts(NOW - 2 * DAY), updatedBy: superAdmin },
    ...tracked(NOW - 3 * DAY),
  };
  put(`${COLLECTIONS.pages}/nos-engagements`, draft);
}

// ------------------------------------------------------------------ 4. Réponses types, centre d'aide

function content(): void {
  const canned: Array<[string, string, string, string[]]> = [
    ['reponse-accuse-reception', 'Accusé de réception', 'Bonjour {prenom},\n\nMerci pour votre message. Nous examinons votre demande concernant la commande {commande} et revenons vers vous très vite.', []],
    ['reponse-article-manquant', 'Article manquant : remboursement', 'Bonjour {prenom},\n\nNous sommes désolés : un article manquait dans votre commande {commande} chez {restaurant}. Nous venons de vous rembourser le montant correspondant ; il apparaîtra sous 5 à 10 jours ouvrés.', ['commande-manquante']],
    ['reponse-photo', 'Demande de photo', 'Bonjour {prenom},\n\nPour traiter votre réclamation, pouvez-vous nous envoyer une **photo du sac et du ticket** reçus ? Cela nous permet d’agir immédiatement.', ['commande-manquante', 'commande-qualite']],
    ['reponse-livreur-absent', 'Client absent : règle appliquée', 'Bonjour {prenom},\n\nLe livreur a patienté 10 minutes et tenté de vous appeler. Conformément à nos conditions, la commande a été clôturée sans remboursement.', ['livreur-course']],
    ['reponse-cloture', 'Clôture', 'Bonjour {prenom},\n\nVotre demande est résolue. N’hésitez pas à nous répondre si besoin : le ticket sera rouvert automatiquement.', []],
  ];
  canned.forEach(([id, title, body, reasonIds], i) => {
    const doc: CannedResponse = { title, body: { fr: body }, reasonIds, shortcut: `/${id.split('-')[1]}`, active: true, usageCount: 12 - i * 2, lastUsedAt: ts(NOW - i * DAY), ...tracked(NOW - 50 * DAY) };
    put(`${COLLECTIONS.cannedResponses}/${id}`, doc);
  });
  const articles: Array<[string, string, string, string, HelpArticle['audience'], number]> = [
    ['aide-remboursement-delai', 'Sous quel délai suis-je remboursé ?', 'Réclamations', 'Le remboursement est lancé immédiatement. Selon votre banque, il apparaît **sous 5 à 10 jours ouvrés**. Un avoir Ciyou Eats est, lui, disponible tout de suite.', ['client'], 640],
    ['aide-livreur-annulation', 'Annuler une course acceptée', 'Courses', 'Depuis la course en cours, touchez **Signaler un problème > Annuler**. Les annulations répétées font baisser votre taux de fiabilité.', ['driver'], 210],
    ['aide-restaurant-mise-en-avant', 'Être mis en avant dans l’application', 'Visibilité', 'Plusieurs emplacements sont proposés : sélection de l’accueil, tête des recherches, tête de catégorie.\n\n- durée de 7 à 30 jours,\n- mention « Sponsorisé » affichée aux clients,\n- payable par facture ou crédit publicitaire (parrainage).', ['restaurant'], 185],
    ['aide-restaurant-avis', 'Répondre aux avis et signaler un avis abusif', 'Avis', 'Répondez publiquement depuis **Clients > Avis**. Un avis insultant ou mensonger peut être signalé : la modération Ciyou Eats l’examine sous 48 heures.', ['restaurant'], 320],
  ];
  articles.forEach(([id, title, category, body, audience, views], i) => {
    const doc: HelpArticle = { title: { fr: title }, body: { fr: body }, category, audience, tags: [], published: true, order: 20 + i, archivedAt: null, views, helpfulYes: Math.round(views * 0.2), helpfulNo: Math.round(views * 0.03), ...tracked(NOW - 30 * DAY) };
    put(`${COLLECTIONS.helpArticles}/${id}`, doc);
  });
}

// ------------------------------------------------------------------ 5. Tickets

function tickets(orders: Array<Order & { id: string }>, counter: number, owners: Map<string, string>): number {
  const r = rng(42);
  const reasons: Array<[string, TicketPriority, 'client' | 'restaurant' | 'driver', string, string]> = [
    ['commande-retard', 'high', 'client', 'Commande {n} arrivée en retard', 'Ma commande est arrivée avec plus de 30 minutes de retard.'],
    ['commande-manquante', 'normal', 'client', 'Article manquant sur {n}', 'Il manquait une boisson dans le sac.'],
    ['commande-qualite', 'normal', 'client', 'Plat froid, commande {n}', 'Le plat est arrivé froid et la sauce renversée.'],
    ['paiement', 'high', 'client', 'Double prélèvement sur {n}', 'J’ai été débité deux fois pour la même commande.'],
    ['compte', 'normal', 'client', 'Impossible de me connecter', 'Je ne reçois pas le code de connexion.'],
    ['reversement', 'normal', 'restaurant', 'Question sur le reversement', 'Le montant reversé ne correspond pas à mon relevé.'],
    ['carte-menu', 'low', 'restaurant', 'Aide pour modifier ma carte', 'Comment ajouter des options payantes à un plat ?'],
    ['livreur-course', 'high', 'driver', 'Adresse introuvable pour {n}', 'Le client ne répond pas et l’adresse est incomplète.'],
  ];
  const pool = orders.filter((o) => o.customerId.startsWith('seed-client') && o.createdAt.toMillis() > NOW - 90 * DAY && o.createdAt.toMillis() < NOW - 2 * DAY);
  let n = 0;
  for (let i = 0; i < 120 && pool.length; i++) {
    const o = pool[Math.floor(r.next() * pool.length)]!;
    const [reasonId, priority, requesterType, subjectTpl, body] = r.pick(reasons);
    const created = o.createdAt.toMillis() + r.int(30, 240) * MIN;
    const firstMinutes = priority === 'high' ? r.int(4, 35) : r.int(8, 110);
    const resolveMinutes = firstMinutes + r.int(20, priority === 'high' ? 500 : 1500);
    const first = created + firstMinutes * MIN;
    const resolved = created + resolveMinutes * MIN;
    const closed = resolved + r.int(1, 6) * DAY;
    const status: TicketStatus = closed < NOW ? 'closed' : 'resolved';
    const refund = reasonId === 'commande-manquante' || reasonId === 'commande-qualite' ? r.int(3, 14) * 100 : reasonId === 'paiement' ? o.amounts.chargedCents : 0;
    const credit = reasonId === 'commande-retard' ? 500 : 0;
    const number = formatTicketNumber(counter + 1 + i);
    const requesterId = requesterType === 'client' ? o.customerId : requesterType === 'restaurant' ? (owners.get(o.restaurantId) ?? `seed-owner-${o.restaurantId}`) : (o.driverId ?? o.customerId);
    const requesterName = requesterType === 'client' ? o.customerName : requesterType === 'restaurant' ? o.restaurantName : (o.delivery?.driverName ?? 'Livreur');
    const ticket: SupportTicket = {
      number, requesterType, requesterId, requesterName, restaurantId: o.restaurantId, driverId: o.driverId ?? null, orderId: requesterType === 'restaurant' && reasonId !== 'reversement' ? null : o.id,
      countryId: o.countryId, cityId: o.cityId ?? null, reasonId, subject: subjectTpl.replace('{n}', o.number), status, priority,
      channel: r.pick(['app', 'app', 'app', 'chat', 'email', 'phone'] as const), assigneeId: r.chance(0.8) ? support : superAdmin,
      escalated: r.chance(0.07), escalatedTo: null, escalatedAt: null, escalationReason: null,
      firstResponseAt: ts(first), firstResponseDueAt: ts(created + (priority === 'high' ? 20 : priority === 'low' ? 240 : 60) * MIN),
      resolutionDueAt: ts(created + (priority === 'high' ? 8 : priority === 'low' ? 72 : 24) * HOUR), resolvedAt: ts(resolved), closedAt: status === 'closed' ? ts(closed) : null,
      refundIds: [], compensationCents: refund + credit, creditedCents: credit, satisfaction: r.chance(0.55) ? { score: r.pick([5, 5, 4, 4, 5, 3, 2] as const), comment: null, at: ts(resolved + HOUR) } : null,
      tags: [], lastMessageAt: ts(resolved), lastMessagePreview: 'Votre demande est résolue.', unreadByRequester: 0, unreadBySupport: 0,
      ...tracked(created, requesterId),
    };
    const id = `exp-ticket-${String(i + 1).padStart(3, '0')}`;
    put(`${COLLECTIONS.supportTickets}/${id}`, ticket);
    const messages: TicketMessage[] = [
      { authorType: 'requester', authorId: requesterId, authorName: requesterName, body, internal: false, attachments: [], action: null, createdAt: ts(created) },
      { authorType: 'agent', authorId: ticket.assigneeId!, authorName: 'Malik (support Ciyou Eats)', body: refund ? `Nous sommes désolés. Nous avons procédé au remboursement de ${(refund / 100).toFixed(2).replace('.', ',')} €.` : credit ? 'Toutes nos excuses : un avoir de 5,00 € a été ajouté à votre compte.' : 'Merci pour votre message, voici la marche à suivre.', internal: false, attachments: [], action: refund ? { type: 'refund', detail: `${(refund / 100).toFixed(2).replace('.', ',')} €` } : credit ? { type: 'credit', detail: '5,00 €' } : null, createdAt: ts(first) },
      { authorType: 'system', authorId: 'system', authorName: 'Ciyou Eats', body: 'Votre demande a été marquée comme résolue.', internal: false, attachments: [], action: { type: 'status_change', detail: 'resolved' }, createdAt: ts(resolved) },
    ];
    messages.forEach((m, j) => put(`${COLLECTIONS.supportTickets}/${id}/${SUBCOLLECTIONS.supportTickets.messages}/m${j + 1}`, m));
    n += 1;
  }
  return n;
}

function liveCases(orders: Array<Order & { id: string }>, counter: number): void {
  const recent = orders.filter((o) => o.customerId.startsWith('seed-client') && o.payment.method !== 'cash' && o.amounts.chargedCents > 3000).slice(0, 3);
  const [a, b, c] = recent;
  if (a) {
    // Réclamation élevée : remboursement au-delà du plafond de l'agent, en attente de validation.
    const created = NOW - 50 * MIN;
    const refundId = `exp-rf-${a.id}`;
    const ticket: SupportTicket = {
      number: formatTicketNumber(counter + 200), requesterType: 'client', requesterId: a.customerId, requesterName: a.customerName, restaurantId: a.restaurantId, driverId: a.driverId ?? null, orderId: a.id,
      countryId: a.countryId, cityId: a.cityId ?? null, reasonId: 'commande-qualite', subject: `Commande ${a.number} renversée, immangeable`, status: 'in_progress', priority: 'high', channel: 'app',
      assigneeId: support, escalated: true, escalatedTo: finance, escalatedAt: ts(created + 20 * MIN), escalationReason: 'Remboursement total au-delà de mon plafond',
      firstResponseAt: ts(created + 8 * MIN), firstResponseDueAt: ts(created + 20 * MIN), resolutionDueAt: ts(created + 8 * HOUR), resolvedAt: null, closedAt: null,
      refundIds: [], compensationCents: 0, pendingRefundId: refundId, satisfaction: null, tags: ['photo-reçue'], lastMessageAt: ts(created + 12 * MIN),
      lastMessagePreview: 'Voici la photo du sac.', unreadByRequester: 0, unreadBySupport: 0, ...tracked(created, a.customerId),
    };
    put(`${COLLECTIONS.supportTickets}/exp-ticket-attente-validation`, ticket);
    const msgs: TicketMessage[] = [
      { authorType: 'requester', authorId: a.customerId, authorName: a.customerName, body: 'Tout le sac est arrivé renversé, les plats sont immangeables. Je souhaite être remboursé.', internal: false, attachments: [], action: null, createdAt: ts(created) },
      { authorType: 'agent', authorId: support, authorName: 'Malik (support Ciyou Eats)', body: 'Toutes nos excuses. Pouvez-vous nous envoyer une photo du sac ?', internal: false, attachments: [], action: null, createdAt: ts(created + 8 * MIN) },
      { authorType: 'requester', authorId: a.customerId, authorName: a.customerName, body: 'Voici la photo du sac.', internal: false, attachments: [], action: null, createdAt: ts(created + 12 * MIN) },
      { authorType: 'system', authorId: support, authorName: 'Malik Benyahia', body: `Remboursement de ${(a.amounts.chargedCents / 100).toFixed(2).replace('.', ',')} € demandé : au-delà du plafond, validation d’un responsable requise.`, internal: true, attachments: [], action: { type: 'refund', detail: 'en attente' }, createdAt: ts(created + 18 * MIN) },
    ];
    msgs.forEach((m, j) => put(`${COLLECTIONS.supportTickets}/exp-ticket-attente-validation/${SUBCOLLECTIONS.supportTickets.messages}/m${j + 1}`, m));
    const refund: Refund = {
      orderId: a.id, orderNumber: a.number, countryId: a.countryId, cityId: a.cityId, customerId: a.customerId, restaurantId: a.restaurantId, driverId: a.driverId ?? null,
      ticketId: 'exp-ticket-attente-validation', amountCents: a.amounts.chargedCents, method: 'original_payment', cause: 'food_quality',
      allocation: { restaurantCents: a.amounts.chargedCents, courierCents: 0, platformCents: 0 }, items: null, status: 'pending_approval', automatic: false,
      reason: 'Sac renversé, photo reçue', requestedBy: support, requestedAt: ts(created + 18 * MIN), approvedBy: null, approvedAt: null, rejectionReason: null,
      providerRefundId: null, creditNoteId: null, processedAt: null,
    };
    put(`${COLLECTIONS.refunds}/${refundId}`, refund);
  }
  // Chats du support en cours.
  [b, c].forEach((o, i) => {
    if (!o) return;
    const at = NOW - (i + 1) * 25 * MIN;
    const conv: Conversation & { countryId: string; cityId: string | null; orderNumber: string } = {
      type: 'support_chat', restaurantId: o.restaurantId, orderId: o.id, ticketId: null,
      participantIds: [support, o.customerId], participants: { [support]: { name: 'Malik (support Ciyou Eats)', role: 'admin' }, [o.customerId]: { name: o.customerName, role: 'client' } },
      lastMessage: i === 0 ? 'Le livreur arrive dans 5 minutes.' : 'D’accord, merci beaucoup !', lastMessageAt: ts(at + 6 * MIN), unread: { [support]: i === 1 ? 1 : 0 }, closed: false,
      createdAt: ts(at), countryId: o.countryId, cityId: o.cityId ?? null, orderNumber: o.number,
    };
    put(`${COLLECTIONS.conversations}/exp-chat-${o.id}`, conv);
    const msgs: ConversationMessage[] = [
      { senderId: o.customerId, senderRole: 'client', senderName: o.customerName, text: 'Bonjour, ma commande indique « en livraison » depuis 20 minutes.', attachments: [], readBy: [o.customerId, support], createdAt: ts(at) },
      { senderId: support, senderRole: 'admin', senderName: 'Malik (support Ciyou Eats)', text: 'Bonjour, je regarde tout de suite avec le livreur.', attachments: [], readBy: [support, o.customerId], createdAt: ts(at + 2 * MIN) },
      { senderId: i === 0 ? support : o.customerId, senderRole: i === 0 ? 'admin' : 'client', senderName: i === 0 ? 'Malik (support Ciyou Eats)' : o.customerName, text: i === 0 ? 'Le livreur arrive dans 5 minutes.' : 'D’accord, merci beaucoup !', attachments: [], readBy: [i === 0 ? support : o.customerId], createdAt: ts(at + 6 * MIN) },
    ];
    msgs.forEach((m, j) => put(`${COLLECTIONS.conversations}/exp-chat-${o.id}/${SUBCOLLECTIONS.conversations.messages}/m${j + 1}`, { ...m, processedAt: ts(m.createdAt.toMillis()) }));
  });
}

async function commit(): Promise<void> {
  if (DRY_RUN) {
    for (const w of writes.slice(0, 12)) console.log('  ·', w.path);
    console.log(`  … ${writes.length} écritures au total`);
    return;
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + 400)) {
      if (w.merge) batch.set(db.doc(w.path), w.data, { merge: true });
      else batch.set(db.doc(w.path), w.data);
    }
    await batch.commit();
  }
}

async function main(): Promise<void> {
  const [ordersSnap, reviewsSnap, counterSnap, restaurantsSnap] = await Promise.all([
    db.collection(COLLECTIONS.orders).where('status', '==', 'delivered').orderBy('createdAt', 'desc').limit(1500).get(),
    db.collection(COLLECTIONS.reviews).select('seedModule').get(),
    db.collection(COLLECTIONS.counters).doc('tickets').get(),
    db.collection(COLLECTIONS.restaurants).select('ownerId').get(),
  ]);
  const owners = new Map(restaurantsSnap.docs.map((d) => [d.id, d.get('ownerId') as string]));
  const orders = ordersSnap.docs.map((d) => ({ ...(d.data() as Order), id: d.id })).filter((o) => o.customerId.startsWith('seed-client'));
  const reviewed = new Set(reviewsSnap.docs.filter((d) => d.get('seedModule') !== 'a-experience-support').map((d) => d.id));
  // Base de numérotation stable : les tickets de démonstration utilisent la plage 9000+.
  const base = 9000;
  void counterSnap;
  console.log(`Commandes livrées disponibles : ${orders.length}`);
  sponsored(orders);
  moderation(orders, reviewed);
  pages();
  content();
  const count = tickets(orders, base, owners);
  liveCases(orders, base);
  console.log(`Tickets historiques : ${count}`);
  await commit();
  console.log(DRY_RUN ? '\nSimulation terminée (rien n’est écrit).' : `\n${writes.length} documents « Expérience client et support » à jour.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
