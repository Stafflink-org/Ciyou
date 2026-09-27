// Contrôle réel des Cloud Functions du pilotage super admin (tableau de bord,
// analytics, recherche, exports, rapports programmés, alertes), avec des comptes
// qui ont le droit et d'autres qui ne l'ont pas. Aucun e-mail n'est envoyé
// (aperçus en dryRun) ; les écritures de test sont supprimées à la fin.
//
// Usage : node scripts/tests/a-pilotage.functions.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/admin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const accounts = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accounts.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];

const config = {
  apiKey: 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM',
  authDomain: 'golink-9f16d.firebaseapp.com',
  projectId: 'golink-9f16d',
  storageBucket: 'golink-9f16d.firebasestorage.app',
  appId: '1:683198090102:web:3640bfa24dd0d325910857',
};

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function session(email) {
  const app = initializeApp(config, email);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, passwordOf(email));
  const functions = getFunctions(app, 'europe-west1');
  return {
    uid: auth.currentUser.uid,
    call: (name, data) => httpsCallable(functions, name, { timeout: 180_000 })(data).then((r) => r.data),
    close: async () => {
      await signOut(auth);
      await deleteApp(app);
    },
  };
}

async function expectError(name, promise, code) {
  try {
    await promise;
    record(name, false, 'aucune erreur');
  } catch (error) {
    const ok = error.code === `functions/${code}`;
    record(name, ok, `${error.code} : ${error.message}`);
  }
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
  } catch (error) {
    record(name, false, `${error.code ?? ''} ${error.message}`);
  }
}

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const period = { from: day(-29), to: day(0) };
const compare = { compareFrom: day(-59), compareTo: day(-30) };
const createdJobs = [];

// ------------------------------------------------------------------ Super admin
const admin = await session('superadmin@golink.test');
await check('Vue d’ensemble (super admin)', async () => {
  const r = await admin.call('getPilotageOverview', { ...period, ...compare });
  if (!r.counters?.restaurants?.total) throw new Error('compteurs vides');
  return `${r.counters.restaurants.total} commerces, ${r.counters.drivers.registered} livreurs, ${r.activity.length} activités`;
});
await check('Vue d’ensemble par formule Pro', async () => {
  const r = await admin.call('getPilotageOverview', { ...period, ...compare, planCode: 'pro' });
  if (!r.planKpis) throw new Error('planKpis absent');
  return `${r.planKpis.current.ordersPlaced} commandes, ${r.planKpis.daily.length} jours`;
});
for (const section of ['growth', 'restaurants', 'drivers', 'cities', 'subscriptions', 'funnel']) {
  await check(`Analytics « ${section} »`, async () => {
    const r = await admin.call('getPilotageAnalytics', { ...period, section });
    const part = { growth: r.growth, restaurants: r.restaurants, drivers: r.drivers, cities: r.cities, subscriptions: r.subscriptions, funnel: r.funnel }[section];
    if (!part) throw new Error('section absente');
    return JSON.stringify(part).length + ' octets';
  });
}
await check('Recherche par numéro de commande', async () => {
  const order = (await db.collection('orders').orderBy('createdAt', 'desc').limit(1).get()).docs[0].data();
  const r = await admin.call('globalSearch', { query: order.number });
  const hit = r.groups.find((g) => g.type === 'order')?.hits[0];
  if (!hit || !hit.title.includes(order.number)) throw new Error(`commande ${order.number} introuvable`);
  return `${order.number} trouvée en ${r.tookMs} ms`;
});
await check('Recherche par nom (groupes)', async () => {
  const r = await admin.call('globalSearch', { query: 'mina' });
  return r.groups.map((g) => `${g.type}:${g.hits.length}`).join(', ');
});
await expectError('Recherche trop courte refusée', admin.call('globalSearch', { query: 'm' }), 'invalid-argument');
for (const [entity, format, filters] of [
  ['orders', 'csv', { from: day(-6), to: day(0) }],
  ['restaurants', 'xlsx', {}],
  ['stats', 'pdf', { from: day(-13), to: day(0) }],
  ['drivers', 'csv', { cityIds: ['metz'] }],
]) {
  await check(`Export ${entity} (${format})`, async () => {
    const r = await admin.call('exportData', { entity, format, filters, reason: 'Contrôle automatisé du module Pilotage' });
    createdJobs.push(r.jobId);
    const bytes = Buffer.from(r.contentBase64, 'base64');
    const signature = format === 'pdf' ? bytes.subarray(0, 4).toString() : format === 'xlsx' ? bytes.subarray(0, 2).toString() : 'csv';
    if (format === 'pdf' && signature !== '%PDF') throw new Error('PDF invalide');
    if (format === 'xlsx' && signature !== 'PK') throw new Error('XLSX invalide');
    return `${r.rowCount} lignes, ${bytes.length} octets, ${r.fileName}`;
  });
}
await expectError('Export : période inversée refusée', admin.call('exportData', { entity: 'orders', format: 'csv', filters: { from: day(0), to: day(-3) } }), 'invalid-argument');

let reportId = null;
await check('Rapport programmé : création', async () => {
  const r = await admin.call('saveScheduledReport', {
    name: 'Contrôle automatisé Pilotage',
    report: 'daily_summary',
    frequency: 'weekly',
    recipients: ['controle-pilotage@golink.test'],
    format: 'pdf',
    hour: 6,
    countryId: null,
    cityIds: null,
    active: false,
  });
  reportId = r.id;
  await db.collection('scheduledReports').doc(r.id).update({ test: true });
  return `id ${r.id}, prochain envoi ${r.nextRunAt}`;
});
if (reportId) {
  for (const report of ['daily_summary', 'finance', 'orders', 'restaurants', 'drivers', 'support']) {
    await check(`Rapport « ${report} » : aperçu sans envoi`, async () => {
      await admin.call('saveScheduledReport', {
        id: reportId,
        name: 'Contrôle automatisé Pilotage',
        report,
        frequency: 'weekly',
        recipients: ['controle-pilotage@golink.test'],
        format: report === 'finance' ? 'xlsx' : 'pdf',
        hour: 6,
        active: false,
      });
      const r = await admin.call('runReportNow', { id: reportId, dryRun: true });
      if (r.sent !== 0) throw new Error('un e-mail est parti');
      return `${r.subject} · ${r.attachmentName} · ${r.html.length} car.`;
    });
  }
  await expectError('Suppression sans motif refusée', admin.call('deleteScheduledReport', { id: reportId, reason: '' }), 'invalid-argument');
  await check('Rapport programmé : suppression', async () => {
    await admin.call('deleteScheduledReport', { id: reportId, reason: 'Nettoyage du contrôle automatisé' });
    return 'supprimé';
  });
}

await check('Alerte : prise en charge puis réouverture', async () => {
  const snap = await db.collection('platformAlerts').where('status', '==', 'open').limit(1).get();
  if (snap.empty) return 'aucune alerte ouverte (ignoré)';
  const id = snap.docs[0].id;
  await admin.call('handlePlatformAlert', { alertId: id, status: 'acknowledged' });
  const after = (await db.collection('platformAlerts').doc(id).get()).data();
  if (after.status !== 'acknowledged' || after.acknowledgedBy !== admin.uid) throw new Error('statut non appliqué');
  await admin.call('handlePlatformAlert', { alertId: id, status: 'open' });
  return id;
});
await expectError(
  'Alerte : mise à l’écart sans motif refusée',
  (async () => {
    const snap = await db.collection('platformAlerts').where('status', '==', 'open').limit(1).get();
    return admin.call('handlePlatformAlert', { alertId: snap.docs[0]?.id ?? 'inconnue', status: 'dismissed' });
  })(),
  'invalid-argument',
);
await check('Surveillance relancée', async () => {
  const r = await admin.call('runMonitoringNow', {});
  return `${r.candidates} anomalies, ${r.created} créées, ${r.resolved} résolues`;
});
await admin.close();

// ------------------------------------------------------------------ Support : pas d'analytics ni d'exports
const support = await session('support@golink.test');
await check('Support : vue d’ensemble autorisée', async () => {
  const r = await support.call('getPilotageOverview', { ...period, ...compare });
  return `${r.counters.restaurants.total} commerces`;
});
await expectError('Support : analytics refusées', support.call('getPilotageAnalytics', { ...period, section: 'growth' }), 'permission-denied');
await expectError('Support : export refusé', support.call('exportData', { entity: 'orders', format: 'csv', filters: {} }), 'permission-denied');
await expectError('Support : seuils non modifiables', support.call('updateMonitoringSettings', {
  restaurantCancellationRate: 0.06,
  restaurantRejectionRate: 0.08,
  restaurantMinOrders: 15,
  cityOrderDrop: 0.35,
  cityMinOrders: 10,
  refundSpike: 1,
  zoneDriverRatio: 0.6,
  gdprDueWarningDays: 7,
  reason: 'Contrôle automatisé',
}), 'permission-denied');
await check('Support : recherche limitée à ses rubriques', async () => {
  const r = await support.call('globalSearch', { query: 'mina' });
  if (r.groups.some((g) => g.type === 'invoice')) throw new Error('factures visibles sans droit');
  return r.groups.map((g) => g.type).join(', ');
});
await support.close();

// ------------------------------------------------------------------ Responsable de ville (Metz)
const metz = await session('metz@golink.test');
await check('Metz : analytics sur sa ville', async () => {
  const r = await metz.call('getPilotageAnalytics', { ...period, section: 'cities' });
  const ids = r.cities.rows.map((c) => c.cityId);
  if (ids.some((id) => id !== 'metz')) throw new Error(`villes hors périmètre : ${ids.join(', ')}`);
  return ids.join(', ');
});
await expectError('Metz : autre ville refusée', metz.call('getPilotageOverview', { ...period, ...compare, cityIds: ['luxembourg'] }), 'permission-denied');
await expectError('Metz : export refusé (pas de droit exports.run)', metz.call('exportData', { entity: 'orders', format: 'csv', filters: {} }), 'permission-denied');
await expectError('Metz : programmation refusée', metz.call('saveScheduledReport', { name: 'Essai', report: 'orders', frequency: 'daily', recipients: ['metz@golink.test'], format: 'csv', hour: 7, active: false }), 'permission-denied');
await metz.close();

// ------------------------------------------------------------------ Nettoyage
for (const id of createdJobs) await db.collection('bulkJobs').doc(id).delete();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} contrôles réussis ; ${createdJobs.length} traces d’export de test supprimées.`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
