// Inscription autonome d'un restaurant : compte du gérant, fiche en attente de
// validation, accès propriétaire, tâche « à valider » pour l'équipe interne.
// Une ville non desservie crée un prospect au lieu d'un restaurant.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  RESTAURANT_SETTINGS_DOCS,
  slugify,
  type City,
  type LegalAcceptance,
  type LegalDocument,
  type PlatformAlert,
  type Prospect,
  type RestaurantHours,
  type Zone,
} from '@golink/shared';
import { createHash } from 'node:crypto';
import { logger } from 'firebase-functions/v2';
import { buildUserProfile, ensureUserProfile, findUserByEmail } from '../lib/accounts';
import { auth, db, Timestamp } from '../lib/admin';
import { writeAudit } from '../lib/audit';
import { sendEmail } from '../lib/brevo';
import { callable } from '../lib/callable';
import { syncClaims } from '../lib/claims';
import { APP_URLS } from '../lib/config';
import { restaurantSignupReceivedEmail } from '../lib/emails';
import { fail } from '../lib/errors';
import { getCaller } from '../lib/permissions';
import {
  defaultWeeklyHours,
  loadMerchantDefaults,
  newCommercialDoc,
  newLegalDoc,
  newOrderSettings,
  newRestaurantDoc,
  ownerMemberDoc,
  zonesContaining,
} from '../lib/restaurants';
import { linkRestaurantReferral } from '../marketing/platform/referral-links';
import { isBlocked } from '../platform/fraud';
import { assertNotInMaintenance } from '../lib/platform-status';
import { currencyOfCountry } from '../lib/currency';
import { EMAIL_SECRETS } from '../lib/secrets';
import { z, zEmail, zName, zPassword, zPhone } from '../lib/validation';

const signupSchema = z.object({
  restaurant: z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    cuisineIds: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
    phone: zPhone,
    address: z.object({
      line1: z.string().trim().min(3).max(120),
      line2: z.string().trim().max(120).optional(),
      postalCode: z.string().trim().regex(/^(L-)?\d{4,5}$/, 'Code postal invalide'),
      city: z.string().trim().min(2).max(80),
      countryCode: z.enum(['FR', 'BE', 'LU', 'DZ', 'MA', 'TN']),
      placeId: z.string().trim().max(300).optional(),
      location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    }),
  }),
  owner: z.object({
    firstName: zName,
    lastName: zName,
    email: zEmail,
    phone: zPhone,
    /** Obligatoire sans session : le compte est créé avec ce mot de passe. */
    password: zPassword.optional(),
  }),
  legal: z.object({
    legalName: z.string().trim().min(2).max(120),
    /** SIRET (France, 14 chiffres) ou numéro RCS (Luxembourg). */
    registrationNumber: z.string().trim().min(5).max(20),
    vatNumber: z.string().trim().max(20).optional(),
  }),
  acceptTerms: z.literal(true, { message: 'Vous devez accepter les conditions partenaires' }),
  /** Code de parrainage d'un commerce Ciyou Eats (lien « ?parrain= »). */
  referralCode: z.string().trim().max(20).optional(),
});

type SignupInput = z.output<typeof signupSchema>;

async function findCity(countryId: string, cityName: string): Promise<(City & { id: string }) | null> {
  const snap = await db
    .collection(COLLECTIONS.cities)
    .where('countryId', '==', countryId)
    .where('slug', '==', slugify(cityName))
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? { ...(doc.data() as City), id: doc.id } : null;
}

async function currentTermsVersion(countryId: string): Promise<{ id: string | null; version: string }> {
  const snap = await db
    .collection(COLLECTIONS.legalDocuments)
    .where('type', '==', 'terms_restaurant')
    .where('countryId', '==', countryId)
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? { id: doc.id, version: (doc.data() as LegalDocument).version } : { id: null, version: 'non publiée' };
}

/** Anti-abus de la fonction publique : au plus 5 inscriptions par heure et par adresse IP (empreinte). */
async function assertSignupRateLimit(ip: string | undefined): Promise<void> {
  if (!ip) return;
  const hash = createHash('sha256').update(ip).digest('hex').slice(0, 24);
  const bucket = new Date().toISOString().slice(0, 13);
  const ref = db.collection('rateLimits').doc(`signup_${hash}_${bucket}`);
  await db.runTransaction(async (tx) => {
    const count = ((await tx.get(ref)).get('count') as number | undefined) ?? 0;
    if (count >= 5) throw fail.precondition('Trop de tentatives d’inscription depuis cette connexion. Réessayez dans une heure.');
    tx.set(ref, { count: count + 1, expiresAt: Timestamp.fromMillis(Date.now() + 2 * 3_600_000) });
  });
}

async function registerProspect(data: SignupInput): Promise<string> {
  const now = Timestamp.now();
  const prospect: Prospect = {
    name: data.restaurant.name,
    countryId: data.restaurant.address.countryCode,
    cityId: slugify(data.restaurant.address.city),
    address: {
      line1: data.restaurant.address.line1,
      line2: data.restaurant.address.line2 ?? null,
      postalCode: data.restaurant.address.postalCode,
      city: data.restaurant.address.city,
      countryCode: data.restaurant.address.countryCode,
    },
    cuisine: data.restaurant.cuisineIds[0] ?? null,
    contactName: `${data.owner.firstName} ${data.owner.lastName}`,
    contactEmail: data.owner.email,
    contactPhone: data.owner.phone,
    source: 'inbound',
    stage: 'to_contact',
    ownerId: 'unassigned',
    estimatedMonthlyOrders: null,
    nextFollowUpAt: null,
    lostReason: null,
    restaurantId: null,
    signedUpAt: null,
    notes: 'Inscription en ligne depuis une ville non desservie.',
    createdAt: now,
    createdBy: 'system',
    updatedAt: now,
    updatedBy: 'system',
  };
  const ref = await db.collection(COLLECTIONS.prospects).add(prospect);
  return ref.id;
}

export const restaurantSignup = callable(
  signupSchema,
  async (data, request) => {
    await assertSignupRateLimit(request.rawRequest?.ip);
    await assertNotInMaintenance('restaurant');
    // Liste de blocage (§28) : consultée avant toute création de compte ou de fiche.
    if ((await isBlocked('email', data.owner.email)) || (await isBlocked('phone', data.owner.phone))) {
      throw fail.forbidden('Cette inscription ne peut pas être finalisée. Contactez le support Ciyou Eats.');
    }
    const countryId = data.restaurant.address.countryCode;
    const city = await findCity(countryId, data.restaurant.address.city);
    if (!city?.active) {
      const prospectId = await registerProspect(data);
      return { status: 'waitlisted' as const, prospectId, restaurantId: null };
    }

    // Compte du gérant : session en cours, ou création avec le mot de passe fourni.
    const caller = getCaller(request);
    let uid: string;
    if (caller) {
      if (caller.email?.toLowerCase() !== data.owner.email) {
        throw fail.invalid("L'adresse e-mail doit être celle du compte connecté.");
      }
      uid = caller.uid;
    } else {
      if (!data.owner.password) throw fail.invalid('Choisissez un mot de passe.');
      if (await findUserByEmail(data.owner.email)) {
        throw fail.alreadyExists('Un compte existe déjà avec cette adresse : connectez-vous pour inscrire votre restaurant.');
      }
      const user = await auth.createUser({
        email: data.owner.email,
        password: data.owner.password,
        displayName: `${data.owner.firstName} ${data.owner.lastName}`,
      });
      uid = user.uid;
    }

    const zonesSnap = await db.collection(COLLECTIONS.zones).where('cityId', '==', city.id).get();
    const zones = zonesSnap.docs.map((d) => ({ ...(d.data() as Zone), id: d.id }));
    const location = data.restaurant.address.location ?? null;
    const address = {
      line1: data.restaurant.address.line1,
      line2: data.restaurant.address.line2 ?? null,
      postalCode: data.restaurant.address.postalCode,
      city: city.name,
      countryCode: countryId,
      placeId: data.restaurant.address.placeId ?? null,
    };
    const terms = await currentTermsVersion(countryId);
    const managerName = `${data.owner.firstName} ${data.owner.lastName}`;
    const [merchantDefaults, currency] = await Promise.all([loadMerchantDefaults(countryId, city.id), currencyOfCountry(countryId)]);

    const restaurantRef = db.collection(COLLECTIONS.restaurants).doc();
    const restaurant = newRestaurantDoc({
      name: data.restaurant.name,
      ownerId: uid,
      countryId,
      cityId: city.id,
      timezone: city.timezone,
      address,
      location,
      zoneIds: zonesContaining(location, zones),
      phone: data.restaurant.phone,
      email: data.owner.email,
      description: data.restaurant.description ?? null,
      cuisineIds: data.restaurant.cuisineIds,
      createdBy: uid,
      merchantDefaults,
      currency,
      // Session déjà ouverte, ou mot de passe choisi à l'instant : le propriétaire a déjà ses accès.
      ownerCredentialsDelivered: true,
    });
    const hours: RestaurantHours = { ...defaultWeeklyHours(city.timezone), updatedAt: Timestamp.now(), updatedBy: uid };
    const now = Timestamp.now();
    const alert: PlatformAlert = {
      kind: 'restaurant_to_validate',
      queue: 'todo',
      severity: 'info',
      title: `Nouveau restaurant à valider : ${data.restaurant.name}`,
      message: `${managerName} a inscrit ${data.restaurant.name} à ${city.name}.`,
      target: { type: 'restaurant', id: restaurantRef.id, label: data.restaurant.name },
      countryId,
      cityId: city.id,
      metric: null,
      status: 'open',
      dedupKey: `restaurant_to_validate_${restaurantRef.id}`,
      detectedAt: now,
    };
    const acceptance: LegalAcceptance = {
      userId: uid,
      userType: 'restaurant',
      restaurantId: restaurantRef.id,
      documentId: terms.id ?? 'terms_restaurant',
      documentType: 'terms_restaurant',
      version: terms.version,
      acceptedAt: now,
      ipHash: null,
      userAgent: request.rawRequest.get('user-agent')?.slice(0, 300) ?? null,
      signatureName: managerName,
    };

    const batch = db.batch();
    batch.set(restaurantRef, restaurant);
    batch.set(restaurantRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial), newCommercialDoc(uid));
    batch.set(
      restaurantRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal),
      newLegalDoc({
        legalName: data.legal.legalName,
        siret: data.legal.registrationNumber,
        vatNumber: data.legal.vatNumber ?? null,
        address,
        managerName,
        managerEmail: data.owner.email,
        managerPhone: data.owner.phone,
        termsVersion: terms.version,
      }),
    );
    batch.set(restaurantRef.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.orders), newOrderSettings(uid, merchantDefaults));
    batch.set(restaurantRef.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.hours), hours);
    batch.set(
      restaurantRef.collection(SUBCOLLECTIONS.restaurants.members).doc(uid),
      ownerMemberDoc({ uid, restaurantId: restaurantRef.id, displayName: managerName, email: data.owner.email }),
    );
    batch.set(db.collection(COLLECTIONS.platformAlerts).doc(alert.dedupKey), alert);
    batch.set(db.collection(COLLECTIONS.legalAcceptances).doc(), acceptance);
    await batch.commit();

    await ensureUserProfile(
      uid,
      buildUserProfile({
        role: 'restaurant',
        firstName: data.owner.firstName,
        lastName: data.owner.lastName,
        email: data.owner.email,
        emailVerified: false,
        phone: data.owner.phone,
        countryId,
        cityId: city.id,
      }),
    );
    await syncClaims(uid);

    // Parrainage entre commerces : le code du lien est rattaché (les auto-parrainages sont refusés).
    const referral = data.referralCode
      ? await linkRestaurantReferral(restaurantRef.id, data.referralCode).catch((error) => {
          logger.warn('Parrainage non rattaché', { restaurantId: restaurantRef.id, error: String(error) });
          return { applied: false as const, reason: 'error' };
        })
      : null;

    const email = await sendEmail({
      to: { email: data.owner.email, name: managerName },
      message: restaurantSignupReceivedEmail({
        firstName: data.owner.firstName,
        restaurantName: data.restaurant.name,
        city: city.name,
        link: `${APP_URLS.restaurant}/connexion`,
      }),
      recipientType: 'restaurant',
      recipientId: uid,
      templateKey: 'restaurant_signup_received',
    });

    await writeAudit({
      actor: { uid, type: 'restaurant', role: 'owner', name: managerName },
      action: 'restaurant.signup',
      target: { type: 'restaurant', id: restaurantRef.id, label: data.restaurant.name },
      after: { status: 'onboarding', onboardingStatus: 'pending', cityId: city.id },
      countryId,
      cityId: city.id,
      request,
    });
    return { status: 'pending' as const, restaurantId: restaurantRef.id, prospectId: null, emailSent: email.ok, referral: referral ? (referral.applied ? { applied: true as const, accepted: referral.status === 'pending' } : { applied: false as const, reason: referral.reason }) : null };
  },
  { secrets: EMAIL_SECRETS },
);
