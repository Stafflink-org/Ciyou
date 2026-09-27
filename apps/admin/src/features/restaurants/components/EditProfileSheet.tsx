// Modification de la fiche d'un commerce par l'équipe (nom, type, coordonnées,
// cuisine, zones, modes de service). Motif obligatoire, historique dans l'audit.
import { useMemo, useState } from 'react';
import { orderBy, query, where } from 'firebase/firestore';
import {
  Button,
  Checkbox,
  Combobox,
  FormField,
  Input,
  RadioGroup,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Textarea,
} from '@golink/ui';
import {
  COLLECTIONS,
  CURRENCY_CODES,
  CURRENCY_LABELS,
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  resolveRestaurantCurrency,
  type CurrencyCode,
  type CuisineCategory,
  type MerchantType,
  type Restaurant,
  type WithId,
  type Zone,
} from '@golink/shared';
import { collectionAt, useCollection, useMutation } from '@/lib/firestore';
import { adminUpdateRestaurant } from '../lib';

const MODES = [
  { value: 'delivery', label: 'Livraison' },
  { value: 'pickup', label: 'Retrait' },
  { value: 'dine_in', label: 'Sur place' },
] as const;

export function EditProfileSheet({ restaurant, open, onOpenChange }: { restaurant: WithId<Restaurant>; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState(() => ({
    name: restaurant.name,
    merchantType: (restaurant.merchantType ?? 'restaurant') as MerchantType,
    description: restaurant.description ?? '',
    phone: restaurant.phone ?? '',
    email: restaurant.email ?? '',
    cuisineIds: restaurant.cuisineIds,
    tags: restaurant.tags.join(', '),
    priceLevel: String(restaurant.priceLevel),
    zoneIds: restaurant.zoneIds,
    fulfillmentModes: restaurant.fulfillmentModes as string[],
    deliveredBy: restaurant.deliveredBy,
    line1: restaurant.address.line1,
    line2: restaurant.address.line2 ?? '',
    postalCode: restaurant.address.postalCode,
    city: restaurant.address.city,
    currency: resolveRestaurantCurrency(restaurant, null, restaurant.countryId) as CurrencyCode,
  }));
  const [reason, setReason] = useState('');
  const cuisines = useCollection<CuisineCategory>(useMemo(() => query(collectionAt(COLLECTIONS.cuisineCategories), orderBy('order')), []));
  const zones = useCollection<Zone>(useMemo(() => query(collectionAt(COLLECTIONS.zones), where('cityId', '==', restaurant.cityId)), [restaurant.cityId]));
  const save = useMutation(adminUpdateRestaurant, { success: (r) => (r.changed.length ? 'Fiche mise à jour' : 'Aucune modification') });
  const set = (key: keyof typeof form) => (value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    const result = await save.mutate({
      restaurantId: restaurant.id,
      name: form.name.trim(),
      merchantType: form.merchantType,
      description: form.description.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      cuisineIds: form.cuisineIds,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12),
      priceLevel: Number(form.priceLevel),
      zoneIds: form.zoneIds,
      fulfillmentModes: form.fulfillmentModes,
      deliveredBy: form.deliveredBy,
      address: { line1: form.line1.trim(), line2: form.line2.trim() || null, postalCode: form.postalCode.trim(), city: form.city.trim() },
      currency: form.currency,
      reason: reason.trim(),
    });
    if (result) {
      setReason('');
      onOpenChange(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !save.loading && onOpenChange(o)}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader title="Modifier la fiche" description="Les visuels, horaires et la carte restent gérés par le restaurant." />
        <SheetBody className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nom commercial" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set('name')(e.target.value)} maxLength={80} />
            </FormField>
            <FormField label="Type de commerce">
              <Select value={form.merchantType} onValueChange={set('merchantType')} options={MERCHANT_TYPES.map((t) => ({ value: t, label: MERCHANT_TYPE_LABELS[t] }))} />
            </FormField>
            <FormField label="Gamme de prix">
              <Select value={form.priceLevel} onValueChange={set('priceLevel')} options={['1', '2', '3', '4'].map((v) => ({ value: v, label: '€'.repeat(Number(v)) }))} />
            </FormField>
            <FormField label="Devise du compte" required hint="Utilisée pour le formatage des montants affichés à ce commerce.">
              <Select value={form.currency} onValueChange={set('currency')} options={CURRENCY_CODES.map((c) => ({ value: c, label: `${CURRENCY_LABELS[c]} (${c})` }))} />
            </FormField>
            <FormField label="Description" className="sm:col-span-2">
              <Textarea value={form.description} onChange={(e) => set('description')(e.target.value)} rows={3} maxLength={1000} />
            </FormField>
            <FormField label="Téléphone">
              <Input value={form.phone} onChange={(e) => set('phone')(e.target.value)} type="tel" />
            </FormField>
            <FormField label="E-mail">
              <Input value={form.email} onChange={(e) => set('email')(e.target.value)} type="email" />
            </FormField>
            <FormField label="Adresse" className="sm:col-span-2">
              <Input value={form.line1} onChange={(e) => set('line1')(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Complément" className="sm:col-span-2">
              <Input value={form.line2} onChange={(e) => set('line2')(e.target.value)} maxLength={120} />
            </FormField>
            <FormField label="Code postal">
              <Input value={form.postalCode} onChange={(e) => set('postalCode')(e.target.value)} maxLength={10} />
            </FormField>
            <FormField label="Ville">
              <Input value={form.city} onChange={(e) => set('city')(e.target.value)} maxLength={80} />
            </FormField>
            <FormField label="Catégories de cuisine" className="sm:col-span-2">
              <Combobox
                multiple
                value={form.cuisineIds}
                onChange={(v: string[]) => set('cuisineIds')(v.slice(0, 8))}
                placeholder="Choisir des catégories"
                options={cuisines.data.map((c) => ({ value: c.id, label: c.name.fr }))}
              />
            </FormField>
            <FormField label="Étiquettes" hint="Séparées par des virgules (fait maison, halal…)." className="sm:col-span-2">
              <Input value={form.tags} onChange={(e) => set('tags')(e.target.value)} />
            </FormField>
            <FormField label="Zones de livraison Ciyou Eats" className="sm:col-span-2">
              <Combobox multiple value={form.zoneIds} onChange={(v: string[]) => set('zoneIds')(v)} placeholder="Aucune zone" options={zones.data.map((z) => ({ value: z.id, label: z.name }))} />
            </FormField>
          </div>

          <FormField label="Modes de service">
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => (
                <label key={mode.value} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-fg">
                  <Checkbox
                    checked={form.fulfillmentModes.includes(mode.value)}
                    onCheckedChange={(v) =>
                      set('fulfillmentModes')(v === true ? [...form.fulfillmentModes, mode.value] : form.fulfillmentModes.filter((m) => m !== mode.value))
                    }
                    aria-label={mode.label}
                  />
                  {mode.label}
                </label>
              ))}
            </div>
          </FormField>
          <FormField label="Qui livre ?" hint="Les espèces ne sont possibles qu’avec les livreurs salariés du commerce.">
            <RadioGroup
              variant="cards"
              className="sm:grid-cols-3"
              value={form.deliveredBy}
              onValueChange={set('deliveredBy')}
              options={[
                { value: 'platform', label: 'Livreurs Ciyou Eats' },
                { value: 'restaurant', label: 'Ses livreurs' },
                { value: 'both', label: 'Les deux' },
              ]}
            />
          </FormField>
          <FormField label="Motif de la modification" required hint="Conservé dans l’historique de la fiche.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </FormField>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={reason.trim().length < 3 || form.name.trim().length < 2 || form.fulfillmentModes.length === 0} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
