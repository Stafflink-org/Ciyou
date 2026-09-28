// Valeurs initiales d'un établissement créé par inscription ou par l'équipe interne.
import {
  COLLECTIONS,
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  SETTINGS_DOCS,
  buildSearchKeywords,
  encodeGeohash,
  isPointInPolygon,
  resolveMerchantDefaults,
  slugify,
  type City,
  type Country,
  type CurrencyCode,
  type LatLng,
  type MerchantDefaults,
  type OrderRules,
  type PostalAddress,
  type Restaurant,
  type RestaurantCommercial,
  type RestaurantLegal,
  type RestaurantMember,
  type RestaurantOrderSettings,
  type WeeklyHours,
  type Zone,
} from '@golink/shared';
import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';

/**
 * Valeurs initiales d'un nouveau commerce (H3, préavis §2.3) : lues en base — réglages
 * plateforme (`settings/orderRules`), puis pays, puis ville, la plus précise l'emportant
 * (repli documenté dans `resolveMerchantDefaults`/`DEFAULT_MERCHANT_DEFAULTS` si aucun
 * document n'existe encore). À appeler avant `newRestaurantDoc`/`newOrderSettings`.
 */
export async function loadMerchantDefaults(countryId: string, cityId: string): Promise<MerchantDefaults> {
  const [platformSnap, countrySnap, citySnap] = await Promise.all([
    db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.orderRules).get(),
    db.collection(COLLECTIONS.countries).doc(countryId).get(),
    db.collection(COLLECTIONS.cities).doc(cityId).get(),
  ]);
  const platform = platformSnap.exists ? (platformSnap.data() as Partial<OrderRules>) : null;
  const country = countrySnap.exists ? ((countrySnap.data() as Country).orderRules ?? null) : null;
  const city = citySnap.exists ? ((citySnap.data() as City).orderRules ?? null) : null;
  return resolveMerchantDefaults(platform, country, city);
}

/** Horaires par défaut : midi et soir en semaine, dimanche fermé. */
export function defaultWeeklyHours(timezone: string): WeeklyHours {
  const weekday = [{ from: '11:30', to: '14:30' }, { from: '18:30', to: '22:30' }];
  return {
    days: [
      { day: 0, open: true, slots: weekday },
      { day: 1, open: true, slots: weekday },
      { day: 2, open: true, slots: weekday },
      { day: 3, open: true, slots: weekday },
      { day: 4, open: true, slots: [{ from: '11:30', to: '14:30' }, { from: '18:30', to: '23:00' }] },
      { day: 5, open: true, slots: [{ from: '12:00', to: '23:00' }] },
      { day: 6, open: false, slots: [] },
    ],
    exceptions: [],
    timezone,
  };
}

/** Initiales pour le monogramme affiché sans logo (« Mina Kitchen » → « MK »). */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [name.slice(0, 2)];
  return letters.join('').toUpperCase();
}

/** Zones de la ville contenant le point. */
export function zonesContaining(point: LatLng | null, zones: Array<Zone & { id: string }>): string[] {
  if (!point) return [];
  return zones.filter((z) => z.active && isPointInPolygon(point, z.polygon)).map((z) => z.id);
}

export interface NewRestaurantInput {
  name: string;
  ownerId: string;
  countryId: string;
  cityId: string;
  timezone: string;
  address: Omit<PostalAddress, 'geo' | 'geohash'>;
  location: LatLng | null;
  zoneIds: string[];
  phone: string;
  email: string;
  description?: string | null;
  cuisineIds?: string[];
  createdBy: string;
  /** Valeurs initiales (préparation, minimum) — `loadMerchantDefaults(countryId, cityId)` ; repli si omises. */
  merchantDefaults?: MerchantDefaults;
  /** Devise du compte (`currencyOfCountry(countryId)`) ; repli EUR si omise. */
  currency?: CurrencyCode;
  /** Le propriétaire a-t-il déjà (ou va-t-il aussitôt) reçu de quoi accéder à son compte ? Défaut : true (inscription en ligne). */
  ownerCredentialsDelivered?: boolean;
}

export function newRestaurantDoc(input: NewRestaurantInput): Restaurant {
  const now = Timestamp.now();
  const md = input.merchantDefaults ?? resolveMerchantDefaults(null, null, null);
  return {
    name: input.name,
    slug: slugify(`${input.name}-${input.address.city}`),
    groupId: null,
    ownerId: input.ownerId,
    countryId: input.countryId,
    cityId: input.cityId,
    zoneIds: input.zoneIds,
    address: {
      ...input.address,
      geo: input.location ? new GeoPoint(input.location.lat, input.location.lng) : null,
      geohash: input.location ? encodeGeohash(input.location) : null,
    },
    phone: input.phone,
    email: input.email,
    description: input.description ?? null,
    cuisineIds: input.cuisineIds ?? [],
    tags: [],
    priceLevel: 2,
    logo: null,
    cover: null,
    photos: [],
    accent: '#19343b',
    mark: monogram(input.name),
    status: 'onboarding',
    onboardingStatus: 'pending',
    isOpen: false,
    acceptingOrders: false,
    visibleInApp: true,
    busyExtraMinutes: 0,
    fulfillmentModes: ['delivery', 'pickup'],
    deliveredBy: 'platform',
    minOrderCents: md.minOrderCents,
    ownDeliveryFeeCents: null,
    ownDeliveryRadiusMeters: null,
    prepMinutes: md.prepMinutes,
    etaMinutes: { min: 25, max: 40 },
    rating: { average: 0, count: 0 },
    hoursSummary: defaultWeeklyHours(input.timezone),
    planCode: 'basic',
    sponsored: false,
    rankingScore: 0,
    qualityScore: 100,
    allergensComplete: false,
    sellsAlcohol: false,
    acceptedPaymentMethods: ['card', 'apple_pay', 'google_pay'],
    ordersCount: 0,
    searchKeywords: buildSearchKeywords(input.name, input.address.city, input.address.postalCode, input.email, input.phone),
    launchedAt: null,
    suspension: null,
    currency: input.currency ?? 'EUR',
    ownerCredentialsDelivered: input.ownerCredentialsDelivered ?? true,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
    updatedBy: input.createdBy,
  };
}

/** Motif du blocage des reversements tant que le compte Stripe n'est pas activé. */
export const STRIPE_PENDING_REASON = 'Compte de paiement Stripe à activer.';

export function newCommercialDoc(updatedBy: string): RestaurantCommercial {
  return {
    planCode: 'basic',
    subscriptionId: null,
    subscriptionStatus: 'active',
    negotiatedCommission: null,
    specialOffer: null,
    allowedPaymentMethods: ['card', 'apple_pay', 'google_pay'],
    deliveryFeeOverrideCents: null,
    minOrderOverrideCents: null,
    payoutFrequency: null,
    payoutsBlocked: true,
    payoutsBlockedReason: STRIPE_PENDING_REASON,
    stripeAccountId: null,
    stripeAccountStatus: null,
    updatedAt: Timestamp.now(),
    updatedBy,
  };
}

export function newLegalDoc(input: {
  legalName: string;
  siret: string;
  vatNumber?: string | null;
  address: PostalAddress;
  managerName: string;
  managerEmail: string;
  managerPhone: string;
  termsVersion: string;
}): RestaurantLegal {
  const now = Timestamp.now();
  return {
    legalName: input.legalName,
    legalForm: null,
    siret: input.siret,
    vatNumber: input.vatNumber ?? null,
    registeredAddress: input.address,
    managerName: input.managerName,
    managerEmail: input.managerEmail,
    managerPhone: input.managerPhone,
    managerBirthDate: null,
    ibanMasked: null,
    alcoholLicenseNumber: null,
    taxIdentificationNumber: null,
    dac7Complete: false,
    partnerTermsVersion: input.termsVersion,
    partnerTermsAcceptedAt: now,
    updatedAt: now,
  };
}

/** `merchantDefaults` : `loadMerchantDefaults(countryId, cityId)` ; repli documenté si omis (nouveau marché sans réglage propre). */
export function newOrderSettings(updatedBy: string, merchantDefaults?: MerchantDefaults): RestaurantOrderSettings {
  const md = merchantDefaults ?? resolveMerchantDefaults(null, null, null);
  return {
    prepMinutes: md.prepMinutes,
    maxConcurrentOrders: md.maxConcurrentOrders,
    minOrderCents: md.minOrderCents,
    delivery: true,
    pickup: true,
    dineIn: false,
    autoAccept: false,
    scheduledOrders: false,
    autoPrint: false,
    pickupInstructions: null,
    scheduledLeadMinutes: md.scheduledLeadMinutes,
    scheduledMaxDays: md.scheduledMaxDays,
    updatedAt: Timestamp.now(),
    updatedBy,
  };
}

export function ownerMemberDoc(input: {
  uid: string;
  restaurantId: string;
  displayName: string;
  email: string;
}): RestaurantMember {
  const now = Timestamp.now();
  return {
    uid: input.uid,
    restaurantId: input.restaurantId,
    groupId: null,
    displayName: input.displayName,
    email: input.email,
    role: 'owner',
    customRoleId: null,
    permissions: [...DEFAULT_STAFF_ROLE_PERMISSIONS.owner],
    active: true,
    onDuty: false,
    employeeId: null,
    invitedBy: input.uid,
    invitedAt: now,
    joinedAt: now,
    lastAccessAt: now,
  };
}
