// Base de démonstration GoLink : `npm run seed` (idempotent, identifiants stables).
// `npm run seed -- --reset` supprime d'abord toutes les données marquées seed:true.
// Chaque document écrit porte `seed: true`.
import { COLLECTIONS, SUBCOLLECTIONS } from '@golink/shared';
import { auth, bucket, db, PROJECT_ID } from '../lib/admin.mjs';
import { TEST_ACCOUNTS, account, upsertTestAccounts } from './accounts';
import { seedAdministration, seedStaffProfiles } from './admin';
import { CITIES } from './catalog';
import { createContext } from './context';
import { seedFinance } from './finance';
import { seedGrowth } from './growth';
import { ts } from './lib';
import { seedOrders } from './orders';
import { buildClients, buildDrivers, writeClients, writeDrivers } from './people';
import { seedCounters, seedPlatform } from './platform';
import { seedRestaurants } from './restaurants';
import { seedSupport } from './support';
import { seedWorkforce } from './workforce';

/** Supprime les documents racine marqués seed:true et leurs sous-collections (les autres données sont conservées). */
async function resetSeedData(): Promise<number> {
  const writer = db.bulkWriter();
  let deleted = 0;
  for (const name of Object.values(COLLECTIONS)) {
    const snap = await db.collection(name).where('seed', '==', true).select().get();
    for (let i = 0; i < snap.docs.length; i += 50) {
      await Promise.all(snap.docs.slice(i, i + 50).map((doc) => db.recursiveDelete(doc.ref, writer)));
    }
    deleted += snap.size;
  }
  await writer.close();
  return deleted;
}

async function main(): Promise<void> {
  const started = Date.now();
  console.log(`Seed GoLink → projet ${PROJECT_ID}`);
  if (process.argv.includes('--reset')) console.log(`Réinitialisation : ${await resetSeedData()} documents racine supprimés.`);

  const ctx = createContext(db, bucket, account('superAdmin').uid);
  const { w } = ctx;

  // 1. Plateforme, restaurants, équipe interne (avant les comptes Auth).
  seedPlatform(ctx);
  const restaurants = seedRestaurants(ctx);
  seedStaffProfiles(ctx);
  await w.flush();
  const accounts = await upsertTestAccounts(auth);
  console.log(`Comptes de test : ${accounts.created} créés, ${accounts.updated} mis à jour.`);

  // 2. Clients, livreurs, commandes et tout ce qui en découle.
  const clients = buildClients(ctx);
  const drivers = buildDrivers(ctx);
  const outcome = seedOrders(ctx, restaurants, clients, drivers);
  console.log(`Commandes générées : ${outcome.orders.length}.`);
  writeClients(ctx, clients);
  writeDrivers(ctx, drivers);
  const invoiceCounters = seedFinance(ctx, outcome.orders, restaurants, drivers);
  seedGrowth(ctx, outcome.orders, clients);
  const tickets = seedSupport(ctx, outcome.orders);
  const workforce = seedWorkforce(ctx);
  seedAdministration(ctx, outcome.orders);
  console.log('Écriture en cours…');
  seedCounters(ctx, {
    orders: { prefix: 'GL-', value: 10000 + outcome.orders.length },
    tickets: { prefix: 'T-', value: 4600 },
    ...invoiceCounters,
  });
  await w.flush();

  // 3. Agrégats reportés sur les documents déjà écrits.
  for (const r of restaurants) {
    const stats = outcome.restaurantStats.get(r.seed.id);
    const ratings = stats?.ratings ?? [];
    w.merge(w.doc(`${COLLECTIONS.restaurants}/${r.seed.id}`), {
      ordersCount: stats?.orders ?? 0,
      rating: {
        average: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : r.seed.rating,
        count: ratings.length,
      },
    });
    for (const p of r.products) {
      w.merge(w.doc(`${COLLECTIONS.restaurants}/${r.seed.id}/${SUBCOLLECTIONS.restaurants.products}/${p.id}`), {
        salesCount: outcome.productSales.get(`${r.seed.id}/${p.id}`) ?? 0,
      });
    }
  }
  for (const city of CITIES) {
    w.merge(w.doc(`${COLLECTIONS.cities}/${city.id}`), {
      stats: {
        restaurantsActive: restaurants.filter((r) => r.seed.cityId === city.id && r.seed.status !== 'onboarding').length,
        driversActive: drivers.filter((d) => d.cityId === city.id && d.status === 'active').length,
        customers: clients.filter((c) => c.cityId === city.id).length,
        updatedAt: ctx.nowTs,
      },
    });
  }
  const liveZones = ['longwy-centre', 'metz-centre', 'luxembourg-centre'];
  for (const zoneId of liveZones) {
    const cityId = zoneId.replace('-centre', '');
    const online = drivers.filter((d) => d.cityId === cityId && d.status === 'active').length;
    w.merge(w.doc(`${COLLECTIONS.zones}/${zoneId}`), {
      live: { driversOnline: Math.ceil(online / 3), driversAvailable: Math.ceil(online / 5), ordersWaiting: 0, updatedAt: ts(ctx.now) },
    });
  }
  await w.close();
  await ctx.files.done();

  // 4. Résumé.
  const lines = [...w.counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = lines.reduce((s, [, n]) => s + n, 0);
  console.log('\nDocuments écrits par collection :');
  for (const [name, n] of lines) console.log(`  ${name.padEnd(48)} ${n}`);
  console.log(`\nTotal : ${total} documents, ${ctx.files.count} fichiers Storage.`);
  console.log(`Commandes : ${outcome.orders.length} · avis : ${outcome.reviewsCount} · remboursements : ${outcome.refundsCount} · tickets : ${tickets}`);
  console.log(`Équipe : ${workforce.employees} salariés, ${workforce.shifts} créneaux de planning.`);
  console.log(`Comptes de test (${TEST_ACCOUNTS.length}) : identifiants dans .test-accounts.local.md`);
  console.log(`Durée : ${Math.round((Date.now() - started) / 1000)} s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
