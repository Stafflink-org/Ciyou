// Création et modification d'une option individuelle (supplément, choix).
import { useEffect, useState, type FormEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MENU_LIMITS, type Allergen } from '@golink/shared';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, Switch, toast } from '@golink/ui';
import { useAuth } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import { saveOption, type Option } from '../produits/menu/data';
import { centsToInput, parseEuros } from '../produits/menu/helpers';
import { AllergenPicker } from '../produits/menu/ui';

export function OptionDialog({
  open,
  onOpenChange,
  restaurantId,
  option,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  option: Option | null;
  onSaved?: (id: string) => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(option?.name ?? '');
    setPrice(option ? centsToInput(option.priceCents) : '0');
    setEnabled(option?.enabled ?? true);
    setAllergens(option?.allergens ?? []);
    setError(null);
  }, [open, option]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseEuros(price || '0');
    if (!name.trim() || cents === null || cents > MENU_LIMITS.maxPriceCents) return setError('Indiquez un nom et un prix valide (0 € minimum).');
    if (!user) return;
    setSaving(true);
    try {
      const id = await saveOption(restaurantId, user.uid, option?.id ?? null, { name: name.trim(), priceCents: cents, enabled, allergens });
      toast.success(option ? 'Option modifiée' : 'Option créée');
      onSaved?.(id);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent size="lg">
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader
            icon={<SlidersHorizontal />}
            title={option ? 'Modifier l’option' : 'Nouvelle option'}
            description="Un choix individuel, réutilisable dans plusieurs listes (sauce, cuisson, supplément…)."
          />
          <DialogBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <FormField label="Nom de l’option" required aside={<span className="num text-2xs text-fg-subtle">{name.length}/{MENU_LIMITS.optionName}</span>}>
                <Input
                  autoFocus
                  value={name}
                  maxLength={MENU_LIMITS.optionName}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                  placeholder="Ex. Sauce maison"
                />
              </FormField>
              <FormField label="Supplément" hint="0 = gratuit.">
                <Input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} trailing="€" />
              </FormField>
            </div>
            <Switch label="Option disponible" description="Désactivée, elle n’est plus proposée dans aucune liste." checked={enabled} onCheckedChange={setEnabled} />
            <div>
              <p className="mb-1 text-sm font-medium text-fg">Allergènes de l’option</p>
              <p className="mb-3 text-xs text-fg-subtle">Ajoutés à ceux du produit quand le client choisit cette option.</p>
              <AllergenPicker value={allergens} onChange={setAllergens} />
            </div>
            {error && (
              <p role="alert" className="tone-danger rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {option ? 'Enregistrer' : 'Créer l’option'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
