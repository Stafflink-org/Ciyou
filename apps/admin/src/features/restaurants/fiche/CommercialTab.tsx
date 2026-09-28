// Fiche restaurant, onglet « Conditions commerciales » : commission par défaut ou
// négociée (3 taux), formule, mode de facturation, offre spéciale, frais et minimum,
// moyens de paiement, rythme des reversements ; historique des barèmes.
import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { BadgePercent, History, Lock, Save } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  EmptyState,
  FormField,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
  Tooltip,
  formatDate,
} from '@golink/ui';
import {
  BILLING_MODE_LABELS,
  COLLECTIONS,
  DEFAULT_PLANS,
  PAYMENT_METHOD_LABELS,
  isMerchantCourier,
  type CommissionRule,
  type PaymentMethod,
  type Plan,
  type Restaurant,
  type RestaurantCommercial,
  type WithId,
} from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, docAt, errorMessage, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { Panel, bpsLabel } from '../../acteurs-commun/ui';
import { PLAN_LABELS, updateCommercialTerms } from '../lib';

const METHODS: PaymentMethod[] = ['card', 'apple_pay', 'google_pay', 'cash'];

function pct(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? '' : String(bps / 100).replace('.', ',');
}
function toBps(value: string): number | null {
  const t = value.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : Number.NaN;
}
function euros(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ',');
}
function toCents(value: string): number | null {
  const t = value.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
}
function dayOf(ts: unknown): Date | undefined {
  return toDate(ts as never) ?? undefined;
}
function iso(date: Date | undefined): string | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function CommercialForm({ restaurant, commercial, plans, editable }: { restaurant: WithId<Restaurant>; commercial: RestaurantCommercial; plans: Plan[]; editable: boolean }) {
  const n = commercial.negotiatedCommission;
  const [planCode, setPlanCode] = useState<string>(commercial.planCode ?? restaurant.planCode);
  const [billingMode, setBillingMode] = useState<string>(commercial.billingMode ?? 'plan');
  const [negotiate, setNegotiate] = useState(Boolean(n));
  const [rates, setRates] = useState({ platform: pct(n?.platformDeliveryBps), own: pct(n?.restaurantDeliveryBps), pickup: pct(n?.pickupBps) });
  const [validUntil, setValidUntil] = useState<Date | undefined>(dayOf(n?.validUntil));
  const [offer, setOffer] = useState(Boolean(commercial.specialOffer));
  const [offerRate, setOfferRate] = useState(pct(commercial.specialOffer?.commissionReductionBps));
  const [offerEnds, setOfferEnds] = useState<Date | undefined>(dayOf(commercial.specialOffer?.endsAt));
  const [offerReason, setOfferReason] = useState(commercial.specialOffer?.reason ?? '');
  const cashPossible = restaurant.deliveredBy !== 'platform';
  // Espèces retirées d'office si le commerce ne livre pas avec ses propres livreurs (décision client).
  const [methods, setMethods] = useState<PaymentMethod[]>(commercial.allowedPaymentMethods.filter((m) => METHODS.includes(m) && (m !== 'cash' || cashPossible)));
  const [fee, setFee] = useState(euros(commercial.deliveryFeeOverrideCents));
  const [minimum, setMinimum] = useState(euros(commercial.minOrderOverrideCents));
  const [payout, setPayout] = useState<string>(commercial.payoutFrequency ?? 'default');
  const [reason, setReason] = useState('');
  const save = useMutation(updateCommercialTerms, { success: 'Conditions commerciales enregistrées' });

  const plan = plans.find((p) => p.code === planCode) ?? DEFAULT_PLANS.find((p) => p.code === planCode);
  const bps = { platform: toBps(rates.platform), own: toBps(rates.own), pickup: toBps(rates.pickup) };
  const offerBps = toBps(offerRate);
  const feeCents = toCents(fee);
  const minCents = toCents(minimum);
  const cashAllowed = cashPossible && isMerchantCourier('restaurant');
  const invalid =
    (negotiate && (Object.values(bps).some((v) => Number.isNaN(v)) || Object.values(bps).every((v) => v === null))) ||
    (offer && (!offerBps || Number.isNaN(offerBps) || !offerEnds || offerReason.trim().length < 3)) ||
    Number.isNaN(feeCents) ||
    Number.isNaN(minCents) ||
    methods.length === 0;

  async function submit() {
    const result = await save.mutate({
      restaurantId: restaurant.id,
      planCode: planCode as 'basic' | 'pro' | 'premium',
      billingMode: billingMode === 'plan' ? null : (billingMode as 'commission' | 'subscription' | 'hybrid'),
      negotiatedCommission: negotiate ? { platformDeliveryBps: bps.platform, restaurantDeliveryBps: bps.own, pickupBps: bps.pickup, validUntil: iso(validUntil) } : null,
      specialOffer: offer && offerBps && offerEnds ? { commissionReductionBps: offerBps, endsAt: iso(offerEnds)!, reason: offerReason.trim() } : null,
      allowedPaymentMethods: methods,
      deliveryFeeOverrideCents: feeCents,
      minOrderOverrideCents: minCents,
      payoutFrequency: payout === 'default' ? null : (payout as 'weekly' | 'biweekly' | 'monthly'),
      reason: reason.trim(),
    });
    if (result) setReason('');
  }

  const disabled = !editable;
  return (
    <div className="space-y-6">
      <Panel title="Formule et commission" icon={<BadgePercent />} description="Assiette : articles TTC payés par le client, hors frais de livraison et pourboires.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Formule">
            <Select disabled={disabled} value={planCode} onValueChange={setPlanCode} options={Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))} />
          </FormField>
          <FormField label="Mode de facturation">
            <Select
              disabled={disabled}
              value={billingMode}
              onValueChange={setBillingMode}
              options={[{ value: 'plan', label: `Celui de la formule (${BILLING_MODE_LABELS[plan?.billingMode ?? 'commission'].toLowerCase()})` }, ...Object.entries(BILLING_MODE_LABELS).map(([value, label]) => ({ value, label }))]}
            />
          </FormField>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: 'Livraison Ciyou Eats', value: plan?.commission.platformDeliveryBps },
            { label: 'Livreurs du commerce', value: plan?.commission.restaurantDeliveryBps },
            { label: 'Retrait', value: plan?.commission.pickupBps },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-border bg-surface-2 px-4 py-3">
              <p className="text-xs text-fg-muted">{item.label} · formule</p>
              <p className="mt-0.5 font-display text-lg font-semibold text-fg num">{bpsLabel(item.value)}</p>
            </div>
          ))}
        </div>

        <label className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
          <span>
            <span className="block text-sm font-medium text-fg">Commission négociée</span>
            <span className="block text-xs text-fg-subtle">Prioritaire sur la formule, la ville et le pays. Un taux vide reprend celui de la formule.</span>
          </span>
          <Switch disabled={disabled} checked={negotiate} onCheckedChange={setNegotiate} aria-label="Commission négociée" />
        </label>
        {negotiate && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <FormField label="Livraison Ciyou Eats">
              <Input disabled={disabled} inputMode="decimal" trailing="%" value={rates.platform} onChange={(e) => setRates((r) => ({ ...r, platform: e.target.value }))} />
            </FormField>
            <FormField label="Livreurs du commerce">
              <Input disabled={disabled} inputMode="decimal" trailing="%" value={rates.own} onChange={(e) => setRates((r) => ({ ...r, own: e.target.value }))} />
            </FormField>
            <FormField label="Retrait">
              <Input disabled={disabled} inputMode="decimal" trailing="%" value={rates.pickup} onChange={(e) => setRates((r) => ({ ...r, pickup: e.target.value }))} />
            </FormField>
            <FormField label="Jusqu’au">
              <DatePicker disabled={disabled} value={validUntil} onChange={setValidUntil} placeholder="Sans échéance" disabledDays={{ before: new Date() }} />
            </FormField>
          </div>
        )}

        <label className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
          <span>
            <span className="block text-sm font-medium text-fg">Offre spéciale temporaire</span>
            <span className="block text-xs text-fg-subtle">Réduction de commission limitée dans le temps (lancement, geste commercial).</span>
          </span>
          <Switch disabled={disabled} checked={offer} onCheckedChange={setOffer} aria-label="Offre spéciale" />
        </label>
        {offer && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[8rem_12rem_1fr]">
            <FormField label="Réduction">
              <Input disabled={disabled} inputMode="decimal" trailing="pts" value={offerRate} onChange={(e) => setOfferRate(e.target.value)} placeholder="5" />
            </FormField>
            <FormField label="Fin de l’offre">
              <DatePicker disabled={disabled} value={offerEnds} onChange={setOfferEnds} disabledDays={{ before: new Date() }} />
            </FormField>
            <FormField label="Raison">
              <Input disabled={disabled} value={offerReason} onChange={(e) => setOfferReason(e.target.value)} maxLength={200} placeholder="Offre de lancement" />
            </FormField>
          </div>
        )}
      </Panel>

      <Panel title="Paiements, frais et reversements" icon={<BadgePercent />}>
        <FormField label="Moyens de paiement autorisés" hint="Titres-restaurant non acceptés. Espèces seulement si le commerce livre avec ses livreurs salariés.">
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => {
              const blocked = m === 'cash' && !cashAllowed;
              return (
                <Tooltip key={m} content={blocked ? 'Le commerce livre avec Ciyou Eats : paiement en ligne obligatoire' : PAYMENT_METHOD_LABELS[m]}>
                  <label className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${blocked ? 'opacity-50' : 'text-fg'}`}>
                    <Checkbox
                      disabled={disabled || blocked}
                      checked={methods.includes(m)}
                      onCheckedChange={(v) => setMethods((list) => (v === true ? [...list, m] : list.filter((x) => x !== m)))}
                      aria-label={PAYMENT_METHOD_LABELS[m]}
                    />
                    {PAYMENT_METHOD_LABELS[m]}
                  </label>
                </Tooltip>
              );
            })}
          </div>
        </FormField>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Frais de livraison imposés" hint="Vide : frais des zones du commerce.">
            <Input disabled={disabled} inputMode="decimal" trailing="€" value={fee} onChange={(e) => setFee(e.target.value)} />
          </FormField>
          <FormField label="Minimum imposé" hint="Vide : minimum des zones du commerce.">
            <Input disabled={disabled} inputMode="decimal" trailing="€" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          </FormField>
          <FormField label="Reversements">
            <Select
              disabled={disabled}
              value={payout}
              onValueChange={setPayout}
              options={[
                { value: 'default', label: 'Calendrier de la plateforme' },
                { value: 'weekly', label: 'Chaque semaine' },
                { value: 'biweekly', label: 'Tous les 15 jours' },
                { value: 'monthly', label: 'Chaque mois' },
              ]}
            />
          </FormField>
        </div>
        {commercial.payoutsBlocked && (
          <p className="tone-amber mt-4 rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
            Reversements bloqués : {commercial.payoutsBlockedReason ?? 'motif non précisé'}.
          </p>
        )}
      </Panel>

      {editable && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-end">
          <FormField label="Motif de la modification" required hint="Obligatoire : toute modification de tarif est tracée." className="flex-1">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Négociation annuelle, arrivée d’une chaîne…" />
          </FormField>
          <Button variant="primary" leftIcon={<Save />} loading={save.loading} disabled={invalid || reason.trim().length < 3} onClick={() => void submit()}>
            Enregistrer les conditions
          </Button>
        </div>
      )}
    </div>
  );
}

export function CommercialTab({ restaurant }: { restaurant: WithId<Restaurant> }) {
  const can = useCan();
  const canRead = can('restaurants.commercial') || can('finance.view');
  const editable = can('restaurants.commercial');
  const commercial = useDoc<RestaurantCommercial>(canRead ? docAt(`${COLLECTIONS.restaurants}/${restaurant.id}/private/commercial`) : null);
  const plans = useCollection<Plan>(useMemo(() => query(collectionAt(COLLECTIONS.plans)), []));
  const rules = useCollection<CommissionRule>(
    useMemo(
      () =>
        canRead
          ? query(collectionAt(COLLECTIONS.commissionRules), where('scope', '==', 'restaurant'), where('scopeId', '==', restaurant.id), orderBy('validFrom', 'desc'), limit(20))
          : null,
      [canRead, restaurant.id],
    ),
  );

  if (!canRead) {
    return <EmptyState icon={<Lock />} title="Conditions réservées" description="Les conditions commerciales sont visibles par l’équipe commerciale et la finance." />;
  }
  if (commercial.loading) return <Skeleton className="h-96 w-full" />;
  if (commercial.error) return <p className="text-sm text-danger">{errorMessage(commercial.error)}</p>;
  const data: RestaurantCommercial =
    commercial.data ??
    ({
      planCode: restaurant.planCode,
      subscriptionStatus: 'active',
      allowedPaymentMethods: ['card', 'apple_pay', 'google_pay'],
      payoutsBlocked: false,
    } as unknown as RestaurantCommercial);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <CommercialForm key={JSON.stringify(toDate(commercial.data?.updatedAt)?.getTime() ?? 0)} restaurant={restaurant} commercial={data} plans={plans.data} editable={editable} />
      <Panel title="Historique des barèmes" icon={<History />} description="Chaque changement crée une nouvelle version ; les anciennes restent consultables.">
        {rules.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : rules.data.length === 0 ? (
          <EmptyState compact icon={<History />} title="Barème de la formule" description="Aucun taux propre à ce commerce n’a encore été défini." />
        ) : (
          <ol className="space-y-3">
            {rules.data.map((rule, index) => {
              const from = toDate(rule.validFrom);
              const to = toDate(rule.validTo);
              return (
                <li key={rule.id} className="rounded-xl border border-border px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-fg-subtle">
                      {from ? formatDate(from) : '—'} → {to ? formatDate(to) : 'en cours'}
                    </span>
                    {index === 0 && !to && <Badge tone="success">En vigueur</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-sm text-fg num">
                    {bpsLabel(rule.platformDeliveryBps)} · {bpsLabel(rule.restaurantDeliveryBps)} · {bpsLabel(rule.pickupBps)}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">« {rule.reason} »</p>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-4 text-xs text-fg-subtle">Ordre des taux : livraison Ciyou Eats · livreurs du commerce · retrait.</p>
      </Panel>
    </div>
  );
}
