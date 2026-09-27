// Super admin §5 : groupes et chaînes (un propriétaire, plusieurs établissements),
// conditions communes, facturation consolidée et statistiques consolidées.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { limit, query } from 'firebase/firestore';
import { Building2, Network, NotebookPen, Pencil, Plus, Store } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  Skeleton,
  StatCard,
  Switch,
  Textarea,
  formatNumber,
} from '@golink/ui';
import { COLLECTIONS, paths, type RestaurantGroup, type UserProfile, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { collectionAt, docAt, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { NotesPanel } from '../acteurs-commun/NotesPanel';
import { ErrorPanel, Facts, ScoreRing, bpsLabel, eur, plural } from '../acteurs-commun/ui';
import { RestaurantIdentity, RestaurantMark } from './components/RestaurantIdentity';
import { RestaurantsNav } from './components/RestaurantsNav';
import { PLAN_LABELS, saveRestaurantGroup, useScopedRestaurants, type RestaurantRow } from './lib';

type Group = WithId<RestaurantGroup>;

function consolidate(rows: RestaurantRow[]) {
  const sales = rows.reduce((s, r) => s + (r.metrics30d?.salesCents ?? 0), 0);
  const orders = rows.reduce((s, r) => s + (r.metrics30d?.ordersCount ?? 0), 0);
  const commission = rows.reduce((s, r) => s + (r.metrics30d?.commissionCents ?? 0), 0);
  const quality = rows.length ? Math.round(rows.reduce((s, r) => s + (r.qualityScore ?? 0), 0) / rows.length) : 0;
  return { sales, orders, commission, quality };
}

function GroupDialog({ group, restaurants, onClose }: { group: Group | null; restaurants: RestaurantRow[]; onClose: () => void }) {
  const can = useCan();
  const owner = useDoc<UserProfile>(group ? docAt(paths.user(group.ownerId)) : null);
  const [form, setForm] = useState(() => ({
    name: group?.name ?? '',
    ownerEmail: '',
    countryId: group?.countryId ?? 'FR',
    legalName: group?.legalName ?? '',
    siren: group?.siren ?? '',
    vatNumber: group?.vatNumber ?? '',
    restaurantIds: group?.restaurantIds ?? [],
    commission: group?.commercial?.commissionBps != null ? String(group.commercial.commissionBps / 100).replace('.', ',') : '',
    planCode: group?.commercial?.planCode ?? 'none',
    consolidatedBilling: group?.consolidatedBilling ?? true,
    reason: '',
  }));
  const email = form.ownerEmail || owner.data?.email || '';
  const save = useMutation(saveRestaurantGroup, { success: group ? 'Groupe mis à jour' : 'Groupe créé' });
  const commissionBps = form.commission.trim() ? Math.round(Number(form.commission.replace(',', '.')) * 100) : null;
  const invalid = form.name.trim().length < 2 || !email.includes('@') || form.reason.trim().length < 3 || (commissionBps !== null && (Number.isNaN(commissionBps) || commissionBps > 10_000));
  const options = restaurants.filter((r) => r.countryId === form.countryId).map((r) => ({ value: r.id, label: r.name, description: r.address.city }));

  return (
    <Dialog open onOpenChange={(o) => !o && !save.loading && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<Network />} title={group ? `Modifier ${group.name}` : 'Nouveau groupe'} description="Un propriétaire, plusieurs établissements : conditions communes et facturation consolidée." />
        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nom du groupe" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
            </FormField>
            <FormField label="E-mail du propriétaire" required hint="Compte existant sur GoLink.">
              <Input value={email} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} type="email" />
            </FormField>
            <FormField label="Pays">
              <Select value={form.countryId} onValueChange={(v) => setForm({ ...form, countryId: v, restaurantIds: [] })} options={['FR', 'BE', 'LU', 'DZ', 'MA', 'TN'].map((c) => ({ value: c, label: c }))} />
            </FormField>
            <FormField label="Raison sociale">
              <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} maxLength={120} />
            </FormField>
            <FormField label="SIREN">
              <Input value={form.siren} onChange={(e) => setForm({ ...form, siren: e.target.value })} maxLength={20} />
            </FormField>
            <FormField label="TVA intracommunautaire">
              <Input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} maxLength={20} />
            </FormField>
          </div>
          <FormField label="Établissements">
            <Combobox multiple value={form.restaurantIds} onChange={(v: string[]) => setForm({ ...form, restaurantIds: v })} placeholder="Choisir les établissements" options={options} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Commission commune (livraison GoLink)" hint={can('restaurants.commercial') ? 'Vide : taux de chaque établissement.' : 'Réservé à l’équipe commerciale.'}>
              <Input disabled={!can('restaurants.commercial')} inputMode="decimal" trailing="%" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} />
            </FormField>
            <FormField label="Formule commune">
              <Select
                disabled={!can('restaurants.commercial')}
                value={form.planCode}
                onValueChange={(v) => setForm({ ...form, planCode: v })}
                options={[{ value: 'none', label: 'Formule de chaque établissement' }, ...Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))]}
              />
            </FormField>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-fg">Facturation consolidée</span>
              <span className="block text-xs text-fg-subtle">Une facture de commissions pour l’ensemble du groupe.</span>
            </span>
            <Switch checked={form.consolidatedBilling} onCheckedChange={(v) => setForm({ ...form, consolidatedBilling: v })} aria-label="Facturation consolidée" />
          </label>
          <FormField label="Motif" required hint="Conservé dans le journal d’audit.">
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={invalid}
            onClick={() =>
              void save
                .mutate({
                  groupId: group?.id ?? null,
                  name: form.name.trim(),
                  ownerEmail: email.trim(),
                  countryId: form.countryId,
                  legalName: form.legalName.trim() || null,
                  siren: form.siren.trim() || null,
                  vatNumber: form.vatNumber.trim() || null,
                  restaurantIds: form.restaurantIds,
                  commissionBps,
                  planCode: form.planCode === 'none' ? null : form.planCode,
                  consolidatedBilling: form.consolidatedBilling,
                  reason: form.reason.trim(),
                })
                .then((r) => r && onClose())
            }
          >
            {group ? 'Enregistrer' : 'Créer le groupe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupSheet({ group, members, onEdit }: { group: Group; members: RestaurantRow[]; onEdit?: () => void }) {
  const navigate = useNavigate();
  const owner = useDoc<UserProfile>(docAt(paths.user(group.ownerId)));
  const totals = consolidate(members);
  return (
    <>
      <SheetHeader title={group.name} description={`${plural(group.restaurantIds.length, 'établissement', 'établissements')} · ${group.countryId}`} />
      <SheetBody className="space-y-6">
        {onEdit && (
          <Button variant="secondary" size="sm" leftIcon={<Pencil />} onClick={onEdit}>
            Modifier le groupe
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="CA 30 j consolidé" value={eur(totals.sales)} />
          <StatCard label="Commandes 30 j" value={formatNumber(totals.orders)} />
          <StatCard label="Commissions 30 j" value={eur(totals.commission)} tone="brand" />
          <StatCard label="Qualité moyenne" value={`${totals.quality}/100`} tone="success" />
        </div>
        <Facts
          items={[
            { label: 'Propriétaire', value: owner.data?.displayName ?? '—', hint: owner.data?.email },
            { label: 'Raison sociale', value: group.legalName || '—' },
            { label: 'SIREN', value: group.siren || '—' },
            { label: 'Commission commune', value: group.commercial?.commissionBps != null ? bpsLabel(group.commercial.commissionBps) : 'Taux de chaque établissement' },
            { label: 'Formule commune', value: group.commercial?.planCode ? PLAN_LABELS[group.commercial.planCode] : 'Formule de chaque établissement' },
            { label: 'Facturation', value: group.consolidatedBilling ? 'Consolidée' : 'Par établissement' },
          ]}
        />
        <div>
          <p className="eyebrow mb-2">Établissements</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {members.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/restaurants/${r.id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  <RestaurantIdentity restaurant={r} compact />
                  <span className="shrink-0 font-mono text-sm text-fg num">{eur(r.metrics30d?.salesCents ?? 0)}</span>
                </button>
              </li>
            ))}
            {members.length === 0 && <li className="px-4 py-3 text-sm text-fg-subtle">Aucun établissement dans votre périmètre.</li>}
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-2 flex items-center gap-1.5">
            <NotebookPen className="size-3.5" /> Notes internes
          </p>
          <NotesPanel target={{ type: 'restaurant_group', id: group.id, label: group.name }} />
        </div>
      </SheetBody>
    </>
  );
}

export function GroupsPage() {
  useDocumentTitle('Groupes et chaînes · GoLink Admin');
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const restaurants = useScopedRestaurants();
  const groups = useCollection<RestaurantGroup>(useMemo(() => query(collectionAt(COLLECTIONS.restaurantGroups), limit(300)), []));
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const byId = useMemo(() => new Map(restaurants.data.map((r) => [r.id, r])), [restaurants.data]);
  const visible = groups.data
    .filter((g) => !g.deletedAt)
    .map((g) => ({ group: g, members: g.restaurantIds.map((id) => byId.get(id)).filter((r): r is RestaurantRow => Boolean(r)) }))
    .filter((g) => g.members.length > 0 || g.group.restaurantIds.length === 0)
    .sort((a, b) => a.group.name.localeCompare(b.group.name, 'fr'));
  const selectedId = params.get('groupe');
  const selected = visible.find((g) => g.group.id === selectedId) ?? null;
  const independents = restaurants.data.filter((r) => !r.groupId).length;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Acteurs"
        title="Groupes & chaînes"
        description="Propriétaires de plusieurs établissements : conditions communes, facturation et statistiques consolidées."
        actions={
          can('restaurants.edit') && (
            <Button variant="primary" leftIcon={<Plus />} onClick={() => setEditing('new')}>
              Nouveau groupe
            </Button>
          )
        }
      >
        <RestaurantsNav />
      </PageHeader>

      {groups.error ? (
        <ErrorPanel error={groups.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            <StatCard label="Groupes" value={formatNumber(visible.length)} icon={<Network />} loading={groups.loading} />
            <StatCard label="Établissements en groupe" value={formatNumber(visible.reduce((s, g) => s + g.members.length, 0))} icon={<Building2 />} tone="info" loading={groups.loading} />
            <StatCard label="Indépendants" value={formatNumber(independents)} icon={<Store />} tone="neutral" loading={restaurants.loading} className="col-span-2 xl:col-span-1" />
          </div>
          {groups.loading || restaurants.loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-44 w-full" />
              <Skeleton className="h-44 w-full" />
              <Skeleton className="h-44 w-full" />
            </div>
          ) : visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Network />}
                title="Aucun groupe sur ce périmètre"
                description="Regroupez les établissements d’un même propriétaire pour leur appliquer des conditions communes."
                action={can('restaurants.edit') ? <Button variant="primary" size="sm" leftIcon={<Plus />} onClick={() => setEditing('new')}>Créer un groupe</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map(({ group, members }) => {
                const totals = consolidate(members);
                return (
                  <Card key={group.id} interactive className="cursor-pointer p-5" onClick={() => setParams({ groupe: group.id })}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-display text-md font-semibold text-fg">{group.name}</p>
                        <p className="text-xs text-fg-subtle">{plural(group.restaurantIds.length, 'établissement', 'établissements')}</p>
                      </div>
                      <ScoreRing value={totals.quality} size={40} />
                    </div>
                    <div className="mt-4 flex -space-x-2">
                      {members.slice(0, 6).map((r) => (
                        <RestaurantMark key={r.id} restaurant={r} size={30} className="ring-2 ring-surface" />
                      ))}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
                      <div>
                        <p className="text-xs text-fg-muted">CA 30 j</p>
                        <p className="font-mono text-sm font-semibold text-fg num">{eur(totals.sales)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-fg-muted">Conditions</p>
                        <p className="text-sm text-fg">
                          {group.commercial?.planCode ? <Badge size="sm">{PLAN_LABELS[group.commercial.planCode]}</Badge> : 'Individuelles'}
                          {group.commercial?.commissionBps != null ? ` · ${bpsLabel(group.commercial.commissionBps)}` : ''}
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setParams({})}>
        <SheetContent className="sm:max-w-xl">
          {selected && <GroupSheet group={selected.group} members={selected.members} onEdit={can('restaurants.edit') ? () => setEditing(selected.group) : undefined} />}
        </SheetContent>
      </Sheet>
      {editing && <GroupDialog group={editing === 'new' ? null : editing} restaurants={restaurants.data} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}
