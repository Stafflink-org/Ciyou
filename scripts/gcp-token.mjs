/**
 * Access token Google Cloud à partir de la session Firebase CLI locale
 * (compte propriétaire du projet). Aucun gcloud ni clé de service requis.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROJECT_ID = 'golink-9f16d';
export const CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
export const CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

/** Refresh token de la session Firebase CLI (`firebase login`). */
export function readCliRefreshToken() {
  const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
  if (!cfg.tokens?.refresh_token) throw new Error('Session Firebase CLI absente : lancer `firebase login`.');
  return cfg.tokens.refresh_token;
}

/** Échange le refresh token contre un access token (durée de vie en secondes incluse). */
export async function fetchAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: readCliRefreshToken(),
      client_id: CLI_CLIENT_ID,
      client_secret: CLI_CLIENT_SECRET,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(json));
  return { access_token: json.access_token, expires_in: json.expires_in };
}

export async function getAccessToken() {
  return (await fetchAccessToken()).access_token;
}

export async function gcp(url, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT_ID },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
