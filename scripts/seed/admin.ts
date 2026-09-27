// Administration : équipe interne et profils des comptes de test, journal
// d'audit, alertes et file « à traiter », fraude, RGPD, corbeille, sauvegardes.
import {
  COLLECTIONS,
  DEFAULT_ADMIN_ROLE_PERMISSIONS,
  buildSearchKeywords,
  type AdminSession,
  type AdminUser,
  type AuditLog,
  type Backup,
  type BlocklistEntry,
  type BulkJob,
  type FraudCase,
  type GdprRequest,
  type ImpersonationSession,
  type InternalNote,
  type PlatformAlert,
  type SavedFilter,
  type ScheduledReport,
  type SecurityAlert,
  type TrashItem,
  type UserPrivate,
  type UserProfile,
} from '@golink/shared';
import { TEST_ACCOUNTS, account } from './accounts';
import { tracked, type SeedContext } from './context';
import { addDays, minutesAfter, parisTime, ts } from './lib';
import type { SeededOrder } from './orders';

/** Équipe interne et profils users/{uid} des comptes de test (écrits avant la création des comptes Auth). */
export function seedStaffProfiles(ctx: SeedContext): void {
  const { w, nowTs } = ctx;
  const since = ts(parisTime(addDays(ctx.today, -120), 9 * 60));
  for (const a of TEST_ACCOUNTS) {
    const displayName = `${a.firstName} ${a.lastName}`;
    if (a.admin) {
      const admin: AdminUser = {
        uid: a.uid,
        email: a.email,
        displayName,
        role: a.admin.role,
        permissions: [...DEFAULT_ADMIN_ROLE_PERMISSIONS[a.admin.role]],
        active: true,
        countryIds: [],
        cityIds: a.admin.cityIds,
        refundLimitCents: null,
        mfaEnrolled: false,
        lastLoginAt: ts(minutesAfter(ctx.now, -ctx.rng.int(10, 2000))),
        lastLoginIp: null,
        ...tracked(since, a.key === 'superAdmin' ? 'system' : ctx.superAdminUid),
      };
      w.set(w.doc(`${COLLECTIONS.admins}/${a.uid}`), admin);
    }
    const profile: UserProfile = {
      role: a.admin ? 'admin' : 'restaurant',
      firstName: a.firstName,
      lastName: a.lastName,
      displayName,
      email: a.email,
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      avatar: null,
      locale: 'fr',
      status: 'active',
      defaultAddressId: null,
      consents: {},
      notificationPrefs: { orderUpdates: true, promotions: false, newsletter: false },
      walletBalanceCents: 0,
      referralCode: `EQ${a.uid.slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
      referredBy: null,
      stats: { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null, firstOrderAt: null, cancelledCount: 0, refundsCount: 0 },
      acceptedLegal: a.admin ? {} : { terms_restaurant: '2026-06' },
      countryId: a.admin ? undefined : 'FR',
      cityId: a.admin?.cityIds[0] ?? (a.admin ? null : 'longwy'),
      lastLoginAt: nowTs,
      lastSeenAt: nowTs,
      searchKeywords: buildSearchKeywords(displayName, a.email),
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      ...tracked(since, a.uid),
    };
    w.set(w.doc(`${COLLECTIONS.users}/${a.uid}`), profile);
    const priv: UserPrivate = { stripeCustomerId: null, riskScore: 0, riskFlags: [], deviceHashes: [], cardFingerprints: [], phoneHash: null, fraudCaseIds: [], updatedAt: nowTs };
    w.set(w.doc(`${COLLECTIONS.userPrivate}/${a.uid}`), priv);
  }
}

export function seedAdministration(ctx: SeedContext, orders: SeededOrder[]): void {
  const { w, rng, nowTs, superAdminUid: superAdmin } = ctx;
  const actor = (key: string): AuditLog['actor'] => {
    const a = account(key);
    return { uid: a.uid, type: a.admin ? 'admin' : 'restaurant', role: a.admin?.role ?? 'owner', name: `${a.firstName} ${a.lastName}` };
  };

  // ------------------------------------------------------------ Journal d'audit
  const entries: Array<[number, string, string, AuditLog['target'], string | null, Record<string, unknown> | null, Record<string, unknown> | null, boolean]> = [
    [-118, 'superAdmin', 'city.launched', { type: 'city', id: 'longwy', label: 'Longwy' }, 'Ouverture commerciale', { active: false }, { active: true }, false],
    [-117, 'superAdmin', 'city.launched', { type: 'city', id: 'metz', label: 'Metz' }, 'Ouverture commerciale', { active: false }, { active: true }, false],
    [-116, 'superAdmin', 'city.launched', { type: 'city', id: 'luxembourg', label: 'Luxembourg' }, 'Ouverture commerciale', { active: false }, { active: true }, false],
    [-115, 'superAdmin', 'admin.invited', { type: 'admin', id: 'test-support', label: 'support@golink.test' }, null, null, { role: 'support' }, true],
    [-115, 'superAdmin', 'admin.invited', { type: 'admin', id: 'test-finance', label: 'finance@golink.test' }, null, null, { role: 'finance' }, true],
    [-110, 'superAdmin', 'restaurant.approved', { type: 'restaurant', id: 'mina-kitchen', label: 'Mina Kitchen' }, 'Dossier complet', { onboardingStatus: 'pending' }, { onboardingStatus: 'approved' }, false],
    [-95, 'finance', 'restaurant.commission_negotiated', { type: 'restaurant', id: 'kumo-ramen', label: 'Kumo Ramen' }, 'Volume garanti de 250 commandes par mois', { platformDeliveryBps: 2400 }, { platformDeliveryBps: 2200 }, true],
    [-40, 'superAdmin', 'settings.updated', { type: 'setting', id: 'countries/LU', label: 'Tarifs de livraison Luxembourg' }, 'Alignement sur le coût de la vie', null, null, false],
    [-12, 'support', 'order.refunded', { type: 'order', id: orders[orders.length - 200]?.id ?? 'o-10001', label: orders[orders.length - 200]?.number ?? null }, 'Article manquant', null, { amountCents: 850 }, false],
    [-6, 'finance', 'payout.held', { type: 'restaurant', id: 'casa-arepa', label: 'Casa Arepa' }, 'Attestation hygiène expirée', { payoutsBlocked: false }, { payoutsBlocked: true }, true],
    [-2, 'superAdmin', 'driver.suspended', { type: 'driver', id: 'seed-driver-010', label: null }, 'Trois signalements de non-remise', { status: 'active' }, { status: 'suspended' }, true],
    [-1, 'cityMetz', 'zone.updated', { type: 'zone', id: 'metz-sud-est', label: 'Metz Sud-Est' }, 'Extension vers Magny', null, null, false],
    [-1, 'support', 'customer.blocked', { type: 'client', id: 'seed-client-017', label: null }, 'Réclamations abusives répétées', { status: 'active' }, { status: 'blocked' }, true],
    [0, 'owner', 'restaurant.member_invited', { type: 'restaurant', id: 'mina-kitchen', label: 'Mina Kitchen' }, null, null, { role: 'service' }, false],
  ];
  entries.forEach(([day, key, action, target, reason, before, after, sensitive], i) => {
    const log: AuditLog = {
      actor: actor(key),
      action,
      target,
      countryId: target.id.includes('luxembourg') || target.id === 'kumo-ramen' ? 'LU' : 'FR',
      cityId: null,
      reason,
      before,
      after,
      impersonationSessionId: null,
      ipHash: null,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15',
      sensitive,
      at: ts(parisTime(addDays(ctx.today, day), 9 * 60 + i * 17)),
    };
    w.set(w.doc(`${COLLECTIONS.auditLogs}/seed-audit-${String(i + 1).padStart(3, '0')}`), log);
  });

  // ------------------------------------------------------------ Alertes et file « à traiter »
  const alerts: Array<Omit<PlatformAlert, 'status' | 'detectedAt'> & { id: string; hoursAgo: number; status?: PlatformAlert['status'] }> = [
    { id: 'alerte-validation-maison-pita', kind: 'restaurant_to_validate', queue: 'todo', severity: 'info', title: 'Nouveau restaurant à valider : Maison Pita', message: 'Nikos Papadakis a inscrit Maison Pita à Thionville.', target: { type: 'restaurant', id: 'maison-pita', label: 'Maison Pita' }, countryId: 'FR', cityId: 'thionville', metric: null, dedupKey: 'restaurant_to_validate_maison-pita', hoursAgo: 30 },
    { id: 'alerte-validation-remparts', kind: 'restaurant_to_validate', queue: 'todo', severity: 'warning', title: 'Documents manquants : Brasserie des Remparts', message: 'RIB et attestation hygiène non déposés.', target: { type: 'restaurant', id: 'brasserie-des-remparts', label: 'Brasserie des Remparts' }, countryId: 'FR', cityId: 'metz', metric: null, dedupKey: 'restaurant_to_validate_brasserie-des-remparts', hoursAgo: 50 },
    { id: 'alerte-livreur-a-valider', kind: 'driver_to_validate', queue: 'todo', severity: 'info', title: 'Candidature livreur à Metz', message: 'Pièces déposées, contrôle d’identité à effectuer.', target: { type: 'driver', id: 'seed-driver-031', label: null }, countryId: 'FR', cityId: 'metz', metric: null, dedupKey: 'driver_to_validate_seed-driver-031', hoursAgo: 40 },
    { id: 'alerte-document-casa', kind: 'document_expired', queue: 'todo', severity: 'warning', title: 'Attestation hygiène expirée : Casa Arepa', message: 'Reversements suspendus jusqu’au dépôt du nouveau document.', target: { type: 'restaurant', id: 'casa-arepa', label: 'Casa Arepa' }, countryId: 'FR', cityId: 'longwy', metric: null, dedupKey: 'document_expired_casa-arepa_hygiene', hoursAgo: 140 },
    { id: 'alerte-abonnement-beldi', kind: 'subscription_unpaid', queue: 'todo', severity: 'warning', title: 'Abonnement impayé : Beldi Bowls', message: 'Deux tentatives de prélèvement refusées. Prochaine tentative demain.', target: { type: 'subscription', id: 'sub-beldi-bowls', label: 'Beldi Bowls' }, countryId: 'LU', cityId: 'luxembourg', metric: null, dedupKey: 'subscription_unpaid_sub-beldi-bowls', hoursAgo: 48 },
    { id: 'alerte-reversement-beldi', kind: 'payout_failed', queue: 'alert', severity: 'critical', title: 'Reversement refusé : Beldi Bowls', message: 'La banque a rejeté le virement (compte clôturé).', target: { type: 'restaurant', id: 'beldi-bowls', label: 'Beldi Bowls' }, countryId: 'LU', cityId: 'luxembourg', metric: null, dedupKey: 'payout_failed_beldi-bowls', hoursAgo: 20 },
    { id: 'alerte-annulations-santo', kind: 'restaurant_cancellation_rate', queue: 'alert', severity: 'warning', title: 'Taux d’annulation élevé : Santo Smash', message: '9 % d’annulations sur 7 jours (seuil 6 %).', target: { type: 'restaurant', id: 'santo-smash', label: 'Santo Smash' }, countryId: 'FR', cityId: 'metz', metric: { value: 9, threshold: 6, unit: '%' }, dedupKey: 'restaurant_cancellation_rate_santo-smash', hoursAgo: 8 },
    { id: 'alerte-penurie-luxembourg', kind: 'zone_driver_shortage', queue: 'alert', severity: 'warning', title: 'Manque de livreurs : Luxembourg Centre', message: '0,4 livreur disponible par commande en attente vendredi soir.', target: { type: 'zone', id: 'luxembourg-centre', label: 'Luxembourg Centre' }, countryId: 'LU', cityId: 'luxembourg', metric: { value: 0.4, threshold: 0.6, unit: 'ratio' }, dedupKey: 'zone_driver_shortage_luxembourg-centre', hoursAgo: 60, status: 'acknowledged' },
    { id: 'alerte-avis-signale', kind: 'review_reported', queue: 'todo', severity: 'info', title: 'Avis signalé par Santo Smash', message: 'Le restaurant conteste un avis qu’il estime mensonger.', target: { type: 'review', id: 'signalement-1', label: null }, countryId: 'FR', cityId: 'metz', metric: null, dedupKey: 'review_reported_signalement-1', hoursAgo: 5 },
    { id: 'alerte-rgpd', kind: 'gdpr_request', queue: 'todo', severity: 'info', title: 'Demande d’effacement de compte', message: 'Délai légal : un mois à compter de la réception.', target: { type: 'client', id: 'seed-client-044', label: null }, countryId: 'FR', cityId: null, metric: null, dedupKey: 'gdpr_request_rgpd-1', hoursAgo: 72 },
    { id: 'alerte-fraude', kind: 'fraud_signal', queue: 'alert', severity: 'critical', title: 'Réclamations répétées d’un client', message: '4 remboursements en 30 jours, dont 3 pour « article manquant ».', target: { type: 'client', id: 'seed-client-017', label: null }, countryId: 'FR', cityId: 'longwy', metric: { value: 4, threshold: 3, unit: 'remboursements' }, dedupKey: 'fraud_signal_seed-client-017', hoursAgo: 26, status: 'acknowledged' },
    { id: 'alerte-qualite-menu', kind: 'menu_quality', queue: 'todo', severity: 'info', title: 'Photos manquantes sur plusieurs cartes', message: 'Des plats sans photo réduisent la conversion d’environ 20 %.', target: { type: 'other', id: 'menuIssues', label: null }, countryId: null, cityId: null, metric: null, dedupKey: 'menu_quality_photos', hoursAgo: 90 },
  ];
  for (const { id, hoursAgo, status, ...alert } of alerts) {
    const doc: PlatformAlert = {
      ...alert,
      status: status ?? 'open',
      detectedAt: ts(minutesAfter(ctx.now, -hoursAgo * 60)),
      acknowledgedBy: status === 'acknowledged' ? account('support').uid : null,
      acknowledgedAt: status === 'acknowledged' ? ts(minutesAfter(ctx.now, -hoursAgo * 30)) : null,
      resolvedAt: null,
    };
    w.set(w.doc(`${COLLECTIONS.platformAlerts}/${id}`), doc);
  }
  const security: Array<SecurityAlert & { id: string }> = [
    { id: 'securite-connexion', type: 'unusual_login', adminId: account('finance').uid, severity: 'warning', details: 'Connexion depuis un nouvel appareil (Windows, Bruxelles).', status: 'resolved', detectedAt: ts(minutesAfter(ctx.now, -3000)), handledBy: superAdmin, handledAt: ts(minutesAfter(ctx.now, -2900)) },
    { id: 'securite-export', type: 'mass_export', adminId: account('sales').uid, severity: 'info', details: 'Export de 1 240 lignes clients.', status: 'open', detectedAt: ts(minutesAfter(ctx.now, -600)), handledBy: null, handledAt: null },
    { id: 'securite-mfa', type: 'mfa_disabled', adminId: null, severity: 'warning', details: 'La double authentification n’est pas encore imposée à l’équipe interne.', status: 'open', detectedAt: nowTs, handledBy: null, handledAt: null },
  ];
  for (const { id, ...s } of security) w.set(w.doc(`${COLLECTIONS.securityAlerts}/${id}`), s);

  // ------------------------------------------------------------ Notes, filtres, sessions
  const notes: Array<[InternalNote['target'], string, boolean, string]> = [
    [{ type: 'restaurant', id: 'kumo-ramen', label: 'Kumo Ramen' }, 'Partenaire vitrine à Luxembourg : prioriser ses demandes. Commission négociée jusqu’en mars.', true, 'finance'],
    [{ type: 'restaurant', id: 'santo-smash', label: 'Santo Smash' }, 'Annulations en hausse le vendredi soir : manque de personnel en cuisine selon le gérant.', false, 'cityMetz'],
    [{ type: 'client', id: 'seed-client-017', label: null }, 'Client bloqué après enquête : réclamations systématiques sur les commandes > 30 €.', true, 'support'],
    [{ type: 'driver', id: 'seed-driver-010', label: null }, 'Suspension contestée : vérifier les photos de remise avant décision.', false, 'superAdmin'],
  ];
  notes.forEach(([target, body, pinned, key], i) => {
    const a = account(key);
    const note: InternalNote = { target, body, pinned, authorId: a.uid, authorName: `${a.firstName} ${a.lastName}`, createdAt: ts(minutesAfter(ctx.now, -(i + 1) * 900)), updatedAt: ts(minutesAfter(ctx.now, -(i + 1) * 900)) };
    w.set(w.doc(`${COLLECTIONS.internalNotes}/note-${i + 1}`), note);
  });
  const filters: Array<SavedFilter & { id: string }> = [
    { id: 'filtre-pro-metz', ownerId: superAdmin, entity: 'restaurants', name: 'Restaurants Pro à Metz', filters: { cityId: 'metz', planCode: 'pro' }, shared: true, createdAt: nowTs },
    { id: 'filtre-retards', ownerId: account('support').uid, entity: 'orders', name: 'Commandes en retard (7 jours)', filters: { late: true, period: '7d' }, shared: true, createdAt: nowTs },
    { id: 'filtre-reversements-echec', ownerId: account('finance').uid, entity: 'payouts', name: 'Reversements en échec', filters: { status: 'failed' }, shared: false, createdAt: nowTs },
  ];
  for (const { id, ...f } of filters) w.set(w.doc(`${COLLECTIONS.savedFilters}/${id}`), f);
  const session: AdminSession = { adminId: superAdmin, device: 'MacBook Pro · Safari', userAgent: 'Mozilla/5.0 (Macintosh)', ipHash: 'seed', approximateLocation: 'Longwy, France', createdAt: ts(minutesAfter(ctx.now, -240)), lastSeenAt: nowTs, revokedAt: null, revokedBy: null };
  w.set(w.doc(`${COLLECTIONS.adminSessions}/session-super-admin`), session);
  const impersonation: ImpersonationSession = { adminId: account('support').uid, restaurantId: 'santo-smash', mode: 'read_only', reason: 'Vérifier l’affichage des ruptures de stock signalé par le gérant', startedAt: ts(minutesAfter(ctx.now, -1500)), expiresAt: ts(minutesAfter(ctx.now, -1470)), endedAt: ts(minutesAfter(ctx.now, -1480)), actionsCount: 0 };
  w.set(w.doc(`${COLLECTIONS.impersonationSessions}/voir-comme-1`), impersonation);

  // ------------------------------------------------------------ Traitements, rapports
  const jobs: Array<BulkJob & { id: string }> = [
    { id: 'export-commandes-aout', type: 'export', entity: 'orders', params: { period: 'août' }, input: null, format: 'xlsx', status: 'completed', total: 812, processed: 812, succeeded: 812, failed: 0, errors: [], output: null, reason: 'Clôture mensuelle', startedAt: ts(minutesAfter(ctx.now, -8000)), finishedAt: ts(minutesAfter(ctx.now, -7998)), ...tracked(ts(minutesAfter(ctx.now, -8000)), account('finance').uid) },
    { id: 'import-prospects', type: 'import_prospects', entity: 'prospects', params: {}, input: null, format: 'csv', status: 'completed', total: 14, processed: 14, succeeded: 12, failed: 2, errors: [{ row: 7, id: null, message: 'Ville inconnue : Hayange' }, { row: 11, id: null, message: 'E-mail invalide' }], output: null, reason: null, startedAt: ts(minutesAfter(ctx.now, -20000)), finishedAt: ts(minutesAfter(ctx.now, -19999)), ...tracked(ts(minutesAfter(ctx.now, -20000)), account('sales').uid) },
  ];
  for (const { id, ...j } of jobs) w.set(w.doc(`${COLLECTIONS.bulkJobs}/${id}`), j);
  const reports: Array<ScheduledReport & { id: string }> = [
    { id: 'rapport-quotidien', name: 'Synthèse quotidienne', report: 'daily_summary', frequency: 'daily', recipients: ['direction@golink.test'], filters: {}, format: 'pdf', active: true, lastRunAt: ts(parisTime(ctx.today, 7 * 60)), nextRunAt: ts(parisTime(addDays(ctx.today, 1), 7 * 60)), ...tracked(nowTs, superAdmin) },
    { id: 'rapport-finance', name: 'Finance mensuelle', report: 'finance', frequency: 'monthly', recipients: ['finance@golink.test'], filters: { countryId: null }, format: 'xlsx', active: true, lastRunAt: null, nextRunAt: ts(parisTime(`${ctx.today.slice(0, 8)}28`, 8 * 60)), ...tracked(nowTs, account('finance').uid) },
  ];
  for (const { id, ...r } of reports) w.set(w.doc(`${COLLECTIONS.scheduledReports}/${id}`), r);

  // ------------------------------------------------------------ Fraude et conformité
  const fraud: FraudCase = {
    subjectType: 'client',
    subjectId: 'seed-client-017',
    subjectName: 'Client seed-client-017',
    countryId: 'FR',
    cityId: 'longwy',
    signals: [
      { code: 'repeated_claims', detail: '4 réclamations en 30 jours', score: 40, at: ts(minutesAfter(ctx.now, -2000)) },
      { code: 'refund_rate', detail: '38 % des commandes remboursées', score: 30, at: ts(minutesAfter(ctx.now, -1600)) },
      { code: 'linked_accounts', detail: 'Même appareil qu’un compte fermé en juillet', score: 12, at: ts(minutesAfter(ctx.now, -1500)) },
    ],
    riskScore: 82,
    status: 'confirmed',
    assigneeId: account('support').uid,
    decision: { action: 'blocked', note: 'Compte bloqué, cartes ajoutées à la liste de blocage.', by: account('support').uid, at: ts(minutesAfter(ctx.now, -1400)) },
    linkedEntities: [{ type: 'client', id: 'seed-client-017', label: null }],
    ...tracked(ts(minutesAfter(ctx.now, -2000)), 'system'),
  };
  w.set(w.doc(`${COLLECTIONS.fraudCases}/fraude-client-017`), fraud);
  const fraudDriver: FraudCase = {
    subjectType: 'driver', subjectId: 'seed-driver-010', subjectName: 'Livreur seed-driver-010', countryId: 'FR', cityId: 'metz',
    signals: [{ code: 'off_address_delivery', detail: 'Trois livraisons validées à plus de 400 m de l’adresse', score: 35, at: ts(minutesAfter(ctx.now, -3500)) }],
    riskScore: 55, status: 'investigating', assigneeId: superAdmin, decision: null, linkedEntities: [], ...tracked(ts(minutesAfter(ctx.now, -3500)), 'system'),
  };
  w.set(w.doc(`${COLLECTIONS.fraudCases}/fraude-livreur-010`), fraudDriver);
  const blocklist: BlocklistEntry = { type: 'card_fingerprint', valueHash: 'seed-hash-1', valuePreview: 'Visa ···· 9921', reason: 'Dossier fraude fraude-client-017', fraudCaseId: 'fraude-client-017', expiresAt: null, active: true, ...tracked(nowTs, account('support').uid) };
  w.set(w.doc(`${COLLECTIONS.blocklist}/blocage-1`), blocklist);
  const gdpr: Array<GdprRequest & { id: string }> = [
    { id: 'rgpd-1', type: 'erasure', subjectType: 'client', subjectId: 'seed-client-044', email: 'c***@exemple.test', status: 'identity_check', receivedAt: ts(minutesAfter(ctx.now, -4320)), dueAt: ts(minutesAfter(ctx.now, 40000)), completedAt: null, assigneeId: account('support').uid, export: null, retainedData: ['Factures (10 ans)'], notes: null, ...tracked(ts(minutesAfter(ctx.now, -4320)), 'system') },
    { id: 'rgpd-2', type: 'access', subjectType: 'client', subjectId: 'seed-client-081', email: 'y***@exemple.test', status: 'completed', receivedAt: ts(minutesAfter(ctx.now, -30000)), dueAt: ts(minutesAfter(ctx.now, 13000)), completedAt: ts(minutesAfter(ctx.now, -25000)), assigneeId: account('support').uid, export: null, retainedData: [], notes: 'Export envoyé par e-mail sécurisé.', ...tracked(ts(minutesAfter(ctx.now, -30000)), 'system') },
  ];
  for (const { id, ...g } of gdpr) w.set(w.doc(`${COLLECTIONS.gdprRequests}/${id}`), g);

  // ------------------------------------------------------------ Corbeille et sauvegardes
  const trash: TrashItem = {
    entity: { type: 'other', id: 'p99', label: 'Salade de saison (ancienne carte)' },
    path: 'restaurants/mina-kitchen/products/p99',
    snapshot: { name: 'Salade de saison', priceCents: 950, available: false },
    children: [],
    restaurantId: 'mina-kitchen',
    deletedBy: account('manager').uid,
    deletedAt: ts(minutesAfter(ctx.now, -5000)),
    reason: 'Plat retiré de la carte d’été',
    purgeAt: ts(minutesAfter(ctx.now, 38000)),
    restoredAt: null,
    restoredBy: null,
  };
  w.set(w.doc(`${COLLECTIONS.trash}/corbeille-1`), trash);
  for (let i = 0; i < 3; i += 1) {
    const at = parisTime(addDays(ctx.today, -i), 3 * 60);
    const backup: Backup = {
      kind: 'scheduled', status: 'completed', bucketPath: `gs://golink-9f16d-sauvegardes/${addDays(ctx.today, -i)}`, collections: null,
      sizeBytes: rng.int(40, 60) * 1_000_000, startedAt: ts(at), finishedAt: ts(minutesAfter(at, 6)), error: null, requestedBy: 'system',
    };
    w.set(w.doc(`${COLLECTIONS.backups}/sauvegarde-${addDays(ctx.today, -i)}`), backup);
  }
}
