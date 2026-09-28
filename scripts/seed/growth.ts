// Croissance : promotions, campagnes, messages automatiques, annonces,
// prospection commerciale, parrainages.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  maskEmail,
  type Announcement,
  type Campaign,
  type MessageTemplate,
  type NotificationLog,
  type Promotion,
  type Prospect,
  type ProspectActivity,
  type ProspectStage,
  type Referral,
  type SalesCommission,
} from '@golink/shared';
import { account } from './accounts';
import { CITIES, RESTAURANTS } from './catalog';
import { tracked, type SeedContext } from './context';
import { addDays, parisTime, ts } from './lib';
import type { SeededOrder } from './orders';
import type { ClientRuntime } from './people';

export function seedGrowth(ctx: SeedContext, orders: SeededOrder[], clients: ClientRuntime[]): void {
  const { w, rng, nowTs, superAdminUid: admin } = ctx;
  const start = ts(parisTime(addDays(ctx.today, -90), 0));
  const stats = (promotionId: string) => {
    const used = orders.filter((o) => o.status === 'delivered' && o.promotionId === promotionId);
    return {
      redemptions: used.length,
      discountCents: used.reduce((s, o) => s + o.quote.discount.totalCents, 0),
      ordersSubtotalCents: used.reduce((s, o) => s + o.quote.subtotalCents, 0),
      newCustomers: promotionId === 'promo-bienvenue20' ? used.length : Math.round(used.length * 0.2),
    };
  };

  // ------------------------------------------------------------ Promotions
  const platform: Array<Promotion & { id: string }> = [
    {
      id: 'promo-bienvenue20', scope: 'platform', countryId: null, cityIds: [], restaurantId: null, restaurantIds: [],
      title: { fr: '20 % sur votre première commande' }, description: { fr: 'Dans tous les restaurants participants, jusqu’à 8 € de remise.' },
      code: 'BIENVENUE20', kind: 'percentage', value: 2000, maxDiscountCents: 800, minSubtotalCents: 1500, funding: 'platform', restaurantShareBps: null,
      target: 'new_customers', inactiveDays: null, modes: ['delivery', 'pickup'], totalUsageLimit: null, perCustomerLimit: 1,
      startsAt: start, endsAt: null, status: 'active', reviewNote: null, showcase: true, accent: '#e8784b', stats: stats('promo-bienvenue20'), ...tracked(start, admin),
    },
    {
      id: 'promo-mardi-metz', scope: 'city', countryId: 'FR', cityIds: ['metz'], restaurantId: null, restaurantIds: [],
      title: { fr: 'Livraison offerte le mardi' }, description: { fr: 'Dès 20 € de commande, à Metz. Financée à moitié par les restaurants participants.' },
      code: null, kind: 'free_delivery', value: 0, maxDiscountCents: null, minSubtotalCents: 2000, funding: 'shared', restaurantShareBps: 5000,
      target: 'everyone', inactiveDays: null, modes: ['delivery'], totalUsageLimit: null, perCustomerLimit: 4,
      startsAt: start, endsAt: ts(parisTime(addDays(ctx.today, 30), 0)), status: 'active', reviewNote: null, showcase: true, accent: '#19343b', stats: stats('promo-mardi-metz'), ...tracked(start, admin),
    },
    {
      id: 'promo-retour', scope: 'country', countryId: 'LU', cityIds: [], restaurantId: null, restaurantIds: [],
      title: { fr: 'Vous nous avez manqué' }, description: { fr: '5 € offerts aux clients sans commande depuis 30 jours.' },
      code: 'RETOUR5', kind: 'fixed', value: 500, maxDiscountCents: null, minSubtotalCents: 2000, funding: 'platform', restaurantShareBps: null,
      target: 'inactive_customers', inactiveDays: 30, modes: ['delivery'], totalUsageLimit: 500, perCustomerLimit: 1,
      startsAt: ts(parisTime(addDays(ctx.today, 3), 0)), endsAt: ts(parisTime(addDays(ctx.today, 33), 0)), status: 'draft', reviewNote: null, showcase: false, accent: '#6e9d8b', stats: { redemptions: 0, discountCents: 0, ordersSubtotalCents: 0, newCustomers: 0 }, ...tracked(nowTs, admin),
    },
  ];
  const restaurantPromos: Array<[string, string, string, Promotion['status']]> = [
    ['mina-kitchen', 'Le déjeuner du Levant', '3 € de remise dès 20 € le midi.', 'active'],
    ['onda-pasta-club', 'Pasta party', '3 € de remise sur les pâtes fraîches dès 20 €.', 'active'],
    ['kumo-ramen', 'Bouillon réconfort', '3 € de remise dès 20 € sur les ramen.', 'active'],
    ['santo-smash', 'Duo smash', '3 € de remise dès 20 € le mardi.', 'active'],
    ['nami-sushi-bar', 'Sushi en duo', '3 € de remise dès 20 € sur les plateaux.', 'active'],
    ['beldi-bowls', 'Bol du marché', '3 € de remise dès 20 €.', 'active'],
    ['casa-arepa', 'Voyage en arepa', 'La deuxième arepa à moitié prix.', 'pending_review'],
    ['le-petit-pho', 'Pho du soir', '3 € de remise après 18 h dès 20 €.', 'active'],
    ['rue-12-bakery', 'Goûter de quartier', '3 € de remise dès 20 € de pâtisseries.', 'active'],
    ['lune-coffee', 'Matin tout doux', '3 € de remise dès 20 € au petit-déjeuner.', 'paused'],
  ];
  for (const [rid, title, description, status] of restaurantPromos) {
    const r = RESTAURANTS.find((x) => x.id === rid);
    if (!r) continue;
    const city = CITIES.find((c) => c.id === r.cityId);
    platform.push({
      id: `promo-${rid}`, scope: 'restaurant', countryId: city?.countryId ?? 'FR', cityIds: [r.cityId], restaurantId: rid, restaurantIds: [],
      title: { fr: title }, description: { fr: description }, code: null, kind: 'fixed', value: 300, maxDiscountCents: null, minSubtotalCents: 2000,
      funding: 'restaurant', restaurantShareBps: null, target: 'everyone', inactiveDays: null, modes: ['delivery', 'pickup'], totalUsageLimit: null, perCustomerLimit: 3,
      startsAt: start, endsAt: null, status, reviewNote: status === 'pending_review' ? null : 'Conforme aux règles de la plateforme.', showcase: status === 'active', accent: r.accent,
      stats: stats(`promo-${rid}`), ...tracked(start, `seed-owner-${rid}`),
    });
  }
  for (const { id, ...promo } of platform) w.set(w.doc(`${COLLECTIONS.promotions}/${id}`), promo);

  // ------------------------------------------------------------ Campagnes
  const campaigns: Array<Campaign & { id: string }> = [
    {
      id: 'campagne-rentree', scope: 'platform', restaurantId: null, name: 'Rentrée gourmande', channel: 'push',
      title: 'La rentrée se fête à table', body: 'Vos restaurants préférés vous attendent : livraison offerte ce soir dès 20 €.',
      emailSubject: null, emailHtml: null, link: { type: 'page', target: 'accueil' },
      audience: { userType: 'client', countryIds: ['FR'], cityIds: null, segment: 'all', marketing: true },
      status: 'sent', scheduledAt: ts(parisTime(addDays(ctx.today, -20), 18 * 60)), sentAt: ts(parisTime(addDays(ctx.today, -20), 18 * 60)),
      stats: { targeted: 94, sent: 91, delivered: 88, opened: 41, clicked: 17, failed: 3 }, ...tracked(ts(parisTime(addDays(ctx.today, -22), 10 * 60)), admin),
    },
    {
      id: 'campagne-luxembourg', scope: 'platform', restaurantId: null, name: 'Découverte Luxembourg', channel: 'email',
      title: 'Nouveaux restaurants à Luxembourg', body: 'Kumo Ramen, Nami Sushi Bar et Beldi Bowls livrent désormais tout le centre.',
      emailSubject: 'Trois nouvelles tables livrées chez vous', emailHtml: null, link: { type: 'url', target: 'https://golink.lu' },
      audience: { userType: 'client', countryIds: ['LU'], cityIds: ['luxembourg'], segment: 'all', marketing: true },
      status: 'scheduled', scheduledAt: ts(parisTime(addDays(ctx.today, 2), 11 * 60)), sentAt: null,
      stats: { targeted: 38, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 }, ...tracked(nowTs, admin),
    },
    {
      id: 'campagne-restaurants-horaires', scope: 'platform', restaurantId: null, name: 'Rappel horaires d’automne', channel: 'in_app',
      title: 'Pensez à vos horaires d’automne', body: 'Mettez à jour vos fermetures exceptionnelles de la Toussaint.',
      emailSubject: null, emailHtml: null, link: null,
      audience: { userType: 'restaurant', countryIds: null, cityIds: null, segment: 'all', marketing: false },
      status: 'draft', scheduledAt: null, sentAt: null, stats: { targeted: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 }, ...tracked(nowTs, admin),
    },
    {
      id: 'campagne-mina', scope: 'restaurant', restaurantId: 'mina-kitchen', name: 'Ce soir, on cuisine pour vous', channel: 'push',
      title: 'Ce soir, on cuisine pour vous', body: 'Retrouvez vos plats préférés de Mina Kitchen ce soir sur GoLink.',
      emailSubject: null, emailHtml: null, link: { type: 'restaurant', target: 'mina-kitchen' },
      audience: { userType: 'client', restaurantIds: ['mina-kitchen'], segment: 'loyal', marketing: true },
      status: 'sent', scheduledAt: ts(parisTime(addDays(ctx.today, -7), 11 * 60 + 30)), sentAt: ts(parisTime(addDays(ctx.today, -7), 11 * 60 + 30)),
      stats: { targeted: 31, sent: 31, delivered: 30, opened: 14, clicked: 6, failed: 0 }, ...tracked(ts(parisTime(addDays(ctx.today, -7), 10 * 60)), account('owner').uid),
    },
  ];
  for (const { id, ...c } of campaigns) w.set(w.doc(`${COLLECTIONS.campaigns}/${id}`), c);

  // ------------------------------------------------------------ Messages automatiques
  const templates: Array<[string, string, MessageTemplate['audience'], MessageTemplate['channels'], string, string, string[]]> = [
    ['order_confirmed', 'Commande acceptée', 'client', ['push', 'in_app'], 'Commande confirmée', '{{restaurantName}} prépare votre commande {{orderNumber}}.', ['restaurantName', 'orderNumber']],
    ['order_picked_up', 'Livreur en route', 'client', ['push'], 'Votre commande arrive', '{{driverName}} est en route, arrivée estimée à {{eta}}.', ['driverName', 'eta']],
    ['order_delivered', 'Commande livrée', 'client', ['push', 'email'], 'Bon appétit !', 'Votre commande {{orderNumber}} a été livrée. Notez votre expérience.', ['orderNumber']],
    ['order_cancelled', 'Commande annulée', 'client', ['push', 'email'], 'Commande annulée', 'Votre commande {{orderNumber}} a été annulée : {{reason}}. Vous êtes remboursé de {{amount}}.', ['orderNumber', 'reason', 'amount']],
    ['refund_issued', 'Remboursement', 'client', ['email', 'in_app'], 'Remboursement effectué', 'Nous vous avons remboursé {{amount}} pour la commande {{orderNumber}}.', ['amount', 'orderNumber']],
    ['restaurant_new_order', 'Nouvelle commande', 'restaurant', ['push', 'in_app'], 'Nouvelle commande', 'Commande {{orderNumber}} : {{itemsCount}} articles, {{total}}.', ['orderNumber', 'itemsCount', 'total']],
    ['restaurant_approved', 'Compte validé', 'restaurant', ['email'], 'Bienvenue sur GoLink', 'Votre établissement {{restaurantName}} est validé : vous pouvez ouvrir aux commandes.', ['restaurantName']],
    ['restaurant_payout_paid', 'Reversement effectué', 'restaurant', ['email'], 'Votre reversement est en route', '{{amount}} ont été virés pour la période {{period}}.', ['amount', 'period']],
    ['restaurant_document_expiring', 'Document bientôt expiré', 'restaurant', ['email', 'in_app'], 'Document à renouveler', 'Votre {{documentType}} expire le {{date}}.', ['documentType', 'date']],
    ['driver_approved', 'Livreur validé', 'driver', ['push', 'email'], 'Vous pouvez commencer', 'Votre compte livreur est validé. Passez en ligne pour recevoir des courses.', []],
    ['driver_payout_paid', 'Paiement livreur', 'driver', ['push', 'email'], 'Paiement envoyé', '{{amount}} ont été virés pour la semaine du {{period}}.', ['amount', 'period']],
    ['admin_invitation', 'Invitation équipe interne', 'admin', ['email'], 'Votre accès à l’administration GoLink', 'Définissez votre mot de passe pour activer votre accès.', []],
  ];
  for (const [key, event, audience, channels, title, body, variables] of templates) {
    const tpl: MessageTemplate = {
      key, event, audience, channels, subject: channels.includes('email') ? { fr: title } : null, title: { fr: title }, body: { fr: body },
      emailHtml: null, variables, active: true, brevoTemplateId: null, updatedAt: nowTs, updatedBy: admin,
    };
    w.set(w.doc(`${COLLECTIONS.messageTemplates}/${key}`), tpl);
  }
  const recent = orders.filter((o) => o.status === 'delivered').slice(-40);
  recent.forEach((o, i) => {
    const client = clients.find((c) => c.uid === o.customerId);
    const log: NotificationLog = {
      channel: i % 4 === 0 ? 'email' : 'push',
      templateKey: 'order_delivered',
      campaignId: null,
      recipientType: 'client',
      recipientId: o.customerId,
      destinationMasked: i % 4 === 0 && client ? maskEmail(client.email) : 'Appareil iOS',
      status: i % 17 === 0 ? 'failed' : i % 3 === 0 ? 'opened' : 'delivered',
      provider: i % 4 === 0 ? 'brevo' : 'fcm',
      providerMessageId: null,
      error: i % 17 === 0 ? 'Jeton d’appareil expiré' : null,
      createdAt: ts(o.deliveredAt ?? o.placedAt),
      updatedAt: ts(o.deliveredAt ?? o.placedAt),
    };
    w.set(w.doc(`${COLLECTIONS.notificationLogs}/seed-${o.id}`), log);
  });

  // ------------------------------------------------------------ Annonces
  const announcements: Array<Announcement & { id: string }> = [
    {
      id: 'annonce-toussaint', audience: 'restaurants', countryIds: null, cityIds: null, planCodes: null,
      title: 'Horaires de la Toussaint', body: 'Pensez à renseigner vos fermetures exceptionnelles du 1er novembre avant le 25 octobre.',
      severity: 'info', link: null, publishedAt: ts(parisTime(addDays(ctx.today, -2), 9 * 60)), expiresAt: ts(parisTime(addDays(ctx.today, 40), 0)), active: true, requiresAcknowledgement: false, ...tracked(nowTs, admin),
    },
    {
      id: 'annonce-maintenance', audience: 'restaurants', countryIds: null, cityIds: null, planCodes: null,
      title: 'Maintenance planifiée', body: 'Le back-office sera indisponible mardi de 3 h à 4 h pour une mise à jour.',
      severity: 'maintenance', link: null, publishedAt: nowTs, expiresAt: ts(parisTime(addDays(ctx.today, 5), 0)), active: true, requiresAcknowledgement: true, ...tracked(nowTs, admin),
    },
    {
      id: 'annonce-livreurs-pluie', audience: 'drivers', countryIds: ['FR'], cityIds: ['metz'], planCodes: null,
      title: 'Prime météo ce week-end', body: '+1,50 € par course samedi et dimanche soir en cas de pluie à Metz.',
      severity: 'important', link: null, publishedAt: nowTs, expiresAt: ts(parisTime(addDays(ctx.today, 3), 0)), active: true, requiresAcknowledgement: false, ...tracked(nowTs, admin),
    },
  ];
  for (const { id, ...a } of announcements) w.set(w.doc(`${COLLECTIONS.announcements}/${id}`), a);

  // ------------------------------------------------------------ Prospection
  const sales = account('sales').uid;
  const prospects: Array<[string, string, string, ProspectStage, string]> = [
    ['Le Comptoir Lorrain', 'longwy', 'Français', 'demo', 'field'],
    ['Taj Mahal Longwy', 'longwy', 'Indien', 'contacted', 'field'],
    ['Pizzeria Da Vinci', 'longwy', 'Italien', 'negotiation', 'referral'],
    ['Sakura Metz', 'metz', 'Japonais', 'to_contact', 'import'],
    ['La Fabrique à Burgers', 'metz', 'Burgers', 'negotiation', 'inbound'],
    ['Chez Mamie Gâteaux', 'metz', 'Desserts', 'lost', 'event'],
    ['Brasserie des Remparts', 'metz', 'Français', 'signed_up', 'field'],
    ['Maison Pita', 'thionville', 'Grec', 'signed_up', 'inbound'],
    ['Le Bistrot du Marché', 'thionville', 'Français', 'contacted', 'field'],
    ['Thai Orchid', 'thionville', 'Thaï', 'to_contact', 'import'],
    ['Um Bock', 'luxembourg', 'Luxembourgeois', 'demo', 'field'],
    ['Poké Kirchberg', 'luxembourg', 'Healthy', 'contacted', 'inbound'],
    ['Churrasqueira Esch', 'esch-sur-alzette', 'Portugais', 'to_contact', 'field'],
    ['Pâtes & Co Esch', 'esch-sur-alzette', 'Italien', 'contacted', 'referral'],
  ];
  prospects.forEach(([name, cityId, cuisine, stage, source], i) => {
    const city = CITIES.find((c) => c.id === cityId);
    const createdAt = ts(parisTime(addDays(ctx.today, -rng.int(5, 70)), 10 * 60));
    const signed = stage === 'signed_up';
    const prospect: Prospect = {
      name,
      countryId: city?.countryId ?? 'FR',
      cityId,
      address: null,
      cuisine,
      contactName: `${rng.pick(['Marc', 'Sophie', 'Ahmed', 'Laura', 'Paulo', 'Nathalie'])} ${rng.pick(['Muller', 'Da Silva', 'Klein', 'Roux', 'Weber'])}`,
      contactEmail: `contact@${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-')}.test`,
      contactPhone: city?.countryId === 'LU' ? `+352 26 ${rng.digits(2)} ${rng.digits(2)} ${rng.digits(2)}` : `+33 3 87 ${rng.digits(2)} ${rng.digits(2)} ${rng.digits(2)}`,
      source: source as Prospect['source'],
      stage,
      ownerId: sales,
      estimatedMonthlyOrders: rng.int(80, 600),
      nextFollowUpAt: stage === 'lost' || signed ? null : ts(parisTime(addDays(ctx.today, rng.int(-2, 10)), 10 * 60)),
      lostReason: stage === 'lost' ? 'Déjà sous contrat d’exclusivité avec un concurrent.' : null,
      restaurantId: signed ? (name === 'Maison Pita' ? 'maison-pita' : 'brasserie-des-remparts') : null,
      signedUpAt: signed ? ts(parisTime(addDays(ctx.today, -2), 15 * 60)) : null,
      notes: null,
      ...tracked(createdAt, sales),
    };
    const id = `prospect-${i + 1}`;
    w.set(w.doc(`${COLLECTIONS.prospects}/${id}`), prospect);
    const activities: ProspectActivity[] = [{ type: 'note', summary: 'Fiche créée après repérage.', fromStage: null, toStage: 'to_contact', by: sales, at: createdAt }];
    if (stage !== 'to_contact') activities.push({ type: 'visit', summary: 'Passage au restaurant, présentation de GoLink au gérant.', fromStage: 'to_contact', toStage: 'contacted', by: sales, at: ts(minutesDays(createdAt.toDate(), 3)) });
    if (['demo', 'negotiation', 'signed_up'].includes(stage)) activities.push({ type: 'demo', summary: 'Démonstration du back-office et simulation de commission.', fromStage: 'contacted', toStage: 'demo', by: sales, at: ts(minutesDays(createdAt.toDate(), 8)) });
    if (stage === 'negotiation') activities.push({ type: 'call', summary: 'Demande une commission à 25 % les trois premiers mois.', fromStage: 'demo', toStage: 'negotiation', by: sales, at: ts(minutesDays(createdAt.toDate(), 12)) });
    activities.forEach((a, j) => w.set(w.doc(`${COLLECTIONS.prospects}/${id}/${SUBCOLLECTIONS.prospects.activities}/a${j + 1}`), a));
  });
  const commission: SalesCommission = { salesRepId: sales, restaurantId: 'maison-pita', prospectId: 'prospect-8', basis: 'signup_bonus', amountCents: 15000, period: ctx.today.slice(0, 7), status: 'pending', createdAt: nowTs, paidAt: null };
  w.set(w.doc(`${COLLECTIONS.salesCommissions}/commission-maison-pita`), commission);

  // ------------------------------------------------------------ Parrainages
  for (let i = 0; i < 6; i += 1) {
    const referrer = clients[i * 7];
    const referee = clients[i * 7 + 3];
    if (!referrer || !referee) continue;
    const qualified = referee.stats.orders > 0;
    const referral: Referral = {
      program: 'client', referrerId: referrer.uid, referrerType: 'client', refereeId: referee.uid, refereeType: 'client', code: `PARRAIN${i + 1}`,
      status: qualified ? 'rewarded' : 'pending', qualifyingOrderId: null, referrerRewardCents: 500, refereeRewardCents: 500,
      createdAt: ts(referee.createdAt), qualifiedAt: qualified && referee.stats.first ? ts(referee.stats.first) : null, rewardedAt: qualified && referee.stats.first ? ts(referee.stats.first) : null,
    };
    w.set(w.doc(`${COLLECTIONS.referrals}/parrainage-${i + 1}`), referral);
  }
}

function minutesDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

