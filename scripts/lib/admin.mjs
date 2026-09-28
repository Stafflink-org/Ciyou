/**
 * SDK Admin Firebase pour les scripts locaux (seed, maintenance), sans clé de
 * service : l'identité est celle de la session Firebase CLI (compte propriétaire).
 *
 * - Auth : credential personnalisé qui échange le refresh token du CLI.
 * - Firestore et Storage : le SDK Admin n'accepte que les clés de service ou
 *   l'ADC ; on instancie donc les clients Google Cloud avec les mêmes
 *   identifiants utilisateur (type `authorized_user`), projet de quota Ciyou Eats.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import {
  CLI_CLIENT_ID,
  CLI_CLIENT_SECRET,
  PROJECT_ID,
  fetchAccessToken,
  readCliRefreshToken,
} from '../gcp-token.mjs';

export { PROJECT_ID };
export const STORAGE_BUCKET = `${PROJECT_ID}.firebasestorage.app`;

// Les appels REST du SDK Admin (Auth) portent le projet de quota.
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= PROJECT_ID;

/** Credential compatible SDK Admin : { getAccessToken() → { access_token, expires_in } }. */
const cliCredential = {
  async getAccessToken() {
    return fetchAccessToken();
  },
};

const userCredentials = {
  type: 'authorized_user',
  client_id: CLI_CLIENT_ID,
  client_secret: CLI_CLIENT_SECRET,
  refresh_token: readCliRefreshToken(),
  quota_project_id: PROJECT_ID,
};

export const app =
  getApps()[0] ??
  initializeApp({ credential: cliCredential, projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });

export const auth = getAuth(app);

export const db = new Firestore({
  projectId: PROJECT_ID,
  credentials: userCredentials,
  preferRest: true,
  ignoreUndefinedProperties: true,
});

export const storage = new Storage({ projectId: PROJECT_ID, credentials: userCredentials });
export const bucket = storage.bucket(STORAGE_BUCKET);
