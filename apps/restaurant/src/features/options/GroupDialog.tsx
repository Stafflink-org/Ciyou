// Création et modification d'une liste d'options : choix inclus (ordre), règles
// (unique / multiple, obligatoire, minimum, maximum, quantités) et produits liés.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Plus, Search, X } from 'lucide-react';
import { MENU_LIMITS, formatOptionPrice } from '@golink/shared';
import {
  Badge,
  Button,
  cn,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  IconButton,
  Input,
  SegmentedControl,
  Switch,
  toast,
} from '@golink/ui';
import { useAuth } from '@golink/web';
import { errorMessage } from '@/lib/firestore';
import { saveGroup, saveOption, type Group, type MenuProduct, type Option } from '../produits/menu/data';
import { matches, parseEuros } from '../produits/menu/helpers';

export function GroupDialog({
  open,
  onOpenChange,
  restaurantId,
  group,
  options,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  group: Group | null;
  options: Option[];
  products: MenuProduct[];
}) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [multiple, setMultiple] = useState(false);
  const [required, setRequired] = useState(false);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(1);
  const [allowQuantity, setAllowQuantity] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickPrice, setQuickPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setDescription(group?.description ?? '');
    setSelected(group?.optionIds ?? []);
    setMultiple(group?.multiple ?? false);
    setRequired((group?.min ?? 0) > 0);
    setMin(group?.min ?? 0);
    setMax(group?.max ?? 1);
    setAllowQuantity(group?.allowQuantity ?? false);
    setEnabled(group?.enabled ?? true);
    setProductIds(group ? products.filter((p) => p.optionGroupIds.includes(group.id)).map((p) => p.id) : []);
    setFilter('');
    setError(null);
    // Les produits liés ne sont relus qu'à l'ouverture.
  }, [open, group]);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const count = selected.filter((id) => byId.has(id)).length;
  const ceiling = multiple ? Math.max(1, count) : 1;

  // Bornes recalculées à chaque changement (maquette : plafond = nombre d'options en choix multiple, 1 sinon).
  useEffect(() => {
    setMax((current) => Math.max(1, Math.min(multiple ? current : 1, ceiling)));
    setMin((current) => (required ? Math.max(1, Math.min(current, multiple ? ceiling : 1)) : 0));
  }, [ceiling, multiple, required]);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((o) => o !== id) : [...current, id]));
    setError(null);
  }
  function move(index: number, to: number) {
    setSelected((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  async function quickAdd() {
    const cents = parseEuros(quickPrice || '0');
    if (!quickName.trim() || cents === null || !user) return;
    try {
      const id = await saveOption(restaurantId, user.uid, null, { name: quickName.trim().slice(0, MENU_LIMITS.optionName), priceCents: cents, enabled: true, allergens: [] });
      setSelected((current) => [...current, id]);
      setQuickName('');
      setQuickPrice('');
      toast.success('Option créée et ajoutée à la liste');
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const optionIds = selected.filter((id) => byId.has(id));
    if (!name.trim()) return setError('Donnez un nom à cette liste.');
    if (optionIds.length === 0) return setError('Sélectionnez au moins une option à inclure.');
    const cap = multiple ? optionIds.length : 1;
    if (min < 0 || min > cap || max < 1 || max > cap || min > max) {
      return setError(`Choisissez un minimum entre 0 et ${cap}, et un maximum entre 1 et ${cap} (minimum ≤ maximum).`);
    }
    if (!user) return;
    setSaving(true);
    try {
      await saveGroup(
        restaurantId,
        user.uid,
        group?.id ?? null,
        { name: name.trim(), description: description.trim() || null, optionIds, multiple, min, max, allowQuantity: multiple && allowQuantity, enabled },
        { all: products, selected: productIds },
      );
      toast.success(group ? 'Liste modifiée' : 'Liste créée');
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  const available = options.filter((o) => !selected.includes(o.id) && matches(filter, o.name));
  const ruleText = required
    ? multiple
      ? min === max
        ? `Le client choisit exactement ${min} option${min > 1 ? 's' : ''}.`
        : `Le client choisit entre ${min} et ${max} options.`
      : 'Le client doit choisir une option.'
    : multiple
      ? `Facultatif : jusqu’à ${max} option${max > 1 ? 's' : ''}.`
      : 'Facultatif : une option au plus.';

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent size="xl">
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader
            icon={<ClipboardList />}
            title={group ? 'Modifier la liste d’options' : 'Nouvelle liste d’options'}
            description="Regroupez des options et proposez-les avec vos produits (« Sauces au choix », « Cuisson »…)."
          />
          <DialogBody className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Nom de la liste" required>
                <Input
                  autoFocus
                  value={name}
                  maxLength={MENU_LIMITS.groupName}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                  placeholder="Ex. Sauces au choix"
                />
              </FormField>
              <FormField label="Consigne affichée au client" hint="Facultatif.">
                <Input value={description} maxLength={MENU_LIMITS.groupDescription} onChange={(event) => setDescription(event.target.value)} placeholder="Ex. Choisissez votre sauce" />
              </FormField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <section aria-label="Options disponibles" className="flex min-h-0 flex-col rounded-xl border border-border">
                <div className="border-b border-border p-2">
                  <Input size="sm" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Rechercher une option…" leading={<Search />} aria-label="Rechercher une option" />
                </div>
                <ul className="max-h-56 flex-1 space-y-0.5 overflow-y-auto p-1.5">
                  {available.length === 0 && <li className="px-2 py-6 text-center text-xs text-fg-subtle">{options.length === 0 ? 'Créez d’abord une option ci-dessous.' : 'Toutes les options correspondantes sont incluses.'}</li>}
                  {available.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        onClick={() => toggle(option.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Plus className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                        <span className={cn('min-w-0 flex-1 truncate', !option.enabled && 'text-fg-subtle')}>{option.name}</span>
                        {!option.enabled && <Badge size="sm">Inactive</Badge>}
                        <span className="num shrink-0 font-mono text-2xs text-fg-muted">{formatOptionPrice(option.priceCents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 border-t border-border bg-surface-2 p-2">
                  <Input size="sm" value={quickName} onChange={(event) => setQuickName(event.target.value)} placeholder="Nouvelle option" aria-label="Nom de la nouvelle option" className="flex-1" />
                  <Input size="sm" value={quickPrice} onChange={(event) => setQuickPrice(event.target.value)} placeholder="0,00" aria-label="Supplément de la nouvelle option" className="w-20" inputMode="decimal" />
                  <Button type="button" size="sm" variant="secondary" disabled={!quickName.trim()} onClick={() => void quickAdd()}>
                    Créer
                  </Button>
                </div>
              </section>

              <section aria-label="Options incluses" className="flex min-h-0 flex-col rounded-xl border border-border">
                <p className="flex items-center justify-between border-b border-border px-3 py-2.5 text-sm font-medium text-fg">
                  Options incluses <span className="num text-xs font-normal text-fg-subtle">{count} sélectionnée{count > 1 ? 's' : ''}</span>
                </p>
                <ol className="max-h-[17rem] flex-1 space-y-0.5 overflow-y-auto p-1.5">
                  {count === 0 && <li className="px-2 py-8 text-center text-xs text-fg-subtle">Ajoutez des options depuis la liste de gauche.</li>}
                  {selected
                    .filter((id) => byId.has(id))
                    .map((id, index, list) => {
                      const option = byId.get(id)!;
                      return (
                        <li key={id} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
                          <span className="num w-5 text-center font-mono text-2xs text-fg-subtle">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{option.name}</span>
                          <span className="num shrink-0 font-mono text-2xs text-fg-muted">{formatOptionPrice(option.priceCents)}</span>
                          <IconButton label={`Monter ${option.name}`} size="xs" disabled={index === 0} onClick={() => move(selected.indexOf(id), selected.indexOf(list[index - 1]!))}>
                            <ArrowUp />
                          </IconButton>
                          <IconButton label={`Descendre ${option.name}`} size="xs" disabled={index === list.length - 1} onClick={() => move(selected.indexOf(id), selected.indexOf(list[index + 1]!))}>
                            <ArrowDown />
                          </IconButton>
                          <IconButton label={`Retirer ${option.name}`} size="xs" variant="danger" onClick={() => toggle(id)}>
                            <X />
                          </IconButton>
                        </li>
                      );
                    })}
                </ol>
              </section>
            </div>

            <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-4">
                <SegmentedControl
                  aria-label="Type de choix"
                  value={multiple ? 'multiple' : 'single'}
                  onValueChange={(value) => {
                    const next = value === 'multiple';
                    setMultiple(next);
                    // En passant au choix multiple, le maximum propose toutes les options incluses.
                    if (next && !multiple) setMax(Math.max(1, count));
                  }}
                  options={[
                    { value: 'single', label: 'Choix unique' },
                    { value: 'multiple', label: 'Choix multiple' },
                  ]}
                />
                <Switch label="Choix obligatoire" description="Le client ne peut pas commander sans choisir." checked={required} onCheckedChange={setRequired} />
                {multiple && (
                  <Switch
                    label="Autoriser plusieurs fois la même option"
                    description="Ex. 2 × sauce piquante."
                    checked={allowQuantity}
                    onCheckedChange={setAllowQuantity}
                  />
                )}
              </div>
              <div className="flex gap-3 md:flex-col">
                <FormField label="Minimum" className="w-28">
                  <Input type="number" min={required ? 1 : 0} max={multiple ? ceiling : 1} value={min} disabled={!required} onChange={(event) => setMin(Math.max(0, Number(event.target.value) || 0))} />
                </FormField>
                <FormField label="Maximum" className="w-28">
                  <Input type="number" min={1} max={ceiling} value={max} disabled={!multiple} onChange={(event) => setMax(Math.max(1, Number(event.target.value) || 1))} />
                </FormField>
              </div>
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted md:col-span-2">{ruleText}</p>
            </div>

            <FormField label="Produits qui proposent cette liste" hint="Vous pouvez aussi lier les listes depuis la fiche de chaque produit.">
              <Combobox
                multiple
                value={productIds}
                onChange={setProductIds}
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="Aucun produit"
                searchPlaceholder="Rechercher un produit…"
                emptyText="Aucun produit trouvé."
              />
            </FormField>

            <Switch label="Liste active" description="Désactivée, elle n’est plus proposée sur les produits." checked={enabled} onCheckedChange={setEnabled} />

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
              {group ? 'Enregistrer' : 'Créer la liste'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ruleSummary(group: Pick<Group, 'min' | 'max' | 'multiple'>): string {
  if (!group.multiple) return group.min > 0 ? '1 choix obligatoire' : '1 choix au plus';
  if (group.min > 0) return group.min === group.max ? `${group.min} choix obligatoire${group.min > 1 ? 's' : ''}` : `De ${group.min} à ${group.max} choix`;
  return `Jusqu’à ${group.max} choix`;
}
