// Contrôle réel des Cloud Functions « restaurants et clients » du super admin, avec
// les comptes de test (droits accordés et refusés), puis nettoyage des écritures.
//
// Usage : node scripts/tests/a-restaurants-clients.functions.mjs
// Crée un commerce et un client de test (test: true), supprimés à la fin.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth as adminAuth, db } from '../lib/admin.mjs';

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
  console.log(`${ok ? 'OK ' : 'ÉCHEC'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function session(email) {
  const app = initializeApp(config, email);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, passwordOf(email));
  const functions = getFunctions(app, 'europe-west1');
  return {
    uid: auth.currentUser.uid,
    // Quota de processeurs de la région partagé : nouvel essai si l'instance est indisponible.
    call: async (name, data) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return (await httpsCallable(functions, name, { timeout: 300_000 })(data)).data;
        } catch (error) {
          const code = String(error.code ?? '');
          if (attempt < 8 && (code.endsWith('unavailable') || code.endsWith('resource-exhausted'))) {
            await new Promise((r) => setTimeout(r, 8000 + attempt * 4000));
            continue;
          }
          throw error;
        }
      }
    },
    close: async () => {
      await signOut(auth);
      await deleteApp(app);
    },
  };
}
async function expectError(name, promise, code) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const got = String(error.code ?? '').replace('functions/', '');
    record(name, got === code, `${got} : ${error.message}`);
  }
}
async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
  } catch (error) {
    record(name, false, `${error.code ?? ''} ${error.message}`);
  }
}

const OWNER_EMAIL = 'arc.test.owner@golink.test';
const CLIENT_ID = 'arc-test-client';
const created = { restaurantIds: [], jobIds: [], sessionIds: [] };

const row = (overrides = {}) => ({
  name: 'Comptoir Test ARC',
  merchantType: 'restaurant',
  cityId: 'metz',
  line1: '3 rue des Tests',
  postalCode: '57000',
  city: 'Metz',
  phone: '+33 3 87 00 00 01',
  email: 'contact@comptoir-arc.golink.test',
  ownerFirstName: 'Test',
  ownerLastName: 'Propriétaire',
  ownerEmail: OWNER_EMAIL,
  legalName: 'Comptoir Test SAS',
  siret: '89451237700099',
  planCode: 'basic',
  lat: 49.1193,
  lng: 6.1757,
  ...overrides,
});

async function main() {
  const admin = await session('superadmin@golink.test');
  const commercial = await session('commercial@golink.test');
  const support = await session('support@golink.test');
  const metz = await session('metz@golink.test');
  let rid = '';
  try {
    // ------------------------------------------------------------ Import
    await step('importRestaurants : simulation (1 valide, 1 invalide, 1 doublon)', async () => {
      const report = await admin.call('importRestaurants', { dryRun: true, rows: [row(), row({ name: 'X', postalCode: 'abc' }), row({ name: 'Mina Kitchen', postalCode: '54400' })], test: true });
      if (report.errors.length !== 1 || report.created !== 0 || report.skipped !== 1) throw new Error(JSON.stringify(report));
      return `${report.errors[0].message} · ${report.warnings.length} avertissement(s)`;
    });
    await expectError('importRestaurants en masse refusé au support', support.call('importRestaurants', { dryRun: true, rows: [row(), row({ name: 'Autre' })] }), 'permission-denied');
    await step('importRestaurants : création réelle (test)', async () => {
      const report = await admin.call('importRestaurants', { dryRun: false, rows: [row()], inviteOwners: false, test: true });
      rid = report.restaurantIds[0];
      created.restaurantIds.push(rid);
      if (report.jobId) created.jobIds.push(report.jobId);
      const snap = await db.doc(`restaurants/${rid}`).get();
      if (snap.get('onboardingStatus') !== 'documents_missing') throw new Error('statut inattendu');
      const member = await db.doc(`restaurants/${rid}/members/${snap.get('ownerId')}`).get();
      return `${rid} · membre propriétaire ${member.exists ? 'créé' : 'absent'}`;
    });

    // ------------------------------------------------------------ Validation
    await expectError('reviewRestaurantApplication : approbation sans pièces refusée', admin.call('reviewRestaurantApplication', { restaurantId: rid, decision: 'approve' }), 'failed-precondition');
    await step('reviewRestaurantApplication : documents manquants', async () => {
      const r = await admin.call('reviewRestaurantApplication', { restaurantId: rid, decision: 'documents_missing', reason: 'Merci de déposer vos pièces', missingDocuments: ['kbis', 'bank_details'] });
      return `${r.onboardingStatus} · e-mail ${r.emailSimulated ? 'simulé' : r.emailSent ? 'envoyé' : 'non envoyé'}`;
    });
    // Pièces déposées (écrites directement : le dépôt passe normalement par Storage et uploadDocument).
    const now = new Date();
    const docIds = [];
    for (const type of ['kbis', 'manager_id', 'bank_details']) {
      const ref = db.collection('partnerDocuments').doc(`${rid}-${type}`);
      await ref.set({
        ownerType: 'restaurant', ownerId: rid, countryId: 'FR', cityId: 'metz', type,
        file: { path: `restaurants/${rid}/private/documents/${type}.pdf`, url: null, contentType: 'application/pdf', size: 1000, name: `${type}.pdf`, uploadedAt: now, uploadedBy: 'test' },
        status: 'pending', number: null, issuedAt: null, expiresAt: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, remindersSent: 0, lastReminderAt: null,
        createdAt: now, createdBy: 'test', updatedAt: now, updatedBy: 'test', test: true,
      });
      docIds.push(ref.id);
    }
    await expectError('reviewDocument refusé au commercial', commercial.call('reviewDocument', { documentId: docIds[0], decision: 'approve' }), 'permission-denied');
    await expectError('reviewDocument : refus sans motif', admin.call('reviewDocument', { documentId: docIds[0], decision: 'reject' }), 'invalid-argument');
    await step('reviewDocument : validation des 3 pièces (expiration sur l’identité)', async () => {
      const exp = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
      for (const id of docIds) await admin.call('reviewDocument', { documentId: id, decision: 'approve', expiresAt: id.endsWith('manager_id') ? exp : null });
      const snap = await db.doc(`partnerDocuments/${docIds[1]}`).get();
      return `${snap.get('status')} jusqu’au ${snap.get('expiresAt')}`;
    });
    await expectError('Validation refusée tant que le contrat n’est pas signé', admin.call('reviewRestaurantApplication', { restaurantId: rid, decision: 'approve' }), 'failed-precondition');
    await db.doc(`restaurants/${rid}/private/legal`).set({ partnerTermsVersion: '2026-06', partnerTermsAcceptedAt: now, partnerTermsSignatureName: 'Test Propriétaire' }, { merge: true });
    await step('reviewRestaurantApplication : validation et mise en ligne', async () => {
      const r = await admin.call('reviewRestaurantApplication', { restaurantId: rid, decision: 'approve', goLive: true });
      if (r.status !== 'active') throw new Error(JSON.stringify(r));
      return `${r.onboardingStatus} / ${r.status}`;
    });
    await step('sendDocumentReminder', async () => {
      const r = await admin.call('sendDocumentReminder', { restaurantId: rid, documentTypes: ['hygiene_certificate'] });
      return `notification ${r.notified ? 'écrite' : 'non écrite'}`;
    });

    // ------------------------------------------------------------ Conditions commerciales
    await expectError('Espèces refusées si livraison Ciyou Eats', admin.call('updateCommercialTerms', {
      restaurantId: rid, planCode: 'pro', billingMode: null, negotiatedCommission: null, specialOffer: null,
      allowedPaymentMethods: ['card', 'cash'], deliveryFeeOverrideCents: null, minOrderOverrideCents: null, payoutFrequency: null, reason: 'Test espèces',
    }), 'invalid-argument');
    await expectError('Conditions refusées au support', support.call('updateCommercialTerms', {
      restaurantId: rid, planCode: 'pro', billingMode: null, negotiatedCommission: null, specialOffer: null,
      allowedPaymentMethods: ['card'], deliveryFeeOverrideCents: null, minOrderOverrideCents: null, payoutFrequency: null, reason: 'Test',
    }), 'permission-denied');
    await step('updateCommercialTerms (commercial) : formule Pro + commission négociée', async () => {
      const r = await commercial.call('updateCommercialTerms', {
        restaurantId: rid, planCode: 'pro', billingMode: 'commission',
        negotiatedCommission: { platformDeliveryBps: 2500, restaurantDeliveryBps: null, pickupBps: 1000, validUntil: null },
        specialOffer: { commissionReductionBps: 300, endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), reason: 'Lancement' },
        allowedPaymentMethods: ['card', 'apple_pay'], deliveryFeeOverrideCents: null, minOrderOverrideCents: 1200, payoutFrequency: 'biweekly', reason: 'Négociation test',
      });
      const c = await db.doc(`restaurants/${rid}/private/commercial`).get();
      return `règle ${r.commissionRuleId} · ${c.get('negotiatedCommission.platformDeliveryBps')} bps · ${c.get('payoutFrequency')}`;
    });
    await step('adminUpdateRestaurant : fiche modifiée', async () => {
      const r = await admin.call('adminUpdateRestaurant', {
        restaurantId: rid, name: 'Comptoir Test ARC', merchantType: 'bakery', description: 'Boulangerie de test', phone: '+33 3 87 00 00 02', email: 'contact@comptoir-arc.golink.test',
        cuisineIds: [], tags: ['fait maison'], priceLevel: 2, zoneIds: [], fulfillmentModes: ['delivery', 'pickup'], deliveredBy: 'both',
        address: { line1: '3 rue des Tests', line2: null, postalCode: '57000', city: 'Metz' }, reason: 'Correction de la fiche',
      });
      return r.changed.join(', ');
    });

    // ------------------------------------------------------------ Suspension
    await expectError('Suspension refusée au commercial', commercial.call('suspendRestaurant', { restaurantId: rid, kind: 'permanent', reason: 'Test refus' }), 'permission-denied');
    await expectError('Suspension temporaire sans date refusée', admin.call('suspendRestaurant', { restaurantId: rid, kind: 'temporary', reason: 'Test' }), 'invalid-argument');
    await step('suspendRestaurant (responsable de Metz) : temporaire 1 jour', async () => {
      const r = await metz.call('suspendRestaurant', { restaurantId: rid, kind: 'temporary', until: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Hygiène à vérifier', message: 'Contrôle prévu demain.' });
      return r.status;
    });
    await step('reactivateRestaurant', async () => (await admin.call('reactivateRestaurant', { restaurantId: rid, reason: 'Contrôle conforme' })).status);
    await expectError('Ville hors périmètre refusée au responsable de Metz', metz.call('suspendRestaurant', { restaurantId: 'mina-kitchen', kind: 'permanent', reason: 'Test périmètre' }), 'permission-denied');

    // ------------------------------------------------------------ Actions groupées
    await step('bulkRestaurantAction : message', async () => {
      const r = await admin.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'send_message', reason: 'Information test', params: { subject: 'Nouveautés Ciyou Eats', message: 'Bonjour, voici les nouveautés du mois.' } });
      created.jobIds.push(r.jobId);
      return `${r.succeeded} ok / ${r.failed} échec`;
    });
    await step('bulkRestaurantAction : formule Premium', async () => {
      const r = await admin.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'set_plan', reason: 'Montée en gamme', params: { planCode: 'premium' } });
      created.jobIds.push(r.jobId);
      const snap = await db.doc(`restaurants/${rid}`).get();
      return `${r.succeeded} ok · formule ${snap.get('planCode')}`;
    });
    await step('bulkRestaurantAction : fonctionnalité (commandes programmées)', async () => {
      const r = await admin.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'set_feature', reason: 'Test', params: { feature: 'scheduled_orders', enabled: true } });
      created.jobIds.push(r.jobId);
      return `${r.succeeded} ok`;
    });
    await expectError('Fonctionnalité verrouillée (alcool) refusée', admin.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'set_feature', reason: 'Test', params: { feature: 'alcohol_sales', enabled: true } }), 'failed-precondition');
    await step('bulkRestaurantAction : suspension puis réactivation groupées', async () => {
      const a = await admin.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'suspend', reason: 'Test groupé', params: { until: new Date(Date.now() + 86_400_000).toISOString() } });
      const b = await admin.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'reactivate', reason: 'Test groupé', params: {} });
      created.jobIds.push(a.jobId, b.jobId);
      return `${a.succeeded}/${b.succeeded}`;
    });
    await expectError('Actions groupées refusées au commercial (droit « masse » absent)', commercial.call('bulkRestaurantAction', { restaurantIds: [rid], action: 'set_plan', reason: 'Test', params: { planCode: 'basic' } }), 'permission-denied');

    // ------------------------------------------------------------ Groupes, score, « voir comme »
    await step('refreshRestaurantScores', async () => `score ${(await admin.call('refreshRestaurantScores', { restaurantId: rid })).score}`);
    await step('start/endImpersonation', async () => {
      const s = await admin.call('startImpersonation', { restaurantId: rid, reason: 'Vérification affichage', durationMinutes: 15 });
      created.sessionIds.push(s.sessionId);
      const e = await admin.call('endImpersonation', { sessionId: s.sessionId });
      return `session ${s.sessionId} · terminée ${!e.alreadyEnded}`;
    });
    await expectError('« Voir comme » refusé au support', support.call('startImpersonation', { restaurantId: rid, reason: 'Test', durationMinutes: 15 }), 'permission-denied');

    // ------------------------------------------------------------ Clients
    await db.doc(`users/${CLIENT_ID}`).set({
      role: 'client', firstName: 'Client', lastName: 'Test', displayName: 'Client Test', email: 'arc.test.client@golink.test', emailVerified: true, phone: '+33 6 00 00 00 00', phoneVerified: false,
      locale: 'fr', status: 'active', consents: {}, notificationPrefs: { orderUpdates: true, promotions: false, newsletter: false }, walletBalanceCents: 0, referralCode: 'ARCTEST1',
      stats: { ordersCount: 0, totalSpentCents: 0, cancelledCount: 0, refundsCount: 0 }, acceptedLegal: {}, countryId: 'FR', cityId: 'metz', searchKeywords: ['client', 'test'],
      createdAt: now, updatedAt: now, test: true,
    });
    await step('creditCustomer (support, 5 €)', async () => (await support.call('creditCustomer', { userId: CLIENT_ID, amountCents: 500, reason: 'commercial_gesture', note: 'Geste de test', validityDays: 90 })).balanceAfterCents);
    await expectError('creditCustomer au-delà du plafond du support', support.call('creditCustomer', { userId: CLIENT_ID, amountCents: 20_000, reason: 'commercial_gesture', note: 'Plafond' }), 'permission-denied');
    await expectError('creditCustomer refusé au commercial', commercial.call('creditCustomer', { userId: CLIENT_ID, amountCents: 500, reason: 'commercial_gesture', note: 'Refus' }), 'permission-denied');
    await step('blockCustomer puis déblocage', async () => {
      const a = await support.call('blockCustomer', { userId: CLIENT_ID, blocked: true, reason: 'Test de blocage' });
      const b = await support.call('blockCustomer', { userId: CLIENT_ID, blocked: false, reason: 'Fin du test' });
      return `${a.status} → ${b.status}`;
    });
    await expectError('Suppression RGPD refusée au support', support.call('deleteCustomerAccount', { userId: CLIENT_ID, reason: 'Test' }), 'permission-denied');
    await step('deleteCustomerAccount (super admin)', async () => {
      const r = await admin.call('deleteCustomerAccount', { userId: CLIENT_ID, reason: 'Demande du client (test)' });
      const snap = await db.doc(`users/${CLIENT_ID}`).get();
      return `${snap.get('status')} · ${snap.get('displayName')} · avoir annulé ${r.forfeitedCents}`;
    });
  } finally {
    // ------------------------------------------------------------ Nettoyage
    for (const id of created.restaurantIds) {
      const ref = db.doc(`restaurants/${id}`);
      const snap = await ref.get();
      const ownerId = snap.get('ownerId');
      for (const sub of ['private', 'settings', 'members', 'dailyStats']) {
        const docs = await ref.collection(sub).get();
        for (const d of docs.docs) await d.ref.delete();
      }
      await ref.delete();
      for (const col of ['partnerDocuments', 'commissionRules', 'platformAlerts']) {
        const field = col === 'commissionRules' ? 'scopeId' : col === 'platformAlerts' ? 'target.id' : 'ownerId';
        const docs = await db.collection(col).where(field, '==', id).get();
        for (const d of docs.docs) await d.ref.delete();
      }
      const flag = await db.doc('featureFlags/scheduled_orders').get();
      if (flag.exists) await flag.ref.update({ overrides: (flag.get('overrides') ?? []).filter((o) => o.scopeId !== id) });
      if (ownerId) {
        const notifs = await db.collection(`users/${ownerId}/notifications`).get();
        for (const d of notifs.docs) await d.ref.delete();
        await db.doc(`users/${ownerId}`).delete();
        await db.doc(`userPrivate/${ownerId}`).delete();
        await adminAuth.deleteUser(ownerId).catch(() => undefined);
      }
    }
    for (const id of created.jobIds) await db.doc(`bulkJobs/${id}`).delete();
    for (const id of created.sessionIds) await db.doc(`impersonationSessions/${id}`).delete();
    const wallet = await db.collection('walletTransactions').where('userId', '==', CLIENT_ID).get();
    for (const d of wallet.docs) await d.ref.delete();
    const ledger = await db.collection('ledgerEntries').where('accountId', '==', CLIENT_ID).get();
    for (const d of ledger.docs) await d.ref.delete();
    const gdpr = await db.collection('gdprRequests').where('subjectId', '==', CLIENT_ID).get();
    for (const d of gdpr.docs) await d.ref.delete();
    await db.doc(`users/${CLIENT_ID}`).delete();
    await db.doc(`userPrivate/${CLIENT_ID}`).delete();
    await Promise.all([admin.close(), commercial.close(), support.close(), metz.close()]);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} contrôles réussis.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
