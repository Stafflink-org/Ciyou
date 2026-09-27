// Données complémentaires « Plateforme & sécurité » (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/a-plateforme-securite.ts
//   npx tsx scripts/seed/only/a-plateforme-securite.ts --dry-run
//
// Complète les collections propres à ce module, encore vides après le seed principal
// (scripts/seed/platform.ts couvre déjà settings, countries, featureFlags, integrations,
// serviceStatus, incidents, adminRoles, legalDocuments) :
//  - securityAlerts   : alertes de démonstration (ouvertes et traitées) ;
//  - fraudCases       : dossiers avec signaux, sur des comptes réels de la base ;
//  - blocklist        : quelques entrées bloquées (empreintes SHA-256, comme le backend) ;
//  - gdprRequests     : demandes RGPD (accès terminé, effacement en cours) ;
//  - backups          : historique de démonstration d'une sauvegarde planifiée.
// Identifiants stables préfixés `seed-` : relancer le script ne crée pas de doublon.
// N'écrit jamais dans `trash` (une entrée doit provenir d'une vraie suppression, avec
// l'instantané exact du document, pour rester restaurable).
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS, type BlocklistEntry, type FraudCase, type GdprRequest, type SecurityAlert } from '@golink/shared';
import { db } from '../../lib/admin.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const now = Timestamp.now();
const daysAgo = (n: number) => Timestamp.fromMillis(Date.now() - n * 86_400_000);
const sha256 = (v: string) => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

async function commit(writes: Array<{ path: string; data: Record<string, unknown> }>): Promise<void> {
  if (DRY_RUN) {
    for (const w of writes) console.log('  ·', w.path);
    return;
  }
  const batch = db.batch();
  for (const w of writes) batch.set(db.doc(w.path), w.data, { merge: true });
  await batch.commit();
}

async function main() {
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];

  // ------------------------------------------------------------------ Alertes de sécurité
  const alerts: Array<Omit<SecurityAlert, 'detectedAt' | 'handledAt'> & { detectedAt: Timestamp; handledAt: Timestamp | null; id: string }> = [
    { id: 'seed-alert-unusual-login', type: 'unusual_login', adminId: 'test-support', severity: 'warning', details: "Connexion inhabituelle : agent support connecté depuis un nouveau pays (démonstration).", status: 'open', detectedAt: daysAgo(1), handledBy: null, handledAt: null },
    { id: 'seed-alert-new-device', type: 'new_device' as SecurityAlert['type'], adminId: 'test-finance', severity: 'info', details: 'Connexion de Hélène Kremer depuis un nouvel appareil (démonstration).', status: 'open', detectedAt: daysAgo(2), handledBy: null, handledAt: null },
    { id: 'seed-alert-refund-spike-resolved', type: 'refund_spike', adminId: 'test-support', severity: 'warning', details: '18 remboursements en une heure par Malik Benyahia (seuil 15) — démonstration.', status: 'resolved', detectedAt: daysAgo(10), handledBy: 'test-super-admin', handledAt: daysAgo(9) },
  ];
  for (const a of alerts) {
    const { id, ...data } = a;
    writes.push({ path: `${COLLECTIONS.securityAlerts}/${id}`, data: { ...data, seed: true } });
  }

  // ------------------------------------------------------------------ Fraude
  const [clients, restaurants] = await Promise.all([
    db.collection(COLLECTIONS.users).where('role', '==', 'client').limit(2).get(),
    db.collection(COLLECTIONS.restaurants).limit(1).get(),
  ]);
  const client0 = clients.docs[0];
  const client1 = clients.docs[1] ?? client0;
  const restaurant0 = restaurants.docs[0];

  if (client0) {
    const signals: FraudCase['signals'] = [
      { code: 'frequent_not_received', detail: "3 commandes « non reçues » sur 5 en 14 jours (démonstration).", score: 25, at: daysAgo(3) },
      { code: 'promo_abuse', detail: '6 codes promotionnels différents utilisés en 14 jours (démonstration).', score: 20, at: daysAgo(1) },
    ];
    const data: FraudCase = {
      subjectType: 'client',
      subjectId: client0.id,
      subjectName: String(client0.get('displayName') ?? 'Client'),
      countryId: String(client0.get('countryId') ?? 'FR'),
      cityId: (client0.get('cityId') as string | undefined) ?? null,
      signals,
      riskScore: signals.reduce((s, x) => s + x.score, 0),
      status: 'open',
      assigneeId: null,
      decision: null,
      linkedEntities: [{ type: 'client', id: client0.id, label: String(client0.get('displayName') ?? 'Client') }],
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    };
    writes.push({ path: `${COLLECTIONS.fraudCases}/client_${client0.id}`, data: { ...data, seed: true } });
  }
  if (restaurant0) {
    const signals: FraudCase['signals'] = [{ code: 'refund_rate', detail: '11 remboursements en 14 jours (démonstration).', score: 20, at: daysAgo(2) }];
    const data: FraudCase = {
      subjectType: 'restaurant',
      subjectId: restaurant0.id,
      subjectName: String(restaurant0.get('name') ?? 'Commerce'),
      countryId: String(restaurant0.get('countryId') ?? 'FR'),
      cityId: (restaurant0.get('cityId') as string | undefined) ?? null,
      signals,
      riskScore: signals.reduce((s, x) => s + x.score, 0),
      status: 'investigating',
      assigneeId: 'test-support',
      decision: null,
      linkedEntities: [{ type: 'restaurant', id: restaurant0.id, label: String(restaurant0.get('name') ?? 'Commerce') }],
      createdAt: daysAgo(4),
      createdBy: 'system',
      updatedAt: daysAgo(1),
      updatedBy: 'test-support',
    };
    writes.push({ path: `${COLLECTIONS.fraudCases}/restaurant_${restaurant0.id}`, data: { ...data, seed: true } });
  }

  // ------------------------------------------------------------------ Liste de blocage
  const blocklistEntries: Array<Omit<BlocklistEntry, 'createdAt' | 'updatedAt'> & { id: string }> = [
    { id: 'seed-blocklist-phone', type: 'phone', valueHash: sha256('+33600000099'), valuePreview: '+336 ** ** ** 99', reason: 'Numéro utilisé pour des commandes fictives répétées (démonstration).', fraudCaseId: null, expiresAt: null, active: true, createdBy: 'test-super-admin', updatedBy: 'test-super-admin' },
    { id: 'seed-blocklist-email', type: 'email', valueHash: sha256('fraude.demo@example.com'), valuePreview: 'fr••@example.com', reason: 'Compte créé après un blocage précédent (démonstration).', fraudCaseId: null, expiresAt: null, active: true, createdBy: 'test-super-admin', updatedBy: 'test-super-admin' },
  ];
  for (const b of blocklistEntries) {
    const { id, ...data } = b;
    writes.push({ path: `${COLLECTIONS.blocklist}/${id}`, data: { ...data, createdAt: daysAgo(7), updatedAt: daysAgo(7), seed: true } });
  }

  // ------------------------------------------------------------------ Demandes RGPD
  if (client0) {
    const received = daysAgo(5);
    const data: GdprRequest = {
      type: 'access',
      subjectType: 'client',
      subjectId: client0.id,
      email: String(client0.get('email') ?? 'client@golink.test'),
      status: 'completed',
      receivedAt: received,
      dueAt: Timestamp.fromMillis(received.toMillis() + 30 * 86_400_000),
      completedAt: daysAgo(2),
      assigneeId: 'test-support',
      export: null,
      retainedData: [],
      notes: 'Export transmis par e-mail (démonstration).',
      createdAt: received,
      createdBy: 'test-support',
      updatedAt: daysAgo(2),
      updatedBy: 'test-support',
    };
    writes.push({ path: `${COLLECTIONS.gdprRequests}/seed-gdpr-access`, data: { ...data, seed: true } });
  }
  if (client1) {
    const received = daysAgo(3);
    const data: GdprRequest = {
      type: 'erasure',
      subjectType: 'client',
      subjectId: client1.id,
      email: String(client1.get('email') ?? 'client2@golink.test'),
      status: 'in_progress',
      receivedAt: received,
      dueAt: Timestamp.fromMillis(received.toMillis() + 30 * 86_400_000),
      completedAt: null,
      assigneeId: 'test-support',
      export: null,
      retainedData: [],
      notes: "Vérification d'identité en cours (démonstration).",
      createdAt: received,
      createdBy: 'test-support',
      updatedAt: received,
      updatedBy: 'test-support',
    };
    writes.push({ path: `${COLLECTIONS.gdprRequests}/seed-gdpr-erasure`, data: { ...data, seed: true } });
  }

  // ------------------------------------------------------------------ Sauvegardes (historique de démonstration)
  const startedAt = daysAgo(1);
  writes.push({
    path: `${COLLECTIONS.backups}/seed-backup-scheduled`,
    data: {
      kind: 'scheduled',
      status: 'completed',
      bucketPath: 'gs://golink-9f16d-backups/seed-backup-scheduled',
      collections: null,
      sizeBytes: null,
      startedAt,
      finishedAt: Timestamp.fromMillis(startedAt.toMillis() + 12 * 60_000),
      error: null,
      requestedBy: 'system',
      seed: true,
    },
  });

  await commit(writes);
  console.log(`${DRY_RUN ? '[essai à blanc] ' : ''}${writes.length} document(s) écrits pour « Plateforme & sécurité ».`);
  console.log("Aucune entrée de corbeille n'est simulée : une restauration exige l'instantané exact d'une vraie suppression.");

  // ------------------------------------------------------------------ Correctif : permission d'accès à la rubrique
  // `platform.access` a été ajoutée après le seed principal (support/finance n'avaient que
  // des droits partiels — fraud.view, gdpr.handle — et ne voyaient donc jamais le menu).
  // Complète les comptes déjà seedés sans toucher au reste de leurs permissions.
  const adminsNeedingAccess = ['test-support', 'test-finance'];
  if (!DRY_RUN) {
    const batch = db.batch();
    let patched = 0;
    for (const uid of adminsNeedingAccess) {
      const ref = db.doc(`${COLLECTIONS.admins}/${uid}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const perms = (snap.get('permissions') as string[] | undefined) ?? [];
      if (perms.includes('platform.access')) continue;
      batch.update(ref, { permissions: FieldValue.arrayUnion('platform.access') });
      patched += 1;
    }
    if (patched > 0) {
      await batch.commit();
      console.log(`${patched} compte(s) administrateur complété(s) avec la permission « platform.access ».`);
    }
  } else {
    console.log('[essai à blanc] ajouterait « platform.access » aux administrateurs support/finance déjà seedés, si absent.');
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
