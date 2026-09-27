// Mini CRM de prospection (cahier §21) : fiches prospects, étapes (kanban), actions
// et relances, commerciaux, conversions et commissions.
import {
  COLLECTIONS,
  PROSPECT_STAGES,
  PROSPECT_STAGE_LABELS,
  SUBCOLLECTIONS,
  adminHasPermission,
  type AdminUser,
  type Prospect,
  type ProspectActivity,
  type SalesCommission,
} from '@golink/shared';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { callable } from '../../lib/callable';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin } from '../../lib/permissions';
import { z, zEmail, zId, zPhone, zReason } from '../../lib/validation';
import { loadCrmSettings, pushInApp } from './common';

const SOURCES = ['field', 'inbound', 'referral', 'event', 'import', 'other'] as const;
const CLOSED = ['signed_up', 'lost'];

async function loadSalesRep(uid: string): Promise<AdminUser & { uid: string }> {
  const snap = await db.collection(COLLECTIONS.admins).doc(uid).get();
  const admin = snap.data() as AdminUser | undefined;
  if (!admin || !admin.active || !adminHasPermission(admin, 'crm.edit')) throw fail.invalid('Ce commercial n’a pas accès à la prospection.');
  return { ...admin, uid: snap.id };
}

function prospectRef(id: string) {
  return db.collection(COLLECTIONS.prospects).doc(id);
}

async function loadProspect(id: string) {
  const snap = await prospectRef(id).get();
  if (!snap.exists) throw fail.notFound('Prospect');
  return snap.data() as Prospect;
}

const followUp = z.number().int().nullable().default(null);

// ------------------------------------------------------------------ Fiche

const saveSchema = z.object({
  prospectId: zId.nullish(),
  name: z.string().trim().min(2, 'Indiquez le nom de l’établissement.').max(120),
  countryId: z.string().trim().min(2).max(3),
  cityId: zId,
  cuisine: z.string().trim().max(60).nullable().default(null),
  contactName: z.string().trim().max(80).nullable().default(null),
  contactEmail: zEmail.nullable().default(null),
  contactPhone: zPhone.nullable().default(null),
  source: z.enum(SOURCES),
  ownerId: zId,
  estimatedMonthlyOrders: z.number().int().min(0).max(100_000).nullable().default(null),
  nextFollowUpAt: followUp,
  notes: z.string().trim().max(2000).nullable().default(null),
});

export const saveProspect = callable(saveSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'crm.edit');
  assertAdminCovers(admin, data.cityId);
  const city = await db.collection(COLLECTIONS.cities).doc(data.cityId).get();
  if (!city.exists || city.get('countryId') !== data.countryId) throw fail.invalid('Ville inconnue pour ce pays.');
  const owner = await loadSalesRep(data.ownerId);
  const now = Timestamp.now();
  const fields = {
    name: data.name,
    countryId: data.countryId,
    cityId: data.cityId,
    cuisine: data.cuisine,
    contactName: data.contactName,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    source: data.source,
    ownerId: owner.uid,
    ownerName: owner.displayName,
    estimatedMonthlyOrders: data.estimatedMonthlyOrders,
    nextFollowUpAt: data.nextFollowUpAt ? Timestamp.fromMillis(data.nextFollowUpAt) : null,
    notes: data.notes,
    updatedAt: now,
    updatedBy: caller.uid,
  };
  if (data.prospectId) {
    const before = await loadProspect(data.prospectId);
    assertAdminCovers(admin, before.cityId);
    await prospectRef(data.prospectId).update(fields);
    if (before.ownerId !== owner.uid) {
      await prospectRef(data.prospectId)
        .collection(SUBCOLLECTIONS.prospects.activities)
        .add({ type: 'note', summary: `Fiche confiée à ${owner.displayName}.`, fromStage: null, toStage: null, by: caller.uid, at: now } satisfies ProspectActivity);
      if (owner.uid !== caller.uid) {
        await pushInApp(owner.uid, { title: 'Nouveau prospect confié', body: `${data.name} vous a été confié.`, category: 'account', link: { type: 'page', target: `/prospection/${data.prospectId}` } });
      }
    }
    return { prospectId: data.prospectId };
  }
  const ref = db.collection(COLLECTIONS.prospects).doc();
  await ref.set({
    ...fields,
    stage: 'to_contact',
    address: null,
    lostReason: null,
    restaurantId: null,
    signedUpAt: null,
    lastActivityAt: now,
    createdAt: now,
    createdBy: caller.uid,
  });
  await ref
    .collection(SUBCOLLECTIONS.prospects.activities)
    .add({ type: 'note', summary: 'Fiche prospect créée.', fromStage: null, toStage: 'to_contact', by: caller.uid, at: now } satisfies ProspectActivity);
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'prospect.created',
    target: { type: 'other', id: ref.id, label: data.name },
    after: { cityId: data.cityId, ownerId: owner.uid, source: data.source },
    countryId: data.countryId,
    cityId: data.cityId,
    request,
  });
  return { prospectId: ref.id };
});

// ------------------------------------------------------------------ Étapes

const moveSchema = z.object({
  prospectId: zId,
  toStage: z.enum(PROSPECT_STAGES),
  summary: z.string().trim().max(500).nullable().default(null),
  lostReason: z.string().trim().max(300).nullable().default(null),
  restaurantId: zId.nullable().default(null),
  nextFollowUpAt: followUp,
});

/** Change l'étape d'un prospect ; l'inscription crée la commission du commercial. */
export const moveProspect = callable(moveSchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'crm.edit');
  const ref = prospectRef(data.prospectId);
  if (data.toStage === 'lost' && (!data.lostReason || data.lostReason.length < 3)) throw fail.invalid('Indiquez pourquoi le prospect est perdu.');
  let restaurantName: string | null = null;
  if (data.toStage === 'signed_up' && data.restaurantId) {
    const r = await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get();
    if (!r.exists) throw fail.notFound('Restaurant');
    restaurantName = r.get('name') as string;
  }
  const crm = await loadCrmSettings();
  const commissionRef = db.collection(COLLECTIONS.salesCommissions).doc(`commission-${data.prospectId}`);
  const now = Timestamp.now();

  const before = await db.runTransaction(async (tx) => {
    const [snap, commission] = await Promise.all([tx.get(ref), tx.get(commissionRef)]);
    const p = snap.data() as Prospect | undefined;
    if (!p) throw fail.notFound('Prospect');
    assertAdminCovers(admin, p.cityId);
    if (p.stage === data.toStage) throw fail.precondition(`Le prospect est déjà à l’étape « ${PROSPECT_STAGE_LABELS[data.toStage]} ».`);
    const existing = commission.data() as SalesCommission | undefined;
    if (p.stage === 'signed_up' && existing && ['approved', 'paid'].includes(existing.status)) {
      throw fail.precondition('La commission de cette inscription est déjà validée : le prospect ne peut plus changer d’étape.');
    }
    const closed = CLOSED.includes(data.toStage);
    tx.update(ref, {
      stage: data.toStage,
      lostReason: data.toStage === 'lost' ? data.lostReason : null,
      restaurantId: data.toStage === 'signed_up' ? (data.restaurantId ?? p.restaurantId ?? null) : p.restaurantId ?? null,
      signedUpAt: data.toStage === 'signed_up' ? now : null,
      nextFollowUpAt: closed ? null : data.nextFollowUpAt ? Timestamp.fromMillis(data.nextFollowUpAt) : (p.nextFollowUpAt ?? null),
      lastActivityAt: now,
      updatedAt: now,
      updatedBy: caller.uid,
    });
    tx.set(ref.collection(SUBCOLLECTIONS.prospects.activities).doc(), {
      type: 'stage_change',
      summary:
        data.summary ||
        (data.toStage === 'lost'
          ? `Perdu : ${data.lostReason}`
          : data.toStage === 'signed_up' && restaurantName
            ? `Inscrit sur GoLink : ${restaurantName}.`
            : `Passage à l’étape « ${PROSPECT_STAGE_LABELS[data.toStage]} ».`),
      fromStage: p.stage,
      toStage: data.toStage,
      by: caller.uid,
      at: now,
    } satisfies ProspectActivity);
    if (data.toStage === 'signed_up' && crm.signupBonusCents > 0 && (!existing || existing.status === 'cancelled')) {
      const c: SalesCommission = {
        salesRepId: p.ownerId,
        restaurantId: data.restaurantId ?? p.restaurantId ?? '',
        prospectId: data.prospectId,
        basis: 'signup_bonus',
        amountCents: crm.signupBonusCents,
        period: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date()),
        status: 'pending',
        createdAt: now,
        paidAt: null,
      };
      tx.set(commissionRef, c);
    }
    if (p.stage === 'signed_up' && existing?.status === 'pending') tx.update(commissionRef, { status: 'cancelled' });
    return p;
  });

  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'prospect.stage_changed',
    target: { type: 'other', id: data.prospectId, label: before.name },
    before: { stage: before.stage },
    after: { stage: data.toStage, restaurantId: data.restaurantId, lostReason: data.lostReason },
    countryId: before.countryId,
    cityId: before.cityId,
    request,
  });
  return { prospectId: data.prospectId, stage: data.toStage };
});

// ------------------------------------------------------------------ Actions et relances

const activitySchema = z.object({
  prospectId: zId,
  type: z.enum(['call', 'email', 'visit', 'demo', 'note']),
  summary: z.string().trim().min(3, 'Décrivez l’échange en quelques mots.').max(1000),
  nextFollowUpAt: followUp,
});

export const logProspectActivity = callable(activitySchema, async (data, request) => {
  const { caller, admin } = await requireAdmin(request, 'crm.edit');
  const p = await loadProspect(data.prospectId);
  assertAdminCovers(admin, p.cityId);
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(prospectRef(data.prospectId).collection(SUBCOLLECTIONS.prospects.activities).doc(), {
    type: data.type,
    summary: data.summary,
    fromStage: null,
    toStage: null,
    by: caller.uid,
    at: now,
  } satisfies ProspectActivity);
  batch.update(prospectRef(data.prospectId), {
    lastActivityAt: now,
    ...(data.nextFollowUpAt !== null && !CLOSED.includes(p.stage) ? { nextFollowUpAt: Timestamp.fromMillis(data.nextFollowUpAt) } : {}),
    updatedAt: now,
    updatedBy: caller.uid,
  });
  await batch.commit();
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'prospect.activity_logged',
    target: { type: 'other', id: data.prospectId, label: p.name },
    after: { type: data.type, nextFollowUpAt: data.nextFollowUpAt },
    countryId: p.countryId,
    cityId: p.cityId,
    request,
  });
  return { prospectId: data.prospectId };
});

// ------------------------------------------------------------------ Équipe commerciale

/** Commerciaux ayant accès à la prospection (liste d'attribution et résultats). */
export const getSalesTeam = callable(z.object({}), async (_data, request) => {
  await requireAdmin(request, 'crm.view');
  const snap = await db.collection(COLLECTIONS.admins).where('active', '==', true).get();
  const reps = snap.docs
    .map((d) => ({ ...(d.data() as AdminUser), uid: d.id }))
    .filter((a) => adminHasPermission(a, 'crm.edit'))
    .map((a) => ({ uid: a.uid, displayName: a.displayName, email: a.email, role: a.role, cityIds: a.cityIds }));
  return { reps };
});

export const decideSalesCommission = callable(
  z.object({ commissionId: zId, decision: z.enum(['approve', 'pay', 'cancel']), reason: zReason.nullish() }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'crm.manage_team');
    if (data.decision === 'cancel' && !data.reason) throw fail.invalid('Indiquez le motif de l’annulation.');
    const ref = db.collection(COLLECTIONS.salesCommissions).doc(data.commissionId);
    const allowed: Record<typeof data.decision, SalesCommission['status'][]> = { approve: ['pending'], pay: ['approved'], cancel: ['pending', 'approved'] };
    const next: Record<typeof data.decision, SalesCommission['status']> = { approve: 'approved', pay: 'paid', cancel: 'cancelled' };
    const before = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const c = snap.data() as SalesCommission | undefined;
      if (!c) throw fail.notFound('Commission');
      if (!allowed[data.decision].includes(c.status)) throw fail.precondition('Cette commission a déjà changé de statut.');
      tx.update(ref, { status: next[data.decision], ...(data.decision === 'pay' ? { paidAt: Timestamp.now() } : {}) });
      return c;
    });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: `sales_commission.${next[data.decision]}`,
      target: { type: 'admin', id: before.salesRepId },
      reason: data.reason ?? null,
      before: { status: before.status, amountCents: before.amountCents },
      after: { status: next[data.decision] },
      request,
    });
    return { commissionId: ref.id, status: next[data.decision] };
  },
);

/** Chaque matin : rappel à chaque commercial de ses relances du jour et en retard. */
export const prospectFollowUpReminders = onSchedule({ schedule: '0 8 * * 1-6', timeZone: 'Europe/Paris' }, async () => {
  const crm = await loadCrmSettings();
  if (!crm.followUpReminders) return;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const snap = await db.collection(COLLECTIONS.prospects).where('nextFollowUpAt', '<=', Timestamp.fromDate(end)).limit(1000).get();
  const byOwner = new Map<string, string[]>();
  for (const doc of snap.docs) {
    const p = doc.data() as Prospect;
    if (CLOSED.includes(p.stage)) continue;
    byOwner.set(p.ownerId, [...(byOwner.get(p.ownerId) ?? []), p.name]);
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  for (const [ownerId, names] of byOwner) {
    const list = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    await pushInApp(
      ownerId,
      {
        title: names.length > 1 ? `${names.length} relances prévues aujourd’hui` : '1 relance prévue aujourd’hui',
        body: list,
        category: 'account',
        link: { type: 'page', target: '/prospection?vue=relances' },
      },
      `relances-${day}`,
    );
  }
});
