// Toutes les commandes (cahier §8) : recherche par numéro, commerce, client ou livreur ;
// filtres par date, statut, paiement, mode, zone et signalements ; pagination serveur.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, ChevronDown, Clock, Filter, Flag, Receipt, RefreshCw, Search, Undo2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Combobox,
  DateRangePicker,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  cn,
  formatDateTime,
  formatEUR,
  formatNumber,
  type DateRange,
} from '@golink/ui';
import {
  CANCEL_REASON_LABELS,
  FULFILLMENT_LABELS,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  type AdminOrderRow,
  type FulfillmentMode,
  type ListOrdersAdminInput,
  type OrderStatus,
  type PaymentMethod,
} from '@golink/shared';
import { useGeoScope } from '@/layout/GeoScope';
import { errorMessage } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useNames, useScopedZones } from '../_operations/hooks';
import { LoadError, OrderStatusPill } from '../_operations/ui';
import { OrdersShell } from './shell';
import { useTranslation } from '@golink/web';

const PERIODS = [
  { value: 'today', label: 'Aujourd’hui', days: 0 },
  { value: '7d', label: '7 derniers jours', days: 7 },
  { value: '30d', label: '30 derniers jours', days: 30 },
  { value: '90d', label: '90 derniers jours', days: 90 },
  { value: 'all', label: 'Tout l’historique', days: null },
  { value: 'custom', label: 'Période personnalisée', days: null },
] as const;

type FlagKey = 'late' | 'refunded' | 'disputed';
const FLAG_LABELS: Record<FlagKey, string> = { late: 'En retard', refunded: 'Remboursées', disputed: 'En litige' };

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function OrdersPage() {
  const { label: tLabel } = useTranslation();
  const geo = useGeoScope();
  const names = useNames();
  const zones = useScopedZones();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [searchText, setSearchText] = useState(params.get('q') ?? '');
  const search = params.get('q') ?? '';
  const period = params.get('periode') ?? '30d';
  const statuses = (params.get('statut')?.split(',').filter(Boolean) ?? []) as OrderStatus[];
  const payment = (params.get('paiement') ?? '') as PaymentMethod | '';
  const fulfillment = (params.get('mode') ?? '') as FulfillmentMode | '';
  const zoneId = params.get('zone') ?? '';
  const flags = (params.get('signal')?.split(',').filter(Boolean) ?? []) as FlagKey[];
  const restaurantId = params.get('commerce') ?? '';
  const driverId = params.get('livreur') ?? '';
  const customerId = params.get('client') ?? '';
  const [custom, setCustom] = useState<DateRange | undefined>(() => {
    const from = params.get('du');
    const to = params.get('au');
    return from && to ? { from: new Date(from), to: new Date(to) } : undefined;
  });

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  // Recherche différée pendant la saisie.
  useEffect(() => {
    const t = window.setTimeout(() => searchText.trim() !== search && update({ q: searchText.trim() || null }), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const range = useMemo(() => {
    if (period === 'custom' && custom?.from) {
      const to = new Date(custom.to ?? custom.from);
      to.setHours(23, 59, 59, 999);
      const from = new Date(custom.from);
      from.setHours(0, 0, 0, 0);
      return { from: from.getTime(), to: to.getTime() };
    }
    const p = PERIODS.find((x) => x.value === period);
    if (!p || p.days === null) return { from: null, to: null };
    return { from: p.days === 0 ? startOfToday() : Date.now() - p.days * 86_400_000, to: null };
  }, [period, custom]);

  const input = useMemo<ListOrdersAdminInput>(
    () => ({
      countryId: geo.countryId,
      cityIds: geo.cityIds,
      statuses: statuses.length ? statuses : null,
      paymentMethod: payment || null,
      fulfillment: fulfillment || null,
      zoneId: zoneId || null,
      restaurantId: restaurantId || null,
      driverId: driverId || null,
      customerId: customerId || null,
      search: search || null,
      from: range.from,
      to: range.to,
      flags: flags.length ? flags : null,
      pageSize: 30,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo.countryId, geo.cityIds?.join(','), statuses.join(','), payment, fulfillment, zoneId, restaurantId, driverId, customerId, search, range.from, range.to, flags.join(',')],
  );
  const key = JSON.stringify(input);
  const [state, setState] = useState<{ rows: AdminOrderRow[]; cursor: string | null; total: number | null; loading: boolean; more: boolean; error: unknown; scanned: number }>({
    rows: [],
    cursor: null,
    total: null,
    loading: true,
    more: false,
    error: null,
    scanned: 0,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn.listOrdersAdmin(input)
      .then((r) => alive && setState({ rows: r.rows, cursor: r.nextCursor, total: r.total, loading: false, more: false, error: null, scanned: r.scanned }))
      .catch((error: unknown) => alive && setState((s) => ({ ...s, loading: false, error })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  async function loadMore() {
    if (!state.cursor) return;
    setState((s) => ({ ...s, more: true }));
    try {
      const r = await fn.listOrdersAdmin({ ...input, cursor: state.cursor });
      setState((s) => ({ ...s, rows: [...s.rows, ...r.rows], cursor: r.nextCursor, more: false }));
    } catch (error) {
      setState((s) => ({ ...s, more: false, error }));
    }
  }

  const activeFilters = [statuses.length, payment, fulfillment, zoneId, flags.length, restaurantId, driverId, customerId].filter(Boolean).length;
  const [showFilters, setShowFilters] = useState(activeFilters > 0);

  return (
    <OrdersShell
      documentTitle="Commandes"
      title="Commandes"
      description="Toutes les commandes de la plateforme. Ouvrez une commande pour un litige : contenu, chronologie, répartition de l’argent."
      actions={
        <Tooltip content="Actualiser">
          <Button variant="secondary" leftIcon={<RefreshCw className={cn(state.loading && 'animate-spin')} />} onClick={() => setNonce((n) => n + 1)}>
            Actualiser
          </Button>
        </Tooltip>
      }
    >
      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            leading={<Search />}
            trailing={searchText ? <button type="button" aria-label="Effacer" onClick={() => setSearchText('')}><X /></button> : undefined}
            placeholder="Numéro (GL-…), commerce, client, adresse…"
            aria-label="Rechercher une commande"
            className="w-full lg:w-80"
          />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select aria-label="Période" value={period} onValueChange={(v) => update({ periode: v === '30d' ? null : v })} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} className="w-full sm:w-52" />
            {period === 'custom' && (
              <DateRangePicker
                value={custom}
                onChange={(r) => {
                  setCustom(r);
                  if (r?.from && r.to) update({ du: r.from.toISOString().slice(0, 10), au: r.to.toISOString().slice(0, 10) });
                }}
                className="w-full sm:w-64"
              />
            )}
            <Button variant="secondary" leftIcon={<Filter />} rightIcon={<ChevronDown className={cn('transition-transform', showFilters && 'rotate-180')} />} onClick={() => setShowFilters((s) => !s)}>
              Filtres
              {activeFilters > 0 && <span className="rounded bg-primary px-1.5 font-mono text-2xs text-primary-fg num">{activeFilters}</span>}
            </Button>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" rightIcon={<X />} onClick={() => update({ statut: null, paiement: null, mode: null, zone: null, signal: null, commerce: null, livreur: null, client: null })}>
                Réinitialiser
              </Button>
            )}
          </div>
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-5">
            <Combobox
              multiple
              aria-label="Statuts"
              options={ORDER_STATUSES.map((s) => ({ value: s, label: tLabel('ORDER_STATUS_LABELS', s) }))}
              value={statuses}
              onChange={(v: string[]) => update({ statut: v.join(',') || null })}
              placeholder="Tous les statuts"
            />
            <Select
              aria-label="Paiement"
              value={payment || 'all'}
              onValueChange={(v) => update({ paiement: v === 'all' ? null : v })}
              options={[{ value: 'all', label: 'Tous les paiements' }, ...(['card', 'apple_pay', 'google_pay', 'cash', 'wallet'] as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))]}
            />
            <Select
              aria-label="Mode"
              value={fulfillment || 'all'}
              onValueChange={(v) => update({ mode: v === 'all' ? null : v })}
              options={[{ value: 'all', label: 'Livraison et retrait' }, ...(Object.keys(FULFILLMENT_LABELS) as FulfillmentMode[]).map((m) => ({ value: m, label: FULFILLMENT_LABELS[m] }))]}
            />
            <Combobox
              aria-label="Zone"
              options={zones.data.map((z) => ({ value: z.id, label: `${z.name} · ${names.city(z.cityId)}` }))}
              value={zoneId || undefined}
              onChange={(v: string | undefined) => update({ zone: v ?? null })}
              placeholder="Toutes les zones"
            />
            <Combobox
              multiple
              aria-label="Signalements"
              options={(Object.keys(FLAG_LABELS) as FlagKey[]).map((f) => ({ value: f, label: FLAG_LABELS[f] }))}
              value={flags}
              onChange={(v: string[]) => update({ signal: v.join(',') || null })}
              placeholder="Tous les signalements"
            />
          </div>
        )}
        {(restaurantId || driverId || customerId) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {restaurantId && <FilterChip label="Commerce filtré" onClear={() => update({ commerce: null })} />}
            {driverId && <FilterChip label="Livreur filtré" onClear={() => update({ livreur: null })} />}
            {customerId && <FilterChip label="Client filtré" onClear={() => update({ client: null })} />}
          </div>
        )}
      </Card>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-subtle">
        <span>
          {state.loading
            ? 'Recherche…'
            : state.total !== null
              ? `${formatNumber(state.total)} commande${state.total > 1 ? 's' : ''}`
              : `${formatNumber(state.rows.length)} commande${state.rows.length > 1 ? 's' : ''} affichée${state.rows.length > 1 ? 's' : ''}${state.cursor ? ' · d’autres résultats disponibles' : ''}`}
        </span>
        <span>Fuseau Europe/Paris</span>
      </div>

      {state.error && state.rows.length === 0 ? (
        <LoadError error={state.error} onRetry={() => setNonce((n) => n + 1)} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Commande</TableHead>
                <TableHead>Commerce</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Livreur</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Paiement</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.loading && state.rows.length === 0 ? (
                Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    {Array.from({ length: 7 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-3.5 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : state.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="h-auto">
                    <EmptyState compact icon={<Receipt />} title="Aucune commande" description="Aucune commande ne correspond à ces critères. Élargissez la période ou retirez un filtre." />
                  </TableCell>
                </TableRow>
              ) : (
                state.rows.map((o) => (
                  <TableRow key={o.id} className={cn('cursor-pointer', state.loading && 'opacity-60')} onClick={() => navigate(`/commandes/${o.id}`)}>
                    <TableCell>
                      <Link to={`/commandes/${o.id}`} className="font-mono text-sm font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                        {o.number}
                      </Link>
                      <p className="whitespace-nowrap font-mono text-2xs text-fg-subtle">{formatDateTime(o.createdAt)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-48 truncate text-sm text-fg">{o.restaurantName}</p>
                      <p className="text-2xs text-fg-subtle">
                        {names.city(o.cityId)}
                        {o.zoneId ? ` · ${names.zone(o.zoneId)}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-sm text-fg-muted">{o.customerName}</TableCell>
                    <TableCell className="text-sm text-fg-muted">
                      {o.driverName ?? (o.fulfillment === 'delivery' ? (o.dispatchStatus === 'unavailable' ? <span className="text-danger">Aucun livreur</span> : o.dispatchStatus === 'searching' ? <span className="text-warning">Recherche…</span> : '—') : FULFILLMENT_LABELS[o.fulfillment])}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <OrderStatusPill status={o.status} />
                        <span className="flex gap-1">
                          {o.late && <Badge size="sm" tone="amber" icon={<Clock />}>+{o.lateMinutes} min</Badge>}
                          {o.disputed && <Badge size="sm" tone="danger" icon={<Flag />}>Litige</Badge>}
                          {o.refundedCents > 0 && <Badge size="sm" tone="info" icon={<Undo2 />}>Remb.</Badge>}
                          {o.test && <Badge size="sm" tone="neutral" variant="outline">Test</Badge>}
                        </span>
                        {o.cancelReason && <span className="text-2xs text-fg-subtle">{CANCEL_REASON_LABELS[o.cancelReason]}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-fg-muted">{PAYMENT_METHOD_LABELS[o.paymentMethod]}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm num">{formatEUR(o.totalCents, { cents: true })}</span>
                      {o.refundedCents > 0 && <p className="font-mono text-2xs text-fg-subtle">−{formatEUR(o.refundedCents, { cents: true })}</p>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {(state.cursor || Boolean(state.error)) && state.rows.length > 0 && (
            <div className="flex flex-col items-center gap-2 border-t border-border p-3">
              {state.error !== null ? <p className="inline-flex items-center gap-1.5 text-xs text-danger"><AlertTriangle className="size-3.5" />{errorMessage(state.error)}</p> : null}
              {state.cursor && (
                <Button variant="secondary" size="sm" loading={state.more} onClick={() => void loadMore()}>
                  Afficher plus
                </Button>
              )}
            </div>
          )}
        </Card>
      )}
    </OrdersShell>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-1 pl-3 pr-1.5 text-xs text-fg">
      {label}
      <button type="button" onClick={onClear} aria-label={`Retirer : ${label}`} className="grid size-5 place-items-center rounded-full hover:bg-surface-3">
        <X className="size-3" />
      </button>
    </span>
  );
}
