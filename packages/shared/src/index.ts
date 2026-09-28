// Code partagé entre les 4 applications et les Cloud Functions :
// rôles, statuts, noms de collections Firestore. Le schéma détaillé
// sera complété à partir des maquettes.

export const FIREBASE_PROJECT_ID = 'golink-9f16d';
export const FIREBASE_REGION = 'europe-west1';

export type UserRole = 'client' | 'driver' | 'restaurant' | 'admin';

export const COLLECTIONS = {
  users: 'users',
  restaurants: 'restaurants',
  drivers: 'drivers',
  orders: 'orders',
} as const;

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'delivering'
  | 'delivered'
  | 'cancelled';
