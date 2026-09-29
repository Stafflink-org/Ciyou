// Porte légale (§29 cahier super admin) côté restaurant : bloque l'accès tant que la
// dernière version des CGU commerce n'est pas acceptée (`acceptedLegal.terms_restaurant`
// != version publiée), et propose la capture des consentements cookies/marketing sous
// forme de bandeau, une seule fois par compte (`consents.analytics_cookies` non renseigné).
// Adaptation web fidèle de apps/client/src/features/legal/LegalGate.tsx (React Native) :
// même logique, mêmes Cloud Functions (acceptLegalDocument, setConsent), jamais dupliquées.
import { useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { Button, toast } from '@golink/ui';
import { FullScreenLoader } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { acceptLegalDocument, setConsent, useMyProfile, usePublishedTerms } from './hooks';

/** Route guard (sous <AccessGate>, au-dessus de <Shell>) : bloque tant que les CGU commerce ne sont pas acceptées. */
export function LegalGate() {
  const { data: profile, loading: profileLoading } = useMyProfile();
  const { restaurant } = useRestaurantAccess();
  const countryId = restaurant.countryId;
  const { data: terms, loading: termsLoading } = usePublishedTerms(profileLoading ? null : countryId);

  if (profileLoading || termsLoading) return <FullScreenLoader label="Vérification des conditions d'utilisation" />;

  const acceptedVersion = profile?.acceptedLegal?.terms_restaurant;
  const mustReaccept = Boolean(terms) && acceptedVersion !== terms!.version;

  if (mustReaccept) {
    return <ReacceptanceScreen version={terms!.version} title={terms!.title.fr} content={terms!.content.fr} countryId={countryId} changeSummary={terms!.changeSummary ?? null} />;
  }

  return (
    <>
      <Outlet />
      {profile && profile.consents?.analytics_cookies === undefined ? <CookieConsentBanner /> : null}
    </>
  );
}

function ReacceptanceScreen({ version, title, content, countryId, changeSummary }: { version: string; title: string; content: string; countryId: string; changeSummary: string | null }) {
  const [pending, setPending] = useState(false);

  const accept = async () => {
    setPending(true);
    try {
      await acceptLegalDocument({ documentType: 'terms_restaurant', countryId });
    } catch (error) {
      toast.error(errorMessage(error, "L'acceptation n'a pas pu être enregistrée."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10">
      <div className="flex w-full max-w-xl flex-col rounded-xl border border-border bg-surface shadow-sm">
        <div className="p-6 pb-2">
          <h1 className="text-xl font-semibold text-fg">Conditions générales d'utilisation mises à jour</h1>
          <p className="mt-1 text-sm text-fg-muted">
            La version {version} des conditions générales applicables à votre établissement est entrée en vigueur. Vous devez l'accepter pour continuer à utiliser Ciyou Eats Restaurant.
          </p>
        </div>
        {changeSummary ? (
          <div className="mx-6 mb-2 rounded-lg bg-surface-2 p-4">
            <p className="text-sm font-semibold text-fg">Ce qui change</p>
            <p className="mt-1 text-sm text-fg-muted">{changeSummary}</p>
          </div>
        ) : null}
        <div className="mx-6 mb-4 max-h-80 overflow-y-auto rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-semibold text-fg">{title}</p>
          <p className="whitespace-pre-wrap text-sm text-fg-muted">{content}</p>
        </div>
        <div className="border-t border-border p-6 pt-4">
          <Button block loading={pending} onClick={() => void accept()}>
            J'accepte les conditions générales
          </Button>
        </div>
      </div>
    </div>
  );
}

function CookieConsentBanner(): ReactNode {
  const [visible, setVisible] = useState(true);
  const [pending, setPending] = useState(false);
  if (!visible) return null;

  const respond = async (analytics: boolean, marketing: boolean) => {
    setPending(true);
    try {
      await Promise.all([setConsent({ key: 'analytics_cookies', granted: analytics }), setConsent({ key: 'marketing_email', granted: marketing })]);
      setVisible(false);
    } catch (error) {
      toast.error(errorMessage(error, "Le choix n'a pas pu être enregistré."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-3 rounded-xl bg-ink p-4 text-white shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-md">
      <p className="text-sm">
        Ciyou Eats utilise des cookies de mesure d'audience et, si vous l'acceptez, des communications marketing. Vous pouvez modifier ce choix à tout moment depuis les réglages de votre établissement.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 border-white/30 bg-transparent text-white hover:bg-white/10" loading={pending} onClick={() => void respond(false, false)}>
          Tout refuser
        </Button>
        <Button variant="primary" className="flex-1" loading={pending} onClick={() => void respond(true, true)}>
          Tout accepter
        </Button>
      </div>
    </div>
  );
}
