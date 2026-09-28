// Envoi d'e-mails transactionnels via l'API REST v3 de Brevo. Chaque envoi est
// tracé dans notificationLogs (adresse masquée). Les fonctions appelantes doivent
// déclarer EMAIL_SECRETS dans leurs options.
import { COLLECTIONS, maskEmail, type NotificationLog } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './admin';
import { EMAIL_SENDER_NAME } from './config';
import type { EmailMessage } from './emails';
import { BREVO_API_KEY, BREVO_SENDER_EMAIL } from './secrets';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface SendEmailInput {
  to: { email: string; name?: string | null };
  message: EmailMessage;
  recipientType: NotificationLog['recipientType'];
  recipientId: string;
  templateKey: string;
  tags?: string[];
  /** Pièces jointes (contenu encodé en base64), ex. rapports programmés. */
  attachments?: Array<{ name: string; contentBase64: string }>;
}

export interface SendEmailResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
}

/**
 * Envoie un e-mail. N'échoue jamais : une erreur d'envoi est journalisée et
 * renvoyée, pour ne pas annuler l'action métier qui l'a déclenché.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  let result: SendEmailResult;
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY.value(),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: EMAIL_SENDER_NAME, email: BREVO_SENDER_EMAIL.value() },
        to: [{ email: input.to.email, ...(input.to.name ? { name: input.to.name } : {}) }],
        subject: input.message.subject,
        htmlContent: input.message.html,
        textContent: input.message.text,
        tags: [input.templateKey, ...(input.tags ?? [])],
        ...(input.attachments?.length ? { attachment: input.attachments.map((a) => ({ name: a.name, content: a.contentBase64 })) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };
    result = response.ok
      ? { ok: true, messageId: body.messageId ?? null, error: null }
      : { ok: false, messageId: null, error: `${response.status} ${body.code ?? ''} ${body.message ?? ''}`.trim() };
  } catch (error) {
    result = { ok: false, messageId: null, error: error instanceof Error ? error.message : String(error) };
  }

  if (!result.ok) logger.error('Échec d’envoi e-mail Brevo', { templateKey: input.templateKey, error: result.error });

  const log: Omit<NotificationLog, 'createdAt' | 'updatedAt'> & { createdAt: FieldValue; updatedAt: FieldValue } = {
    channel: 'email',
    templateKey: input.templateKey,
    campaignId: null,
    recipientType: input.recipientType,
    recipientId: input.recipientId,
    destinationMasked: maskEmail(input.to.email),
    status: result.ok ? 'sent' : 'failed',
    provider: 'brevo',
    providerMessageId: result.messageId,
    error: result.error,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection(COLLECTIONS.notificationLogs).add(log);
  return result;
}
