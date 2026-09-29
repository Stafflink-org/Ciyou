// Légal, RGPD et conformité côté restaurant (§29 cahier super admin) — réacceptation
// des CGU commerce quand elles changent, et capture des consentements (cookies /
// marketing). Réutilise les Cloud Functions déjà prêtes côté serveur
// (`functions/src/platform/gdpr.ts` : acceptLegalDocument, setConsent), jusqu'ici
// consommées uniquement côté app client mobile (apps/client/src/features/legal).
import { limit, orderBy, query, where } from 'firebase/firestore';
import type { ConsentKey, LegalDocument, UserProfile } from '@golink/shared';
import { useAuth } from '@golink/web';
import { callFunction, collectionAt, docAt, useCollection, useDoc } from '@/lib/firestore';

/** Profil Firestore commun (users/{uid}) du membre connecté (acceptedLegal, consents). */
export function useMyProfile() {
  const { user } = useAuth();
  return useDoc<UserProfile>(user ? docAt(`users/${user.uid}`) : null);
}

/** Dernière version publiée des CGU commerce (`terms_restaurant`) pour un pays. */
export function usePublishedTerms(countryId: string | null) {
  const q = countryId
    ? query(collectionAt('legalDocuments'), where('type', '==', 'terms_restaurant'), where('countryId', '==', countryId), where('status', '==', 'published'), orderBy('publishedAt', 'desc'), limit(1))
    : null;
  const state = useCollection<LegalDocument>(q);
  return { data: state.data[0] ?? null, loading: state.loading };
}

export const acceptLegalDocument = callFunction<{ documentType: 'terms_restaurant'; countryId: string }, { accepted: true; version: string }>('acceptLegalDocument');

export const setConsent = callFunction<{ key: ConsentKey; granted: boolean }, { key: ConsentKey; granted: boolean }>('setConsent');
