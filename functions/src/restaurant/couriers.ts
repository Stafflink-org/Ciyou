// Livreurs vus par un restaurant : livreurs Ciyou Eats ayant déjà livré (préférences :
// disponible, écarté, bloqué) et livreurs propres de l'établissement (invitation,
// statut, zones de livraison du restaurant).
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  VEHICLE_LABELS,
  VEHICLE_TYPES,
  buildSearchKeywords,
  maskEmail,
  maskPhone,
  publicDisplayName,
  type Driver,
  type Restaurant,
  type RestaurantCourier,
  type UserProfile,
} from '@golink/shared';
import { buildUserProfile, ensureUserProfile, getOrCreateAuthUser } from '../lib/accounts';
import { auth, db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { sendEmail } from '../lib/brevo';
import { callable } from '../lib/callable';
import { syncClaims } from '../lib/claims';
import { APP_URLS, PLATFORM_NAME } from '../lib/config';
import { renderEmail } from '../lib/email-layout';
import type { EmailMessage } from '../lib/emails';
import { fail } from '../lib/errors';
import { requireRestaurantAccess } from '../lib/permissions';
import { EMAIL_SECRETS } from '../lib/secrets';
import { z, zEmail, zId, zName, zPhone, zReason } from '../lib/validation';

function courierRef(restaurantId: string, driverId: string) {
  return db
    .collection(COLLECTIONS.restaurants)
    .doc(restaurantId)
    .collection(SUBCOLLECTIONS.restaurants.couriers)
    .doc(driverId);
}

/** Vérifie que les zones appartiennent bien aux zones de livraison propres du restaurant. */
async function assertRestaurantZones(restaurantId: string, zoneIds: string[]): Promise<void> {
  if (zoneIds.length === 0) return;
  const zones = db.collection(COLLECTIONS.restaurants).doc(restaurantId).collection(SUBCOLLECTIONS.restaurants.deliveryZones);
  const snaps = await db.getAll(...zoneIds.map((id) => zones.doc(id)));
  if (snaps.some((snap) => !snap.exists)) throw fail.invalid('Une des zones choisies n’existe plus. Actualisez la page.');
}

function ownCourierInvitationEmail(input: {
  firstName: string;
  restaurantName: string;
  inviterName: string;
  vehicle: string;
  link: string;
  newAccount: boolean;
}): EmailMessage {
  return {
    subject: `${input.restaurantName} vous invite à livrer avec ${PLATFORM_NAME}`,
    ...renderEmail({
      preheader: `Rejoignez les livreurs de ${input.restaurantName} sur l'application ${PLATFORM_NAME} Livreur.`,
      eyebrow: 'Invitation livreur',
      title: `Livrez pour ${input.restaurantName}`,
      paragraphs: [
        `Bonjour ${input.firstName},`,
        `${input.inviterName} vous ajoute aux livreurs de ${input.restaurantName}. Vous recevrez les courses de l'établissement directement dans l'application ${PLATFORM_NAME} Livreur.`,
        input.newAccount
          ? 'Choisissez d’abord votre mot de passe, puis connectez-vous dans l’application avec cette adresse e-mail pour compléter votre profil.'
          : 'Connectez-vous dans l’application avec votre compte habituel : l’établissement apparaîtra dans vos employeurs.',
      ],
      details: [
        { label: 'Établissement', value: input.restaurantName },
        { label: 'Véhicule déclaré', value: input.vehicle },
      ],
      cta: input.newAccount ? { label: 'Choisir mon mot de passe', url: input.link } : undefined,
      note: input.newAccount
        ? 'Ce lien est personnel et expire dans une heure. Passé ce délai, utilisez « Mot de passe oublié » dans l’application.'
        : 'Si vous ne connaissez pas cet établissement, ignorez simplement cet e-mail.',
      footerReason: `Vous recevez cet e-mail car ${input.inviterName} a saisi votre adresse dans le back-office de ${input.restaurantName}.`,
    }),
  };
}

async function passwordLink(email: string): Promise<string> {
  const actionLink = await auth.generatePasswordResetLink(email);
  const oobCode = new URL(actionLink).searchParams.get('oobCode');
  if (!oobCode) throw fail.internal();
  const link = new URL('/definir-mot-de-passe', APP_URLS.restaurant);
  link.searchParams.set('oobCode', oobCode);
  return link.toString();
}

// ------------------------------------------------------------------ Invitation

const inviteOwnCourierSchema = z.object({
  restaurantId: zId,
  firstName: zName,
  lastName: zName,
  email: zEmail,
  phone: zPhone,
  vehicle: z.enum(VEHICLE_TYPES),
  zoneIds: z.array(zId).max(20).default([]),
});

/**
 * Invite un livreur propre : compte Ciyou Eats (créé si besoin), profil livreur de type
 * « restaurant » rattaché à l'établissement, fiche livreur du restaurant, e-mail
 * d'activation. Rejouable tant que l'invitation n'a pas été acceptée (renvoi).
 */
export const inviteOwnCourier = callable(
  inviteOwnCourierSchema,
  async (data, request) => {
    const actor = await requireRestaurantAccess(request, data.restaurantId, 'couriers.manage', 'drivers.edit');
    const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get();
    if (!restaurantSnap.exists) throw fail.notFound('Restaurant');
    const restaurant = restaurantSnap.data() as Restaurant;
    await assertRestaurantZones(data.restaurantId, data.zoneIds);

    const displayName = `${data.firstName} ${data.lastName}`;
    const { user, created } = await getOrCreateAuthUser({ email: data.email, displayName });
    const driverRef = db.collection(COLLECTIONS.drivers).doc(user.uid);
    const ref = courierRef(data.restaurantId, user.uid);

    const [driverSnap, userSnap, courierSnap] = await Promise.all([
      driverRef.get(),
      db.collection(COLLECTIONS.users).doc(user.uid).get(),
      ref.get(),
    ]);
    const existingRole = userSnap.exists ? (userSnap.data() as UserProfile).role : null;
    if (existingRole === 'admin' || existingRole === 'restaurant') {
      throw fail.precondition('Cette adresse appartient à un compte professionnel Ciyou Eats. Utilisez une adresse personnelle du livreur.');
    }
    if (driverSnap.exists && (driverSnap.data() as Driver).type === 'platform') {
      throw fail.precondition('Ce livreur travaille déjà avec la flotte Ciyou Eats : il ne peut pas devenir livreur propre de l’établissement.');
    }
    if (courierSnap.exists) {
      const current = courierSnap.data() as RestaurantCourier;
      if (current.relation === 'own' && current.invitation?.status !== 'pending') {
        throw fail.alreadyExists('Ce livreur fait déjà partie de vos livreurs.');
      }
    }

    const now = Timestamp.now();
    if (driverSnap.exists) {
      await driverRef.update({ restaurantIds: FieldValue.arrayUnion(data.restaurantId), updatedAt: now, updatedBy: actor.caller.uid });
    } else {
      const driver: Driver = {
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName,
        phone: data.phone,
        email: data.email,
        avatar: null,
        type: 'restaurant',
        restaurantIds: [data.restaurantId],
        vehicle: { type: data.vehicle, plate: null, model: null, color: null },
        zoneIds: [],
        status: 'onboarding',
        onboardingStatus: 'draft',
        rejectionReason: null,
        availability: 'offline',
        activeOrderIds: [],
        acceptsCash: false,
        rating: { average: 0, count: 0 },
        stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
        documentsValidUntil: null,
        lastIdentityCheckAt: null,
        lastSeenAt: null,
        searchKeywords: buildSearchKeywords(displayName, data.email, data.phone),
        createdAt: now,
        createdBy: actor.caller.uid,
        updatedAt: now,
        updatedBy: actor.caller.uid,
      };
      await driverRef.set(driver);
    }
    await ensureUserProfile(
      user.uid,
      buildUserProfile({
        role: 'driver',
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        emailVerified: user.emailVerified,
        phone: data.phone,
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
      }),
    );
    await syncClaims(user.uid, 'driver');

    const link = created ? await passwordLink(data.email) : APP_URLS.restaurant;
    const email = await sendEmail({
      to: { email: data.email, name: displayName },
      message: ownCourierInvitationEmail({
        firstName: data.firstName,
        restaurantName: restaurant.name,
        inviterName: actor.caller.name,
        vehicle: VEHICLE_LABELS[data.vehicle],
        link,
        newAccount: created,
      }),
      recipientType: 'driver',
      recipientId: user.uid,
      templateKey: 'restaurant_courier_invitation',
    });

    const previous = courierSnap.exists ? (courierSnap.data() as RestaurantCourier) : null;
    const courier: RestaurantCourier = {
      driverId: user.uid,
      displayName: publicDisplayName(data.firstName, data.lastName),
      relation: 'own',
      status: previous?.status ?? 'active',
      note: previous?.note ?? null,
      deliveriesCount: previous?.deliveriesCount ?? 0,
      lastDeliveryAt: previous?.lastDeliveryAt ?? null,
      emailMasked: maskEmail(data.email),
      phoneMasked: maskPhone(data.phone),
      vehicle: data.vehicle,
      zoneIds: data.zoneIds,
      invitation: { status: 'pending', sentAt: now, sentBy: actor.caller.uid, emailSent: email.ok },
      blockedReason: previous?.blockedReason ?? null,
      updatedAt: now,
      updatedBy: actor.caller.uid,
    };
    await ref.set(courier);

    await writeAudit({
      actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
      action: previous ? 'restaurant.courier_reinvited' : 'restaurant.courier_invited',
      target: { type: 'driver', id: user.uid, label: displayName },
      after: { restaurantId: data.restaurantId, vehicle: data.vehicle, zoneIds: data.zoneIds, newAccount: created },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
    return { driverId: user.uid, newAccount: created, emailSent: email.ok, resent: Boolean(previous) };
  },
  { secrets: EMAIL_SECRETS },
);

// ------------------------------------------------------------------ Statut, note, zones

const updateCourierSchema = z
  .object({
    restaurantId: zId,
    driverIds: z.array(zId).min(1).max(50),
    status: z.enum(['active', 'inactive', 'blocked']).optional(),
    reason: zReason.nullish(),
    note: z.string().trim().max(500).nullable().optional(),
    zoneIds: z.array(zId).max(20).optional(),
  })
  .refine((data) => data.status !== 'blocked' || Boolean(data.reason), { message: 'Indiquez le motif du blocage.', path: ['reason'] })
  .refine((data) => data.status !== undefined || data.note !== undefined || data.zoneIds !== undefined, {
    message: 'Aucune modification demandée.',
  });

/**
 * Met à jour un ou plusieurs livreurs du restaurant. Un livreur bloqué n'est plus
 * proposé pour les commandes de l'établissement ; un livreur indisponible est
 * simplement écarté. Les zones ne concernent que les livreurs propres.
 */
export const updateCourier = callable(updateCourierSchema, async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'couriers.manage', 'drivers.edit');
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get();
  if (!restaurantSnap.exists) throw fail.notFound('Restaurant');
  const restaurant = restaurantSnap.data() as Restaurant;
  if (data.zoneIds) await assertRestaurantZones(data.restaurantId, data.zoneIds);
  const ids = [...new Set(data.driverIds)];

  const changes = await db.runTransaction(async (tx) => {
    const refs = ids.map((id) => courierRef(data.restaurantId, id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    if (snaps.some((snap) => !snap.exists)) throw fail.notFound('Livreur');
    const now = Timestamp.now();
    const result: Array<{ id: string; name: string; from: RestaurantCourier['status']; to: RestaurantCourier['status'] }> = [];
    snaps.forEach((snap, index) => {
      const ref = refs[index];
      if (!ref) return;
      const current = snap.data() as RestaurantCourier;
      if (data.zoneIds && current.relation !== 'own') {
        throw fail.precondition('Les zones ne s’attribuent qu’aux livreurs propres de l’établissement.');
      }
      const update: Record<string, unknown> = { updatedAt: now, updatedBy: actor.caller.uid };
      if (data.status && data.status !== current.status) {
        update.status = data.status;
        update.blockedReason = data.status === 'blocked' ? (data.reason ?? null) : null;
        result.push({ id: snap.id, name: current.displayName, from: current.status, to: data.status });
      }
      if (data.note !== undefined) update.note = data.note || null;
      if (data.zoneIds) update.zoneIds = data.zoneIds;
      tx.update(ref, update);
    });
    return result;
  });

  await Promise.all(
    changes.map((change) =>
      writeAudit({
        actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'),
        action: change.to === 'blocked' ? 'restaurant.courier_blocked' : 'restaurant.courier_status_changed',
        target: { type: 'driver', id: change.id, label: change.name },
        reason: data.reason ?? null,
        before: { status: change.from },
        after: { status: change.to, restaurantId: data.restaurantId, restaurantName: restaurant.name },
        countryId: restaurant.countryId,
        cityId: restaurant.cityId,
        request,
      }),
    ),
  );
  return { updated: ids.length, statusChanged: changes.length };
});
