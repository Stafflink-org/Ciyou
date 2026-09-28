// Données complémentaires « Finances & clients » (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/r-finances-clients.ts
// - avoirs GoLink (credit_note) rattachés aux factures de commissions des établissements de Maison Haddad ;
// - notes internes CRM et un client bloqué avec motif ;
// - préférences livreurs (un livreur écarté, un bloqué) et livreurs propres de Mina Kitchen,
//   dont une invitation en attente.
// Identifiants stables : relancer le script ne crée pas de doublon. Chaque document porte `seed: true`.
import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  formatInvoiceNumber,
  vatOnHt,
  type CustomerNote,
  type Driver,
  type Invoice,
  type RestaurantCourier,
} from '@golink/shared';
import { FieldValue } from '@google-cloud/firestore';
import { db } from '../../lib/admin.mjs';
import { ts } from '../lib';

const now = new Date();
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

// ------------------------------------------------------------------ Avoirs

const CREDIT_NOTES = [
  { restaurantId: 'mina-kitchen', month: '2026-08', label: 'Remise commerciale : commission sur commandes remboursées (août 2026)', htCents: 1250 },
  { restaurantId: 'onda-pasta-club', month: '2026-07', label: 'Régularisation : commission appliquée à tort sur 2 commandes annulées', htCents: 830 },
  { restaurantId: 'lune-coffee', month: '2026-08', label: 'Geste commercial : incident de paiement du 14 août', htCents: 500 },
];

async function seedCreditNotes(): Promise<number> {
  let created = 0;
  for (const spec of CREDIT_NOTES) {
    const id = `av-${spec.restaurantId}-${spec.month}`;
    const originalRef = db.collection(COLLECTIONS.invoices).doc(`com-${spec.restaurantId}-${spec.month}`);
    const noteRef = db.collection(COLLECTIONS.invoices).doc(id);
    await db.runTransaction(async (tx) => {
      const [original, existing] = await Promise.all([tx.get(originalRef), tx.get(noteRef)]);
      if (!original.exists) {
        console.warn(`Facture d’origine absente : ${originalRef.id}`);
        return;
      }
      const source = original.data() as Invoice;
      const counterRef = db.collection(COLLECTIONS.counters).doc('invoice_FR-AV');
      const counter = await tx.get(counterRef);
      let number = existing.exists ? (existing.get('number') as string) : '';
      if (!existing.exists) {
        const value = ((counter.exists ? (counter.get('value') as number) : 0) ?? 0) + 1;
        number = formatInvoiceNumber('FR-AV', 2026, value);
        tx.set(counterRef, { prefix: 'FR-AV', value, seed: true }, { merge: true });
        created += 1;
      }
      const vatRateBps = source.lines[0]?.vatRateBps ?? 2000;
      const vatCents = vatOnHt(spec.htCents, vatRateBps);
      const issued = new Date(`${spec.month}-01T08:00:00Z`);
      issued.setUTCMonth(issued.getUTCMonth() + 1);
      issued.setUTCDate(12);
      const note: Invoice & { seed: true } = {
        ...source,
        number,
        series: 'FR-AV',
        kind: 'credit_note',
        status: 'issued',
        lines: [{ label: spec.label, quantity: 1, unitHtCents: spec.htCents, vatRateBps, htCents: spec.htCents, vatCents, ttcCents: spec.htCents + vatCents }],
        vatSummary: [{ rateBps: vatRateBps, htCents: spec.htCents, vatCents }],
        totalHtCents: spec.htCents,
        totalVatCents: vatCents,
        totalTtcCents: spec.htCents + vatCents,
        creditedInvoiceId: originalRef.id,
        creditNoteIds: [],
        subscriptionId: null,
        pdf: null,
        issuedAt: ts(issued),
        dueAt: null,
        paidAt: null,
        legalMentions: [`Avoir sur la facture ${source.number}.`, 'Montant déduit du prochain reversement.'],
        seed: true,
      };
      tx.set(noteRef, note);
      tx.update(originalRef, { creditNoteIds: FieldValue.arrayUnion(id) });
    });
  }
  return created;
}

// ------------------------------------------------------------------ CRM

const NOTES: Array<{ restaurantId: string; customerId: string; notes: Array<{ body: string; author: string; authorId: string; days: number }> }> = [
  {
    restaurantId: 'mina-kitchen',
    customerId: 'seed-client-045',
    notes: [
      { body: 'Allergie aux fruits à coque signalée par téléphone : pas de muhammara, vérifier les sauces.', author: 'Sofia Martin', authorId: 'seed-note-sofia', days: 21 },
      { body: 'Cliente très fidèle, apprécie une petite attention (baklava offert à la 50e commande).', author: 'Mina Haddad', authorId: 'seed-note-mina', days: 4 },
    ],
  },
  {
    restaurantId: 'mina-kitchen',
    customerId: 'seed-client-033',
    notes: [{ body: 'Préfère une livraison au portail côté parking, l’interphone ne fonctionne pas.', author: 'Sofia Martin', authorId: 'seed-note-sofia', days: 12 }],
  },
  {
    restaurantId: 'mina-kitchen',
    customerId: 'seed-client-028',
    notes: [{ body: 'Commande souvent pour son bureau le vendredi midi : proposer le menu groupe.', author: 'Mina Haddad', authorId: 'seed-note-mina', days: 9 }],
  },
];

const BLOCKED = { restaurantId: 'mina-kitchen', customerId: 'seed-client-004', reason: 'Trois réclamations « article manquant » contestées par le livreur en septembre.' };

async function seedCrm(): Promise<number> {
  let count = 0;
  for (const entry of NOTES) {
    const ref = db.collection(COLLECTIONS.restaurants).doc(entry.restaurantId).collection(SUBCOLLECTIONS.restaurants.customers).doc(entry.customerId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const batch = db.batch();
    entry.notes.forEach((n, i) => {
      const note: CustomerNote & { seed: true } = { body: n.body, authorId: n.authorId, authorName: n.author, createdAt: ts(daysAgo(n.days, 11 + i)), seed: true };
      batch.set(ref.collection(SUBCOLLECTIONS.customers.notes).doc(`seed-note-${i + 1}`), note);
    });
    const latest = [...entry.notes].sort((a, b) => a.days - b.days)[0];
    batch.update(ref, { notesCount: entry.notes.length, internalNote: latest?.body ?? null, tags: FieldValue.arrayUnion(...(entry.customerId === 'seed-client-045' ? ['Allergies', 'VIP'] : ['Entreprise'])) });
    await batch.commit();
    count += entry.notes.length;
  }
  const blockedRef = db.collection(COLLECTIONS.restaurants).doc(BLOCKED.restaurantId).collection(SUBCOLLECTIONS.restaurants.customers).doc(BLOCKED.customerId);
  if ((await blockedRef.get()).exists) {
    await blockedRef.update({ blocked: true, blockedReason: BLOCKED.reason, blockedAt: ts(daysAgo(3)), blockedBy: 'seed-owner-mina-kitchen', tags: FieldValue.arrayUnion('Réclamation') });
  }
  return count;
}

// ------------------------------------------------------------------ Livreurs

const OWN = [
  { id: 'seed-own-mina-1', firstName: 'Karim', lastName: 'Belkacem', email: 'karim.belkacem@golink.test', phone: '+33 6 41 22 18 07', vehicle: 'e_bike' as const, deliveries: 0, pending: false },
  { id: 'seed-own-mina-2', firstName: 'Léna', lastName: 'Rousseau', email: 'lena.rousseau@golink.test', phone: '+33 6 58 90 12 44', vehicle: 'scooter' as const, deliveries: 0, pending: true },
];

async function seedCouriers(): Promise<number> {
  const rid = 'mina-kitchen';
  const couriers = db.collection(COLLECTIONS.restaurants).doc(rid).collection(SUBCOLLECTIONS.restaurants.couriers);
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(rid).get()).data() as { countryId: string; cityId: string };
  const batch = db.batch();
  for (const own of OWN) {
    const displayName = `${own.firstName} ${own.lastName}`;
    const at = ts(daysAgo(own.pending ? 2 : 40));
    const driver: Driver & { seed: true } = {
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      firstName: own.firstName,
      lastName: own.lastName,
      displayName,
      phone: own.phone,
      email: own.email,
      avatar: null,
      type: 'restaurant',
      restaurantIds: [rid],
      vehicle: { type: own.vehicle, plate: null, model: null, color: null },
      zoneIds: [],
      status: own.pending ? 'onboarding' : 'active',
      onboardingStatus: own.pending ? 'draft' : 'approved',
      rejectionReason: null,
      availability: 'offline',
      activeOrderIds: [],
      acceptsCash: false,
      rating: { average: 0, count: 0 },
      stats: { deliveries: 0, acceptanceRate: 0, cancellationRate: 0, onTimeRate: 0, averageDeliveryMinutes: 0 },
      documentsValidUntil: null,
      lastIdentityCheckAt: null,
      lastSeenAt: null,
      searchKeywords: [own.firstName.toLowerCase(), own.lastName.toLowerCase()],
      createdAt: at,
      createdBy: 'seed-owner-mina-kitchen',
      updatedAt: at,
      updatedBy: 'seed-owner-mina-kitchen',
      seed: true,
    };
    batch.set(db.collection(COLLECTIONS.drivers).doc(own.id), driver);
    const courier: RestaurantCourier & { seed: true } = {
      driverId: own.id,
      displayName: `${own.firstName} ${own.lastName.charAt(0)}.`,
      relation: 'own',
      status: own.pending ? 'active' : 'inactive',
      note: own.pending ? null : 'Disponible les soirs de week-end, sac isotherme fourni par le restaurant.',
      deliveriesCount: own.deliveries,
      lastDeliveryAt: null,
      emailMasked: `${own.email.charAt(0)}•••@golink.test`,
      phoneMasked: `+33 6 •• •• •• ${own.phone.slice(-2)}`,
      vehicle: own.vehicle,
      zoneIds: [],
      invitation: { status: own.pending ? 'pending' : 'accepted', sentAt: at, sentBy: 'seed-owner-mina-kitchen', emailSent: true },
      blockedReason: null,
      updatedAt: at,
      updatedBy: 'seed-owner-mina-kitchen',
      seed: true,
    };
    batch.set(couriers.doc(own.id), courier);
  }
  // Préférences sur deux livreurs de la flotte.
  batch.update(couriers.doc('seed-driver-007'), { status: 'inactive', note: 'Plusieurs remises tardives en soirée : écarté temporairement.', updatedBy: 'seed-owner-mina-kitchen' });
  batch.update(couriers.doc('seed-driver-005'), {
    status: 'blocked',
    blockedReason: 'Comportement inapproprié signalé par deux clients.',
    note: 'Signalement transmis au support GoLink.',
    updatedBy: 'seed-owner-mina-kitchen',
  });
  await batch.commit();
  return OWN.length + 2;
}

async function main(): Promise<void> {
  const credits = await seedCreditNotes();
  const notes = await seedCrm();
  const couriers = await seedCouriers();
  console.log(`Avoirs créés : ${credits} · notes CRM : ${notes} · livreurs mis à jour : ${couriers}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
