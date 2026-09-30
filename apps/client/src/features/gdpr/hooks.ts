// Données personnelles (RGPD, §29 cahier super admin) côté client : dépôt d'une
// demande d'exercice de droits (accès/portabilité/rectification/effacement/opposition)
// et téléchargement de l'export, une fois traité. Réutilise les Cloud Functions déjà
// prêtes côté serveur (functions/src/platform/gdpr.ts : submitGdprRequest,
// getGdprExportLink), copie fidèle de apps/driver/src/features/gdpr/hooks.ts
// (mêmes Cloud Functions, jamais dupliquées) — seul `subjectType` change ('client',
// déduit automatiquement côté serveur pour un appelant sans rôle restaurant/driver).
import { orderBy, query, where } from 'firebase/firestore';
import type { GdprRequest, WithId } from '@golink/shared';
import { callFunction, collectionAt, useCollection } from '../../lib/firestore';

/**
 * Demandes RGPD déjà déposées par ce client (les plus récentes en premier).
 * Même forme de requête que apps/driver/src/features/gdpr/hooks.ts::useMyGdprRequests
 * (subjectType + subjectId + orderBy(receivedAt)) : index composite déjà déployé.
 */
export function useMyGdprRequests(uid: string | null): { data: WithId<GdprRequest>[]; loading: boolean } {
  const target = uid ? query(collectionAt('gdprRequests'), where('subjectType', '==', 'client'), where('subjectId', '==', uid), orderBy('receivedAt', 'desc')) : null;
  return useCollection<GdprRequest>(target);
}

export const submitGdprRequest = callFunction<
  { type: GdprRequest['type']; restaurantId: null; notes: string | null },
  { requestId: string; dueAt: number }
>('submitGdprRequest');

export const getGdprExportLink = callFunction<{ requestId: string }, { url: string; name: string; expiresInMinutes: number }>('getGdprExportLink');
