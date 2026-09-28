// Support : motifs, réponses types, tickets avec messages, messagerie
// restaurant ↔ client, signalements de contenus.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  formatTicketNumber,
  type CannedResponse,
  type ContentReport,
  type Conversation,
  type ConversationMessage,
  type SupportTicket,
  type TicketMessage,
  type TicketReason,
  type TicketStatus,
} from '@golink/shared';
import { account } from './accounts';
import { tracked, type SeedContext } from './context';
import { minutesAfter, ts } from './lib';
import type { SeededOrder } from './orders';

const REASONS: Array<[string, string, TicketReason['audience'], TicketReason['defaultPriority'], boolean]> = [
  ['commande-manquante', 'Article manquant', ['client'], 'normal', true],
  ['commande-retard', 'Commande en retard', ['client'], 'high', true],
  ['commande-qualite', 'Qualité du repas', ['client'], 'normal', true],
  ['paiement', 'Problème de paiement', ['client', 'restaurant'], 'high', false],
  ['compte', 'Accès au compte', ['client', 'restaurant', 'driver'], 'normal', false],
  ['reversement', 'Reversement ou facture', ['restaurant', 'driver'], 'normal', false],
  ['livreur-course', 'Problème pendant une course', ['driver'], 'high', true],
  ['carte-menu', 'Modifier ma carte', ['restaurant'], 'low', false],
];

export function seedSupport(ctx: SeedContext, orders: SeededOrder[]): number {
  const { w, rng, nowTs, superAdminUid: admin } = ctx;
  const support = account('support').uid;
  REASONS.forEach(([id, label, audience, defaultPriority, requiresOrder], order) => {
    const reason: TicketReason = { label: { fr: label }, audience, defaultPriority, requiresOrder, order, active: true };
    w.set(w.doc(`${COLLECTIONS.ticketReasons}/${id}`), reason);
  });
  const canned: Array<[string, string, string[]]> = [
    ['Excuses et remboursement', 'Nous sommes désolés pour cet oubli. Nous venons de vous rembourser l’article manquant sur votre moyen de paiement.', ['commande-manquante']],
    ['Retard : geste commercial', 'Toutes nos excuses pour ce retard. Un avoir de 5 € a été ajouté à votre compte, valable 60 jours.', ['commande-retard']],
    ['Réinitialisation du mot de passe', 'Vous pouvez réinitialiser votre mot de passe depuis l’écran de connexion, lien « Mot de passe oublié ».', ['compte']],
    ['Calendrier des reversements', 'Les reversements sont effectués chaque semaine, le mercredi, pour les commandes de la semaine précédente.', ['reversement']],
  ];
  canned.forEach(([title, body, reasonIds], i) => {
    const doc: CannedResponse = { title, body: { fr: body }, reasonIds, shortcut: `/r${i + 1}`, active: true, ...tracked(nowTs, admin) };
    w.set(w.doc(`${COLLECTIONS.cannedResponses}/reponse-${i + 1}`), doc);
  });

  // Tickets rattachés aux commandes récentes (remboursées ou en retard en priorité).
  const candidates = orders
    .filter((o) => o.placedAt.getTime() > ctx.now.getTime() - 30 * 86_400_000 && (o.refunded || o.late || rng.chance(0.01)))
    .slice(-42);
  candidates.forEach((o, i) => {
    const ageHours = (ctx.now.getTime() - o.placedAt.getTime()) / 3_600_000;
    const status: TicketStatus = ageHours < 6 ? 'open' : ageHours < 30 ? rng.pick(['in_progress', 'waiting_customer'] as const) : rng.chance(0.85) ? 'closed' : 'resolved';
    const reasonId = o.late ? 'commande-retard' : o.status === 'cancelled' ? 'paiement' : rng.pick(['commande-manquante', 'commande-qualite'] as const);
    const priority = o.late ? 'high' : i % 11 === 0 ? 'urgent' : 'normal';
    const createdAt = minutesAfter(o.deliveredAt ?? o.placedAt, rng.int(10, 90));
    const firstResponse = minutesAfter(createdAt, rng.int(4, 55));
    const resolved = status === 'resolved' || status === 'closed';
    const escalated = i % 13 === 0;
    const number = formatTicketNumber(4500 + i);
    const subject = reasonId === 'commande-retard' ? `Commande ${o.number} arrivée en retard` : reasonId === 'paiement' ? `Remboursement de la commande ${o.number}` : `Problème sur la commande ${o.number}`;
    const ticket: SupportTicket = {
      number,
      requesterType: 'client',
      requesterId: o.customerId,
      requesterName: o.customerName,
      restaurantId: o.restaurantId,
      driverId: o.driverId,
      orderId: o.id,
      countryId: o.countryId,
      cityId: o.cityId,
      reasonId,
      subject,
      status,
      priority,
      channel: rng.pick(['app', 'app', 'chat', 'email'] as const),
      assigneeId: status === 'open' ? null : support,
      escalated,
      escalatedTo: escalated ? account('finance').uid : null,
      escalatedAt: escalated ? ts(minutesAfter(firstResponse, 30)) : null,
      firstResponseAt: status === 'open' ? null : ts(firstResponse),
      firstResponseDueAt: ts(minutesAfter(createdAt, priority === 'high' ? 20 : 60)),
      resolutionDueAt: ts(minutesAfter(createdAt, priority === 'high' ? 480 : 1440)),
      resolvedAt: resolved ? ts(minutesAfter(firstResponse, rng.int(10, 240))) : null,
      closedAt: status === 'closed' ? ts(minutesAfter(firstResponse, rng.int(300, 2000))) : null,
      refundIds: o.refunded && o.status === 'delivered' ? [`rf-${o.id}`] : [],
      compensationCents: o.late ? 500 : 0,
      satisfaction: status === 'closed' && rng.chance(0.6) ? { score: rng.pick([4, 5, 5, 3] as const), comment: null, at: ts(minutesAfter(firstResponse, 400)) } : null,
      tags: o.late ? ['retard'] : [],
      lastMessageAt: ts(resolved ? minutesAfter(firstResponse, 60) : firstResponse),
      lastMessagePreview: status === 'open' ? 'Bonjour, il manque une partie de ma commande.' : 'Nous avons procédé au remboursement.',
      unreadByRequester: status === 'waiting_customer' ? 1 : 0,
      unreadBySupport: status === 'open' ? 1 : 0,
      ...tracked(ts(createdAt), o.customerId),
    };
    const id = `ticket-${4500 + i}`;
    w.set(w.doc(`${COLLECTIONS.supportTickets}/${id}`), ticket);
    const messages: TicketMessage[] = [
      { authorType: 'requester', authorId: o.customerId, authorName: o.customerName, body: o.late ? 'Ma commande est arrivée avec plus de 30 minutes de retard et froide.' : 'Bonjour, il manque une partie de ma commande.', internal: false, attachments: [], action: null, createdAt: ts(createdAt) },
    ];
    if (status !== 'open') {
      messages.push({ authorType: 'agent', authorId: support, authorName: 'Malik (support Ciyou Eats)', body: o.late ? 'Toutes nos excuses pour ce retard. Un avoir de 5 € a été ajouté à votre compte.' : 'Nous sommes désolés. Nous avons procédé au remboursement de l’article manquant.', internal: false, attachments: [], action: { type: o.late ? 'credit' : 'refund', detail: o.late ? 'Avoir de 5,00 €' : 'Remboursement partiel' }, createdAt: ts(firstResponse) });
      messages.push({ authorType: 'agent', authorId: support, authorName: 'Malik', body: 'Deuxième réclamation de ce client ce mois-ci : à surveiller.', internal: true, attachments: [], action: null, createdAt: ts(minutesAfter(firstResponse, 2)) });
    }
    messages.forEach((m, j) => w.set(w.doc(`${COLLECTIONS.supportTickets}/${id}/${SUBCOLLECTIONS.supportTickets.messages}/m${j + 1}`), m));
  });

  // Ticket d'un restaurant.
  const restaurantTicket: SupportTicket = {
    number: formatTicketNumber(4600), requesterType: 'restaurant', requesterId: account('owner').uid, requesterName: 'Mina Haddad', restaurantId: 'mina-kitchen', driverId: null, orderId: null,
    countryId: 'FR', cityId: 'longwy', reasonId: 'reversement', subject: 'Écart sur le reversement de la semaine dernière', status: 'in_progress', priority: 'normal', channel: 'backoffice',
    assigneeId: account('finance').uid, escalated: false, escalatedTo: null, escalatedAt: null, firstResponseAt: nowTs, firstResponseDueAt: nowTs, resolutionDueAt: ts(minutesAfter(ctx.now, 1200)),
    resolvedAt: null, closedAt: null, refundIds: [], compensationCents: 0, satisfaction: null, tags: ['finance'], lastMessageAt: nowTs,
    lastMessagePreview: 'Nous vérifions les remboursements imputés.', unreadByRequester: 1, unreadBySupport: 0, ...tracked(ts(minutesAfter(ctx.now, -180)), account('owner').uid),
  };
  w.set(w.doc(`${COLLECTIONS.supportTickets}/ticket-4600`), restaurantTicket);
  w.set(w.doc(`${COLLECTIONS.supportTickets}/ticket-4600/${SUBCOLLECTIONS.supportTickets.messages}/m1`), {
    authorType: 'requester', authorId: account('owner').uid, authorName: 'Mina Haddad', body: 'Bonjour, le reversement de lundi est inférieur de 18 € à mes ventes nettes. Pouvez-vous vérifier ?', internal: false, attachments: [], action: null, createdAt: ts(minutesAfter(ctx.now, -180)),
  } satisfies TicketMessage);

  // Messagerie restaurant ↔ client (Mina Kitchen).
  const minaOrders = orders.filter((o) => o.restaurantId === 'mina-kitchen' && o.status === 'delivered').slice(-6);
  minaOrders.forEach((o, i) => {
    const at = o.placedAt;
    const conversation: Conversation = {
      type: 'restaurant_client', restaurantId: 'mina-kitchen', orderId: o.id, ticketId: null, participantIds: [o.customerId, account('owner').uid, account('manager').uid],
      participants: { [o.customerId]: { name: o.customerName, role: 'client' }, [account('owner').uid]: { name: 'Mina Kitchen', role: 'restaurant' }, [account('manager').uid]: { name: 'Mina Kitchen', role: 'restaurant' } },
      lastMessage: i % 2 ? 'Parfait, merci beaucoup !' : 'C’est noté, sans oignon.', lastMessageAt: ts(minutesAfter(at, 4)),
      unread: { [account('owner').uid]: i === minaOrders.length - 1 ? 1 : 0 }, closed: i < 3, createdAt: ts(at),
    };
    w.set(w.doc(`${COLLECTIONS.conversations}/conv-${o.id}`), conversation);
    const msgs: ConversationMessage[] = [
      { senderId: o.customerId, senderRole: 'client', text: 'Bonjour, est-ce possible sans oignon ?', attachments: [], readBy: [account('owner').uid], createdAt: ts(minutesAfter(at, 1)) },
      { senderId: account('manager').uid, senderRole: 'restaurant', text: 'C’est noté, sans oignon.', attachments: [], readBy: [o.customerId], createdAt: ts(minutesAfter(at, 3)) },
    ];
    if (i % 2) msgs.push({ senderId: o.customerId, senderRole: 'client', text: 'Parfait, merci beaucoup !', attachments: [], readBy: [], createdAt: ts(minutesAfter(at, 4)) });
    msgs.forEach((m, j) => w.set(w.doc(`${COLLECTIONS.conversations}/conv-${o.id}/${SUBCOLLECTIONS.conversations.messages}/m${j + 1}`), m));
  });

  // Signalement de contenu.
  const flagged = orders.find((o) => o.status === 'delivered' && o.restaurantId === 'santo-smash');
  if (flagged) {
    const report: ContentReport = {
      targetType: 'review', targetPath: `reviews/${flagged.id}`, restaurantId: 'santo-smash', reporterId: 'seed-owner-santo-smash', reporterType: 'restaurant',
      reason: 'fake', details: 'Ce client n’a jamais reçu cette commande selon nos caméras, l’avis est mensonger.', status: 'open', decision: null, createdAt: nowTs,
    };
    w.set(w.doc(`${COLLECTIONS.contentReports}/signalement-1`), report);
  }
  return candidates.length + 1;
}
