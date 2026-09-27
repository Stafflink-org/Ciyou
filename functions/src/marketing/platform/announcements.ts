// Annonces affichées dans le back-office des restaurants ou l'app livreur
// (nouveauté, maintenance, changement de conditions), avec ciblage et période.
import { COLLECTIONS, type Announcement } from '@golink/shared';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { requireAdmin } from '../../lib/permissions';
import { z, zId, zReason } from '../../lib/validation';
import { DAY_MS } from './common';

const PLAN_CODES = ['basic', 'pro', 'premium'] as const;

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    announcementId: zId.nullish(),
    audience: z.enum(['restaurants', 'drivers']),
    countryIds: z.array(z.string().min(2).max(3)).max(10).nullable().default(null),
    cityIds: z.array(zId).max(30).nullable().default(null),
    planCodes: z.array(z.enum(PLAN_CODES)).max(3).nullable().default(null),
    title: z.string().trim().min(3, 'Le titre doit contenir au moins 3 caractères.').max(90),
    body: z.string().trim().min(10, 'Le message doit contenir au moins 10 caractères.').max(600),
    severity: z.enum(['info', 'important', 'maintenance']),
    link: z
      .string()
      .trim()
      .max(300)
      .refine((v) => v.startsWith('/') || v.startsWith('https://'), 'Lien interne (/…) ou adresse https://')
      .nullable()
      .default(null),
    /** Millisecondes ; null = publication immédiate. */
    publishAt: z.number().int().nullable().default(null),
    expiresAt: z.number().int().nullable().default(null),
    requiresAcknowledgement: z.boolean().default(false),
  }),
  z.object({ action: z.literal('archive'), announcementId: zId, reason: zReason }),
]);

/** Publication, modification ou retrait d'une annonce. */
export const publishAnnouncement = callable(schema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'announcements.edit');
  const now = Timestamp.now();

  if (data.action === 'archive') {
    const ref = db.collection(COLLECTIONS.announcements).doc(data.announcementId);
    const before = (await ref.get()).data() as Announcement | undefined;
    if (!before) throw fail.notFound('Annonce');
    if (admin.role !== 'super_admin' && admin.cityIds.length > 0 && !(before.cityIds ?? []).every((c) => admin.cityIds.includes(c))) {
      throw fail.forbidden('Cette annonce dépasse votre périmètre.');
    }
    await ref.update({ active: false, expiresAt: now, updatedAt: now, updatedBy: caller.uid });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'announcement.archived',
      target: { type: 'other', id: ref.id, label: before.title },
      reason: data.reason,
      before: { active: before.active },
      after: { active: false },
      request,
    });
    return { announcementId: ref.id };
  }

  let cityIds = data.cityIds?.length ? [...new Set(data.cityIds)] : null;
  if (admin.role !== 'super_admin' && admin.cityIds.length > 0) {
    cityIds = (cityIds ?? admin.cityIds).filter((c) => admin.cityIds.includes(c));
    if (cityIds.length === 0) throw fail.forbidden('Choisissez au moins une ville de votre périmètre.');
  }
  if (data.audience === 'drivers' && data.planCodes?.length) throw fail.invalid('Les formules ne concernent que les restaurants.');
  const publishAt = data.publishAt && data.publishAt > Date.now() ? data.publishAt : Date.now();
  if (data.expiresAt !== null) {
    if (data.expiresAt <= publishAt) throw fail.invalid('La fin d’affichage doit suivre la publication.');
    if (data.expiresAt - publishAt > 366 * DAY_MS) throw fail.invalid('Une annonce reste affichée au plus un an.');
  }

  const fields = {
    audience: data.audience,
    countryIds: data.countryIds?.length ? data.countryIds : null,
    cityIds,
    planCodes: data.audience === 'restaurants' && data.planCodes?.length ? data.planCodes : null,
    title: data.title,
    body: data.body,
    severity: data.severity,
    link: data.link,
    publishedAt: Timestamp.fromMillis(publishAt),
    expiresAt: data.expiresAt === null ? null : Timestamp.fromMillis(data.expiresAt),
    active: true,
    requiresAcknowledgement: data.requiresAcknowledgement,
    updatedAt: now,
    updatedBy: caller.uid,
  };

  const ref = data.announcementId ? db.collection(COLLECTIONS.announcements).doc(data.announcementId) : db.collection(COLLECTIONS.announcements).doc();
  if (data.announcementId) {
    const before = (await ref.get()).data() as Announcement | undefined;
    if (!before) throw fail.notFound('Annonce');
    await ref.update(fields);
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'announcement.updated',
      target: { type: 'other', id: ref.id, label: data.title },
      before: { title: before.title, severity: before.severity, active: before.active },
      after: { title: data.title, severity: data.severity, active: true },
      request,
    });
  } else {
    await ref.set({ ...fields, createdAt: now, createdBy: caller.uid });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'announcement.published',
      target: { type: 'other', id: ref.id, label: data.title },
      after: { audience: data.audience, severity: data.severity, cityIds, countryIds: fields.countryIds, planCodes: fields.planCodes },
      cityId: cityIds?.length === 1 ? cityIds[0] : null,
      request,
    });
  }
  return { announcementId: ref.id };
});
