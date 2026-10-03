// Liste des livreurs (cahier §6) : indicateurs, recherche, filtres à facettes,
// actions groupées (message, sanction, réactivation, désactivation, selfie, export).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Ban, Bike, Camera, Download, FileWarning, Gavel, MessageSquare, RotateCcw, ShieldAlert, Star, UserCheck, Users } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  StatCard,
  Tooltip,
  createColumnHelper,
  formatNumber,
  type DataTableBulkAction,
} from '@golink/ui';
import {
  DRIVER_BLOCK_LABELS,
  DRIVER_STATUS_LABELS,
  DRIVER_TYPE_LABELS,
  VEHICLE_LABELS,
  VEHICLE_TYPES,
  type Driver,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useMutation } from '@/lib/firestore';
import { bulkSummary, fn } from '../_operations/functions';
import { useNames, useRestaurantsByIds, useScopedDrivers } from '../_operations/hooks';
import { AvailabilityPill, DriverStatusPill, LoadError, pct } from '../_operations/ui';
import { MessageDialog, SanctionDialog } from './dialogs';
import { exportDriversCsv, todayIso, useContactMask } from './lib';
import { DriversShell } from './shell';

type Row = WithId<Driver>;
const col = createColumnHelper<Row>();

type Pending =
  | { kind: 'message' | 'sanction' | 'suspend'; rows: Row[] }
  | { kind: 'activate' | 'deactivate' | 'selfie'; rows: Row[] }
  | null;

export function DriversPage() {
  const navigate = useNavigate();
  const { can } = useAdminAccess();
  const drivers = useScopedDrivers();
  const names = useNames();
  const contact = useContactMask();
  const [pending, setPending] = useState<Pending>(null);
  const [clear, setClear] = useState<(() => void) | null>(null);
  const today = todayIso();

  const list = useMemo(() => drivers.data.filter((d) => !d.deletedAt), [drivers.data]);
  // PDV (point de vente) des livreurs salariés d'un commerce (document client « Points à
  // corriger », Super admin #3) : résolu par lots plutôt que de charger tous les commerces.
  const restaurantIds = useMemo(() => list.flatMap((d) => (d.type === 'restaurant' ? d.restaurantIds : [])), [list]);
  const restaurants = useRestaurantsByIds(restaurantIds);
  const restaurantName = useMemo(() => {
    const byId = new Map(restaurants.data.map((r) => [r.id, r.name]));
    return (d: Row) => (d.type === 'restaurant' ? d.restaurantIds.map((id) => byId.get(id) ?? id).join(', ') || '—' : '—');
  }, [restaurants.data]);
  const kpis = useMemo(() => {
    const active = list.filter((d) => d.status === 'active');
    return {
      active: active.length,
      online: list.filter((d) => d.availability === 'online' || d.availability === 'on_delivery').length,
      onDelivery: list.filter((d) => d.availability === 'on_delivery').length,
      toReview: list.filter((d) => d.status === 'onboarding' && d.onboardingStatus === 'pending').length,
      blocked: list.filter((d) => d.status === 'suspended').length,
      expiring: active.filter((d) => d.documentsValidUntil && d.documentsValidUntil <= new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10)).length,
      rating: active.filter((d) => d.rating.count > 0).reduce((s, d, _, arr) => s + d.rating.average / arr.length, 0),
    };
  }, [list, today]);

  const columns = useMemo(
    () => [
      col.accessor((d) => `${d.firstName} ${d.lastName} ${d.phone} ${d.email} ${d.vehicle.plate ?? ''}`, {
        id: 'name',
        header: 'Livreur',
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={`${d.firstName} ${d.lastName}`} size="sm" status={d.availability === 'online' ? 'online' : d.availability === 'on_delivery' ? 'busy' : 'offline'} />
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">
                  {d.firstName} {d.lastName}
                </p>
                <p className="truncate font-mono text-2xs text-fg-subtle">{contact.phone(d.phone)}</p>
              </div>
            </div>
          );
        },
        sortingFn: (a, b) => a.original.lastName.localeCompare(b.original.lastName, 'fr'),
      }),
      col.accessor((d) => DRIVER_TYPE_LABELS[d.type], {
        id: 'type',
        header: 'Type',
        cell: ({ row }) => (row.original.type === 'platform' ? <Badge tone="brand" size="sm">Ciyou Eats</Badge> : <Badge tone="plum" size="sm">Salarié commerce</Badge>),
      }),
      col.accessor((d) => restaurantName(d), {
        id: 'pdv',
        header: 'PDV',
        cell: ({ row }) => <span className="truncate text-sm text-fg-muted">{restaurantName(row.original)}</span>,
      }),
      col.accessor((d) => names.city(d.cityId), {
        id: 'city',
        header: 'Ville · zones',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="text-sm text-fg">{names.city(row.original.cityId)}</p>
            <p className="truncate text-2xs text-fg-subtle">{row.original.zoneIds.length ? row.original.zoneIds.map(names.zone).join(', ') : 'Toutes zones'}</p>
          </div>
        ),
      }),
      col.accessor((d) => VEHICLE_LABELS[d.vehicle.type], { id: 'vehicle', header: 'Véhicule', cell: (info) => <span className="text-sm text-fg-muted">{info.getValue()}</span> }),
      col.accessor('status', {
        header: 'Statut',
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <DriverStatusPill status={row.original.status} />
            {row.original.blocked && <span className="text-2xs text-danger">{DRIVER_BLOCK_LABELS[row.original.blocked.reason]}</span>}
          </div>
        ),
      }),
      col.accessor('availability', { header: 'En ce moment', cell: ({ row }) => <AvailabilityPill availability={row.original.availability} /> }),
      col.accessor((d) => d.rating.average, {
        id: 'rating',
        header: 'Note',
        meta: { align: 'right' },
        cell: ({ row }) =>
          row.original.rating.count ? (
            <span className="inline-flex items-center gap-1 font-mono text-sm num">
              <Star className="size-3 fill-current text-warning" />
              {row.original.rating.average.toFixed(2).replace('.', ',')}
              <span className="text-2xs text-fg-subtle">({row.original.rating.count})</span>
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      }),
      col.accessor((d) => d.stats.deliveries, { id: 'deliveries', header: 'Livraisons', meta: { align: 'right' }, cell: (info) => <span className="font-mono num">{formatNumber(info.getValue())}</span> }),
      col.accessor((d) => d.stats.acceptanceRate, {
        id: 'acceptance',
        header: 'Acceptation',
        meta: { align: 'right' },
        cell: (info) => <span className={`font-mono num ${info.getValue() < 0.7 ? 'text-danger' : ''}`}>{pct(info.getValue())}</span>,
      }),
      col.accessor((d) => d.documentsValidUntil ?? '', {
        id: 'documents',
        header: 'Documents',
        cell: ({ row }) => {
          const until = row.original.documentsValidUntil;
          if (!until) return <span className="text-2xs text-fg-subtle">{row.original.status === 'onboarding' ? 'Dossier en cours' : '—'}</span>;
          const expired = until < today;
          const soon = !expired && until <= new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
          return (
            <span className={`font-mono text-2xs ${expired ? 'text-danger' : soon ? 'text-warning' : 'text-fg-muted'}`}>
              {expired ? 'Expiré le ' : 'Jusqu’au '}
              {until.split('-').reverse().join('/')}
            </span>
          );
        },
      }),
    ],
    [names, contact, today, restaurantName],
  );

  const bulkActions: DataTableBulkAction<Row>[] = [
    { label: 'Message', icon: <MessageSquare />, onClick: (rows, c) => (setPending({ kind: 'message', rows }), setClear(() => c)) },
    ...(can('drivers.validate') ? [{ label: 'Selfie', icon: <Camera />, onClick: (rows: Row[], c: () => void) => (setPending({ kind: 'selfie', rows }), setClear(() => c)) }] : []),
    ...(can('drivers.sanction')
      ? [
          { label: 'Sanctionner', icon: <Gavel />, onClick: (rows: Row[], c: () => void) => (setPending({ kind: 'sanction', rows }), setClear(() => c)) },
          { label: 'Réactiver', icon: <RotateCcw />, onClick: (rows: Row[], c: () => void) => (setPending({ kind: 'activate', rows }), setClear(() => c)) },
          { label: 'Désactiver', icon: <Ban />, destructive: true, onClick: (rows: Row[], c: () => void) => (setPending({ kind: 'deactivate', rows }), setClear(() => c)) },
        ]
      : []),
    ...(can('exports.run') ? [{ label: 'Exporter', icon: <Download />, onClick: (rows: Row[]) => void runExport(rows) }] : []),
  ];

  // Cahier §6 « Actions groupées / export » (cdc-fix-residuals-3) : l'export CSV contient des
  // données personnelles (téléphone, e-mail non masqués selon le rôle) mais n'exigeait aucun
  // droit `exports.run` ni aucune trace au journal d'audit — corrigé : le bouton n'apparaît
  // plus sans ce droit, et chaque export réel est audité côté serveur avant le téléchargement.
  async function runExport(rows: Row[]) {
    await fn.auditDriversExport({ driverIds: rows.map((r) => r.id), reason: `Export CSV livreurs (${rows.length} ligne${rows.length > 1 ? 's' : ''})` });
    await exportDriversCsv(rows, names.city, contact.masked);
  }

  const bulk = useMutation(fn.bulkUpdateDrivers, { success: (r) => bulkSummary(r, pending?.kind === 'activate' ? 'Réactivation' : 'Désactivation') });
  const selfie = useMutation(fn.requestIdentityChecks, { success: (r) => bulkSummary(r, 'Selfie demandé') });
  const done = () => {
    clear?.();
    setPending(null);
  };
  const label = (rows: Row[]) => (rows.length === 1 ? `${rows[0]!.firstName} ${rows[0]!.lastName}` : `${rows.length} livreurs sélectionnés`);

  return (
    <DriversShell
      documentTitle="Livreurs"
      title="Livreurs"
      description="Flotte Ciyou Eats et livreurs salariés des commerces : statut, performance, conformité."
      actions={
        can('exports.run') ? (
          <Button variant="secondary" leftIcon={<Download />} disabled={list.length === 0} onClick={() => void runExport(list)}>
            Exporter
          </Button>
        ) : undefined
      }
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Livreurs actifs" value={formatNumber(kpis.active)} icon={<Users />} tone="success" loading={drivers.loading} footer={<span>Note moyenne {kpis.rating ? kpis.rating.toFixed(2).replace('.', ',') : '—'} / 5</span>} />
        <StatCard label="En ligne maintenant" value={formatNumber(kpis.online)} icon={<Bike />} tone="info" loading={drivers.loading} footer={<span>{kpis.onDelivery} en course</span>} />
        <StatCard
          label="Inscriptions à valider"
          value={formatNumber(kpis.toReview)}
          icon={<UserCheck />}
          tone="brand"
          loading={drivers.loading}
          onClick={can('drivers.validate') ? () => navigate('/livreurs/validation') : undefined}
          footer={<span>File de validation manuelle</span>}
        />
        <StatCard
          label="Suspendus ou bloqués"
          value={formatNumber(kpis.blocked)}
          icon={<ShieldAlert />}
          tone="danger"
          loading={drivers.loading}
          footer={
            <span className="inline-flex items-center gap-1">
              <FileWarning className="size-3" /> {kpis.expiring} dossier{kpis.expiring > 1 ? 's' : ''} expire{kpis.expiring > 1 ? 'nt' : ''} sous 30 jours
            </span>
          }
        />
      </div>

      {drivers.error ? (
        <LoadError error={drivers.error} />
      ) : (
        <DataTable
          data={list}
          columns={columns}
          getRowId={(d) => d.id}
          loading={drivers.loading}
          searchPlaceholder="Nom, téléphone, e-mail, plaque…"
          itemLabel="livreurs"
          pageSize={15}
          initialSorting={[{ id: 'deliveries', desc: true }]}
          onRowClick={(d) => navigate(`/livreurs/${d.id}`)}
          bulkActions={bulkActions}
          filters={[
            { id: 'status', label: 'Statut', options: (['active', 'onboarding', 'suspended', 'deactivated'] as const).map((s) => ({ value: s, label: DRIVER_STATUS_LABELS[s] })), getValue: (d) => d.status },
            { id: 'availability', label: 'Disponibilité', options: [{ value: 'online', label: 'Disponible' }, { value: 'on_delivery', label: 'En course' }, { value: 'paused', label: 'En pause' }, { value: 'offline', label: 'Hors ligne' }], getValue: (d) => d.availability },
            { id: 'type', label: 'Type', options: [{ value: 'platform', label: 'Livreur Ciyou Eats' }, { value: 'restaurant', label: 'Salarié d’un commerce' }], getValue: (d) => d.type },
            { id: 'vehicle', label: 'Véhicule', options: VEHICLE_TYPES.map((v) => ({ value: v, label: VEHICLE_LABELS[v] })), getValue: (d) => d.vehicle.type },
          ]}
          emptyState={<EmptyState icon={<Bike />} title="Aucun livreur dans ce périmètre" description="Les livreurs apparaissent ici dès leur inscription depuis l’application livreur." />}
        />
      )}

      {pending && (pending.kind === 'message' || pending.kind === 'sanction') && (
        <>
          <MessageDialog open={pending.kind === 'message'} onOpenChange={(o) => !o && setPending(null)} driverIds={pending.rows.map((r) => r.id)} label={label(pending.rows)} onDone={done} />
          <SanctionDialog open={pending.kind === 'sanction'} onOpenChange={(o) => !o && setPending(null)} driverIds={pending.rows.map((r) => r.id)} label={label(pending.rows)} onDone={done} />
        </>
      )}
      <ConfirmDialog
        open={pending?.kind === 'activate' || pending?.kind === 'deactivate'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'activate' ? 'Réactiver les comptes' : 'Désactiver les comptes'}
        description={
          pending?.kind === 'activate'
            ? `${label(pending?.rows ?? [])} : la sanction en cours est levée si le dossier est conforme.`
            : `${label(pending?.rows ?? [])} : plus aucune course ne leur sera proposée.`
        }
        destructive={pending?.kind === 'deactivate'}
        requireReason
        confirmLabel={pending?.kind === 'activate' ? 'Réactiver' : 'Désactiver'}
        onConfirm={async (reason) => {
          if (!pending || (pending.kind !== 'activate' && pending.kind !== 'deactivate')) return;
          const result = await bulk.mutate({ driverIds: pending.rows.map((r) => r.id), action: pending.kind, reason: reason ?? '' });
          if (result) done();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'selfie'}
        onOpenChange={(o) => !o && setPending(null)}
        title="Demander un selfie de vérification"
        description={`${label(pending?.rows ?? [])} : le livreur devra prendre un selfie avant sa prochaine course.`}
        requireReason
        confirmLabel="Demander"
        onConfirm={async (reason) => {
          if (!pending) return;
          const result = await selfie.mutate({ driverIds: pending.rows.map((r) => r.id), reason: reason ?? '' });
          if (result) done();
        }}
      >
        <p className="text-xs text-fg-subtle">
          <Tooltip content="Contrôle ponctuel pour vérifier que la personne qui livre est le titulaire du compte.">
            <span className="underline decoration-dotted">Pourquoi ce contrôle ?</span>
          </Tooltip>
        </p>
      </ConfirmDialog>
    </DriversShell>
  );
}
