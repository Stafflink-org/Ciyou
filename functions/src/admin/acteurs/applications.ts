// Validation des commerces (cahier §5) : file En attente → Documents manquants →
// Validé → Refusé avec motif, contrôle des justificatifs, relances et blocage
// automatique des documents expirés (tâche quotidienne).
import {
  COLLECTIONS,
  DOCUMENT_REMINDER_DAYS,
  PARTNER_DOCUMENT_LABELS,
  PARTNER_DOCUMENT_TYPES,
  REQUIRED_RESTAURANT_DOCUMENTS,
  type PartnerDocument,
  type PartnerDocumentType,
  type PlatformAlert,
  type Restaurant,
  type RestaurantLegal,
} from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { SYSTEM_ACTOR, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin, type Caller } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId } from '../../lib/validation';
import {
  ACTEURS_SCHEDULE_RUNTIME,
  TIMEZONE,
  acteursCallable,
  addDaysIso,
  adminActor,
  auditRestaurant,
  loadRestaurantFor,
  notifyRestaurantOwner,
  parisDay,
  restaurantDoc,
  type RestaurantWithRef,
} from './common';
import {
  applicationApprovedEmail,
  applicationRejectedEmail,
  documentExpiredEmail,
  documentExpiringEmail,
  documentRejectedEmail,
  documentsMissingEmail,
} from './emails';

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (AAAA-MM-JJ)');

async function restaurantDocuments(restaurantId: string): Promise<Array<PartnerDocument & { id: string }>> {
  const snap = await db
    .collection(COLLECTIONS.partnerDocuments)
    .where('ownerType', '==', 'restaurant')
    .where('ownerId', '==', restaurantId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as PartnerDocument) }));
}

/** Groupes de pièces obligatoires sans document validé et en cours de validité. */
export function missingRequiredGroups(docs: readonly PartnerDocument[], today: string): typeof REQUIRED_RESTAURANT_DOCUMENTS[number][] {
  return REQUIRED_RESTAURANT_DOCUMENTS.filter(
    (group) => !docs.some((d) => group.types.includes(d.type) && d.status === 'approved' && (!d.expiresAt || d.expiresAt >= today)),
  );
}

/** Referme les alertes « à valider » d'un restaurant. */
async function resolveAlerts(restaurantId: string, kinds: PlatformAlert['kind'][]): Promise<void> {
  const snap = await db.collection(COLLECTIONS.platformAlerts).where('target.id', '==', restaurantId).get();
  const batch = db.batch();
  let count = 0;
  snap.docs.forEach((d) => {
    const alert = d.data() as PlatformAlert;
    if (kinds.includes(alert.kind) && alert.status !== 'resolved' && alert.status !== 'dismissed') {
      batch.update(d.ref, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp() });
      count += 1;
    }
  });
  if (count > 0) await batch.commit();
}

/** Lève le blocage documentaire si toutes les pièces obligatoires sont de nouveau valides. */
async function liftDocumentBlockIfComplete(restaurant: RestaurantWithRef, actor: Caller | null): Promise<boolean> {
  if (restaurant.data.suspension?.kind !== 'documents') return false;
  const docs = await restaurantDocuments(restaurant.id);
  if (missingRequiredGroups(docs, parisDay()).length > 0) return false;
  const previous = restaurant.data.suspension.previousStatus;
  const status = previous === 'active' || previous === 'paused' ? previous : 'active';
  await restaurant.ref.update({
    status,
    suspension: null,
    documentsBlockedAt: null,
    documentsBlockedTypes: [],
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor?.uid ?? 'system',
  });
  await writeAudit({
    actor: actor ? adminActor(actor) : SYSTEM_ACTOR,
    action: 'restaurant.documents_unblocked',
    target: { type: 'restaurant', id: restaurant.id, label: restaurant.data.name },
    before: { status: restaurant.data.status },
    after: { status },
    countryId: restaurant.data.countryId,
    cityId: restaurant.data.cityId,
  });
  await resolveAlerts(restaurant.id, ['document_expired']);
  return true;
}

// ------------------------------------------------------------------ Décision sur un dossier

const applicationSchema = z
  .object({
    restaurantId: zId,
    decision: z.enum(['approve', 'documents_missing', 'reject']),
    reason: z.string().trim().max(500).nullish(),
    missingDocuments: z.array(z.enum(PARTNER_DOCUMENT_TYPES)).max(10).default([]),
    goLive: z.boolean().default(true),
  })
  .refine((d) => (d.reason?.length ?? 0) >= 3, { message: 'Indiquez le motif de la décision (transmis au commerce en cas de refus ou de pièces manquantes)', path: ['reason'] })
  .refine((d) => d.decision !== 'documents_missing' || d.missingDocuments.length > 0, {
    message: 'Sélectionnez au moins un document manquant',
    path: ['missingDocuments'],
  });

export const reviewRestaurantApplication = acteursCallable(
  applicationSchema,
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.validate');
    const restaurant = await loadRestaurantFor(admin, data.restaurantId);
    const before = { onboardingStatus: restaurant.data.onboardingStatus, status: restaurant.data.status };
    if (data.decision !== 'reject' && restaurant.data.onboardingStatus === 'approved') {
      throw fail.precondition('Ce dossier est déjà validé.');
    }

    if (data.decision === 'approve') {
      const [docs, legalSnap] = await Promise.all([
        restaurantDocuments(restaurant.id),
        restaurant.ref.collection('private').doc('legal').get(),
      ]);
      const missing = missingRequiredGroups(docs, parisDay());
      if (missing.length > 0) {
        throw fail.precondition(`Pièces à valider avant l’approbation : ${missing.map((g) => g.label).join(', ')}.`);
      }
      const legal = legalSnap.data() as RestaurantLegal | undefined;
      if (!legal?.partnerTermsAcceptedAt) throw fail.precondition('Le contrat partenaire n’a pas encore été accepté par le restaurant.');
    }

    const now = Timestamp.now();
    const update: Record<string, unknown> = { updatedAt: now, updatedBy: caller.uid };
    let after: Record<string, unknown>;
    if (data.decision === 'approve') {
      const goLive = data.goLive && restaurant.data.status === 'onboarding';
      update.onboardingStatus = 'approved';
      if (goLive) {
        update.status = 'active';
        update.launchedAt = now;
      }
      update.rejectionReason = null;
      after = { onboardingStatus: 'approved', status: goLive ? 'active' : restaurant.data.status };
    } else if (data.decision === 'documents_missing') {
      update.onboardingStatus = 'documents_missing';
      update.missingDocuments = data.missingDocuments;
      after = { onboardingStatus: 'documents_missing', missingDocuments: data.missingDocuments };
    } else {
      update.onboardingStatus = 'rejected';
      update.rejectionReason = data.reason;
      if (restaurant.data.status === 'active') update.status = 'suspended';
      after = { onboardingStatus: 'rejected' };
    }
    await restaurant.ref.update(update);

    const action =
      data.decision === 'approve' ? 'restaurant.approved' : data.decision === 'reject' ? 'restaurant.rejected' : 'restaurant.documents_requested';
    await auditRestaurant(caller, restaurant, action, { reason: data.reason ?? null, before, after, sensitive: data.decision === 'reject', request });
    if (data.decision !== 'documents_missing') await resolveAlerts(restaurant.id, ['restaurant_to_validate']);

    const name = restaurant.data.name;
    const delivery =
      data.decision === 'approve'
        ? await notifyRestaurantOwner(restaurant, {
            title: 'Dossier validé',
            body: `${name} est validé par l’équipe Ciyou Eats.`,
            category: 'account',
            email: applicationApprovedEmail({ restaurantName: name, live: after.status === 'active' }),
            templateKey: 'restaurant_approved',
            message: { key: 'restaurant_approved', values: { restaurantName: name }, dedupeKey: `${restaurant.id}-${now.toMillis()}` },
          })
        : data.decision === 'reject'
          ? await notifyRestaurantOwner(restaurant, {
              title: 'Dossier refusé',
              body: `Motif : ${data.reason ?? ''}`,
              category: 'account',
              email: applicationRejectedEmail({ restaurantName: name, reason: data.reason ?? '' }),
              templateKey: 'restaurant_rejected',
            })
          : await notifyRestaurantOwner(restaurant, {
              title: 'Documents à compléter',
              body: data.missingDocuments.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', '),
              category: 'document',
              email: documentsMissingEmail({
                restaurantName: name,
                reason: data.reason ?? '',
                documents: data.missingDocuments.map((t) => PARTNER_DOCUMENT_LABELS[t]),
              }),
              templateKey: 'restaurant_documents_missing',
              message: {
                key: 'restaurant_documents_missing',
                values: { restaurantName: name, documents: data.missingDocuments.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', ') },
                dedupeKey: `${restaurant.id}-${now.toMillis()}`,
              },
            });
    return { onboardingStatus: after.onboardingStatus as string, status: (after.status as string | undefined) ?? restaurant.data.status, ...delivery };
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Contrôle d'un justificatif

const documentSchema = z
  .object({
    documentId: zId,
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(500).nullish(),
    expiresAt: zDay.nullish(),
  })
  .refine((d) => d.decision === 'approve' || (d.reason?.length ?? 0) >= 3, { message: 'Indiquez le motif du refus', path: ['reason'] });

export const reviewDocument = acteursCallable(
  documentSchema,
  async (data, request) => {
    const ref = db.collection(COLLECTIONS.partnerDocuments).doc(data.documentId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Document');
    const doc = snap.data() as PartnerDocument;
    const { caller, admin } = await requireAdmin(request, doc.ownerType === 'restaurant' ? 'restaurants.validate' : 'drivers.validate');
    assertAdminCovers(admin, doc.cityId ?? null);
    const today = parisDay();
    if (data.decision === 'approve' && data.expiresAt && data.expiresAt < today) {
      throw fail.invalid('La date d’expiration est dépassée : refusez la pièce et demandez une version valide.');
    }
    const now = Timestamp.now();
    const update: Record<string, unknown> = {
      status: data.decision === 'approve' ? 'approved' : 'rejected',
      reviewedBy: caller.uid,
      reviewedAt: now,
      rejectionReason: data.decision === 'reject' ? data.reason : null,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    if (data.expiresAt !== undefined) {
      update.expiresAt = data.expiresAt ?? null;
      update.remindersSent = 0;
      update.lastReminderAt = null;
    }
    await ref.update(update);

    const label = PARTNER_DOCUMENT_LABELS[doc.type];
    await writeAudit({
      actor: adminActor(caller),
      action: data.decision === 'approve' ? 'document.approved' : 'document.rejected',
      target: { type: 'document', id: ref.id, label },
      reason: data.reason ?? null,
      before: { status: doc.status, expiresAt: doc.expiresAt ?? null },
      after: { status: update.status, expiresAt: (update.expiresAt as string | null | undefined) ?? doc.expiresAt ?? null, ownerId: doc.ownerId },
      countryId: doc.countryId,
      cityId: doc.cityId ?? null,
      request,
    });

    let unblocked = false;
    if (doc.ownerType === 'restaurant') {
      const rSnap = await restaurantDoc(doc.ownerId).get();
      if (rSnap.exists) {
        const restaurant: RestaurantWithRef = { id: rSnap.id, data: rSnap.data() as Restaurant, ref: rSnap.ref };
        if (data.decision === 'approve') unblocked = await liftDocumentBlockIfComplete(restaurant, caller);
        else
          await notifyRestaurantOwner(restaurant, {
            title: `Document refusé : ${label}`,
            body: `Motif : ${data.reason ?? ''}`,
            category: 'document',
            email: documentRejectedEmail({ restaurantName: restaurant.data.name, documentLabel: label, reason: data.reason ?? '' }),
            templateKey: 'document_rejected',
          });
      }
    }
    return { status: update.status as string, unblocked };
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Relance manuelle

const reminderSchema = z.object({
  restaurantId: zId,
  documentTypes: z.array(z.enum(PARTNER_DOCUMENT_TYPES)).min(1).max(10),
  message: z.string().trim().max(600).nullish(),
});

export const sendDocumentReminder = acteursCallable(
  reminderSchema,
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'restaurants.validate');
    const restaurant = await loadRestaurantFor(admin, data.restaurantId);
    const labels = data.documentTypes.map((t) => PARTNER_DOCUMENT_LABELS[t]);
    const delivery = await notifyRestaurantOwner(restaurant, {
      title: 'Documents attendus',
      body: labels.join(', '),
      category: 'document',
      email: documentsMissingEmail({
        restaurantName: restaurant.data.name,
        reason: data.message || 'Merci de déposer ces pièces pour finaliser ou maintenir votre dossier.',
        documents: labels,
      }),
      templateKey: 'restaurant_documents_reminder',
    });
    const docs = await restaurantDocuments(restaurant.id);
    const batch = db.batch();
    docs
      .filter((d) => data.documentTypes.includes(d.type) && d.status !== 'approved')
      .forEach((d) => batch.update(db.collection(COLLECTIONS.partnerDocuments).doc(d.id), { remindersSent: FieldValue.increment(1), lastReminderAt: FieldValue.serverTimestamp() }));
    await batch.commit();
    await auditRestaurant(caller, restaurant, 'restaurant.documents_reminded', { after: { documentTypes: data.documentTypes }, request });
    return delivery;
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Expirations (quotidien)

interface ExpiryReport {
  checked: number;
  reminded: number;
  expired: number;
  blocked: number;
}

function formatFrDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Parcourt les justificatifs validés qui expirent sous 30 jours : relance à J-30
 * et J-7, puis expiration et blocage du commerce si la pièce est obligatoire.
 */
export async function runDocumentExpiryCheck(): Promise<ExpiryReport> {
  const today = parisDay();
  const horizon = addDaysIso(today, DOCUMENT_REMINDER_DAYS[0]);
  const snap = await db
    .collection(COLLECTIONS.partnerDocuments)
    .where('status', '==', 'approved')
    .where('expiresAt', '<=', horizon)
    .get();
  const report: ExpiryReport = { checked: snap.size, reminded: 0, expired: 0, blocked: 0 };
  const restaurants = new Map<string, RestaurantWithRef | null>();
  const loadRestaurant = async (id: string) => {
    if (!restaurants.has(id)) {
      const r = await restaurantDoc(id).get();
      restaurants.set(id, r.exists ? { id: r.id, data: r.data() as Restaurant, ref: r.ref } : null);
    }
    return restaurants.get(id) ?? null;
  };
  const expiredByRestaurant = new Map<string, PartnerDocumentType[]>();

  for (const d of snap.docs) {
    const doc = d.data() as PartnerDocument;
    if (doc.ownerType !== 'restaurant' || !doc.expiresAt) continue;
    const restaurant = await loadRestaurant(doc.ownerId);
    if (!restaurant || restaurant.data.deletedAt) continue;
    const label = PARTNER_DOCUMENT_LABELS[doc.type];
    if (doc.expiresAt < today) {
      await d.ref.update({ status: 'expired', updatedAt: FieldValue.serverTimestamp(), updatedBy: 'system' });
      report.expired += 1;
      expiredByRestaurant.set(doc.ownerId, [...(expiredByRestaurant.get(doc.ownerId) ?? []), doc.type]);
      continue;
    }
    const daysLeft = Math.round((Date.parse(`${doc.expiresAt}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    const due = DOCUMENT_REMINDER_DAYS.filter((threshold) => daysLeft <= threshold).length;
    if (due > (doc.remindersSent ?? 0)) {
      await notifyRestaurantOwner(restaurant, {
        title: `${label} : expiration dans ${daysLeft} jours`,
        body: `Déposez la nouvelle version avant le ${formatFrDay(doc.expiresAt)}.`,
        category: 'document',
        email: documentExpiringEmail({ restaurantName: restaurant.data.name, documentLabel: label, expiresOn: formatFrDay(doc.expiresAt), days: daysLeft }),
        templateKey: 'document_expiring',
        message: { key: 'restaurant_document_expiring', values: { documentType: label, date: formatFrDay(doc.expiresAt) }, dedupeKey: `${d.id}-${due}` },
      });
      await d.ref.update({ remindersSent: due, lastReminderAt: FieldValue.serverTimestamp() });
      report.reminded += 1;
    }
  }

  // Blocage : pièce obligatoire expirée sans autre version valide.
  for (const [restaurantId, types] of expiredByRestaurant) {
    const restaurant = await loadRestaurant(restaurantId);
    if (!restaurant) continue;
    const docs = await restaurantDocuments(restaurantId);
    const missing = missingRequiredGroups(docs, today).filter((group) => group.types.some((t) => types.includes(t)));
    const labels = types.map((t) => PARTNER_DOCUMENT_LABELS[t]);
    const alertRef = db.collection(COLLECTIONS.platformAlerts).doc(`document_expired_${restaurantId}_${today}`);
    const alert: Omit<PlatformAlert, 'detectedAt'> & { detectedAt: FieldValue } = {
      kind: 'document_expired',
      queue: 'todo',
      severity: missing.length > 0 ? 'critical' : 'warning',
      title: `Document expiré : ${restaurant.data.name}`,
      message: missing.length > 0 ? `${labels.join(', ')} · commandes suspendues` : labels.join(', '),
      target: { type: 'restaurant', id: restaurantId, label: restaurant.data.name },
      countryId: restaurant.data.countryId,
      cityId: restaurant.data.cityId,
      metric: null,
      status: 'open',
      dedupKey: `document_expired_${restaurantId}`,
      detectedAt: FieldValue.serverTimestamp(),
    };
    await alertRef.set(alert, { merge: true });
    if (missing.length === 0 || restaurant.data.status === 'suspended' || restaurant.data.status === 'closed') continue;
    await restaurant.ref.update({
      status: 'suspended',
      isOpen: false,
      acceptingOrders: false,
      suspension: {
        reason: `Document obligatoire expiré : ${missing.map((g) => g.label).join(', ')}`,
        until: null,
        at: Timestamp.now(),
        by: 'system',
        kind: 'documents',
        previousStatus: restaurant.data.status,
      },
      documentsBlockedAt: FieldValue.serverTimestamp(),
      documentsBlockedTypes: types,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system',
    });
    report.blocked += 1;
    await writeAudit({
      actor: SYSTEM_ACTOR,
      action: 'restaurant.documents_blocked',
      target: { type: 'restaurant', id: restaurantId, label: restaurant.data.name },
      reason: `Document expiré : ${labels.join(', ')}`,
      before: { status: restaurant.data.status },
      after: { status: 'suspended' },
      countryId: restaurant.data.countryId,
      cityId: restaurant.data.cityId,
    });
    await notifyRestaurantOwner(restaurant, {
      title: 'Commandes suspendues',
      body: `${labels.join(', ')} expiré : déposez une version valide.`,
      category: 'document',
      email: documentExpiredEmail({ restaurantName: restaurant.data.name, documentLabel: labels.join(', ') }),
      templateKey: 'document_expired',
    });
  }
  return report;
}

export const checkDocumentExpiry = onSchedule(
  { schedule: 'every day 06:30', timeZone: TIMEZONE, ...ACTEURS_SCHEDULE_RUNTIME, secrets: EMAIL_SECRETS },
  async () => {
    const report = await runDocumentExpiryCheck();
    logger.info('Contrôle des documents expirants', report);
  },
);

/** Lancement manuel du contrôle (bouton « Contrôler maintenant » de la file de validation). */
export const runDocumentExpiryNow = acteursCallable(
  z.object({}),
  async (_data, request) => {
    const { caller } = await requireAdmin(request, 'restaurants.validate');
    const report = await runDocumentExpiryCheck();
    await writeAudit({
      actor: adminActor(caller),
      action: 'documents.expiry_checked',
      target: { type: 'other', id: 'partnerDocuments', label: 'Contrôle des expirations' },
      after: { ...report },
      request,
    });
    return report;
  },
  { secrets: EMAIL_SECRETS, timeoutSeconds: 300 },
);

