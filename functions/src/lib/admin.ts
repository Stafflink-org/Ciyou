// Initialisation unique du SDK Admin (identité du compte de service des fonctions).
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const app = getApps()[0] ?? initializeApp();

export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth(app);
export const storage = getStorage(app);

export { FieldValue, Timestamp } from 'firebase-admin/firestore';
