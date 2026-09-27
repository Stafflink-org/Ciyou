import { useMemo, type ReactNode } from 'react';
import { collection, query } from 'firebase/firestore';
import { Croissant, Flower2, Info, Leaf, Pill, ShoppingBasket, Store, Utensils, Wheat } from 'lucide-react';
import { Button, Checkbox, Combobox, FormField, Input, SegmentedControl, Textarea, cn } from '@golink/ui';
import {
  COLLECTIONS,
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  RESTAURANT_LABELS,
  type CuisineCategory,
  type MerchantType,
  type RestaurantLabelKey,
} from '@golink/shared';
import { Link } from 'react-router';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { db } from '@/lib/firebase';
import { useCollection, useMutation } from '@/lib/firestore';
import { updateRestaurantSettings, type ProfileInput } from '../parametres/kit/api';
import { useDraft, useUnsavedGuard } from '../parametres/kit/hooks';
import { ChipsInput } from '../parametres/kit/inputs';
import { Notice, SaveBar, SettingsCard, SplitLayout } from '../parametres/kit/ui';
import { RestaurantPreview } from './RestaurantPreview';

type Draft = Omit<ProfileInput, 'section'> & { name: string; merchantType: MerchantType };

const PRICE_OPTIONS = [
  { value: '1', label: '€' },
  { value: '2', label: '€€' },
  { value: '3', label: '€€€' },
  { value: '4', label: '€€€€' },
];

const MERCHANT_TYPE_ICONS: Record<MerchantType, ReactNode> = {
  restaurant: <Utensils />,
  grocery: <ShoppingBasket />,
  bakery: <Croissant />,
  florist: <Flower2 />,
  pharmacy: <Pill />,
  other: <Store />,
};

/** Commerces où les allergènes/régimes ont un sens (alimentaire). */
const FOOD_MERCHANT_TYPES: MerchantType[] = ['restaurant', 'grocery', 'bakery'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 .()-]{6,20}$/;

export function ProfileTab({ active }: { active: boolean }) {
  const { restaurant, restaurantId, member } = useRestaurantAccess();
  const can = useCan();
  const isOwner = member.role === 'owner';
  const cuisines = useCollection<CuisineCategory>(query(collection(db, COLLECTIONS.cuisineCategories)));

  const source = useMemo<Draft>(
    () => ({
      name: restaurant.name,
      description: restaurant.description ?? '',
      phone: restaurant.phone ?? '',
      email: restaurant.email ?? '',
      merchantType: restaurant.merchantType ?? 'restaurant',
      cuisineIds: restaurant.cuisineIds ?? [],
      tags: restaurant.tags ?? [],
      priceLevel: restaurant.priceLevel ?? 2,
      labels: restaurant.labels ?? [],
      allergenNotice: restaurant.allergenNotice ?? '',
    }),
    [restaurant],
  );
  const { draft, setDraft, dirty, reset, markSaved } = useDraft<Draft>(source, restaurantId);
  useUnsavedGuard(dirty);
  const save = useMutation(updateRestaurantSettings, { success: 'Profil enregistré.' });

  const cuisineOptions = useMemo(
    () =>
      cuisines.data
        .filter((c) => c.active !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((c) => ({ value: c.id, label: c.name.fr })),
    [cuisines.data],
  );

  if (!draft) return null;

  const isFood = FOOD_MERCHANT_TYPES.includes(draft.merchantType);
  // « Plat » ne s'applique qu'aux restaurants ; les autres commerces vendent des « produits ».
  const itemWord = draft.merchantType === 'restaurant' ? 'plat' : 'produit';
  const categoryWord = draft.merchantType === 'restaurant' ? 'cuisine' : 'catégorie';

  const errors = {
    name: draft.name.trim().length < 2 ? 'Deux caractères au minimum.' : null,
    phone: !PHONE.test(draft.phone.trim()) ? 'Numéro invalide.' : null,
    email: !EMAIL.test(draft.email.trim()) ? 'Adresse e-mail invalide.' : null,
    cuisineIds: draft.cuisineIds.length === 0 ? `Choisissez au moins une ${categoryWord}.` : draft.cuisineIds.length > 3 ? `Trois ${categoryWord}s au plus.` : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const onSave = async () => {
    const result = await save.mutate({
      restaurantId,
      section: 'profile',
      ...(isOwner ? { name: draft.name.trim() } : {}),
      description: draft.description?.trim() || null,
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      merchantType: draft.merchantType,
      cuisineIds: draft.cuisineIds,
      tags: draft.tags,
      priceLevel: draft.priceLevel,
      labels: draft.labels,
      allergenNotice: draft.allergenNotice?.trim() || null,
    });
    if (result) markSaved();
  };

  const toggleLabel = (key: RestaurantLabelKey, on: boolean) =>
    setDraft((d) => ({ ...d, labels: on ? [...d.labels, key] : d.labels.filter((l) => l !== key) }));

  return (
    <>
      <SplitLayout
        aside={
          <div className="space-y-3">
            <p className="eyebrow">Aperçu dans l’app client</p>
            <RestaurantPreview
              name={draft.name}
              description={draft.description ?? ''}
              cuisines={draft.cuisineIds.map((id) => cuisineOptions.find((o) => o.value === id)?.label ?? id)}
              priceLevel={draft.priceLevel}
              labels={draft.labels}
              logo={restaurant.logo?.url ?? null}
              cover={restaurant.cover?.url ?? null}
              mark={restaurant.mark}
              accent={restaurant.accent}
              rating={restaurant.rating}
              eta={restaurant.etaMinutes}
            />
          </div>
        }
      >
        <SettingsCard icon={<Store />} title="Identité" description="Nom, présentation et coordonnées affichés sur votre fiche.">
          <div className="grid gap-5">
            <FormField label="Type de commerce" hint="Adapte le vocabulaire de votre carte et vos catégories dans l’app client.">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {MERCHANT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={draft.merchantType === type}
                    onClick={() => setDraft({ merchantType: type })}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-colors [&_svg]:size-5',
                      draft.merchantType === type
                        ? 'border-primary bg-primary-soft text-primary-soft-fg'
                        : 'border-border text-fg-muted hover:bg-surface-2',
                    )}
                  >
                    {MERCHANT_TYPE_ICONS[type]}
                    {MERCHANT_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField
              label="Nom de l’établissement"
              required
              error={errors.name}
              hint={isOwner ? 'Un changement de nom est visible immédiatement par vos clients.' : 'Seul le propriétaire peut modifier le nom.'}
            >
              <Input value={draft.name} maxLength={60} disabled={!isOwner} onChange={(e) => setDraft({ name: e.target.value })} />
            </FormField>
            <FormField
              label="Présentation"
              hint="Votre histoire, vos spécialités, ce qui vous rend unique."
              aside={<span className="num">{(draft.description ?? '').length} / 600</span>}
            >
              <Textarea
                rows={4}
                maxLength={600}
                value={draft.description ?? ''}
                placeholder="Ex. Cuisine levantine généreuse, mezzés maison et grillades au charbon depuis 2019."
                onChange={(e) => setDraft({ description: e.target.value })}
              />
            </FormField>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Téléphone" required error={errors.phone} hint="Utilisé par le support et les livreurs.">
                <Input value={draft.phone} inputMode="tel" autoComplete="tel" onChange={(e) => setDraft({ phone: e.target.value })} />
              </FormField>
              <FormField label="E-mail de contact" required error={errors.email}>
                <Input value={draft.email} type="email" autoComplete="email" onChange={(e) => setDraft({ email: e.target.value })} />
              </FormField>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          icon={<Leaf />}
          title={isFood ? 'Cuisine et positionnement' : 'Catégories et positionnement'}
          description="Aidez vos clients à vous trouver dans les recherches et les catégories."
        >
          <div className="grid gap-5">
            <FormField
              label={isFood ? 'Cuisines' : 'Catégories'}
              required
              error={errors.cuisineIds}
              hint={`Trois au plus, la première est mise en avant.`}
            >
              <Combobox
                multiple
                options={cuisineOptions}
                value={draft.cuisineIds}
                onChange={(value: string[]) => setDraft({ cuisineIds: value.slice(0, 3) })}
                placeholder={cuisines.loading ? 'Chargement…' : `Choisir les ${categoryWord}s`}
                searchPlaceholder={`Rechercher une ${categoryWord}…`}
              />
            </FormField>
            <FormField label="Mots-clés" hint="Six au plus. Entrée ou virgule pour valider (ex. « Grillades », « Brunch »).">
              <ChipsInput
                values={draft.tags}
                max={6}
                placeholder="Ajouter un mot-clé"
                validate={(v) => (v.length > 24 ? '24 caractères au plus.' : null)}
                onChange={(tags) => setDraft({ tags })}
              />
            </FormField>
            <FormField label="Gamme de prix" hint="Indication du ticket moyen, visible dans l’app.">
              <SegmentedControl
                aria-label="Gamme de prix"
                value={String(draft.priceLevel)}
                onValueChange={(v) => setDraft({ priceLevel: Number(v) as 1 | 2 | 3 | 4 })}
                options={PRICE_OPTIONS}
              />
            </FormField>
          </div>
        </SettingsCard>

        {isFood && (
        <SettingsCard
          id="allergenes"
          icon={<Wheat />}
          title="Allergènes et mentions"
          description="Informations réglementaires et engagements affichés sur votre fiche."
        >
          <div className="grid gap-5">
            <div>
              <p className="text-sm font-medium text-fg">Mentions</p>
              <p className="mt-0.5 text-xs text-fg-subtle">Affichées sous forme de badges. N’indiquez que ce que vous pouvez justifier.</p>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(RESTAURANT_LABELS) as RestaurantLabelKey[]).map((key) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm transition-colors hover:border-border-strong has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-soft/40"
                  >
                    <Checkbox checked={draft.labels.includes(key)} onCheckedChange={(v) => toggleLabel(key, v === true)} aria-label={RESTAURANT_LABELS[key]} />
                    <span className="font-medium text-fg">{RESTAURANT_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>
            <FormField
              label="Mention allergènes de l’établissement"
              hint={`Ex. « Nos ${itemWord}s sont préparés dans un espace où sont manipulés fruits à coque et sésame. »`}
              aside={<span className="num">{(draft.allergenNotice ?? '').length} / 400</span>}
            >
              <Textarea rows={3} maxLength={400} value={draft.allergenNotice ?? ''} onChange={(e) => setDraft({ allergenNotice: e.target.value })} />
            </FormField>
            <Notice
              tone={restaurant.allergensComplete ? 'success' : 'amber'}
              icon={<Info />}
              title={restaurant.allergensComplete ? 'Allergènes renseignés sur toute la carte' : 'Allergènes incomplets sur la carte'}
              action={
                can('menu.edit') ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/produits">Ouvrir la carte</Link>
                  </Button>
                ) : undefined
              }
            >
              Les 14 allergènes réglementaires se déclarent {itemWord} par {itemWord}, dans la carte. Ils sont affichés au client avant la commande.
            </Notice>
          </div>
        </SettingsCard>
        )}
      </SplitLayout>

      {active && (
        <SaveBar
          dirty={dirty}
          saving={save.loading}
          disabled={invalid}
          message={invalid ? 'Corrigez les champs signalés' : 'Modifications du profil non enregistrées'}
          onSave={() => void onSave()}
          onReset={reset}
        />
      )}
    </>
  );
}
