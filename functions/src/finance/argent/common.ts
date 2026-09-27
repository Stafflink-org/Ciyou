// Outils communs des fonctions « Argent » du super admin : dates au fuseau de Paris,
// périmètre géographique, numérotation continue des factures, parties (émetteur,
// destinataire), lignes et totaux de TVA, e-mails sans envoi réel vers les adresses
// de démonstration.
import {
  COLLECTIONS,
  INVOICE_RETENTION_YEARS,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  formatInvoiceNumber,
  maskEmail,
  vatOnHt,
  type AdminUser,
  type Country,
  type DriverPrivate,
  type Driver,
  type InvoiceLine,
  type InvoiceParty,
  type NotificationLog,
  type Restaurant,
  type RestaurantLegal,
} from '@golink/shared';
import type { Transaction } from 'firebase-admin/firestore';
import { db, FieldValue } from '../../lib/admin';
import { sendEmail, type SendEmailInput } from '../../lib/brevo';
import { fail } from '../../lib/errors';

export const TIMEZONE = 'Europe/Paris';
export const DAY_MS = 86_400_000;

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function parisClock(date: Date): { day: string; hour: number; minute: number; weekday: number } {
  const parts = partsFormat.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

export function parisDay(date: Date): string {
  return parisClock(date).day;
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = lundi … 6 = dimanche. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Instant UTC de `day` à `hour`:00, heure de Paris. */
export function parisTime(day: string, hour = 0): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d, hour, 0));
  const local = parisClock(utc);
  let offset = local.hour * 60 + local.minute - hour * 60;
  if (local.day !== day) offset += local.day > day ? 24 * 60 : -24 * 60;
  return new Date(utc.getTime() - offset * 60_000);
}

/** Bornes [début du premier jour, fin du dernier jour[ au fuseau de Paris. */
export function rangeBounds(from: string, to: string): { start: Date; end: Date } {
  return { start: parisTime(from, 0), end: parisTime(addDays(to, 1), 0) };
}

/** Mois « AAAA-MM » : premier et dernier jour. */
export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first: `${month}-01`, last };
}

export function previousMonth(date = new Date()): string {
  const day = parisDay(date);
  const [y, m] = day.split('-').map(Number) as [number, number];
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return prev.toISOString().slice(0, 7);
}

export const zDay = /^\d{4}-\d{2}-\d{2}$/;
export const zMonth = /^\d{4}-(0[1-9]|1[0-2])$/;

// ------------------------------------------------------------------ Périmètre

/** Villes visibles par l'administrateur dans le filtre demandé (null = toutes). */
export function scopeCities(admin: AdminUser, cityIds: string[] | null | undefined): string[] | null {
  const restricted = admin.role !== 'super_admin' && admin.cityIds.length > 0;
  if (cityIds && cityIds.length > 0) {
    if (restricted && cityIds.some((id) => !admin.cityIds.includes(id))) throw fail.forbidden('Cette ville est hors de votre périmètre.');
    return cityIds;
  }
  return restricted ? admin.cityIds : null;
}

export function scopeCountry(admin: AdminUser, countryId: string | null | undefined): string | null {
  if (countryId && admin.role !== 'super_admin' && admin.countryIds.length > 0 && !admin.countryIds.includes(countryId)) {
    throw fail.forbidden('Ce pays est hors de votre périmètre.');
  }
  return countryId ?? null;
}

export function inScope(doc: { countryId?: string | null; cityId?: string | null }, countryId: string | null, cityIds: string[] | null): boolean {
  if (countryId && doc.countryId !== countryId) return false;
  if (cityIds && (!doc.cityId || !cityIds.includes(doc.cityId))) return false;
  return true;
}

// ------------------------------------------------------------------ Facturation

/** Réserve le prochain numéro d'une série (transaction obligatoire : numérotation continue, sans trou). */
export async function nextInvoiceNumber(tx: Transaction, series: string, year: number): Promise<string> {
  const ref = db.collection(COLLECTIONS.counters).doc(`invoice_${series}`);
  const snap = await tx.get(ref);
  const value = (snap.exists ? Number(snap.get('value') ?? 0) : 0) + 1;
  tx.set(ref, { value, prefix: series, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return formatInvoiceNumber(series, year, value);
}

export function invoiceLine(label: string, quantity: number, unitHtCents: number, vatRateBps: number): InvoiceLine {
  const htCents = unitHtCents * quantity;
  const vatCents = vatOnHt(htCents, vatRateBps);
  return { label, quantity, unitHtCents, vatRateBps, htCents, vatCents, ttcCents: htCents + vatCents };
}

export function invoiceTotals(lines: InvoiceLine[]) {
  const byRate = new Map<number, { rateBps: number; htCents: number; vatCents: number }>();
  for (const line of lines) {
    const total = byRate.get(line.vatRateBps) ?? { rateBps: line.vatRateBps, htCents: 0, vatCents: 0 };
    total.htCents += line.htCents;
    total.vatCents += line.vatCents;
    byRate.set(line.vatRateBps, total);
  }
  const vatSummary = [...byRate.values()].sort((a, b) => b.rateBps - a.rateBps);
  const totalHtCents = vatSummary.reduce((s, t) => s + t.htCents, 0);
  const totalVatCents = vatSummary.reduce((s, t) => s + t.vatCents, 0);
  return { vatSummary, totalHtCents, totalVatCents, totalTtcCents: totalHtCents + totalVatCents };
}

export function retainUntil(year: number): string {
  return `${year + INVOICE_RETENTION_YEARS}-12-31`;
}

const countryCache = new Map<string, { at: number; country: Country | null }>();

export async function loadCountry(countryId: string): Promise<Country | null> {
  const cached = countryCache.get(countryId);
  if (cached && Date.now() - cached.at < 60_000) return cached.country;
  const snap = await db.collection(COLLECTIONS.countries).doc(countryId).get();
  const country = snap.exists ? (snap.data() as Country) : null;
  countryCache.set(countryId, { at: Date.now(), country });
  return country;
}

export function platformParty(countryId: string, country: Country | null): InvoiceParty {
  const entity = country?.billingEntity;
  return {
    type: 'platform',
    id: `golink-${countryId.toLowerCase()}`,
    name: entity?.legalName ?? 'GoLink',
    address: entity?.address ?? '',
    vatNumber: entity?.vatNumber || null,
    registrationNumber: entity?.registrationNumber || null,
    email: null,
  };
}

/** Préfixe de série du pays (billingEntity.invoicePrefix, sinon code pays). */
export function seriesPrefix(countryId: string, country: Country | null): string {
  return country?.billingEntity?.invoicePrefix || countryId;
}

export async function restaurantParty(restaurantId: string): Promise<{ party: InvoiceParty; restaurant: Restaurant }> {
  const ref = db.collection(COLLECTIONS.restaurants).doc(restaurantId);
  const [snap, legalSnap] = await Promise.all([
    ref.get(),
    ref.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal).get(),
  ]);
  if (!snap.exists) throw fail.notFound('Commerce');
  const restaurant = snap.data() as Restaurant;
  const legal = legalSnap.exists ? (legalSnap.data() as RestaurantLegal) : null;
  const address = legal?.registeredAddress ?? restaurant.address;
  return {
    restaurant,
    party: {
      type: 'restaurant',
      id: restaurantId,
      name: legal?.legalName ? `${legal.legalName} (${restaurant.name})` : restaurant.name,
      address: `${address.line1}, ${address.postalCode} ${address.city}`,
      vatNumber: legal?.vatNumber ?? null,
      registrationNumber: legal?.siret ? `SIRET ${legal.siret}` : null,
      email: legal?.managerEmail ?? restaurant.email ?? null,
    },
  };
}

export async function driverParty(uid: string): Promise<{ party: InvoiceParty; driver: Driver; priv: DriverPrivate | null }> {
  const [snap, privSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).doc(uid).get(),
    db.collection(COLLECTIONS.driverPrivate).doc(uid).get(),
  ]);
  if (!snap.exists) throw fail.notFound('Livreur');
  const driver = snap.data() as Driver;
  const priv = privSnap.exists ? (privSnap.data() as DriverPrivate) : null;
  const address = priv?.address ? `${priv.address.line1}, ${priv.address.postalCode} ${priv.address.city}` : '';
  return {
    driver,
    priv,
    party: {
      type: 'driver',
      id: uid,
      name: `${driver.firstName} ${driver.lastName}`.trim(),
      address,
      vatNumber: priv?.vatNumber ?? null,
      registrationNumber: priv?.siret ? `SIRET ${priv.siret}` : null,
      email: driver.email ?? null,
    },
  };
}

// ------------------------------------------------------------------ E-mails

/** Domaines de démonstration : aucun envoi réel, l'envoi est seulement journalisé. */
function isDemoAddress(email: string): boolean {
  return /\.(test|example|invalid|localhost)$/i.test(email.split('@')[1] ?? '');
}

/**
 * Envoie un e-mail, sauf vers une adresse de démonstration (.test…) : l'envoi est
 * alors journalisé comme simulé, sans appel au prestataire.
 */
export async function sendFinanceEmail(input: SendEmailInput): Promise<{ ok: boolean; simulated: boolean }> {
  if (isDemoAddress(input.to.email)) {
    const log: Omit<NotificationLog, 'createdAt' | 'updatedAt'> & { createdAt: FieldValue; updatedAt: FieldValue } = {
      channel: 'email',
      templateKey: input.templateKey,
      campaignId: null,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      destinationMasked: maskEmail(input.to.email),
      status: 'queued',
      provider: 'brevo',
      providerMessageId: null,
      error: 'Adresse de démonstration : envoi simulé',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection(COLLECTIONS.notificationLogs).add(log);
    return { ok: true, simulated: true };
  }
  const result = await sendEmail(input);
  return { ok: result.ok, simulated: false };
}

/** Montant lisible pour les e-mails : 123456 → « 1 234,56 € ». */
export function euros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100).replace(/[  ]/g, ' ');
}

/** Découpe une liste d'identifiants en paquets (requêtes `in` limitées à 30). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
