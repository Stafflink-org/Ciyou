// Messages automatiques (confirmation, livreur en route, validation de compte,
// facture disponible…) : textes modifiables sans développeur, variables contrôlées.
import { COLLECTIONS, type MessageTemplate } from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zReason } from '../../lib/validation';
import { usedVariables } from './common';

const schema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{3,64}$/, 'Clé de message invalide'),
  active: z.boolean(),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).min(1, 'Choisissez au moins un canal.').max(4),
  subject: z.string().trim().max(120).nullable().default(null),
  title: z.string().trim().min(2, 'Le titre est obligatoire.').max(80),
  body: z.string().trim().min(5, 'Le texte est obligatoire.').max(1000),
  reason: zReason,
});

/** Enregistre le texte d'un message automatique. */
export const updateMessageTemplate = callable(schema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'templates.edit');
  if (admin.role !== 'super_admin' && (admin.cityIds.length > 0 || admin.countryIds.length > 0)) {
    throw fail.forbidden('Les messages automatiques s’appliquent à toute la plateforme : modification réservée à l’équipe centrale.');
  }
  const ref = db.collection(COLLECTIONS.messageTemplates).doc(data.key);
  const snap = await ref.get();
  const before = snap.data() as MessageTemplate | undefined;
  if (!before) throw fail.notFound('Message automatique');

  const unknown = usedVariables(`${data.subject ?? ''} ${data.title} ${data.body}`).filter((v) => !before.variables.includes(v));
  if (unknown.length) {
    throw fail.invalid(`Variable inconnue : {{${unknown[0]}}}. Variables disponibles : ${before.variables.map((v) => `{{${v}}}`).join(', ') || 'aucune'}.`);
  }
  if (data.channels.includes('email') && !data.subject) throw fail.invalid('Indiquez l’objet de l’e-mail.');
  if (data.channels.includes('sms') && data.body.length > 320) throw fail.invalid('Le texte envoyé par SMS est limité à 320 caractères.');

  const now = Timestamp.now();
  await ref.update({
    active: data.active,
    channels: data.channels,
    subject: data.subject ? { ...(before.subject ?? {}), fr: data.subject } : null,
    title: { ...(before.title ?? {}), fr: data.title },
    body: { ...before.body, fr: data.body },
    updatedAt: now,
    updatedBy: caller.uid,
  });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'template.updated',
    target: { type: 'setting', id: data.key, label: before.event },
    reason: data.reason,
    before: { active: before.active, channels: before.channels, title: before.title?.fr ?? null, body: before.body.fr, subject: before.subject?.fr ?? null },
    after: { active: data.active, channels: data.channels, title: data.title, body: data.body, subject: data.subject },
    request,
  });
  return { key: data.key };
});
