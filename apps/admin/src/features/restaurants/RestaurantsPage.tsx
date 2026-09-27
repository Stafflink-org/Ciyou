// Super admin §5 : liste des commerces du périmètre, filtres enregistrables,
// actions groupées, export, création et import.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  BadgePercent,
  Ban,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileUp,
  Mail,
  Play,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Store,
  ToggleRight,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatDate,
  formatEUR,
  formatNumber,
  type DataTableBulkAction,
} from '@golink/ui';
import { MERCHANT_TYPES, MERCHANT_TYPE_LABELS, QUALITY_THRESHOLDS, type SavedFilter } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { toDate, useMutation } from '@/lib/firestore';
import { SavedFilters } from '../acteurs-commun/SavedFilters';
import { downloadCsv, downloadXlsx, todayStamp, type ExportSheet } from '../acteurs-commun/export';
import { ErrorPanel, ScoreRing, bpsLabel, eur, plural } from '../acteurs-commun/ui';
import { BulkActionDialog, type BulkDialogAction } from './components/BulkActionDialog';
import { CreateRestaurantDialog } from './components/CreateRestaurantDialog';
import { RatingInline, RestaurantIdentity } from './components/RestaurantIdentity';
import { RestaurantsNav } from './components/RestaurantsNav';
import {
  ONBOARDING_META,
  PLAN_LABELS,
  RESTAURANT_STATUS_META,
  bulkRestaurantAction,
  isInValidationQueue,
  useScopedRestaurants,
  type RestaurantRow,
} from './lib';

type Tab = 'all' | 'active' | 'queue' | 'suspended' | 'closed';

interface Filters {
  tab: Tab;
  cityId: string;
  plan: string;
  type: string;
  minRating: string;
  maxCancel: string;
  minSales: string;
  signedUp: string;
  quality: string;
  allergens: string;
}

const DEFAULT_FILTERS: Filters = {
  tab: 'all',
  cityId: 'all',
  plan: 'all',
  type: 'all',
  minRating: 'any',
  maxCancel: 'any',
  minSales: 'any',
  signedUp: 'any',
  quality: 'any',
  allergens: 'any',
};

const SECONDARY: Array<{ key: keyof Filters; label: string; options: Array<{ value: string; label: string }> }> = [
  {
    key: 'minRating',
    label: 'Note minimale',
    options: [
      { value: 'any', label: 'Toutes les notes' },
      { value: '4', label: '4 et plus' },
      { value: '4.5', label: '4,5 et plus' },
      { value: 'lt4', label: 'Moins de 4' },
    ],
  },
  {
    key: 'minSales',
    label: 'CA sur 30 jours',
    options: [
      { value: 'any', label: 'Tous' },
      { value: '0', label: 'Aucune vente' },
      { value: '100000', label: 'Plus de 1 000 €' },
      { value: '500000', label: 'Plus de 5 000 €' },
      { value: '1000000', label: 'Plus de 10 000 €' },
    ],
  },
  {
    key: 'maxCancel',
    label: 'Taux d’annulation',
    options: [
      { value: 'any', label: 'Tous' },
      { value: 'lt5', label: 'Moins de 5 %' },
      { value: 'gt10', label: 'Plus de 10 %' },
      { value: 'gt20', label: 'Plus de 20 %' },
    ],
  },
  {
    key: 'signedUp',
    label: 'Inscription',
    options: [
      { value: 'any', label: 'Toutes les dates' },
      { value: '7', label: '7 derniers jours' },
      { value: '30', label: '30 derniers jours' },
      { value: '90', label: '3 derniers mois' },
      { value: '365', label: '12 derniers mois' },
    ],
  },
  {
    key: 'quality',
    label: 'Score de qualité',
    options: [
      { value: 'any', label: 'Tous' },
      { value: 'watch', label: `À surveiller (< ${QUALITY_THRESHOLDS.watch})` },
      { value: 'coach', label: `À accompagner (< ${QUALITY_THRESHOLDS.coach})` },
    ],
  },
  {
    key: 'allergens',
    label: 'Allergènes',
    options: [
      { value: 'any', label: 'Tous' },
      { value: 'incomplete', label: 'Incomplets' },
    ],
  },
];

function matches(r: RestaurantRow, f: Filters, now: number): boolean {
  if (f.tab === 'active' && !(r.status === 'active' || r.status === 'paused')) return false;
  if (f.tab === 'queue' && !isInValidationQueue(r)) return false;
  if (f.tab === 'suspended' && r.status !== 'suspended') return false;
  if (f.tab === 'closed' && r.status !== 'closed') return false;
  if (f.cityId !== 'all' && r.cityId !== f.cityId) return false;
  if (f.plan !== 'all' && r.planCode !== f.plan) return false;
  if (f.type !== 'all' && (r.merchantType ?? 'restaurant') !== f.type) return false;
  const rating = r.rating?.average ?? 0;
  if (f.minRating === 'lt4' && !(r.rating?.count && rating < 4)) return false;
  if (f.minRating !== 'any' && f.minRating !== 'lt4' && rating < Number(f.minRating)) return false;
  const sales = r.metrics30d?.salesCents ?? 0;
  if (f.minSales === '0' && sales > 0) return false;
  if (f.minSales !== 'any' && f.minSales !== '0' && sales < Number(f.minSales)) return false;
  const cancel = r.metrics30d?.cancelRateBps ?? 0;
  if (f.maxCancel === 'lt5' && cancel >= 500) return false;
  if (f.maxCancel === 'gt10' && cancel <= 1000) return false;
  if (f.maxCancel === 'gt20' && cancel <= 2000) return false;
  if (f.signedUp !== 'any') {
    const created = toDate(r.createdAt)?.getTime() ?? 0;
    if (created < now - Number(f.signedUp) * 86_400_000) return false;
  }
  if (f.quality === 'watch' && r.qualityScore >= QUALITY_THRESHOLDS.watch) return false;
  if (f.quality === 'coach' && r.qualityScore >= QUALITY_THRESHOLDS.coach) return false;
  if (f.allergens === 'incomplete' && r.allergensComplete) return false;
  return true;
}

const column = createColumnHelper<RestaurantRow>();

export function RestaurantsPage() {
  useDocumentTitle('Restaurants · GoLink Admin');
  const navigate = useNavigate();
  const can = useCan();
  const scope = useGeoScope();
  const restaurants = useScopedRestaurants();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedName, setAppliedName] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ action: BulkDialogAction; rows: RestaurantRow[]; clear: () => void } | null>(null);
  const [creating, setCreating] = useState(false);
  const exportAudit = useMutation(bulkRestaurantAction, { errorToast: false });

  const cityName = useMemo(() => new Map(scope.cities.map((c) => [c.id, c.name])), [scope.cities]);
  const now = Date.now();
  const all = restaurants.data;
  const counts = useMemo(
    () => ({
      all: all.length,
      active: all.filter((r) => r.status === 'active' || r.status === 'paused').length,
      queue: all.filter(isInValidationQueue).length,
      suspended: all.filter((r) => r.status === 'suspended').length,
      closed: all.filter((r) => r.status === 'closed').length,
    }),
    [all],
  );
  const visible = useMemo(() => all.filter((r) => matches(r, filters, now)), [all, filters, now]);
  const kpis = useMemo(() => {
    const live = all.filter((r) => r.status === 'active' || r.status === 'paused');
    const avgQuality = live.length ? Math.round(live.reduce((s, r) => s + (r.qualityScore ?? 0), 0) / live.length) : 0;
    return {
      live: live.length,
      open: live.filter((r) => r.isOpen).length,
      sales: live.reduce((s, r) => s + (r.metrics30d?.salesCents ?? 0), 0),
      avgQuality,
      toCoach: live.filter((r) => r.qualityScore < QUALITY_THRESHOLDS.coach).length,
      allergens: live.filter((r) => !r.allergensComplete).length,
    };
  }, [all]);
  const secondaryActive = SECONDARY.filter((s) => filters[s.key] !== 'any').length;
  const anyFilter = JSON.stringify({ ...filters, tab: 'all' }) !== JSON.stringify({ ...DEFAULT_FILTERS, tab: 'all' });

  const set = (key: keyof Filters) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setAppliedName(null);
  };

  function describeFilters(): string {
    const parts: string[] = [];
    if (filters.tab !== 'all') parts.push({ active: 'actifs', queue: 'à valider', suspended: 'suspendus', closed: 'fermés', all: '' }[filters.tab]);
    if (filters.plan !== 'all') parts.push(`formule ${PLAN_LABELS[filters.plan]}`);
    if (filters.cityId !== 'all') parts.push(`à ${cityName.get(filters.cityId) ?? filters.cityId}`);
    if (filters.type !== 'all') parts.push(MERCHANT_TYPE_LABELS[filters.type as keyof typeof MERCHANT_TYPE_LABELS].toLowerCase());
    SECONDARY.forEach((s) => {
      if (filters[s.key] !== 'any') parts.push(`${s.label.toLowerCase()} : ${s.options.find((o) => o.value === filters[s.key])?.label.toLowerCase()}`);
    });
    return parts.length ? `Commerces ${parts.join(', ')}.` : 'Tous les commerces du périmètre.';
  }

  function applySaved(saved: SavedFilter['filters'], name: string) {
    const next = { ...DEFAULT_FILTERS };
    (Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>).forEach((key) => {
      const value = saved[key];
      if (typeof value === 'string') (next as Record<string, string>)[key] = value;
    });
    // Compatibilité avec les filtres créés ailleurs (planCode / cityId / status).
    if (typeof saved.planCode === 'string') next.plan = saved.planCode;
    if (typeof saved.status === 'string' && ['active', 'suspended', 'closed'].includes(saved.status)) next.tab = saved.status as Tab;
    setFilters(next);
    setAppliedName(name);
  }

  function exportSheet(list: RestaurantRow[]): ExportSheet {
    return {
      name: 'Commerces',
      columns: [
        { header: 'Identifiant' },
        { header: 'Nom' },
        { header: 'Type' },
        { header: 'Ville' },
        { header: 'Statut' },
        { header: 'Validation' },
        { header: 'Formule' },
        { header: 'Note', kind: 'number' },
        { header: 'Avis', kind: 'number' },
        { header: 'Commandes (30 j)', kind: 'number' },
        { header: 'CA (30 j)', kind: 'money' },
        { header: 'Commissions (30 j)', kind: 'money' },
        { header: 'Taux d’annulation (30 j)', kind: 'percent' },
        { header: 'Score qualité', kind: 'number' },
        { header: 'Allergènes complets' },
        { header: 'Inscription' },
        { header: 'E-mail' },
        { header: 'Téléphone' },
      ],
      rows: list.map((r) => [
        r.id,
        r.name,
        MERCHANT_TYPE_LABELS[r.merchantType ?? 'restaurant'],
        cityName.get(r.cityId) ?? r.cityId,
        RESTAURANT_STATUS_META[r.status].label,
        ONBOARDING_META[r.onboardingStatus].label,
        PLAN_LABELS[r.planCode] ?? r.planCode,
        r.rating?.count ? r.rating.average : null,
        r.rating?.count ?? 0,
        r.metrics30d?.ordersCount ?? 0,
        r.metrics30d?.salesCents ?? 0,
        r.metrics30d?.commissionCents ?? 0,
        r.metrics30d?.cancelRateBps ?? 0,
        r.qualityScore,
        r.allergensComplete ? 'Oui' : 'Non',
        toDate(r.createdAt)?.toLocaleDateString('fr-FR') ?? '',
        r.email ?? '',
        r.phone ?? '',
      ]),
    };
  }

  async function exportRows(list: RestaurantRow[], format: 'csv' | 'xlsx') {
    const sheet = exportSheet(list);
    const filename = `commerces-${todayStamp()}`;
    if (format === 'csv') downloadCsv(sheet, filename);
    else await downloadXlsx(sheet, filename);
    // Export tracé au journal d'audit (action sensible du cahier).
    if (can('exports.run')) void exportAudit.mutate({ restaurantIds: list.slice(0, 300).map((r) => r.id), action: 'export', reason: `Export ${format.toUpperCase()} de la liste des commerces`, params: { format } });
  }

  const columns = useMemo(
    () => [
      column.accessor('name', {
        header: 'Commerce',
        cell: (info) => <RestaurantIdentity restaurant={info.row.original} cityName={cityName.get(info.row.original.cityId)} />,
      }),
      column.accessor('status', {
        header: 'Statut',
        cell: (info) => {
          const r = info.row.original;
          return (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge status={r.status} map={RESTAURANT_STATUS_META} />
              {r.onboardingStatus !== 'approved' && <StatusBadge status={r.onboardingStatus} map={ONBOARDING_META} className="scale-95" />}
            </div>
          );
        },
      }),
      column.accessor('planCode', {
        header: 'Formule',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => <Badge tone={info.getValue() === 'premium' ? 'plum' : info.getValue() === 'pro' ? 'brand' : 'neutral'}>{PLAN_LABELS[info.getValue()] ?? info.getValue()}</Badge>,
      }),
      column.accessor((r) => r.rating?.average ?? 0, {
        id: 'rating',
        header: 'Note',
        meta: { className: 'hidden lg:table-cell' },
        cell: (info) => <RatingInline average={info.row.original.rating?.average ?? 0} count={info.row.original.rating?.count ?? 0} />,
      }),
      column.accessor((r) => r.metrics30d?.salesCents ?? 0, {
        id: 'sales',
        header: 'CA 30 j',
        meta: { align: 'right' },
        cell: (info) => (
          <div className="text-right">
            <p className="font-mono text-sm font-medium text-fg num">{eur(info.getValue())}</p>
            <p className="text-2xs text-fg-subtle num">{formatNumber(info.row.original.metrics30d?.ordersCount ?? 0)} cmd</p>
          </div>
        ),
      }),
      column.accessor((r) => r.metrics30d?.cancelRateBps ?? 0, {
        id: 'cancel',
        header: 'Annulation',
        meta: { align: 'right', className: 'hidden xl:table-cell' },
        cell: (info) => (
          <span className={`font-mono text-sm num ${info.getValue() > 1000 ? 'text-danger' : 'text-fg-muted'}`}>{info.row.original.metrics30d ? bpsLabel(info.getValue()) : '—'}</span>
        ),
      }),
      column.accessor('qualityScore', {
        header: 'Qualité',
        meta: { align: 'center', className: 'hidden sm:table-cell' },
        cell: (info) => (
          <div className="flex items-center justify-center gap-1.5">
            {info.row.original.status === 'onboarding' ? <span className="text-sm text-fg-subtle">—</span> : <ScoreRing value={info.getValue() ?? 0} size={34} />}
            {!info.row.original.allergensComplete && (
              <span title="Allergènes incomplets" className="tone-amber grid size-5 place-items-center rounded-full bg-(--tone-bg) text-(--tone-fg)">
                <ShieldAlert className="size-3" />
              </span>
            )}
          </div>
        ),
      }),
      column.accessor((r) => toDate(r.createdAt)?.getTime() ?? 0, {
        id: 'created',
        header: 'Inscription',
        meta: { className: 'hidden 2xl:table-cell' },
        cell: (info) => <span className="text-sm text-fg-muted">{info.getValue() ? formatDate(info.getValue()) : '—'}</span>,
      }),
    ],
    [cityName],
  );

  const bulkActions = useMemo(() => {
    const actions: DataTableBulkAction<RestaurantRow>[] = [
      { label: 'Excel', icon: <FileSpreadsheet />, onClick: (rows) => void exportRows(rows, 'xlsx') },
      { label: 'CSV', icon: <Download />, onClick: (rows) => void exportRows(rows, 'csv') },
    ];
    const open = (action: BulkDialogAction) => (rows: RestaurantRow[], clear: () => void) => setBulk({ action, rows, clear });
    if (can('restaurants.bulk') && can('restaurants.commercial')) {
      actions.push({ label: 'Commission', icon: <BadgePercent />, onClick: open('set_commission') });
      actions.push({ label: 'Formule', icon: <Sparkles />, onClick: open('set_plan') });
    }
    if (can('restaurants.bulk') && can('features.edit')) actions.push({ label: 'Fonctionnalité', icon: <ToggleRight />, onClick: open('set_feature') });
    if (can('restaurants.bulk')) actions.push({ label: 'Message', icon: <Mail />, onClick: open('send_message') });
    if (can('restaurants.bulk') && can('restaurants.suspend')) {
      actions.push({ label: 'Réactiver', icon: <Play />, onClick: open('reactivate') });
      actions.push({ label: 'Suspendre', icon: <Ban />, destructive: true, onClick: open('suspend') });
    }
    return actions;
  }, [can, cityName]);

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Acteurs"
        title="Restaurants"
        description="Accès à la plateforme, conditions commerciales et qualité de tous les commerces partenaires."
        actions={
          <>
            {can('restaurants.import') && (
              <Button variant="secondary" leftIcon={<FileUp />} onClick={() => navigate('/restaurants/import')}>
                Importer
              </Button>
            )}
            {can('restaurants.edit') && (
              <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
                Ajouter un commerce
              </Button>
            )}
          </>
        }
      >
        <RestaurantsNav validationCount={counts.queue} />
      </PageHeader>

      {restaurants.error ? (
        <ErrorPanel error={restaurants.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard
              label="Commerces en ligne"
              value={formatNumber(kpis.live)}
              icon={<Store />}
              tone="success"
              loading={restaurants.loading}
              footer={`${formatNumber(kpis.open)} ouverts en ce moment`}
              onClick={() => set('tab')('active')}
            />
            <StatCard
              label="Dossiers à valider"
              value={formatNumber(counts.queue)}
              icon={<ClipboardCheck />}
              tone="info"
              loading={restaurants.loading}
              footer="En attente ou documents manquants"
              onClick={can('restaurants.validate') ? () => navigate('/restaurants/validation') : () => set('tab')('queue')}
            />
            <StatCard label="Volume sur 30 jours" value={formatEUR(kpis.sales, { cents: true, compact: kpis.sales >= 1_000_000 })} icon={<BadgePercent />} loading={restaurants.loading} footer="Ventes TTC des commerces en ligne" />
            <StatCard
              label="Score qualité moyen"
              value={`${kpis.avgQuality}/100`}
              icon={<ShieldAlert />}
              tone={kpis.toCoach ? 'amber' : 'success'}
              loading={restaurants.loading}
              footer={`${plural(kpis.toCoach, 'commerce à accompagner', 'commerces à accompagner')} · ${formatNumber(kpis.allergens)} allergènes incomplets`}
              onClick={() => navigate('/restaurants/qualite')}
            />
          </div>

          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <SegmentedControl
              aria-label="Statut des commerces"
              value={filters.tab}
              onValueChange={(v) => set('tab')(v)}
              options={[
                { value: 'all', label: 'Tous', count: counts.all },
                { value: 'active', label: 'En ligne', count: counts.active },
                { value: 'queue', label: 'À valider', count: counts.queue },
                { value: 'suspended', label: 'Suspendus', count: counts.suspended },
                { value: 'closed', label: 'Fermés', count: counts.closed },
              ]}
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              {scope.cities.length > 1 && (
                <Select
                  size="sm"
                  aria-label="Ville"
                  className="w-full sm:w-44"
                  value={filters.cityId}
                  onValueChange={set('cityId')}
                  options={[{ value: 'all', label: 'Toutes les villes' }, ...scope.cities.map((c) => ({ value: c.id, label: c.name }))]}
                />
              )}
              <Select
                size="sm"
                aria-label="Formule"
                className="w-full sm:w-44"
                value={filters.plan}
                onValueChange={set('plan')}
                options={[{ value: 'all', label: 'Toutes formules' }, ...Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))]}
              />
              <Select
                size="sm"
                aria-label="Type de commerce"
                className="w-full sm:w-44"
                value={filters.type}
                onValueChange={set('type')}
                options={[{ value: 'all', label: 'Tous les types' }, ...MERCHANT_TYPES.map((t) => ({ value: t, label: MERCHANT_TYPE_LABELS[t] }))]}
              />
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary" size="sm" leftIcon={<SlidersHorizontal />}>
                    Plus de filtres
                    {secondaryActive > 0 && <span className="rounded-full bg-primary px-1.5 font-mono text-2xs text-primary-fg num">{secondaryActive}</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(340px,calc(100vw-2rem))] space-y-3 p-4">
                  {SECONDARY.map((s) => (
                    <label key={s.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-3">
                      <span className="text-sm text-fg-muted">{s.label}</span>
                      <Select size="sm" aria-label={s.label} value={filters[s.key]} onValueChange={set(s.key)} options={s.options} />
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
              <SavedFilters entity="restaurants" current={{ ...filters }} onApply={applySaved} describe={describeFilters()} />
            </div>
          </div>

          {(anyFilter || appliedName) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <span>
                {appliedName ? <strong className="font-medium text-fg">{appliedName}</strong> : 'Filtres actifs'} · {plural(visible.length, 'commerce', 'commerces')}
              </span>
              <Button
                variant="ghost"
                size="xs"
                leftIcon={<X />}
                onClick={() => {
                  setFilters({ ...DEFAULT_FILTERS, tab: filters.tab });
                  setAppliedName(null);
                }}
              >
                Effacer
              </Button>
            </div>
          )}

          <DataTable
            data={visible}
            columns={columns}
            getRowId={(row) => row.id}
            loading={restaurants.loading}
            searchPlaceholder="Rechercher un commerce, une ville…"
            itemLabel="commerces"
            pageSize={20}
            initialSorting={[{ id: 'sales', desc: true }]}
            onRowClick={(row) => navigate(`/restaurants/${row.id}`)}
            bulkActions={bulkActions}
            toolbar={
              <Button variant="ghost" size="sm" leftIcon={<Download />} disabled={!visible.length} onClick={() => void exportRows(visible, 'xlsx')}>
                Exporter
              </Button>
            }
            emptyState={
              restaurants.empty ? (
                <EmptyState compact icon={<Store />} title="Aucune ville dans votre périmètre" description="Demandez à un super administrateur de vous rattacher à une ville." />
              ) : all.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Store />}
                  title="Aucun commerce sur ce marché"
                  description="Les inscriptions en ligne et les commerces créés par l’équipe apparaîtront ici."
                  action={can('restaurants.edit') ? <Button size="sm" variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>Ajouter un commerce</Button> : undefined}
                />
              ) : (
                <EmptyState compact icon={<SlidersHorizontal />} title="Aucun commerce ne correspond" description="Élargissez les filtres ou changez de périmètre." />
              )
            }
          />
        </div>
      )}

      <BulkActionDialog
        action={bulk?.action ?? null}
        rows={bulk?.rows ?? []}
        onOpenChange={(open) => !open && setBulk(null)}
        onDone={() => bulk?.clear()}
      />
      <CreateRestaurantDialog open={creating} onOpenChange={setCreating} />
    </PageContainer>
  );
}
