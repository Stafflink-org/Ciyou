// Création et modification d'une offre GoLink (tiroir latéral).
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Bike, Gift, Percent, ShoppingBag, Store, Utensils } from 'lucide-react';
import {
  Button,
  Combobox,
  FormField,
  Input,
  RadioGroup,
  Select,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Slider,
  Switch,
  Textarea,
  cn,
} from '@golink/ui';
import {
  FULFILLMENT_LABELS,
  PROMOTION_FUNDING_LABELS,
  formatPrice,
  type FulfillmentMode,
  type PromotionFunding,
  type PromotionKind,
  type PromotionScope,
  type PromotionTarget,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { toMillis, useMutation } from '@/lib/firestore';
import { createPlatformPromotion, type PromotionInput } from '../_croissance/api';
import { useRestaurantOptions } from '../_croissance/hooks';
import { SCOPE_LABELS, TARGET_LABELS, promotionValueLabel } from '../_croissance/labels';
import { ChipGroup, DateTimeField, MoneyInput, NumberInput } from '../_croissance/ui';
import type { PromotionRow } from './lib';

interface Draft {
  scope: PromotionScope;
  countryId: string | null;
  cityIds: string[];
  restaurantIds: string[];
  title: string;
  description: string;
  code: string;
  kind: PromotionKind;
  percent: number | null;
  fixedCents: number | null;
  maxDiscountCents: number | null;
  minSubtotalCents: number | null;
  funding: PromotionFunding;
  restaurantSharePct: number;
  target: PromotionTarget;
  inactiveDays: number | null;
  modes: FulfillmentMode[];
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: number | null;
  endsAt: number | null;
  showcase: boolean;
}

function emptyDraft(defaultCountry: string | null, defaultCities: string[], cityScoped: boolean): Draft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return {
    scope: cityScoped ? 'city' : 'platform',
    countryId: defaultCountry,
    cityIds: defaultCities,
    restaurantIds: [],
    title: '',
    description: '',
    code: '',
    kind: 'percentage',
    percent: 20,
    fixedCents: 500,
    maxDiscountCents: 800,
    minSubtotalCents: 1500,
    funding: 'platform',
    restaurantSharePct: 50,
    target: 'everyone',
    inactiveDays: 30,
    modes: ['delivery', 'pickup'],
    totalUsageLimit: null,
    perCustomerLimit: 1,
    startsAt: start.getTime(),
    endsAt: null,
    showcase: true,
  };
}

function fromPromotion(p: PromotionRow): Draft {
  return {
    scope: p.scope,
    countryId: p.countryId ?? null,
    cityIds: p.cityIds ?? [],
    restaurantIds: p.scope === 'restaurant' && p.restaurantId ? [p.restaurantId] : (p.restaurantIds ?? []),
    title: p.title.fr,
    description: p.description?.fr ?? '',
    code: p.code ?? '',
    kind: p.kind,
    percent: p.kind === 'percentage' ? p.value / 100 : 20,
    fixedCents: p.kind === 'fixed' ? p.value : 500,
    maxDiscountCents: p.maxDiscountCents ?? null,
    minSubtotalCents: p.minSubtotalCents,
    funding: p.funding,
    restaurantSharePct: p.restaurantShareBps ? p.restaurantShareBps / 100 : 50,
    target: p.target,
    inactiveDays: p.inactiveDays ?? 30,
    modes: p.modes,
    totalUsageLimit: p.totalUsageLimit ?? null,
    perCustomerLimit: p.perCustomerLimit,
    startsAt: toMillis(p.startsAt),
    endsAt: toMillis(p.endsAt),
    showcase: p.showcase,
  };
}

function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-b border-border pb-6 last:border-0 last:pb-0">
      <div>
        <h3 className="eyebrow">{title}</h3>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function PromotionFormSheet({ promotion, onDone }: { promotion?: PromotionRow | null; onDone: () => void }) {
  const navigate = useNavigate();
  const geo = useGeoScope();
  const { admin } = useAdminAccess();
  const cityScoped = admin.role !== 'super_admin' && admin.cityIds.length > 0;
  const restaurants = useRestaurantOptions();
  const [draft, setDraft] = useState<Draft>(() =>
    promotion ? fromPromotion(promotion) : emptyDraft(geo.countryId ?? geo.countries[0]?.id ?? null, geo.cityId ? [geo.cityId] : [], cityScoped),
  );
  const [touched, setTouched] = useState(false);
  const { mutate, loading } = useMutation(createPlatformPromotion);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const cityOptions = useMemo(
    () => geo.cities.filter((c) => draft.scope !== 'city' || !draft.countryId || c.countryId === draft.countryId).map((c) => ({ value: c.id, label: c.name })),
    [geo.cities, draft.scope, draft.countryId],
  );
  const restaurantOptions = useMemo(
    () =>
      restaurants.options
        .filter((r) => {
          if (draft.scope === 'city') return draft.cityIds.length === 0 || draft.cityIds.includes(r.cityId);
          if (draft.scope === 'country') return !draft.countryId || r.countryId === draft.countryId;
          if (cityScoped) return admin.cityIds.includes(r.cityId);
          return true;
        })
        .map((r) => ({ value: r.id, label: r.name, description: geo.cities.find((c) => c.id === r.cityId)?.name })),
    [restaurants.options, draft.scope, draft.cityIds, draft.countryId, cityScoped, admin.cityIds, geo.cities],
  );

  const value = draft.kind === 'percentage' ? Math.round((draft.percent ?? 0) * 100) : draft.kind === 'fixed' ? (draft.fixedCents ?? 0) : 0;
  const errors = useMemo(() => {
    const e: Partial<Record<keyof Draft | 'value', string>> = {};
    if (draft.title.trim().length < 3) e.title = 'Au moins 3 caractères.';
    if (draft.kind === 'percentage' && (!draft.percent || draft.percent < 1 || draft.percent > 100)) e.value = 'Entre 1 et 100 %.';
    if (draft.kind === 'fixed' && (!draft.fixedCents || draft.fixedCents < 50)) e.value = 'Au moins 0,50 €.';
    if (draft.minSubtotalCents === null) e.minSubtotalCents = 'Indiquez un panier minimum (0 accepté).';
    if (draft.kind === 'fixed' && (draft.minSubtotalCents ?? 0) < (draft.fixedCents ?? 0)) e.minSubtotalCents = 'Au moins égal au montant de la remise.';
    if (draft.code && !/^[A-Z0-9_-]{3,24}$/.test(draft.code)) e.code = '3 à 24 lettres majuscules, chiffres, tirets.';
    if (draft.scope === 'country' && !draft.countryId) e.countryId = 'Choisissez un pays.';
    if (draft.scope === 'city' && draft.cityIds.length === 0) e.cityIds = 'Choisissez au moins une ville.';
    if (draft.scope === 'restaurant' && draft.restaurantIds.length !== 1) e.restaurantIds = 'Choisissez le restaurant.';
    if (draft.scope !== 'restaurant' && draft.funding !== 'platform' && draft.restaurantIds.length === 0)
      e.restaurantIds = 'Une offre financée par les restaurants doit lister les participants.';
    if (draft.modes.length === 0) e.modes = 'Au moins un mode.';
    if (draft.kind === 'free_delivery' && !draft.modes.includes('delivery')) e.modes = 'La livraison offerte exige le mode Livraison.';
    if (!draft.perCustomerLimit || draft.perCustomerLimit < 1) e.perCustomerLimit = 'Au moins 1.';
    if (draft.totalUsageLimit !== null && draft.perCustomerLimit && draft.totalUsageLimit < draft.perCustomerLimit) e.totalUsageLimit = 'Au moins la limite par client.';
    if (!draft.startsAt) e.startsAt = 'Choisissez une date de début.';
    if (draft.endsAt !== null && draft.startsAt && draft.endsAt <= draft.startsAt) e.endsAt = 'Après la date de début.';
    if (draft.target === 'inactive_customers' && (!draft.inactiveDays || draft.inactiveDays < 7)) e.inactiveDays = '7 jours minimum.';
    return e;
  }, [draft]);
  const valid = Object.keys(errors).length === 0;
  const err = (k: keyof Draft | 'value') => (touched ? errors[k] : undefined);

  async function submit(publish: boolean) {
    setTouched(true);
    if (!valid || !draft.startsAt || draft.perCustomerLimit === null || draft.minSubtotalCents === null) return;
    const input: PromotionInput = {
      promotionId: promotion?.id ?? null,
      scope: draft.scope,
      countryId: draft.scope === 'country' ? draft.countryId : null,
      cityIds: draft.scope === 'city' ? draft.cityIds : [],
      restaurantIds: draft.restaurantIds,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      code: draft.code.trim() || null,
      kind: draft.kind,
      value,
      maxDiscountCents: draft.kind === 'percentage' ? draft.maxDiscountCents : null,
      minSubtotalCents: draft.minSubtotalCents,
      funding: draft.funding,
      restaurantShareBps: draft.funding === 'shared' ? Math.round(draft.restaurantSharePct * 100) : null,
      target: draft.target,
      inactiveDays: draft.target === 'inactive_customers' ? draft.inactiveDays : null,
      modes: draft.modes,
      totalUsageLimit: draft.totalUsageLimit,
      perCustomerLimit: draft.perCustomerLimit,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      showcase: draft.showcase,
      publish,
    };
    const result = await mutate(input);
    if (!result) return;
    onDone();
    if (!promotion) void navigate(`/promotions/${result.promotionId}`);
  }

  const preview = promotionValueLabel({ kind: draft.kind, value, maxDiscountCents: draft.kind === 'percentage' ? draft.maxDiscountCents : null });
  const editingLive = promotion && promotion.status !== 'draft';

  return (
    <SheetContent className="sm:max-w-2xl" aria-describedby={undefined}>
      <SheetHeader
        title={promotion ? 'Modifier l’offre' : 'Nouvelle offre'}
        description={promotion ? 'Les changements s’appliquent aux prochaines commandes.' : 'Remise, portée, conditions, ciblage et financement.'}
        icon={<Gift />}
      />
      <SheetBody className="space-y-6">
        <div className="tone-brand flex items-center gap-4 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface font-display text-md font-semibold text-(--tone-fg) shadow-xs">
            {draft.kind === 'percentage' ? <Percent className="size-5" /> : draft.kind === 'fixed' ? '€' : <Bike className="size-5" />}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-md font-semibold text-fg">{draft.title.trim() || 'Titre de l’offre'}</p>
            <p className="text-sm text-fg-muted">
              {preview}
              {draft.minSubtotalCents ? ` dès ${formatPrice(draft.minSubtotalCents)}` : ''} · {TARGET_LABELS[draft.target].toLowerCase()}
              {draft.code ? ` · code ${draft.code}` : ' · appliquée automatiquement'}
            </p>
          </div>
        </div>

        <FormSection title="Offre">
          <FormField label="Titre affiché aux clients" required error={err('title')}>
            <Input value={draft.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="Ex. 20 % sur votre première commande" />
          </FormField>
          <FormField label="Description" hint="Conditions résumées, affichées sous le titre.">
            <Textarea rows={2} maxLength={240} value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </FormField>
          <RadioGroup
            variant="cards"
            aria-label="Type de remise"
            value={draft.kind}
            onValueChange={(v) => set('kind', v as PromotionKind)}
            className="grid gap-2 sm:grid-cols-3"
            options={[
              { value: 'percentage', label: 'Pourcentage', description: 'Sur le panier' },
              { value: 'fixed', label: 'Montant fixe', description: 'En euros' },
              { value: 'free_delivery', label: 'Livraison offerte', description: 'Frais de livraison' },
            ]}
          />
          {draft.kind !== 'free_delivery' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {draft.kind === 'percentage' ? (
                <FormField label="Remise" required error={err('value')}>
                  <NumberInput value={draft.percent} onChange={(v) => set('percent', v)} unit="%" decimals={1} />
                </FormField>
              ) : (
                <FormField label="Remise" required error={err('value')}>
                  <MoneyInput value={draft.fixedCents} onChange={(v) => set('fixedCents', v)} />
                </FormField>
              )}
              {draft.kind === 'percentage' && (
                <FormField label="Plafond de remise" hint="Vide = sans plafond.">
                  <MoneyInput value={draft.maxDiscountCents} onChange={(v) => set('maxDiscountCents', v)} placeholder="Sans plafond" />
                </FormField>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Portée" description="Où l’offre s’applique.">
          <FormField label="Portée">
            <Select
              value={draft.scope}
              onValueChange={(v) => setDraft((d) => ({ ...d, scope: v as PromotionScope, restaurantIds: [] }))}
              options={(['platform', 'country', 'city', 'restaurant'] as const).map((s) => ({
                value: s,
                label: SCOPE_LABELS[s],
                disabled: cityScoped && (s === 'platform' || s === 'country'),
              }))}
            />
          </FormField>
          {draft.scope === 'country' && (
            <FormField label="Pays" required error={err('countryId')}>
              <Select value={draft.countryId ?? undefined} onValueChange={(v) => set('countryId', v)} placeholder="Choisir un pays" options={geo.countries.map((c) => ({ value: c.id, label: c.name }))} />
            </FormField>
          )}
          {draft.scope === 'city' && (
            <FormField label="Villes" required error={err('cityIds')}>
              <Combobox multiple value={draft.cityIds} onChange={(v: string[]) => set('cityIds', v)} options={cityOptions} placeholder="Choisir des villes" searchPlaceholder="Rechercher une ville" />
            </FormField>
          )}
          {draft.scope === 'restaurant' ? (
            <FormField label="Restaurant" required error={err('restaurantIds')}>
              <Combobox
                value={draft.restaurantIds[0]}
                onChange={(v: string | undefined) => set('restaurantIds', v ? [v] : [])}
                options={restaurantOptions}
                placeholder="Choisir un restaurant"
                searchPlaceholder="Rechercher un restaurant"
                emptyText="Aucun restaurant"
              />
            </FormField>
          ) : (
            <FormField
              label="Restaurants participants"
              hint={draft.funding === 'platform' ? 'Facultatif : vide = tous les restaurants de la portée.' : 'Obligatoire pour une offre financée par les restaurants.'}
              error={err('restaurantIds')}
            >
              <Combobox
                multiple
                value={draft.restaurantIds}
                onChange={(v: string[]) => set('restaurantIds', v)}
                options={restaurantOptions}
                placeholder="Tous les restaurants"
                searchPlaceholder="Rechercher un restaurant"
                emptyText="Aucun restaurant"
              />
            </FormField>
          )}
        </FormSection>

        <FormSection title="Conditions">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Panier minimum" required error={err('minSubtotalCents')} hint="Articles, hors livraison.">
              <MoneyInput value={draft.minSubtotalCents} onChange={(v) => set('minSubtotalCents', v)} />
            </FormField>
            <FormField label="Code promo" hint="Vide = remise appliquée automatiquement." error={err('code')}>
              <Input value={draft.code} maxLength={24} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="BIENVENUE20" className="font-mono" />
            </FormField>
            <FormField label="Utilisations par client" required error={err('perCustomerLimit')}>
              <NumberInput value={draft.perCustomerLimit} onChange={(v) => set('perCustomerLimit', v)} unit="fois" />
            </FormField>
            <FormField label="Utilisations au total" hint="Vide = illimité." error={err('totalUsageLimit')}>
              <NumberInput value={draft.totalUsageLimit} onChange={(v) => set('totalUsageLimit', v)} placeholder="Illimité" />
            </FormField>
            <FormField label="Début" required error={err('startsAt')}>
              <DateTimeField value={draft.startsAt} onChange={(v) => set('startsAt', v)} />
            </FormField>
            <FormField label="Fin" hint="Vide = sans date de fin." error={err('endsAt')}>
              <DateTimeField value={draft.endsAt} onChange={(v) => set('endsAt', v)} placeholder="Sans fin" minDate={draft.startsAt ? new Date(draft.startsAt) : undefined} />
            </FormField>
          </div>
          <FormField label="Modes de commande" error={err('modes')}>
            <div>
              <ChipGroup
                label="Modes de commande"
                value={draft.modes}
                onChange={(v) => set('modes', v)}
                options={(['delivery', 'pickup', 'dine_in'] as const).map((m) => ({
                  value: m,
                  label: FULFILLMENT_LABELS[m],
                  icon: m === 'delivery' ? <Bike /> : m === 'pickup' ? <ShoppingBag /> : <Utensils />,
                }))}
              />
            </div>
          </FormField>
        </FormSection>

        <FormSection title="Ciblage" description="Qui peut profiter de l’offre.">
          <RadioGroup
            variant="cards"
            aria-label="Clients ciblés"
            value={draft.target}
            onValueChange={(v) => set('target', v as PromotionTarget)}
            className="grid gap-2 sm:grid-cols-2"
            options={[
              { value: 'everyone', label: TARGET_LABELS.everyone, description: 'Sans condition' },
              { value: 'new_customers', label: TARGET_LABELS.new_customers, description: 'Première commande sur GoLink' },
              { value: 'inactive_customers', label: TARGET_LABELS.inactive_customers, description: 'Sans commande depuis X jours' },
              { value: 'loyal_customers', label: TARGET_LABELS.loyal_customers, description: '5 commandes livrées et plus' },
            ]}
          />
          {draft.target === 'inactive_customers' && (
            <FormField label="Inactifs depuis" error={err('inactiveDays')} className="sm:max-w-xs">
              <NumberInput value={draft.inactiveDays} onChange={(v) => set('inactiveDays', v)} unit="jours" />
            </FormField>
          )}
        </FormSection>

        <FormSection title="Financement" description="Qui supporte le coût des remises.">
          <RadioGroup
            variant="cards"
            aria-label="Financement"
            value={draft.funding}
            onValueChange={(v) => set('funding', v as PromotionFunding)}
            className="grid gap-2 sm:grid-cols-3"
            options={(['platform', 'restaurant', 'shared'] as const).map((f) => ({
              value: f,
              label: PROMOTION_FUNDING_LABELS[f],
              description: f === 'platform' ? '100 % GoLink' : f === 'restaurant' ? 'Déduit du reversement' : 'Réparti selon la part choisie',
            }))}
          />
          {draft.funding === 'shared' && (
            <div className="rounded-xl border border-border bg-surface-2 p-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-fg-muted">
                  <Store className="mr-1.5 inline size-4" />
                  Restaurants <strong className="num text-fg">{draft.restaurantSharePct} %</strong>
                </span>
                <span className="text-fg-muted">
                  GoLink <strong className="num text-fg">{100 - draft.restaurantSharePct} %</strong>
                </span>
              </div>
              <Slider value={[draft.restaurantSharePct]} min={5} max={95} step={5} onValueChange={(v) => set('restaurantSharePct', v[0] ?? 50)} aria-label="Part des restaurants" />
            </div>
          )}
        </FormSection>

        <FormSection title="Visibilité">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-fg">Mettre en avant dans l’app client</span>
              <span className="block text-sm text-fg-muted">Affichée dans la vitrine des offres tant qu’elle est active.</span>
            </span>
            <Switch checked={draft.showcase} onCheckedChange={(v) => set('showcase', v)} aria-label="Mettre en avant" />
          </label>
        </FormSection>
      </SheetBody>
      <SheetFooter className={cn(touched && !valid && 'sm:justify-between')}>
        {touched && !valid && <p className="text-sm text-danger">Corrigez les champs signalés.</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {!editingLive && (
            <Button variant="secondary" loading={loading} onClick={() => void submit(false)}>
              Enregistrer le brouillon
            </Button>
          )}
          <Button variant="primary" loading={loading} onClick={() => void submit(!editingLive)}>
            {editingLive ? 'Enregistrer' : 'Publier l’offre'}
          </Button>
        </div>
      </SheetFooter>
    </SheetContent>
  );
}
