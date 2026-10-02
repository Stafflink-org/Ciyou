// Test réel cdc-fix-residuals-47 (§3 Finance/Analytics, balayage isAdmin vs isAdminIn —
// nouvelle fournée trouvée en auditant §4/§15/§18) : 12 règles Firestore supplémentaires
// vérifiaient seulement `isAdmin(permission)` (sans ville NI pays) alors que leurs documents
// portent un `cityId`/`countryId` exploitable et que les Cloud Functions équivalentes
// (`getFinanceOverview`, `scopeCities`/`scopeCountry`) appliquent déjà cette restriction.
// Contrairement aux occurrences déjà corrigées ce segment (toutes liées à `city_manager`),
// celle-ci est exploitable par N'IMPORTE QUEL rôle scopé par ville/pays via le champ libre
// « Pays »/« Villes » de l'écran Administrateurs (`resolveCityScope`, functions/src/lib/
// permissions.ts) — pas seulement `city_manager`.
//
// Corrigé (`firebase/rules/_helpers.rules` : nouveaux `isAdminInCountry`/`isAdminInGeoFilter` ;
// `orders.rules`, `finance.rules`, `restaurants.rules`, `argent.rules`, `admin.rules`) :
//  - `orderFinancials`, `payments`, `ledgerEntries`, `payouts`, `payoutHolds`, `invoices`,
//    `subscriptions`, `cashMovements` : `isAdminIn(perm, cityId)`.
//  - `taxReports`, `commissionRules` (scopés par PAYS, pas de ville) : `isAdminInCountry`.
//  - `restaurants/{rid}/private/commercial` (déclarée EN DOUBLE dans `restaurants.rules` ET
//    `argent.rules`, les deux étaient fautives) : `isAdminIn(perm, <ville du restaurant>)`.
//  - `scheduledReports` (filtres géographiques libres `filters.cityIds`/`filters.countryId`) :
//    nouveau `isAdminInGeoFilter`, un rapport sans aucun filtre (portée plateforme) n'est
//    désormais visible que par un admin non restreint.
//
// Test réel contre les règles de PRODUCTION (golink-9f16d) : un compte administrateur JETABLE
// avec toutes les permissions concernées, restreint à Metz (FR) ET au pays FR, contre des
// documents Metz/FR (doit lire) et Longwy/Maroc (doit être refusé, correctif attendu).
//
//   npx tsx scripts/tests/cdc-fix-residuals-47.flow.mjs
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auth, db } from '../lib/admin.mjs';
import { CLI_CLIENT_ID, CLI_CLIENT_SECRET, PROJECT_ID, readCliRefreshToken } from '../gcp-token.mjs';

const adcPath = join(tmpdir(), `cdcres47-adc-${process.pid}.json`);
writeFileSync(adcPath, JSON.stringify({ type: 'authorized_user', client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: readCliRefreshToken() }));
process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const { syncClaims } = await import('../../functions/src/lib/claims.ts');

const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TEST_UID = 'cdcres47-admin';
const RESTO_METZ = 'cdcres47-resto-metz';
const RESTO_LONGWY = 'cdcres47-resto-longwy';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function signInWithPassword(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(json));
  return json.idToken;
}
async function get(token, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: await res.json() };
}
const allowed = (res) => res.status === 200 && !res.json?.error;
const denied = (res) => res.status === 403 || res.json?.error?.status === 'PERMISSION_DENIED';

async function main() {
  const now = new Date();

  await db.doc(`restaurants/${RESTO_METZ}`).set({ name: 'CDCRES47 Metz', cityId: 'metz', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now, updatedAt: now, updatedBy: 'system' });
  await db.doc(`restaurants/${RESTO_LONGWY}`).set({ name: 'CDCRES47 Longwy', cityId: 'longwy', countryId: 'FR', status: 'active', onboardingStatus: 'approved', test: true, createdAt: now, updatedAt: now, updatedBy: 'system' });
  await db.doc(`restaurants/${RESTO_METZ}/private/commercial`).set({ planCode: 'basic', subscriptionStatus: 'active', test: true });
  await db.doc(`restaurants/${RESTO_LONGWY}/private/commercial`).set({ planCode: 'basic', subscriptionStatus: 'active', test: true });

  const localized = (cityId, countryId) => ({ cityId, countryId, test: true, createdAt: now, updatedAt: now });

  await db.doc('orderFinancials/cdcres47-of-metz').set({ orderId: 'x', ...localized('metz', 'FR') });
  await db.doc('orderFinancials/cdcres47-of-longwy').set({ orderId: 'x', ...localized('longwy', 'FR') });

  await db.doc('payments/cdcres47-pay-metz').set({ purpose: 'subscription', payerType: 'restaurant', payerId: RESTO_METZ, method: 'card', amountCents: 100, currency: 'EUR', status: 'succeeded', provider: 'stripe', feeCents: 0, attempts: 1, refundedCents: 0, ...localized('metz', 'FR') });
  await db.doc('payments/cdcres47-pay-longwy').set({ purpose: 'subscription', payerType: 'restaurant', payerId: RESTO_LONGWY, method: 'card', amountCents: 100, currency: 'EUR', status: 'succeeded', provider: 'stripe', feeCents: 0, attempts: 1, refundedCents: 0, ...localized('longwy', 'FR') });

  await db.doc('ledgerEntries/cdcres47-ledger-metz').set({ accountType: 'restaurant', accountId: RESTO_METZ, type: 'commission', amountCents: 100, currency: 'EUR', description: 'test', bookingDate: '2026-10-02', createdBy: 'system', ...localized('metz', 'FR') });
  await db.doc('ledgerEntries/cdcres47-ledger-longwy').set({ accountType: 'restaurant', accountId: RESTO_LONGWY, type: 'commission', amountCents: 100, currency: 'EUR', description: 'test', bookingDate: '2026-10-02', createdBy: 'system', ...localized('longwy', 'FR') });

  await db.doc('payouts/cdcres47-payout-metz').set({ beneficiaryType: 'restaurant', beneficiaryId: RESTO_METZ, beneficiaryName: 'x', periodStart: '2026-10-01', periodEnd: '2026-10-01', grossCents: 0, commissionCents: 0, refundsChargedCents: 0, adjustmentsCents: 0, tipsCents: 0, cashDeductedCents: 0, netCents: 0, entriesCount: 0, status: 'scheduled', scheduledFor: now, ...localized('metz', 'FR') });
  await db.doc('payouts/cdcres47-payout-longwy').set({ beneficiaryType: 'restaurant', beneficiaryId: RESTO_LONGWY, beneficiaryName: 'x', periodStart: '2026-10-01', periodEnd: '2026-10-01', grossCents: 0, commissionCents: 0, refundsChargedCents: 0, adjustmentsCents: 0, tipsCents: 0, cashDeductedCents: 0, netCents: 0, entriesCount: 0, status: 'scheduled', scheduledFor: now, ...localized('longwy', 'FR') });

  await db.doc('payoutHolds/cdcres47-hold-metz').set({ beneficiaryType: 'restaurant', beneficiaryId: RESTO_METZ, reason: 'other', active: true, cityId: 'metz', countryId: 'FR', test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });
  await db.doc('payoutHolds/cdcres47-hold-longwy').set({ beneficiaryType: 'restaurant', beneficiaryId: RESTO_LONGWY, reason: 'other', active: true, cityId: 'longwy', countryId: 'FR', test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });

  await db.doc('invoices/cdcres47-inv-metz').set({ number: 'T1', series: 'test', kind: 'subscription_invoice', status: 'paid', issuer: { type: 'platform', name: 'x' }, recipient: { type: 'restaurant', id: RESTO_METZ, name: 'x' }, selfBilling: false, lines: [], vatSummary: [], totalHtCents: 0, totalVatCents: 0, totalTtcCents: 0, currency: 'EUR', creditNoteIds: [], issuedAt: now, legalMentions: [], retainUntil: '2099-01-01', ...localized('metz', 'FR') });
  await db.doc('invoices/cdcres47-inv-longwy').set({ number: 'T2', series: 'test', kind: 'subscription_invoice', status: 'paid', issuer: { type: 'platform', name: 'x' }, recipient: { type: 'restaurant', id: RESTO_LONGWY, name: 'x' }, selfBilling: false, lines: [], vatSummary: [], totalHtCents: 0, totalVatCents: 0, totalTtcCents: 0, currency: 'EUR', creditNoteIds: [], issuedAt: now, legalMentions: [], retainUntil: '2099-01-01', ...localized('longwy', 'FR') });

  await db.doc('subscriptions/cdcres47-sub-metz').set({ subscriberType: 'restaurant', subscriberId: RESTO_METZ, planCode: 'basic', status: 'active', ...localized('metz', 'FR') });
  await db.doc('subscriptions/cdcres47-sub-longwy').set({ subscriberType: 'restaurant', subscriberId: RESTO_LONGWY, planCode: 'basic', status: 'active', ...localized('longwy', 'FR') });

  await db.doc('cashMovements/cdcres47-cash-metz').set({ restaurantId: RESTO_METZ, countryId: 'FR', cityId: 'metz', test: true });
  await db.doc('cashMovements/cdcres47-cash-longwy').set({ restaurantId: RESTO_LONGWY, countryId: 'FR', cityId: 'longwy', test: true });

  await db.doc('taxReports/cdcres47-tax-fr').set({ type: 'vat', countryId: 'FR', period: '2026-09', status: 'ready', test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });
  await db.doc('taxReports/cdcres47-tax-ma').set({ type: 'vat', countryId: 'MA', period: '2026-09', status: 'ready', test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });

  await db.doc('commissionRules/cdcres47-rule-fr').set({ scope: 'country', countryId: 'FR', test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });
  await db.doc('commissionRules/cdcres47-rule-ma').set({ scope: 'country', countryId: 'MA', test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });

  await db.doc('scheduledReports/cdcres47-report-metz').set({ name: 'Test Metz', report: 'finance', frequency: 'daily', recipients: ['x@golink.test'], filters: { countryId: null, cityIds: ['metz'] }, format: 'csv', active: true, nextRunAt: now, test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });
  await db.doc('scheduledReports/cdcres47-report-longwy').set({ name: 'Test Longwy', report: 'finance', frequency: 'daily', recipients: ['x@golink.test'], filters: { countryId: null, cityIds: ['longwy'] }, format: 'csv', active: true, nextRunAt: now, test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });
  await db.doc('scheduledReports/cdcres47-report-platform').set({ name: 'Test Plateforme', report: 'finance', frequency: 'daily', recipients: ['x@golink.test'], filters: { countryId: null, cityIds: null }, format: 'csv', active: true, nextRunAt: now, test: true, createdAt: now, createdBy: 'system', updatedAt: now, updatedBy: 'system' });

  const password = `${randomBytes(18).toString('base64url')}Aa1`;
  await auth.deleteUser(TEST_UID).catch(() => {});
  await auth.createUser({ uid: TEST_UID, email: 'cdcres47-admin@golink.test', password, emailVerified: true, displayName: 'CDCRES47 Admin' });
  await db.doc(`admins/${TEST_UID}`).set({
    role: 'city_manager', active: true,
    permissions: ['finance.view', 'payments.view', 'invoices.view', 'tax.reports', 'subscriptions.manage', 'commissions.edit', 'restaurants.commercial', 'reports.view'],
    cityIds: ['metz'], countryIds: ['FR'], displayName: 'CDCRES47 Admin', email: 'cdcres47-admin@golink.test', test: true, createdAt: now, updatedAt: now, updatedBy: 'system',
  });
  await syncClaims(TEST_UID);

  try {
    const token = await signInWithPassword('cdcres47-admin@golink.test', password);

    const cases = [
      ['orderFinancials', 'orderFinancials/cdcres47-of-metz', 'orderFinancials/cdcres47-of-longwy'],
      ['payments', 'payments/cdcres47-pay-metz', 'payments/cdcres47-pay-longwy'],
      ['ledgerEntries', 'ledgerEntries/cdcres47-ledger-metz', 'ledgerEntries/cdcres47-ledger-longwy'],
      ['payouts', 'payouts/cdcres47-payout-metz', 'payouts/cdcres47-payout-longwy'],
      ['payoutHolds', 'payoutHolds/cdcres47-hold-metz', 'payoutHolds/cdcres47-hold-longwy'],
      ['invoices', 'invoices/cdcres47-inv-metz', 'invoices/cdcres47-inv-longwy'],
      ['subscriptions', 'subscriptions/cdcres47-sub-metz', 'subscriptions/cdcres47-sub-longwy'],
      ['cashMovements', 'cashMovements/cdcres47-cash-metz', 'cashMovements/cdcres47-cash-longwy'],
      ['taxReports (pays)', 'taxReports/cdcres47-tax-fr', 'taxReports/cdcres47-tax-ma'],
      ['commissionRules (pays)', 'commissionRules/cdcres47-rule-fr', 'commissionRules/cdcres47-rule-ma'],
      ['restaurants/private/commercial', `restaurants/${RESTO_METZ}/private/commercial`, `restaurants/${RESTO_LONGWY}/private/commercial`],
      ['scheduledReports (filtre ville)', 'scheduledReports/cdcres47-report-metz', 'scheduledReports/cdcres47-report-longwy'],
    ];
    for (const [label, pathInScope, pathOutOfScope] of cases) {
      const resIn = await get(token, pathInScope);
      record(`${label} : dans le périmètre LISIBLE`, allowed(resIn), `status=${resIn.status} ${resIn.json?.error?.message ?? ''}`);
      const resOut = await get(token, pathOutOfScope);
      record(`${label} : hors périmètre REFUSÉ (correctif attendu)`, denied(resOut), `status=${resOut.status}`);
    }
    const resPlatform = await get(token, 'scheduledReports/cdcres47-report-platform');
    record('scheduledReports (portée plateforme, sans filtre) : REFUSÉ pour un admin restreint (correctif attendu)', denied(resPlatform), `status=${resPlatform.status}`);
  } finally {
    const paths = [
      `restaurants/${RESTO_METZ}`, `restaurants/${RESTO_LONGWY}`,
      `restaurants/${RESTO_METZ}/private/commercial`, `restaurants/${RESTO_LONGWY}/private/commercial`,
      'orderFinancials/cdcres47-of-metz', 'orderFinancials/cdcres47-of-longwy',
      'payments/cdcres47-pay-metz', 'payments/cdcres47-pay-longwy',
      'ledgerEntries/cdcres47-ledger-metz', 'ledgerEntries/cdcres47-ledger-longwy',
      'payouts/cdcres47-payout-metz', 'payouts/cdcres47-payout-longwy',
      'payoutHolds/cdcres47-hold-metz', 'payoutHolds/cdcres47-hold-longwy',
      'invoices/cdcres47-inv-metz', 'invoices/cdcres47-inv-longwy',
      'subscriptions/cdcres47-sub-metz', 'subscriptions/cdcres47-sub-longwy',
      'cashMovements/cdcres47-cash-metz', 'cashMovements/cdcres47-cash-longwy',
      'taxReports/cdcres47-tax-fr', 'taxReports/cdcres47-tax-ma',
      'commissionRules/cdcres47-rule-fr', 'commissionRules/cdcres47-rule-ma',
      'scheduledReports/cdcres47-report-metz', 'scheduledReports/cdcres47-report-longwy', 'scheduledReports/cdcres47-report-platform',
      `admins/${TEST_UID}`, `users/${TEST_UID}`, `userPrivate/${TEST_UID}`,
    ];
    await Promise.all(paths.map((p) => db.doc(p).delete().catch(() => {})));
    await auth.deleteUser(TEST_UID).catch(() => {});
  }
}

main()
  .catch((error) => record('exception', false, String(error.stack ?? error)))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} OK`);
    if (failed.length) {
      console.log('Échecs :');
      for (const f of failed) console.log(` - ${f.name} : ${f.detail}`);
      process.exitCode = 1;
    }
  });
