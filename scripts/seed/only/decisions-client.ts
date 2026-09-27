// Applique à la base réelle les décisions du client (docs/DECISIONS_CLIENT.md) sur les
// seuls documents de paramètres : settings (général, règles de commande, paiements,
// fidélité, parrainage, promotions, reversements), countries (FR, BE, LU, DZ, MA, TN),
// plans (Basic, Pro, Premium) et les interrupteurs concernés (alcool, titres-restaurant,
// fidélité). Aucune autre collection n'est touchée.
//
// Réglages, pays et formules sont remplacés intégralement (date de création d'origine
// conservée) ; les interrupteurs sont écrits en fusion.
//
//   npx tsx scripts/seed/only/decisions-client.ts --dry-run   (affiche sans écrire)
//   npx tsx scripts/seed/only/decisions-client.ts
import { Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS } from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';
import { countryDocs, featureFlagDocs, planDocs, platformSettingsDocs } from '../platform';

const DRY_RUN = process.argv.includes('--dry-run');
const DECISION_FLAGS = new Set(['alcohol_sales', 'meal_voucher', 'loyalty', 'tips', 'cash_payment', 'scheduled_orders']);

async function main(): Promise<void> {
  const by = account('superAdmin').uid;
  const now = Timestamp.now();
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];

  for (const [id, data] of Object.entries(platformSettingsDocs())) {
    writes.push({ path: `${COLLECTIONS.settings}/${id}`, data: { ...data, updatedAt: now, updatedBy: by } });
  }
  for (const { id, ...country } of countryDocs(now, by)) writes.push({ path: `${COLLECTIONS.countries}/${id}`, data: country });
  for (const { id, ...plan } of planDocs(now, by)) writes.push({ path: `${COLLECTIONS.plans}/${id}`, data: plan });
  for (const flag of featureFlagDocs(now, by)) {
    if (!DECISION_FLAGS.has(flag.key)) continue;
    const { overrides: _overrides, ...rest } = flag;
    // Alcool verrouillé : aucune surcharge ne doit pouvoir le réactiver.
    const data: Record<string, unknown> = flag.key === 'alcohol_sales' || flag.key === 'meal_voucher' ? { ...rest, overrides: [] } : rest;
    writes.push({ path: `${COLLECTIONS.featureFlags}/${flag.key}`, data });
  }

  const snaps = await db.getAll(...writes.map((w) => db.doc(w.path)));
  const batch = db.batch();
  for (const [i, w] of writes.entries()) {
    const snap = snaps[i]!;
    const data = { ...w.data };
    const isFlag = w.path.startsWith(`${COLLECTIONS.featureFlags}/`);
    if (snap.exists && !isFlag) {
      // Remplacement complet (les cartes imbriquées comme refundLiability ne doivent pas
      // être fusionnées avec l'ancienne valeur), en gardant la création d'origine.
      if (snap.get('createdAt') !== undefined) data.createdAt = snap.get('createdAt');
      if (snap.get('createdBy') !== undefined) data.createdBy = snap.get('createdBy');
    }
    console.log(`${snap.exists ? 'mise à jour' : 'création  '} ${w.path}`);
    // Interrupteurs : fusion (les surcharges des autres fonctionnalités sont conservées).
    if (isFlag) batch.set(db.doc(w.path), data, { merge: true });
    else batch.set(db.doc(w.path), data);
  }
  if (DRY_RUN) {
    console.log(`\n${writes.length} documents (simulation, rien n'est écrit).`);
    return;
  }
  await batch.commit();
  console.log(`\n${writes.length} documents de paramètres écrits.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
