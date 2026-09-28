// Relevé détaillé d'un reversement restaurant : données faisant foi, lues côté
// serveur (grand livre, identité légale de l'établissement et de l'entité Ciyou Eats),
// mises en page en PDF par le back-office.
import {
  COLLECTIONS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type Country,
  type LedgerEntry,
  type Payout,
  type Restaurant,
  type RestaurantLegal,
} from '@golink/shared';
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { requireRestaurantAccess } from '../lib/permissions';
import { z, zId } from '../lib/validation';

export interface StatementLine {
  entryId: string;
  bookingDate: string;
  type: LedgerEntry['type'];
  description: string;
  orderId: string | null;
  refundId: string | null;
  amountCents: number;
  vatCents: number | null;
}

export interface StatementResult {
  payout: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: Payout['status'];
    grossCents: number;
    commissionCents: number;
    refundsChargedCents: number;
    adjustmentsCents: number;
    tipsCents: number;
    cashDeductedCents: number;
    netCents: number;
    scheduledFor: string | null;
    paidAt: string | null;
    providerTransferId: string | null;
    failureReason: string | null;
  };
  restaurant: {
    id: string;
    name: string;
    legalName: string | null;
    siret: string | null;
    vatNumber: string | null;
    address: string;
    ibanMasked: string | null;
  };
  issuer: { legalName: string; vatNumber: string; registrationNumber: string; address: string };
  lines: StatementLine[];
  orderNumbers: Record<string, string>;
  totals: { byType: Record<string, number>; vatCents: number; linesCount: number };
  generatedAt: string;
}

const iso = (value: AdminTimestamp | null | undefined): string | null => (value ? value.toDate().toISOString() : null);

const DEFAULT_ISSUER: StatementResult['issuer'] = {
  legalName: 'Ciyou Eats SAS',
  vatNumber: '',
  registrationNumber: '',
  address: '',
};

export const generateStatement = callable(z.object({ payoutId: zId }), async (data, request) => {
  const payoutSnap = await db.collection(COLLECTIONS.payouts).doc(data.payoutId).get();
  if (!payoutSnap.exists) throw fail.notFound('Reversement');
  const payout = payoutSnap.data() as Payout;
  if (payout.beneficiaryType !== 'restaurant') throw fail.forbidden();
  const restaurantId = payout.beneficiaryId;
  const access = await requireRestaurantAccess(request, restaurantId, 'finance.view', 'finance.view');

  const restaurantRef = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
  const [restaurantSnap, legalSnap, countrySnap, entriesSnap] = await Promise.all([
    restaurantRef.get(),
    restaurantRef.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal).get(),
    db.collection(COLLECTIONS.countries).doc(payout.countryId).get(),
    db
      .collection(COLLECTIONS.ledgerEntries)
      .where('accountType', '==', 'restaurant')
      .where('accountId', '==', restaurantId)
      .where('payoutId', '==', data.payoutId)
      .orderBy('createdAt', 'asc')
      .limit(5000)
      .get(),
  ]);
  if (!restaurantSnap.exists) throw fail.notFound('Restaurant');
  const restaurant = restaurantSnap.data() as Restaurant;
  const legal = legalSnap.exists ? (legalSnap.data() as RestaurantLegal) : null;
  const country = countrySnap.exists ? (countrySnap.data() as Country) : null;

  const lines: StatementLine[] = entriesSnap.docs.map((doc) => {
    const entry = doc.data() as LedgerEntry;
    return {
      entryId: doc.id,
      bookingDate: entry.bookingDate,
      type: entry.type,
      description: entry.description,
      orderId: entry.orderId ?? null,
      refundId: entry.refundId ?? null,
      amountCents: entry.amountCents,
      vatCents: entry.vatCents ?? null,
    };
  });

  // Numéros de commande lisibles (GL-xxxxx) pour le relevé.
  const orderIds = [...new Set(lines.map((line) => line.orderId).filter((id): id is string => Boolean(id)))];
  const orderNumbers: Record<string, string> = {};
  for (let i = 0; i < orderIds.length; i += 100) {
    const refs = orderIds.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.orders).doc(id));
    const snaps = refs.length ? await db.getAll(...refs, { fieldMask: ['number'] }) : [];
    for (const snap of snaps) if (snap.exists) orderNumbers[snap.id] = String(snap.get('number') ?? snap.id);
  }

  const byType: Record<string, number> = {};
  let vatCents = 0;
  for (const line of lines) {
    byType[line.type] = (byType[line.type] ?? 0) + line.amountCents;
    vatCents += line.vatCents ?? 0;
  }

  // Consultation par l'équipe interne : tracée (données financières d'un commerce).
  if (access.kind === 'admin') {
    await writeAudit({
      actor: actorFromCaller(access.caller, 'admin'),
      action: 'statement.viewed',
      target: { type: 'restaurant', id: restaurantId, label: restaurant.name },
      after: { payoutId: data.payoutId, lines: lines.length },
      countryId: restaurant.countryId,
      cityId: restaurant.cityId,
      request,
    });
  }
  const address = legal?.registeredAddress ?? restaurant.address;
  const result: StatementResult = {
    payout: {
      id: payoutSnap.id,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      status: payout.status,
      grossCents: payout.grossCents,
      commissionCents: payout.commissionCents,
      refundsChargedCents: payout.refundsChargedCents,
      adjustmentsCents: payout.adjustmentsCents,
      tipsCents: payout.tipsCents,
      cashDeductedCents: payout.cashDeductedCents,
      netCents: payout.netCents,
      scheduledFor: iso(payout.scheduledFor as unknown as AdminTimestamp),
      paidAt: iso(payout.paidAt as unknown as AdminTimestamp | null),
      providerTransferId: payout.providerTransferId ?? null,
      failureReason: payout.failureReason ?? null,
    },
    restaurant: {
      id: restaurantId,
      name: restaurant.name,
      legalName: legal?.legalName ?? null,
      siret: legal?.siret ?? null,
      vatNumber: legal?.vatNumber ?? null,
      address: `${address.line1}, ${address.postalCode} ${address.city}`,
      ibanMasked: legal?.ibanMasked ?? null,
    },
    issuer: country?.billingEntity
      ? {
          legalName: country.billingEntity.legalName,
          vatNumber: country.billingEntity.vatNumber,
          registrationNumber: country.billingEntity.registrationNumber,
          address: country.billingEntity.address,
        }
      : DEFAULT_ISSUER,
    lines,
    orderNumbers,
    totals: { byType, vatCents, linesCount: lines.length },
    generatedAt: new Date().toISOString(),
  };
  return result;
});
