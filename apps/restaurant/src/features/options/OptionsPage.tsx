// Options & listes : options individuelles (suppléments, choix) PUIS listes
// d'options rattachées aux produits, en sections repliables empilées sur la
// même page (alignées sur la maquette de référence), avec recherche, cartes
// compactes, activation, sélection multiple et corbeille.
import { useMemo, useState } from 'react';
import { ChevronDown, ClipboardList, Copy, ListChecks, MoreHorizontal, Pencil, Plus, Search, Square, SquareCheck, SquareSlash, Trash2, X } from 'lucide-react';
import { ALLERGEN_LABELS, MENU_LIMITS, formatOptionPrice } from '@golink/shared';
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  PageBanner,
  PageContainer,
  Skeleton,
  Switch,
  toast,
  Tooltip,
} from '@golink/ui';
import { useAuth, useDocumentTitle, usePersistentState } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { TrashSheet } from '../produits/components/TrashSheet';
import {
  menuFunctions,
  saveGroup,
  setGroupEnabled,
  setOptionsEnabled,
  useOptionGroups,
  useOptions,
  useProducts,
  type Group,
  type Option,
} from '../produits/menu/data';
import { matches, plural } from '../produits/menu/helpers';
import { GroupDialog, ruleSummary } from './GroupDialog';
import { OptionDialog } from './OptionDialog';

/** En-tête repliable d'une section, avec compteur (style maquette de référence). */
function SectionHeader({
  icon,
  title,
  count,
  open,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  count: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-card transition-colors hover:border-border-strong"
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-4">{icon}</span>
        <span className="min-w-0">
          <span className="block font-display text-md font-semibold tracking-tight text-fg">{title}</span>
          <span className="block text-xs text-fg-subtle">{count}</span>
        </span>
      </span>
      <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} />
    </button>
  );
}

export function OptionsPage() {
  useDocumentTitle('Options & listes · Ciyou Eats Restaurant');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const canEdit = useCan()('menu.edit');

  const optionsState = useOptions(restaurantId);
  const groupsState = useOptionGroups(restaurantId);
  const productsState = useProducts(restaurantId);
  const options = optionsState.data;
  const groups = groupsState.data;
  const products = productsState.data;
  const loading = optionsState.loading || groupsState.loading;
  const error = optionsState.error ?? groupsState.error;

  const [openSections, setOpenSections] = usePersistentState<{ options: boolean; groups: boolean }>(
    'golink:restaurant:carte-options-sections',
    { options: true, groups: true },
  );
  const [search, setSearch] = useState('');
  const [optionDialog, setOptionDialog] = useState<{ open: boolean; option: Option | null }>({ open: false, option: null });
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group: Group | null }>({ open: false, group: null });
  const [deleting, setDeleting] = useState<{ kind: 'option' | 'optionGroup'; ids: string[]; label: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const groupsByOption = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const group of groups) for (const id of group.optionIds) map.set(id, [...(map.get(id) ?? []), group]);
    return map;
  }, [groups]);
  const productsByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) for (const id of product.optionGroupIds) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [products]);

  const visibleGroups = groups.filter((g) => matches(search, g.name, g.description, ...g.optionIds.map((id) => optionById.get(id)?.name)));
  const visibleOptions = options.filter((o) => matches(search, o.name));

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  }

  async function duplicateGroup(group: Group) {
    const taken = new Set(groups.map((g) => g.name.toLowerCase()));
    let name = `${group.name.slice(0, MENU_LIMITS.groupName - 9)} (copie)`;
    for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${group.name.slice(0, MENU_LIMITS.groupName - 12)} (copie ${i})`;
    await run(
      () => saveGroup(restaurantId, uid, null, { name, description: group.description ?? null, optionIds: group.optionIds, multiple: group.multiple, min: group.min, max: group.max, allowQuantity: group.allowQuantity, enabled: false }),
      `« ${name} » créée, désactivée le temps de la relire`,
    );
  }

  function toggleSelected(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  function exitSelection() {
    setSelecting(false);
    setSelected([]);
  }

  const activeOptions = options.filter((o) => o.enabled).length;
  const activeGroups = groups.filter((g) => g.enabled).length;

  return (
    <PageContainer>
      <PageBanner
        eyebrow={`${restaurant.name} · Personnalisation`}
        title="Options & listes"
        description="Construisez les choix de votre carte. Créez les options, puis rassemblez-les en listes pour vos produits."
        actions={
          canEdit && (
            <>
              <IconButton
                label="Corbeille des options"
                variant="secondary"
                className="border-sidebar-fg/25 bg-sidebar-fg/10 text-sidebar-fg hover:border-sidebar-fg/40 hover:bg-sidebar-fg/15"
                onClick={() => setTrashOpen(true)}
              >
                <Trash2 />
              </IconButton>
              <Button
                variant="secondary"
                className="border-sidebar-fg/25 bg-sidebar-fg/10 text-sidebar-fg hover:border-sidebar-fg/40 hover:bg-sidebar-fg/15"
                leftIcon={<Plus />}
                onClick={() => setOptionDialog({ open: true, option: null })}
              >
                Nouvelle option
              </Button>
              <Button variant="primary" leftIcon={<ClipboardList />} onClick={() => setGroupDialog({ open: true, group: null })}>
                Nouvelle liste
              </Button>
            </>
          )
        }
      />

      {error ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={<ListChecks />} title="Impossible de charger les options" description={errorMessage(error)} />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une option ou une liste…"
              aria-label="Rechercher une option ou une liste"
              leading={<Search />}
              trailing={
                search ? (
                  <button type="button" aria-label="Effacer la recherche" onClick={() => setSearch('')} className="rounded p-0.5 hover:text-fg">
                    <X />
                  </button>
                ) : undefined
              }
              className="sm:w-80"
            />
          </div>

          {/* ------------------------------------------------- Options individuelles */}
          <section>
            <SectionHeader
              icon={<ListChecks />}
              title="Options individuelles"
              count={loading ? '…' : `${plural(options.length, 'option créée', 'options créées')} · ${plural(activeOptions, 'active', 'actives')}`}
              open={openSections.options}
              onToggle={() => setOpenSections({ ...openSections, options: !openSections.options })}
            />
            {openSections.options && (
              <div className="mt-3">
                {canEdit && options.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <Button size="sm" variant={selecting ? 'secondary' : 'ghost'} leftIcon={selecting ? <SquareSlash /> : <SquareCheck />} onClick={() => (selecting ? exitSelection() : setSelecting(true))}>
                      {selecting ? 'Annuler la sélection' : 'Sélectionner'}
                    </Button>
                    {selecting && selected.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-fg-muted">{plural(selected.length, 'sélectionnée', 'sélectionnées')}</span>
                        <Button size="sm" variant="secondary" onClick={() => void run(() => setOptionsEnabled(restaurantId, uid, selected, true), `${plural(selected.length, 'option activée', 'options activées')}`).then(exitSelection)}>
                          Activer
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => void run(() => setOptionsEnabled(restaurantId, uid, selected, false), `${plural(selected.length, 'option désactivée', 'options désactivées')}`).then(exitSelection)}>
                          Désactiver
                        </Button>
                        <Button size="sm" variant="danger-soft" leftIcon={<Trash2 />} onClick={() => { setDeleting({ kind: 'option', ids: selected, label: plural(selected.length, 'option', 'options') }); exitSelection(); }}>
                          Supprimer
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {loading ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="h-28 rounded-xl" />
                    ))}
                  </div>
                ) : visibleOptions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border-strong bg-surface">
                    <EmptyState
                      compact
                      icon={<ListChecks />}
                      title={search ? 'Aucune option ne correspond' : 'Aucune option pour le moment'}
                      description={search ? 'Essayez un autre nom.' : 'Ajoutez votre premier choix : sauce, cuisson, supplément…'}
                      action={
                        canEdit && !search ? (
                          <Button variant="primary" leftIcon={<Plus />} onClick={() => setOptionDialog({ open: true, option: null })}>
                            Nouvelle option
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {canEdit && (
                      <li>
                        <button
                          type="button"
                          onClick={() => setOptionDialog({ open: true, option: null })}
                          className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-fg-subtle transition-colors hover:border-primary hover:text-primary-soft-fg"
                        >
                          <Plus className="size-5" />
                          <span className="text-xs font-medium">Ajouter une option</span>
                        </button>
                      </li>
                    )}
                    {visibleOptions.map((option) => {
                      const isSelected = selected.includes(option.id);
                      return (
                        <li key={option.id} className={cn('relative flex min-w-0 flex-col gap-2 rounded-xl border bg-surface p-3.5 shadow-card', !option.enabled && 'bg-surface-2', isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-border')}>
                          <div className="flex items-start justify-between gap-2">
                            {selecting ? (
                              <button type="button" onClick={() => toggleSelected(option.id)} className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-subtle" aria-pressed={isSelected} aria-label={isSelected ? `Désélectionner ${option.name}` : `Sélectionner ${option.name}`}>
                                {isSelected ? <SquareCheck className="size-4.5 text-primary" /> : <Square className="size-4.5" />}
                              </button>
                            ) : (
                              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
                                <ListChecks className="size-4" />
                              </span>
                            )}
                            {canEdit && !selecting && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <IconButton label={`Actions pour ${option.name}`} variant="ghost" size="sm">
                                    <MoreHorizontal />
                                  </IconButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem icon={<Pencil />} onSelect={() => setOptionDialog({ open: true, option })}>
                                    Modifier
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting({ kind: 'option', ids: [option.id], label: `« ${option.name} »` })}>
                                    Supprimer
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                          <button type="button" disabled={!canEdit || selecting} onClick={() => setOptionDialog({ open: true, option })} className={cn('min-w-0 text-left', canEdit && !selecting && 'hover:text-primary-soft-fg')}>
                            <p className={cn('truncate text-sm font-semibold', option.enabled ? 'text-fg' : 'text-fg-muted')}>{option.name}</p>
                            {option.allergens.length > 0 && <p className="truncate text-2xs text-fg-subtle">Allergènes : {option.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')}</p>}
                          </button>
                          <p className={cn('num font-mono text-sm', option.priceCents ? 'text-fg' : 'text-fg-muted')}>{formatOptionPrice(option.priceCents)}</p>
                          {(groupsByOption.get(option.id) ?? []).length > 0 && (
                            <p className="truncate text-2xs text-fg-subtle">Dans {plural((groupsByOption.get(option.id) ?? []).length, 'liste')}</p>
                          )}
                          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
                            <span className="text-2xs text-fg-subtle">{option.enabled ? 'Active' : 'Désactivée'}</span>
                            <Switch
                              size="sm"
                              aria-label={option.enabled ? `Désactiver ${option.name}` : `Activer ${option.name}`}
                              checked={option.enabled}
                              disabled={!canEdit}
                              onCheckedChange={(value) => void run(() => setOptionsEnabled(restaurantId, uid, [option.id], value), value ? 'Option disponible' : 'Option désactivée')}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* ------------------------------------------------------- Listes d'options */}
          <section>
            <SectionHeader
              icon={<ClipboardList />}
              title="Listes d’options"
              count={loading ? '…' : `${plural(groups.length, 'liste créée', 'listes créées')} · ${plural(activeGroups, 'active', 'actives')}`}
              open={openSections.groups}
              onToggle={() => setOpenSections({ ...openSections, groups: !openSections.groups })}
            />
            {openSections.groups && (
              <div className="mt-3">
                {loading ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 3 }, (_, i) => (
                      <Skeleton key={i} className="h-48 rounded-xl" />
                    ))}
                  </div>
                ) : visibleGroups.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border-strong bg-surface">
                    <EmptyState
                      icon={<ClipboardList />}
                      title={search ? 'Aucune liste ne correspond' : 'Aucune liste d’options'}
                      description={search ? 'Essayez un autre nom de liste ou d’option.' : 'Regroupez vos options (« Sauces au choix », « Cuisson »…) pour les proposer avec vos produits.'}
                      action={
                        search ? (
                          <Button variant="secondary" onClick={() => setSearch('')}>
                            Effacer la recherche
                          </Button>
                        ) : canEdit ? (
                          <Button variant="primary" leftIcon={<Plus />} onClick={() => setGroupDialog({ open: true, group: null })}>
                            Créer une liste
                          </Button>
                        ) : undefined
                      }
                    />
                  </div>
                ) : (
                  <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleGroups.map((group) => {
                      const included = group.optionIds.map((id) => optionById.get(id)).filter((o): o is Option => Boolean(o));
                      const usage = productsByGroup.get(group.id) ?? 0;
                      return (
                        <li key={group.id} className={cn('flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-card', !group.enabled && 'bg-surface-2')}>
                          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setGroupDialog({ open: true, group })}
                                className={cn('block max-w-full truncate text-left font-display text-md font-semibold tracking-tight', group.enabled ? 'text-fg' : 'text-fg-muted', canEdit && 'hover:text-primary-soft-fg')}
                              >
                                {group.name}
                              </button>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge tone={group.min > 0 ? 'brand' : 'neutral'} size="sm">
                                  {group.min > 0 ? 'Obligatoire' : 'Facultatif'}
                                </Badge>
                                <Badge tone="info" size="sm">
                                  {ruleSummary(group)}
                                </Badge>
                                {group.allowQuantity && <Badge size="sm">Quantités</Badge>}
                              </div>
                            </div>
                            <Tooltip content={group.enabled ? 'Liste proposée aux clients' : 'Liste désactivée'} disabled={!canEdit}>
                              <span className="inline-flex">
                                <Switch
                                  aria-label={group.enabled ? `Désactiver la liste ${group.name}` : `Activer la liste ${group.name}`}
                                  checked={group.enabled}
                                  disabled={!canEdit}
                                  onCheckedChange={(value) => void run(() => setGroupEnabled(restaurantId, uid, group.id, value), value ? 'Liste activée' : 'Liste désactivée')}
                                />
                              </span>
                            </Tooltip>
                          </div>
                          <ul className="flex-1 space-y-1 px-4 py-3">
                            {included.slice(0, 4).map((option) => (
                              <li key={option.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className={cn('truncate', option.enabled ? 'text-fg' : 'text-fg-subtle line-through')}>{option.name}</span>
                                <span className="num shrink-0 font-mono text-xs text-fg-muted">{formatOptionPrice(option.priceCents)}</span>
                              </li>
                            ))}
                            {included.length > 4 && <li className="text-xs text-fg-subtle">+ {plural(included.length - 4, 'autre option', 'autres options')}</li>}
                            {included.length === 0 && <li className="text-xs italic text-fg-subtle">Aucune option incluse</li>}
                          </ul>
                          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                            <span className="text-xs text-fg-subtle">{usage ? `Proposée sur ${plural(usage, 'produit')}` : 'Liée à aucun produit'}</span>
                            {canEdit && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <IconButton label={`Actions pour la liste ${group.name}`} variant="ghost" size="sm">
                                    <MoreHorizontal />
                                  </IconButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem icon={<Pencil />} onSelect={() => setGroupDialog({ open: true, group })}>
                                    Modifier
                                  </DropdownMenuItem>
                                  <DropdownMenuItem icon={<Copy />} onSelect={() => void duplicateGroup(group)}>
                                    Dupliquer
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting({ kind: 'optionGroup', ids: [group.id], label: `la liste « ${group.name} »` })}>
                                    Supprimer
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <OptionDialog open={optionDialog.open} onOpenChange={(open) => setOptionDialog((c) => ({ ...c, open }))} restaurantId={restaurantId} option={optionDialog.option} />
      <GroupDialog open={groupDialog.open} onOpenChange={(open) => setGroupDialog((c) => ({ ...c, open }))} restaurantId={restaurantId} group={groupDialog.group} options={options} products={products} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        title={`Supprimer ${deleting?.label ?? ''} ?`}
        description={
          deleting?.kind === 'option'
            ? 'Retirée des listes qui l’utilisent (bornes réajustées). Restaurable depuis la corbeille pendant le délai réglé par la plateforme.'
            : 'Retirée des produits qui la proposent ; les options restent disponibles. Restaurable depuis la corbeille pendant le délai réglé par la plateforme.'
        }
        confirmLabel="Supprimer"
        onConfirm={async () => {
          if (!deleting) return;
          await run(() => menuFunctions.trashMenuItems({ restaurantId, kind: deleting.kind, ids: deleting.ids }), deleting.kind === 'option' ? 'Option placée dans la corbeille' : 'Liste placée dans la corbeille');
        }}
      />
      <TrashSheet open={trashOpen} onOpenChange={setTrashOpen} restaurantId={restaurantId} kinds={['option', 'optionGroup']} />
    </PageContainer>
  );
}
