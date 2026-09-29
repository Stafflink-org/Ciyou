// Données personnelles (RGPD, §29 cahier super admin) côté livreur : dépôt d'une
// demande d'exercice de droits (accès/portabilité/rectification/effacement/opposition)
// et téléchargement de l'export, une fois traité. Réutilise les Cloud Functions déjà
// prêtes côté serveur (functions/src/platform/gdpr.ts : submitGdprRequest,
// getGdprExportLink), jusqu'ici consommées uniquement côté apps/client et
// apps/restaurant (features/documents/GdprSection.tsx) — jamais côté livreur.
// `submitGdprRequest` sans `restaurantId` et un appelant `role === 'driver'` classe déjà
// la demande en `subjectType: 'driver'` côté serveur : aucune Cloud Function à ajouter.
import { orderBy, query, where } from 'firebase/firestore';
import type { GdprRequest, WithId } from '@golink/shared';
import { callFunction, collectionAt, useCollection } from '../../lib/firestore';

/**
 * Demandes RGPD déjà déposées par ce livreur (les plus récentes en premier).
 * Même forme de requête que apps/restaurant/src/features/documents/hooks.ts::useGdprRequests
 * (subjectType + subjectId + orderBy(receivedAt)) : c'est l'index composite déjà déployé
 * (firebase/firestore.indexes.json) — un filtre sur `subjectId` seul n'en a pas.
 */
export function useMyGdprRequests(uid: string | null): { data: WithId<GdprRequest>[]; loading: boolean } {
  const target = uid ? query(collectionAt('gdprRequests'), where('subjectType', '==', 'driver'), where('subjectId', '==', uid), orderBy('receivedAt', 'desc')) : null;
  return useCollection<GdprRequest>(target);
}

export const submitGdprRequest = callFunction<
  { type: GdprRequest['type']; restaurantId: null; notes: string | null },
  { requestId: string; dueAt: number }
>('submitGdprRequest');

export const getGdprExportLink = callFunction<{ requestId: string }, { url: string; name: string; expiresInMinutes: number }>('getGdprExportLink');
