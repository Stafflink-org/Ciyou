import { useMemo, useState } from 'react';
import { addMonths } from 'date-fns';
import { Gift, Info, Percent, Tag } from 'lucide-react';
import { Button, DatePicker, FormField, Input, RadioGroup, Select, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, Switch, Textarea, formatEUR } from '@golink/ui';
import { checkProductAlcohol, type ProductOfferKind } from '@golink/shared';
import { useActiveRestaurant } from '@/auth/RestaurantAccess';
import { callFunction, useMutation } from '@/lib/firestore';
import { useProducts } from '../produits/menu/data';
import { PRODUCT_OFFER_RULES, type OfferRow } from './lib';

interface SaveResult {
  offerId: string;
}
const saveProductOffer = callFunction<Record<string, unknown>, SaveResult>('saveProductOffer');

interface FormState {
  productId: string;
  kind: ProductOfferKind;
  title: string;
  message: string;
  startDay: Date;
  endDay: Date | undefined;
}

type Errors = Partial<Record<keyof FormState, string>>;

function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function initialState(offer: OfferRow | null): FormState {
  if (!offer) {
    const today = new Date();
    return { productId: '', kind: 'bogo', title: '', message: '', startDay: today, endDay: addMonths(today, 1) };
  }
  return {
    productId: offer.productId,
    kind: offer.kind,
    title: offer.title,
    message: offer.message,
    startDay: new Date(`${offer.startDay}T00:00:00`),
    endDay: offer.endDay ? new Date(`${offer.endDay}T00:00:00`) : undefined,
  };
}

const KIND_OPTIONS: Array<{ value: ProductOfferKind; label: string; description: string; icon: React.ReactNode }> = [
  { value: 'bogo', label: '1 acheté, 1 offert', description: 'La seconde unité du même plat est gratuite.', icon: <Gift /> },
  { value: 'half_second', label: 'Le 2ᵉ à -50 %', description: 'La seconde unité est à moitié prix.', icon: <Percent /> },
];

export interface AnnonceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offer: OfferRow | null;
}

export function AnnonceForm({ open, onOpenChange, offer }: AnnonceFormProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">{open && <AnnonceFormBody key={offer?.id ?? 'new'} offer={offer} onClose={() => onOpenChange(false)} />}</SheetContent>
    </Sheet>
  );
}

function AnnonceFormBody({ offer, onClose }: { offer: OfferRow | null; onClose: () => void }) {
  const restaurant = useActiveRestaurant();
  const { data: products, loading: loadingProducts } = useProducts(restaurant.id);
  const [form, setForm] = useState<FormState>(() => initialState(offer));
  const [touched, setTouched] = useState(false);
  const isNew = !offer;

  const eligibleProducts = useMemo(
    () => products.filter((p) => p.available && (p.stock === null || p.stock === undefined || p.stock > 0) && !checkProductAlcohol(p).blocked),
    [products],
  );
  const productOptions = useMemo(() => {
    const list = eligibleProducts.map((p) => ({ value: p.id, label: p.name }));
    // En édition, le plat choisi peut ne plus être éligible (rendu indisponible depuis) : on le garde affichable.
    if (offer && !list.some((o) => o.value === offer.productId)) list.unshift({ value: offer.productId, label: `${offer.productName} (indisponible)` });
    return list;
  }, [eligibleProducts, offer]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const errors = useMemo<Errors>(() => {
    const e: Errors = {};
    if (!form.productId) e.productId = 'Choisissez un plat.';
    if (form.title.trim().length < PRODUCT_OFFER_RULES.titleMin) e.title = `Au moins ${PRODUCT_OFFER_RULES.titleMin} caractères.`;
    if (form.message.trim().length < PRODUCT_OFFER_RULES.messageMin) e.message = `Au moins ${PRODUCT_OFFER_RULES.messageMin} caractères.`;
    if (form.endDay && form.endDay < form.startDay) e.endDay = 'La fin doit suivre le début.';
    return e;
  }, [form]);
  const visibleErrors: Errors = touched ? errors : {};

  const save = useMutation(
    async () => {
      const base = { productId: form.productId, kind: form.kind, title: form.title.trim(), message: form.message.trim(), startDay: dayOf(form.startDay), endDay: form.endDay ? dayOf(form.endDay) : null };
      return offer
        ? saveProductOffer({ mode: 'edit', restaurantId: restaurant.id, offerId: offer.id, ...base })
        : saveProductOffer({ mode: 'create', restaurantId: restaurant.id, ...base });
    },
    { success: () => (offer ? 'Offre modifiée.' : 'Offre créée.') },
  );

  async function handle() {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    const out = await save.mutate();
    if (out) onClose();
  }

  const chosenProduct = eligibleProducts.find((p) => p.id === form.productId) ?? null;
  const exampleUnit = chosenProduct?.priceCents ?? 1000;
  const exampleDiscount = form.kind === 'bogo' ? exampleUnit : Math.round(exampleUnit / 2);

  return (
    <>
      <SheetHeader icon={<Tag />} title={offer ? 'Modifier l’offre' : 'Nouvelle offre sur un plat'} description={`Une remise automatique financée par ${restaurant.name}, visible sur la fiche de ce plat.`} />
      <SheetBody className="space-y-6 pb-8">
        <FormField label="Plat concerné" required error={visibleErrors.productId} hint="Disponible, en stock, sans alcool.">
          <Select
            value={form.productId}
            disabled={!isNew || loadingProducts}
            placeholder={loadingProducts ? 'Chargement…' : 'Choisissez un plat'}
            onValueChange={(value) => set('productId', value)}
            options={productOptions}
          />
        </FormField>

        <div>
          <p className="mb-2 text-sm font-medium text-fg">Type d’offre</p>
          <RadioGroup
            variant="cards"
            className="sm:grid-cols-2"
            value={form.kind}
            onValueChange={(value) => set('kind', value as ProductOfferKind)}
            options={KIND_OPTIONS}
          />
        </div>

        <FormField label="Titre" required error={visibleErrors.title} aside={`${form.title.length}/${PRODUCT_OFFER_RULES.titleMax}`}>
          <Input maxLength={PRODUCT_OFFER_RULES.titleMax} placeholder="Ex. Le burger, 2e offert !" value={form.title} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <FormField label="Message" required error={visibleErrors.message} aside={`${form.message.length}/${PRODUCT_OFFER_RULES.messageMax}`} hint="Affiché sur la fiche du plat et son onglet Visibilité.">
          <Textarea rows={3} maxLength={PRODUCT_OFFER_RULES.messageMax} placeholder="Ex. Pour toute commande de 2 burgers classiques, le second est offert." value={form.message} onChange={(e) => set('message', e.target.value)} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Début" required>
            <DatePicker value={form.startDay} onChange={(d) => d && set('startDay', d)} disabledDays={isNew ? { before: new Date() } : undefined} />
          </FormField>
          <FormField label="Fin" error={visibleErrors.endDay}>
            <DatePicker value={form.endDay} placeholder="Sans date de fin" onChange={(d) => set('endDay', d)} disabledDays={{ before: form.startDay }} />
          </FormField>
        </div>
        <Switch label="Sans date de fin" checked={!form.endDay} onCheckedChange={(v) => set('endDay', v ? undefined : addMonths(form.startDay, 1))} />

        {chosenProduct && (
          <div className="tone-info flex gap-2.5 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-3.5 text-sm text-(--tone-fg)">
            <Info className="mt-0.5 size-4 shrink-0" />
            <p>
              Pour 2 « {chosenProduct.name} » ({formatEUR(exampleUnit, { cents: true })} l’unité, hors suppléments), votre client économise{' '}
              <span className="font-medium">{formatEUR(exampleDiscount, { cents: true })}</span>, à votre charge.
            </p>
          </div>
        )}
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
        <Button variant="primary" loading={save.loading} onClick={() => void handle()}>
          {offer ? 'Enregistrer' : 'Créer l’offre'}
        </Button>
      </SheetFooter>
    </>
  );
}
