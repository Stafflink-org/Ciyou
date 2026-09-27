import { useMemo, useState, type ReactNode } from 'react';
import { addMonths } from 'date-fns';
import { Info, RefreshCw, Tag, Ticket, Truck, Zap } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  FormField,
  Input,
  RadioGroup,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Switch,
  Textarea,
  cn,
  formatEUR,
} from '@golink/ui';
import {
  FULFILLMENT_LABELS,
  PROMO_CODE_PATTERN,
  RESTAURANT_PROMOTION_RULES,
  parsePriceInput,
  type FulfillmentMode,
  type PromotionKind,
  type PromotionStatus,
  type PromotionTarget,
} from '@golink/shared';
import { useActiveRestaurant } from '@/auth/RestaurantAccess';
import { callFunction, toDate, useMutation } from '@/lib/firestore';
import { TARGET_LABELS, discountLabel, generateCode, promotionRulesText, usePromotionSettings, type PromotionRow } from './lib';

interface PromotionFields {
  title: string;
  description: string | null;
  code: string | null;
  kind: PromotionKind;
  value: number;
  maxDiscountCents: number | null;
  minSubtotalCents: number;
  target: PromotionTarget;
  inactiveDays: number | null;
  modes: FulfillmentMode[];
  totalUsageLimit: number | null;
  perCustomerLimit: number;
  startsAt: number;
  endsAt: number | null;
}

type Result = { promotionId: string; status: PromotionStatus | 'deleted' };
const createPromotion = callFunction<PromotionFields & { restaurantId: string; submit: boolean }, Result>('createPromotion');
const updatePromotion = callFunction<{ action: 'edit'; promotionId: string; fields: PromotionFields; submit: boolean }, Result>('updatePromotion');

interface FormState {
  kind: PromotionKind;
  trigger: 'code' | 'auto';
  code: string;
  title: string;
  description: string;
  value: string;
  maxDiscount: string;
  minSubtotal: string;
  target: PromotionTarget;
  inactiveDays: string;
  modes: FulfillmentMode[];
  perCustomerLimit: string;
  totalUsageLimit: string;
  startsAt: Date;
  endsAt: Date | undefined;
}

type Errors = Partial<Record<keyof FormState, string>>;

const euros = (cents: number | null | undefined) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');

function initialState(promotion: PromotionRow | null, modes: FulfillmentMode[]): FormState {
  if (!promotion) {
    const today = new Date();
    return {
      kind: 'percentage',
      trigger: 'code',
      code: '',
      title: '',
      description: '',
      value: '10',
      maxDiscount: '',
      minSubtotal: '15',
      target: 'everyone',
      inactiveDays: '45',
      modes,
      perCustomerLimit: '1',
      totalUsageLimit: '',
      startsAt: today,
      endsAt: addMonths(today, 1),
    };
  }
  return {
    kind: promotion.kind,
    trigger: promotion.code ? 'code' : 'auto',
    code: promotion.code ?? '',
    title: promotion.title.fr,
    description: promotion.description?.fr ?? '',
    value: promotion.kind === 'percentage' ? String(promotion.value / 100).replace('.', ',') : euros(promotion.value),
    maxDiscount: euros(promotion.maxDiscountCents),
    minSubtotal: euros(promotion.minSubtotalCents),
    target: promotion.target,
    inactiveDays: String(promotion.inactiveDays ?? 45),
    modes: promotion.modes,
    perCustomerLimit: String(promotion.perCustomerLimit),
    totalUsageLimit: promotion.totalUsageLimit ? String(promotion.totalUsageLimit) : '',
    startsAt: toDate(promotion.startsAt) ?? new Date(),
    endsAt: toDate(promotion.endsAt) ?? undefined,
  };
}

function parseInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Contrôles identiques à ceux de la Cloud Function, pour signaler les erreurs au bon champ. */
function validate(form: FormState, limits: ReturnType<typeof usePromotionSettings>, isNew: boolean) {
  const errors: Errors = {};
  const code = form.code.trim().toUpperCase().replace(/\s+/g, '');
  if (form.trigger === 'code' && !PROMO_CODE_PATTERN.test(code)) errors.code = '3 à 24 caractères : lettres, chiffres, tirets.';
  if (form.title.trim().length < 3) errors.title = 'Donnez un titre à votre offre (3 caractères minimum).';
  let value = 0;
  if (form.kind === 'percentage') {
    const pct = Number(form.value.replace(',', '.'));
    value = Math.round(pct * 100);
    if (!Number.isFinite(pct) || pct < 1) errors.value = 'Au moins 1 %.';
    else if (value > 10_000) errors.value = 'Au plus 100 %.';
    else if (limits.capsEnabled && value > limits.restaurantMaxPercentBps) errors.value = `Maximum ${limits.restaurantMaxPercentBps / 100} % (règle Ciyou Eats).`;
  } else if (form.kind === 'fixed') {
    value = parsePriceInput(form.value) ?? -1;
    if (value < 50) errors.value = 'Au moins 0,50 €.';
    else if (value > 20_000) errors.value = 'Au plus 200 €.';
    else if (limits.capsEnabled && value > limits.restaurantMaxFixedCents) errors.value = `Maximum ${formatEUR(limits.restaurantMaxFixedCents, { cents: true })} (règle Ciyou Eats).`;
  }
  const minSubtotalCents = form.minSubtotal.trim() === '' ? 0 : (parsePriceInput(form.minSubtotal) ?? -1);
  if (minSubtotalCents < 0) errors.minSubtotal = 'Montant invalide.';
  else if (minSubtotalCents > RESTAURANT_PROMOTION_RULES.maxMinSubtotalCents) errors.minSubtotal = 'Maximum 200 €.';
  else if (form.kind === 'fixed' && value > 0 && minSubtotalCents < value) errors.minSubtotal = 'Au moins égal au montant de la remise.';
  const maxDiscountCents = form.kind === 'percentage' && form.maxDiscount.trim() ? parsePriceInput(form.maxDiscount) : null;
  if (form.kind === 'percentage' && form.maxDiscount.trim() && (maxDiscountCents === null || maxDiscountCents < 100)) {
    errors.maxDiscount = 'Au moins 1,00 €.';
  }
  const perCustomerLimit = parseInteger(form.perCustomerLimit);
  if (!perCustomerLimit || perCustomerLimit > RESTAURANT_PROMOTION_RULES.maxPerCustomerLimit) errors.perCustomerLimit = 'Entre 1 et 50.';
  const totalUsageLimit = form.totalUsageLimit.trim() ? parseInteger(form.totalUsageLimit) : null;
  if (form.totalUsageLimit.trim() && (!totalUsageLimit || totalUsageLimit < 1)) errors.totalUsageLimit = 'Nombre entier positif.';
  else if (totalUsageLimit && perCustomerLimit && totalUsageLimit < perCustomerLimit) errors.totalUsageLimit = 'Au moins la limite par client.';
  const inactiveDays = form.target === 'inactive_customers' ? parseInteger(form.inactiveDays) : null;
  if (form.target === 'inactive_customers' && (!inactiveDays || inactiveDays < 14 || inactiveDays > 365)) errors.inactiveDays = 'Entre 14 et 365 jours.';
  if (form.modes.length === 0) errors.modes = 'Choisissez au moins un mode de commande.';
  if (form.kind === 'free_delivery' && !form.modes.includes('delivery')) errors.modes = 'La livraison offerte concerne le mode Livraison.';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (isNew && form.startsAt < startOfToday) errors.startsAt = 'La date de début est passée.';
  const endsAt = form.endsAt ? new Date(form.endsAt.getFullYear(), form.endsAt.getMonth(), form.endsAt.getDate(), 23, 59, 59) : null;
  if (endsAt && endsAt <= form.startsAt) errors.endsAt = 'La fin doit suivre le début.';
  if (endsAt && endsAt.getTime() < Date.now()) errors.endsAt = 'Cette date est passée.';

  const startsAt = new Date(form.startsAt.getFullYear(), form.startsAt.getMonth(), form.startsAt.getDate());
  const fields: PromotionFields = {
    title: form.title.trim(),
    description: form.description.trim() || null,
    code: form.trigger === 'code' ? code : null,
    kind: form.kind,
    value: form.kind === 'free_delivery' ? 0 : value,
    maxDiscountCents,
    minSubtotalCents: Math.max(0, minSubtotalCents),
    target: form.target,
    inactiveDays,
    modes: form.modes,
    totalUsageLimit,
    perCustomerLimit: perCustomerLimit ?? 1,
    startsAt: Math.max(startsAt.getTime(), isNew ? Date.now() : startsAt.getTime()),
    endsAt: endsAt?.getTime() ?? null,
  };
  return { errors, fields };
}

const KIND_OPTIONS = [
  { value: 'percentage', label: 'Pourcentage', description: 'Ex. 15 % sur le panier' },
  { value: 'fixed', label: 'Montant fixe', description: 'Ex. 5 € dès 25 €' },
  { value: 'free_delivery', label: 'Livraison offerte', description: 'Frais de livraison à votre charge' },
];

export interface PromotionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Offre à modifier ; null = création (éventuellement pré-remplie par `template`). */
  promotion: PromotionRow | null;
  template?: PromotionRow | null;
  onSaved?: (promotionId: string) => void;
}

export function PromotionForm({ open, onOpenChange, promotion, template, onSaved }: PromotionFormProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        {open && (
          <PromotionFormBody
            key={promotion?.id ?? template?.id ?? 'new'}
            promotion={promotion}
            template={template ?? null}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3.5 border-b border-border pb-6 last:border-0 last:pb-0">
      <div>
        <h3 className="font-display text-md font-semibold tracking-tight text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function PromotionFormBody({
  promotion,
  template,
  onClose,
  onSaved,
}: {
  promotion: PromotionRow | null;
  template: PromotionRow | null;
  onClose: () => void;
  onSaved?: (promotionId: string) => void;
}) {
  const restaurant = useActiveRestaurant();
  const limits = usePromotionSettings();
  const availableModes = restaurant.fulfillmentModes.length ? restaurant.fulfillmentModes : (['delivery'] as FulfillmentMode[]);
  const [form, setForm] = useState<FormState>(() => {
    const base = initialState(promotion ?? template, availableModes);
    if (!promotion && template) {
      const today = new Date();
      return { ...base, code: template.code ? generateCode(template.code.slice(0, 6)) : '', startsAt: today, endsAt: addMonths(today, 1) };
    }
    return base;
  });
  const [touched, setTouched] = useState(false);
  const isNew = !promotion;
  const used = (promotion?.stats.redemptions ?? 0) > 0;
  const { errors, fields } = useMemo(() => validate(form, limits, isNew), [form, limits, isNew]);
  const visibleErrors: Errors = touched ? errors : {};
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation(
    async (submit: boolean) => {
      const result = promotion
        ? await updatePromotion({ action: 'edit', promotionId: promotion.id, fields, submit })
        : await createPromotion({ ...fields, restaurantId: restaurant.id, submit });
      return { result, submit };
    },
    {
      success: ({ result, submit }) =>
        !submit
          ? 'Offre enregistrée.'
          : result.status === 'pending_review'
            ? 'Offre envoyée à Ciyou Eats pour validation.'
            : result.status === 'active'
              ? 'Offre mise en ligne.'
              : 'Offre enregistrée.',
    },
  );

  async function handle(submit: boolean) {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    const out = await save.mutate(submit);
    if (out) {
      onSaved?.(out.result.promotionId);
      onClose();
    }
  }

  const canSubmit = !promotion || ['draft', 'rejected'].includes(promotion.status);
  const submitLabel = limits.restaurantRequiresReview ? 'Soumettre à Ciyou Eats' : 'Mettre en ligne';
  const example = form.minSubtotal && fields.minSubtotalCents > 0 ? Math.max(fields.minSubtotalCents, 2500) : 2500;
  const exampleDiscount =
    form.kind === 'percentage'
      ? Math.min(Math.round((example * fields.value) / 10_000), fields.maxDiscountCents ?? Number.MAX_SAFE_INTEGER)
      : form.kind === 'fixed'
        ? fields.value
        : null;

  return (
    <>
      <SheetHeader
        icon={<Tag />}
        title={promotion ? 'Modifier l’offre' : template ? 'Dupliquer l’offre' : 'Nouvelle offre'}
        description={`Une remise financée par ${restaurant.name}, dans les règles fixées par Ciyou Eats.`}
      />
      <SheetBody className="pb-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="min-w-0 space-y-6">
            {used && (
              <div className="tone-info flex gap-2.5 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-3.5 text-sm text-(--tone-fg)">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p>Cette offre a déjà été utilisée : la remise, le code et les conditions sont figés. Vous pouvez encore ajuster le titre, les limites et la date de fin.</p>
              </div>
            )}

            <Section title="Type de remise">
              <RadioGroup
                variant="cards"
                className="sm:grid-cols-3"
                value={form.kind}
                onValueChange={(value) => {
                  const kind = value as PromotionKind;
                  setForm((f) => ({
                    ...f,
                    kind,
                    value: kind === 'percentage' ? '10' : kind === 'fixed' ? '3,00' : '',
                    modes: kind === 'free_delivery' && !f.modes.includes('delivery') && availableModes.includes('delivery') ? [...f.modes, 'delivery'] : f.modes,
                  }));
                }}
                options={KIND_OPTIONS.map((o) => ({ ...o, disabled: used || (o.value === 'free_delivery' && !availableModes.includes('delivery')) }))}
              />
              {form.kind !== 'free_delivery' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label={form.kind === 'percentage' ? 'Pourcentage' : 'Montant de la remise'}
                    required
                    error={visibleErrors.value}
                    hint={
                      !limits.capsEnabled
                        ? undefined
                        : form.kind === 'percentage'
                          ? `Jusqu’à ${limits.restaurantMaxPercentBps / 100} %.`
                          : `Jusqu’à ${formatEUR(limits.restaurantMaxFixedCents, { cents: true })}.`
                    }
                  >
                    <Input
                      inputMode="decimal"
                      value={form.value}
                      disabled={used}
                      onChange={(e) => set('value', e.target.value)}
                      trailing={form.kind === 'percentage' ? '%' : '€'}
                    />
                  </FormField>
                  {form.kind === 'percentage' && (
                    <FormField label="Plafond de remise" hint="Facultatif : remise maximale par commande." error={visibleErrors.maxDiscount}>
                      <Input inputMode="decimal" placeholder="Aucun" value={form.maxDiscount} disabled={used} onChange={(e) => set('maxDiscount', e.target.value)} trailing="€" />
                    </FormField>
                  )}
                </div>
              )}
            </Section>

            <Section title="Présentation" description="Ce que vos clients voient dans l’application.">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {(
                  [
                    { value: 'code', icon: <Ticket />, label: 'Code à saisir', text: 'Vous le partagez (réseaux, flyers, campagne).' },
                    { value: 'auto', icon: <Zap />, label: 'Offre automatique', text: 'Appliquée d’office, visible sur votre fiche.' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={used}
                    aria-pressed={form.trigger === option.value}
                    onClick={() => set('trigger', option.value)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      form.trigger === option.value ? 'border-primary bg-primary-soft/50' : 'border-border bg-surface hover:border-border-strong',
                    )}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">{option.icon}</span>
                    <span>
                      <span className="block text-sm font-medium text-fg">{option.label}</span>
                      <span className="block text-xs text-fg-subtle">{option.text}</span>
                    </span>
                  </button>
                ))}
              </div>
              {form.trigger === 'code' && (
                <FormField label="Code" required error={visibleErrors.code} hint="Majuscules, chiffres et tirets, sans espace.">
                  <Input
                    className="font-mono uppercase tracking-wider"
                    maxLength={24}
                    autoComplete="off"
                    placeholder="EX. BIENVENUE10"
                    value={form.code}
                    disabled={used}
                    onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                    trailing={
                      !used && (
                        <button
                          type="button"
                          className="pointer-events-auto grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
                          aria-label="Générer un code"
                          title="Générer un code"
                          onClick={() => set('code', generateCode(restaurant.name))}
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                      )
                    }
                  />
                </FormField>
              )}
              <FormField label="Titre" required error={visibleErrors.title} aside={`${form.title.length}/${RESTAURANT_PROMOTION_RULES.titleMax}`}>
                <Input maxLength={RESTAURANT_PROMOTION_RULES.titleMax} placeholder="Ex. Le déjeuner à prix doux" value={form.title} onChange={(e) => set('title', e.target.value)} />
              </FormField>
              <FormField label="Description" aside={`${form.description.length}/${RESTAURANT_PROMOTION_RULES.descriptionMax}`}>
                <Textarea
                  rows={2}
                  maxLength={RESTAURANT_PROMOTION_RULES.descriptionMax}
                  placeholder="Ex. Valable le midi, sur toute la carte."
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </FormField>
            </Section>

            <Section title="Conditions">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Panier minimum" error={visibleErrors.minSubtotal} hint="Montant des articles, hors frais.">
                  <Input inputMode="decimal" placeholder="0,00" value={form.minSubtotal} disabled={used} onChange={(e) => set('minSubtotal', e.target.value)} trailing="€" />
                </FormField>
                <FormField label="Clients concernés">
                  <Select
                    value={form.target}
                    disabled={used}
                    onValueChange={(value) => set('target', value as PromotionTarget)}
                    options={(Object.keys(TARGET_LABELS) as PromotionTarget[]).map((value) => ({ value, label: TARGET_LABELS[value] }))}
                  />
                </FormField>
                {form.target === 'inactive_customers' && (
                  <FormField label="Sans commande depuis" error={visibleErrors.inactiveDays}>
                    <Input inputMode="numeric" value={form.inactiveDays} disabled={used} onChange={(e) => set('inactiveDays', e.target.value)} trailing="jours" />
                  </FormField>
                )}
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-fg">Modes de commande</legend>
                <div className="flex flex-wrap gap-2">
                  {availableModes.map((mode) => {
                    const checked = form.modes.includes(mode);
                    return (
                      <label
                        key={mode}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                          checked ? 'border-primary/60 bg-primary-soft/40' : 'border-border bg-surface hover:border-border-strong',
                          used && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={used}
                          onCheckedChange={(v) => set('modes', v === true ? [...form.modes, mode] : form.modes.filter((m) => m !== mode))}
                        />
                        {mode === 'delivery' && <Truck className="size-3.5 text-fg-subtle" />}
                        {FULFILLMENT_LABELS[mode]}
                      </label>
                    );
                  })}
                </div>
                {visibleErrors.modes && <p className="mt-1.5 text-xs text-danger-soft-fg">{visibleErrors.modes}</p>}
              </fieldset>
            </Section>

            <Section title="Limites et période">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Utilisations par client" required error={visibleErrors.perCustomerLimit}>
                  <Input inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => set('perCustomerLimit', e.target.value)} />
                </FormField>
                <FormField label="Utilisations au total" hint="Facultatif : l’offre s’arrête une fois ce nombre atteint." error={visibleErrors.totalUsageLimit}>
                  <Input inputMode="numeric" placeholder="Illimité" value={form.totalUsageLimit} onChange={(e) => set('totalUsageLimit', e.target.value)} />
                </FormField>
                <FormField label="Début" error={visibleErrors.startsAt}>
                  <DatePicker
                    value={form.startsAt}
                    disabled={!isNew && promotion?.status !== 'draft' && promotion?.status !== 'rejected'}
                    onChange={(d) => d && set('startsAt', d)}
                    disabledDays={{ before: new Date() }}
                  />
                </FormField>
                <FormField label="Fin" error={visibleErrors.endsAt}>
                  <DatePicker value={form.endsAt} placeholder="Sans date de fin" onChange={(d) => set('endsAt', d)} disabledDays={{ before: form.startsAt }} />
                </FormField>
              </div>
              <Switch
                label="Sans date de fin"
                description="L’offre reste en ligne jusqu’à ce que vous la terminiez."
                checked={!form.endsAt}
                onCheckedChange={(v) => set('endsAt', v ? undefined : addMonths(form.startsAt, 1))}
              />
            </Section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <p className="eyebrow">Aperçu client</p>
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
              <div className="relative bg-sidebar px-4 pb-5 pt-4 text-sidebar-fg">
                <div className="absolute -right-8 -top-10 size-28 rounded-full border-[18px] border-white/5" aria-hidden="true" />
                <p className="text-2xs font-medium uppercase tracking-eyebrow text-sidebar-muted">{restaurant.name}</p>
                <p className="mt-2 font-display text-3xl font-semibold tracking-display">
                  {form.kind === 'free_delivery' ? 'Livraison offerte' : discountLabel({ kind: form.kind, value: fields.value })}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-sidebar-muted">{form.title || 'Titre de votre offre'}</p>
              </div>
              <div className="space-y-2.5 p-4 text-sm">
                {form.trigger === 'code' ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2 px-3 py-2">
                    <span className="font-mono text-sm font-semibold tracking-wider text-fg">{fields.code || 'CODE'}</span>
                    <Badge tone="brand" size="sm">Code</Badge>
                  </div>
                ) : (
                  <Badge tone="success" icon={<Zap />}>Appliquée automatiquement</Badge>
                )}
                <ul className="space-y-1 text-xs text-fg-muted">
                  <li>{fields.minSubtotalCents > 0 ? `Dès ${formatEUR(fields.minSubtotalCents, { cents: true })} d’achat` : 'Sans minimum d’achat'}</li>
                  <li>{TARGET_LABELS[form.target]}</li>
                  <li>{fields.perCustomerLimit} utilisation{fields.perCustomerLimit > 1 ? 's' : ''} par client</li>
                </ul>
              </div>
            </div>
            {exampleDiscount !== null && exampleDiscount > 0 && (
              <div className="rounded-xl border border-border bg-surface-2 p-3.5 text-xs leading-5 text-fg-muted">
                Pour un panier de <span className="font-medium text-fg">{formatEUR(example, { cents: true })}</span>, votre client économise{' '}
                <span className="font-medium text-fg">{formatEUR(exampleDiscount, { cents: true })}</span>, à la charge de votre établissement.
              </div>
            )}
            <div className="rounded-xl border border-border p-3.5 text-xs leading-5 text-fg-muted">
              <p className="mb-1 font-medium text-fg">Règles Ciyou Eats</p>
              {promotionRulesText(limits)}
            </div>
          </aside>
        </div>
      </SheetBody>
      <SheetFooter>
        {touched && Object.keys(errors).length > 0 && (
          <p className="mr-auto text-xs text-danger-soft-fg" role="alert">
            Corrigez les champs signalés.
          </p>
        )}
        <Button variant="ghost" onClick={onClose} disabled={save.loading}>
          Annuler
        </Button>
        {canSubmit ? (
          <>
            <Button variant="secondary" loading={save.loading} onClick={() => void handle(false)}>
              Enregistrer le brouillon
            </Button>
            <Button variant="primary" loading={save.loading} onClick={() => void handle(true)}>
              {submitLabel}
            </Button>
          </>
        ) : (
          <Button variant="primary" loading={save.loading} onClick={() => void handle(false)}>
            Enregistrer
          </Button>
        )}
      </SheetFooter>
    </>
  );
}
