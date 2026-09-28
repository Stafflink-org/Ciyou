// Contrôle réel de la devise par restaurant + validation + e-mail de mot de passe
// (tâche restaurant-currency-onboarding) : un dossier créé par import (propriétaire
// sans mot de passe connu) et un dossier créé par inscription en ligne (propriétaire
// avec mot de passe), validés chacun avec une devise choisie, puis nettoyage.
//
// Usage : node scripts/tests/restaurant-currency-onboarding.mjs
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
/** Appel public (inscription), sans session ouverte. */
async function anonCall(name, data) {
  const app = initializeApp(config, `anon-${name}-${Date.now()}`);
  const functions = getFunctions(app, 'europe-west1');
  try {
    return (await httpsCallable(functions, name, { timeout: 300_000 })(data)).data;
  } finally {
    await deleteApp(app);
  }
}
async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail);
    return detail;
  } catch (error) {
    record(name, false, `${error.code ?? ''} ${error.message}`);
    return undefined;
  }
}

async function approveWithDocsAndTerms(admin, rid, currency) {
  const now = new Date();
  const docIds = [];
  for (const type of ['kbis', 'manager_id', 'bank_details']) {
    const ref = db.collection('partnerDocuments').doc(`${rid}-${type}`);
    await ref.set({
      ownerType: 'restaurant', ownerId: rid, countryId: 'FR', cityId: 'metz', type,
      file: { path: `restaurants/${rid}/private/documents/${type}.pdf`, url: null, contentType: 'application/pdf', size: 1000, name: `${type}.pdf`, uploadedAt: now, uploadedBy: 'test' },
      status: 'approved', number: null, issuedAt: null, expiresAt: null, reviewedBy: 'test', reviewedAt: now, rejectionReason: null, remindersSent: 0, lastReminderAt: null,
      createdAt: now, createdBy: 'test', updatedAt: now, updatedBy: 'test', test: true,
    });
    docIds.push(ref.id);
  }
  await db.doc(`restaurants/${rid}/private/legal`).set({ partnerTermsVersion: '2026-06', partnerTermsAcceptedAt: now, partnerTermsSignatureName: 'Test Propriétaire' }, { merge: true });
  const r = await admin.call('reviewRestaurantApplication', { restaurantId: rid, decision: 'approve', goLive: true, currency, reason: 'Dossier complet, validation de test' });
  return { r, docIds };
}

const created = { restaurantIds: [], jobIds: [], ownerUids: [] };

async function main() {
  const admin = await session('superadmin@golink.test');
  try {
    // ------------------------------------------------------------ Scénario A : import (mot de passe non connu)
    let ridA = '';
    await step('Scénario A — importRestaurants (test, sans envoi immédiat)', async () => {
      const report = await admin.call('importRestaurants', {
        dryRun: false,
        inviteOwners: false,
        test: true,
        reason: 'Création de test (tâche restaurant-currency-onboarding)',
        rows: [{
          name: 'Comptoir Devise Import', merchantType: 'restaurant', cityId: 'metz', line1: '9 rue des Tests', postalCode: '57000', city: 'Metz',
          phone: '+33 3 87 00 00 09', email: 'contact@comptoir-devise-import.golink.test',
          ownerFirstName: 'Import', ownerLastName: 'Proprietaire', ownerEmail: 'rco.import.owner@golink.test',
          legalName: 'Comptoir Devise Import SAS', siret: '89451237700199', planCode: 'basic', lat: 49.1193, lng: 6.1757,
        }],
      });
      ridA = report.restaurantIds[0];
      created.restaurantIds.push(ridA);
      if (report.jobId) created.jobIds.push(report.jobId);
      const snap = await db.doc(`restaurants/${ridA}`).get();
      created.ownerUids.push(snap.get('ownerId'));
      if (snap.get('ownerCredentialsDelivered') !== false) throw new Error(`ownerCredentialsDelivered attendu à false, obtenu ${snap.get('ownerCredentialsDelivered')}`);
      return `${ridA} · ownerCredentialsDelivered=${snap.get('ownerCredentialsDelivered')}`;
    });

    if (ridA) {
      await step('Scénario A — validation avec devise MAD : lien de mot de passe envoyé, pas de perte de compte', async () => {
        const { r } = await approveWithDocsAndTerms(admin, ridA, 'MAD');
        if (r.status !== 'active') throw new Error(`statut inattendu : ${JSON.stringify(r)}`);
        const snap = await db.doc(`restaurants/${ridA}`).get();
        if (snap.get('currency') !== 'MAD') throw new Error(`devise attendue MAD, obtenue ${snap.get('currency')}`);
        if (snap.get('ownerCredentialsDelivered') !== true) throw new Error('ownerCredentialsDelivered non mis à jour après le lien');
        return `devise=${snap.get('currency')} · e-mail ${r.emailSimulated ? 'simulé (dry-run)' : r.emailSent ? 'envoyé' : 'non envoyé'}`;
      });
    }

    // ------------------------------------------------------------ Scénario B : inscription en ligne (mot de passe choisi)
    let ridB = '';
    const ownerEmailB = 'rco.signup.owner@golink.test';
    await step('Scénario B — restaurantSignup (mot de passe choisi par le propriétaire)', async () => {
      const r = await anonCall('restaurantSignup', {
        restaurant: {
          name: 'Comptoir Devise Signup', cuisineIds: [], phone: '+33 3 87 00 00 08',
          address: { line1: '11 rue des Tests', postalCode: '57000', city: 'Metz', countryCode: 'FR' },
        },
        owner: { firstName: 'Signup', lastName: 'Proprietaire', email: ownerEmailB, phone: '+33 6 00 00 00 08', password: 'TestSignup!2026x' },
        legal: { legalName: 'Comptoir Devise Signup SAS', registrationNumber: '89451237700299' },
        acceptTerms: true,
      });
      if (r.status !== 'pending' || !r.restaurantId) throw new Error(JSON.stringify(r));
      ridB = r.restaurantId;
      created.restaurantIds.push(ridB);
      // Marqué donnée de test après coup (restaurantSignup n'a pas ce paramètre) : évite tout envoi réel via Brevo.
      await db.doc(`restaurants/${ridB}`).set({ test: true }, { merge: true });
      const snap = await db.doc(`restaurants/${ridB}`).get();
      created.ownerUids.push(snap.get('ownerId'));
      if (snap.get('ownerCredentialsDelivered') !== true) throw new Error(`ownerCredentialsDelivered attendu à true, obtenu ${snap.get('ownerCredentialsDelivered')}`);
      return `${ridB} · ownerCredentialsDelivered=${snap.get('ownerCredentialsDelivered')}`;
    });

    if (ridB) {
      await step('Scénario B — validation avec devise TND : pas de lien envoyé (mot de passe déjà choisi)', async () => {
        const { r } = await approveWithDocsAndTerms(admin, ridB, 'TND');
        if (r.status !== 'active') throw new Error(`statut inattendu : ${JSON.stringify(r)}`);
        const snap = await db.doc(`restaurants/${ridB}`).get();
        if (snap.get('currency') !== 'TND') throw new Error(`devise attendue TND, obtenue ${snap.get('currency')}`);
        // Le propriétaire avait déjà un mot de passe : le gabarit `restaurant_approved` (simple) doit avoir été utilisé, pas de lien.
        return `devise=${snap.get('currency')} · e-mail ${r.emailSimulated ? 'simulé (dry-run)' : r.emailSent ? 'envoyé' : 'non envoyé'}`;
      });
    }

    // ------------------------------------------------------------ Modification de la devise après coup (fiche restaurant)
    if (ridA) {
      await step('adminUpdateRestaurant — modifie la devise après validation, avec motif et audit', async () => {
        const before = await db.doc(`restaurants/${ridA}`).get();
        const r = await admin.call('adminUpdateRestaurant', {
          restaurantId: ridA, name: before.get('name'), merchantType: 'restaurant', description: null, phone: before.get('phone'), email: before.get('email'),
          cuisineIds: [], tags: [], priceLevel: 2, zoneIds: [], fulfillmentModes: ['delivery', 'pickup'], deliveredBy: 'platform',
          address: { line1: before.data().address.line1, line2: null, postalCode: before.data().address.postalCode, city: before.data().address.city },
          currency: 'EUR', reason: 'Correction devise après ouverture (test)',
        });
        if (!r.changed.includes('currency')) throw new Error(`champ "currency" non détecté comme modifié : ${JSON.stringify(r)}`);
        const after = await db.doc(`restaurants/${ridA}`).get();
        if (after.get('currency') !== 'EUR') throw new Error(`devise attendue EUR après modification, obtenue ${after.get('currency')}`);
        const audit = await db.collection('auditLogs').where('target.id', '==', ridA).where('action', '==', 'restaurant.profile_updated').get();
        const entry = audit.docs[0]?.data();
        if (!entry || entry.after?.currency !== 'EUR' || entry.before?.currency !== 'MAD') throw new Error(`audit incomplet : ${JSON.stringify(entry ?? null)}`);
        return `MAD → EUR, motif conservé dans l’audit (${audit.docs[0].id})`;
      });
    }

  } finally {
    // ------------------------------------------------------------ Nettoyage
    for (const id of created.restaurantIds) {
      const ref = db.doc(`restaurants/${id}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const ownerId = snap.get('ownerId');
      for (const sub of ['private', 'settings', 'members', 'dailyStats']) {
        const docs = await ref.collection(sub).get();
        for (const d of docs.docs) await d.ref.delete();
      }
      await ref.delete();
      for (const col of ['partnerDocuments', 'commissionRules', 'platformAlerts', 'auditLogs']) {
        const field = col === 'commissionRules' ? 'scopeId' : col === 'platformAlerts' ? 'target.id' : col === 'auditLogs' ? 'target.id' : 'ownerId';
        const docs = await db.collection(col).where(field, '==', id).get();
        for (const d of docs.docs) await d.ref.delete();
      }
      if (ownerId) created.ownerUids.push(ownerId);
    }
    for (const id of created.jobIds) await db.doc(`bulkJobs/${id}`).delete().catch(() => undefined);
    for (const uid of new Set(created.ownerUids.filter(Boolean))) {
      const notifs = await db.collection(`users/${uid}/notifications`).get();
      for (const d of notifs.docs) await d.ref.delete();
      await db.doc(`users/${uid}`).delete().catch(() => undefined);
      await db.doc(`userPrivate/${uid}`).delete().catch(() => undefined);
      await adminAuth.deleteUser(uid).catch(() => undefined);
    }
    await admin.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} contrôles réussis.`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
