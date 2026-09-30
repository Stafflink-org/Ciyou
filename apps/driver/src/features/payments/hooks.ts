// Compte de paiement du livreur (§15 « Livreurs »/annexe Q&R n°1) : consomme
// réellement les fonctions déjà écrites côté serveur
// (`functions/src/payments/driver-connect.ts` pour Stripe Connect,
// `functions/src/finance/argent/providers.ts::setDriverPayoutAccount` pour un
// compte local dans un pays sans Stripe, `countries/{id}.stripeAvailable`).
import { useCallback, useState } from 'react';
import type { Country, Driver, DriverPrivate } from '@golink/shared';
import { callFunction, docAt, useDoc } from '../../lib/firestore';

export function useDriverPayoutStatus(uid: string | null) {
  return useDoc<DriverPrivate>(uid ? docAt(`driverPrivate/${uid}`) : null);
}

/** Pays du livreur (pour savoir si Stripe y est disponible). */
export function useCountry(countryId: string | null | undefined) {
  return useDoc<Country>(countryId ? docAt(`countries/${countryId}`) : null);
}

interface ConnectAccountResult {
  accountId: string;
  status: 'pending' | 'restricted' | 'enabled';
  created: boolean;
}
interface ConnectAccountLinkResult {
  url: string;
  expiresAt: number;
}
interface ConnectStatusResult {
  status: 'pending' | 'restricted' | 'enabled' | null;
}

const createDriverConnectAccountFn = callFunction<Record<string, never>, ConnectAccountResult>('createDriverConnectAccount');
const createDriverConnectAccountLinkFn = callFunction<Record<string, never>, ConnectAccountLinkResult>('createDriverConnectAccountLink');
const refreshDriverConnectAccountStatusFn = callFunction<Record<string, never>, ConnectStatusResult>('refreshDriverConnectAccountStatus');

/**
 * Ouverture réelle du compte de paiement Stripe Connect (créé au besoin), lien
 * d'onboarding hébergé par Stripe (ouvert dans le navigateur), et relecture de
 * l'état du compte au retour (bouton « Actualiser »).
 */
export function useDriverStripeConnect() {
  const [pending, setPending] = useState<'link' | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openOnboarding = useCallback(async (): Promise<string | null> => {
    setError(null);
    setPending('link');
    try {
      await createDriverConnectAccountFn({});
      const link = await createDriverConnectAccountLinkFn({});
      return link.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’ouvrir le compte de paiement.');
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  const refresh = useCallback(async (): Promise<ConnectStatusResult['status'] | null> => {
    setError(null);
    setPending('refresh');
    try {
      const result = await refreshDriverConnectAccountStatusFn({});
      return result.status;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de vérifier l’état du compte.');
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  return { openOnboarding, refresh, pending, error };
}

interface LocalAccountInput {
  provider: 'bank_transfer' | 'mobile_wallet';
  holderName: string;
  accountNumber: string;
}
interface LocalAccountResult {
  accountMasked: string;
  verified: boolean;
}

const setDriverPayoutAccountFn = callFunction<{ account: LocalAccountInput }, LocalAccountResult>('setDriverPayoutAccount');

/** Compte de paiement local (virement manuel / portefeuille mobile), pays sans Stripe. */
export function useSetDriverLocalPayoutAccount() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (input: LocalAccountInput): Promise<boolean> => {
    setError(null);
    setPending(true);
    try {
      await setDriverPayoutAccountFn({ account: input });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer ce compte de paiement.');
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { submit, pending, error };
}

export type { Driver };
