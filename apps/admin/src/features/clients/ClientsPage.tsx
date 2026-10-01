// Super admin §7 : comptes clients du périmètre (recherche, statut, risque),
// export et blocage groupé. Coordonnées masquées selon le rôle.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { collection, getAggregateFromServer, getCountFromServer, orderBy, query, sum, Timestamp, where, type Query, type QueryConstraint } from 'firebase/firestore';
import { Ban, ChevronDown, Download, Gift, Search, UserPlus, Users, Wallet } from 'lucide-react';
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  Input,
  PageContainer,
  PageHeader,
  SegmentedControl,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatNumber,
  formatRelative,
  toast,
  type DataTableBulkAction,
} from '@golink/ui';
import { COLLECTIONS, type UserProfile, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useInfiniteCollection } from '@/lib/firestore';
import { downloadCsv, todayStamp } from '../acteurs-commun/export';
import { ErrorPanel, eur, plural } from '../acteurs-commun/ui';
import { BlockCustomerDialog } from './components/CustomerDialogs';
import { CUSTOMER_STATUS_META, RISK_META, auditCustomersExport, displayEmail, displayPhone, riskOf, searchToken } from './lib';

type Row = WithId<UserProfile>;
type Status = 'all' | 'active' | 'blocked' | 'deleted';
const column = createColumnHelper<Row>();

/** Nombre de documents d'une requête (agrégation serveur, non temps réel). */
function useCount(q: Query | null): number | null {
  const [value, setValue] = useState<{ q: Query | null; count: number | null }>({ q: null, count: null });
  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    getCountFromServer(q).then(
      (snap) => !cancelled && setValue({ q, count: snap.data().count }),
      () => !cancelled && setValue({ q, count: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [q]);
  return value.q === q ? value.count : null;
}

/** Somme des avoirs en circulation (agrégation serveur). */
function useWalletTotal(q: Query | null): number | null {
  const [value, setValue] = useState<{ q: Query | null; total: number | null }>({ q: null, total: null });
  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    getAggregateFromServer(q, { total: sum('walletBalanceCents') }).then(
      (snap) => !cancelled && setValue({ q, total: snap.data().total ?? 0 }),
      () => !cancelled && setValue({ q, total: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [q]);
  return value.q === q ? value.total : null;
}

export function ClientsPage() {
  useDocumentTitle('Clients · Ciyou Eats Admin');
  const navigate = useNavigate();
  const can = useCan();
  const scope = useGeoScope();
  const full = can('personal_data.view');
  const [status, setStatus] = useState<Status>('all');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [blocking, setBlocking] = useState<{ rows: Row[]; clear: () => void } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term), 300);
    return () => window.clearTimeout(timer);
  }, [term]);
  const token = searchToken(debounced);

  const scopeConstraints = useMemo<QueryConstraint[] | null>(() => {
    if (scope.cityIds) return scope.cityIds.length ? [where('cityId', 'in', scope.cityIds.slice(0, 30))] : null;
    if (scope.countryId) return [where('countryId', '==', scope.countryId)];
    return [];
  }, [scope.cityIds, scope.countryId]);

  const listQuery = useMemo(() => {
    if (!scopeConstraints) return null;
    const base = collection(db, COLLECTIONS.users);
    // Recherche : index (rôle, mots-clés) ; le périmètre et le statut sont appliqués à l'affichage.
    if (token) return query(base, where('role', '==', 'client'), where('searchKeywords', 'array-contains', token), orderBy('createdAt', 'desc'));
    const statusFilter = status === 'all' ? [] : [where('status', '==', status)];
    return query(base, where('role', '==', 'client'), ...scopeConstraints, ...statusFilter, orderBy('createdAt', 'desc'));
  }, [scopeConstraints, status, token]);
  const page = useInfiniteCollection<UserProfile>(listQuery, { pageSize: 100 });

  const rows = useMemo(() => {
    if (!token) return page.data;
    return page.data.filter(
      (u) =>
        (status === 'all' || u.status === status) &&
        (!scope.cityIds || (u.cityId && scope.cityIds.includes(u.cityId))) &&
        (!scope.countryId || u.countryId === scope.countryId),
    );
  }, [page.data, token, status, scope.cityIds, scope.countryId]);

  const since = useMemo(() => Timestamp.fromMillis(Date.now() - 30 * 86_400_000), []);
  const countQueries = useMemo(() => {
    if (!scopeConstraints) return { total: null, blocked: null, recent: null };
    const base = collection(db, COLLECTIONS.users);
    return {
      total: query(base, where('role', '==', 'client'), ...scopeConstraints),
      blocked: query(base, where('role', '==', 'client'), ...scopeConstraints, where('status', '==', 'blocked')),
      recent: query(base, where('role', '==', 'client'), ...scopeConstraints, where('createdAt', '>=', since)),
    };
  }, [scopeConstraints, since]);
  const total = useCount(countQueries.total);
  const walletTotal = useWalletTotal(countQueries.total);
  const blocked = useCount(countQueries.blocked);
  const recent = useCount(countQueries.recent);
  const cityName = useMemo(() => new Map(scope.cities.map((c) => [c.id, c.name])), [scope.cities]);

  const columns = useMemo(
    () => [
      column.accessor('displayName', {
        header: 'Client',
        cell: (info) => {
          const u = info.row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={u.displayName} src={u.avatar?.url} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{u.displayName}</p>
                <p className="truncate text-xs text-fg-subtle">{displayEmail(u.email, full)}</p>
              </div>
            </div>
          );
        },
      }),
      column.accessor((u) => u.phone ?? '', {
        id: 'phone',
        header: 'Téléphone',
        enableSorting: false,
        meta: { className: 'hidden 2xl:table-cell' },
        cell: (info) => <span className="whitespace-nowrap font-mono text-xs text-fg-muted">{displayPhone(info.getValue(), full)}</span>,
      }),
      column.accessor((u) => (u.cityId ? (cityName.get(u.cityId) ?? u.cityId) : '—'), { id: 'city', header: 'Ville', meta: { className: 'hidden md:table-cell' }, cell: (info) => <span className="text-sm text-fg-muted">{info.getValue()}</span> }),
      column.accessor((u) => u.stats?.ordersCount ?? 0, { id: 'orders', header: 'Commandes', meta: { align: 'right' }, cell: (info) => <span className="font-mono text-sm num">{formatNumber(info.getValue())}</span> }),
      column.accessor((u) => u.stats?.totalSpentCents ?? 0, {
        id: 'spent',
        header: 'Dépenses',
        meta: { align: 'right', className: 'hidden sm:table-cell' },
        cell: (info) => <span className="font-mono text-sm font-medium num">{eur(info.getValue())}</span>,
      }),
      column.accessor((u) => u.walletBalanceCents ?? 0, {
        id: 'wallet',
        header: 'Avoir',
        meta: { align: 'right', className: 'hidden xl:table-cell' },
        cell: (info) => <span className={`font-mono text-sm num ${info.getValue() ? 'text-fg' : 'text-fg-subtle'}`}>{info.getValue() ? eur(info.getValue()) : '—'}</span>,
      }),
      column.accessor((u) => toDate(u.stats?.lastOrderAt)?.getTime() ?? 0, {
        id: 'last',
        header: 'Dernière commande',
        meta: { className: 'hidden xl:table-cell' },
        cell: (info) => <span className="text-sm text-fg-muted">{info.getValue() ? formatRelative(info.getValue()) : 'Jamais'}</span>,
      }),
      column.accessor((u) => riskOf(u).level, {
        id: 'risk',
        header: 'Risque',
        meta: { className: 'hidden lg:table-cell' },
        cell: (info) => <StatusBadge status={info.getValue()} map={RISK_META} />,
      }),
      column.accessor('status', { header: 'Statut', cell: (info) => <StatusBadge status={info.getValue()} map={CUSTOMER_STATUS_META} /> }),
    ],
    [full, cityName],
  );

  // Cahier §7 « Liste et filtres / export » (cdc-fix-residuals-26) : l'export CSV contient des
  // données personnelles (e-mail, téléphone non masqués selon le rôle, dépenses, avoirs) mais
  // n'exigeait aucun droit `exports.run` ni aucune trace au journal d'audit — même défaut déjà
  // corrigé pour les livreurs (`cdc-fix-residuals-3`), jamais appliqué aux clients. Corrigé : le
  // bouton n'apparaît plus sans ce droit, et chaque export réel est audité côté serveur avant le
  // téléchargement.
  async function exportRows(list: Row[]) {
    try {
      await auditCustomersExport({ userIds: list.map((u) => u.id), reason: `Export CSV clients (${list.length} ligne${list.length > 1 ? 's' : ''})` });
    } catch {
      toast.error("Vous n'avez pas le droit d'exporter cette liste.");
      return;
    }
    downloadCsv(
      {
        name: 'Clients',
        columns: [
          { header: 'Identifiant' },
          { header: 'Nom' },
          { header: full ? 'E-mail' : 'E-mail (masqué)' },
          { header: full ? 'Téléphone' : 'Téléphone (masqué)' },
          { header: 'Ville' },
          { header: 'Commandes', kind: 'number' },
          { header: 'Dépenses', kind: 'money' },
          { header: 'Avoir', kind: 'money' },
          { header: 'Statut' },
          { header: 'Inscription' },
        ],
        rows: list.map((u) => [
          u.id,
          u.displayName,
          displayEmail(u.email, full),
          displayPhone(u.phone, full),
          u.cityId ? (cityName.get(u.cityId) ?? u.cityId) : '',
          u.stats?.ordersCount ?? 0,
          u.stats?.totalSpentCents ?? 0,
          u.walletBalanceCents ?? 0,
          CUSTOMER_STATUS_META[u.status]?.label ?? u.status,
          toDate(u.createdAt)?.toLocaleDateString('fr-FR') ?? '',
        ]),
      },
      `clients-${todayStamp()}`,
    );
    toast.success(`${plural(list.length, 'client exporté', 'clients exportés')}`);
  }

  const bulkActions: DataTableBulkAction<Row>[] = [];
  if (can('exports.run')) bulkActions.push({ label: 'Exporter', icon: <Download />, onClick: (list) => void exportRows(list) });
  if (can('customers.block')) bulkActions.push({ label: 'Bloquer', icon: <Ban />, destructive: true, onClick: (list, clear) => setBlocking({ rows: list.filter((u) => u.status === 'active'), clear }) });

  return (
    <PageContainer wide>
      <PageHeader eyebrow="Acteurs" title="Clients" description="Consultation des comptes pour le support et la lutte contre les abus : historique, avoirs, blocage, suppression RGPD.">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SegmentedControl
            aria-label="Statut des comptes"
            value={status}
            onValueChange={(v) => setStatus(v as Status)}
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'active', label: 'Actifs' },
              { value: 'blocked', label: 'Bloqués' },
              { value: 'deleted', label: 'Supprimés' },
            ]}
          />
          <Input
            leading={<Search />}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nom, e-mail ou téléphone…"
            aria-label="Rechercher un client"
            className="w-full md:w-80"
          />
        </div>
      </PageHeader>

      {page.error ? (
        <ErrorPanel error={page.error} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Clients" value={total === null ? '…' : formatNumber(total)} icon={<Users />} loading={total === null && !!scopeConstraints} />
            <StatCard label="Nouveaux (30 j)" value={recent === null ? '…' : formatNumber(recent)} icon={<UserPlus />} tone="info" loading={recent === null && !!scopeConstraints} />
            <StatCard label="Comptes bloqués" value={blocked === null ? '…' : formatNumber(blocked)} icon={<Ban />} tone="danger" loading={blocked === null && !!scopeConstraints} onClick={() => setStatus('blocked')} />
            <StatCard
              label="Avoirs en circulation"
              value={walletTotal === null ? '…' : eur(walletTotal)}
              icon={<Gift />}
              tone="brand"
              loading={walletTotal === null && !!scopeConstraints}
              footer="Solde cumulé des porte-monnaie clients"
            />
          </div>
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(u) => u.id}
            loading={page.loading}
            searchable={false}
            itemLabel="clients"
            pageSize={25}
            onRowClick={(u) => navigate(`/clients/${u.id}`)}
            bulkActions={bulkActions}
            emptyState={
              token ? (
                <EmptyState compact icon={<Search />} title="Aucun client trouvé" description="Vérifiez l’orthographe, ou cherchez par e-mail ou numéro de téléphone." />
              ) : (
                <EmptyState compact icon={<Wallet />} title="Aucun client dans ce périmètre" description="Les comptes créés depuis l’application client apparaîtront ici." />
              )
            }
          />
          {page.hasMore && (
            <div className="flex justify-center">
              <Button variant="secondary" size="sm" leftIcon={<ChevronDown />} loading={page.loadingMore} onClick={page.loadMore}>
                Charger 100 clients de plus
              </Button>
            </div>
          )}
        </div>
      )}
      <BlockCustomerDialog
        users={blocking?.rows ?? []}
        blocked
        open={Boolean(blocking)}
        onOpenChange={(o) => !o && setBlocking(null)}
        onDone={() => blocking?.clear()}
      />
    </PageContainer>
  );
}
