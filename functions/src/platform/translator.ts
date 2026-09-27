// Traduction automatique (Azure Translator), pilotée depuis le super admin (cahier
// « translation-azure », même ergonomie que StaffLink : clé + région + endpoint saisis
// une fois, jamais relus par le navigateur, testés avant activation, mis en cache pour
// ne jamais payer deux fois la même traduction, avec un plafond mensuel de caractères.
//
// Sécurité : la clé d'abonnement est chiffrée avec le même mécanisme que le secret TOTP
// (AES-256-GCM, clé de chiffrement dans Secret Manager) et stockée dans translatorSecrets/config,
// une collection interdite en lecture/écriture aux clients (règles Firestore) : seules les
// Cloud Functions de ce fichier la lisent. Le document public settings/translator ne porte
// jamais la clé, seulement `configured` et les 4 derniers caractères masqués.
//
// Comportement si la traduction n'est pas configurée ou indisponible : translateTexts lève
// une erreur métier claire ; l'appelant (back-office restaurant, super admin, script
// npm run i18n:translate) doit toujours retomber sur le texte d'origine — jamais d'écran cassé.
import { createHash } from 'node:crypto';
import { APP_LOCALES, COLLECTIONS, SETTINGS_DOCS, type Locale, type TranslatorSecret, type TranslatorSettings } from '@golink/shared';
import { db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { getCaller } from '../lib/permissions';
import { z, zReason } from '../lib/validation';
import { decryptSecret, encryptSecret } from './totp';
import { PLATFORM_RUNTIME, TOTP_ENCRYPTION_KEY, plainValue, platformCallable, recordSettingsChange, requireSecureAdmin } from './runtime';

const FETCH_TIMEOUT_MS = 5000;
const DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com';
const MAX_TEXTS_PER_CALL = 50;
const MAX_TEXT_LENGTH = 2000;
/** Débit maximal par utilisateur, pour éviter qu'un éditeur emballé ne consomme tout le plafond mensuel. */
const RATE_LIMIT_PER_MINUTE = 40;
/** Clé de chiffrement — même secret que le TOTP (cahier : « même mécanisme que le secret TOTP »). */
const SECRET_OPTIONS = { secrets: [TOTP_ENCRYPTION_KEY] };

function translatorSettingsRef() {
  return db.collection(COLLECTIONS.settings).doc(SETTINGS_DOCS.translator);
}
function translatorSecretRef() {
  return db.collection(COLLECTIONS.translatorSecrets).doc('config');
}
function cacheRef(hash: string) {
  return db.collection(COLLECTIONS.translations).doc(hash);
}
function usageRef(uid: string) {
  return db.collection(COLLECTIONS.translations).doc('_rate_limits').collection('byUser').doc(uid);
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hashOf(from: string, to: string, text: string): string {
  return createHash('sha256').update(`${from}:${to}:${text}`).digest('hex');
}

function maskKey(apiKey: string): string {
  const clean = apiKey.trim();
  return clean.length <= 4 ? clean : clean.slice(-4);
}

/** Appel brut à l'API Azure Translator v3. `null` = échec (réseau, HTTP, format inattendu). */
async function callAzure(config: { apiKey: string; region: string; endpoint: string }, texts: string[], from: string, to: string): Promise<(string | null)[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${config.endpoint.replace(/\/+$/, '')}/translate?api-version=3.0&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.apiKey,
        'Ocp-Apim-Subscription-Region': config.region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(texts.map((text) => ({ text }))),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ translations?: Array<{ text?: string }> }>;
    return data.map((entry) => entry.translations?.[0]?.text ?? null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSettings(): Promise<TranslatorSettings | null> {
  const snap = await translatorSettingsRef().get();
  return snap.exists ? (snap.data() as TranslatorSettings) : null;
}

async function loadDecryptedKey(): Promise<string | null> {
  const snap = await translatorSecretRef().get();
  if (!snap.exists) return null;
  const secret = snap.data() as TranslatorSecret;
  try {
    return decryptSecret(secret.keyEnc, TOTP_ENCRYPTION_KEY.value());
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Super admin : réglages

const APP_LOCALE_TUPLE = APP_LOCALES as unknown as [Locale, ...Locale[]];

const saveSchema = z.object({
  /** Chaîne vide = clé conservée inchangée (comme les autres formulaires de secrets du réseau). */
  apiKey: z.string().trim().max(200).default(''),
  region: z.string().trim().min(2).max(40),
  endpoint: z.string().trim().url().max(200).default(DEFAULT_ENDPOINT),
  enabled: z.boolean(),
  activeLocales: z.array(z.enum(APP_LOCALE_TUPLE)).min(1).max(APP_LOCALES.length),
  /** 0 = illimité. */
  monthlyCharacterCap: z.number().int().min(0).max(100_000_000),
  reason: zReason,
});

/** Enregistre la connexion Azure Translator. La clé n'est jamais renvoyée ni journalisée en clair. */
export const saveTranslatorSettings = platformCallable(saveSchema, async (input, request) => {
  const { caller } = await requireSecureAdmin(request, 'settings.edit');
  const ref = translatorSettingsRef();
  const [settingsSnap, secretSnap] = await Promise.all([ref.get(), translatorSecretRef().get()]);
  const before = (settingsSnap.data() ?? null) as (TranslatorSettings & Record<string, unknown>) | null;
  const hadKey = secretSnap.exists;
  if (input.enabled && !input.apiKey && !hadKey) {
    throw fail.invalid('Renseignez la clé d’abonnement Azure Translator pour activer la traduction automatique.');
  }
  const now = Timestamp.now();
  let keyLast4: string | null = before?.keyLast4 ?? null;
  if (input.apiKey) {
    await translatorSecretRef().set({ keyEnc: encryptSecret(input.apiKey, TOTP_ENCRYPTION_KEY.value()), updatedAt: now, updatedBy: caller.uid });
    keyLast4 = maskKey(input.apiKey);
  }
  const configured = Boolean(input.apiKey) || hadKey;

  const after: Omit<TranslatorSettings, 'updatedAt' | 'updatedBy'> = {
    enabled: input.enabled,
    configured,
    keyLast4,
    region: input.region,
    endpoint: input.endpoint || DEFAULT_ENDPOINT,
    activeLocales: input.activeLocales,
    monthlyCharacterCap: input.monthlyCharacterCap,
    charactersThisMonth: before?.charactersThisMonth ?? 0,
    currentMonthKey: before?.currentMonthKey ?? currentMonthKey(),
    status: input.enabled && configured ? 'configured' : 'not_configured',
    lastError: before?.lastError ?? null,
    lastTestAt: before?.lastTestAt ?? null,
    lastTestOk: before?.lastTestOk ?? null,
  };
  await ref.set({ ...after, updatedAt: now, updatedBy: caller.uid }, { merge: true });

  // Historique : jamais la clé elle-même (absente de `after`/`before` par construction).
  const { fields } = await recordSettingsChange({ docPath: `${COLLECTIONS.settings}/${SETTINGS_DOCS.translator}`, before, after: plainValue(after) as Record<string, unknown>, reason: input.reason, caller });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'translator_settings.updated',
    target: { type: 'setting', id: SETTINGS_DOCS.translator, label: 'Traduction automatique' },
    reason: input.reason,
    before: { enabled: before?.enabled ?? null, region: before?.region ?? null, keyChanged: false },
    after: { enabled: input.enabled, region: input.region, keyChanged: Boolean(input.apiKey) },
    sensitive: true,
    request,
  });
  return { configured, keyLast4, changedFields: fields };
}, SECRET_OPTIONS);

const testSchema = z.object({
  /** Absent(s) : teste la clé déjà enregistrée. Fournis : teste une clé candidate avant enregistrement (jamais stockée). */
  apiKey: z.string().trim().max(200).nullish(),
  region: z.string().trim().max(40).nullish(),
  endpoint: z.string().trim().url().max(200).nullish(),
});

/** Traduit une phrase d'exemple (fr → en) pour vérifier la clé, sans jamais la stocker si elle est candidate. */
export const testTranslatorConnection = platformCallable(testSchema, async (input, request) => {
  await requireSecureAdmin(request, 'settings.edit');
  const usingCandidate = Boolean(input.apiKey);
  let config: { apiKey: string; region: string; endpoint: string } | null = null;
  if (usingCandidate) {
    if (!input.apiKey || !input.region) throw fail.invalid('Clé d’abonnement et région requises.');
    config = { apiKey: input.apiKey, region: input.region, endpoint: input.endpoint || DEFAULT_ENDPOINT };
  } else {
    const settings = await loadSettings();
    const key = await loadDecryptedKey();
    if (!settings || !key) throw fail.precondition('Aucune clé Azure Translator enregistrée.');
    config = { apiKey: key, region: settings.region, endpoint: settings.endpoint || DEFAULT_ENDPOINT };
  }
  const result = await callAzure(config, ['Bonjour'], 'fr', 'en');
  const translated = result?.[0] ?? null;
  const ok = translated !== null;
  const error = ok ? null : 'Connexion refusée — vérifiez la clé d’abonnement, la région et l’adresse (endpoint).';
  if (!usingCandidate) {
    await translatorSettingsRef().set(
      { status: ok ? 'configured' : 'error', lastError: error, lastTestAt: Timestamp.now(), lastTestOk: ok },
      { merge: true },
    );
  }
  return { ok, translated, error };
}, { ...PLATFORM_RUNTIME, ...SECRET_OPTIONS, timeoutSeconds: 15 });

// ------------------------------------------------------------------ Utilisation (restaurants, super admin, script i18n)

const translateSchema = z.object({
  texts: z.array(z.string().max(MAX_TEXT_LENGTH)).min(1).max(MAX_TEXTS_PER_CALL),
  from: z.string().trim().min(2).max(5).default('fr'),
  to: z.array(z.string().trim().min(2).max(5)).min(1).max(APP_LOCALES.length),
});

async function checkRateLimit(uid: string): Promise<void> {
  const ref = usageRef(uid);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart?: number; count?: number } | undefined;
    const fresh = !data || now - (data.windowStart ?? 0) > 60_000;
    const count = fresh ? 1 : (data?.count ?? 0) + 1;
    if (!fresh && count > RATE_LIMIT_PER_MINUTE) {
      throw fail.precondition('Trop de traductions demandées en une minute : réessayez dans un instant.');
    }
    tx.set(ref, { windowStart: fresh ? now : (data?.windowStart ?? now), count }, { merge: false });
  });
}

/**
 * Traduit une liste de textes vers une ou plusieurs langues, avec cache Firestore
 * (`translations`, clé = hash(texte+source+cible)) et plafond mensuel de caractères.
 * Lève une erreur métier claire si la traduction n'est pas configurée, désactivée, en
 * échec ou au-delà du plafond — l'appelant doit toujours conserver le texte d'origine.
 */
export const translateTexts = platformCallable(translateSchema, async (input, request) => {
  const caller = getCaller(request);
  if (!caller) throw fail.unauthenticated();
  await checkRateLimit(caller.uid);

  const settings = await loadSettings();
  if (!settings || !settings.enabled || !settings.configured) {
    throw fail.precondition('La traduction automatique n’est pas configurée par l’équipe GoLink.');
  }
  const targets = input.to.filter((t) => t !== input.from);
  const unsupported = targets.filter((t) => !settings.activeLocales.includes(t as Locale));
  if (unsupported.length) throw fail.invalid(`Langue non activée pour la traduction automatique : ${unsupported.join(', ')}.`);

  // 1) Cache : on ne rappelle Azure que pour les paires (texte, langue) absentes.
  const results: Record<string, string[]> = {};
  for (const to of targets) results[to] = new Array(input.texts.length).fill(null) as unknown as string[];
  const missing: Array<{ to: string; index: number; text: string; hash: string }> = [];
  for (const to of targets) {
    const hashes = input.texts.map((text) => hashOf(input.from, to, text));
    const snaps = await db.getAll(...hashes.map((h) => cacheRef(h)));
    snaps.forEach((snap, index) => {
      if (snap.exists) {
        results[to]![index] = snap.get('translated') as string;
      } else {
        missing.push({ to, index, text: input.texts[index]!, hash: hashes[index]! });
      }
    });
  }
  if (missing.length === 0) return { texts: input.texts, translations: results };

  // 2) Plafond mensuel : estimé sur les caractères sources qui restent à traduire.
  const monthKey = currentMonthKey();
  const charactersThisMonth = settings.currentMonthKey === monthKey ? settings.charactersThisMonth : 0;
  const neededChars = missing.reduce((sum, m) => sum + m.text.length, 0);
  if (settings.monthlyCharacterCap > 0 && charactersThisMonth + neededChars > settings.monthlyCharacterCap) {
    throw fail.precondition('Le plafond mensuel de caractères traduits est atteint : réglable dans Plateforme > Traduction.');
  }

  const key = await loadDecryptedKey();
  if (!key) throw fail.precondition('La traduction automatique n’est pas configurée par l’équipe GoLink.');
  const config = { apiKey: key, region: settings.region, endpoint: settings.endpoint || DEFAULT_ENDPOINT };

  // 3) Un appel Azure par langue cible (les textes manquants ne sont pas les mêmes selon la langue).
  const byTarget = new Map<string, typeof missing>();
  for (const item of missing) byTarget.set(item.to, [...(byTarget.get(item.to) ?? []), item]);

  let translatedChars = 0;
  const errors: string[] = [];
  for (const [to, items] of byTarget) {
    const translated = await callAzure(config, items.map((i) => i.text), input.from, to);
    if (!translated) {
      errors.push(to);
      continue;
    }
    const batch = db.batch();
    items.forEach((item, i) => {
      const value = translated[i] ?? item.text;
      results[to]![item.index] = value;
      if (translated[i] !== null && translated[i] !== undefined) {
        translatedChars += item.text.length;
        batch.set(cacheRef(item.hash), { sourceText: item.text, from: input.from, to, translated: value, createdAt: FieldValue.serverTimestamp() });
      }
    });
    await batch.commit().catch(() => undefined); // best-effort : un doublon concurrent ne doit pas faire échouer la traduction
  }

  await translatorSettingsRef().set(
    {
      currentMonthKey: monthKey,
      charactersThisMonth: charactersThisMonth + translatedChars,
      status: errors.length === byTarget.size ? 'error' : 'configured',
      lastError: errors.length ? `Échec Azure Translator pour : ${errors.join(', ')}` : null,
    },
    { merge: true },
  );

  if (errors.length === byTarget.size) {
    throw fail.unavailable('Le service de traduction est momentanément indisponible.');
  }
  return { texts: input.texts, translations: results };
}, { ...PLATFORM_RUNTIME, ...SECRET_OPTIONS, timeoutSeconds: 30 });
