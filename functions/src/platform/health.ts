// Santé et maintenance (cahier §30) et connexions externes (§25) : sondes des
// services (base, authentification, stockage, Stripe, Brevo, cartographie), état des
// intégrations, mode maintenance par application, versions minimales, incidents.
// Les alertes « service en panne » sont levées par la surveillance du pilotage à
// partir de serviceStatus.
import {
  APPS,
  COLLECTIONS,
  SERVICE_KEYS,
  SETTINGS_DOCS,
  type AppKey,
  type Incident,
  type MaintenanceSettings,
  type ServiceHealth,
  type ServiceKey,
} from '@golink/shared';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { auth, db, FieldValue, storage, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { BREVO_API_KEY, STRIPE_SECRET_KEY } from '../lib/secrets';
import { getStripe, isStripeLiveMode } from '../lib/stripe';
import { z, zId, zReason } from '../lib/validation';
import { PLATFORM_SCHEDULE_RUNTIME, TIMEZONE, platformCallable, recordSettingsChange, requireSecureAdmin } from './runtime';

interface Probe {
  status: ServiceHealth;
  latencyMs: number | null;
  message: string | null;
}

async function timed(run: () => Promise<unknown>, slowMs: number): Promise<Probe> {
  const started = Date.now();
  try {
    await Promise.race([run(), new Promise((_, reject) => setTimeout(() => reject(new Error('Délai dépassé (10 s)')), 10_000))]);
    const latencyMs = Date.now() - started;
    return { status: latencyMs > slowMs ? 'degraded' : 'operational', latencyMs, message: latencyMs > slowMs ? `Réponse lente (${latencyMs} ms)` : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'major_outage', latencyMs: Date.now() - started, message: message.slice(0, 200) };
  }
}

async function probeBrevo(): Promise<Probe> {
  return timed(async () => {
    const response = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': BREVO_API_KEY.value(), accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`Brevo a répondu ${response.status}`);
  }, 2500);
}

async function probeMaps(): Promise<Probe> {
  return timed(async () => {
    const response = await fetch('https://maps.googleapis.com/maps/api/js', { method: 'HEAD', signal: AbortSignal.timeout(9000) });
    if (response.status >= 500) throw new Error(`Google Maps a répondu ${response.status}`);
  }, 2500);
}

/**
 * Sonde FCM réelle : envoi à blanc (dry run) vers un jeton factice. Un refus « jeton invalide »
 * prouve que le service de messagerie répond et que nos identifiants sont acceptés.
 */
async function probeFcm(): Promise<Probe> {
  return timed(async () => {
    try {
      await getMessaging().send({ token: 'golink-probe-invalid-token', notification: { title: 'sonde' } }, true);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code === 'messaging/invalid-argument' || code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') return;
      throw error;
    }
  }, 3000);
}

/** Connexions caisse en erreur : dégradé ; aucune connexion configurée : « non configuré ». */
async function probePos(): Promise<Probe> {
  const started = Date.now();
  const snap = await db.collection(COLLECTIONS.posConnections).limit(200).get();
  if (snap.empty) return { status: 'maintenance', latencyMs: Date.now() - started, message: 'Aucune connexion caisse configurée' };
  const failing = snap.docs.filter((d) => d.get('status') === 'error');
  if (failing.length === 0) return { status: 'operational', latencyMs: Date.now() - started, message: null };
  return { status: failing.length === snap.size ? 'major_outage' : 'degraded', latencyMs: Date.now() - started, message: `${failing.length} connexion(s) caisse en erreur sur ${snap.size}` };
}

/** Export comptable : disponible tant que les factures et le grand livre sont lisibles. */
async function probeAccounting(): Promise<Probe> {
  return timed(() => db.collection(COLLECTIONS.invoices).limit(1).get(), 2000);
}

/**
 * Géolocalisation : fraîcheur des dernières positions livreur reçues (pas un simple
 * proxy de la base). Sans livreur en ligne, la sonde n'est pas dégradée pour autant.
 */
async function probeGeolocation(): Promise<Probe> {
  const started = Date.now();
  try {
    const snap = await db.collection(COLLECTIONS.driverLocations).orderBy('updatedAt', 'desc').limit(1).get();
    const latencyMs = Date.now() - started;
    if (snap.empty) return { status: 'operational', latencyMs, message: 'Aucun livreur en ligne actuellement.' };
    const updatedAt = snap.docs[0]!.get('updatedAt') as FirebaseFirestore.Timestamp | undefined;
    const ageMs = updatedAt ? Date.now() - updatedAt.toMillis() : Infinity;
    if (ageMs > 15 * 60_000) return { status: 'degraded', latencyMs, message: `Dernière position reçue il y a ${Math.round(ageMs / 60_000)} min.` };
    return { status: 'operational', latencyMs, message: null };
  } catch (error) {
    return { status: 'major_outage', latencyMs: Date.now() - started, message: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

/** Exécute toutes les sondes et met à jour serviceStatus et integrations. */
export async function runHealthProbes(): Promise<Record<string, Probe>> {
  const maintenanceSnap = await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.maintenance).get();
  const maintenance = (maintenanceSnap.data() as MaintenanceSettings | undefined)?.apps;

  const [firestore, authentication, bucket, stripe, brevo, maps, fcm, pos, accounting, geolocation] = await Promise.all([
    timed(() => db.collection(COLLECTIONS.orders).limit(1).get(), 1500),
    timed(() => auth.listUsers(1), 2000),
    timed(async () => {
      const [exists] = await storage.bucket().exists();
      if (!exists) throw new Error('Bucket de stockage introuvable');
    }, 2000),
    timed(() => getStripe().balance.retrieve(), 3000),
    probeBrevo(),
    probeMaps(),
    probeFcm(),
    probePos(),
    probeAccounting(),
    probeGeolocation(),
  ]);
  const smsSnap = await db.collection(COLLECTIONS.integrations).doc('sms').get();
  const smsEnabled = smsSnap.exists && smsSnap.get('enabled') === true;

  const worst = (...probes: Probe[]): Probe =>
    probes.reduce((acc, p) => (rank(p.status) > rank(acc.status) ? p : acc), { status: 'operational', latencyMs: null, message: null } as Probe);
  const app = (key: AppKey, base: Probe): Probe => (maintenance?.[key]?.enabled ? { status: 'maintenance', latencyMs: base.latencyMs, message: 'Mode maintenance activé' } : base);
  const core = worst(firestore, authentication);

  const results: Record<ServiceKey, Probe> = {
    client_app: app('client', worst(core, bucket)),
    driver_app: app('driver', worst(core, maps)),
    restaurant_backoffice: app('restaurant', core),
    admin_backoffice: app('admin', core),
    orders: firestore,
    payments: stripe,
    notifications: worst(fcm, brevo),
    emails: brevo,
    sms: smsEnabled ? brevo : { status: 'maintenance', latencyMs: null, message: 'Canal SMS désactivé' },
    geolocation,
    maps,
  };

  const now = Timestamp.now();
  const batch = db.batch();
  for (const key of SERVICE_KEYS) {
    const probe = results[key];
    batch.set(db.collection(COLLECTIONS.serviceStatus).doc(key), { key, status: probe.status, latencyMs: probe.latencyMs, message: probe.message, errorRate: null, checkedAt: now }, { merge: true });
  }
  const integrations: Record<string, Probe> = { stripe, brevo, google_maps: maps, fcm, sms: results.sms, pos, accounting };
  const knownIntegrations = new Set((await db.collection(COLLECTIONS.integrations).select().get()).docs.map((d) => d.id));
  for (const [key, probe] of Object.entries(integrations)) {
    const ref = db.collection(COLLECTIONS.integrations).doc(key);
    const extra = key === 'stripe' ? { mode: isStripeLiveMode() ? 'live' : 'test' } : {};
    // Une connexion absente de la base (caisse, comptabilité) est créée au premier passage.
    const defaults = knownIntegrations.has(key) ? {} : key === 'pos' ? { key, name: 'Logiciels de caisse', category: 'pos', enabled: true, mode: 'live', publicConfig: {} } : key === 'accounting' ? { key, name: 'Export comptable', category: 'accounting', enabled: true, mode: 'live', publicConfig: { format: 'CSV journaux VT, AC, BQ' } } : {};
    batch.set(ref, { ...defaults, status: probe.status, lastCheckAt: now, lastError: probe.status === 'operational' ? null : probe.message, ...extra }, { merge: true });
  }
  await batch.commit();
  return { ...results, firestore, authentication, storage: bucket, stripe, brevo };
}

function rank(status: ServiceHealth): number {
  return { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 }[status];
}

const PROBE_SECRETS = { secrets: [STRIPE_SECRET_KEY, BREVO_API_KEY] };

/** Toutes les 10 minutes : état des services et des intégrations. */
export const healthCheck = onSchedule({ schedule: 'every 10 minutes', timeZone: TIMEZONE, ...PLATFORM_SCHEDULE_RUNTIME, ...PROBE_SECRETS }, async () => {
  const results = await runHealthProbes();
  const down = Object.entries(results).filter(([, p]) => p.status === 'major_outage' || p.status === 'partial_outage');
  if (down.length) logger.warn('Services en panne', { services: down.map(([k]) => k) });
});

/** Relance immédiate des sondes depuis le super admin. */
export const runHealthCheck = platformCallable(
  z.object({}).optional(),
  async (_data, request) => {
    await requireSecureAdmin(request, 'system.view');
    const results = await runHealthProbes();
    return Object.fromEntries(Object.entries(results).map(([k, p]) => [k, { status: p.status, latencyMs: p.latencyMs, message: p.message }]));
  },
  { ...PROBE_SECRETS, timeoutSeconds: 60 },
);

// ------------------------------------------------------------------ Intégrations

const SECRET_PATTERN = /(sk_(live|test)_|rk_(live|test)_|whsec_|xkeysib-|AIza[0-9A-Za-z_-]{20,}|-----BEGIN)/;

export const updateIntegration = platformCallable(
  z.object({
    key: zId,
    enabled: z.boolean(),
    mode: z.enum(['test', 'live']),
    publicConfig: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/), z.union([z.string().max(200), z.number(), z.boolean()])),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'integrations.edit');
    for (const value of Object.values(data.publicConfig)) {
      if (typeof value === 'string' && SECRET_PATTERN.test(value)) {
        throw fail.invalid('Ne saisissez jamais de clé secrète ici : les secrets se configurent dans l’environnement sécurisé des fonctions.');
      }
    }
    const ref = db.collection(COLLECTIONS.integrations).doc(data.key);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Connexion');
    const before = snap.data() as Record<string, unknown>;
    const next = { enabled: data.enabled, mode: data.mode, publicConfig: data.publicConfig };
    const change = await recordSettingsChange({ docPath: `${COLLECTIONS.integrations}/${data.key}`, before: { enabled: before.enabled, mode: before.mode, publicConfig: before.publicConfig }, after: next, reason: data.reason, caller });
    if (change.fields.length === 0) return { changedFields: [] };
    await ref.update({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'integration.updated',
      target: { type: 'setting', id: `${COLLECTIONS.integrations}/${data.key}`, label: String(before.name ?? data.key) },
      reason: data.reason,
      before: change.before,
      after: change.after,
      sensitive: change.fields.includes('mode'),
      request,
    });
    return { changedFields: change.fields };
  },
);

// ------------------------------------------------------------------ Maintenance et versions

export const setMaintenanceMode = platformCallable(
  z.object({
    app: z.enum(APPS),
    enabled: z.boolean(),
    message: z.string().trim().max(400).nullable(),
    /** Fin prévue (ms), null = jusqu'à désactivation. */
    until: z.number().int().nullable(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'system.manage');
    if (data.enabled && !data.message) throw fail.invalid('Rédigez le message affiché aux utilisateurs pendant la maintenance.');
    if (data.until !== null && data.until <= Date.now()) throw fail.invalid('La fin prévue doit être dans le futur.');
    const ref = db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.maintenance);
    const snap = await ref.get();
    const current = (snap.data() as MaintenanceSettings | undefined)?.apps?.[data.app] ?? { enabled: false, message: null, until: null };
    const next = { enabled: data.enabled, message: data.message ? { fr: data.message } : null, until: data.until ? Timestamp.fromMillis(data.until) : null };
    const change = await recordSettingsChange({ docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.maintenance}#${data.app}`, before: current as unknown as Record<string, unknown>, after: next, reason: data.reason, caller });
    await ref.set({ apps: { [data.app]: next }, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    const serviceKey: Record<AppKey, ServiceKey> = { client: 'client_app', driver: 'driver_app', restaurant: 'restaurant_backoffice', admin: 'admin_backoffice' };
    await db.collection(COLLECTIONS.serviceStatus).doc(serviceKey[data.app]).set(
      { key: serviceKey[data.app], status: data.enabled ? 'maintenance' : 'operational', message: data.enabled ? 'Mode maintenance activé' : null, checkedAt: Timestamp.now() },
      { merge: true },
    );
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.enabled ? 'maintenance.enabled' : 'maintenance.disabled',
      target: { type: 'setting', id: `${COLLECTIONS.settings}/${SETTINGS_DOCS.maintenance}`, label: `Maintenance · ${data.app}` },
      reason: data.reason,
      before: change.before,
      after: change.after,
      sensitive: true,
      request,
    });
    return { enabled: data.enabled };
  },
);

const zVersion = z.string().regex(/^\d+\.\d+\.\d+$/, 'Version au format 1.2.3');

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export const updateAppVersion = platformCallable(
  z.object({
    app: z.enum(APPS),
    latestVersion: zVersion,
    minimumVersion: zVersion,
    forceUpdate: z.boolean(),
    message: z.string().trim().max(300).nullable(),
    storeUrls: z.object({ ios: z.url().nullable(), android: z.url().nullable() }).nullable(),
    reason: zReason,
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'system.manage');
    if (compareVersions(data.minimumVersion, data.latestVersion) > 0) throw fail.invalid('La version minimale ne peut pas dépasser la dernière version.');
    const ref = db.collection(COLLECTIONS.appVersions).doc(data.app);
    const snap = await ref.get();
    const before = (snap.data() ?? null) as Record<string, unknown> | null;
    const next = { app: data.app, latestVersion: data.latestVersion, minimumVersion: data.minimumVersion, forceUpdate: data.forceUpdate, message: data.message ? { fr: data.message } : null, storeUrls: data.storeUrls };
    const change = await recordSettingsChange({ docPath: `${COLLECTIONS.appVersions}/${data.app}`, before, after: next, reason: data.reason, caller });
    if (change.fields.length === 0) return { changedFields: [] };
    await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid }, { merge: true });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'app_version.updated', target: { type: 'setting', id: `${COLLECTIONS.appVersions}/${data.app}`, label: `Versions · ${data.app}` }, reason: data.reason, before: change.before, after: change.after, request });
    return { changedFields: change.fields };
  },
);

// ------------------------------------------------------------------ Incidents

export const saveIncident = platformCallable(
  z.object({
    incidentId: zId.nullish(),
    title: z.string().trim().min(4).max(120),
    services: z.array(z.enum(SERVICE_KEYS)).min(1),
    severity: z.enum(['info', 'warning', 'critical']),
    status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
    /** Point d'étape ajouté au fil de l'incident. */
    update: z.string().trim().min(3).max(1000),
    publicMessage: z.string().trim().max(400).nullable(),
    postMortem: z.string().trim().max(5000).nullable(),
  }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'system.manage');
    const now = Timestamp.now();
    const entry = { at: now, status: data.status, message: data.update, by: caller.name };
    const ref = data.incidentId ? db.collection(COLLECTIONS.incidents).doc(data.incidentId) : db.collection(COLLECTIONS.incidents).doc();
    let previousServices: ServiceKey[] = [];
    if (data.incidentId) {
      const snap = await ref.get();
      if (!snap.exists) throw fail.notFound('Incident');
      const incident = snap.data() as Incident;
      previousServices = incident.services;
      await ref.update({
        title: data.title,
        services: data.services,
        severity: data.severity,
        status: data.status,
        updates: FieldValue.arrayUnion(entry),
        publicMessage: data.publicMessage ? { fr: data.publicMessage } : null,
        postMortem: data.postMortem,
        resolvedAt: data.status === 'resolved' ? (incident.resolvedAt ?? now) : null,
        updatedAt: now,
        updatedBy: caller.uid,
      });
    } else {
      await ref.set({
        title: data.title,
        services: data.services,
        severity: data.severity,
        status: data.status,
        startedAt: now,
        resolvedAt: data.status === 'resolved' ? now : null,
        updates: [entry],
        publicMessage: data.publicMessage ? { fr: data.publicMessage } : null,
        postMortem: data.postMortem,
        createdAt: now,
        createdBy: caller.uid,
        updatedAt: now,
        updatedBy: caller.uid,
      });
    }
    const batch = db.batch();
    for (const key of new Set([...previousServices, ...data.services])) {
      const concerned = data.services.includes(key) && data.status !== 'resolved';
      batch.set(db.collection(COLLECTIONS.serviceStatus).doc(key), { key, openIncidentId: concerned ? ref.id : null }, { merge: true });
    }
    await batch.commit();
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.incidentId ? (data.status === 'resolved' ? 'incident.resolved' : 'incident.updated') : 'incident.opened',
      target: { type: 'other', id: ref.id, label: data.title },
      after: { status: data.status, severity: data.severity, services: data.services },
      request,
    });
    return { incidentId: ref.id };
  },
);
