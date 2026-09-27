// Zones de livraison du commerce : création, modification, suppression (vers la
// corbeille). Décision du client : frais et minimum de livraison sont fixés par le
// commerce sur ses zones, quel que soit le livreur ; rayon limité par la formule,
// frais et minimum encadrés par les bornes de la plateforme (pays, ville).
import { COLLECTIONS, SUBCOLLECTIONS, haversineMeters, type RestaurantDeliveryZone, type TrashItem } from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';
import { loadConfigContext, merchantDeliveryBounds, restaurantRef, CONFIG_FUNCTION_OPTIONS } from './config-context';

const MAX_ZONES = 12;
/** Garde-fou de saisie ; la borne réelle est un paramètre de la plateforme. */
const MAX_FEE_CENTS = 10_000;
const TRASH_RETENTION_DAYS = 30;

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const saveSchema = z
  .object({
    restaurantId: zId,
    zoneId: zId.optional(),
    name: z.string().trim().min(1, 'Nommez la zone').max(40),
    type: z.enum(['radius', 'polygon']),
    radiusMeters: z.number().int().min(300, '300 m au minimum').max(30_000).nullish(),
    polygon: z.array(point).min(3, 'Tracez au moins trois points').max(80, '80 points au plus').nullish(),
    feeCents: z.number().int().min(0).max(MAX_FEE_CENTS, 'Frais de livraison trop élevés'),
    minOrderCents: z.number().int().min(0).max(50_000).nullish(),
    freeAboveCents: z.number().int().min(0).max(100_000).nullish(),
    deliveryMinutes: z.number().int().min(5).max(90).nullish(),
    enabled: z.boolean(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide'),
    order: z.number().int().min(0).max(100).optional(),
  })
  .refine((v) => (v.type === 'radius' ? v.radiusMeters != null : (v.polygon?.length ?? 0) >= 3), {
    message: 'Définissez le rayon ou le tracé de la zone.',
  });

export const saveDeliveryZone = callable(saveSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'zones.manage', 'restaurants.edit');
  const ctx = await loadConfigContext(data.restaurantId);
  const { restaurant, plan } = ctx;
  const bounds = merchantDeliveryBounds(ctx);
  const maxRadius = Math.min(plan.maxDeliveryRadiusMeters, bounds.maxRadiusMeters ?? Number.MAX_SAFE_INTEGER);
  const eur = (cents: number) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  if (bounds.minFeeCents != null && data.feeCents < bounds.minFeeCents) throw fail.invalid(`Les frais de livraison doivent être d’au moins ${eur(bounds.minFeeCents)}.`);
  if (bounds.maxFeeCents != null && data.feeCents > bounds.maxFeeCents) throw fail.invalid(`Les frais de livraison sont limités à ${eur(bounds.maxFeeCents)} par GoLink.`);
  if (data.minOrderCents != null && bounds.minOrderFloorCents != null && data.minOrderCents < bounds.minOrderFloorCents) {
    throw fail.invalid(`Le minimum de commande doit être d’au moins ${eur(bounds.minOrderFloorCents)}.`);
  }
  if (data.minOrderCents != null && bounds.minOrderCeilingCents != null && data.minOrderCents > bounds.minOrderCeilingCents) {
    throw fail.invalid(`Le minimum de commande est limité à ${eur(bounds.minOrderCeilingCents)} par GoLink.`);
  }
  const center = restaurant.address.geo ? { lat: restaurant.address.geo.latitude, lng: restaurant.address.geo.longitude } : null;
  if (!center) throw fail.precondition('Renseignez d’abord l’adresse de l’établissement (rubrique Établissement).');

  if (data.type === 'radius' && (data.radiusMeters ?? 0) > maxRadius) {
    throw fail.invalid(`Le rayon de livraison est limité à ${(maxRadius / 1000).toLocaleString('fr-FR')} km pour votre établissement.`);
  }
  if (data.type === 'polygon') {
    const far = (data.polygon ?? []).some((p) => haversineMeters(center, p) > maxRadius);
    if (far) throw fail.invalid(`Le tracé dépasse le rayon de ${(maxRadius / 1000).toLocaleString('fr-FR')} km autorisé pour votre établissement.`);
  }
  if (data.freeAboveCents != null && data.minOrderCents != null && data.freeAboveCents < data.minOrderCents) {
    throw fail.invalid('La livraison offerte doit démarrer au-dessus du minimum de commande.');
  }

  const col = restaurantRef(data.restaurantId).collection(SUBCOLLECTIONS.restaurants.deliveryZones);
  const now = Timestamp.now();
  const uid = actor.caller.uid;
  const fields = {
    name: data.name,
    type: data.type,
    radiusMeters: data.type === 'radius' ? data.radiusMeters : null,
    polygon: data.type === 'polygon' ? data.polygon : null,
    feeCents: data.feeCents,
    minOrderCents: data.minOrderCents ?? null,
    freeAboveCents: data.freeAboveCents ?? null,
    deliveryMinutes: data.deliveryMinutes ?? null,
    enabled: data.enabled,
    color: data.color,
  };

  let zoneId = data.zoneId;
  let before: Record<string, unknown> | null = null;
  if (zoneId) {
    const snap = await col.doc(zoneId).get();
    if (!snap.exists) throw fail.notFound('Zone');
    before = snap.data() as Record<string, unknown>;
    await col.doc(zoneId).update({ ...fields, ...(data.order !== undefined ? { order: data.order } : {}), updatedAt: now, updatedBy: uid });
  } else {
    const existing = await col.count().get();
    if (existing.data().count >= MAX_ZONES) throw fail.precondition(`${MAX_ZONES} zones au maximum par établissement.`);
    const ref = col.doc();
    zoneId = ref.id;
    const zone: RestaurantDeliveryZone = {
      ...fields,
      order: data.order ?? existing.data().count,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    } as RestaurantDeliveryZone;
    await ref.set(zone);
  }

  await writeAudit({
    actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
    action: before ? 'restaurant.delivery_zone_updated' : 'restaurant.delivery_zone_created',
    target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
    before: before ? { name: before.name, feeCents: before.feeCents, enabled: before.enabled, type: before.type, radiusMeters: before.radiusMeters ?? null } : null,
    after: { zoneId, name: fields.name, feeCents: fields.feeCents, enabled: fields.enabled, type: fields.type, radiusMeters: fields.radiusMeters ?? null },
    countryId: restaurant.countryId,
    cityId: restaurant.cityId,
    request,
  });
  return { zoneId };
},
  CONFIG_FUNCTION_OPTIONS,
);

export const deleteDeliveryZone = callable(
  z.object({ restaurantId: zId, zoneId: zId }),
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'zones.manage', 'restaurants.edit');
    const rRef = restaurantRef(data.restaurantId);
    const zoneRef = rRef.collection(SUBCOLLECTIONS.restaurants.deliveryZones).doc(data.zoneId);
    const now = Timestamp.now();
    const restaurant = await db.runTransaction(async (tx) => {
      const [rSnap, zSnap, enabledSnap] = await Promise.all([
        tx.get(rRef),
        tx.get(zoneRef),
        tx.get(rRef.collection(SUBCOLLECTIONS.restaurants.deliveryZones).where('enabled', '==', true)),
      ]);
      if (!rSnap.exists) throw fail.notFound('Restaurant');
      if (!zSnap.exists) throw fail.notFound('Zone');
      const r = rSnap.data() as { name: string; countryId: string; cityId: string; deliveredBy: string; fulfillmentModes: string[] };
      const zone = zSnap.data() as RestaurantDeliveryZone;
      const lastEnabled = zone.enabled && enabledSnap.docs.filter((d) => d.id !== data.zoneId).length === 0;
      if (lastEnabled && r.deliveredBy === 'restaurant' && r.fulfillmentModes.includes('delivery')) {
        throw fail.precondition('C’est votre dernière zone active : vos livreurs n’auraient plus de secteur. Changez d’abord le mode de livraison.');
      }
      const trash: TrashItem = {
        entity: { type: 'other', id: data.zoneId, label: zone.name },
        path: zoneRef.path,
        snapshot: zone as unknown as Record<string, unknown>,
        children: [],
        restaurantId: data.restaurantId,
        deletedBy: actor.caller.uid,
        deletedAt: now,
        reason: null,
        purgeAt: Timestamp.fromMillis(now.toMillis() + TRASH_RETENTION_DAYS * 86_400_000),
        restoredAt: null,
        restoredBy: null,
      };
      tx.set(db.collection(COLLECTIONS.trash).doc(), trash);
      tx.delete(zoneRef);
      return { ...r, zoneName: zone.name };
    });

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: 'restaurant.delivery_zone_deleted',
      target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name },
      before: { zoneId: data.zoneId, name: restaurant.zoneName },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
    return { deleted: true };
  },
  CONFIG_FUNCTION_OPTIONS,
);
