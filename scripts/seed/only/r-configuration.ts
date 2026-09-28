// Données de démonstration des rubriques « Configuration » du back-office restaurant.
// Complément idempotent du seed principal, exécuté seul :
//   npx tsx scripts/seed/only/r-configuration.ts
// Identifiants stables, documents marqués seed:true. Établissements concernés :
// Mina Kitchen (zones propres, mentions, notifications détaillées, preuve de
// signature du contrat) et Lune Coffee (contrat à signer, pièce refusée, rôle sur
// mesure, fermetures exceptionnelles).
import { COLLECTIONS, SUBCOLLECTIONS, type LegalAcceptance, type RestaurantDeliveryZone } from '@golink/shared';
import { bucket, db } from '../../lib/admin.mjs';
import { SeedFiles } from '../files';
import type { DocumentReference } from '@google-cloud/firestore';
import { Timestamp } from '../lib';

const OWNER = 'test-owner-haddad';
const now = Timestamp.now();
const days = (n: number) => Timestamp.fromMillis(Date.now() + n * 86_400_000);
const iso = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const restaurant = (rid: string) => db.collection(COLLECTIONS.restaurants).doc(rid);
const sub = (rid: string, name: keyof typeof SUBCOLLECTIONS.restaurants, id: string) =>
  restaurant(rid).collection(SUBCOLLECTIONS.restaurants[name]).doc(id);

/** Cercle approché en polygone autour d'un point (zone tracée de démonstration). */
function ring(center: { lat: number; lng: number }, meters: number, points: number, stretch = 1) {
  const R = 6_371_000;
  return Array.from({ length: points }, (_, i) => {
    const a = (2 * Math.PI * i) / points;
    const r = meters * (1 + 0.18 * Math.sin(3 * a)) * (Math.cos(a) > 0 ? stretch : 1);
    return {
      lat: Number((center.lat + ((r * Math.cos(a)) / R) * (180 / Math.PI)).toFixed(6)),
      lng: Number((center.lng + ((r * Math.sin(a)) / (R * Math.cos((center.lat * Math.PI) / 180))) * (180 / Math.PI)).toFixed(6)),
    };
  });
}

async function main() {
  const writer = db.bulkWriter();
  const set = (ref: DocumentReference, data: object, merge = true) => {
    void writer.set(ref, { ...data, seed: true }, { merge });
  };

  // ------------------------------------------------------------ Mina Kitchen
  const mina = await restaurant('mina-kitchen').get();
  const geo = mina.get('address.geo') as { latitude: number; longitude: number } | undefined;
  const center = geo ? { lat: geo.latitude, lng: geo.longitude } : { lat: 49.5214, lng: 5.7629 };

  set(restaurant('mina-kitchen'), {
    labels: ['homemade', 'vegetarian_friendly', 'local_products'],
    allergenNotice: 'Nos plats sont préparés dans une cuisine où sont manipulés sésame, fruits à coque et produits laitiers. Traces possibles.',
  });
  set(sub('mina-kitchen', 'settings', 'orders'), { scheduledLeadMinutes: 60, scheduledMaxDays: 3, dineInInstructions: null });
  set(sub('mina-kitchen', 'settings', 'notifications'), {
    sound: 'chime',
    volume: 80,
    repeatUntilAccepted: true,
    emailWeeklyReport: true,
    emailInvoices: true,
    alerts: {
      order_cancelled: { inApp: true, email: false },
      order_late: { inApp: true, email: false },
      low_stock: { inApp: true, email: true },
      new_review: { inApp: true, email: false },
      new_message: { inApp: true, email: false },
      document_expiry: { inApp: true, email: true },
      payout_paid: { inApp: true, email: true },
    },
  });
  set(sub('mina-kitchen', 'private', 'legal'), {
    rcsCity: 'Briey',
    shareCapitalCents: 1_000_000,
    partnerTermsDocumentId: 'terms_restaurant-fr-2026-06',
    partnerTermsAcceptedBy: OWNER,
    partnerTermsSignatureName: 'Mina Haddad',
  });
  const acceptance: LegalAcceptance = {
    userId: OWNER,
    userType: 'restaurant',
    restaurantId: 'mina-kitchen',
    documentId: 'terms_restaurant-fr-2026-06',
    documentType: 'terms_restaurant',
    version: '2026-06',
    acceptedAt: Timestamp.fromDate(new Date('2026-05-31T09:12:00+02:00')),
    ipHash: null,
    userAgent: null,
    signatureName: 'Mina Haddad',
  };
  set(db.collection(COLLECTIONS.legalAcceptances).doc(`terms_restaurant-fr-2026-06_mina-kitchen_${OWNER}`), acceptance, false);

  const zones: Array<[string, Omit<RestaurantDeliveryZone, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>]> = [
    [
      'centre-proximite',
      { name: 'Centre et proximité', type: 'radius', radiusMeters: 2500, polygon: null, feeCents: 250, minOrderCents: null, freeAboveCents: 3500, deliveryMinutes: 12, enabled: true, order: 0, color: '#4a846c' },
    ],
    [
      'longwy-haut',
      { name: 'Longwy-Haut et plateau', type: 'polygon', radiusMeters: null, polygon: ring(center, 3800, 9, 1.15), feeCents: 390, minOrderCents: 2000, freeAboveCents: null, deliveryMinutes: 20, enabled: true, order: 1, color: '#e09b24' },
    ],
    [
      'frontiere-lux',
      { name: 'Frontière luxembourgeoise', type: 'radius', radiusMeters: 6500, polygon: null, feeCents: 590, minOrderCents: 3000, freeAboveCents: null, deliveryMinutes: 30, enabled: false, order: 2, color: '#4a7fbb' },
    ],
  ];
  for (const [id, zone] of zones) {
    set(sub('mina-kitchen', 'deliveryZones', id), { ...zone, createdAt: now, createdBy: OWNER, updatedAt: now, updatedBy: OWNER }, false);
  }

  // ------------------------------------------------------------ Lune Coffee
  // Contrat : version à signer (démonstration du parcours d'acceptation).
  set(sub('lune-coffee', 'private', 'legal'), { partnerTermsVersion: null, partnerTermsAcceptedAt: null, partnerTermsSignatureName: null, partnerTermsAcceptedBy: null });
  set(sub('lune-coffee', 'staffRoles', 'barista'), {
    name: 'Barista',
    description: 'Commandes et ruptures du comptoir, sans accès aux finances ni à l’équipe.',
    permissions: ['dashboard.view', 'orders.view', 'orders.manage', 'menu.view', 'stock.edit', 'planning.view', 'timeclock.self', 'absences.self', 'tasks.view', 'haccp.record'],
    system: false,
    createdAt: now,
    createdBy: OWNER,
    updatedAt: now,
    updatedBy: OWNER,
  }, false);
  const luneHours = await sub('lune-coffee', 'settings', 'hours').get();
  const exceptions = [
    { date: iso(26), closed: true, slots: [], label: 'Inventaire annuel' },
    { date: '2026-12-24', closed: false, slots: [{ from: '08:00', to: '15:00' }], label: 'Réveillon : fermeture anticipée' },
    { date: '2026-12-25', closed: true, slots: [], label: 'Noël' },
  ];
  if (luneHours.exists) {
    const current = (luneHours.get('exceptions') as Array<{ date: string }> | undefined) ?? [];
    const merged = [...current.filter((e) => !exceptions.some((x) => x.date === e.date)), ...exceptions].sort((a, b) => a.date.localeCompare(b.date));
    set(sub('lune-coffee', 'settings', 'hours'), { exceptions: merged });
    set(restaurant('lune-coffee'), { hoursSummary: { exceptions: merged } });
  }

  // Pièce refusée (avis de situation illisible) et fichier de démonstration associé.
  const files = new SeedFiles(bucket);
  const path = 'restaurants/lune-coffee/private/documents/siret_notice-demo.pdf';
  const file = files.storedPdf(path, 'Avis de situation SIRENE', ['Document de démonstration Ciyou Eats', 'Lune Coffee'], days(-6), OWNER);
  set(db.collection(COLLECTIONS.partnerDocuments).doc('lune-coffee-siret_notice'), {
    ownerType: 'restaurant',
    ownerId: 'lune-coffee',
    countryId: 'FR',
    cityId: 'longwy',
    type: 'siret_notice',
    file,
    status: 'rejected',
    number: null,
    issuedAt: iso(-40),
    expiresAt: null,
    reviewedBy: 'test-super-admin',
    reviewedAt: days(-5),
    rejectionReason: 'Document illisible : merci de déposer un PDF net, toutes les pages visibles.',
    remindersSent: 0,
    lastReminderAt: null,
    createdAt: days(-6),
    createdBy: OWNER,
    updatedAt: days(-5),
    updatedBy: 'test-super-admin',
  }, false);
  // Attestation d'hygiène arrivant à échéance dans 3 semaines.
  set(db.collection(COLLECTIONS.partnerDocuments).doc('lune-coffee-hygiene_certificate'), { expiresAt: iso(21) });

  // ------------------------------------------------------------ Décisions du client
  // Moyens de paiement de tous les commerces : titres-restaurant retirés, pas
  // d'espèces au retrait, espèces seulement si le commerce livre avec ses livreurs.
  const all = await db.collection(COLLECTIONS.restaurants).get();
  let normalized = 0;
  for (const doc of all.docs) {
    const ownCouriers = (doc.get('deliveredBy') ?? 'platform') !== 'platform';
    const settingsRef = doc.ref.collection(SUBCOLLECTIONS.restaurants.settings).doc('payments');
    const settings = await settingsRef.get();
    const methods: Record<string, boolean> = { card: true, apple_pay: true, google_pay: true, ...((settings.get('methods') as Record<string, boolean> | undefined) ?? {}) };
    const cash = ownCouriers && methods.cash === true;
    void writer.set(settingsRef, { online: true, onDelivery: cash, onPickup: false, methods: { ...methods, cash, meal_voucher: false } }, { merge: true });
    const accepted = ((doc.get('acceptedPaymentMethods') as string[] | undefined) ?? []).filter((m) => m !== 'meal_voucher' && (m !== 'cash' || cash));
    void writer.update(doc.ref, { acceptedPaymentMethods: accepted, sellsAlcohol: false });
    normalized += 1;
  }
  console.log(`Moyens de paiement alignés sur les décisions du client : ${normalized} établissements.`);

  await writer.close();
  await files.done();
  console.log(`Configuration restaurant : données de démonstration écrites (${files.count} fichier).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
