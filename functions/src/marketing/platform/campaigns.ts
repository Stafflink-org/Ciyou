// Envois de l'équipe GoLink (cahier §20) : push, e-mail, SMS ou message dans l'app,
// à tous ou à une cible (pays, villes, formules, restaurants, segment de clients).
// Les messages promotionnels ne partent qu'aux clients ayant donné leur consentement.
// Envoi immédiat ou programmé (tâche `sendCampaign`, toutes les 5 minutes).
import {
  CAMPAIGN_CHANNELS,
  COLLECTIONS,
  SUBCOLLECTIONS,
  maskEmail,
  maskPhone,
  type AdminUser,
  type AudienceFilter,
  type Campaign,
  type ConsentKey,
  type Driver,
  type NotificationLog,
  type PlanCode,
  type Restaurant,
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
import { requireAdmin } from '../../lib/permissions';
import { BREVO_API_KEY, EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import { campaignsLive, DAY_MS, pushInApp, RESERVED_EMAIL } from './common';

const MAX_RECIPIENTS = 20_000;
const PLAN_CODES = ['basic', 'pro', 'premium'] as const satisfies readonly PlanCode[];
/** Plage horaire des messages promotionnels poussés (push, SMS), heure de Paris. */
const QUIET = { fromHour: 9, toHour: 21 };

type Channel = Campaign['channel'];

const audienceSchema = z.object({
  userType: z.enum(['client', 'restaurant', 'driver']),
  countryIds: z.array(z.string().min(2).max(3)).max(10).nullable().default(null),
  cityIds: z.array(zId).max(30).nullable().default(null),
  planCodes: z.array(z.enum(PLAN_CODES)).max(3).nullable().default(null),
  restaurantIds: z.array(zId).max(30).nullable().default(null),
  segment: z.enum(['all', 'new', 'inactive', 'loyal']).nullable().default('all'),
  inactiveDays: z.number().int().min(7).max(365).nullable().default(null),
  marketing: z.boolean(),
});
type AudienceInput = z.output<typeof audienceSchema>;

interface Recipient {
  uid: string;
  name: string;
  email: string | null;
  phone: string | null;
}

// ------------------------------------------------------------------ Audience

/** Périmètre de l'administrateur : un responsable de ville cible uniquement ses villes. */
function scopeAudience(admin: AdminUser, audience: AudienceInput): AudienceInput {
  if (admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0)) return audience;
  if (admin.cityIds.length > 0) {
    const cities = (audience.cityIds ?? []).filter((c) => admin.cityIds.includes(c));
    if (cities.length === 0) throw fail.forbidden('Choisissez au moins une ville de votre périmètre.');
    return { ...audience, cityIds: cities };
  }
  const countries = (audience.countryIds ?? []).filter((c) => admin.countryIds.includes(c));
  if (countries.length === 0 && !audience.cityIds?.length) throw fail.forbidden('Choisissez un pays de votre périmètre.');
  return { ...audience, countryIds: countries.length ? countries : audience.countryIds };
}

function consentKey(channel: Channel): ConsentKey | null {
  if (channel === 'email') return 'marketing_email';
  if (channel === 'sms') return 'marketing_sms';
  if (channel === 'push') return 'marketing_push';
  return null;
}

function inGeo(a: AudienceInput, countryId: string | null | undefined, cityId: string | null | undefined): boolean {
  if (a.cityIds?.length && (!cityId || !a.cityIds.includes(cityId))) return false;
  if (a.countryIds?.length && (!countryId || !a.countryIds.includes(countryId))) return false;
  return true;
}

function inSegment(user: UserProfile, a: AudienceInput, now: number): boolean {
  const orders = user.stats?.ordersCount ?? 0;
  const last = user.stats?.lastOrderAt?.toMillis() ?? 0;
  const created = user.createdAt?.toMillis() ?? 0;
  switch (a.segment ?? 'all') {
    case 'new':
      return orders <= 1 && now - created <= 30 * DAY_MS;
    case 'inactive':
      return orders > 0 && now - last >= (a.inactiveDays ?? 30) * DAY_MS;
    case 'loyal':
      return orders >= 5;
    default:
      return true;
  }
}

function reachable(channel: Channel, r: Recipient): boolean {
  if (channel === 'email') return Boolean(r.email);
  if (channel === 'sms') return Boolean(r.phone);
  return true;
}

async function clientAudience(a: AudienceInput, channel: Channel): Promise<{ matched: number; recipients: Recipient[] }> {
  const now = Date.now();
  let restrictTo: Set<string> | null = null;
  if (a.restaurantIds?.length) {
    restrictTo = new Set();
    for (const rid of a.restaurantIds) {
      const snap = await db.collection(COLLECTIONS.restaurants).doc(rid).collection(SUBCOLLECTIONS.restaurants.customers).select().get();
      snap.docs.forEach((d) => restrictTo?.add(d.id));
    }
  }
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.users).where('role', '==', 'client');
  if (a.cityIds?.length === 1) q = q.where('cityId', '==', a.cityIds[0]);
  else if (a.countryIds?.length === 1) q = q.where('countryId', '==', a.countryIds[0]);
  const snap = await q.limit(MAX_RECIPIENTS * 2).get();
  const key = consentKey(channel);
  let matched = 0;
  const recipients: Recipient[] = [];
  for (const doc of snap.docs) {
    const user = doc.data() as UserProfile;
    if (user.status !== 'active' || user.deletedAt) continue;
    if (restrictTo && !restrictTo.has(doc.id)) continue;
    if (!inGeo(a, user.countryId, user.cityId)) continue;
    if (!inSegment(user, a, now)) continue;
    matched += 1;
    if (a.marketing && key && user.consents?.[key] !== true) continue;
    if (a.marketing && !key && user.consents?.marketing_push !== true && user.consents?.marketing_email !== true) continue;
    const r = { uid: doc.id, name: user.firstName || user.displayName, email: user.email ?? null, phone: user.phone ?? null };
    if (reachable(channel, r)) recipients.push(r);
  }
  return { matched, recipients: recipients.slice(0, MAX_RECIPIENTS) };
}

async function restaurantAudience(a: AudienceInput, channel: Channel): Promise<{ matched: number; recipients: Recipient[] }> {
  let docs: FirebaseFirestore.QueryDocumentSnapshot[];
  if (a.restaurantIds?.length) {
    const snaps = await db.getAll(...a.restaurantIds.map((id) => db.collection(COLLECTIONS.restaurants).doc(id)));
    docs = snaps.filter((s) => s.exists) as FirebaseFirestore.QueryDocumentSnapshot[];
  } else {
    docs = (await db.collection(COLLECTIONS.restaurants).limit(5000).get()).docs;
  }
  const recipients: Recipient[] = [];
  let matched = 0;
  const owners = new Set<string>();
  for (const doc of docs) {
    const r = doc.data() as Restaurant;
    if (r.deletedAt || r.status === 'closed' || r.status === 'onboarding') continue;
    if (!inGeo(a, r.countryId, r.cityId)) continue;
    if (a.planCodes?.length && !a.planCodes.includes(r.planCode)) continue;
    matched += 1;
    if (!r.ownerId || owners.has(r.ownerId)) continue;
    owners.add(r.ownerId);
    const recipient = { uid: r.ownerId, name: r.name, email: r.email ?? null, phone: r.phone ?? null };
    if (reachable(channel, recipient)) recipients.push(recipient);
  }
  return { matched, recipients };
}

async function driverAudience(a: AudienceInput, channel: Channel): Promise<{ matched: number; recipients: Recipient[] }> {
  let q: FirebaseFirestore.Query = db.collection(COLLECTIONS.drivers);
  if (a.cityIds?.length === 1) q = q.where('cityId', '==', a.cityIds[0]);
  const snap = await q.limit(MAX_RECIPIENTS).get();
  const recipients: Recipient[] = [];
  let matched = 0;
  for (const doc of snap.docs) {
    const d = doc.data() as Driver;
    if (d.deletedAt || d.status !== 'active') continue;
    if (!inGeo(a, d.countryId, d.cityId)) continue;
    matched += 1;
    const r = { uid: doc.id, name: d.firstName || d.displayName, email: d.email ?? null, phone: d.phone ?? null };
    if (reachable(channel, r)) recipients.push(r);
  }
  return { matched, recipients };
}

async function buildAudience(a: AudienceInput, channel: Channel) {
  if (a.userType === 'restaurant') return restaurantAudience(a, channel);
  if (a.userType === 'driver') return driverAudience(a, channel);
  return clientAudience(a, channel);
}

export const estimatePlatformAudience = callable(
  z.object({ channel: z.enum(CAMPAIGN_CHANNELS), audience: audienceSchema }),
  async (data, request) => {
    const { admin } = await requireAdmin(request, 'notifications.send');
    const audience = scopeAudience(admin, data.audience);
    const result = await buildAudience(audience, data.channel);
    return { matched: result.matched, reachable: result.recipients.length };
  },
  { timeoutSeconds: 120, memory: '512MiB' },
);

// ------------------------------------------------------------------ Enregistrement

const saveSchema = z.object({
  campaignId: zId.nullish(),
  mode: z.enum(['draft', 'schedule', 'send_now', 'test', 'cancel']),
  name: z.string().trim().min(3, 'Donnez un nom à l’envoi.').max(80),
  channel: z.enum(CAMPAIGN_CHANNELS),
  title: z.string().trim().min(3, 'Le titre doit contenir au moins 3 caractères.').max(80),
  body: z.string().trim().min(10, 'Le message doit contenir au moins 10 caractères.').max(1000),
  emailSubject: z.string().trim().max(120).nullable().default(null),
  link: z
    .object({ type: z.enum(['restaurant', 'promotion', 'page', 'url']), target: z.string().trim().min(1).max(300) })
    .nullable()
    .default(null),
  audience: audienceSchema,
  scheduledAt: z.number().int().nullable().default(null),
  /** Motif : obligatoire pour programmer, envoyer ou annuler un envoi de masse. */
  reason: zReason.nullish(),
}).refine((d) => !['schedule', 'send_now', 'cancel'].includes(d.mode) || Boolean(d.reason), {
  path: ['reason'],
  message: 'Indiquez le motif de cet envoi.',
});
type SaveInput = z.output<typeof saveSchema>;

function parisHour(date: Date): number {
  return Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(date));
}

function assertContent(data: SaveInput) {
  if (data.channel === 'sms' && data.body.length > 320) throw fail.invalid('Un SMS est limité à 320 caractères (2 SMS).');
  if (data.channel === 'push' && data.body.length > 240) throw fail.invalid('Une notification push est limitée à 240 caractères.');
  if (data.link?.type === 'url' && !/^https:\/\//.test(data.link.target)) throw fail.invalid('Le lien doit commencer par https://');
  if (data.audience.userType !== 'client' && data.audience.segment && data.audience.segment !== 'all') {
    throw fail.invalid('Les segments de fidélité ne concernent que les clients.');
  }
}

function assertQuietHours(data: SaveInput, at: Date) {
  if (!data.audience.marketing || (data.channel !== 'push' && data.channel !== 'sms')) return;
  const hour = parisHour(at);
  if (hour < QUIET.fromHour || hour >= QUIET.toHour) {
    throw fail.precondition(`Les messages promotionnels push et SMS partent entre ${QUIET.fromHour} h et ${QUIET.toHour} h (heure de Paris). Programmez l’envoi dans cette plage.`);
  }
}

function stats(targeted = 0) {
  return { targeted, sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 };
}

export const savePlatformCampaign = callable(
  saveSchema,
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'notifications.send');
    const ref = data.campaignId ? db.collection(COLLECTIONS.campaigns).doc(data.campaignId) : db.collection(COLLECTIONS.campaigns).doc();
    let existing: Campaign | null = null;
    if (data.campaignId) {
      existing = ((await ref.get()).data() as Campaign | undefined) ?? null;
      if (!existing || existing.scope !== 'platform') throw fail.notFound('Envoi');
    }
    const now = Timestamp.now();
    const audit = { actor: actorFromCaller(caller, 'admin'), target: { type: 'other' as const, id: ref.id, label: data.name }, reason: data.reason ?? null, request };

    if (data.mode === 'cancel') {
      if (!existing || !['draft', 'scheduled'].includes(existing.status)) throw fail.precondition('Cet envoi ne peut plus être annulé.');
      await ref.update({ status: 'cancelled', cancelledAt: now, updatedAt: now, updatedBy: caller.uid });
      await writeAudit({ ...audit, action: 'campaign.cancelled', before: { status: existing.status }, after: { status: 'cancelled' } });
      return { campaignId: ref.id, status: 'cancelled' as const, stats: existing.stats };
    }
    if (existing && !['draft', 'scheduled'].includes(existing.status)) throw fail.precondition('Cet envoi est déjà parti : dupliquez-le pour le renvoyer.');

    assertContent(data);
    const audience = scopeAudience(admin, data.audience);

    if (data.mode === 'test') {
      // Envoi d'essai : uniquement dans le centre de notifications de l'administrateur.
      await pushInApp(caller.uid, { title: `[Test] ${data.title}`, body: data.body, category: 'announcement', link: null });
      return { campaignId: existing ? ref.id : null, status: existing?.status ?? 'draft', stats: existing?.stats ?? stats() };
    }

    let scheduledAt: number | null = null;
    if (data.mode === 'schedule') {
      if (!data.scheduledAt) throw fail.invalid('Choisissez la date et l’heure d’envoi.');
      if (data.scheduledAt < Date.now() + 5 * 60_000) throw fail.invalid('Programmez l’envoi au moins 5 minutes à l’avance.');
      if (data.scheduledAt > Date.now() + 90 * DAY_MS) throw fail.invalid('Programmez l’envoi dans les 90 prochains jours.');
      assertQuietHours(data, new Date(data.scheduledAt));
      scheduledAt = data.scheduledAt;
    }
    if (data.mode === 'send_now') assertQuietHours(data, new Date());

    const built = await buildAudience(audience, data.channel);
    if (data.mode !== 'draft' && built.recipients.length === 0) {
      throw fail.precondition(
        audience.marketing && audience.userType === 'client'
          ? 'Aucun destinataire joignable : aucun client de cette cible n’a accepté ce canal pour les offres.'
          : 'Aucun destinataire joignable pour cette cible et ce canal.',
      );
    }

    const storedAudience: AudienceFilter = {
      userType: audience.userType,
      countryIds: audience.countryIds?.length ? audience.countryIds : null,
      cityIds: audience.cityIds?.length ? audience.cityIds : null,
      planCodes: audience.userType === 'restaurant' && audience.planCodes?.length ? audience.planCodes : null,
      restaurantIds: audience.restaurantIds?.length ? audience.restaurantIds : null,
      segment: audience.userType === 'client' ? (audience.segment ?? 'all') : 'all',
      inactiveDays: audience.segment === 'inactive' ? (audience.inactiveDays ?? 30) : null,
      marketing: audience.marketing,
    };
    const status = data.mode === 'draft' ? 'draft' : data.mode === 'schedule' ? 'scheduled' : 'sending';
    const doc = {
      scope: 'platform' as const,
      restaurantId: null,
      name: data.name,
      channel: data.channel,
      title: data.title,
      body: data.body,
      emailSubject: data.channel === 'email' ? data.emailSubject || data.title : null,
      emailHtml: null,
      link: data.link,
      audience: storedAudience,
      status,
      scheduledAt: scheduledAt ? Timestamp.fromMillis(scheduledAt) : data.mode === 'send_now' ? now : null,
      sentAt: null,
      stats: stats(built.recipients.length),
      testMode: (data.channel === 'email' || data.channel === 'sms') && !campaignsLive(),
      cancelledAt: null,
      failureReason: null,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    if (existing) await ref.update(doc);
    else await ref.set({ ...doc, promotionId: data.link?.type === 'promotion' ? data.link.target : null, createdAt: now, createdBy: caller.uid });

    const cityIds = storedAudience.cityIds ?? [];
    await writeAudit({
      ...audit,
      action: data.mode === 'draft' ? 'campaign.saved' : data.mode === 'schedule' ? 'campaign.scheduled' : 'campaign.sent',
      after: { status, channel: data.channel, userType: audience.userType, targeted: built.recipients.length, marketing: audience.marketing },
      countryId: storedAudience.countryIds?.[0] ?? null,
      cityId: cityIds.length === 1 ? cityIds[0] : null,
    });

    if (data.mode === 'send_now') {
      const result = await deliver(ref.id, built.recipients);
      return { campaignId: ref.id, status: result.status, stats: result.stats };
    }
    return { campaignId: ref.id, status, stats: doc.stats };
  },
  { secrets: EMAIL_SECRETS, timeoutSeconds: 540, memory: '512MiB' },
);

// ------------------------------------------------------------------ Envoi

async function deviceTokens(uid: string, app: 'client' | 'driver' | 'restaurant'): Promise<string[]> {
  const snap = await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.devices).where('app', '==', app).get();
  return snap.docs.map((d) => (d.data() as UserDevice).fcmToken).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** SMS transactionnel Brevo (envoi réel seulement en mode production des envois). */
async function sendSms(phone: string, content: string, tag: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY.value(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: 'GoLink', recipient: phone.replace(/[^\d+]/g, ''), content, type: 'marketing', tag }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true, error: null } : { ok: false, error: `${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function linkFor(c: Campaign): { type: 'promotion' | 'page' | 'url'; target: string } | null {
  if (!c.link) return null;
  if (c.link.type === 'restaurant') return { type: 'page', target: `restaurant/${c.link.target}` };
  return { type: c.link.type, target: c.link.target };
}

async function deliver(campaignId: string, preset?: Recipient[]) {
  const ref = db.collection(COLLECTIONS.campaigns).doc(campaignId);
  const campaign = (await ref.get()).data() as Campaign;
  const audience: AudienceInput = {
    userType: campaign.audience.userType,
    countryIds: campaign.audience.countryIds ?? null,
    cityIds: campaign.audience.cityIds ?? null,
    planCodes: campaign.audience.planCodes ?? null,
    restaurantIds: campaign.audience.restaurantIds ?? null,
    segment: (campaign.audience.segment === 'custom' ? 'all' : campaign.audience.segment) ?? 'all',
    inactiveDays: campaign.audience.inactiveDays ?? null,
    marketing: campaign.audience.marketing,
  };
  const recipients = preset ?? (await buildAudience(audience, campaign.channel)).recipients;
  const live = campaignsLive();
  const result = stats(recipients.length);
  const logs: Array<Omit<NotificationLog, 'createdAt' | 'updatedAt'>> = [];
  const recipientType = audience.userType;
  const base = { templateKey: null, campaignId, recipientType, providerMessageId: null } as const;

  if (campaign.channel === 'push' || campaign.channel === 'in_app') {
    const category = audience.marketing ? 'promotion' : 'announcement';
    for (let i = 0; i < recipients.length; i += 400) {
      const batch = db.batch();
      for (const r of recipients.slice(i, i + 400)) {
        batch.set(db.collection(COLLECTIONS.users).doc(r.uid).collection(SUBCOLLECTIONS.users.notifications).doc(`envoi-${campaignId}`), {
          title: campaign.title,
          body: campaign.body,
          category,
          link: linkFor(campaign),
          read: false,
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    result.sent = recipients.length;
    result.delivered = recipients.length;
    if (campaign.channel === 'push') {
      const tokens: string[] = [];
      for (let i = 0; i < recipients.length; i += 25) {
        const lists = await Promise.all(recipients.slice(i, i + 25).map((r) => deviceTokens(r.uid, recipientType)));
        lists.forEach((l) => tokens.push(...l));
      }
      for (let i = 0; i < tokens.length; i += 500) {
        try {
          const res = await getMessaging().sendEachForMulticast({
            tokens: tokens.slice(i, i + 500),
            notification: { title: campaign.title, body: campaign.body },
            data: { type: 'campaign', campaignId },
          });
          if (res.failureCount) logger.info('Jetons push refusés', { campaignId, failures: res.failureCount });
        } catch (error) {
          logger.warn('Envoi FCM impossible', { campaignId, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    for (const r of recipients) {
      logs.push({ ...base, channel: 'push', recipientId: r.uid, destinationMasked: 'Centre de notifications GoLink', status: 'delivered', provider: 'fcm', error: null });
    }
  } else if (campaign.channel === 'email') {
    const message = {
      subject: campaign.emailSubject || campaign.title,
      ...renderEmail({
        preheader: campaign.body.slice(0, 120),
        eyebrow: 'GoLink',
        title: campaign.title,
        paragraphs: campaign.body.split(/\n+/).filter(Boolean),
        ...(campaign.link?.type === 'url' ? { cta: { label: 'Découvrir', url: campaign.link.target } } : {}),
        footerReason: audience.marketing
          ? 'Vous recevez cet e-mail car vous avez accepté de recevoir les offres GoLink. Vous pouvez retirer ce consentement à tout moment dans les réglages de votre compte.'
          : 'Message de service lié à votre compte GoLink.',
      }),
    };
    for (const r of recipients) {
      if (!r.email) continue;
      if (!live || RESERVED_EMAIL.test(r.email)) {
        result.sent += 1;
        logs.push({ ...base, channel: 'email', recipientId: r.uid, destinationMasked: maskEmail(r.email), status: 'queued', provider: 'brevo', error: 'Mode test : e-mail préparé mais non transmis.' });
        continue;
      }
      const res = await sendEmail({ to: { email: r.email, name: r.name }, message, recipientType, recipientId: r.uid, templateKey: 'campagne-plateforme', tags: [campaignId] });
      if (res.ok) {
        result.sent += 1;
        result.delivered += 1;
      } else {
        result.failed += 1;
      }
    }
  } else {
    for (const r of recipients) {
      if (!r.phone) continue;
      if (!live) {
        result.sent += 1;
        logs.push({ ...base, channel: 'sms', recipientId: r.uid, destinationMasked: maskPhone(r.phone), status: 'queued', provider: 'sms', error: 'Mode test : SMS préparé mais non transmis.' });
        continue;
      }
      const res = await sendSms(r.phone, `${campaign.body} STOP au 36111`, campaignId);
      if (res.ok) {
        result.sent += 1;
        result.delivered += 1;
      } else {
        result.failed += 1;
      }
      logs.push({ ...base, channel: 'sms', recipientId: r.uid, destinationMasked: maskPhone(r.phone), status: res.ok ? 'sent' : 'failed', provider: 'sms', error: res.error });
    }
  }

  for (let i = 0; i < logs.length; i += 400) {
    const batch = db.batch();
    for (const log of logs.slice(i, i + 400)) {
      batch.set(db.collection(COLLECTIONS.notificationLogs).doc(), { ...log, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }

  const status = result.sent === 0 && result.failed > 0 ? ('failed' as const) : ('sent' as const);
  await ref.update({
    status,
    sentAt: Timestamp.now(),
    stats: result,
    failureReason: status === 'failed' ? 'Aucun message n’a pu être envoyé.' : null,
    updatedAt: Timestamp.now(),
  });
  return { status, stats: result };
}

/** Réserve un envoi programmé (un seul passage possible). */
async function claim(campaignId: string): Promise<Campaign | null> {
  const ref = db.collection(COLLECTIONS.campaigns).doc(campaignId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const c = snap.data() as Campaign | undefined;
    if (!c || c.status !== 'scheduled') return null;
    tx.update(ref, { status: 'sending', sendingStartedAt: Timestamp.now() });
    return c;
  });
}

/** Toutes les 5 minutes : envois de la plateforme arrivés à échéance. */
export const sendCampaign = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Europe/Paris', secrets: EMAIL_SECRETS, timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const due = await db
      .collection(COLLECTIONS.campaigns)
      .where('scope', '==', 'platform')
      .where('status', '==', 'scheduled')
      .where('scheduledAt', '<=', Timestamp.now())
      .limit(10)
      .get();
    for (const doc of due.docs) {
      const claimed = await claim(doc.id);
      if (!claimed) continue;
      try {
        const result = await deliver(doc.id);
        await writeAudit({
          actor: SYSTEM_ACTOR,
          action: 'campaign.sent',
          target: { type: 'other', id: doc.id, label: claimed.name },
          after: { channel: claimed.channel, ...result.stats },
          countryId: claimed.audience.countryIds?.[0] ?? null,
          cityId: claimed.audience.cityIds?.length === 1 ? claimed.audience.cityIds[0] : null,
        });
      } catch (error) {
        logger.error('Échec d’un envoi programmé', { campaignId: doc.id, error: error instanceof Error ? error.stack : String(error) });
        await doc.ref.update({ status: 'failed', failureReason: 'Erreur technique pendant l’envoi.', updatedAt: Timestamp.now() });
      }
    }
  },
);
