// Légal, RGPD et conformité côté livreur (§29 cahier super admin) — réacceptation
// des CGU quand elles changent, et capture des consentements (cookies /
// marketing). Copie fidèle de apps/client/src/features/legal/hooks.ts (mêmes
// Cloud Functions déjà prêtes côté serveur, functions/src/platform/gdpr.ts :
// acceptLegalDocument, setConsent — jamais dupliquées), seul `documentType`
// change (`terms_driver` au lieu de `terms_client`). `users/{uid}` porte
// `acceptedLegal`/`consents` pour tous les rôles (vérifié dans
// functions/src/platform/gdpr.ts::acceptLegalDocument, qui écrit toujours
// dans la collection `users`, quel que soit le rôle de l'appelant).
import { limit, orderBy, query, where } from 'firebase/firestore';
import type { LegalDocument, UserProfile } from '@golink/shared';
import { callFunction, collectionAt, docAt, useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';

/** Profil Firestore complet du livreur connecté (acceptedLegal, consents). */
export function useMyProfile() {
  const { user } = useAuth();
  return useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);
}

/** Dernière version publiée des CGU livreur pour un pays. */
export function usePublishedTerms(countryId: string | null) {
  const q = countryId
    ? query(collectionAt('legalDocuments'), where('type', '==', 'terms_driver'), where('countryId', '==', countryId), where('status', '==', 'published'), orderBy('publishedAt', 'desc'), limit(1))
    : null;
  const state = useCollection<LegalDocument>(q);
  return { data: state.data[0] ?? null, loading: state.loading };
}

export const acceptLegalDocument = callFunction<{ documentType: 'terms_driver'; countryId: string }, { accepted: true; version: string }>('acceptLegalDocument');

export type ConsentKey = 'marketing_email' | 'marketing_push' | 'marketing_sms' | 'analytics_cookies' | 'personalization';

export const setConsent = callFunction<{ key: ConsentKey; granted: boolean }, { key: ConsentKey; granted: boolean }>('setConsent');
