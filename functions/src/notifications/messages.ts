// Messages automatiques de la plateforme : lit le gabarit modifiable dans le super admin
// (`messageTemplates`), remplace les variables, puis remet le message par les canaux du
// gabarit (centre de notifications, push, e-mail Brevo, SMS). Les e-mails et SMS ne partent
// réellement que si `settings/notificationDelivery` l'autorise (simulation par défaut) ;
// tout envoi, réel ou simulé, est tracé dans `notificationLogs`.
import {
  COLLECTIONS,
  DEFAULT_NOTIFICATION_DELIVERY,
  PLATFORM_MESSAGE_DEFAULTS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  maskEmail,
  maskPhone,
  type MessageTemplate,
  type NotificationDeliverySettings,
  type NotificationLog,
  type PlatformMessageKey,
  type UserDevice,
  type UserNotification,
  type UserProfile,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { getMessaging } from 'firebase-admin/messaging';
import { db, FieldValue } from '../lib/admin';
import { BREVO_API_KEY } from '../lib/secrets';
import { sendEmail } from '../lib/brevo';
import { renderEmail } from '../lib/email-layout';

export type RecipientType = NotificationLog['recipientType'];

export interface MessageTarget {
  uid: string;
  type: RecipientType;
  /** Adresse, téléphone et nom : relus sur le profil si absents. */
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  /** Données de démonstration ou de test : aucun envoi réel, quelle que soit la configuration. */
  demo?: boolean;
}

export interface SendMessageOptions {
  /** Identifiant d'idempotence : un même message n'est remis qu'une fois pour cette clé. */
  dedupeKey: string;
  link?: UserNotification['link'];
  /** Lien du bouton de l'e-mail. */
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  /** Valeurs propres à une langue (ex. message multilingue) : surchargent `values` pour le destinataire concerné. */
  localizedValues?: Partial<Record<string, Record<string, string | number | null | undefined>>>;
}

export type ChannelOutcome = 'delivered' | 'simulated' | 'failed' | 'skipped';

export interface SendMessageResult {
  status: 'sent' | 'inactive' | 'duplicate' | 'no_recipient';
  channels: Partial<Record<'in_app' | 'push' | 'email' | 'sms', ChannelOutcome>>;
}

const RESERVED_DOMAIN = /\.(test|example|invalid|localhost)$/i;

/** Réglages d'envoi (dry-run par défaut). */
export async function loadDeliverySettings(): Promise<Omit<NotificationDeliverySettings, 'updatedAt' | 'updatedBy'>> {
  const snap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.notificationDelivery).get();
  return { ...DEFAULT_NOTIFICATION_DELIVERY, ...((snap.data() as Partial<NotificationDeliverySettings> | undefined) ?? {}) };
}

interface ResolvedTemplate {
  active: boolean;
  channels: MessageTemplate['channels'];
  subject: string | null;
  title: string;
  body: string;
  category: UserNotification['category'];
  fromDatabase: boolean;
}

/** Texte d'un gabarit dans la langue de l'utilisateur (repli : français). */
function pickText(text: { fr?: string; en?: string; ar?: string } | null | undefined, locale: string): string | null {
  if (!text) return null;
  const value = (text as Record<string, string | undefined>)[locale] ?? text.fr ?? null;
  return value && value.trim() ? value : null;
}

export async function resolveTemplate(key: PlatformMessageKey, locale = 'fr'): Promise<ResolvedTemplate> {
  const fallback = PLATFORM_MESSAGE_DEFAULTS[key];
  const snap = await db.collection(COLLECTIONS.messageTemplates).doc(key).get();
  const stored = snap.data() as MessageTemplate | undefined;
  if (!stored) {
    return { active: true, channels: fallback.channels, subject: fallback.subject, title: fallback.title, body: fallback.body, category: fallback.category, fromDatabase: false };
  }
  return {
    active: stored.active,
    channels: stored.channels?.length ? stored.channels : fallback.channels,
    subject: pickText(stored.subject, locale) ?? fallback.subject,
    title: pickText(stored.title, locale) ?? fallback.title,
    body: pickText(stored.body, locale) ?? fallback.body,
    category: fallback.category,
    fromDatabase: true,
  };
}

/** Remplace les variables {{nom}} ; une variable sans valeur reste vide. */
export function fillTemplate(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const value = values[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

async function deviceTokens(uid: string): Promise<string[]> {
  const snap = await db.collection(COLLECTIONS.users).doc(uid).collection(SUBCOLLECTIONS.users.devices).get();
  return snap.docs.map((d) => (d.data() as UserDevice).fcmToken).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

/** SMS transactionnel Brevo (envoi réel seulement si `smsLive`). */
async function sendTransactionalSms(phone: string, content: string, tag: string): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY.value(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: 'GoLink', recipient: phone.replace(/[^\d+]/g, ''), content, type: 'transactional', tag }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { ok: true, error: null } : { ok: false, error: `${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeLog(entry: Omit<NotificationLog, 'createdAt' | 'updatedAt'>): Promise<void> {
  await db.collection(COLLECTIONS.notificationLogs).add({ ...entry, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
}

/**
 * Remet un message automatique. N'échoue jamais : une erreur d'envoi est journalisée pour
 * ne pas casser l'action métier qui l'a déclenchée. Idempotent par `dedupeKey`.
 */
export async function sendPlatformMessage(
  key: PlatformMessageKey,
  target: MessageTarget,
  values: Record<string, string | number | null | undefined>,
  options: SendMessageOptions,
): Promise<SendMessageResult> {
  const result: SendMessageResult = { status: 'sent', channels: {} };
  try {
    if (!target.uid) return { status: 'no_recipient', channels: {} };
    const userSnap = await db.collection(COLLECTIONS.users).doc(target.uid).get();
    const user = userSnap.data() as (Partial<UserProfile> & { seed?: boolean; test?: boolean }) | undefined;
    const locale = user?.locale ?? 'fr';
    const template = await resolveTemplate(key, locale);
    if (!template.active) return { status: 'inactive', channels: {} };

    const merged = { ...values, ...(options.localizedValues?.[locale] ?? {}) };
    const title = fillTemplate(template.title, merged);
    const body = fillTemplate(template.body, merged);
    const subject = fillTemplate(template.subject ?? title, merged);
    const demo = Boolean(target.demo || user?.seed === true || user?.test === true);
    const email = target.email ?? user?.email ?? null;
    const phone = target.phone ?? user?.phone ?? null;
    const delivery = await loadDeliverySettings();

    // Le centre de notifications sert aussi de verrou d'idempotence : créé une seule fois par clé.
    const inboxId = `${key}-${options.dedupeKey}`.slice(0, 200);
    const inboxRef = db.collection(COLLECTIONS.users).doc(target.uid).collection(SUBCOLLECTIONS.users.notifications).doc(inboxId);
    try {
      await inboxRef.create({
        title,
        body,
        category: template.category,
        link: options.link ?? null,
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 6) return { status: 'duplicate', channels: {} };
      throw error;
    }
    result.channels.in_app = 'delivered';

    const base = { templateKey: key, campaignId: null, recipientType: target.type, recipientId: target.uid, providerMessageId: null } as const;

    if (template.channels.includes('push')) {
      if (delivery.pushLive && !demo) {
        const tokens = await deviceTokens(target.uid);
        if (tokens.length === 0) {
          result.channels.push = 'skipped';
          await writeLog({ ...base, channel: 'push', destinationMasked: 'Centre de notifications GoLink', status: 'queued', provider: 'fcm', error: 'Aucun appareil enregistré : message visible dans le centre de notifications.' });
        } else {
          try {
            const res = await getMessaging().sendEachForMulticast({ tokens, notification: { title, body }, data: { type: key, inboxId } });
            result.channels.push = res.successCount > 0 ? 'delivered' : 'failed';
            await writeLog({ ...base, channel: 'push', destinationMasked: `${tokens.length} appareil(s)`, status: res.successCount > 0 ? 'sent' : 'failed', provider: 'fcm', error: res.failureCount ? `${res.failureCount} jeton(s) refusé(s)` : null });
          } catch (error) {
            result.channels.push = 'failed';
            await writeLog({ ...base, channel: 'push', destinationMasked: 'Appareils', status: 'failed', provider: 'fcm', error: error instanceof Error ? error.message : String(error) });
          }
        }
      } else {
        result.channels.push = 'simulated';
        await writeLog({ ...base, channel: 'push', destinationMasked: 'Centre de notifications GoLink', status: 'queued', provider: 'fcm', error: 'Mode simulation : push préparé, message déposé dans le centre de notifications.' });
      }
    }

    if (template.channels.includes('email') && email) {
      const message = {
        subject,
        ...renderEmail({
          preheader: body.slice(0, 120),
          eyebrow: 'GoLink',
          title,
          paragraphs: body.split(/\n+/).filter(Boolean),
          ...(options.ctaUrl ? { cta: { label: options.ctaLabel ?? 'Ouvrir GoLink', url: options.ctaUrl } } : {}),
          footerReason: 'Message de service lié à votre compte GoLink.',
        }),
      };
      const reserved = RESERVED_DOMAIN.test(email.split('@')[1] ?? '');
      if (!delivery.emailLive || demo || reserved) {
        result.channels.email = 'simulated';
        await writeLog({ ...base, channel: 'email', destinationMasked: maskEmail(email), status: 'queued', provider: 'brevo', error: 'Mode simulation : e-mail préparé mais non transmis.' });
      } else {
        const sent = await sendEmail({ to: { email, name: target.name ?? user?.displayName ?? null }, message, recipientType: target.type, recipientId: target.uid, templateKey: key });
        result.channels.email = sent.ok ? 'delivered' : 'failed';
      }
    }

    if (template.channels.includes('sms') && phone) {
      if (!delivery.smsLive || demo) {
        result.channels.sms = 'simulated';
        await writeLog({ ...base, channel: 'sms', destinationMasked: maskPhone(phone), status: 'queued', provider: 'sms', error: 'Mode simulation : SMS préparé mais non transmis.' });
      } else {
        const sent = await sendTransactionalSms(phone, body.slice(0, 320), key);
        result.channels.sms = sent.ok ? 'delivered' : 'failed';
        await writeLog({ ...base, channel: 'sms', destinationMasked: maskPhone(phone), status: sent.ok ? 'sent' : 'failed', provider: 'sms', error: sent.error });
      }
    }
    return result;
  } catch (error) {
    logger.error('Message automatique en échec', { key, uid: target.uid, error: error instanceof Error ? error.message : String(error) });
    return { ...result, status: 'sent' };
  }
}
