import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Banknote, CreditCard, Gift, Landmark, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import { Badge, PageContainer, PageHeader, Switch } from '@golink/ui';
import { PAYMENT_METHOD_LABELS, type PaymentMethod, type RestaurantPaymentSettings } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings, type PaymentsInput } from '../parametres/kit/api';
import { useConfigLimits, useDraft, useRestaurantSettings, useUnsavedGuard } from '../parametres/kit/hooks';
import { LoadError, Notice, RowList, SaveBar, SettingRow, SettingsCard, SettingsSkeleton, SplitLayout, SummaryPanel } from '../parametres/kit/ui';

type Draft = Omit<PaymentsInput, 'section'>;
type OnlineMethod = 'card' | 'apple_pay' | 'google_pay';

const ONLINE_META: Record<OnlineMethod, { icon: ReactNode; description: string }> = {
  card: { icon: <CreditCard />, description: 'Visa, Mastercard, cartes de débit. Paiement sécurisé 3-D Secure.' },
  apple_pay: { icon: <Smartphone />, description: 'Paiement en un geste depuis un iPhone.' },
  google_pay: { icon: <Smartphone />, description: 'Paiement en un geste depuis Android.' },
};
const ONLINE: OnlineMethod[] = ['card', 'apple_pay', 'google_pay'];

const FEES: Array<[string, string]> = [
  ['Frais de paiement en ligne', 'Frais bancaires de chaque paiement par carte, déduits de votre reversement.'],
  ['Espèces', 'Encaissées par vos livreurs ; la commission Ciyou Eats correspondante est déduite du prochain versement.'],
  ['Remboursements clients', 'À la charge de l’établissement, déduits du prochain versement.'],
  ['Titres-restaurant', 'Non acceptés sur Ciyou Eats.'],
];

/** Réplique de la règle serveur : moyens réellement proposés aux clients. */
function preview(draft: Draft, allowed: PaymentMethod[]): PaymentMethod[] {
  return allowed.filter((method) => {
    if (method === 'wallet') return true;
    if (method === 'cash') return draft.methods.cash;
    return (ONLINE as PaymentMethod[]).includes(method) && draft.methods[method as OnlineMethod];
  });
}

/**
 * Moyens de paiement acceptés. Décisions Ciyou Eats : tout paiement passe par la
 * plateforme (paiement en ligne toujours ouvert), espèces seulement à la livraison
 * par un livreur salarié du commerce, titres-restaurant non acceptés.
 */
export function PaiementsPage() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const settings = useRestaurantSettings<RestaurantPaymentSettings>('payments');
  const limits = useConfigLimits();

  const source = useMemo<Draft | null>(() => {
    if (settings.loading) return null;
    const s = settings.data;
    const accepted = restaurant.acceptedPaymentMethods ?? [];
    const pick = (m: PaymentMethod) => s?.methods?.[m] ?? accepted.includes(m);
    return {
      online: true,
      onDelivery: pick('cash'),
      onPickup: false,
      methods: { card: pick('card'), apple_pay: pick('apple_pay'), google_pay: pick('google_pay'), cash: pick('cash'), meal_voucher: false },
    };
  }, [settings.data, settings.loading, restaurant.acceptedPaymentMethods]);

  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Moyens de paiement enregistrés.' });

  const header = (
    <PageHeader
      eyebrow="Configuration"
      title="Moyens de paiement"
      description="Choisissez comment vos clients règlent leurs commandes. Les paiements sont encaissés par Ciyou Eats puis reversés sur votre compte, commission déduite."
    />
  );
  if (settings.error)
    return (
      <PageContainer>
        {header}
        <LoadError message={errorMessage(settings.error)} />
      </PageContainer>
    );
  if (!draft || limits.loading)
    return (
      <PageContainer>
        {header}
        <SettingsSkeleton />
      </PageContainer>
    );

  const allowed = limits.allowedPayments;
  // Espèces : l'état enregistré est conservé à l'écran mais ignoré si le commerce ne livre plus lui-même.
  const cashAllowed = allowed.includes('cash');
  const effective: Draft = cashAllowed ? draft : { ...draft, methods: { ...draft.methods, cash: false } };
  const visible = preview(effective, allowed);
  const noOnline = visible.filter((m) => (ONLINE as PaymentMethod[]).includes(m)).length === 0;
  const setMethod = (method: keyof Draft['methods'], on: boolean) =>
    setDraft((d) => ({ ...d, methods: { ...d.methods, [method]: on }, ...(method === 'cash' ? { onDelivery: on } : {}) }));

  const onSave = async () => {
    const result = await save.mutate({ restaurantId, section: 'payments', ...effective, online: true, onPickup: false, onDelivery: effective.methods.cash });
    if (result) markSaved();
  };

  const cashReason = !cashAllowed ? (
    restaurant.deliveredBy === 'platform' || !restaurant.fulfillmentModes.includes('delivery') ? (
      <span>
        Réservé aux commandes livrées par vos livreurs salariés.{' '}
        <Link to="/reglages-commandes" className="font-medium text-primary underline-offset-2 hover:underline">
          Choisir qui livre
        </Link>
      </span>
    ) : (
      'Non autorisé par Ciyou Eats pour votre établissement.'
    )
  ) : undefined;

  return (
    <PageContainer>
      {header}
      <SplitLayout
        aside={
          <>
            <SummaryPanel
              eyebrow="Au moment de payer"
              icon={<Wallet />}
              title={noOnline ? 'Aucun paiement en ligne.' : `${visible.length} moyen${visible.length > 1 ? 's' : ''} proposé${visible.length > 1 ? 's' : ''}.`}
            >
              {visible.map((m) => (
                <p key={m} className="flex items-center justify-between gap-2">
                  <span>{PAYMENT_METHOD_LABELS[m]}</span>
                  <span className="text-xs text-sidebar-muted">{m === 'cash' ? 'Au livreur salarié' : 'En ligne'}</span>
                </p>
              ))}
            </SummaryPanel>
            <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <ShieldCheck className="size-4 text-success" />
                Paiements sécurisés
              </p>
              <p className="mt-1.5 text-xs leading-5 text-fg-subtle">
                Les cartes sont traitées par notre prestataire certifié PCI-DSS : aucune donnée bancaire ne transite par votre établissement.
              </p>
            </div>
          </>
        }
      >
        {noOnline && (
          <Notice tone="danger" title="Vos clients ne pourraient plus payer">
            Gardez au moins un moyen de paiement en ligne activé.
          </Notice>
        )}

        <SettingsCard
          icon={<CreditCard />}
          title="Paiement en ligne"
          description="Réglé dans l’app avant la préparation : aucune commande impayée. Toujours proposé sur Ciyou Eats."
          actions={<Badge tone="success">Obligatoire</Badge>}
        >
          <RowList>
            {ONLINE.map((method) => {
              const authorised = allowed.includes(method);
              return (
                <SettingRow
                  key={method}
                  icon={ONLINE_META[method].icon}
                  label={PAYMENT_METHOD_LABELS[method]}
                  description={ONLINE_META[method].description}
                  disabledReason={!authorised ? 'Non autorisé par Ciyou Eats pour votre établissement.' : undefined}
                >
                  <Switch
                    checked={authorised && draft.methods[method]}
                    disabled={!authorised}
                    aria-label={PAYMENT_METHOD_LABELS[method]}
                    onCheckedChange={(v) => setMethod(method, v)}
                  />
                </SettingRow>
              );
            })}
            <SettingRow icon={<Gift />} label={PAYMENT_METHOD_LABELS.wallet} description="Avoirs et bons d’achat offerts par Ciyou Eats : toujours acceptés, sans frais pour vous.">
              <Badge tone={allowed.includes('wallet') ? 'success' : 'neutral'}>{allowed.includes('wallet') ? 'Toujours accepté' : 'Inactif'}</Badge>
            </SettingRow>
          </RowList>
        </SettingsCard>

        <SettingsCard
          icon={<Banknote />}
          title="Espèces à la livraison"
          description="Proposées seulement quand la commande est livrée par un de vos livreurs salariés. Avec un livreur Ciyou Eats, le paiement en ligne reste obligatoire."
        >
          <RowList>
            <SettingRow
              icon={<Banknote />}
              label={
                <span className="inline-flex items-center gap-2">
                  {PAYMENT_METHOD_LABELS.cash}
                  {!cashAllowed && draft.methods.cash && <Badge size="sm">Suspendu</Badge>}
                </span>
              }
              description="Réglées au livreur à la remise. Pensez au fond de caisse de vos livreurs."
              disabledReason={cashReason}
            >
              <Switch checked={cashAllowed && draft.methods.cash} disabled={!cashAllowed} aria-label="Espèces à la livraison" onCheckedChange={(v) => setMethod('cash', v)} />
            </SettingRow>
          </RowList>
        </SettingsCard>

        <SettingsCard
          icon={<Landmark />}
          title="Frais et reversement"
          description="Ce qui est déduit de vos versements."
          footer={
            <span>
              Le détail de chaque versement figure dans{' '}
              <Link to="/versements" className="font-medium text-primary underline-offset-2 hover:underline">
                Compte de versement
              </Link>
              .
            </span>
          }
        >
          <dl className="divide-y divide-border text-sm">
            {FEES.map(([term, detail]) => (
              <div key={term} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[13rem_1fr] sm:gap-4">
                <dt className="font-medium text-fg">{term}</dt>
                <dd className="text-fg-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </SettingsCard>
      </SplitLayout>
      <SaveBar
        dirty={dirty}
        saving={save.loading}
        disabled={noOnline}
        message={noOnline ? 'Au moins un paiement en ligne est requis' : 'Moyens de paiement modifiés'}
        onSave={() => void onSave()}
        onReset={reset}
      />
    </PageContainer>
  );
}
