// Composants intégrés Stripe Connect (chargés à la demande) : vérification du
// compte de versement et relevés des virements Stripe.
import { useMemo, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import { ConnectAccountOnboarding, ConnectComponentsProvider, ConnectNotificationBanner, ConnectPayouts } from '@stripe/react-connect-js';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { useAppColorMode } from '@/app/color-mode';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/firestore';
import { createConnectAccountSession } from '../parametres/kit/api';
import { themeColor } from '../parametres/kit/map';
import { LoadError } from '../parametres/kit/ui';

const LOAD_ERROR = 'Le module de paiement n’a pas pu se charger. Réessayez dans un instant.';

export function StripeEmbedded({ mode, onExit }: { mode: 'onboarding' | 'payouts'; onExit: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { mode: colorMode } = useAppColorMode();
  const [error, setError] = useState<string | null>(null);

  const instance = useMemo(
    () =>
      loadConnectAndInitialize({
        publishableKey: env.stripePublishableKey,
        locale: 'fr-FR',
        fetchClientSecret: async () => {
          try {
            const session = await createConnectAccountSession({ restaurantId });
            return session.clientSecret;
          } catch (caught) {
            setError(errorMessage(caught, 'Connexion au module de paiement impossible.'));
            throw caught;
          }
        },
        appearance: {
          overlays: 'dialog',
          variables: {
            colorPrimary: themeColor('primary'),
            colorBackground: getComputedStyle(document.documentElement).getPropertyValue('--gl-surface').trim() || undefined,
            colorText: getComputedStyle(document.documentElement).getPropertyValue('--gl-fg').trim() || undefined,
            borderRadius: '10px',
            fontFamily: 'DM Sans, system-ui, sans-serif',
          },
        },
      }),
    // Une instance par établissement et par mode de couleur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurantId, colorMode],
  );

  if (error) return <LoadError message={error} />;

  return (
    <ConnectComponentsProvider connectInstance={instance}>
      <div className="space-y-4">
        <ConnectNotificationBanner />
        {mode === 'onboarding' ? (
          <ConnectAccountOnboarding onExit={onExit} onLoadError={() => setError(LOAD_ERROR)} />
        ) : (
          <ConnectPayouts onLoadError={() => setError(LOAD_ERROR)} />
        )}
      </div>
    </ConnectComponentsProvider>
  );
}
