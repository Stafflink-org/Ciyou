import { useMemo } from 'react';
import { Link } from 'react-router';
import { Bike, CalendarClock, Clock3, Gauge, Package, Printer, RotateCcw, Settings2, Utensils, Zap } from 'lucide-react';
import {
  Button,
  FormField,
  PageContainer,
  PageHeader,
  RadioGroup,
  Select,
  Slider,
  Switch,
  Textarea,
  formatEUR,
} from '@golink/ui';
import {
  COLLECTIONS,
  FULFILLMENT_LABELS,
  SETTINGS_DOCS,
  formatBps,
  resolveMerchantDefaults,
  type City,
  type Country,
  type OrderRules,
  type OrderRulesSettings,
  type RestaurantOrderSettings,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { docAt, errorMessage, useDoc, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings, type OrdersInput } from '../parametres/kit/api';
import { useConfigLimits, useDraft, useRestaurantSettings, useUnsavedGuard } from '../parametres/kit/hooks';
import { IntegerInput, MoneyInput } from '../parametres/kit/inputs';
import {
  LoadError,
  Notice,
  RowList,
  SaveBar,
  SettingRow,
  SettingsCard,
  SettingsSkeleton,
  SplitLayout,
  SummaryLine,
  SummaryPanel,
} from '../parametres/kit/ui';

type Draft = Omit<OrdersInput, 'section'>;

const LEAD_OPTIONS = [
  { value: '30', label: '30 minutes avant' },
  { value: '60', label: '1 heure avant' },
  { value: '120', label: '2 heures avant' },
  { value: '240', label: '4 heures avant' },
  { value: '1440', label: 'La veille' },
];
const HORIZON_OPTIONS = [1, 2, 3, 7, 14].map((d) => ({ value: String(d), label: d === 1 ? 'Le jour même et le lendemain' : `Jusqu’à ${d} jours à l’avance` }));

/** Même règle que le serveur : le décalage entre préparation et délai annoncé est conservé. */
function etaPreview(prep: number, current: { prepMinutes: number; etaMinutes: { min: number; max: number } }) {
  const extraMin = Math.max(0, current.etaMinutes.min - current.prepMinutes);
  const extraMax = Math.max(extraMin, current.etaMinutes.max - current.prepMinutes);
  return { min: prep + extraMin, max: prep + extraMax };
}

/** Réglages de prise de commande : cadence, modes, capacité, commandes programmées. */
export function ReglagesCommandesPage() {
  const { restaurant, restaurantId } = useRestaurantAccess();
  const settings = useRestaurantSettings<RestaurantOrderSettings>('orders');
  const limits = useConfigLimits();

  // Valeurs initiales (H3) : plateforme, puis pays, puis ville — pour le bouton « Réinitialiser ».
  const platformRules = useDoc<OrderRulesSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.orderRules}`));
  const countryRules = useDoc<Country>(docAt(`${COLLECTIONS.countries}/${restaurant.countryId}`));
  const cityRules = useDoc<City>(docAt(`${COLLECTIONS.cities}/${restaurant.cityId}`));
  const merchantDefaults = useMemo(
    () => resolveMerchantDefaults(platformRules.data as Partial<OrderRules> | undefined, countryRules.data?.orderRules, cityRules.data?.orderRules),
    [platformRules.data, countryRules.data, cityRules.data],
  );

  const source = useMemo<Draft | null>(() => {
    if (settings.loading) return null;
    const s = settings.data;
    return {
      prepMinutes: s?.prepMinutes ?? restaurant.prepMinutes ?? 20,
      maxConcurrentOrders: s?.maxConcurrentOrders ?? 12,
      minOrderCents: s?.minOrderCents ?? restaurant.minOrderCents ?? 0,
      delivery: s?.delivery ?? restaurant.fulfillmentModes.includes('delivery'),
      pickup: s?.pickup ?? restaurant.fulfillmentModes.includes('pickup'),
      dineIn: s?.dineIn ?? restaurant.fulfillmentModes.includes('dine_in'),
      autoAccept: s?.autoAccept ?? false,
      autoPrint: s?.autoPrint ?? false,
      scheduledOrders: s?.scheduledOrders ?? false,
      scheduledLeadMinutes: s?.scheduledLeadMinutes ?? 60,
      scheduledMaxDays: s?.scheduledMaxDays ?? 3,
      pickupInstructions: s?.pickupInstructions ?? '',
      dineInInstructions: s?.dineInInstructions ?? '',
      deliveredBy: restaurant.deliveredBy ?? 'platform',
    };
  }, [settings.data, settings.loading, restaurant.prepMinutes, restaurant.minOrderCents, restaurant.fulfillmentModes, restaurant.deliveredBy]);

  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Réglages des commandes enregistrés.' });

  const header = (
    <PageHeader
      eyebrow="Configuration"
      title="Réglages des commandes"
      description="Ajustez la cadence de votre cuisine et choisissez les commandes que vous pouvez accueillir."
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
        <SettingsSkeleton cards={3} />
      </PageContainer>
    );

  const flag = limits.isEnabled;
  const ownDrivers = flag('restaurant_own_drivers');
  const commission = limits.plan.commission;
  const eta = etaPreview(draft.prepMinutes, restaurant);
  const modes = [draft.delivery && 'delivery', draft.pickup && 'pickup', draft.dineIn && 'dine_in'].filter(Boolean) as Array<keyof typeof FULFILLMENT_LABELS>;
  const noMode = modes.length === 0;

  const onSave = async () => {
    const result = await save.mutate({
      restaurantId,
      section: 'orders',
      ...draft,
      pickupInstructions: draft.pickupInstructions?.trim() || null,
      dineInInstructions: draft.dineInInstructions?.trim() || null,
    });
    if (result) markSaved();
  };

  return (
    <PageContainer>
      {header}
      <SplitLayout
        aside={
          <SummaryPanel eyebrow="En ce moment" icon={<Settings2 />} title="Votre rythme, vos règles.">
            <SummaryLine label="Préparation" value={`${draft.prepMinutes} min`} />
            <SummaryLine label="Délai annoncé" value={`${eta.min}–${eta.max} min`} />
            <SummaryLine label="En simultané" value={`${draft.maxConcurrentOrders} commandes`} />
            <SummaryLine label="Minimum" value={draft.minOrderCents > 0 ? formatEUR(draft.minOrderCents, { cents: true }) : 'Aucun'} />
            <SummaryLine label="Modes" value={noMode ? 'Aucun mode actif' : modes.map((m) => FULFILLMENT_LABELS[m]).join(' · ')} />
            <SummaryLine label="Acceptation" value={draft.autoAccept ? 'Automatique' : 'Manuelle'} />
            <SummaryLine label="Programmées" value={draft.scheduledOrders ? 'Acceptées' : 'Désactivées'} />
          </SummaryPanel>
        }
      >
        <SettingsCard icon={<Clock3 />} title="Temps de préparation" description="Estimation communiquée aux clients et aux livreurs pour chaque commande.">
          <div className="flex items-center gap-4">
            <Slider
              className="min-w-0 flex-1"
              min={5}
              max={90}
              step={5}
              value={[draft.prepMinutes]}
              aria-label="Temps de préparation"
              formatValue={(v) => `${v} min`}
              onValueChange={([v]) => v !== undefined && setDraft({ prepMinutes: v })}
            />
            <span className="w-20 shrink-0 rounded-lg bg-surface-3 px-2 py-1.5 text-center font-display text-lg font-semibold text-fg num">{draft.prepMinutes} min</span>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            Délai annoncé au client : <span className="font-medium text-fg-muted num">{eta.min}–{eta.max} min</span>. En cas de rush, utilisez le mode affluence depuis la barre du haut plutôt que de
            modifier ce réglage.
          </p>
        </SettingsCard>

        <SettingsCard icon={<Package />} title="Modes de commande" description="Choisissez comment vos clients récupèrent leurs plats.">
          {noMode && (
            <Notice tone="danger" className="mb-4">
              Activez au moins un mode : sans mode, votre établissement n’apparaît plus dans l’app.
            </Notice>
          )}
          <RowList>
            <SettingRow
              icon={<Bike />}
              label={FULFILLMENT_LABELS.delivery}
              description="Un livreur apporte la commande au client."
              disabledReason={!flag('delivery') ? 'Pas encore ouverte pour votre établissement.' : undefined}
            >
              <Switch checked={draft.delivery} disabled={!flag('delivery') && !draft.delivery} aria-label="Livraison" onCheckedChange={(v) => setDraft({ delivery: v })} />
            </SettingRow>
            {draft.delivery && (
              <div className="py-4">
                <p className="mb-3 text-sm font-medium text-fg">Qui livre vos commandes ?</p>
                <RadioGroup
                  variant="cards"
                  className="lg:grid-cols-3"
                  value={draft.deliveredBy}
                  onValueChange={(v) => setDraft({ deliveredBy: v as Draft['deliveredBy'] })}
                  options={[
                    { value: 'platform', label: 'Livreurs Ciyou Eats', description: `Commission ${formatBps(commission.platformDeliveryBps)}. Paiement en ligne uniquement.` },
                    {
                      value: 'restaurant',
                      label: 'Mes livreurs',
                      description: `Commission ${formatBps(commission.restaurantDeliveryBps)}. Livreurs salariés : espèces possibles.`,
                      disabled: !ownDrivers,
                    },
                    {
                      value: 'both',
                      label: 'Les deux',
                      description: 'Vos livreurs dans leur rayon, Ciyou Eats au-delà et en renfort.',
                      disabled: !ownDrivers,
                    },
                  ]}
                />
                {draft.deliveredBy !== 'platform' && (
                  <p className="mt-3 text-xs text-fg-subtle">
                    Vos livreurs livrent dans vos{' '}
                    <Link to="/zones" className="font-medium text-primary-soft-fg underline-offset-2 hover:underline">
                      zones de livraison
                    </Link>
                    , avec vos propres frais.
                  </p>
                )}
                {!ownDrivers && <p className="mt-3 text-xs text-fg-subtle">La livraison par vos propres livreurs n’est pas encore ouverte dans votre ville.</p>}
              </div>
            )}
            <SettingRow
              icon={<Package />}
              label={FULFILLMENT_LABELS.pickup}
              description={`Le client retire sa commande au comptoir avec son code de retrait. Commission ${formatBps(commission.pickupBps)}.`}
              disabledReason={!flag('pickup') ? 'Pas encore ouvert pour votre établissement.' : undefined}
            >
              <Switch checked={draft.pickup} disabled={!flag('pickup') && !draft.pickup} aria-label="Retrait" onCheckedChange={(v) => setDraft({ pickup: v })} />
            </SettingRow>
            {draft.pickup && (
              <div className="py-4">
                <FormField label="Consignes de retrait" hint="Affichées au client après la commande." aside={<span className="num">{(draft.pickupInstructions ?? '').length} / 300</span>}>
                  <Textarea rows={2} maxLength={300} value={draft.pickupInstructions ?? ''} placeholder="Ex. Présentez votre code de retrait au comptoir." onChange={(e) => setDraft({ pickupInstructions: e.target.value })} />
                </FormField>
              </div>
            )}
            <SettingRow
              icon={<Utensils />}
              label={FULFILLMENT_LABELS.dine_in}
              description="Le client commande depuis sa table ou le comptoir."
              disabledReason={!flag('dine_in') ? 'Bientôt disponible sur Ciyou Eats.' : undefined}
            >
              <Switch checked={draft.dineIn} disabled={!flag('dine_in') && !draft.dineIn} aria-label="Sur place" onCheckedChange={(v) => setDraft({ dineIn: v })} />
            </SettingRow>
            {draft.dineIn && (
              <div className="py-4">
                <FormField label="Consignes sur place" aside={<span className="num">{(draft.dineInInstructions ?? '').length} / 300</span>}>
                  <Textarea rows={2} maxLength={300} value={draft.dineInInstructions ?? ''} onChange={(e) => setDraft({ dineInInstructions: e.target.value })} />
                </FormField>
              </div>
            )}
          </RowList>
        </SettingsCard>

        <SettingsCard
          icon={<Gauge />}
          title="Capacité et limites"
          description="Des garde-fous pour une cuisine sereine."
          actions={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw />}
              onClick={() =>
                setDraft({
                  prepMinutes: merchantDefaults.prepMinutes,
                  maxConcurrentOrders: merchantDefaults.maxConcurrentOrders,
                  minOrderCents: merchantDefaults.minOrderCents,
                  scheduledLeadMinutes: merchantDefaults.scheduledLeadMinutes,
                  scheduledMaxDays: merchantDefaults.scheduledMaxDays,
                })
              }
            >
              Réinitialiser aux valeurs Ciyou Eats
            </Button>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Commandes simultanées au maximum" hint="Au-delà, les nouvelles commandes sont mises en attente d’acceptation.">
              <IntegerInput value={draft.maxConcurrentOrders} min={1} max={100} unit="cmd" onChange={(v) => v !== null && setDraft({ maxConcurrentOrders: v })} />
            </FormField>
            <FormField label="Minimum de commande" hint="Sous-total minimal, tous modes. En livraison, le minimum de la zone s’applique s’il est plus élevé.">
              <MoneyInput value={draft.minOrderCents} onChange={(v) => v !== null && v <= 10_000 && setDraft({ minOrderCents: v })} />
            </FormField>
          </div>
          <RowList className="mt-5 border-t border-border pt-4">
            <SettingRow icon={<Zap />} label="Acceptation automatique" description="Les nouvelles commandes passent directement en préparation, sans validation manuelle.">
              <Switch checked={draft.autoAccept} aria-label="Acceptation automatique" onCheckedChange={(v) => setDraft({ autoAccept: v })} />
            </SettingRow>
            <SettingRow icon={<Printer />} label="Impression automatique" description="Le ticket part en cuisine dès l’acceptation (imprimante connectée requise).">
              <Switch checked={draft.autoPrint} aria-label="Impression automatique" onCheckedChange={(v) => setDraft({ autoPrint: v })} />
            </SettingRow>
          </RowList>
        </SettingsCard>

        <SettingsCard icon={<CalendarClock />} title="Commandes programmées" description="Vos clients choisissent un créneau à l’avance, dans vos horaires d’ouverture.">
          <RowList>
            <SettingRow
              label="Accepter les commandes programmées"
              description="Idéal pour les déjeuners d’entreprise et les commandes du soir passées en journée."
              disabledReason={!flag('scheduled_orders') ? 'Non disponible pour votre établissement.' : undefined}
            >
              <Switch
                checked={draft.scheduledOrders}
                disabled={!flag('scheduled_orders') && !draft.scheduledOrders}
                aria-label="Commandes programmées"
                onCheckedChange={(v) => setDraft({ scheduledOrders: v })}
              />
            </SettingRow>
          </RowList>
          {draft.scheduledOrders && (
            <div className="mt-4 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
              <FormField label="Délai minimal" hint="Temps entre la commande et le créneau choisi.">
                <Select options={LEAD_OPTIONS} value={String(draft.scheduledLeadMinutes)} onValueChange={(v) => setDraft({ scheduledLeadMinutes: Number(v) })} />
              </FormField>
              <FormField label="Horizon de réservation">
                <Select options={HORIZON_OPTIONS} value={String(draft.scheduledMaxDays)} onValueChange={(v) => setDraft({ scheduledMaxDays: Number(v) })} />
              </FormField>
            </div>
          )}
        </SettingsCard>

        <p className="text-xs text-fg-subtle">
          Les horaires d’ouverture se règlent dans{' '}
          <Button asChild variant="link" size="xs">
            <Link to="/horaires">Horaires</Link>
          </Button>
          .
        </p>
      </SplitLayout>
      <SaveBar dirty={dirty} saving={save.loading} disabled={noMode} message={noMode ? 'Activez au moins un mode de commande' : 'Réglages modifiés'} onSave={() => void onSave()} onReset={reset} />
    </PageContainer>
  );
}
