// Logiciels de caisse (cahier §25) : connexion d'un commerce à sa caisse par webhook signé.
// Chaque commande reçue est poussée à la caisse (événements `order.created` et `order.cancelled`),
// avec suivi par commerce (dernier envoi, erreurs) et journal des envois. La connexion se règle
// depuis le super admin ; l'interrupteur « Intégration caisse » (§24) l'active par portée.
//
// Sécurité : URL en https, hôtes locaux et privés refusés (pas d'appel vers le réseau interne),
// signature HMAC-SHA256 du corps avec un secret propre à la connexion (montré une seule fois,
// jamais relisible : stocké dans posConnections/{id}/private/signing, inaccessible aux clients).
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { COLLECTIONS, type Order, type PosConnection, type Restaurant } from '@golink/shared';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { SYSTEM_ACTOR, actorFromCaller, writeAudit } from '../lib/audit';
import { assertFeatureOn, isFeatureOn, scopeOfRestaurant } from '../lib/features';
import { fail } from '../lib/errors';
import { z, zId, zReason } from '../lib/validation';
import { platformCallable, requireSecureAdmin } from './runtime';

const PROVIDERS = ['generic_webhook', 'lightspeed', 'zelty', 'popina', 'other'] as const;
const MAX_CONSECUTIVE_FAILURES = 3;

type Connection = PosConnection & { webhookUrl?: string | null; label?: string | null; consecutiveFailures?: number; pushedCount?: number; failedCount?: number };

/** Refuse les adresses locales et privées (appel sortant limité à Internet public). */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw fail.invalid('Adresse de webhook invalide.');
  }
  if (url.protocol !== 'https:') throw fail.invalid('L’adresse du webhook doit commencer par https://');
  const host = url.hostname.toLowerCase();
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') {
    throw fail.invalid('Cette adresse n’est pas publique : le webhook doit être joignable sur Internet.');
  }
  if (isIP(host) === 4 && privateV4.test(host)) throw fail.invalid('Cette adresse n’est pas publique : le webhook doit être joignable sur Internet.');
  if (isIP(host) === 6 || host.startsWith('[')) throw fail.invalid('Utilisez un nom de domaine plutôt qu’une adresse IPv6.');
  return url;
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function signingRef(connectionId: string) {
  return db.collection(COLLECTIONS.posConnections).doc(connectionId).collection('private').doc('signing');
}

/** Résumé d'une commande transmis à la caisse : pas d'adresse ni de coordonnées complètes. */
function orderPayload(orderId: string, order: Order) {
  return {
    id: orderId,
    number: order.number,
    status: order.status,
    fulfillment: order.fulfillment,
    createdAt: order.createdAt.toDate().toISOString(),
    scheduledFor: order.scheduledFor ? order.scheduledFor.toDate().toISOString() : null,
    customerFirstName: order.customerName?.split(' ')[0] ?? null,
    pickupCode: (order as Order & { handoverCode?: string | null }).handoverCode ?? null,
    items: order.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents, note: i.comment ?? null, options: (i.options ?? []).map((o) => `${o.quantity > 1 ? `${o.quantity} x ` : ''}${o.name}`) })),
    amounts: { subtotalCents: order.amounts.subtotalCents, totalCents: order.amounts.totalCents, currency: 'EUR' },
    payment: { method: order.payment.method, status: order.payment.status },
    note: order.customerNote ?? null,
  };
}

interface Delivery {
  ok: boolean;
  status: number | null;
  error: string | null;
}

async function deliver(connectionId: string, connection: Connection, event: string, data: unknown, deliveryId: string): Promise<Delivery> {
  if (!connection.webhookUrl) return { ok: false, status: null, error: 'Aucune adresse de webhook.' };
  const secret = (await signingRef(connectionId).get()).get('secret') as string | undefined;
  if (!secret) return { ok: false, status: null, error: 'Secret de signature absent.' };
  const url = assertPublicHttpsUrl(connection.webhookUrl);
  const body = JSON.stringify({ event, deliveryId, sentAt: new Date().toISOString(), data });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-golink-event': event, 'x-golink-delivery': deliveryId, 'x-golink-signature': sign(secret, body), 'user-agent': 'Ciyou Eats-POS/1.0' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? { ok: true, status: response.status, error: null } : { ok: false, status: response.status, error: `La caisse a répondu ${response.status}` };
  } catch (error) {
    return { ok: false, status: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
  }
}

/** Enregistre le résultat d'un envoi : compteurs, statut de la connexion et journal des envois. */
async function recordDelivery(connectionId: string, connection: Connection, event: string, orderId: string | null, deliveryId: string, result: Delivery): Promise<void> {
  const ref = db.collection(COLLECTIONS.posConnections).doc(connectionId);
  const now = Timestamp.now();
  const failures = result.ok ? 0 : (connection.consecutiveFailures ?? 0) + 1;
  await ref.update({
    lastSyncAt: result.ok ? now : (connection.lastSyncAt ?? null),
    lastError: result.ok ? null : result.error,
    consecutiveFailures: failures,
    errorCount24h: result.ok ? connection.errorCount24h ?? 0 : (connection.errorCount24h ?? 0) + 1,
    pushedCount: FieldValue.increment(result.ok ? 1 : 0),
    failedCount: FieldValue.increment(result.ok ? 0 : 1),
    status: result.ok ? 'connected' : failures >= MAX_CONSECUTIVE_FAILURES ? 'error' : connection.status,
    updatedAt: now,
    updatedBy: 'system',
  });
  await ref.collection('deliveries').doc(deliveryId).set({ event, orderId, ok: result.ok, httpStatus: result.status, error: result.error, at: now });
}

// ------------------------------------------------------------------ Gestion par l'équipe Ciyou Eats

const connectionSchema = z.object({
  connectionId: zId.nullish(),
  restaurantId: zId,
  provider: z.enum(PROVIDERS),
  label: z.string().trim().max(80).nullish(),
  webhookUrl: z.string().trim().min(10).max(300),
  externalLocationId: z.string().trim().max(80).nullish(),
  pushOrders: z.boolean().default(true),
  reason: zReason,
});

/** Crée ou modifie la connexion caisse d'un commerce. À la création, le secret de signature est renvoyé une seule fois. */
export const savePosConnection = platformCallable(connectionSchema, async (data, request) => {
  const { caller } = await requireSecureAdmin(request, 'integrations.edit');
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get();
  if (!restaurantSnap.exists) throw fail.notFound('Restaurant');
  const restaurant = restaurantSnap.data() as Restaurant;
  await assertFeatureOn('pos_integration', scopeOfRestaurant(restaurant, data.restaurantId), 'L’intégration caisse est désactivée pour ce commerce : activez d’abord la fonctionnalité « Intégration caisse ».');
  assertPublicHttpsUrl(data.webhookUrl);
  const col = db.collection(COLLECTIONS.posConnections);
  const ref = data.connectionId ? col.doc(data.connectionId) : col.doc();
  const existing = await ref.get();
  if (data.connectionId && !existing.exists) throw fail.notFound('Connexion caisse');
  if (existing.exists && (existing.data() as PosConnection).restaurantId !== data.restaurantId) throw fail.invalid('Cette connexion appartient à un autre commerce.');
  const now = Timestamp.now();
  const fields = { restaurantId: data.restaurantId, provider: data.provider, label: data.label ?? null, webhookUrl: data.webhookUrl, externalLocationId: data.externalLocationId ?? null, pushOrders: data.pushOrders, syncMenu: false };
  let secret: string | null = null;
  if (existing.exists) {
    await ref.update({ ...fields, updatedAt: now, updatedBy: caller.uid });
  } else {
    secret = `pos_${randomBytes(24).toString('base64url')}`;
    await ref.set({ ...fields, status: 'pending', lastSyncAt: null, lastError: null, errorCount24h: 0, consecutiveFailures: 0, pushedCount: 0, failedCount: 0, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
    await signingRef(ref.id).set({ secret, createdAt: now });
  }
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: existing.exists ? 'pos_connection.updated' : 'pos_connection.created',
    target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
    reason: data.reason,
    before: existing.exists ? { provider: existing.get('provider'), webhookHost: (() => { try { return new URL(String(existing.get('webhookUrl'))).host; } catch { return null; } })(), pushOrders: existing.get('pushOrders') } : null,
    after: { provider: data.provider, webhookHost: new URL(data.webhookUrl).host, pushOrders: data.pushOrders },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    sensitive: !existing.exists,
    request,
  });
  return { connectionId: ref.id, secret };
});

/** Envoie un événement de test signé et met à jour l'état de la connexion. */
export const testPosConnection = platformCallable(z.object({ connectionId: zId, reason: zReason }), async (data, request) => {
  const { caller } = await requireSecureAdmin(request, 'integrations.edit');
  const ref = db.collection(COLLECTIONS.posConnections).doc(data.connectionId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Connexion caisse');
  const connection = snap.data() as Connection;
  const deliveryId = `test-${Date.now().toString(36)}`;
  const result = await deliver(ref.id, connection, 'ping', { message: 'Test de connexion Ciyou Eats', restaurantId: connection.restaurantId }, deliveryId);
  await recordDelivery(ref.id, connection, 'ping', null, deliveryId, result);
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'pos_connection.tested',
    target: { type: 'restaurant', id: connection.restaurantId, label: connection.label ?? connection.provider },
    reason: data.reason,
    after: { ok: result.ok, httpStatus: result.status, error: result.error },
    request,
  });
  return { ok: result.ok, httpStatus: result.status, error: result.error };
});

/** Coupe la connexion : plus aucune commande n'est transmise. */
export const disconnectPosConnection = platformCallable(z.object({ connectionId: zId, reason: zReason }), async (data, request) => {
  const { caller } = await requireSecureAdmin(request, 'integrations.edit');
  const ref = db.collection(COLLECTIONS.posConnections).doc(data.connectionId);
  const snap = await ref.get();
  if (!snap.exists) throw fail.notFound('Connexion caisse');
  const connection = snap.data() as Connection;
  await ref.update({ status: 'disconnected', pushOrders: false, updatedAt: Timestamp.now(), updatedBy: caller.uid });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'pos_connection.disconnected',
    target: { type: 'restaurant', id: connection.restaurantId, label: connection.label ?? connection.provider },
    reason: data.reason,
    before: { status: connection.status },
    after: { status: 'disconnected' },
    sensitive: true,
    request,
  });
  return { status: 'disconnected' as const };
});

// ------------------------------------------------------------------ Envoi des commandes

/** Une commande arrive (ou est annulée) : elle est transmise aux caisses connectées du commerce. */
export const onOrderPushToPos = onDocumentWritten({ document: 'orders/{orderId}', retry: false, maxInstances: 3, cpu: 'gcf_gen1', memory: '256MiB' }, async (event) => {
  const before = event.data?.before.data() as Order | undefined;
  const after = event.data?.after.data() as Order | undefined;
  if (!after) return;
  const created = !before || (before.status === 'scheduled' && after.status !== 'scheduled') || (!before && after.status !== 'cancelled');
  const cancelled = before?.status !== 'cancelled' && after.status === 'cancelled' && Boolean(before);
  if (!created && !cancelled) return;
  // Commandes du jeu de démonstration : jamais transmises à une vraie caisse. Les commandes « de test » créées
  // par un commerce le sont (c'est ainsi qu'il vérifie sa connexion).
  if ((after as Order & { seed?: boolean }).seed === true) return;
  const connections = await db.collection(COLLECTIONS.posConnections).where('restaurantId', '==', after.restaurantId).where('pushOrders', '==', true).get();
  if (connections.empty) return;
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(after.restaurantId).get();
  if (!(await isFeatureOn('pos_integration', scopeOfRestaurant(restaurantSnap.data() ?? {}, after.restaurantId)))) return;
  const orderId = event.params.orderId as string;
  const kind = created && !cancelled ? 'order.created' : 'order.cancelled';
  for (const doc of connections.docs) {
    const connection = doc.data() as Connection;
    if (connection.status === 'disconnected') continue;
    const deliveryId = createHash('sha256').update(`${doc.id}:${orderId}:${kind}`).digest('hex').slice(0, 24);
    if ((await doc.ref.collection('deliveries').doc(deliveryId).get()).exists) continue;
    const result = await deliver(doc.id, connection, kind, orderPayload(orderId, after), deliveryId);
    await recordDelivery(doc.id, connection, kind, orderId, deliveryId, result);
    if (!result.ok) logger.warn('Commande non transmise à la caisse', { connectionId: doc.id, orderId, error: result.error });
  }
  void SYSTEM_ACTOR;
});
