// Point d'entrée des Cloud Functions Ciyou Eats. Chaque domaine vit dans son dossier
// (src/<module>/index.ts) ; les options globales sont posées avant toute déclaration.
import './lib/runtime';

export * from './core';
export * from './restaurant';
export * from './orders';
export * from './menu';
export * from './finance';
export * from './marketing';
export * from './messaging';
export * from './hr';
export * from './admin';
export * from './platform';
export * from './payments';
export * from './notifications';
