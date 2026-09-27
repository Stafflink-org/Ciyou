// Plateforme : réglages, marchés, zones, fonctionnalités, santé des services,
// sécurité des administrateurs, fraude, légal/RGPD, sauvegardes et corbeille.
// Les fonctions de ce module sont exportées ici et ré-exportées par src/index.ts.
export * from './admins';
export * from './audit-export';
export * from './backups';
export * from './features';
export * from './fraud';
export * from './gdpr';
export * from './health';
export * from './maps';
export * from './markets';
export { disconnectPosConnection, onOrderPushToPos, savePosConnection, testPosConnection } from './pos';
export * from './security';
export * from './settings';
export * from './translator';
