// Cartographie (Google Maps), pilotée depuis le super admin (tâche « maps-settings »,
// même ergonomie que la traduction automatique Azure : clé saisie une fois, jamais
// relue par le navigateur, testée avant activation, historisée avec motif).
//
// Deux clés, comme recommandé par Google :
// - clé « web » : chargée par les apps web (admin, restaurant, bientôt client web). Elle
//   EST malgré tout distribuée au navigateur par `getPublicRuntimeConfig` — c'est une clé
//   publique par nature (visible dans le code source d'une page web), protégée côté
//   Google Cloud par une restriction de référents HTTP, pas par le secret ;
// - clé « mobile » : réservée aux futures apps Android/iOS (restriction par empreinte de
//   signature / bundle ID), jamais renvoyée à un client web.
//
// Stockage : mapsSecrets/config (clés chiffrées, AES-256-GCM comme le secret TOTP),
// collection interdite en lecture/écriture aux clients (règles Firestore). Le document
// public settings/maps ne porte jamais les clés, seulement l'état et les 4 derniers
// caractères masqués.
import { COLLECTIONS, SETTINGS_DOCS, type MapsSecret, type MapsSettings, type PublicRuntimeConfig } from '@golink/shared';
import { db, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { z, zReason } from '../lib/validation';
import { ipHashOf } from './runtime';
import { decryptSecret, encryptSecret } from './totp';
import { PLATFORM_RUNTIME, TOTP_ENCRYPTION_KEY, plainValue, platformCallable, recordSettingsChange, requireSecureAdmin } from './runtime';

const FETCH_TIMEOUT_MS = 5000;
/** Débit maximal pour l'endpoint public (par adresse IP hachée), pour éviter l'abus d'un endpoint sans authentification. */
const PUBLIC_RATE_LIMIT_PER_MINUTE = 60;
const SECRET_OPTIONS = { secrets: [TOTP_ENCRYPTION_KEY] };

function mapsSettingsRef() {
  return db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.maps);
}
function mapsSecretRef() {
  return db.collection(COLLECTIONS.mapsSecrets).doc('config');
}
function publicRateLimitRef(key: string) {
  return db.collection(COLLECTIONS.mapsSecrets).doc('_rate_limits').collection('byKey').doc(key);
}

function maskKey(apiKey: string): string {
  const clean = apiKey.trim();
  return clean.length <= 4 ? clean : clean.slice(-4);
}

async function loadSettings(): Promise<MapsSettings | null> {
  const snap = await mapsSettingsRef().get();
  return snap.exists ? (snap.data() as MapsSettings) : null;
}

async function loadSecret(): Promise<MapsSecret | null> {
  const snap = await mapsSecretRef().get();
  return snap.exists ? (snap.data() as MapsSecret) : null;
}

function decryptOrNull(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    return decryptSecret(enc, TOTP_ENCRYPTION_KEY.value());
  } catch {
    return null;
  }
}

/** Débit par clé (IP hachée), simple fenêtre glissante d'une minute, sans authentification requise. */
async function checkPublicRateLimit(key: string): Promise<void> {
  const ref = publicRateLimitRef(key);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart?: number; count?: number } | undefined;
    const fresh = !data || now - (data.windowStart ?? 0) > 60_000;
    const count = fresh ? 1 : (data?.count ?? 0) + 1;
    if (!fresh && count > PUBLIC_RATE_LIMIT_PER_MINUTE) {
      throw fail.precondition('Trop de requêtes : réessayez dans un instant.');
    }
    tx.set(ref, { windowStart: fresh ? now : (data?.windowStart ?? now), count }, { merge: false });
  });
}

/** Appel réel à l'API Geocoding Google (test de connexion). `null` = échec (réseau, HTTP, clé refusée). */
async function callGeocoding(apiKey: string): Promise<{ ok: boolean; httpStatus: number | null; googleStatus: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Paris, France')}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json().catch(() => null)) as { status?: string } | null;
    const status = data?.status ?? null;
    return { ok: res.ok && status === 'OK', httpStatus: res.status, googleStatus: status };
  } catch {
    return { ok: false, httpStatus: null, googleStatus: null };
  } finally {
    clearTimeout(timeout);
  }
}

function messageFromGoogleStatus(googleStatus: string | null): string {
  switch (googleStatus) {
    case 'REQUEST_DENIED':
      // Cas fréquent : une clé restreinte par référent HTTP refuse les appels serveur (sans en-tête Referer).
      // Si la clé est bien destinée au web avec restriction de référents, ce refus est attendu depuis un
      // serveur ; vérifiez alors la clé directement dans un navigateur autorisé, ou testez avec une clé
      // sans restriction de référent (API activée + quota) pour confirmer sa validité.
      return "Connexion refusée par Google (REQUEST_DENIED) — vérifiez que l'API Geocoding est activée pour cette clé et que ses restrictions (référents HTTP, API autorisées) permettent cet appel.";
    case 'OVER_QUERY_LIMIT':
      return 'Quota Google dépassé pour cette clé (OVER_QUERY_LIMIT) — vérifiez la facturation du projet Google Cloud.';
    case null:
      return 'Connexion impossible (réseau ou format de réponse inattendu).';
    default:
      return `Connexion refusée par Google (${googleStatus}).`;
  }
}

// ------------------------------------------------------------------ Super admin : réglages

const saveSchema = z.object({
  /** Chaîne vide = clé conservée inchangée. */
  webApiKey: z.string().trim().max(200).default(''),
  mobileApiKey: z.string().trim().max(200).default(''),
  allowedWebReferrers: z.array(z.string().trim().max(200)).max(50).default([]),
  allowedMobileIdentifiers: z.array(z.string().trim().max(200)).max(50).default([]),
  reason: zReason,
});

/** Enregistre les clés Google Maps. Les clés ne sont jamais renvoyées ni journalisées en clair. */
export const saveMapsSettings = platformCallable(saveSchema, async (input, request) => {
  const { caller } = await requireSecureAdmin(request, 'settings.edit');
  const ref = mapsSettingsRef();
  const [settingsSnap, secretSnap] = await Promise.all([ref.get(), mapsSecretRef().get()]);
  const before = (settingsSnap.data() ?? null) as (MapsSettings & Record<string, unknown>) | null;
  const existingSecret = (secretSnap.data() ?? null) as MapsSecret | null;

  const now = Timestamp.now();
  let webKeyEnc = existingSecret?.webKeyEnc ?? null;
  let mobileKeyEnc = existingSecret?.mobileKeyEnc ?? null;
  let webKeyLast4 = before?.webKeyLast4 ?? null;
  let mobileKeyLast4 = before?.mobileKeyLast4 ?? null;
  if (input.webApiKey) {
    webKeyEnc = encryptSecret(input.webApiKey, TOTP_ENCRYPTION_KEY.value());
    webKeyLast4 = maskKey(input.webApiKey);
  }
  if (input.mobileApiKey) {
    mobileKeyEnc = encryptSecret(input.mobileApiKey, TOTP_ENCRYPTION_KEY.value());
    mobileKeyLast4 = maskKey(input.mobileApiKey);
  }
  if (webKeyEnc !== existingSecret?.webKeyEnc || mobileKeyEnc !== existingSecret?.mobileKeyEnc) {
    const secret: MapsSecret = { webKeyEnc, mobileKeyEnc, updatedAt: now, updatedBy: caller.uid } as unknown as MapsSecret;
    await mapsSecretRef().set(secret, { merge: true });
  }

  const configuredWeb = Boolean(webKeyEnc);
  const configuredMobile = Boolean(mobileKeyEnc);
  const after: Omit<MapsSettings, 'updatedAt' | 'updatedBy'> = {
    configuredWeb,
    webKeyLast4,
    configuredMobile,
    mobileKeyLast4,
    allowedWebReferrers: input.allowedWebReferrers,
    allowedMobileIdentifiers: input.allowedMobileIdentifiers,
    status: configuredWeb ? (before?.status === 'error' ? 'error' : 'configured') : 'not_configured',
    lastError: before?.lastError ?? null,
    lastTestAt: before?.lastTestAt ?? null,
    lastTestOk: before?.lastTestOk ?? null,
  };
  await ref.set({ ...after, updatedAt: now, updatedBy: caller.uid }, { merge: true });

  const { fields } = await recordSettingsChange({ docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.maps}`, before, after: plainValue(after) as Record<string, unknown>, reason: input.reason, caller });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'maps_settings.updated',
    target: { type: 'setting', id: SETTINGS_DOCS.maps, label: 'Cartographie' },
    reason: input.reason,
    before: { configuredWeb: before?.configuredWeb ?? false, configuredMobile: before?.configuredMobile ?? false, keysChanged: false },
    after: { configuredWeb, configuredMobile, webKeyChanged: Boolean(input.webApiKey), mobileKeyChanged: Boolean(input.mobileApiKey) },
    sensitive: true,
    request,
  });
  return { configuredWeb, webKeyLast4, configuredMobile, mobileKeyLast4, changedFields: fields };
}, SECRET_OPTIONS);

const testSchema = z.object({
  /** 'web' (défaut) ou 'mobile' : quelle clé tester. */
  which: z.enum(['web', 'mobile']).default('web'),
  /** Absente : teste la clé déjà enregistrée. Fournie : teste une clé candidate avant enregistrement (jamais stockée). */
  apiKey: z.string().trim().max(200).nullish(),
});

/** Teste une clé Google Maps par un appel réel à l'API Geocoding. Ne stocke jamais une clé candidate. */
export const testMapsConnection = platformCallable(testSchema, async (input, request) => {
  await requireSecureAdmin(request, 'settings.edit');
  let apiKey: string | null = input.apiKey ?? null;
  if (!apiKey) {
    const secret = await loadSecret();
    apiKey = decryptOrNull(input.which === 'mobile' ? secret?.mobileKeyEnc : secret?.webKeyEnc);
  }
  if (!apiKey) throw fail.precondition(`Aucune clé ${input.which === 'mobile' ? 'mobile' : 'web'} enregistrée à tester.`);

  const result = await callGeocoding(apiKey);
  const error = result.ok ? null : messageFromGoogleStatus(result.googleStatus);
  if (!input.apiKey) {
    // REQUEST_DENIED depuis un appel serveur est ambigu pour une clé restreinte par référent
    // HTTP (web) ou par identité d'app (mobile) : ce refus est ATTENDU pour une clé qui
    // fonctionne très bien depuis un navigateur/app autorisé, faute d'en-tête Referer ou de
    // contexte d'app côté serveur. On ne fait donc jamais régresser le statut affiché
    // (« Configurée » → « Erreur ») sur ce seul signal, pour ne pas alarmer inutilement —
    // seuls des refus non ambigus (réseau, quota, requête invalide) le font.
    const ambiguous = result.googleStatus === 'REQUEST_DENIED';
    const patch: Record<string, unknown> = { lastError: error, lastTestAt: Timestamp.now(), lastTestOk: result.ok };
    if (result.ok || !ambiguous) patch.status = result.ok ? 'configured' : 'error';
    await mapsSettingsRef().set(patch, { merge: true });
  }
  return { ok: result.ok, error };
}, { ...PLATFORM_RUNTIME, ...SECRET_OPTIONS, timeoutSeconds: 15 });

// ------------------------------------------------------------------ Distribution publique (web + futures apps mobiles)

/**
 * Renvoie les identifiants publics nécessaires au démarrage d'un client (voir
 * docs/CONTRATS_APPS_MOBILES.md : « Cartographie et distribution de clé »). Public
 * (aucune connexion requise — un client web ouvre la carte avant toute action), mais
 * limité en débit par adresse IP. Ne renvoie JAMAIS la clé mobile ni aucun secret.
 */
export const getPublicRuntimeConfig = platformCallable(z.object({}), async (_input, request) => {
  const ipKey = ipHashOf(request) ?? 'unknown';
  await checkPublicRateLimit(ipKey);

  const [settings, secret] = await Promise.all([loadSettings(), loadSecret()]);
  const googleMapsWebKey = settings?.configuredWeb ? decryptOrNull(secret?.webKeyEnc) : null;
  const config: PublicRuntimeConfig = {
    googleMapsWebKey,
    mapsConfigured: Boolean(googleMapsWebKey),
  };
  return config;
}, { ...PLATFORM_RUNTIME, ...SECRET_OPTIONS, timeoutSeconds: 10 });
