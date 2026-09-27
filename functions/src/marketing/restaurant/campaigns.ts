// Campagnes d'un établissement : notification push (et centre de notifications
// de l'app) ou e-mail, envoyées uniquement aux clients du restaurant ayant
// consenti aux communications marketing. Envoi immédiat ou programmé.
import {
  COLLECTIONS,
  RESTAURANT_CAMPAIGN_RULES,
  RESTAURANT_CAMPAIGN_SEGMENTS,
  RESTAURANT_CAMPAIGN_SEGMENT_LABELS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  maskEmail,
  restaurantPublicUrl,
  type Campaign,
  type CampaignSettings,
  type NotificationLog,
  type Promotion,
  type RestaurantCampaignSegment,
  type RestaurantCustomer,
  type UserDevice,
  type UserProfile,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getMessaging } from 'firebase-admin/messaging';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { sendEmail } from '../../lib/brevo';
import { callable } from '../../lib/callable';
import { renderEmail } from '../../lib/email-layout';
import { fail } from '../../lib/errors';
import { requireRestaurantAccess } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { assertFeatureAllowed } from '../../finance/argent/entitlements';
import { z, zId } from '../../lib/validation';
import { loadRestaurant, parisHour, type RestaurantDoc } from './helpers';

const DAY = 86_400_000;
const RULES = RESTAURANT_CAMPAIGN_RULES;
type Channel = 'push' | 'email';

/**
 * Les e-mails marketing ne partent vers Brevo que si MARKETING_EMAILS_LIVE=true
 * (variable d'environnement des fonctions) et jamais vers un domaine réservé aux tests.
 */
const RESERVED_DOMAINS = /\.(test|example|invalid|localhost)$/i;
function emailsLive(): boolean {
  return process.env.MARKETING_EMAILS_LIVE === 'true';
}

// ------------------------------------------------------------------ Audience

interface Recipient {
  uid: string;
  name: string;
  email: string | null;
}

interface Audience {
  /** Clients du segment (avant consentement). */
  segmentCount: number;
  /** Clients du segment ayant consenti au canal. */
  recipients: Recipient[];
}

function inSegment(customer: RestaurantCustomer, segment: RestaurantCampaignSegment, inactiveDays: number, now: number): boolean {
  if (customer.blocked || customer.ordersCount < 1) return false;
  const first = customer.firstOrderAt?.toMillis() ?? 0;
  const last = customer.lastOrderAt?.toMillis() ?? 0;
  switch (segment) {
    case 'all':
      return true;
    case 'new':
      return customer.ordersCount === 1 && now - first <= RULES.newMaxAgeDays * DAY;
    case 'loyal':
      return customer.ordersCount >= RULES.loyalMinOrders;
    case 'inactive':
      return last > 0 && now - last >= inactiveDays * DAY;
  }
}

async function buildAudience(restaurantId: string, channel: Channel, segment: RestaurantCampaignSegment, inactiveDays: number): Promise<Audience> {
  const now = Date.now();
  const customers = await db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.customers)
    .get();
  const ids = customers.docs
    .filter((doc) => inSegment(doc.data() as RestaurantCustomer, segment, inactiveDays, now))
    .map((doc) => doc.id);
  const recipients: Recipient[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.users).doc(id));
    const users = refs.length ? await db.getAll(...refs) : [];
    for (const snap of users) {
      if (!snap.exists) continue;
      const user = snap.data() as UserProfile;
      if (user.status !== 'active' || user.deletedAt) continue;
      const consent = channel === 'push' ? user.consents?.marketing_push : user.consents?.marketing_email;
      if (consent !== true) continue;
      if (channel === 'email' && !user.email) continue;
      recipients.push({ uid: snap.id, name: user.firstName || user.displayName, email: user.email ?? null });
    }
  }
  return { segmentCount: ids.length, recipients };
}

const audienceSchema = z.object({
  restaurantId: zId,
  channel: z.enum(['push', 'email']),
  segment: z.enum(RESTAURANT_CAMPAIGN_SEGMENTS),
  inactiveDays: z.number().int().min(14).max(365).default(RULES.inactiveDefaultDays),
});

/** Estimation en direct de l'audience (formulaire de campagne). */
export const estimateCampaignAudience = callable(audienceSchema, async (data, request) => {
  await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage', 'notifications.send');
  const audience = await buildAudience(data.restaurantId, data.channel, data.segment, data.inactiveDays);
  return { segmentCount: audience.segmentCount, reachable: audience.recipients.length };
});

// ------------------------------------------------------------------ Création et programmation

const scheduleSchema = audienceSchema.extend({
  campaignId: zId.nullish(),
  name: z.string().trim().min(3, 'Donnez un nom à la campagne.').max(80),
  title: z.string().trim().min(3, 'Le titre doit contenir au moins 3 caractères.').max(RULES.titleMax),
  body: z.string().trim().min(10, 'Le message doit contenir au moins 10 caractères.').max(RULES.bodyMax),
  emailSubject: z.string().trim().max(RULES.subjectMax).nullable().default(null),
  promotionId: zId.nullable().default(null),
  mode: z.enum(['draft', 'schedule', 'send_now']),
  /** Millisecondes depuis l'époque (programmation). */
  scheduledAt: z.number().int().nullable().default(null),
});

/** Garde-fous des campagnes, paramétrables par le super admin (valeurs par défaut identiques aux anciennes constantes). */
async function loadCampaignSettings(): Promise<Pick<CampaignSettings, 'maxSendsPer7Days' | 'sendWindow'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.campaignRules).get();
  const data = snap.data() as Partial<CampaignSettings> | undefined;
  return {
    maxSendsPer7Days: data?.maxSendsPer7Days ?? RULES.maxSendsPer7Days,
    sendWindow: data?.sendWindow ?? RULES.sendWindow,
  };
}

function assertSendWindow(date: Date, when: 'now' | 'scheduled', sendWindow: { fromHour: number; toHour: number }) {
  const hour = parisHour(date);
  const { fromHour, toHour } = sendWindow;
  if (hour < fromHour || hour >= toHour) {
    throw fail.precondition(
      when === 'now'
        ? `Pour respecter vos clients, les envois sont possibles entre ${fromHour} h et ${toHour} h (heure de Paris). Programmez plutôt votre campagne.`
        : `Choisissez une heure d’envoi entre ${fromHour} h et ${toHour} h (heure de Paris).`,
    );
  }
}

/** Au plus N envois (programmés ou partis) sur 7 jours glissants autour de la date visée. */
async function assertWeeklyQuota(restaurantId: string, at: number, maxSendsPer7Days: number, exceptId?: string) {
  const snap = await db
    .collection(COLLECTIONS.campaigns)
    .where('scope', '==', 'restaurant')
    .where('restaurantId', '==', restaurantId)
    .orderBy('createdAt', 'desc')
    .limit(60)
    .get();
  const near = snap.docs.filter((doc) => {
    if (doc.id === exceptId) return false;
    const c = doc.data() as Campaign;
    if (!['scheduled', 'sending', 'sent'].includes(c.status)) return false;
    const when = (c.sentAt ?? c.scheduledAt)?.toMillis();
    return when !== undefined && Math.abs(when - at) < 7 * DAY;
  }).length;
  if (near >= maxSendsPer7Days) {
    throw fail.precondition(`Vous avez déjà ${near} campagnes sur ces 7 jours (maximum ${maxSendsPer7Days}) : espacez vos envois pour ne pas lasser vos clients.`);
  }
}

export const scheduleCampaign = callable(
  scheduleSchema,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'marketing.manage', 'notifications.send');
    const restaurant = await loadRestaurant(data.restaurantId);
    await assertFeatureAllowed(restaurant.id, 'push_campaigns');
    const campaignSettings = await loadCampaignSettings();
    const now = Date.now();

    if (data.promotionId) {
      const promo = await db.collection(COLLECTIONS.promotions).doc(data.promotionId).get();
      const p = promo.data() as Promotion | undefined;
      if (!p || p.restaurantId !== restaurant.id || p.status !== 'active') throw fail.invalid('L’offre associée doit être une offre en ligne de l’établissement.');
    }

    let scheduledAt: number | null = null;
    if (data.mode === 'schedule') {
      if (!data.scheduledAt) throw fail.invalid('Choisissez la date et l’heure d’envoi.');
      if (data.scheduledAt < now + 5 * 60_000) throw fail.invalid('Programmez l’envoi au moins 5 minutes à l’avance.');
      if (data.scheduledAt > now + RULES.maxScheduleDays * DAY) throw fail.invalid(`Programmez l’envoi dans les ${RULES.maxScheduleDays} prochains jours.`);
      assertSendWindow(new Date(data.scheduledAt), 'scheduled', campaignSettings.sendWindow);
      scheduledAt = data.scheduledAt;
    }
    if (data.mode === 'send_now') assertSendWindow(new Date(now), 'now', campaignSettings.sendWindow);
    if (data.mode !== 'draft') await assertWeeklyQuota(restaurant.id, scheduledAt ?? now, campaignSettings.maxSendsPer7Days, data.campaignId ?? undefined);

    const ref = data.campaignId ? db.collection(COLLECTIONS.campaigns).doc(data.campaignId) : db.collection(COLLECTIONS.campaigns).doc();
    let existing: Campaign | null = null;
    if (data.campaignId) {
      const snap = await ref.get();
      existing = (snap.data() as Campaign | undefined) ?? null;
      if (!existing || existing.scope !== 'restaurant' || existing.restaurantId !== restaurant.id) throw fail.notFound('Campagne');
      if (existing.status !== 'draft' && existing.status !== 'scheduled') throw fail.precondition('Cette campagne est déjà partie : dupliquez-la pour la renvoyer.');
    }

    const audience = await buildAudience(restaurant.id, data.channel, data.segment, data.inactiveDays);
    if (data.mode !== 'draft' && audience.recipients.length === 0) {
      throw fail.precondition('Aucun client de ce segment n’a accepté de recevoir vos offres par ce canal pour le moment.');
    }

    const stamp = Timestamp.now();
    const campaign: Omit<Campaign, 'createdAt' | 'createdBy'> = {
      scope: 'restaurant',
      restaurantId: restaurant.id,
      name: data.name,
      channel: data.channel,
      title: data.title,
      body: data.body,
      emailSubject: data.channel === 'email' ? data.emailSubject || data.title : null,
      emailHtml: null,
      link: data.promotionId ? { type: 'promotion', target: data.promotionId } : { type: 'restaurant', target: restaurant.id },
      audience: {
        userType: 'client',
        restaurantIds: [restaurant.id],
        segment: data.segment,
        inactiveDays: data.segment === 'inactive' ? data.inactiveDays : null,
        marketing: true,
      },
      promotionId: data.promotionId,
      status: data.mode === 'draft' ? 'draft' : data.mode === 'schedule' ? 'scheduled' : 'sending',
      scheduledAt: scheduledAt ? Timestamp.fromMillis(scheduledAt) : data.mode === 'send_now' ? stamp : null,
      sentAt: null,
      stats: { targeted: audience.recipients.length, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 },
      testMode: data.channel === 'email' && !emailsLive(),
      cancelledAt: null,
      failureReason: null,
      updatedAt: stamp,
      updatedBy: actor.caller.uid,
    };
    if (existing) await ref.update(campaign);
    else await ref.set({ ...campaign, createdAt: stamp, createdBy: actor.caller.uid });

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: data.mode === 'draft' ? 'campaign.saved' : data.mode === 'schedule' ? 'campaign.scheduled' : 'campaign.sent',
      target: { type: 'other', id: ref.id, label: data.name },
      after: { status: campaign.status, channel: data.channel, segment: data.segment, targeted: audience.recipients.length },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });

    if (data.mode === 'send_now') {
      const stats = await deliverCampaign(ref.id, restaurant, audience.recipients);
      return { campaignId: ref.id, status: 'sent' as const, stats };
    }
    return { campaignId: ref.id, status: campaign.status, stats: campaign.stats };
  },
  { secrets: EMAIL_SECRETS, timeoutSeconds: 300, memory: '512MiB' },
);

export const cancelCampaign = callable(z.object({ campaignId: zId }), async (data, request) => {
  const ref = db.collection(COLLECTIONS.campaigns).doc(data.campaignId);
  const snap = await ref.get();
  const campaign = snap.data() as Campaign | undefined;
  if (!campaign || campaign.scope !== 'restaurant' || !campaign.restaurantId) throw fail.notFound('Campagne');
  const actor = await requireRestaurantAccess(request, campaign.restaurantId, 'marketing.manage', 'notifications.send');
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') throw fail.precondition('Cette campagne ne peut plus être annulée.');
  await ref.update({ status: 'cancelled', cancelledAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: actor.caller.uid });
  const restaurant = await loadRestaurant(campaign.restaurantId);
  await writeAudit({
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action: 'campaign.cancelled',
    target: { type: 'other', id: ref.id, label: campaign.name },
    before: { status: campaign.status },
    after: { status: 'cancelled' },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    request,
  });
  return { campaignId: ref.id, status: 'cancelled' as const };
});

// ------------------------------------------------------------------ Envoi

/** Passe la campagne en « envoi en cours » si elle est encore à envoyer (un seul envoi possible). */
async function claimCampaign(campaignId: string): Promise<Campaign | null> {
  const ref = db.collection(COLLECTIONS.campaigns).doc(campaignId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const campaign = snap.data() as Campaign | undefined;
    if (!campaign || campaign.status !== 'scheduled') return null;
    tx.update(ref, { status: 'sending', sendingStartedAt: Timestamp.now() });
    return campaign;
  });
}

async function clientTokens(uid: string): Promise<string[]> {
  const snap = await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.devices).where('app', '==', 'client').get();
  return snap.docs.map((d) => (d.data() as UserDevice).fcmToken).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

function campaignEmail(campaign: Campaign, restaurant: RestaurantDoc) {
  const url = restaurantPublicUrl(restaurant.slug, 'campagne');
  return {
    subject: campaign.emailSubject || campaign.title,
    ...renderEmail({
      preheader: campaign.body.slice(0, 120),
      eyebrow: restaurant.name,
      title: campaign.title,
      paragraphs: campaign.body.split(/\n+/).filter(Boolean),
      cta: { label: `Commander chez ${restaurant.name}`, url },
      footerReason: `Vous recevez cet e-mail car vous avez commandé chez ${restaurant.name} sur GoLink et accepté de recevoir ses offres. Vous pouvez retirer ce consentement à tout moment dans les réglages de votre compte GoLink.`,
    }),
  };
}

/** Envoie une campagne déjà réservée (statut « sending ») et enregistre les statistiques. */
async function deliverCampaign(campaignId: string, restaurant: RestaurantDoc, preset?: Recipient[]) {
  const ref = db.collection(COLLECTIONS.campaigns).doc(campaignId);
  const campaign = (await ref.get()).data() as Campaign;
  const channel = campaign.channel === 'email' ? 'email' : 'push';
  const segment = (campaign.audience.segment ?? 'all') as RestaurantCampaignSegment;
  const recipients =
    preset ?? (await buildAudience(restaurant.id, channel, segment, campaign.audience.inactiveDays ?? RULES.inactiveDefaultDays)).recipients;
  const link = campaign.promotionId
    ? { type: 'promotion' as const, target: campaign.promotionId }
    : { type: 'page' as const, target: `restaurant/${restaurant.id}` };
  const stats = { targeted: recipients.length, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 };
  const logs: Array<Omit<NotificationLog, 'createdAt' | 'updatedAt'>> = [];

  if (channel === 'push') {
    const tokens: string[] = [];
    for (let i = 0; i < recipients.length; i += 400) {
      const batch = db.batch();
      for (const r of recipients.slice(i, i + 400)) {
        batch.set(db.collection(COLLECTIONS.users).doc(r.uid).collection(SUBCOLLECTIONS.users.notifications).doc(`campagne-${campaignId}`), {
          title: campaign.title,
          body: campaign.body,
          category: 'promotion',
          link,
          read: false,
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    for (let i = 0; i < recipients.length; i += 20) {
      const chunk = await Promise.all(recipients.slice(i, i + 20).map((r) => clientTokens(r.uid)));
      chunk.forEach((list) => tokens.push(...list));
    }
    let pushFailures = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      try {
        const result = await getMessaging().sendEachForMulticast({
          tokens: tokens.slice(i, i + 500),
          notification: { title: campaign.title, body: campaign.body },
          data: { type: 'campaign', campaignId, restaurantId: restaurant.id },
        });
        pushFailures += result.failureCount;
      } catch (error) {
        logger.warn('Envoi FCM impossible', { campaignId, error: error instanceof Error ? error.message : String(error) });
        pushFailures += Math.min(500, tokens.length - i);
      }
    }
    stats.sent = recipients.length;
    stats.delivered = recipients.length;
    for (const r of recipients) {
      logs.push({
        channel: 'push',
        templateKey: null,
        campaignId,
        recipientType: 'client',
        recipientId: r.uid,
        destinationMasked: 'Centre de notifications GoLink',
        status: 'delivered',
        provider: 'fcm',
        providerMessageId: null,
        error: null,
      });
    }
    if (pushFailures > 0) logger.info('Jetons push refusés', { campaignId, pushFailures });
  } else {
    const live = emailsLive();
    const message = campaignEmail(campaign, restaurant);
    for (const r of recipients) {
      if (!r.email) continue;
      if (!live || RESERVED_DOMAINS.test(r.email)) {
        stats.sent += 1;
        logs.push({
          channel: 'email',
          templateKey: null,
          campaignId,
          recipientType: 'client',
          recipientId: r.uid,
          destinationMasked: maskEmail(r.email),
          status: 'queued',
          provider: 'brevo',
          providerMessageId: null,
          error: 'Mode test : e-mail préparé mais non transmis.',
        });
        continue;
      }
      const result = await sendEmail({
        to: { email: r.email, name: r.name },
        message,
        recipientType: 'client',
        recipientId: r.uid,
        templateKey: `campagne-restaurant`,
        tags: [campaignId],
      });
      if (result.ok) {
        stats.sent += 1;
        stats.delivered += 1;
      } else {
        stats.failed += 1;
      }
    }
  }

  for (let i = 0; i < logs.length; i += 400) {
    const batch = db.batch();
    for (const log of logs.slice(i, i + 400)) {
      batch.set(db.collection(COLLECTIONS.notificationLogs).doc(), { ...log, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }

  await ref.update({
    status: stats.sent === 0 && stats.failed > 0 ? 'failed' : 'sent',
    sentAt: Timestamp.now(),
    stats,
    failureReason: stats.sent === 0 && stats.failed > 0 ? 'Aucun message n’a pu être envoyé.' : null,
    updatedAt: Timestamp.now(),
  });
  return stats;
}

/** Toutes les 5 minutes : envoi des campagnes restaurant arrivées à échéance. */
export const dispatchScheduledCampaigns = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Europe/Paris', secrets: EMAIL_SECRETS, timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const due = await db
      .collection(COLLECTIONS.campaigns)
      .where('scope', '==', 'restaurant')
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', Timestamp.now())
      .limit(20)
      .get();
    for (const doc of due.docs) {
      const claimed = await claimCampaign(doc.id);
      if (!claimed?.restaurantId) continue;
      try {
        const restaurant = await loadRestaurant(claimed.restaurantId);
        const stats = await deliverCampaign(doc.id, restaurant);
        await writeAudit({
          actor: SYSTEM_ACTOR,
          action: 'campaign.sent',
          target: { type: 'other', id: doc.id, label: claimed.name },
          after: { segment: RESTAURANT_CAMPAIGN_SEGMENT_LABELS[(claimed.audience.segment ?? 'all') as RestaurantCampaignSegment], ...stats },
          countryId: restaurant.countryId,
          cityId: restaurant.cityId,
        });
      } catch (error) {
        logger.error('Échec d’envoi de campagne', { campaignId: doc.id, error: error instanceof Error ? error.stack : String(error) });
        await doc.ref.update({ status: 'failed', failureReason: 'Erreur technique pendant l’envoi.', updatedAt: Timestamp.now() });
      }
    }
  },
);
