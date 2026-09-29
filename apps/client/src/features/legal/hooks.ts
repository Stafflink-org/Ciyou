// Légal, RGPD et conformité côté client (§29 cahier super admin) — réacceptation
// des CGU quand elles changent, et capture des consentements (cookies /
// marketing). Utilise les Cloud Functions déjà prêtes côté serveur
// (`functions/src/platform/gdpr.ts` : acceptLegalDocument, setConsent),
// jusqu'ici jamais appelées par aucune app.
import { limit, orderBy, query, where } from 'firebase/firestore';
import type { LegalDocument, UserProfile } from '@golink/shared';
import { callFunction, collectionAt, docAt, useCollection, useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';

/** Profil Firestore complet du client connecté (acceptedLegal, consents). */
export function useMyProfile() {
  const { user } = useAuth();
  return useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);
}

/** Dernière version publiée des CGU client pour un pays. */
export function usePublishedTerms(countryId: string | null) {
  const q = countryId
    ? query(collectionAt('legalDocuments'), where('type', '==', 'terms_client'), where('countryId', '==', countryId), where('status', '==', 'published'), orderBy('publishedAt', 'desc'), limit(1))
    : null;
  const state = useCollection<LegalDocument>(q);
  return { data: state.data[0] ?? null, loading: state.loading };
}

export const acceptLegalDocument = callFunction<{ documentType: 'terms_client'; countryId: string }, { accepted: true; version: string }>('acceptLegalDocument');

export type ConsentKey = 'marketing_email' | 'marketing_push' | 'marketing_sms' | 'analytics_cookies' | 'personalization';

export const setConsent = callFunction<{ key: ConsentKey; granted: boolean }, { key: ConsentKey; granted: boolean }>('setConsent');
