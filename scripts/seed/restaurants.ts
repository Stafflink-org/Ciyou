// Restaurants : groupe, fiches, conditions commerciales, réglages, carte,
// accès du personnel, justificatifs, abonnements.
import {
  ALLERGENS,
  COLLECTIONS,
  DEFAULT_PLANS,
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  RESTAURANT_PRIVATE_DOCS,
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  buildSearchKeywords,
  isPointInPolygon,
  maskIban,
  resolveCommissionBps,
  slugify,
  type Allergen,
  type MenuIssue,
  type MenuOption,
  type MenuSection,
  type OptionGroup,
  type PartnerDocument,
  type PartnerDocumentType,
  type PosConnection,
  type Product,
  type Restaurant,
  type RestaurantCommercial,
  type RestaurantDeliveryZone,
  type RestaurantGroup,
  type RestaurantHours,
  type RestaurantLegal,
  type RestaurantLoyaltySettings,
  type RestaurantMember,
  type RestaurantNotificationSettings,
  type RestaurantOrderSettings,
  type RestaurantPaymentSettings,
  type StaffRole,
  type StaffRoleDefinition,
  type StockMovement,
  type Subscription,
  type WeeklyHours,
} from '@golink/shared';
import { account } from './accounts';
import { CITIES, MENUS, PENDING_MENUS, PENDING_RESTAURANTS, RESTAURANTS, productPhoto, unsplash, type RestaurantSeed } from './catalog';
import { tracked, type SeedContext } from './context';
import { monogramSvg } from './files';
import { addDays, geo, parisTime, ts } from './lib';
import { zonePolygons } from './platform';

/** Données d'un restaurant utiles aux étapes suivantes (commandes, équipe). */
export interface RestaurantRuntime {
  seed: RestaurantSeed;
  countryId: 'FR' | 'LU';
  ownerUid: string;
  zoneIds: string[];
  commission: { platform: number; own: number; pickup: number; source: 'plan' | 'negotiated' };
  products: Array<{
    id: string;
    name: string;
    priceCents: number;
    vat: 'food' | 'soft_drink';
    imageUrl: string | null;
    groups: Array<{ id: string; name: string; min: number; max: number; options: Array<{ id: string; name: string; priceCents: number }> }>;
    popularity: number;
  }>;
}

const OWNERS: Record<string, { firstName: string; lastName: string }> = {
  'kumo-ramen': { firstName: 'Kenji', lastName: 'Morel' },
  'beldi-bowls': { firstName: 'Salma', lastName: 'Bennani' },
  'santo-smash': { firstName: 'Lucas', lastName: 'Santoro' },
  'nami-sushi-bar': { firstName: 'Aiko', lastName: 'Reding' },
  'rue-12-bakery': { firstName: 'Pauline', lastName: 'Kieffer' },
  'casa-arepa': { firstName: 'Andrea', lastName: 'Pérez' },
  'le-petit-pho': { firstName: 'Minh', lastName: 'Tran' },
  'maison-pita': { firstName: 'Nikos', lastName: 'Papadakis' },
  'brasserie-des-remparts': { firstName: 'Olivier', lastName: 'Thiel' },
};

/** Allergènes déduits du libellé (démonstration). */
function allergensOf(text: string): Allergen[] {
  const rules: Array<[RegExp, Allergen]> = [
    [/pâte|pates|pain|pita|brioche|croissant|burger|wrap|bun|gyoza|nouilles|ramen|cookie|tarte|quiche|baguette|arepa jambon|empanada|tequeño|pancake|feuillet|baklava|boulgour|semoule|couscous|focaccia|lasagne|ravioli|gnocchi|cake|éclair|flan|chausson/i, 'gluten'],
    [/fromage|parmesan|burrata|mascarpone|lait|crème|beurre|labneh|yaourt|halloumi|cheddar|ayran|feta|tres leches|panna|mouhalabieh|comté/i, 'milk'],
    [/œuf|oeuf|mayonnaise|pancake|brioche|tiramisu|flan|éclair|dorayaki/i, 'eggs'],
    [/saumon|thon|poisson|sashimi|nigiri|nuoc/i, 'fish'],
    [/crevette/i, 'crustaceans'],
    [/sésame|tahini|houmous|moutabal/i, 'sesame'],
    [/soja|miso|shoyu|edamame|tofu/i, 'soy'],
    [/noix|pistache|amande|muhammara/i, 'nuts'],
    [/cacahuète/i, 'peanuts'],
    [/moutarde/i, 'mustard'],
    [/céleri/i, 'celery'],
  ];
  return [...new Set(rules.filter(([re]) => re.test(text)).map(([, a]) => a))].filter((a) => ALLERGENS.includes(a));
}

function dietaryOf(text: string, section: string): Product['dietary'] {
  const out: Product['dietary'] = [];
  if (/végétal|vegan|légumes|falafel|chou-fleur|concombre|edamame/i.test(`${text} ${section}`)) out.push('vegetarian');
  if (/vegan|végétal/i.test(`${text} ${section}`)) out.push('vegan');
  if (/piment|épicé|harissa/i.test(text)) out.push('spicy');
  return out;
}

function hoursFor(profile: RestaurantSeed['profile']): WeeklyHours {
  const meals = [{ from: '11:30', to: '14:30' }, { from: '18:30', to: '22:30' }];
  const cafe = [{ from: '07:30', to: '18:30' }];
  const slots = profile === 'cafe' ? cafe : meals;
  return {
    days: ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({
      day,
      open: profile === 'cafe' ? day !== 0 : day !== 6,
      slots: profile === 'meals' && day >= 4 ? [{ from: '11:30', to: '14:30' }, { from: '18:30', to: '23:00' }] : slots,
    })),
    exceptions: [{ date: '2026-11-11', closed: true, label: 'Armistice' }],
    timezone: 'Europe/Paris',
  };
}

export function seedRestaurants(ctx: SeedContext): RestaurantRuntime[] {
  const { w, rng, nowTs, superAdminUid: admin } = ctx;
  const runtimes: RestaurantRuntime[] = [];
  const owner = account('owner');
  const launchBase = parisTime(addDays(ctx.today, -118), 10 * 60);

  // Groupe multi-établissements.
  const group: RestaurantGroup = {
    name: 'Maison Haddad',
    ownerId: owner.uid,
    countryId: 'FR',
    legalName: 'Maison Haddad SAS',
    siren: '894 512 377',
    vatNumber: 'FR 45 894512377',
    restaurantIds: RESTAURANTS.filter((r) => r.groupId === 'maison-haddad').map((r) => r.id),
    commercial: { commissionBps: null, planCode: 'pro', subscriptionId: null },
    consolidatedBilling: true,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    ...tracked(ts(launchBase), admin),
  };
  w.set(w.doc(`${COLLECTIONS.restaurantGroups}/maison-haddad`), group);

  for (const [index, r] of [...RESTAURANTS, ...PENDING_RESTAURANTS].entries()) {
    const pending = r.status === 'onboarding';
    const city = CITIES.find((c) => c.id === r.cityId);
    if (!city) throw new Error(`Ville inconnue : ${r.cityId}`);
    const createdAt = pending ? ts(parisTime(addDays(ctx.today, -(index % 3) - 1), 15 * 60 + index * 7)) : ts(new Date(launchBase.getTime() + index * 3 * 86_400_000));
    const ownerUid = r.groupId ? owner.uid : `seed-owner-${r.id}`;
    const ownerName = r.groupId ? `${owner.firstName} ${owner.lastName}` : `${OWNERS[r.id]?.firstName} ${OWNERS[r.id]?.lastName}`;
    const ownerEmail = r.groupId ? owner.email : `${slugify(ownerName).replace(/-/g, '.')}@${r.id}.test`;
    const zoneIds = zonePolygons(city.center)
      .filter((z) => isPointInPolygon(r.location, z.polygon))
      .map((z) => `${city.id}-${z.suffix}`);
    const menu = MENUS[r.id] ?? PENDING_MENUS[r.id];
    if (!menu) throw new Error(`Menu absent : ${r.id}`);
    const plan = DEFAULT_PLANS.find((p) => p.code === r.plan);
    if (!plan) throw new Error(`Formule inconnue : ${r.plan}`);
    const hours = hoursFor(r.profile);
    const base = `${COLLECTIONS.restaurants}/${r.id}`;
    const phone = r.address.countryCode === 'FR' ? `+33 3 82 ${rng.digits(2)} ${rng.digits(2)} ${rng.digits(2)}` : `+352 26 ${rng.digits(2)} ${rng.digits(2)} ${rng.digits(2)}`;

    // Logo monogramme et photo de couverture.
    const logo = ctx.files.put(`restaurants/${r.id}/public/logo.svg`, monogramSvg(r.mark, r.accent), 'image/svg+xml');

    const restaurant: Restaurant = {
      name: r.name,
      slug: slugify(`${r.name}-${city.name}`),
      groupId: r.groupId ?? null,
      ownerId: ownerUid,
      countryId: city.countryId,
      cityId: city.id,
      zoneIds,
      address: { ...r.address, line2: null, placeId: null, ...geo(r.location) },
      phone,
      email: `contact@${r.id}.test`,
      description: r.description,
      cuisineIds: r.cuisineIds,
      tags: r.cuisine.split(' · '),
      priceLevel: r.priceLevel,
      logo: { path: logo.path, url: logo.url, thumbUrl: logo.url, width: 512, height: 512, alt: `Logo ${r.name}` },
      cover: { path: '', url: unsplash(r.cover, 1600, 900), thumbUrl: unsplash(r.cover, 480, 270), width: 1600, height: 900, alt: r.name },
      photos: [],
      accent: r.accent,
      mark: r.mark,
      status: pending ? 'onboarding' : 'active',
      onboardingStatus: pending ? (r.id === 'maison-pita' ? 'pending' : 'documents_missing') : 'approved',
      isOpen: !pending,
      acceptingOrders: !pending,
      busyExtraMinutes: r.id === 'kumo-ramen' ? 10 : 0,
      fulfillmentModes: ['delivery', 'pickup'],
      deliveredBy: r.deliveredBy,
      minOrderCents: r.profile === 'cafe' ? 800 : 1200,
      ownDeliveryFeeCents: r.deliveredBy === 'platform' ? null : 250,
      ownDeliveryRadiusMeters: r.deliveredBy === 'platform' ? null : 4000,
      prepMinutes: r.prepMinutes,
      etaMinutes: r.etaMinutes,
      rating: { average: r.rating, count: 0 },
      hoursSummary: hours,
      planCode: r.plan,
      sponsored: r.id === 'kumo-ramen',
      rankingScore: Math.round((r.rating * 15 + plan.rankingBoost * 8 + r.dailyOrders) * 10) / 10,
      qualityScore: pending ? 100 : rng.int(82, 98),
      allergensComplete: !pending,
      sellsAlcohol: r.sellsAlcohol ?? false,
      acceptedPaymentMethods: r.address.countryCode === 'FR' ? ['card', 'apple_pay', 'google_pay', 'cash', 'meal_voucher'] : ['card', 'apple_pay', 'google_pay', 'cash'],
      ordersCount: 0,
      searchKeywords: buildSearchKeywords(r.name, city.name, r.address.postalCode, r.cuisine),
      launchedAt: pending ? null : createdAt,
      suspension: null,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      ...tracked(createdAt, ownerUid),
    };
    w.set(w.doc(base), restaurant);

    // Conditions commerciales et identité légale.
    const negotiated = r.negotiatedCommissionBps ?? null;
    const commercial: RestaurantCommercial = {
      planCode: r.plan,
      subscriptionId: r.plan === 'basic' ? null : `sub-${r.id}`,
      subscriptionStatus: r.plan === 'basic' ? 'active' : r.id === 'beldi-bowls' ? 'past_due' : 'active',
      negotiatedCommission: negotiated
        ? { platformDeliveryBps: negotiated, restaurantDeliveryBps: 1000, pickupBps: 800, reason: 'Accord de lancement : volume garanti de 250 commandes par mois', validUntil: ts(parisTime(addDays(ctx.today, 180), 0)) }
        : null,
      specialOffer: r.id === 'le-petit-pho'
        ? { commissionReductionBps: 300, subscriptionFreeUntil: null, reason: 'Offre de bienvenue : trois mois à commission réduite', endsAt: ts(parisTime(addDays(ctx.today, 25), 0)) }
        : null,
      allowedPaymentMethods: restaurant.acceptedPaymentMethods,
      deliveryFeeOverrideCents: null,
      minOrderOverrideCents: null,
      payoutFrequency: 'weekly',
      payoutsBlocked: pending,
      payoutsBlockedReason: pending ? 'Compte de paiement Stripe à activer.' : null,
      stripeAccountId: null,
      stripeAccountStatus: pending ? null : 'enabled',
      updatedAt: nowTs,
      updatedBy: admin,
    };
    w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.private}/${RESTAURANT_PRIVATE_DOCS.commercial}`), commercial);
    const iban = r.address.countryCode === 'FR' ? `FR76 3000 4000 ${rng.digits(4)} ${rng.digits(4)} ${rng.digits(4)} ${rng.digits(3)}` : `LU28 0019 ${rng.digits(4)} ${rng.digits(4)} ${rng.digits(4)}`;
    const legal: RestaurantLegal = {
      legalName: r.groupId ? 'Maison Haddad SAS' : `${r.name} ${r.address.countryCode === 'FR' ? 'SARL' : 'S.à r.l.'}`,
      legalForm: r.groupId ? 'SAS' : r.address.countryCode === 'FR' ? 'SARL' : 'S.à r.l.',
      siret: r.address.countryCode === 'FR' ? `${rng.digits(3)} ${rng.digits(3)} ${rng.digits(3)} ${rng.digits(5)}` : `B${rng.digits(6)}`,
      vatNumber: r.address.countryCode === 'FR' ? `FR ${rng.digits(2)} ${rng.digits(9)}` : `LU ${rng.digits(8)}`,
      registeredAddress: { ...r.address, line2: null },
      managerName: ownerName,
      managerEmail: ownerEmail,
      managerPhone: phone,
      managerBirthDate: null,
      ibanMasked: pending ? null : maskIban(iban),
      alcoholLicenseNumber: r.sellsAlcohol ? `LIC-${rng.digits(6)}` : null,
      taxIdentificationNumber: pending ? null : rng.digits(13),
      dac7Complete: !pending,
      partnerTermsVersion: '2026-06',
      partnerTermsAcceptedAt: createdAt,
      updatedAt: createdAt,
    };
    w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.private}/${RESTAURANT_PRIVATE_DOCS.legal}`), legal);

    // Réglages de l'établissement.
    const stamp = { updatedAt: nowTs, updatedBy: ownerUid };
    const settings = `${base}/${SUBCOLLECTIONS.restaurants.settings}`;
    const orderSettings: RestaurantOrderSettings = {
      prepMinutes: r.prepMinutes, maxConcurrentOrders: 12, minOrderCents: restaurant.minOrderCents, delivery: true, pickup: true, dineIn: false,
      autoAccept: r.profile === 'cafe', scheduledOrders: true, autoPrint: r.id === 'kumo-ramen', pickupInstructions: 'Présentez votre code de retrait au comptoir.', ...stamp,
    };
    w.set(w.doc(`${settings}/${RESTAURANT_SETTINGS_DOCS.orders}`), orderSettings);
    w.set(w.doc(`${settings}/${RESTAURANT_SETTINGS_DOCS.hours}`), { ...hours, ...stamp } satisfies RestaurantHours);
    const payments: RestaurantPaymentSettings = {
      online: true, onDelivery: true, onPickup: true,
      methods: { card: true, apple_pay: true, google_pay: true, cash: true, meal_voucher: r.address.countryCode === 'FR' }, ...stamp,
    };
    w.set(w.doc(`${settings}/${RESTAURANT_SETTINGS_DOCS.payments}`), payments);
    const loyalty: RestaurantLoyaltySettings = { enabled: r.plan !== 'basic', earnPoints: 1, everyCents: 100, welcomePoints: 20, thresholdPoints: 100, rewardCents: 500, ...stamp };
    w.set(w.doc(`${settings}/${RESTAURANT_SETTINGS_DOCS.loyalty}`), loyalty);
    const notifications: RestaurantNotificationSettings = { newOrderSound: true, emailDailySummary: true, emailRecipients: [ownerEmail], smsOnNewOrder: false, smsNumbers: [], ...stamp };
    w.set(w.doc(`${settings}/${RESTAURANT_SETTINGS_DOCS.notifications}`), notifications);

    // Zones propres (livreurs du restaurant).
    if (r.deliveredBy !== 'platform') {
      const own: Array<[string, number, number, string]> = [
        ['Centre et proximité', 2500, 250, '#e8784b'],
        ['Quartiers voisins', 5000, 390, '#19343b'],
      ];
      own.forEach(([name, radius, fee, color], order) => {
        const zone: RestaurantDeliveryZone = { name, type: 'radius', radiusMeters: radius, polygon: null, feeCents: fee, minOrderCents: 1500, enabled: true, order, color, ...tracked(createdAt, ownerUid) };
        w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.deliveryZones}/zone-${order + 1}`), zone);
      });
    }

    // Carte : sections, options, listes d'options, produits.
    const sectionIds = new Map<string, string>();
    menu.sections.forEach((s, order) => {
      const id = `s${order + 1}`;
      sectionIds.set(s.name, id);
      const section: MenuSection = { name: s.name, description: null, image: null, enabled: true, hideProductNames: false, order, availability: null, ...tracked(createdAt, ownerUid) };
      w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.sections}/${id}`), section);
    });
    const groupsRuntime = new Map<string, RestaurantRuntime['products'][number]['groups'][number]>();
    for (const g of menu.optionGroups) {
      for (const o of g.options) {
        const option: MenuOption = { name: o.name, priceCents: o.priceCents, enabled: true, allergens: allergensOf(o.name), linkedProductId: null, externalId: null, ...tracked(createdAt, ownerUid) };
        w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.options}/${o.key}`), option);
      }
      const groupDoc: OptionGroup = { name: g.name, description: null, optionIds: g.options.map((o) => o.key), enabled: true, multiple: g.multiple, min: g.min, max: g.max, allowQuantity: false, ...tracked(createdAt, ownerUid) };
      w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.optionGroups}/${g.key}`), groupDoc);
      groupsRuntime.set(g.key, { id: g.key, name: g.name, min: g.min, max: g.max, options: g.options.map((o) => ({ id: o.key, name: o.name, priceCents: o.priceCents })) });
    }
    const products: RestaurantRuntime['products'] = [];
    menu.products.forEach((p, order) => {
      const photo = productPhoto(p.name);
      const text = `${p.name} ${p.description}`;
      const lowStock = p.stock !== null && p.stock <= 5;
      const product: Product = {
        sectionId: sectionIds.get(p.section) ?? null,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        compareAtPriceCents: null,
        vatCategory: p.vat,
        image: photo ? { path: '', url: unsplash(photo, 800, 600), thumbUrl: unsplash(photo, 240, 180), width: 800, height: 600, alt: p.name } : null,
        available: !(r.id === 'onda-pasta-club' && p.key === 'p10200'),
        stock: p.stock,
        lowStockThreshold: 5,
        preparationMinutes: null,
        optionGroupIds: p.groups,
        allergens: allergensOf(text),
        allergensDeclared: true,
        dietary: dietaryOf(text, p.section),
        containsAlcohol: false,
        alcoholPercent: null,
        nutrition: null,
        featured: order < 3,
        order,
        salesCount: 0,
        externalId: r.id === 'kumo-ramen' ? `POS-${1000 + order}` : null,
        searchKeywords: buildSearchKeywords(p.name, p.section),
        ...tracked(createdAt, ownerUid),
      };
      w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.products}/${p.key}`), product);
      if (lowStock) {
        const movement: StockMovement = { productId: p.key, productName: p.name, delta: -rng.int(2, 6), stockAfter: p.stock ?? 0, reason: 'order', orderId: null, note: null, createdAt: nowTs, createdBy: 'system' };
        w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.stockMovements}/stock-${p.key}`), movement);
      }
      if (!photo && !pending) {
        const issue: MenuIssue = { restaurantId: r.id, cityId: city.id, productId: p.key, type: 'missing_photo', details: `« ${p.name} » n’a pas de photo.`, status: 'open', detectedAt: nowTs, resolvedAt: null, resolvedBy: null };
        w.set(w.doc(`${COLLECTIONS.menuIssues}/${r.id}-${p.key}-photo`), issue);
      }
      products.push({
        id: p.key,
        name: p.name,
        priceCents: p.priceCents,
        vat: p.vat,
        imageUrl: photo ? unsplash(photo, 240, 180) : null,
        groups: p.groups.map((g) => groupsRuntime.get(g)).filter((g): g is NonNullable<typeof g> => Boolean(g)),
        popularity: order < 4 ? 3 : p.vat === 'soft_drink' ? 1.5 : 1,
      });
    });

    // Accès au back-office.
    const members: Array<{ uid: string; name: string; email: string; role: StaffRole; joined: boolean }> = [
      { uid: ownerUid, name: ownerName, email: ownerEmail, role: 'owner', joined: true },
    ];
    if (r.id === 'mina-kitchen') {
      const manager = account('manager');
      const employee = account('employee');
      members.push({ uid: manager.uid, name: `${manager.firstName} ${manager.lastName}`, email: manager.email, role: 'manager', joined: true });
      members.push({ uid: employee.uid, name: `${employee.firstName} ${employee.lastName}`, email: employee.email, role: 'kitchen', joined: true });
      members.push({ uid: 'seed-staff-mina-service', name: 'Inès Morel', email: 'ines.morel@mina-kitchen.test', role: 'service', joined: false });
    }
    for (const m of members) {
      const member: RestaurantMember = {
        uid: m.uid,
        restaurantId: r.id,
        groupId: r.groupId ?? null,
        displayName: m.name,
        email: m.email,
        role: m.role,
        customRoleId: null,
        permissions: [...DEFAULT_STAFF_ROLE_PERMISSIONS[m.role]],
        active: true,
        onDuty: m.role !== 'owner' && m.joined,
        employeeId: m.role === 'owner' ? null : m.role === 'manager' ? 'e1' : m.role === 'kitchen' ? 'e2' : 'e3',
        invitedBy: ownerUid,
        invitedAt: createdAt,
        joinedAt: m.joined ? createdAt : null,
        lastAccessAt: m.joined ? ts(new Date(ctx.now.getTime() - rng.int(5, 600) * 60_000)) : null,
      };
      w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.members}/${m.uid}`), member);
    }
    if (r.id === 'mina-kitchen') {
      const role: StaffRoleDefinition = {
        name: 'Chef de rang',
        description: 'Service en salle, commandes et messagerie client, sans accès aux finances.',
        permissions: ['dashboard.view', 'orders.view', 'orders.manage', 'menu.view', 'customers.view', 'messages.use', 'planning.view', 'timeclock.self', 'absences.self', 'tasks.view'],
        system: false,
        ...tracked(createdAt, ownerUid),
      };
      w.set(w.doc(`${base}/${SUBCOLLECTIONS.restaurants.staffRoles}/chef-de-rang`), role);
    }

    // Justificatifs partenaires.
    const docTypes: PartnerDocumentType[] = ['kbis', 'manager_id', 'bank_details', 'hygiene_certificate', ...(r.sellsAlcohol ? (['alcohol_license'] as const) : [])];
    docTypes.forEach((type, i) => {
      const missing = pending && r.id === 'brasserie-des-remparts' && (type === 'bank_details' || type === 'hygiene_certificate');
      if (missing) return;
      const status: PartnerDocument['status'] = pending ? 'pending' : r.id === 'casa-arepa' && type === 'hygiene_certificate' ? 'expired' : 'approved';
      const file = ctx.files.storedPdf(`restaurants/${r.id}/private/documents/${type}.pdf`, `${r.name} · justificatif`, [`Type : ${type}`, `Établissement : ${r.name}`, `Adresse : ${r.address.line1}, ${r.address.postalCode} ${r.address.city}`], createdAt, ownerUid);
      const doc: PartnerDocument = {
        ownerType: 'restaurant',
        ownerId: r.id,
        countryId: city.countryId,
        cityId: city.id,
        type,
        file,
        status,
        number: null,
        issuedAt: addDays(ctx.today, -200 - i * 20),
        expiresAt: type === 'hygiene_certificate' ? (status === 'expired' ? addDays(ctx.today, -6) : addDays(ctx.today, 300)) : null,
        reviewedBy: pending ? null : admin,
        reviewedAt: pending ? null : createdAt,
        rejectionReason: null,
        remindersSent: status === 'expired' ? 2 : 0,
        lastReminderAt: status === 'expired' ? nowTs : null,
        ...tracked(createdAt, ownerUid),
      };
      w.set(w.doc(`${COLLECTIONS.partnerDocuments}/${r.id}-${type}`), doc);
    });

    // Abonnement (formules payantes).
    if (r.plan !== 'basic' && !pending) {
      const periodStart = parisTime(addDays(ctx.today, -((index * 5) % 28)), 0);
      const subscription: Subscription = {
        subscriberType: 'restaurant',
        subscriberId: r.id,
        restaurantIds: [r.id],
        planCode: r.plan,
        status: r.id === 'beldi-bowls' ? 'past_due' : 'active',
        billingCycle: 'monthly',
        priceHtCents: plan.monthlyPriceHtCents,
        trialEndsAt: ts(new Date(createdAt.toDate().getTime() + plan.trialDays * 86_400_000)),
        currentPeriodStart: ts(periodStart),
        currentPeriodEnd: ts(new Date(periodStart.getTime() + 30 * 86_400_000)),
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        cancelReason: null,
        specialOffer: null,
        dunning: r.id === 'beldi-bowls'
          ? { attempts: 2, lastAttemptAt: ts(parisTime(addDays(ctx.today, -2), 9 * 60)), nextRetryAt: ts(parisTime(addDays(ctx.today, 1), 9 * 60)), restrictedAt: null }
          : { attempts: 0, lastAttemptAt: null, nextRetryAt: null, restrictedAt: null },
        history: [{ at: createdAt, event: 'created', planCode: r.plan, by: ownerUid, reason: null }],
        stripeSubscriptionId: null,
        countryId: city.countryId,
        cityId: city.id,
        ...tracked(createdAt, ownerUid),
      };
      w.set(w.doc(`${COLLECTIONS.subscriptions}/sub-${r.id}`), subscription);
    }

    if (r.id === 'kumo-ramen') {
      const pos: PosConnection = { restaurantId: r.id, provider: 'Zelty', status: 'connected', externalLocationId: 'ZLT-4412', syncMenu: true, pushOrders: true, lastSyncAt: nowTs, lastError: null, errorCount24h: 0, ...tracked(createdAt, ownerUid) };
      w.set(w.doc(`${COLLECTIONS.posConnections}/pos-${r.id}`), pos);
    }

    const planCommission = plan.commission;
    const negotiatedBps = r.negotiatedCommissionBps;
    const offer = commercial.specialOffer?.commissionReductionBps ?? null;
    runtimes.push({
      seed: r,
      countryId: city.countryId,
      ownerUid,
      zoneIds,
      commission: {
        platform: resolveCommissionBps({ marketBps: 3000, planBps: planCommission.platformDeliveryBps, negotiatedBps, offerReductionBps: offer }),
        own: resolveCommissionBps({ marketBps: 1500, planBps: planCommission.restaurantDeliveryBps, negotiatedBps: negotiatedBps ? 1000 : null, offerReductionBps: offer }),
        pickup: resolveCommissionBps({ marketBps: 1200, planBps: planCommission.pickupBps, negotiatedBps: negotiatedBps ? 800 : null, offerReductionBps: offer }),
        source: negotiatedBps ? 'negotiated' : 'plan',
      },
      products,
    });
  }
  return runtimes;
}

