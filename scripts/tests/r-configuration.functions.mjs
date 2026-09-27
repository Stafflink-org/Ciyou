// Contrôle réel des Cloud Functions de la configuration restaurant, avec les
// comptes de test (droits accordés et refusés), puis nettoyage des écritures.
//
// Usage : node scripts/tests/r-configuration.functions.mjs
// Écritures de test sur Lune Coffee (propriétaire Mina Haddad), nettoyées à la fin.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes } from 'firebase/storage';
import { bucket, db } from '../lib/admin.mjs';

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
    storage: getStorage(app),
    call: (name, data) => httpsCallable(functions, name)(data).then((r) => r.data),
    close: async () => {
      await signOut(auth);
      await deleteApp(app);
    },
  };
}

/** Attend un refus (code Firebase) et vérifie le message français. */
async function expectError(name, promise, code) {
  try {
    await promise;
    record(name, false, 'accepté alors qu’un refus était attendu');
  } catch (error) {
    const got = String(error.code ?? '').replace('functions/', '');
    record(name, got === code, `${got} : ${error.message}`);
  }
}

const LUNE = 'lune-coffee';
const MINA = 'mina-kitchen';

// ----------------------------------------------------------------- Sans droit
const youssef = await session('youssef.karim@golink.test');
await expectError(
  'Cuisine : moyens de paiement refusés',
  youssef.call('updateRestaurantSettings', {
    restaurantId: MINA,
    section: 'payments',
    online: true,
    onDelivery: false,
    onPickup: false,
    methods: {
      card: true,
      apple_pay: true,
      google_pay: true,
      cash: false,
      meal_voucher: false,
    },
  }),
  'permission-denied',
);
await expectError(
  'Cuisine : zone refusée',
  youssef.call('saveDeliveryZone', {
    restaurantId: MINA,
    name: 'Essai',
    type: 'radius',
    radiusMeters: 1000,
    polygon: null,
    feeCents: 200,
    minOrderCents: null,
    freeAboveCents: null,
    deliveryMinutes: 10,
    enabled: true,
    color: '#4a846c',
  }),
  'permission-denied',
);
await expectError(
  'Cuisine : formule refusée',
  youssef.call('changePlan', {
    restaurantId: MINA,
    planCode: 'pro',
    reason: null,
  }),
  'permission-denied',
);
await expectError(
  'Cuisine : révocation refusée',
  youssef.call('revokeMember', {
    restaurantId: MINA,
    uid: 'x',
    reason: 'Essai de droits',
  }),
  'permission-denied',
);
await youssef.close();

// ----------------------------------------------------------------- Manager
const sofia = await session('sofia.martin@golink.test');
await expectError(
  'Manager : espèces refusées (livraison GoLink)',
  sofia.call('updateRestaurantSettings', {
    restaurantId: MINA,
    section: 'payments',
    online: true,
    onDelivery: true,
    onPickup: false,
    methods: {
      card: true,
      apple_pay: true,
      google_pay: true,
      cash: true,
      meal_voucher: false,
    },
  }),
  'failed-precondition',
);
await expectError(
  'Manager : paiement en ligne obligatoire',
  sofia.call('updateRestaurantSettings', {
    restaurantId: MINA,
    section: 'payments',
    online: false,
    onDelivery: false,
    onPickup: false,
    methods: {
      card: true,
      apple_pay: false,
      google_pay: false,
      cash: false,
      meal_voucher: false,
    },
  }),
  'invalid-argument',
);
const legalDoc = (
  await db.collection('legalDocuments').where('type', '==', 'terms_restaurant').where('countryId', '==', 'FR').where('status', '==', 'published').limit(1).get()
).docs[0];
await expectError(
  'Manager : signature du contrat réservée au propriétaire',
  sofia.call('acceptPartnerContract', {
    restaurantId: MINA,
    documentId: legalDoc.id,
    signatureName: 'Sofia Martin',
    accept: true,
  }),
  'permission-denied',
);
await sofia.close();

// ----------------------------------------------------------------- Propriétaire
const mina = await session('mina.haddad@golink.test');
const created = {
  documents: [],
  files: [],
  acceptance: null,
  plan: null,
  member: null,
};
try {
  // Zones : bornes et formule.
  await expectError(
    'Propriétaire : rayon au-delà de la formule refusé',
    mina.call('saveDeliveryZone', {
      restaurantId: LUNE,
      name: 'Trop loin',
      type: 'radius',
      radiusMeters: 25_000,
      polygon: null,
      feeCents: 200,
      minOrderCents: null,
      freeAboveCents: null,
      deliveryMinutes: 10,
      enabled: true,
      color: '#4a846c',
    }),
    'invalid-argument',
  );

  // Justificatif : dépôt réel dans Storage puis enregistrement.
  const storage = mina.storage;
  const path = `restaurants/${LUNE}/private/documents/other-${Date.now()}.pdf`;
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  try {
    await uploadBytes(ref(storage, path), pdf, {
      contentType: 'application/pdf',
    });
    record('Propriétaire : dépôt Storage du justificatif', true);
  } catch (error) {
    // Règles Storage croisées (firestore.get) inopérantes tant que l'agent Storage n'a pas le rôle requis.
    record('Propriétaire : dépôt Storage du justificatif', false, `${error.code} — dépôt fait côté serveur pour poursuivre`);
    await bucket.file(path).save(Buffer.from(pdf), { contentType: 'application/pdf' });
  }
  created.files.push(path);
  const up = await mina.call('uploadDocument', {
    restaurantId: LUNE,
    type: 'other',
    storagePath: path,
    fileName: 'essai.pdf',
    number: null,
    issuedAt: null,
    expiresAt: null,
  });
  created.documents.push(up.documentId);
  const stored = await db.collection('partnerDocuments').doc(up.documentId).get();
  record('Propriétaire : justificatif enregistré en attente', stored.exists && stored.get('status') === 'pending', `statut ${stored.get('status')}`);
  await expectError(
    'Propriétaire : licence d’alcool refusée',
    mina.call('uploadDocument', {
      restaurantId: LUNE,
      type: 'alcohol_license',
      storagePath: path,
      fileName: 'licence.pdf',
      number: 'L-1',
      issuedAt: null,
      expiresAt: null,
    }),
    'invalid-argument',
  );

  // Contrat partenaire.
  const signed = await mina.call('acceptPartnerContract', {
    restaurantId: LUNE,
    documentId: legalDoc.id,
    signatureName: 'Mina Haddad',
    accept: true,
  });
  created.acceptance = legalDoc.id;
  const legal = await db.doc(`restaurants/${LUNE}/private/legal`).get();
  record('Propriétaire : contrat signé et versionné', legal.get('partnerTermsVersion') === signed.version, `version ${signed.version}`);
  await expectError(
    'Propriétaire : double signature refusée',
    mina.call('acceptPartnerContract', {
      restaurantId: LUNE,
      documentId: legalDoc.id,
      signatureName: 'Mina Haddad',
      accept: true,
    }),
    'already-exists',
  );

  // Membres : invitation d'un compte existant, rôle sur mesure, révocation.
  const invited = await mina.call('inviteRestaurantMember', {
    restaurantId: LUNE,
    email: 'youssef.karim@golink.test',
    firstName: 'Youssef',
    lastName: 'Karim',
    role: 'service',
  });
  created.member = invited.uid;
  record('Propriétaire : invitation d’un membre', Boolean(invited.uid), `nouveau compte : ${invited.newAccount}`);
  const perms = await mina.call('setMemberPermissions', {
    restaurantId: LUNE,
    uid: invited.uid,
    role: 'custom',
    customRoleId: 'barista',
  });
  record(
    'Propriétaire : rôle sur mesure appliqué',
    perms.role === 'custom' && perms.permissions.includes('orders.manage'),
    `${perms.permissions.length} droits`,
  );
  await expectError(
    'Propriétaire : révocation sans motif refusée',
    mina.call('revokeMember', {
      restaurantId: LUNE,
      uid: invited.uid,
      reason: '',
    }),
    'invalid-argument',
  );
  const revoked = await mina.call('revokeMember', {
    restaurantId: LUNE,
    uid: invited.uid,
    reason: 'Fin du test de configuration',
  });
  const memberDoc = await db.doc(`restaurants/${LUNE}/members/${invited.uid}`).get();
  record('Propriétaire : accès révoqué', revoked.revoked === true && memberDoc.get('active') === false);

  // Formule : passage à Pro puis retour à Basic.
  const before = await db.doc(`restaurants/${LUNE}`).get();
  const commercialBefore = await db.doc(`restaurants/${LUNE}/private/commercial`).get();
  const subBefore = await db.doc(`subscriptions/sub-${LUNE}`).get();
  created.plan = {
    code: before.get('planCode'),
    commercial: {
      planCode: commercialBefore.get('planCode') ?? null,
      subscriptionId: commercialBefore.get('subscriptionId') ?? null,
      subscriptionStatus: commercialBefore.get('subscriptionStatus') ?? null,
    },
    subscription: subBefore.exists ? subBefore.data() : null,
  };
  const up1 = await mina.call('changePlan', {
    restaurantId: LUNE,
    planCode: 'pro',
    reason: 'Essai',
  });
  record('Propriétaire : passage à Pro', up1.planCode === 'pro' && up1.status === 'applied', JSON.stringify(up1));
  const down = await mina.call('changePlan', {
    restaurantId: LUNE,
    planCode: created.plan.code,
    reason: 'Retour',
  });
  record(`Propriétaire : retour à ${created.plan.code} (programmé en fin de période)`, ['applied', 'scheduled'].includes(down.status), JSON.stringify(down));
} finally {
  await mina.close();
  // Nettoyage des écritures de test.
  for (const id of created.documents) await db.collection('partnerDocuments').doc(id).delete();
  for (const path of created.files)
    await bucket
      .file(path)
      .delete()
      .catch(() => undefined);
  if (created.acceptance) {
    const acc = await db.collection('legalAcceptances').where('restaurantId', '==', LUNE).where('documentId', '==', created.acceptance).get();
    for (const d of acc.docs) await d.ref.delete();
    await db.doc(`restaurants/${LUNE}/private/legal`).set(
      {
        partnerTermsVersion: null,
        partnerTermsAcceptedAt: null,
        partnerTermsSignatureName: null,
        partnerTermsAcceptedBy: null,
        partnerTermsDocumentId: null,
      },
      { merge: true },
    );
  }
  if (created.member) await db.doc(`restaurants/${LUNE}/members/${created.member}`).delete();
  if (created.plan) {
    // Formule, conditions et abonnement remis dans leur état d'avant le test.
    const subRef = db.doc(`subscriptions/sub-${LUNE}`);
    if (created.plan.subscription) await subRef.set(created.plan.subscription);
    else await subRef.delete();
    await db.doc(`restaurants/${LUNE}/private/commercial`).set(created.plan.commercial, { merge: true });
    await db.doc(`restaurants/${LUNE}`).update({ planCode: created.plan.code });
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} contrôles réussis.`);
process.exit(failed ? 1 : 0);
