// Socle partagé entre les applications (restaurant, super admin, client, livreur)
// et les Cloud Functions : types des documents Firestore, constantes, permissions,
// moteur de tarification et utilitaires de formatage.

export const FIREBASE_PROJECT_ID = 'golink-9f16d';
export const FIREBASE_REGION = 'europe-west1';

export * from './constants';
export * from './models';
export * from './permissions';
export * from './pricing';
export * from './utils';
export * from './compliance';
