// Plateforme : réglages, marchés (pays, villes, zones), fonctionnalités,
// intégrations, affichage de l'app client, formules, rôles internes, contenus légaux.
import {
  ADMIN_ROLE_LABELS,
  ADMIN_ROLES,
  COLLECTIONS,
  DEFAULT_ADMIN_ROLE_PERMISSIONS,
  ALCOHOL_POLICY,
  APP_LOCALES,
  CLIENT_DECISIONS,
  DEFAULT_ORDER_RULES,
  DEFAULT_PLANS,
  DEFAULT_PRICING_BY_COUNTRY,
  DEFAULT_PRICING_FR,
  DEFAULT_PRICING_LU,
  DEFAULT_REFUND_LIMITS,
  FEATURE_KEYS,
  FEATURE_LABELS,
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_TYPES,
  ROLES_WITH_MASKED_DATA,
  SERVICE_KEYS,
  SETTINGS_DOCS,
  LAUNCH_MARKETS,
  VAT_DEFAULTS_TO_VALIDATE,
  polygonBounds,
  type AdminRoleDefinition,
  type AppVersionPolicy,
  type Banner,
  type City,
  type CommissionRule,
  type ContentPage,
  type Counter,
  type Country,
  type CuisineCategory,
  type FeatureFlag,
  type HelpArticle,
  type HomeSection,
  type Incident,
  type LatLng,
  type LegalDocument,
  type OrderRules,
  type PaymentMethod,
  type Plan,
  type PlatformIntegration,
  type ServiceStatus,
  type SurgeRule,
  type WeeklyHours,
  type Zone,
} from '@golink/shared';
import { BANNER_PHOTOS, CITIES, CUISINES, RESTAURANTS, ZONE_LAYOUT, unsplash } from './catalog';
import { tracked, type SeedContext } from './context';
import { addDays, offsetPoint, parisTime, ts, type Timestamp } from './lib';

// Décisions du client (docs/DECISIONS_CLIENT.md) : titres-restaurant désactivés ;
// espèces proposées seulement avec un livreur salarié du commerce (isCashAllowed).
const PAYMENT_METHODS: Record<PaymentMethod, boolean> = {
  card: true,
  apple_pay: true,
  google_pay: true,
  cash: true,
  meal_voucher: false,
  wallet: true,
};

/** Règles de commande : valeurs des décisions du client (acceptation 5 min, pause après 3 manquées, client absent 10 min…). */
export const ORDER_RULES: OrderRules = DEFAULT_ORDER_RULES;

/** Fonctionnalités éteintes par défaut ; `alcohol_sales` est en plus verrouillée. */
const DISABLED_FEATURES = new Set<string>(['dine_in', 'pos_integration', 'live_chat', 'meal_voucher', 'alcohol_sales', 'loyalty']);
const LOCKED_FEATURES = new Set<string>([ALCOHOL_POLICY.featureKey]);

/**
 * Documents `settings/*` issus des décisions du client (sans traçabilité). Utilisé par
 * le seed complet et par scripts/seed/only/decisions-client.ts.
 */
export function platformSettingsDocs(): Record<string, object> {
  return {
    [SETTINGS_DOCS.general]: {
      platformName: 'Ciyou Eats',
      legalEntityName: 'Ciyou Eats SAS',
      supportEmail: 'support@golink.fr',
      supportPhone: '+33 3 82 00 00 00',
      defaultCountryId: 'FR',
      defaultLocale: 'fr',
      defaultTimezone: 'Europe/Paris',
      currency: 'EUR',
      supportedLocales: [...APP_LOCALES],
    },
    [SETTINGS_DOCS.orderRules]: ORDER_RULES,
    [SETTINGS_DOCS.payments]: {
      methods: PAYMENT_METHODS,
      tips: { enabled: CLIENT_DECISIONS.tipsEnabled, presetsCents: [100, 200, 300, 500], maxCents: 5000 },
      cash: { enabled: true, driverCashLimitCents: 15000, merchantDriversOnly: CLIENT_DECISIONS.cashRequiresMerchantCourier },
      failedPaymentRetry: { maxAttempts: 3 },
    },
    [SETTINGS_DOCS.loyalty]: {
      enabled: CLIENT_DECISIONS.loyaltyEnabled,
      pointsPerEuro: 1,
      welcomePoints: 50,
      rewards: [
        { points: 200, valueCents: 300 },
        { points: 500, valueCents: 1000 },
      ],
      pointsValidityDays: 365,
      allowRestaurantPrograms: true,
    },
    [SETTINGS_DOCS.referral]: {
      client: { enabled: false, referrerRewardCents: 500, refereeRewardCents: 500, minFirstOrderCents: 1500 },
      restaurant: {
        enabled: true,
        rewardCents: CLIENT_DECISIONS.merchantReferralAdCreditCents,
        qualifyingOrders: 0,
        rewardType: 'ad_credit',
      },
      driver: { enabled: false, rewardCents: 5000, qualifyingDeliveries: 50 },
    },
    [SETTINGS_DOCS.promotions]: {
      capsEnabled: CLIENT_DECISIONS.merchantPromotionCapsEnabled,
      restaurantMaxPercentBps: 10_000,
      restaurantMaxFixedCents: 1500,
      restaurantRequiresReview: false,
      maxActivePerRestaurant: 3,
    },
    [SETTINGS_DOCS.payouts]: {
      restaurants: { frequency: 'weekly', dayOfWeek: 1, minimumCents: 1000, delayDays: 2 },
      drivers: { frequency: 'weekly', dayOfWeek: 1, minimumCents: 500, delayDays: 1 },
    },
  };
}

/** Entités de facturation connues ; les autres pays restent à compléter dans le super admin. */
const BILLING_ENTITIES: Record<string, Country['billingEntity']> = {
  FR: { legalName: 'Ciyou Eats SAS', vatNumber: 'FR 12 912 345 678', registrationNumber: 'RCS Briey 912 345 678', address: '4 Place Darche, 54400 Longwy', invoicePrefix: 'FR' },
  LU: { legalName: 'Ciyou Eats Luxembourg SARL', vatNumber: 'LU 34567890', registrationNumber: 'RCS Luxembourg B 281 234', address: '12 Rue du Fossé, L-1536 Luxembourg', invoicePrefix: 'LU' },
};

/** Pays de lancement : FR, BE, LU, DZ, MA, TN (seuls FR et LU sont ouverts ; lancement ville par ville). */
export function countryDocs(nowTs: Timestamp, by: string): Array<Country & { id: string }> {
  return LAUNCH_MARKETS.map((m) => ({
    id: m.code,
    code: m.code,
    name: m.name,
    active: m.code === 'FR' || m.code === 'LU',
    currency: m.currency,
    vatValidated: false,
    vatNote: VAT_DEFAULTS_TO_VALIDATE[m.code] ?? null,
    stripeAvailable: m.stripeAvailable,
    locales: [...m.locales],
    defaultLocale: m.defaultLocale,
    timezone: m.timezone,
    phonePrefix: m.phonePrefix,
    pricing: DEFAULT_PRICING_BY_COUNTRY[m.code]!,
    orderRules: null,
    paymentMethods: m.stripeAvailable ? PAYMENT_METHODS : { ...PAYMENT_METHODS, apple_pay: false, google_pay: false },
    billingEntity: BILLING_ENTITIES[m.code] ?? {
      legalName: 'À compléter',
      vatNumber: '',
      registrationNumber: '',
      address: '',
      invoicePrefix: m.code,
    },
    legal: { dac7Authority: m.dac7Authority, requiresDriverUrssaf: m.code === 'FR', alcoholMinimumAge: 18 },
    ...tracked(nowTs, by),
  }));
}

/** Formules Basic, Pro, Premium : vides (prix 0, sans contenu) mais entièrement paramétrables. */
export function planDocs(nowTs: Timestamp, by: string): Array<Plan & { id: string }> {
  return DEFAULT_PLANS.map((p, order) => ({
    id: p.code,
    code: p.code,
    name: p.name,
    description: '',
    active: true,
    countryIds: LAUNCH_MARKETS.map((m) => m.code),
    monthlyPriceHtCents: p.monthlyPriceHtCents,
    yearlyPriceHtCents: p.yearlyPriceHtCents ?? null,
    trialDays: p.trialDays,
    billingMode: p.billingMode ?? 'commission',
    commitmentMonths: p.commitmentMonths ?? 0,
    cardRequired: p.cardRequired ?? false,
    gracePeriodDays: p.gracePeriodDays ?? 0,
    commission: { ...p.commission },
    rankingBoost: p.rankingBoost,
    maxDeliveryRadiusMeters: p.maxDeliveryRadiusMeters,
    includedOutlets: p.includedOutlets,
    features: [...p.features],
    limits: { ...(p.limits ?? {}) },
    order,
    stripePriceId: null,
    ...tracked(nowTs, by),
  }));
}

/** Interrupteurs de fonctionnalités (alcool éteint et verrouillé, titres-restaurant éteints). */
export function featureFlagDocs(nowTs: Timestamp, by: string): FeatureFlag[] {
  return FEATURE_KEYS.map((key) => ({
    key,
    description: FEATURE_LABELS[key],
    enabled: !DISABLED_FEATURES.has(key),
    ...(LOCKED_FEATURES.has(key) ? { locked: true } : {}),
    overrides: key === 'restaurant_own_drivers' ? [{ scope: 'restaurant' as const, scopeId: 'casa-arepa', enabled: true }] : [],
    updatedAt: nowTs,
    updatedBy: by,
  }));
}

/** Service de livraison : 11 h – 23 h tous les jours. */
function serviceHours(): WeeklyHours {
  return {
    days: ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({ day, open: true, slots: [{ from: '11:00', to: '23:00' }] })),
    exceptions: [],
    timezone: 'Europe/Paris',
  };
}

/** Arc de cercle (degrés, mètres) utilisé pour dessiner les zones. */
function arc(center: LatLng, radius: number, from: number, to: number, steps: number): LatLng[] {
  return Array.from({ length: steps + 1 }, (_, i) => offsetPoint(center, radius, from + ((to - from) * i) / steps));
}

export function zonePolygons(center: LatLng): Array<{ suffix: string; label: string; color: string; polygon: LatLng[] }> {
  return ZONE_LAYOUT.map((z) => {
    if (!('from' in z)) return { suffix: z.suffix, label: z.label, color: z.color, polygon: arc(center, 2300, 0, 350, 35) };
    const outer = arc(center, 6500, z.from, z.to, 12);
    const inner = arc(center, 1800, z.to, z.from, 8);
    return { suffix: z.suffix, label: z.label, color: z.color, polygon: [...outer, ...inner] };
  });
}

export function seedPlatform(ctx: SeedContext): void {
  const { w, nowTs, superAdminUid: by } = ctx;
  const set = (col: string, id: string, data: object) => w.set(w.doc(`${col}/${id}`), data);
  const stamp = { updatedAt: nowTs, updatedBy: by };

  // ------------------------------------------------------------ Réglages
  const settings: Record<string, object> = {
    [SETTINGS_DOCS.branding]: {
      logo: null,
      logoDark: null,
      favicon: null,
      colors: { primary: '#19343b', secondary: '#f7f2e8', accent: '#e8784b', background: '#f7f2e8' },
    },
    [SETTINGS_DOCS.dispatch]: {
      strategy: 'nearest_with_rating',
      offerTimeoutSeconds: 45,
      initialRadiusMeters: 2000,
      radiusStepMeters: 1000,
      maxRadiusMeters: 6000,
      maxRounds: 5,
      dispatchLeadMinutes: 8,
      maxConcurrentOrdersPerDriver: 2,
      shortageRatioAlert: 0.6,
    },
    [SETTINGS_DOCS.refunds]: { approvalThresholdCents: 5000, defaultMethod: 'original_payment', walletCreditValidityDays: 180 },
    [SETTINGS_DOCS.display]: {
      ranking: { distanceWeight: 0.35, ratingWeight: 0.25, popularityWeight: 0.2, planWeight: 0.1, sponsoredWeight: 0.1, newRestaurantBoostDays: 30 },
      sponsoredLabel: 'Sponsorisé',
    },
    [SETTINGS_DOCS.support]: {
      firstResponseTargetMinutes: { low: 240, normal: 60, high: 20, urgent: 5 },
      resolutionTargetHours: { low: 72, normal: 24, high: 8, urgent: 2 },
      autoEscalateAfterMinutes: 45,
      liveChatEnabled: true,
    },
    [SETTINGS_DOCS.security]: {
      requireMfaForAdmins: false,
      adminSessionMaxHours: 12,
      alerts: { massExportRows: 5000, refundsPerAgentPerHour: 15, failedLoginsPerHour: 8 },
    },
    [SETTINGS_DOCS.retention]: {
      inactiveAccountMonths: 36,
      anonymizeOrdersAfterMonths: 36,
      keepInvoicesYears: 10,
      keepAuditLogsYears: 5,
      deleteDriverLocationsAfterDays: 30,
      trashRetentionDays: 30,
    },
    [SETTINGS_DOCS.maintenance]: {
      apps: {
        client: { enabled: false, message: null, until: null },
        driver: { enabled: false, message: null, until: null },
        restaurant: { enabled: false, message: null, until: null },
        admin: { enabled: false, message: null, until: null },
      },
    },
    ...platformSettingsDocs(),
  };
  for (const [id, data] of Object.entries(settings)) set(COLLECTIONS.settings, id, { ...data, ...stamp });
  set(COLLECTIONS.settingsHistory, 'seed-commission-lu', {
    docPath: 'countries/LU',
    changedFields: ['pricing.delivery.tiers'],
    before: { tiers: DEFAULT_PRICING_FR.delivery.tiers },
    after: { tiers: DEFAULT_PRICING_LU.delivery.tiers },
    reason: 'Alignement sur le coût de la vie au Luxembourg',
    changedBy: by,
    changedAt: ts(parisTime(addDays(ctx.today, -40), 10 * 60)),
  });

  // ------------------------------------------------------------ Pays
  for (const { id, ...country } of countryDocs(nowTs, by)) set(COLLECTIONS.countries, id, country);

  // ------------------------------------------------------------ Villes et zones
  for (const city of CITIES) {
    const restaurantsActive = RESTAURANTS.filter((r) => r.cityId === city.id).length;
    const doc: City = {
      countryId: city.countryId,
      name: city.name,
      slug: city.id,
      active: city.active,
      launchedAt: city.launched ? ts(parisTime(addDays(ctx.today, -120), 11 * 60)) : null,
      timezone: 'Europe/Paris',
      center: city.center,
      serviceHours: serviceHours(),
      pricing: null,
      orderRules: null,
      dispatch: null,
      emergencyClosure: null,
      commissionOverrideBps: null,
      managerIds: city.managerKey === 'cityMetz' ? ['test-city-metz'] : [],
      stats: { restaurantsActive, driversActive: 0, customers: 0, updatedAt: nowTs },
      ...tracked(nowTs, by),
    };
    set(COLLECTIONS.cities, city.id, doc);

    const layout = city.launched ? zonePolygons(city.center) : zonePolygons(city.center).slice(0, 1);
    for (const z of layout) {
      const zone: Zone = {
        countryId: city.countryId,
        cityId: city.id,
        name: `${city.name} ${z.label}`,
        active: city.active,
        color: z.color,
        polygon: z.polygon,
        bounds: polygonBounds(z.polygon),
        maxDeliveryDistanceMeters: 9000,
        deliveryTiers: null,
        minOrderCents: null,
        serviceHours: null,
        emergencyClosure: null,
        currentSurge: null,
        live: city.launched ? { driversOnline: 0, driversAvailable: 0, ordersWaiting: 0, updatedAt: nowTs } : null,
        ...tracked(nowTs, by),
      };
      set(COLLECTIONS.zones, `${city.id}-${z.suffix}`, zone);
    }
  }

  // Heures de pointe : vendredi et samedi soir, majoration de 20 %.
  const peakDays = { days: ([4, 5] as const).map((day) => ({ day, open: true, slots: [{ from: '19:00', to: '21:30' }] })), exceptions: [], timezone: 'Europe/Paris' };
  for (const cityId of ['longwy', 'metz', 'luxembourg']) {
    const city = CITIES.find((c) => c.id === cityId);
    if (!city) continue;
    const surge: SurgeRule = {
      countryId: city.countryId,
      cityId,
      zoneIds: ZONE_LAYOUT.map((z) => `${cityId}-${z.suffix}`),
      name: `Pointe du week-end · ${city.name}`,
      active: true,
      trigger: 'schedule',
      schedule: peakDays,
      demandRatio: null,
      multiplierBps: 12000,
      flatFeeCents: 0,
      courierBonusCents: 100,
      startsAt: null,
      endsAt: null,
      ...tracked(nowTs, by),
    };
    set(COLLECTIONS.surgeRules, `surge-weekend-${cityId}`, surge);
  }
  set(COLLECTIONS.surgeRules, 'surge-pluie-metz', {
    countryId: 'FR', cityId: 'metz', zoneIds: [], name: 'Forte demande (pluie) · Metz', active: false, trigger: 'demand',
    schedule: null, demandRatio: 2.5, multiplierBps: 13000, flatFeeCents: 0, courierBonusCents: 150, startsAt: null, endsAt: null,
    ...tracked(nowTs, by),
  } satisfies SurgeRule);

  // ------------------------------------------------------------ Fonctionnalités
  for (const flag of featureFlagDocs(nowTs, by)) set(COLLECTIONS.featureFlags, flag.key, flag);

  const integrations: PlatformIntegration[] = [
    { key: 'stripe', name: 'Stripe', category: 'payment', enabled: true, mode: 'test', status: 'operational', lastCheckAt: nowTs, lastError: null, publicConfig: { connect: true, country: 'FR' }, updatedAt: nowTs, updatedBy: by },
    { key: 'brevo', name: 'Brevo', category: 'email', enabled: true, mode: 'live', status: 'operational', lastCheckAt: nowTs, lastError: null, publicConfig: { senderName: 'Ciyou Eats' }, updatedAt: nowTs, updatedBy: by },
    { key: 'google_maps', name: 'Google Maps', category: 'maps', enabled: true, mode: 'live', status: 'operational', lastCheckAt: nowTs, lastError: null, publicConfig: { region: 'FR' }, updatedAt: nowTs, updatedBy: by },
    { key: 'fcm', name: 'Firebase Cloud Messaging', category: 'push', enabled: true, mode: 'live', status: 'operational', lastCheckAt: nowTs, lastError: null, publicConfig: {}, updatedAt: nowTs, updatedBy: by },
    { key: 'sms', name: 'SMS (Brevo)', category: 'sms', enabled: false, mode: 'test', status: 'maintenance', lastCheckAt: null, lastError: null, publicConfig: {}, updatedAt: nowTs, updatedBy: by },
  ];
  for (const i of integrations) set(COLLECTIONS.integrations, i.key, i);

  const versions: AppVersionPolicy[] = [
    { app: 'client', latestVersion: '1.4.0', minimumVersion: '1.2.0', forceUpdate: false, message: null, storeUrls: null, updatedAt: nowTs, updatedBy: by },
    { app: 'driver', latestVersion: '1.3.2', minimumVersion: '1.3.0', forceUpdate: true, message: { fr: 'Une mise à jour est nécessaire pour continuer à recevoir des courses.' }, storeUrls: null, updatedAt: nowTs, updatedBy: by },
    { app: 'restaurant', latestVersion: '2.1.0', minimumVersion: '2.0.0', forceUpdate: false, message: null, storeUrls: null, updatedAt: nowTs, updatedBy: by },
    { app: 'admin', latestVersion: '2.1.0', minimumVersion: '2.0.0', forceUpdate: false, message: null, storeUrls: null, updatedAt: nowTs, updatedBy: by },
  ];
  for (const v of versions) set(COLLECTIONS.appVersions, v.app, v);

  for (const key of SERVICE_KEYS) {
    const status: ServiceStatus = {
      key,
      status: key === 'sms' ? 'maintenance' : 'operational',
      message: key === 'sms' ? 'Canal SMS en cours d’activation.' : null,
      latencyMs: ctx.rng.int(40, 220),
      errorRate: Math.round(ctx.rng.float(0, 0.4) * 100) / 100,
      checkedAt: nowTs,
      openIncidentId: null,
    };
    set(COLLECTIONS.serviceStatus, key, status);
  }
  const incidentStart = parisTime(addDays(ctx.today, -12), 19 * 60 + 42);
  const incident: Incident = {
    title: 'Retards de notification des nouvelles commandes',
    services: ['notifications', 'restaurant_backoffice'],
    severity: 'warning',
    status: 'resolved',
    startedAt: ts(incidentStart),
    resolvedAt: ts(new Date(incidentStart.getTime() + 38 * 60_000)),
    updates: [
      { at: ts(incidentStart), status: 'investigating', message: 'Des restaurants signalent des alertes sonores en retard.', by },
      { at: ts(new Date(incidentStart.getTime() + 15 * 60_000)), status: 'identified', message: 'Quota de notifications atteint sur le fournisseur.', by },
      { at: ts(new Date(incidentStart.getTime() + 38 * 60_000)), status: 'resolved', message: 'Quota relevé, notifications rétablies.', by },
    ],
    postMortem: 'Relèvement préventif du quota et alerte à 80 % ajoutée.',
    publicMessage: null,
    ...tracked(ts(incidentStart), by),
  };
  set(COLLECTIONS.incidents, 'seed-incident-notifications', incident);

  // ------------------------------------------------------------ Affichage app client
  CUISINES.forEach((c, order) => {
    const doc: CuisineCategory = { name: { fr: c.name }, slug: c.id, icon: c.icon, image: null, order, active: true, ...tracked(nowTs, by) };
    set(COLLECTIONS.cuisineCategories, c.id, doc);
  });
  const sections: Array<Omit<HomeSection, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> & { id: string }> = [
    { id: 'accueil-bienvenue', type: 'welcome_message', title: { fr: 'Qu’est-ce qui vous ferait plaisir ?' }, subtitle: { fr: 'Les meilleures tables du quartier, livrées chez vous.' }, countryId: null, cityIds: null, order: 0, active: true, restaurantIds: null },
    { id: 'accueil-bannieres', type: 'banner_carousel', title: null, subtitle: null, countryId: null, cityIds: null, order: 1, active: true, restaurantIds: null },
    { id: 'accueil-categories', type: 'categories', title: { fr: 'Envie de…' }, subtitle: null, countryId: null, cityIds: null, order: 2, active: true, restaurantIds: null },
    { id: 'accueil-selection-longwy', type: 'featured_restaurants', title: { fr: 'La sélection de Longwy' }, subtitle: null, countryId: 'FR', cityIds: ['longwy'], order: 3, active: true, restaurantIds: ['mina-kitchen', 'casa-arepa', 'lune-coffee'] },
    { id: 'accueil-selection-luxembourg', type: 'featured_restaurants', title: { fr: 'Coups de cœur à Luxembourg' }, subtitle: null, countryId: 'LU', cityIds: ['luxembourg'], order: 3, active: true, restaurantIds: ['kumo-ramen', 'nami-sushi-bar', 'beldi-bowls'] },
    { id: 'accueil-promotions', type: 'promotions', title: { fr: 'Offres du moment' }, subtitle: null, countryId: null, cityIds: null, order: 4, active: true, restaurantIds: null },
    { id: 'accueil-populaires', type: 'popular', title: { fr: 'Les plus commandés' }, subtitle: null, countryId: null, cityIds: null, order: 5, active: true, restaurantIds: null },
    { id: 'accueil-recommander', type: 'reorder', title: { fr: 'À recommander' }, subtitle: null, countryId: null, cityIds: null, order: 6, active: true, restaurantIds: null },
    { id: 'accueil-nouveautes', type: 'new_restaurants', title: { fr: 'Nouveaux sur Ciyou Eats' }, subtitle: null, countryId: null, cityIds: null, order: 7, active: false, restaurantIds: null },
  ];
  for (const { id, ...s } of sections) set(COLLECTIONS.homeSections, id, { ...s, startsAt: null, endsAt: null, ...tracked(nowTs, by) });

  const banners: Array<Omit<Banner, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> & { id: string }> = [
    { id: 'banniere-bienvenue', title: { fr: '20 % sur votre première commande' }, body: { fr: 'Avec le code BIENVENUE20, dans tous les restaurants participants.' }, image: { path: '', url: unsplash(BANNER_PHOTOS[0]!, 1600, 700), alt: 'Assiettes colorées' }, link: { type: 'promotion', target: 'promo-bienvenue20' }, cityIds: null, order: 0, active: true, sponsored: false },
    { id: 'banniere-kumo', title: { fr: 'Les ramen de Kumo, en 25 minutes' }, body: { fr: 'Bouillons mijotés douze heures, livrés chauds.' }, image: { path: '', url: unsplash('1569718212165-3a8278d5f624', 1600, 700), alt: 'Bol de ramen' }, link: { type: 'restaurant', target: 'kumo-ramen' }, cityIds: ['luxembourg'], order: 1, active: true, sponsored: true },
    { id: 'banniere-mina', title: { fr: 'Le Levant s’invite à Longwy' }, body: { fr: 'Mezze, grillades et douceurs de Mina Kitchen.' }, image: { path: '', url: unsplash('1599487488170-d11ec9c172f0', 1600, 700), alt: 'Brochettes grillées' }, link: { type: 'restaurant', target: 'mina-kitchen' }, cityIds: ['longwy'], order: 1, active: true, sponsored: false },
    { id: 'banniere-livraison', title: { fr: 'Livraison offerte le mardi' }, body: { fr: 'Dès 20 € de commande, à Metz.' }, image: { path: '', url: unsplash(BANNER_PHOTOS[1]!, 1600, 700), alt: 'Bol de cuisine du marché' }, link: { type: 'promotion', target: 'promo-mardi-metz' }, cityIds: ['metz'], order: 2, active: true, sponsored: false },
  ];
  for (const { id, ...b } of banners) set(COLLECTIONS.banners, id, { ...b, startsAt: null, endsAt: null, ...tracked(nowTs, by) });

  const pages: Array<Omit<ContentPage, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>> = [
    { slug: 'a-propos', title: { fr: 'À propos de Ciyou Eats' }, body: { fr: 'Ciyou Eats relie les restaurants indépendants de la Grande Région à leurs clients, avec une flotte de livreurs locale et des commissions transparentes.' }, audience: ['public'], published: true, order: 0 },
    { slug: 'devenir-partenaire', title: { fr: 'Devenir restaurant partenaire' }, body: { fr: 'Inscrivez votre établissement en dix minutes : notre équipe valide votre dossier sous 48 heures ouvrées.' }, audience: ['public', 'restaurant'], published: true, order: 1 },
    { slug: 'devenir-livreur', title: { fr: 'Devenir livreur' }, body: { fr: 'Travaillez quand vous voulez, avec un revenu horaire minimum garanti et 100 % des pourboires.' }, audience: ['public', 'driver'], published: true, order: 2 },
  ];
  for (const p of pages) set(COLLECTIONS.pages, p.slug, { ...p, ...tracked(nowTs, by) });

  const articles: Array<[string, string, string, Array<'client' | 'restaurant' | 'driver'>]> = [
    ['Suivre ma commande', 'Depuis l’onglet Commandes, suivez chaque étape et la position du livreur en temps réel.', 'Commandes', ['client']],
    ['Il manque un article', 'Signalez l’article manquant depuis le détail de la commande dans les 48 heures : le remboursement est immédiat sur votre moyen de paiement ou en avoir.', 'Réclamations', ['client']],
    ['Modifier mes horaires d’ouverture', 'Dans Réglages > Horaires, ajoutez plusieurs créneaux par jour et des fermetures exceptionnelles.', 'Back-office', ['restaurant']],
    ['Comprendre mon reversement', 'Chaque lundi, Ciyou Eats reverse vos ventes de la semaine, commission et remboursements imputés déduits. Le détail est dans Finances.', 'Paiements', ['restaurant']],
    ['Activer le mode rush', 'Le mode rush ajoute jusqu’à 30 minutes au temps de préparation affiché aux clients.', 'Commandes', ['restaurant']],
    ['Comment est calculée ma course ?', 'Montant fixe pour les courses de moins de 2 km, puis un prix au kilomètre, avec un bonus aux heures de pointe (barème de votre ville). Les pourboires vous reviennent en totalité.', 'Rémunération', ['driver']],
  ];
  articles.forEach(([title, body, category, audience], order) => {
    const doc: HelpArticle = {
      title: { fr: title }, body: { fr: body }, category, audience, tags: [], published: true, order,
      views: ctx.rng.int(40, 900), helpfulYes: ctx.rng.int(10, 120), helpfulNo: ctx.rng.int(0, 12), ...tracked(nowTs, by),
    };
    set(COLLECTIONS.helpArticles, `aide-${order + 1}`, doc);
  });

  // ------------------------------------------------------------ Formules et commissions
  for (const { id, ...plan } of planDocs(nowTs, by)) set(COLLECTIONS.plans, id, plan);
  const since = ts(parisTime(addDays(ctx.today, -120), 0));
  const commissionRules: Array<CommissionRule & { id: string }> = [
    { id: 'marche-fr', scope: 'country', scopeId: 'FR', countryId: 'FR', platformDeliveryBps: 3000, restaurantDeliveryBps: 1500, pickupBps: 1200, validFrom: since, validTo: null, reason: 'Barème de lancement France', supersedesId: null, ...tracked(since, by) },
    { id: 'marche-lu', scope: 'country', scopeId: 'LU', countryId: 'LU', platformDeliveryBps: 3000, restaurantDeliveryBps: 1500, pickupBps: 1200, validFrom: since, validTo: null, reason: 'Barème de lancement Luxembourg', supersedesId: null, ...tracked(since, by) },
    { id: 'negocie-kumo', scope: 'restaurant', scopeId: 'kumo-ramen', countryId: 'LU', platformDeliveryBps: 2200, restaurantDeliveryBps: 1000, pickupBps: 800, validFrom: since, validTo: null, reason: 'Accord de lancement : volume garanti de 250 commandes par mois', supersedesId: null, ...tracked(since, by) },
  ];
  for (const { id, ...rule } of commissionRules) set(COLLECTIONS.commissionRules, id, rule);

  // ------------------------------------------------------------ Rôles internes
  const roleDescriptions: Record<string, string> = {
    super_admin: 'Accès complet à la plateforme et à la gestion de l’équipe.',
    support: 'Traite les demandes clients, restaurants et livreurs ; gestes commerciaux plafonnés.',
    finance: 'Paiements, reversements, factures, abonnements et déclarations.',
    sales: 'Prospection, inscription et accompagnement des restaurants.',
    ops: 'Opérations quotidiennes : commandes, livreurs, zones et incidents.',
    city_manager: 'Pilotage d’une ville : restaurants, livreurs et zones de son périmètre.',
  };
  for (const role of ADMIN_ROLES) {
    const def: AdminRoleDefinition = {
      role,
      label: ADMIN_ROLE_LABELS[role],
      description: roleDescriptions[role] ?? '',
      permissions: [...DEFAULT_ADMIN_ROLE_PERMISSIONS[role]],
      defaultRefundLimitCents: Math.min(DEFAULT_REFUND_LIMITS[role], 10_000_000),
      maskPersonalData: ROLES_WITH_MASKED_DATA.includes(role),
      updatedAt: nowTs,
      updatedBy: by,
    };
    set(COLLECTIONS.adminRoles, role, def);
  }

  // ------------------------------------------------------------ Documents légaux
  const published = ts(parisTime(addDays(ctx.today, -100), 9 * 60));
  for (const type of LEGAL_DOCUMENT_TYPES) {
    for (const countryId of type === 'terms_restaurant' || type === 'terms_driver' ? ['FR', 'LU'] : ['FR']) {
      const doc: LegalDocument = {
        type,
        countryId,
        version: '2026-06',
        title: { fr: LEGAL_DOCUMENT_LABELS[type] },
        content: { fr: `${LEGAL_DOCUMENT_LABELS[type]} de Ciyou Eats (${countryId === 'FR' ? 'France' : 'Luxembourg'}). Version de démonstration à faire valider par le conseil juridique avant publication.` },
        pdf: null,
        status: 'published',
        publishedAt: published,
        effectiveAt: published,
        requiresReacceptance: false,
        changeSummary: 'Première version',
        ...tracked(published, by),
      };
      set(COLLECTIONS.legalDocuments, `${type}-${countryId.toLowerCase()}-2026-06`, doc);
    }
  }
}

export function seedCounters(ctx: SeedContext, values: Record<string, { prefix: string; value: number }>): void {
  for (const [id, v] of Object.entries(values)) {
    ctx.w.set(ctx.w.doc(`${COLLECTIONS.counters}/${id}`), { value: v.value, prefix: v.prefix, updatedAt: ctx.nowTs } satisfies Counter);
  }
}
