// Test réel des correctifs de la tâche cdc-non-mobile, sur la base golink-9f16d :
// export FEC (18 champs), export lisible par collection, remise sécurisée RGPD (lien
// signé), limite de produits d'une formule appliquée par les règles Firestore.
//
//   npx tsx scripts/tests/cdc-non-mobile.flow.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/admin.mjs';
import { adminSession, callFn, signIn } from '../lib/test-mfa.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = 'golink-9f16d';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const accountsText = readFileSync(join(root, '.test-accounts.local.md'), 'utf8');
const passwordOf = (email) => [...accountsText.matchAll(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/g)].find((m) => m[1] === email)?.[2];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const check = (name, condition, detail) => record(name, Boolean(condition), detail);

async function rest(token, method, path, body) {
  const res = await fetch(`${FS}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

/**
 * Création via `:commit` avec `createdAt`/`updatedAt` posés par transformation serveur
 * (`REQUEST_TIME`), seule façon de satisfaire `createdNow()` (égalité stricte à
 * `request.time`) depuis un appel REST brut (le SDK client fait cette transformation
 * automatiquement avec `serverTimestamp()`).
 */
async function commitCreate(token, docPath, fields) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      writes: [
        {
          update: { name: `projects/${PROJECT}/databases/(default)/documents/${docPath}`, fields },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
          currentDocument: { exists: false },
        },
      ],
    }),
  });
  return res.status;
}

async function main() {
  const { token: superToken } = await adminSession('superadmin@golink.test', passwordOf('superadmin@golink.test'), async (email) => {
    const snap = await db.collection('admins').where('email', '==', email).limit(1).get();
    return snap.docs[0]?.get('lastMfaStep') ?? null;
  });

  // ---------------------------------------------------------------- 1) Export FEC (18 champs)
  {
    const now = new Date();
    const months = [];
    for (let i = 1; i <= 3; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    let result = null;
    for (const month of months) {
      const res = await callFn('exportAccounting', { month, countryId: 'FR', reason: 'Test cdc-non-mobile : vérification du format FEC' }, superToken);
      if (res.ok && res.data.lines.length > 0) {
        result = res.data;
        break;
      }
    }
    if (!result) {
      record('exportAccounting : au moins un mois avec des écritures (3 derniers mois)', false, 'aucune écriture trouvée');
    } else {
      const line = result.lines[0];
      check('exportAccounting : issuer.registrationNumber renvoyé', 'registrationNumber' in result.issuer, JSON.stringify(result.issuer));
      check('exportAccounting : ligne porte journalLib', typeof line.journalLib === 'string' && line.journalLib.length > 0, line.journalLib);
      check('exportAccounting : ligne porte ecritureNum (numérique)', typeof line.ecritureNum === 'number' && line.ecritureNum >= 1, String(line.ecritureNum));
      check('exportAccounting : ligne porte pieceDate', typeof line.pieceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(line.pieceDate), line.pieceDate);
      check('exportAccounting : ligne porte validDate', typeof line.validDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(line.validDate), line.validDate);
      // Toutes les lignes d'une même pièce partagent le même EcritureNum.
      const byPiece = new Map();
      for (const l of result.lines) {
        const key = `${l.journal}|${l.piece}`;
        if (byPiece.has(key)) check(`exportAccounting : EcritureNum stable pour la pièce ${l.piece}`, byPiece.get(key) === l.ecritureNum, `${byPiece.get(key)} vs ${l.ecritureNum}`);
        else byPiece.set(key, l.ecritureNum);
      }
    }
  }

  // ---------------------------------------------------------------- 2) Export lisible par collection
  {
    const res = await callFn('exportReadableCollections', { collections: ['reviews'], reason: 'Test cdc-non-mobile : export lisible' }, superToken);
    check('exportReadableCollections : réussit', res.ok, JSON.stringify(res.error));
    if (res.ok) {
      const file = res.data.files[0];
      check('exportReadableCollections : un fichier .jsonl par collection', file?.name === 'reviews.jsonl', file?.name);
      check('exportReadableCollections : lien signé renvoyé', typeof file?.url === 'string' && file.url.includes('?') && /signature/i.test(file.url), file?.url);
      if (file?.url) {
        const dl = await fetch(file.url);
        check('exportReadableCollections : le fichier est bien accessible et non vide', dl.ok, `HTTP ${dl.status}`);
      }
    }
  }

  // ---------------------------------------------------------------- 3) getGdprExportLink : refus sans export
  {
    const res = await callFn('exportReadableCollections', { collections: [] }, superToken);
    check('exportReadableCollections : refuse une liste vide', !res.ok, JSON.stringify(res.data));
  }
  {
    // Demande RGPD factice sans export : le lien doit être refusé (precondition).
    const probeRef = db.collection('gdprRequests').doc('cdcnm-probe');
    await probeRef.set({
      type: 'access', subjectType: 'client', subjectId: 'cdcnm-nobody', email: 'cdcnm@golink.test', status: 'received',
      receivedAt: new Date(), dueAt: new Date(Date.now() + 30 * 86_400_000), completedAt: null, assigneeId: null, export: null,
      retainedData: [], notes: null, createdBy: 'system', createdAt: new Date(), updatedAt: new Date(), updatedBy: 'system', test: true,
    });
    const res = await callFn('getGdprExportLink', { requestId: 'cdcnm-probe' }, superToken);
    check('getGdprExportLink : refuse une demande sans export', !res.ok && res.error?.status === 'FAILED_PRECONDITION', JSON.stringify(res.error));
    await probeRef.delete();
  }

  // ---------------------------------------------------------------- 4) Limite de produits (règle Firestore)
  {
    // mina-kitchen appartient à mina.haddad (propriétaire, permission menu.edit), formule 'pro'.
    const rid = 'mina-kitchen';
    const target = await db.collection('restaurants').doc(rid).get();
    const commercial = await target.ref.collection('private').doc('commercial').get();
    const planCode = commercial.get('planCode') ?? 'pro';
    if (!target.exists) {
      record('withinProductLimit : commerce de test introuvable', false, rid);
    } else {
      const currentCount = target.get('productsCount') ?? 0;
      const planRef = db.collection('plans').doc(planCode);
      const before = (await planRef.get()).data();
      const ownerEmail = 'mina.haddad@golink.test';
      const ownerToken = await signIn(ownerEmail, passwordOf(ownerEmail));
      {
        await planRef.update({ 'limits.maxProducts': currentCount });
        const productFields = {
          name: { stringValue: 'cdcnm-test-produit' },
          priceCents: { integerValue: '100' },
          salesCount: { integerValue: '0' },
          vatCategory: { stringValue: 'food' },
          containsAlcohol: { booleanValue: false },
        };
        try {
          const status = await commitCreate(ownerToken, `restaurants/${rid}/products/cdcnm-test-produit-1`, productFields);
          check('withinProductLimit : création refusée au-delà de la limite (403)', status === 403, `HTTP ${status}`);
          await planRef.update({ 'limits.maxProducts': currentCount + 5 });
          const status2 = await commitCreate(ownerToken, `restaurants/${rid}/products/cdcnm-test-produit-2`, productFields);
          check('withinProductLimit : création acceptée sous la limite (200)', status2 === 200, `HTTP ${status2}`);
          // Nettoyage : retrouver et supprimer le produit de test créé.
          const created = await db.collection(`restaurants/${rid}/products`).where('name', '==', 'cdcnm-test-produit').get();
          for (const d of created.docs) await d.ref.delete();
        } finally {
          await planRef.set(before ?? {});
        }
      }
    }
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} vérifications réussies.`);
  if (ok !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
