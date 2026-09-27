import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { Ban, Bike, CheckCircle2, Clock, MailPlus, PauseCircle, PlayCircle, Timer, Truck, UserCheck } from 'lucide-react';
import { subDays, startOfDay } from 'date-fns';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  Skeleton,
  StatCard,
  StatusPill,
  Switch,
  Textarea,
  createColumnHelper,
  formatDateTime,
  formatNumber,
  formatRelative,
  type DataTableFilter,
} from '@golink/ui';
import { useDocumentTitle, useTranslation } from '@golink/web';
import {
  COLLECTIONS,
  RESTAURANT_COURIER_STATUS_LABELS,
  SETTINGS_DOCS,
  VEHICLE_LABELS,
  paths,
  type Order,
  type PaymentSettings,
  type RestaurantCourier,
  type RestaurantCourierStatus,
  type RestaurantDeliveryZone,
  type WithId,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { callFunction, collectionAt, docAt, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { Callout, DetailRow, ErrorPanel } from '../finances/components/States';
import { plural, ratioLabel } from '../finances/lib/format';
import { useOrdersInRange } from '../finances/lib/hooks';
import { CashPanel } from './CashPanel';
import { InviteCourierDialog } from './InviteCourierDialog';

const updateCourier = callFunction<
  { restaurantId: string; driverIds: string[]; status?: RestaurantCourierStatus; reason?: string; note?: string | null; zoneIds?: string[] },
  { updated: number; statusChanged: number }
>('updateCourier');

interface Perf {
  deliveries: number;
  onTime: number;
  minutes: number[];
  active: number;
}
type Row = WithId<RestaurantCourier> & { perf: Perf };

const STATUS_TONES = { active: 'success', inactive: 'neutral', blocked: 'danger' } as const;
const column = createColumnHelper<Row>();

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** Livreurs : livreurs GoLink ayant livré pour vous et livreurs propres de l'établissement. */
export function LivreursPage() {
  useDocumentTitle('Livreurs · GoLink Restaurant');
  const navigate = useNavigate();
  const { driverId } = useParams();
  const { restaurant, restaurantId } = useRestaurantAccess();
  const [tab, setTab] = useState<'all' | 'platform' | 'own'>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [blockTarget, setBlockTarget] = useState<Row[] | null>(null);

  const couriers = useCollection<RestaurantCourier>(query(collectionAt(paths.restaurantSub(restaurantId, 'couriers')), limit(500)));
  const zones = useCollection<RestaurantDeliveryZone>(query(collectionAt(paths.restaurantSub(restaurantId, 'deliveryZones')), orderBy('order', 'asc')));
  const platformPayments = useDoc<PaymentSettings>(docAt(paths.settings(SETTINGS_DOCS.payments)));
  const cashLimitCents = platformPayments.data?.cash?.driverCashLimitCents ?? 15_000;
  const [range] = useState(() => ({ start: startOfDay(subDays(new Date(), 29)), end: startOfDay(subDays(new Date(), -1)) }));
  const orders = useOrdersInRange(restaurantId, range.start, range.end);

  const perfByDriver = useMemo(() => {
    const map = new Map<string, Perf>();
    for (const order of orders.data) {
      const id = order.driverId ?? order.delivery?.driverId;
      if (!id) continue;
      const perf = map.get(id) ?? { deliveries: 0, onTime: 0, minutes: [], active: 0 };
      if (order.status === 'delivered') {
        perf.deliveries += 1;
        if (!order.flags?.late) perf.onTime += 1;
        const picked = toDate(order.timeline?.picked_up);
        const delivered = toDate(order.timeline?.delivered);
        if (picked && delivered) perf.minutes.push(Math.round((delivered.getTime() - picked.getTime()) / 60_000));
      } else if (order.status === 'assigned' || order.status === 'picked_up') perf.active += 1;
      map.set(id, perf);
    }
    return map;
  }, [orders.data]);

  const rows = useMemo<Row[]>(
    () =>
      couriers.data
        .map((c) => ({ ...c, perf: perfByDriver.get(c.id) ?? { deliveries: 0, onTime: 0, minutes: [], active: 0 } }))
        .sort((a, b) => (a.relation === b.relation ? b.perf.deliveries - a.perf.deliveries || b.deliveriesCount - a.deliveriesCount : a.relation === 'own' ? -1 : 1)),
    [couriers.data, perfByDriver],
  );
  const visible = tab === 'all' ? rows : rows.filter((r) => r.relation === tab);
  const own = rows.filter((r) => r.relation === 'own');
  const allPerf = [...perfByDriver.values()];
  const deliveries30 = allPerf.reduce((s, p) => s + p.deliveries, 0);
  const onTime30 = allPerf.reduce((s, p) => s + p.onTime, 0);
  const minutes30 = median(allPerf.flatMap((p) => p.minutes));
  const activeNow = allPerf.reduce((s, p) => s + p.active, 0);
  const selected = rows.find((r) => r.id === driverId) ?? null;
  const zoneName = new Map(zones.data.map((z) => [z.id, z]));

  const bulk = useMutation(
    (input: { ids: string[]; status: RestaurantCourierStatus; reason?: string }) => updateCourier({ restaurantId, driverIds: input.ids, status: input.status, ...(input.reason ? { reason: input.reason } : {}) }),
    { success: (r) => (r.statusChanged ? `${plural(r.statusChanged, 'livreur mis à jour', 'livreurs mis à jour')}.` : 'Aucun changement de statut.') },
  );

  const columns = useMemo(
    () => [
      column.accessor('displayName', {
        header: 'Livreur',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={info.getValue()} size="sm" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                  {info.getValue()}
                  {row.invitation?.status === 'pending' && <Badge tone="amber" size="sm">Invitation envoyée</Badge>}
                </p>
                <p className="truncate text-xs text-fg-subtle">
                  {row.relation === 'own' ? 'Livreur de l’établissement' : 'Flotte GoLink'}
                  {row.vehicle ? ` · ${VEHICLE_LABELS[row.vehicle]}` : ''}
                </p>
              </div>
            </div>
          );
        },
      }),
      column.accessor((row) => row.perf.deliveries, {
        id: 'deliveries30',
        header: 'Livraisons 30 j',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm num">{formatNumber(info.getValue())}</span>,
      }),
      column.accessor((row) => (row.perf.deliveries ? row.perf.onTime / row.perf.deliveries : -1), {
        id: 'ontime',
        header: 'À l’heure',
        meta: { align: 'right', className: 'hidden md:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{info.getValue() < 0 ? '—' : ratioLabel(info.getValue())}</span>,
      }),
      column.accessor((row) => median(row.perf.minutes) ?? -1, {
        id: 'minutes',
        header: 'Trajet médian',
        meta: { align: 'right', className: 'hidden lg:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{info.getValue() < 0 ? '—' : `${info.getValue()} min`}</span>,
      }),
      column.accessor('deliveriesCount', {
        header: 'Total',
        meta: { align: 'right', className: 'hidden lg:table-cell' },
        cell: (info) => <span className="font-mono text-sm text-fg-muted num">{formatNumber(info.getValue())}</span>,
      }),
      column.accessor((row) => toDate(row.lastDeliveryAt)?.getTime() ?? 0, {
        id: 'last',
        header: 'Dernière livraison',
        meta: { className: 'hidden md:table-cell' },
        cell: (info) => <span className="text-sm text-fg-muted">{info.getValue() ? formatRelative(info.getValue()) : 'Jamais'}</span>,
      }),
      column.accessor('status', {
        header: 'Statut',
        cell: (info) => <StatusPill tone={STATUS_TONES[info.getValue()]}>{RESTAURANT_COURIER_STATUS_LABELS[info.getValue()]}</StatusPill>,
      }),
    ],
    [],
  );

  const filters: DataTableFilter<Row>[] = [
    {
      id: 'status',
      label: 'Statut',
      options: (['active', 'inactive', 'blocked'] as const).map((s) => ({ value: s, label: RESTAURANT_COURIER_STATUS_LABELS[s] })),
      getValue: (row) => row.status,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Clients & livreurs"
        title="Livreurs"
        description="Suivez les livreurs qui livrent vos commandes, écartez ceux qui ne vous conviennent pas et gérez vos propres livreurs."
        actions={
          <Button leftIcon={<MailPlus />} onClick={() => setInviteOpen(true)}>
            Inviter un livreur
          </Button>
        }
      >
        <SegmentedControl
          aria-label="Type de livreurs"
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: 'all', label: 'Tous', count: rows.length },
            { value: 'platform', label: 'Flotte GoLink', count: rows.length - own.length },
            { value: 'own', label: 'Mes livreurs', count: own.length },
          ]}
        />
      </PageHeader>

      {couriers.error ? (
        <ErrorPanel error={couriers.error} />
      ) : (
        <div className="space-y-6">
          {restaurant.deliveredBy === 'platform' && (
            <Callout tone="info" icon={<Truck />} title="Vos commandes sont livrées par la flotte GoLink">
              Vos livreurs propres pourront recevoir vos courses dès que la livraison par vos soins sera activée dans{' '}
              <Link to="/reglages-commandes" className="font-medium text-fg underline underline-offset-2">
                Réglages des commandes
              </Link>
              . Un livreur bloqué n’est plus jamais proposé pour vos commandes.
            </Callout>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Livreurs disponibles" value={formatNumber(rows.filter((r) => r.status === 'active').length)} icon={<UserCheck />} loading={couriers.loading} footer={`${plural(rows.filter((r) => r.status === 'blocked').length, 'bloqué')} · ${plural(own.length, 'livreur propre', 'livreurs propres')}`} />
            <StatCard label="Livraisons (30 j)" value={formatNumber(deliveries30)} icon={<Bike />} tone="info" loading={orders.loading} footer={`${plural(activeNow, 'course en cours', 'courses en cours')}`} />
            <StatCard label="Ponctualité" value={deliveries30 ? ratioLabel(onTime30 / deliveries30) : '—'} icon={<Clock />} tone="success" loading={orders.loading} footer="Livraisons dans le créneau promis" />
            <StatCard label="Trajet médian" value={minutes30 !== null ? `${minutes30} min` : '—'} icon={<Timer />} tone="amber" loading={orders.loading} footer="De la récupération à la remise au client" />
          </div>

          <CashPanel restaurantId={restaurantId} couriers={own} limitCents={cashLimitCents} />

          <DataTable
            data={visible}
            columns={columns}
            getRowId={(row) => row.id}
            loading={couriers.loading}
            filters={filters}
            searchPlaceholder="Rechercher un livreur…"
            itemLabel="livreurs"
            pageSize={15}
            onRowClick={(row) => navigate(`/livreurs/${row.id}`)}
            bulkActions={[
              { label: 'Rendre disponible', icon: <PlayCircle />, onClick: (list, clear) => void bulk.mutate({ ids: list.map((r) => r.id), status: 'active' }).then((r) => r && clear()) },
              { label: 'Rendre indisponible', icon: <PauseCircle />, onClick: (list, clear) => void bulk.mutate({ ids: list.map((r) => r.id), status: 'inactive' }).then((r) => r && clear()) },
              { label: 'Bloquer', icon: <Ban />, destructive: true, onClick: (list) => setBlockTarget(list.filter((r) => r.status !== 'blocked')) },
            ]}
            emptyState={
              tab === 'own' ? (
                <EmptyState
                  compact
                  icon={<Bike />}
                  title="Aucun livreur propre"
                  description="Invitez vos livreurs : ils recevront vos courses dans l’application GoLink Livreur."
                  action={<Button size="sm" leftIcon={<MailPlus />} onClick={() => setInviteOpen(true)}>Inviter un livreur</Button>}
                />
              ) : (
                <EmptyState compact icon={<Bike />} title="Aucun livreur pour le moment" description="Les livreurs GoLink apparaissent ici après leur première livraison pour vous." />
              )
            }
          />
          {orders.error && <p className="text-xs text-fg-subtle">Les indicateurs de performance ne sont pas disponibles pour le moment.</p>}
        </div>
      )}

      <Sheet open={Boolean(driverId)} onOpenChange={(open) => !open && navigate('/livreurs')}>
        <SheetContent className="sm:max-w-xl">
          {selected ? (
            <CourierDetail key={selected.id} courier={selected} zones={zones.data} zoneName={zoneName} onBlock={() => setBlockTarget([selected])} onResend={() => setInviteOpen(true)} />
          ) : (
            <>
              <SheetHeader title="Livreur" />
              <SheetBody>{couriers.loading ? <Skeleton className="h-40 w-full" /> : <EmptyState compact title="Livreur introuvable" description="Ce livreur n’a jamais livré pour cet établissement." />}</SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>

      <InviteCourierDialog open={inviteOpen} onOpenChange={setInviteOpen} restaurantId={restaurantId} zones={zones.data.filter((z) => z.enabled)} />

      <ConfirmDialog
        open={Boolean(blockTarget)}
        onOpenChange={(open) => !open && setBlockTarget(null)}
        destructive
        requireReason
        reasonLabel="Motif du blocage (conservé dans le journal d’audit)"
        title={blockTarget?.length === 1 ? `Bloquer ${blockTarget[0]?.displayName} ?` : `Bloquer ${plural(blockTarget?.length ?? 0, 'livreur')} ?`}
        description="Un livreur bloqué ne sera plus proposé pour vos commandes. Les courses déjà attribuées ne sont pas modifiées."
        confirmLabel="Bloquer"
        onConfirm={async (reason) => {
          const ids = (blockTarget ?? []).map((r) => r.id);
          if (ids.length) await bulk.mutate({ ids, status: 'blocked', reason });
          setBlockTarget(null);
        }}
      />
    </PageContainer>
  );
}

function CourierDetail({
  courier,
  zones,
  zoneName,
  onBlock,
  onResend,
}: {
  courier: Row;
  zones: WithId<RestaurantDeliveryZone>[];
  zoneName: Map<string, WithId<RestaurantDeliveryZone>>;
  onBlock: () => void;
  onResend: () => void;
}) {
  const { restaurantId } = useRestaurantAccess();
  const { label: tLabel } = useTranslation();
  const [note, setNote] = useState(courier.note ?? '');
  const [zoneIds, setZoneIds] = useState<string[]>(courier.zoneIds ?? []);
  const missions = useCollection<Order>(
    query(collectionAt(COLLECTIONS.orders), where('restaurantId', '==', restaurantId), where('driverId', '==', courier.id), orderBy('createdAt', 'desc'), limit(20)),
  );
  const save = useMutation(
    (input: { status?: RestaurantCourierStatus; note?: string | null; zoneIds?: string[] }) => updateCourier({ restaurantId, driverIds: [courier.id], ...input }),
    { success: 'Livreur mis à jour.' },
  );
  const invitedAt = toDate(courier.invitation?.sentAt);
  const zonesChanged = JSON.stringify([...zoneIds].sort()) !== JSON.stringify([...(courier.zoneIds ?? [])].sort());
  const m = median(courier.perf.minutes);

  return (
    <>
      <SheetHeader
        title={courier.displayName}
        description={`${courier.relation === 'own' ? 'Livreur de l’établissement' : 'Livreur de la flotte GoLink'}${courier.vehicle ? ` · ${VEHICLE_LABELS[courier.vehicle]}` : ''}`}
        icon={<Avatar name={courier.displayName} size="sm" />}
      />
      <SheetBody className="space-y-6">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-4">
          <div>
            <p className="text-sm font-medium text-fg">Disponible pour vos commandes</p>
            <p className="text-xs text-fg-muted">
              {courier.status === 'blocked'
                ? `Bloqué${courier.blockedReason ? ` : ${courier.blockedReason}` : ''}`
                : courier.status === 'active'
                  ? 'Peut recevoir vos courses.'
                  : 'Écarté temporairement de vos courses.'}
            </p>
          </div>
          <Switch
            aria-label="Disponible pour vos commandes"
            checked={courier.status === 'active'}
            disabled={courier.status === 'blocked' || save.loading}
            onCheckedChange={(checked) => void save.mutate({ status: checked ? 'active' : 'inactive' })}
          />
        </div>

        {courier.invitation?.status === 'pending' && (
          <Callout
            tone="amber"
            icon={<MailPlus />}
            title="Invitation en attente"
            action={
              <Button size="sm" variant="secondary" onClick={onResend}>
                Renvoyer
              </Button>
            }
          >
            Envoyée {invitedAt ? formatRelative(invitedAt) : ''} à {courier.emailMasked ?? 'son adresse'}.{' '}
            {courier.invitation.emailSent ? '' : 'L’e-mail n’a pas pu partir.'}
          </Callout>
        )}

        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border">
          {[
            { label: 'Livraisons 30 j', value: formatNumber(courier.perf.deliveries) },
            { label: 'À l’heure', value: courier.perf.deliveries ? ratioLabel(courier.perf.onTime / courier.perf.deliveries) : '—' },
            { label: 'Trajet médian', value: m !== null ? `${m} min` : '—' },
          ].map((item, i) => (
            <div key={item.label} className={i ? 'border-l border-border p-3' : 'p-3'}>
              <p className="text-xs text-fg-subtle">{item.label}</p>
              <p className="mt-1 font-display text-lg font-semibold tracking-tight text-fg num">{item.value}</p>
            </div>
          ))}
        </div>

        <section className="divide-y divide-border">
          <DetailRow label="Livraisons pour vous" value={formatNumber(courier.deliveriesCount)} />
          <DetailRow label="Dernière livraison" value={<span className="font-sans">{toDate(courier.lastDeliveryAt) ? formatDateTime(toDate(courier.lastDeliveryAt) as Date) : 'Jamais'}</span>} />
          {courier.phoneMasked && <DetailRow label="Téléphone" value={courier.phoneMasked} />}
        </section>

        {courier.relation === 'own' && (
          <section>
            <p className="eyebrow mb-2">Zones de livraison</p>
            {zones.length === 0 ? (
              <p className="text-sm text-fg-muted">
                Aucune zone propre définie.{' '}
                <Link to="/zones" className="font-medium text-primary-soft-fg hover:underline">
                  Créer une zone
                </Link>
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {zones.map((zone) => (
                  <label key={zone.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2">
                    <Checkbox checked={zoneIds.includes(zone.id)} onCheckedChange={(v) => setZoneIds((ids) => (v === true ? [...ids, zone.id] : ids.filter((id) => id !== zone.id)))} />
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: zoneName.get(zone.id)?.color }} />
                    <span className="truncate">{zone.name}</span>
                    {!zone.enabled && <Badge size="sm">Désactivée</Badge>}
                  </label>
                ))}
              </div>
            )}
            {zonesChanged && (
              <Button size="sm" className="mt-2" loading={save.loading} onClick={() => void save.mutate({ zoneIds })}>
                Enregistrer les zones
              </Button>
            )}
          </section>
        )}

        <section>
          <p className="eyebrow mb-2">Note interne</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Ponctuel, sac isotherme, préfère les soirs…" aria-label="Note interne sur le livreur" />
          {note !== (courier.note ?? '') && (
            <Button size="sm" className="mt-2" loading={save.loading} onClick={() => void save.mutate({ note: note.trim() || null })}>
              Enregistrer la note
            </Button>
          )}
        </section>

        <section>
          <p className="eyebrow mb-2">Dernières missions</p>
          {missions.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : missions.error ? (
            <ErrorPanel compact error={missions.error} />
          ) : missions.data.length === 0 ? (
            <EmptyState compact title="Aucune mission" description="Ce livreur n’a pas encore livré pour vous." />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {missions.data.map((order) => {
                const at = toDate(order.timeline?.placedAt ?? order.createdAt);
                return (
                  <li key={order.id}>
                    <Link to={`/commandes/${order.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-2">
                      <div className="min-w-0">
                        <p className="font-mono font-medium text-fg">{order.number}</p>
                        <p className="truncate text-xs text-fg-subtle">
                          {order.customerName} · {at ? formatDateTime(at) : ''}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
                        {order.flags?.late ? <Clock className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                        {tLabel('ORDER_STATUS_LABELS', order.status)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </SheetBody>
      <SheetFooter>
        {courier.status === 'blocked' ? (
          <Button variant="secondary" loading={save.loading} onClick={() => void save.mutate({ status: 'active' })}>
            Débloquer le livreur
          </Button>
        ) : (
          <Button variant="danger-soft" leftIcon={<Ban />} onClick={onBlock}>
            Bloquer le livreur
          </Button>
        )}
      </SheetFooter>
    </>
  );
}
