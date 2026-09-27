/**
 * Double authentification des comptes de TEST (jamais du super administrateur) :
 * génération de codes TOTP (RFC 6238) et appels de fonctions avec session vérifiée.
 * Les secrets d'enrôlement sont consignés dans .test-mfa.local.json (ignoré par git : *.local.*).
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MFA_FILE = join(root, '.test-mfa.local.json');
export const API_KEY = 'AIzaSyAYQ_TzyCEK0_Iw5TnSiH8jbFbOFKZYNoM';
export const FN_BASE = 'https://europe-west1-golink-9f16d.cloudfunctions.net';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function readMfa() {
  return existsSync(MFA_FILE) ? JSON.parse(readFileSync(MFA_FILE, 'utf8')) : {};
}
export function writeMfa(data) {
  writeFileSync(MFA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
export function secretOf(email) {
  return readMfa()[email]?.secret ?? null;
}

function base32Decode(input) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function hotp(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

export const stepNow = (now = Date.now()) => Math.floor(now / 30_000);

/**
 * Prochain code acceptable : le plus ancien pas de la fenêtre serveur (précédent, courant, suivant)
 * strictement postérieur au dernier pas utilisé. Attend le pas suivant si la fenêtre est épuisée.
 */
export async function nextCode(secret, lastUsedStep) {
  for (;;) {
    const step = stepNow();
    const candidate = [step - 1, step, step + 1].find((s) => lastUsedStep === null || lastUsedStep === undefined || s > lastUsedStep);
    if (candidate !== undefined) return { code: hotp(secret, candidate), step: candidate };
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

export async function signIn(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Connexion ${email} refusée : ${body.error?.message}`);
  return body.idToken;
}

/** Appel d'une fonction appelable (protocole HTTP des callables) ; renvoie { ok, status, data | error }. */
export async function callFn(name, data, token) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data: data ?? {} }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body.result, error: body.error };
}

/**
 * Session administrateur vérifiée : ouvre la session (trackAdminSession) puis valide un code TOTP
 * si le compte est enrôlé. Renvoie le jeton prêt à l'emploi pour les fonctions d'administration.
 * `lastUsedStepOf(email)` : dernier pas connu côté serveur (lu par l'appelant via le SDK Admin).
 */
export async function adminSession(email, password, lastUsedStepOf = async () => null) {
  const token = await signIn(email, password);
  const tracked = await callFn('trackAdminSession', {}, token);
  if (!tracked.ok) throw new Error(`trackAdminSession ${email} : ${tracked.status} ${JSON.stringify(tracked.error)}`);
  if (tracked.data.mfaEnrolled && !tracked.data.mfaVerified) {
    const secret = secretOf(email);
    if (!secret) throw new Error(`${email} est enrôlé mais son secret n'est pas dans ${MFA_FILE}`);
    const { code } = await nextCode(secret, await lastUsedStepOf(email));
    const verified = await callFn('verifyTotp', { code, method: 'totp' }, token);
    if (!verified.ok) throw new Error(`verifyTotp ${email} : ${verified.status} ${JSON.stringify(verified.error)}`);
  }
  return { token, state: tracked.data };
}
