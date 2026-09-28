import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { collection, doc, limit, orderBy, query } from 'firebase/firestore';
import { Bike, CheckCircle2, Gift, HandCoins, Hourglass, Megaphone, MoreHorizontal, Save, Store, UserPlus, Users, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  IconButton,
  SegmentedControl,
  Skeleton,
  StatCard,
  StatusPill,
  Switch,
  createColumnHelper,
  formatDate,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import { COLLECTIONS, SETTINGS_DOCS, type Driver, type Referral, type ReferralSettings, type UserProfile, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, toMillis, useCollection, useDoc, useDocs, useMutation } from '@/lib/firestore';
import { decideReferral, updateGrowthSettings } from '../_croissance/api';
import { useRestaurantOptions } from '../_croissance/hooks';
import { REFERRAL_PROGRAM_LABELS, REFERRAL_STATUS_LABELS, REFERRAL_STATUS_TONES } from '../_croissance/labels';
import { LoadError, MoneyInput, NumberInput } from '../_croissance/ui';
import { LoyaltyLayout } from './layout';

type Values = Omit<ReferralSettings, 'updatedAt' | 'updatedBy'>;

const DEFAULTS: Values = {
  client: { enabled: false, referrerRewardCents: 500, refereeRewardCents: 500, minFirstOrderCents: 1500 },
  restaurant: { enabled: true, rewardCents: 10_000, qualifyingOrders: 0, rewardType: 'ad_credit' },
  driver: { enabled: false, rewardCents: 5000, qualifyingDeliveries: 50 },
};

function ProgramCard({
  icon,
  title,
  description,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-[18px]">{icon}</div>
          <div className="min-w-0">
            <h3 className="font-display text-md font-semibold tracking-tight text-fg">{title}</h3>
            <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} aria-label={`Activer : ${title}`} />
      </div>
      <div className={enabled ? 'space-y-4 px-5 py-5' : 'space-y-4 px-5 py-5 opacity-60'}>{children}</div>
    </Card>
  );
}

type Row = WithId<Referral>;
const col = createColumnHelper<Row>();

export function ReferralPage() {
  useDocumentTitle('Parrainage · Ciyou Eats Admin');
  const { can, admin } = useAdminAccess();
  const central = admin.role === 'super_admin' || (admin.cityIds.length === 0 && admin.countryIds.length === 0);
  const canEdit = can('loyalty.edit') && central;
  const settings = useDoc<ReferralSettings>(docAt(`${COLLECTIONS.settings}/${SETTINGS_DOCS.referral}`));
  const current = useMemo<Values>(
    () => ({
      client: { ...DEFAULTS.client, ...settings.data?.client },
      restaurant: { ...DEFAULTS.restaurant, ...settings.data?.restaurant },
      driver: { ...DEFAULTS.driver, ...settings.data?.driver },
    }),
    [settings.data],
  );
  const [draft, setDraft] = useState<Values | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [program, setProgram] = useState<'all' | Referral['program']>('all');
  const [decision, setDecision] = useState<{ row: Row; kind: 'reject' | 'mark_paid' } | null>(null);
  const save = useMutation(updateGrowthSettings, { success: 'Règles de parrainage enregistrées' });
  const decide = useMutation(decideReferral, { success: 'Parrainage mis à jour' });
  const restaurants = useRestaurantOptions();

  const referralsQuery = useMemo(() => query(collection(db, COLLECTIONS.referrals), orderBy('createdAt', 'desc'), limit(300)), []);
  const referrals = useCollection<Referral>(referralsQuery);
  const clientIds = useMemo(() => {
    const ids = new Set<string>();
    referrals.data.filter((r) => r.program === 'client').forEach((r) => (ids.add(r.referrerId), ids.add(r.refereeId)));
    return [...ids].slice(0, 100);
  }, [referrals.data]);
  const userRefs = useMemo(() => (can('customers.view') ? clientIds.map((id) => doc(db, COLLECTIONS.users, id)) : []), [clientIds, can]);
  const users = useDocs<UserProfile>(userRefs);
  const userNames = useMemo(() => new Map(users.data.map((u) => [u.id, u.displayName])), [users.data]);
  const driverRefs = useMemo(() => {
    if (!can('drivers.view')) return [];
    const ids = new Set<string>();
    referrals.data.filter((r) => r.program === 'driver').forEach((r) => (ids.add(r.referrerId), ids.add(r.refereeId)));
    return [...ids].slice(0, 100).map((id) => doc(db, COLLECTIONS.drivers, id));
  }, [referrals.data, can]);
  const drivers = useDocs<Driver>(driverRefs);
  const driverNames = useMemo(() => new Map(drivers.data.map((d) => [d.id, d.displayName])), [drivers.data]);

  useEffect(() => {
    if (!settings.loading) setDraft(current);
  }, [settings.loading, current]);

  const nameOf = (r: Referral, who: 'referrer' | 'referee') => {
    const id = who === 'referrer' ? r.referrerId : r.refereeId;
    const type = who === 'referrer' ? r.referrerType : r.refereeType;
    if (type === 'restaurant') return { label: restaurants.byId.get(id)?.name ?? 'Commerce', href: `/restaurants/${id}` };
    if (type === 'driver') return { label: driverNames.get(id) ?? 'Livreur', href: `/livreurs/${id}` };
    return { label: userNames.get(id) ?? 'Client', href: `/clients/${id}` };
  };

  const rows = useMemo(() => (program === 'all' ? referrals.data : referrals.data.filter((r) => r.program === program)), [referrals.data, program]);
  const kpis = useMemo(() => {
    let rewarded = 0;
    let pending = 0;
    let cost = 0;
    for (const r of referrals.data) {
      if (r.status === 'rewarded') {
        rewarded += 1;
        cost += (r.referrerRewardCents ?? 0) + (r.refereeRewardCents ?? 0);
      }
      if (r.status === 'pending' || r.status === 'qualified') pending += 1;
    }
    return { total: referrals.data.length, rewarded, pending, cost };
  }, [referrals.data]);

  const columns = useMemo(
    () => [
      col.accessor((r) => REFERRAL_PROGRAM_LABELS[r.program], {
        id: 'programme',
        header: 'Programme',
        cell: ({ row, getValue }) => (
          <Badge tone={row.original.program === 'client' ? 'brand' : row.original.program === 'restaurant' ? 'teal' : 'plum'}>{getValue()}</Badge>
        ),
      }),
      col.accessor((r) => nameOf(r, 'referrer').label, {
        id: 'parrain',
        header: 'Parrain',
        cell: ({ row }) => {
          const n = nameOf(row.original, 'referrer');
          return (
            <Link to={n.href} className="whitespace-nowrap text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
              {n.label}
            </Link>
          );
        },
      }),
      col.accessor((r) => nameOf(r, 'referee').label, {
        id: 'filleul',
        header: 'Filleul',
        cell: ({ row }) => {
          const n = nameOf(row.original, 'referee');
          return (
            <Link to={n.href} className="whitespace-nowrap text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
              {n.label}
            </Link>
          );
        },
      }),
      col.accessor('code', { header: 'Code', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> }),
      col.accessor((r) => (r.referrerRewardCents ?? 0) + (r.refereeRewardCents ?? 0), {
        id: 'recompense',
        header: 'Récompense',
        meta: { align: 'right' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right text-sm">
            <p className="num font-mono">{formatEUR(row.original.referrerRewardCents ?? 0, { cents: true })}</p>
            {row.original.refereeRewardCents ? <p className="num text-2xs text-fg-muted">+ {formatEUR(row.original.refereeRewardCents, { cents: true })} filleul</p> : null}
          </div>
        ),
      }),
      col.accessor((r) => toMillis(r.createdAt) ?? 0, {
        id: 'date',
        header: 'Inscription',
        cell: ({ getValue }) => <span className="whitespace-nowrap text-sm text-fg-muted">{getValue() ? formatDate(getValue()) : '—'}</span>,
      }),
      col.accessor((r) => REFERRAL_STATUS_LABELS[r.status], {
        id: 'statut',
        header: 'Statut',
        cell: ({ row, getValue }) => <StatusPill tone={REFERRAL_STATUS_TONES[row.original.status]}>{getValue()}</StatusPill>,
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: ({ row }) => {
          const r = row.original;
          if (!canEdit || !['pending', 'qualified'].includes(r.status)) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Actions" variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {r.status === 'qualified' && (
                  <DropdownMenuItem icon={<HandCoins />} onSelect={() => setDecision({ row: r, kind: 'mark_paid' })}>
                    Marquer la prime comme versée
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem icon={<XCircle />} destructive onSelect={() => setDecision({ row: r, kind: 'reject' })}>
                  Refuser (fraude, auto-parrainage)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restaurants.byId, userNames, driverNames, canEdit],
  );

  if (settings.error) {
    return (
      <LoyaltyLayout>
        <Card>
          <LoadError error={settings.error} />
        </Card>
      </LoyaltyLayout>
    );
  }

  const set = <P extends keyof Values, K extends keyof Values[P]>(p: P, k: K, v: Values[P][K]) =>
    setDraft((d) => (d ? { ...d, [p]: { ...d[p], [k]: v } } : d));
  const dirty = draft ? JSON.stringify(draft) !== JSON.stringify(current) : false;
  const invalid = draft ? draft.driver.qualifyingDeliveries < 1 : true;

  return (
    <LoyaltyLayout
      actions={
        canEdit ? (
          <Button variant="primary" leftIcon={<Save />} disabled={!dirty || invalid} onClick={() => setConfirm(true)}>
            Enregistrer les règles
          </Button>
        ) : undefined
      }
    >
      {!draft ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <ProgramCard
            icon={<UserPlus />}
            title="Clients"
            description="Le parrain et le filleul sont récompensés après la première commande livrée du filleul."
            enabled={draft.client.enabled}
            onToggle={(v) => set('client', 'enabled', v)}
            disabled={!canEdit}
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Parrain">
                <MoneyInput value={draft.client.referrerRewardCents} onChange={(v) => set('client', 'referrerRewardCents', v ?? 0)} disabled={!canEdit} />
              </FormField>
              <FormField label="Filleul">
                <MoneyInput value={draft.client.refereeRewardCents} onChange={(v) => set('client', 'refereeRewardCents', v ?? 0)} disabled={!canEdit} />
              </FormField>
            </div>
            <FormField label="Première commande minimale" hint="Articles, hors livraison.">
              <MoneyInput value={draft.client.minFirstOrderCents} onChange={(v) => set('client', 'minFirstOrderCents', v ?? 0)} disabled={!canEdit} />
            </FormField>
            <p className="text-xs text-fg-subtle">Récompenses versées en avoir sur le compte Ciyou Eats, utilisable sur toute commande.</p>
          </ProgramCard>
          <ProgramCard
            icon={<Store />}
            title="Commerces"
            description="Un commerce qui en fait inscrire un autre via son lien reçoit une prime."
            enabled={draft.restaurant.enabled}
            onToggle={(v) => set('restaurant', 'enabled', v)}
            disabled={!canEdit}
          >
            <FormField label="Prime">
              <MoneyInput value={draft.restaurant.rewardCents} onChange={(v) => set('restaurant', 'rewardCents', v ?? 0)} disabled={!canEdit} />
            </FormField>
            <FormField label="Forme de la prime">
              <SegmentedControl
                aria-label="Forme de la prime"
                size="sm"
                value={draft.restaurant.rewardType ?? 'ad_credit'}
                onValueChange={(v) => canEdit && set('restaurant', 'rewardType', v as 'ad_credit' | 'cash')}
                options={[
                  { value: 'ad_credit', label: 'Crédit publicitaire', icon: <Megaphone /> },
                  { value: 'cash', label: 'Virement', icon: <HandCoins /> },
                ]}
              />
            </FormField>
            <FormField label="Commandes livrées du filleul avant la prime" hint="0 = dès la première commande.">
              <NumberInput value={draft.restaurant.qualifyingOrders} onChange={(v) => set('restaurant', 'qualifyingOrders', v ?? 0)} unit="cmd" disabled={!canEdit} />
            </FormField>
          </ProgramCard>
          <ProgramCard
            icon={<Bike />}
            title="Livreurs"
            description="Prime versée au livreur parrain quand son filleul atteint un nombre de livraisons."
            enabled={draft.driver.enabled}
            onToggle={(v) => set('driver', 'enabled', v)}
            disabled={!canEdit}
          >
            <FormField label="Prime">
              <MoneyInput value={draft.driver.rewardCents} onChange={(v) => set('driver', 'rewardCents', v ?? 0)} disabled={!canEdit} />
            </FormField>
            <FormField label="Livraisons du filleul avant la prime" error={draft.driver.qualifyingDeliveries < 1 ? 'Au moins 1.' : undefined}>
              <NumberInput value={draft.driver.qualifyingDeliveries} onChange={(v) => set('driver', 'qualifyingDeliveries', v ?? 0)} unit="courses" disabled={!canEdit} />
            </FormField>
            <p className="text-xs text-fg-subtle">Ajoutée aux gains du livreur et versée avec son prochain paiement.</p>
          </ProgramCard>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Parrainages" value={formatNumber(kpis.total)} icon={<Users />} tone="brand" loading={referrals.loading} />
        <StatCard label="Récompensés" value={formatNumber(kpis.rewarded)} icon={<CheckCircle2 />} tone="success" loading={referrals.loading} />
        <StatCard label="En attente" value={formatNumber(kpis.pending)} icon={<Hourglass />} tone="amber" loading={referrals.loading} footer="Filleul sans commande ou prime à verser" />
        <StatCard label="Récompenses versées" value={formatEUR(kpis.cost, { cents: true })} icon={<Gift />} tone="plum" loading={referrals.loading} />
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg">Suivi des parrainages</h2>
          <SegmentedControl
            aria-label="Programme"
            size="sm"
            value={program}
            onValueChange={(v) => setProgram(v as typeof program)}
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'client', label: 'Clients' },
              { value: 'restaurant', label: 'Commerces' },
              { value: 'driver', label: 'Livreurs' },
            ]}
          />
        </div>
        {referrals.error ? (
          <Card>
            <LoadError error={referrals.error} />
          </Card>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            loading={referrals.loading}
            searchable
            searchPlaceholder="Rechercher un parrain, un filleul, un code…"
            itemLabel="parrainages"
            filters={[{ id: 'status', label: 'Statut', options: Object.entries(REFERRAL_STATUS_LABELS).map(([value, label]) => ({ value, label })), getValue: (r) => r.status }]}
            emptyState={<EmptyState compact icon={<UserPlus />} title="Aucun parrainage" description="Les inscriptions via un lien de parrainage apparaîtront ici." />}
          />
        )}
      </div>

      {draft && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Enregistrer les règles de parrainage ?"
          description="Les nouveaux montants s’appliquent aux parrainages qui seront récompensés à partir de maintenant."
          confirmLabel="Enregistrer"
          requireReason
          onConfirm={async (reason) => {
            await save.mutate({ section: 'referral', values: draft, reason: reason ?? '' });
          }}
        />
      )}
      {decision && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDecision(null)}
          title={decision.kind === 'reject' ? 'Refuser ce parrainage ?' : 'Marquer la prime comme versée ?'}
          description={
            decision.kind === 'reject'
              ? 'Aucune récompense ne sera versée. À utiliser en cas d’auto-parrainage ou de fraude.'
              : `Confirmez le virement de ${formatEUR(decision.row.referrerRewardCents ?? 0, { cents: true })} au parrain.`
          }
          confirmLabel={decision.kind === 'reject' ? 'Refuser' : 'Confirmer le versement'}
          destructive={decision.kind === 'reject'}
          requireReason
          onConfirm={async (reason) => {
            await decide.mutate({ referralId: decision.row.id, decision: decision.kind, reason: reason ?? '' });
            setDecision(null);
          }}
        />
      )}
    </LoyaltyLayout>
  );
}
