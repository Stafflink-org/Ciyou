import { useMemo, useState } from 'react';
import { limit, query, where } from 'firebase/firestore';
import { Landmark, ShieldCheck } from 'lucide-react';
import { Badge, Button, FormField, Input, Select } from '@golink/ui';
import { COLLECTIONS, type Country, type PaymentProvider, type PayoutAccount } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, docAt, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { Notice, SettingsCard } from '../parametres/kit/ui';

const setAccount = callFunction<
  { restaurantId: string; account: { provider: 'bank_transfer' | 'mobile_wallet'; paymentProviderId?: string | null; holderName: string; accountNumber: string } },
  { accountMasked: string; verified: boolean }
>('setRestaurantPayoutAccount');

/** Le pays du commerce n'a pas Stripe : les versements passent par un compte local (virement manuel). */
export function useNonStripeCountry(): { nonStripe: boolean; country: Country | null } {
  const { restaurant } = useRestaurantAccess();
  const country = useDoc<Country>(docAt(`${COLLECTIONS.countries}/${restaurant.countryId}`));
  return { nonStripe: country.data?.stripeAvailable === false, country: country.data ?? null };
}

/** Compte de versement local (Algérie, Maroc, Tunisie) : coordonnées masquées, vérifiées par l'équipe Ciyou Eats avant le premier virement. */
export function LocalAccountCard({ account }: { account: PayoutAccount | null | undefined }) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const { nonStripe, country } = useNonStripeCountry();
  const providersQuery = useMemo(() => (nonStripe ? query(collectionAt(COLLECTIONS.paymentProviders), where('enabled', '==', true), limit(50)) : null), [nonStripe]);
  const providers = useCollection<PaymentProvider>(providersQuery);
  const usable = providers.data.filter((p) => p.supports.payout && country && p.countryIds.includes(country.code));
  const [kind, setKind] = useState<'bank_transfer' | 'mobile_wallet'>('bank_transfer');
  const [providerId, setProviderId] = useState('');
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const save = useMutation(setAccount, { success: 'Compte enregistré : il sera vérifié par l’équipe Ciyou Eats avant le premier virement' });
  if (!nonStripe) return null;
  const canEdit = can('settings.manage');
  return (
    <SettingsCard icon={<Landmark />} title="Compte de versement local" description={`Stripe n’est pas disponible dans votre pays : vos ventes vous sont reversées par virement en ${country?.currency ?? 'devise locale'}, sur le compte ci-dessous.`}>
      <div className="space-y-4">
        {account ? (
          <Notice tone={account.verified ? 'success' : 'amber'} icon={<ShieldCheck />} title={account.verified ? 'Compte vérifié' : 'Vérification en cours'}>
            {account.accountMasked} au nom de {account.holderName} ({account.currency}).{' '}
            <Badge size="sm" variant="outline">{account.provider === 'bank_transfer' ? 'Virement bancaire' : 'Portefeuille mobile'}</Badge>
          </Notice>
        ) : (
          <Notice tone="info" icon={<Landmark />} title="Aucun compte enregistré">
            Renseignez vos coordonnées pour recevoir vos versements.
          </Notice>
        )}
        {canEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type de compte">
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)} options={[{ value: 'bank_transfer', label: 'Virement bancaire (RIB)' }, { value: 'mobile_wallet', label: 'Portefeuille mobile' }]} />
            </FormField>
            <FormField label="Prestataire">
              <Select value={providerId} onValueChange={setProviderId} placeholder="Choisir" options={usable.map((p) => ({ value: p.id, label: p.label }))} />
            </FormField>
            <FormField label="Titulaire du compte">
              <Input value={holder} maxLength={80} onChange={(e) => setHolder(e.target.value)} />
            </FormField>
            <FormField label="RIB ou numéro du portefeuille" hint="Seul un extrait masqué est conservé.">
              <Input value={number} maxLength={40} inputMode="text" onChange={(e) => setNumber(e.target.value)} />
            </FormField>
            <div className="sm:col-span-2">
              <Button variant="primary" loading={save.loading} disabled={holder.trim().length < 2 || number.trim().length < 6} onClick={async () => {
                const ok = await save.mutate({ restaurantId, account: { provider: kind, paymentProviderId: providerId || null, holderName: holder.trim(), accountNumber: number.trim() } });
                if (ok) setNumber('');
              }}>
                Enregistrer le compte
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
