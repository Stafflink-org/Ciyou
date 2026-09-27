// Réclamations d'un client avec photo obligatoire (décision client n° 31) : article manquant,
// abîmé, mauvais article, qualité. Le serveur contrôle la recevabilité (délai après livraison,
// articles de la commande, photo jointe) puis analyse chaque photo : doublon (empreinte SHA-256,
// dans la réclamation et dans les autres réclamations), date de prise de vue cohérente avec la
// livraison, format et taille. Le résultat ouvre un ticket au support avec les contrôles ;
// un agent accepte (remboursement imputé) ou refuse (motif). Les seuils sont dans les règles de commande.
//   - submitOrderClaim : client
//   - decideOrderClaim : agent du support (droit remboursements, plafond de son rôle)
import {
  CLAIM_CHECK_LABELS,
  CLAIM_TYPES,
  CLAIM_TYPE_LABELS,
  COLLECTIONS,
  SUBCOLLECTIONS,
  adminHasPermission,
  formatPrice,
  formatTicketNumber,
  type ClaimCheck,
  type ClaimPhoto,
  type ClaimType,
  type Counter,
  type OrderClaim,
  type OrderItem,
  type RefundCause,
  type StoredFile,
  type SupportTicket,
  type TicketMessage,
} from '@golink/shared';
import { db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { requireAdmin, requireAuth } from '../lib/permissions';
import { STRIPE_SECRET_KEY } from '../lib/secrets';
import { z, zId, zReason } from '../lib/validation';
import { addEvent, loadMarket, loadOrder, loadOrderRules, orderRef, type EventActor } from './context';
import { refundLimitOf, loadSupportSettings, slaDeadlines, preview, euros } from '../admin/experience/common';
import { sendPlatformMessage } from '../notifications/messages';
import { issueAutoRefund } from './auto-refund';
import { analyzePhoto } from './photo-checks';
import { ordersCallable as callable } from './runtime';

const CAUSE_OF: Record<ClaimType, RefundCause> = {
  missing_item: 'missing_item',
  damaged_item: 'food_quality',
  wrong_item: 'restaurant_error',
  quality: 'food_quality',
  not_received: 'missing_item',
  other: 'commercial_gesture',
};

const TICKET_REASON: Record<ClaimType, string> = {
  missing_item: 'commande-manquante',
  damaged_item: 'commande-qualite',
  wrong_item: 'commande-qualite',
  quality: 'commande-qualite',
  not_received: 'commande-manquante',
  other: 'commande-manquante',
};

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MIN_SIDE_PIXELS = 300;
/** Tolérance sur la date EXIF : la photo ne peut pas précéder la livraison de plus de ce délai. */
const PHOTO_BEFORE_DELIVERY_TOLERANCE_MS = 15 * 60_000;

function lineAmount(item: OrderItem): number {
  return item.finalTotalCents ?? item.totalCents;
}

interface AnalyzedPhoto extends ClaimPhoto {
  takenAtMs: number | null;
  readable: boolean;
}

const submitSchema = z.object({
  orderId: zId,
  type: z.enum(CLAIM_TYPES),
  lineIds: z.array(z.string().trim().min(1).max(64)).max(30).default([]),
  description: z.string().trim().min(10, 'Décrivez le problème en quelques mots (10 caractères au moins).').max(1000),
  /** Chemins Storage des photos déposées par le client (claims/{uid}/…). */
  photoPaths: z.array(z.string().trim().min(10).max(300)).max(8).default([]),
});

export const submitOrderClaim = callable(
  submitSchema,
  async (data, request) => {
    const caller = requireAuth(request);
    const order = await loadOrder(data.orderId);
    if (order.customerId !== caller.uid) throw fail.forbidden();
    if (order.status !== 'delivered' || order.closedAs === 'customer_absent') throw fail.precondition('Une réclamation se dépose sur une commande livrée.');
    const rules = await loadOrderRules(await loadMarket(order.countryId, order.cityId));
    const claimRules = rules.claims ?? { photoRequired: true, minPhotos: 1, maxPhotos: 4, checkPhotoDate: true, checkDuplicates: true, repeatThreshold30d: 3, autoAcceptMaxCents: 0 };
    const nowMs = Date.now();
    const checks: ClaimCheck[] = [];
    const add = (code: ClaimCheck['code'], ok: boolean, severity: ClaimCheck['severity'], detail: string) => checks.push({ code, ok, severity: ok ? 'info' : severity, detail });

    // Délai de réclamation après la livraison.
    const deliveredMs = (order.timeline.delivered ?? order.updatedAt).toMillis();
    const windowEnd = deliveredMs + rules.claimWindowHours * 3_600_000;
    add('window', nowMs <= windowEnd, 'blocking', nowMs <= windowEnd ? `Dans le délai de ${rules.claimWindowHours} h après la livraison.` : `Le délai de ${rules.claimWindowHours} h après la livraison est dépassé.`);

    // Articles concernés.
    const lines = data.lineIds.map((id) => order.items.find((i) => i.lineId === id));
    const needsLines = data.type === 'missing_item' || data.type === 'damaged_item' || data.type === 'wrong_item';
    const linesOk = lines.every(Boolean) && (!needsLines || lines.length > 0) && lines.every((l) => l && l.adjustment?.type !== 'removed');
    add('lines_valid', linesOk, 'blocking', linesOk ? 'Articles de la commande reconnus.' : needsLines && data.lineIds.length === 0 ? 'Indiquez le ou les articles concernés.' : 'Un article indiqué ne figure pas dans la commande.');
    // Commande non reçue : montant réclamé = ce qui a été réglé (aucun article livré).
    const claimedCents = data.type === 'not_received' ? order.amounts.chargedCents : lines.reduce((sum, l) => sum + (l ? lineAmount(l) : 0), 0);

    // Réclamations déjà déposées sur cette commande / ce client.
    const previous = (await db.collection(COLLECTIONS.orderClaims).where('customerId', '==', caller.uid).limit(200).get()).docs.map((d) => ({ id: d.id, ...(d.data() as OrderClaim) }));
    const sameOrder = previous.filter((c) => c.orderId === data.orderId && c.status !== 'rejected');
    const alreadyLines = data.lineIds.filter((id) => sameOrder.some((c) => c.lineIds.includes(id)));
    add('already_claimed', alreadyLines.length === 0 && !(data.lineIds.length === 0 && sameOrder.some((c) => c.type === data.type && c.lineIds.length === 0)), 'blocking', alreadyLines.length ? 'Ces articles ont déjà fait l’objet d’une réclamation.' : 'Aucune réclamation en double.');
    const recent = previous.filter((c) => nowMs - c.createdAt.toMillis() <= 30 * 86_400_000).length;
    add('repeat_claims', recent < claimRules.repeatThreshold30d, 'warning', recent < claimRules.repeatThreshold30d ? `${recent} réclamation(s) sur 30 jours.` : `${recent} réclamations sur 30 jours (seuil ${claimRules.repeatThreshold30d}) : dossier à examiner par un agent.`);

    // Photos : obligatoires, puis analysées une à une.
    const required = claimRules.photoRequired ? Math.max(1, claimRules.minPhotos) : claimRules.minPhotos;
    if (data.photoPaths.length > claimRules.maxPhotos) throw fail.invalid(`Au plus ${claimRules.maxPhotos} photos par réclamation.`);
    add('photo_present', data.photoPaths.length >= required, 'blocking', data.photoPaths.length >= required ? `${data.photoPaths.length} photo(s) jointe(s).` : `Joignez au moins ${required} photo${required > 1 ? 's' : ''} : elle est obligatoire pour une réclamation.`);
    const prefix = `claims/${caller.uid}/`;
    const photos: AnalyzedPhoto[] = [];
    const timeZone = (await loadMarket(order.countryId, order.cityId)).city?.timezone ?? 'Europe/Paris';
    for (const path of data.photoPaths) {
      if (!path.startsWith(prefix) || path.includes('..')) throw fail.invalid('Emplacement de photo invalide.');
      const file = storage.bucket().file(path);
      const [exists] = await file.exists();
      if (!exists) throw fail.precondition('Une photo n’a pas été reçue : recommencez son envoi.');
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (size <= 0 || size > MAX_PHOTO_BYTES) throw fail.invalid('Photo vide ou trop volumineuse (10 Mo au plus).');
      const [content] = await file.download();
      const analysis = analyzePhoto(content, timeZone);
      photos.push({
        path,
        contentType: metadata.contentType ?? 'application/octet-stream',
        size,
        sha256: analysis.sha256,
        width: analysis.width,
        height: analysis.height,
        takenAt: analysis.takenAtMs ? Timestamp.fromMillis(analysis.takenAtMs) : null,
        takenAtMs: analysis.takenAtMs,
        readable: analysis.readable,
      });
    }
    if (photos.length) {
      const unreadable = photos.filter((p) => !p.readable).length;
      add('photo_readable', unreadable === 0, 'blocking', unreadable === 0 ? 'Photos lisibles.' : `${unreadable} fichier(s) ne sont pas des photos exploitables (JPEG, PNG, WebP ou HEIC).`);
      const small = photos.filter((p) => p.width !== null && p.height !== null && Math.min(p.width ?? 0, p.height ?? 0) < MIN_SIDE_PIXELS).length;
      add('photo_size', small === 0, 'warning', small === 0 ? 'Définition suffisante.' : `${small} photo(s) de définition trop faible (moins de ${MIN_SIDE_PIXELS} px).`);
      const hashes = photos.map((p) => p.sha256);
      const own = hashes.length - new Set(hashes).size;
      add('photo_duplicate_own', own === 0, 'blocking', own === 0 ? 'Photos toutes différentes.' : 'La même photo est jointe plusieurs fois.');
      if (claimRules.checkDuplicates) {
        const clashes: string[] = [];
        for (const hash of new Set(hashes)) {
          const other = await db.collection(COLLECTIONS.orderClaims).where('photoHashes', 'array-contains', hash).limit(3).get();
          if (other.docs.some((d) => d.get('orderId') !== data.orderId || d.get('customerId') !== caller.uid)) clashes.push(hash.slice(0, 8));
        }
        add('photo_duplicate_other', clashes.length === 0, 'warning', clashes.length === 0 ? 'Photos jamais utilisées dans une autre réclamation.' : `${clashes.length} photo(s) déjà utilisée(s) dans une autre réclamation (empreinte ${clashes.join(', ')}).`);
      }
      if (claimRules.checkPhotoDate) {
        const dated = photos.filter((p) => p.takenAtMs !== null);
        if (dated.length === 0) checks.push({ code: 'photo_date', ok: true, severity: 'info', detail: 'Date de prise de vue non lisible dans la photo : contrôle non applicable.' });
        else {
          const tooOld = dated.filter((p) => (p.takenAtMs as number) < deliveredMs - PHOTO_BEFORE_DELIVERY_TOLERANCE_MS);
          const future = dated.filter((p) => (p.takenAtMs as number) > nowMs + 10 * 60_000);
          const ok = tooOld.length === 0 && future.length === 0;
          add('photo_date', ok, 'warning', ok ? 'Date de prise de vue cohérente avec la livraison.' : tooOld.length ? `${tooOld.length} photo(s) prise(s) avant la livraison de la commande.` : `${future.length} photo(s) datée(s) dans le futur.`);
        }
      }
    }

    const blocking = checks.filter((c) => !c.ok && c.severity === 'blocking');
    const suspicious = checks.filter((c) => !c.ok && c.severity === 'warning');
    if (blocking.some((c) => c.code === 'photo_present' || c.code === 'lines_valid' || c.code === 'photo_readable')) {
      // Dossier incomplet : rien n'est enregistré, le client corrige et renvoie.
      throw fail.precondition(blocking.find((c) => c.code === 'photo_present' || c.code === 'lines_valid' || c.code === 'photo_readable')!.detail);
    }
    const verdict: OrderClaim['verdict'] = blocking.length ? 'rejected' : suspicious.length ? 'suspect' : 'clean';
    const autoAccept = verdict === 'clean' && claimRules.autoAcceptMaxCents > 0 && claimedCents > 0 && claimedCents <= claimRules.autoAcceptMaxCents;

    const at = Timestamp.now();
    const claimRef = db.collection(COLLECTIONS.orderClaims).doc();
    const claim: OrderClaim & { photoHashes: string[] } = {
      orderId: data.orderId,
      orderNumber: order.number,
      customerId: caller.uid,
      customerName: order.customerName,
      restaurantId: order.restaurantId,
      driverId: order.driverId ?? null,
      countryId: order.countryId,
      cityId: order.cityId,
      type: data.type,
      lineIds: data.lineIds,
      description: data.description,
      photos: photos.map(({ takenAtMs: _t, readable: _r, ...photo }) => photo),
      photoHashes: photos.map((p) => p.sha256),
      checks,
      verdict,
      status: verdict === 'rejected' ? 'rejected' : 'pending_review',
      claimedCents,
      grantedCents: 0,
      refundId: null,
      ticketId: null,
      decidedBy: verdict === 'rejected' ? 'system' : null,
      decidedAt: verdict === 'rejected' ? at : null,
      decisionNote: verdict === 'rejected' ? blocking.map((c) => c.detail).join(' ') : null,
      createdAt: at,
      updatedAt: at,
      ...(order.test ? { test: true } : {}),
    };

    // Ticket au support (sauf rejet automatique) : les contrôles sont joints en note interne.
    let ticketId: string | null = null;
    let ticketNumber: string | null = null;
    if (verdict !== 'rejected') {
      const priority = verdict === 'suspect' ? 'high' : 'normal';
      const sla = slaDeadlines(await loadSupportSettings(), priority, at.toMillis());
      const ticketRef = db.collection(COLLECTIONS.supportTickets).doc();
      ticketId = ticketRef.id;
      await db.runTransaction(async (tx) => {
        const counterRef = db.collection(COLLECTIONS.counters).doc('tickets');
        const counter = (await tx.get(counterRef)).data() as Counter | undefined;
        const sequence = (counter?.value ?? 4600) + 1;
        ticketNumber = formatTicketNumber(sequence);
        const files: StoredFile[] = photos.map((p) => ({ path: p.path, contentType: p.contentType, size: p.size, name: p.path.split('/').pop() ?? 'photo', uploadedAt: at, uploadedBy: caller.uid }));
        const ticket: SupportTicket = {
          number: ticketNumber,
          requesterType: 'client',
          requesterId: caller.uid,
          requesterName: order.customerName,
          restaurantId: order.restaurantId,
          driverId: order.driverId ?? null,
          orderId: data.orderId,
          countryId: order.countryId,
          cityId: order.cityId ?? null,
          reasonId: TICKET_REASON[data.type],
          subject: `${order.number} · Réclamation : ${CLAIM_TYPE_LABELS[data.type]}`,
          status: 'open',
          priority,
          channel: 'app',
          assigneeId: null,
          escalated: false,
          escalatedTo: null,
          escalatedAt: null,
          firstResponseAt: null,
          firstResponseDueAt: sla.firstResponseDueAt,
          resolutionDueAt: sla.resolutionDueAt,
          resolvedAt: null,
          closedAt: null,
          refundIds: [],
          compensationCents: 0,
          satisfaction: null,
          tags: ['réclamation', data.type, ...(verdict === 'suspect' ? ['photo-à-vérifier'] : [])],
          lastMessageAt: at,
          lastMessagePreview: preview(data.description),
          unreadByRequester: 0,
          unreadBySupport: 1,
          createdAt: at,
          createdBy: caller.uid,
          updatedAt: at,
          updatedBy: caller.uid,
        };
        const first: TicketMessage = { authorType: 'requester', authorId: caller.uid, authorName: order.customerName, body: data.description, internal: false, attachments: files, action: null, createdAt: at };
        const summary: TicketMessage = {
          authorType: 'system',
          authorId: 'system',
          authorName: 'Contrôles automatiques',
          body: `Réclamation ${CLAIM_TYPE_LABELS[data.type]} · ${formatPrice(claimedCents)} réclamés · verdict : ${verdict === 'clean' ? 'aucun signal' : 'à vérifier'}.\n${checks.map((c) => `${c.ok ? '✓' : '✗'} ${CLAIM_CHECK_LABELS[c.code]} : ${c.detail}`).join('\n')}`,
          internal: true,
          attachments: [],
          action: null,
          createdAt: at,
        };
        tx.set(ticketRef, { ...ticket, claimId: claimRef.id, ...(order.test ? { test: true } : {}) });
        tx.set(ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).doc(), first);
        tx.set(ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).doc(), summary);
        tx.set(counterRef, { value: sequence, prefix: 'T-', updatedAt: at }, { merge: true });
        tx.set(claimRef, { ...claim, ticketId });
        tx.update(orderRef(data.orderId), { ticketIds: FieldValue.arrayUnion(ticketRef.id), 'flags.disputed': true, updatedAt: at });
        addEvent(tx, data.orderId, { type: 'customer', uid: caller.uid, name: order.customerName }, { type: 'note_added', from: null, to: null, visibleToCustomer: true, message: `Réclamation déposée (${CLAIM_TYPE_LABELS[data.type]}), ticket ${ticketNumber}.`, data: { claimId: claimRef.id, ticketId: ticketRef.id, verdict } }, at);
      });
    } else {
      await claimRef.set(claim);
    }

    await writeAudit({
      actor: actorFromCaller(caller, 'client'),
      action: verdict === 'rejected' ? 'claim.auto_rejected' : 'claim.submitted',
      target: { type: 'order', id: data.orderId, label: `${order.number} · ${order.restaurantName}` },
      reason: verdict === 'rejected' ? blocking.map((c) => c.detail).join(' ') : `${CLAIM_TYPE_LABELS[data.type]} · ${formatPrice(claimedCents)}`,
      after: { claimId: claimRef.id, verdict, photos: photos.length, ticketId, suspicious: suspicious.map((c) => c.code) },
      countryId: order.countryId,
      cityId: order.cityId ?? null,
      request,
    });
    const target = { uid: caller.uid, type: 'client' as const, name: order.customerName, demo: order.test === true };
    const link = { type: 'order' as const, target: data.orderId };
    if (verdict === 'rejected') {
      await sendPlatformMessage('claim_decided', target, { orderNumber: order.number, decision: `réclamation refusée automatiquement. ${blocking.map((c) => c.detail).join(' ')}` }, { dedupeKey: claimRef.id, link });
    } else {
      await sendPlatformMessage('claim_received', target, { orderNumber: order.number }, { dedupeKey: claimRef.id, link });
    }
    // Acceptation automatique (réglage `autoAcceptMaxCents`) : contrôles propres et petit montant.
    if (autoAccept) {
      await grantClaim(claimRef.id, claim.claimedCents, { type: 'system', uid: null, name: 'GoLink' }, 'Acceptation automatique : contrôles de la photo sans signal.', null);
    }
    return { claimId: claimRef.id, verdict, status: autoAccept ? ('accepted' as const) : claim.status, ticketId, ticketNumber, checks };
  },
  { secrets: [STRIPE_SECRET_KEY], memory: '512MiB', timeoutSeconds: 120 },
);

/** Accorde la réclamation : remboursement imputé (règle « qui paie »), ticket résolu, client prévenu. */
async function grantClaim(claimId: string, amountCents: number, actor: EventActor, note: string, request: Parameters<typeof writeAudit>[0]['request'] | null, auditActor?: Parameters<typeof writeAudit>[0]['actor']): Promise<{ refundedCents: number }> {
  const claimRef = db.collection(COLLECTIONS.orderClaims).doc(claimId);
  const claim = (await claimRef.get()).data() as OrderClaim | undefined;
  if (!claim) throw fail.notFound('Réclamation');
  const order = await loadOrder(claim.orderId);
  const refund = await issueAutoRefund({
    orderId: claim.orderId,
    key: `claim-${claimId}`,
    amountCents,
    cause: CAUSE_OF[claim.type],
    reason: `Réclamation acceptée : ${CLAIM_TYPE_LABELS[claim.type]}`,
    actor,
    lineIds: claim.lineIds,
    ticketId: claim.ticketId ?? null,
  });
  if (refund.status === 'failed') throw fail.unavailable('Le remboursement n’a pas pu être effectué. Réessayez dans un instant.');
  const at = Timestamp.now();
  await claimRef.update({ status: 'accepted', grantedCents: refund.amountCents, refundId: refund.refundId, decidedBy: actor.uid ?? 'system', decidedAt: at, decisionNote: note, updatedAt: at });
  if (claim.ticketId) {
    const ticketRef = db.collection(COLLECTIONS.supportTickets).doc(claim.ticketId);
    const message: TicketMessage = {
      authorType: 'system',
      authorId: actor.uid ?? 'system',
      authorName: actor.name ?? 'GoLink',
      body: `Réclamation acceptée : ${euros(refund.amountCents)} remboursés. ${note}`,
      internal: false,
      attachments: [],
      action: { type: 'refund', detail: euros(refund.amountCents) },
      createdAt: at,
    };
    await ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).add(message);
    await ticketRef.update({
      status: 'resolved',
      resolvedAt: at,
      refundIds: FieldValue.arrayUnion(refund.refundId ?? ''),
      compensationCents: FieldValue.increment(refund.amountCents),
      lastMessageAt: at,
      lastMessagePreview: preview(message.body),
      unreadByRequester: FieldValue.increment(1),
      updatedAt: at,
    });
  }
  await orderRef(claim.orderId).update({ 'flags.disputed': false, updatedAt: at }).catch(() => undefined);
  await writeAudit({
    actor: auditActor ?? { uid: 'system', type: 'system', role: null, name: 'GoLink (automatique)' },
    action: 'claim.accepted',
    target: { type: 'order', id: claim.orderId, label: `${claim.orderNumber} · ${order.restaurantName}` },
    reason: note,
    after: { claimId, grantedCents: refund.amountCents, refundId: refund.refundId },
    countryId: claim.countryId,
    cityId: claim.cityId,
    request: request ?? undefined,
    sensitive: true,
  });
  await sendPlatformMessage(
    'claim_decided',
    { uid: claim.customerId, type: 'client', name: claim.customerName, demo: order.test === true },
    { orderNumber: claim.orderNumber, decision: `réclamation acceptée, ${formatPrice(refund.amountCents)} vous sont remboursés.` },
    { dedupeKey: `${claimId}-accepted`, link: { type: 'order', target: claim.orderId } },
  );
  return { refundedCents: refund.amountCents };
}

export const decideOrderClaim = callable(
  z.object({ claimId: zId, decision: z.enum(['accept', 'reject']), amountCents: z.number().int().min(50).max(1_000_000).nullish(), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'refunds.create');
    const claimRef = db.collection(COLLECTIONS.orderClaims).doc(data.claimId);
    const claim = (await claimRef.get()).data() as OrderClaim | undefined;
    if (!claim) throw fail.notFound('Réclamation');
    if (admin.role !== 'super_admin' && admin.cityIds.length > 0 && !admin.cityIds.includes(claim.cityId)) throw fail.forbidden('Cette réclamation est hors de votre périmètre.');
    if (claim.status !== 'pending_review') throw fail.precondition('Cette réclamation a déjà été traitée.');
    const actor: EventActor = { type: 'admin', uid: caller.uid, name: 'Support GoLink' };
    const auditActor = actorFromCaller(caller, 'admin');

    if (data.decision === 'reject') {
      const at = Timestamp.now();
      await claimRef.update({ status: 'rejected', decidedBy: caller.uid, decidedAt: at, decisionNote: data.reason, updatedAt: at });
      if (claim.ticketId) {
        const ticketRef = db.collection(COLLECTIONS.supportTickets).doc(claim.ticketId);
        const body = `Réclamation refusée : ${data.reason}`;
        await ticketRef.collection(SUBCOLLECTIONS.supportTickets.messages).add({ authorType: 'agent', authorId: caller.uid, authorName: `${admin.displayName.split(' ')[0]} (support GoLink)`, body, internal: false, attachments: [], action: null, createdAt: at } satisfies TicketMessage);
        await ticketRef.update({ status: 'resolved', resolvedAt: at, lastMessageAt: at, lastMessagePreview: preview(body), unreadByRequester: FieldValue.increment(1), updatedAt: at });
      }
      await orderRef(claim.orderId).update({ 'flags.disputed': false, updatedAt: at }).catch(() => undefined);
      await writeAudit({ actor: auditActor, action: 'claim.rejected', target: { type: 'order', id: claim.orderId, label: claim.orderNumber }, reason: data.reason, after: { claimId: data.claimId }, countryId: claim.countryId, cityId: claim.cityId, request, sensitive: true });
      const order = await loadOrder(claim.orderId);
      await sendPlatformMessage('claim_decided', { uid: claim.customerId, type: 'client', name: claim.customerName, demo: order.test === true }, { orderNumber: claim.orderNumber, decision: `réclamation refusée. ${data.reason}` }, { dedupeKey: `${data.claimId}-rejected`, link: { type: 'order', target: claim.orderId } });
      return { status: 'rejected' as const, refundedCents: 0 };
    }

    const amount = Math.min(data.amountCents ?? claim.claimedCents, Math.max(claim.claimedCents, data.amountCents ?? 0));
    if (amount <= 0) throw fail.invalid('Indiquez le montant à rembourser.');
    const limit = await refundLimitOf(admin);
    if (amount > limit && !adminHasPermission(admin, 'refunds.approve')) {
      throw fail.forbidden(`Au-delà de votre plafond (${euros(limit)}) : escaladez le ticket à un responsable.`);
    }
    const result = await grantClaim(data.claimId, amount, actor, data.reason, request, auditActor);
    return { status: 'accepted' as const, refundedCents: result.refundedCents };
  },
  { secrets: [STRIPE_SECRET_KEY] },
);
