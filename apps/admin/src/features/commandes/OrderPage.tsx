// Détail d'une commande pour un litige (cahier §8) : contenu, prix, frais, remise,
// paiement, chronologie complète (heures de chaque étape et historique des actions),
// répartition de l'argent, attribution du livreur (propositions, candidats, intervention).
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import {
  ArrowLeft,
  Bike,
  Clock,
  CreditCard,
  Flag,
  Home,
  LifeBuoy,
  Package,
  Radar,
  Receipt,
  RotateCcw,
  Store,
  UserRound,
  UserX,
  Users,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  MapFitBounds,
  PageContainer,
  Skeleton,
  Textarea,
  Timeline,
  cn,
  formatDateTime,
  formatEUR,
  formatTime,
  type Tone,
} from '@golink/ui';
import {
  CANCEL_REASON_LABELS,
  COLLECTIONS,
  FULFILLMENT_LABELS,
  ORDER_EVENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  VEHICLE_LABELS,
  type DispatchCandidate,
  type DispatchOffer,
  type DriverLocation,
  type Order,
  type OrderEvent,
  type OrderFinancials,
  type Restaurant,
  type WithId,
} from '@golink/shared';
import { useDocumentTitle, useTranslation } from '@golink/web';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useNames, useScopedDrivers } from '../_operations/hooks';
import { DriverDot, IconMarker, OpsMap } from '../_operations/map';
import { InfoRow, ListSkeleton, LoadError, OrderStatusPill, formatMeters, formatMinutes } from '../_operations/ui';

const euros = (cents: number | null | undefined) => formatEUR(cents ?? 0, { cents: true });

export function OrderPage() {
  const { orderId = '' } = useParams();
  const order = useDoc<Order>(docAt(`${COLLECTIONS.orders}/${orderId}`));
  useDocumentTitle(`${order.data?.number ?? 'Commande'} · Ciyou Eats Admin`);
  if (order.loading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-6 h-28 w-full rounded-xl" />
        <ListSkeleton rows={5} />
      </PageContainer>
    );
  }
  if (order.error || !order.data) {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={<Receipt />}
            title={order.error ? 'Commande inaccessible' : 'Commande introuvable'}
            description={order.error ? 'Cette commande est hors de votre périmètre.' : 'Vérifiez le numéro ou le lien.'}
            action={
              <Button asChild size="sm">
                <Link to="/commandes">Retour aux commandes</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }
  return <OrderDetail order={order.data} />;
}

function OrderDetail({ order }: { order: WithId<Order> }) {
  const { can } = useAdminAccess();
  const names = useNames();
  const created = toDate(order.createdAt);
  const flags = order.flags ?? { late: false, lateMinutes: 0, disputed: false, refunded: false, fraudSuspected: false, firstOrder: false };
  return (
    <PageContainer wide>
      <Link to="/commandes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Commandes
      </Link>
      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-2xl font-semibold tracking-tight text-fg">{order.number}</h1>
              <OrderStatusPill status={order.status} />
              {flags.late && <Badge tone="amber" icon={<Clock />}>Retard {flags.lateMinutes} min</Badge>}
              {flags.disputed && <Badge tone="danger" icon={<Flag />}>Litige</Badge>}
              {flags.fraudSuspected && <Badge tone="danger">Suspicion de fraude</Badge>}
              {flags.firstOrder && <Badge tone="plum">Première commande</Badge>}
              {order.test && <Badge tone="neutral" variant="outline">Test</Badge>}
            </div>
            <p className="mt-1.5 text-sm text-fg-muted">
              {FULFILLMENT_LABELS[order.fulfillment]} · {names.city(order.cityId)}
              {order.delivery?.zoneId ? ` · ${names.zone(order.delivery.zoneId)}` : ''} · passée le {created ? formatDateTime(created) : '—'}
              {order.scheduledFor && toDate(order.scheduledFor) ? ` · programmée pour ${formatDateTime(toDate(order.scheduledFor)!)}` : ''}
            </p>
          </div>
          <div className="text-left lg:text-right">
            <p className="font-display text-3xl font-semibold tracking-display text-fg num">{euros(order.amounts.totalCents)}</p>
            <p className="text-xs text-fg-subtle">
              {PAYMENT_METHOD_LABELS[order.payment.method]} · {PAYMENT_STATUS_LABELS[order.payment.status]}
              {order.amounts.refundedCents > 0 ? ` · ${euros(order.amounts.refundedCents)} remboursés` : ''}
            </p>
          </div>
        </div>
        {order.cancellation && (
          <div className="tone-danger mt-4 rounded-lg bg-(--tone-bg) px-3.5 py-2.5 text-sm text-(--tone-fg)">
            <p className="font-medium">{CANCEL_REASON_LABELS[order.cancellation.reason]}</p>
            <p className="text-xs opacity-90">
              {order.cancellation.details ? `${order.cancellation.details} · ` : ''}
              Remboursé : {euros(order.cancellation.refundCents)}
              {order.cancellation.restaurantChargeCents ? ` (dont ${euros(order.cancellation.restaurantChargeCents)} imputés au commerce)` : ''}
            </p>
          </div>
        )}
        {order.closedAs === 'customer_absent' && (
          <p className="tone-amber mt-4 rounded-lg bg-(--tone-bg) px-3.5 py-2.5 text-sm text-(--tone-fg)">Clôturée « client absent » : sans remboursement, livreur et commerce payés.</p>
        )}
      </Card>

      <StepDurations order={order} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Items order={order} />
          <Amounts order={order} />
          {can('finance.view') && <Financials orderId={order.id} />}
          <Chronology order={order} />
        </div>
        <div className="min-w-0 space-y-6">
          <Parties order={order} />
          {order.fulfillment === 'delivery' && <OrderMap order={order} />}
          {order.fulfillment === 'delivery' && order.delivery?.deliveredBy === 'platform' && <Dispatch order={order} />}
          <Support order={order} />
        </div>
      </div>
    </PageContainer>
  );
}

/** Durées entre les étapes (créée → acceptée → prête → récupérée → livrée). */
function StepDurations({ order }: { order: Order }) {
  const t = order.timeline;
  const at = (v: unknown) => toDate(v as never)?.getTime() ?? null;
  const steps = [
    { key: 'placedAt', label: 'Passée', time: at(t.placedAt ?? order.createdAt) },
    { key: 'accepted', label: 'Acceptée', time: at(t.accepted) },
    { key: 'ready', label: 'Prête', time: at(t.ready) },
    { key: 'picked_up', label: order.fulfillment === 'delivery' ? 'Récupérée' : 'Remise', time: at(t.picked_up) },
    ...(order.fulfillment === 'delivery' ? [{ key: 'delivered', label: 'Livrée', time: at(t.delivered) }] : []),
  ];
  return (
    <Card className="mb-6">
      <ol className="flex flex-col md:flex-row md:items-stretch">
        {steps.map((s, i) => {
          const prev = steps[i - 1]?.time ?? null;
          const done = s.time !== null;
          return (
            <li key={s.key} className={cn('relative flex-1 px-4 py-3.5', i > 0 && 'border-t border-border md:border-l md:border-t-0')}>
              <p className={cn('text-xs font-medium', done ? 'text-fg' : 'text-fg-subtle')}>{s.label}</p>
              <p className="font-mono text-sm text-fg num">{s.time ? formatTime(s.time) : '—'}</p>
              {i > 0 && (
                <p className="font-mono text-2xs text-fg-subtle">{s.time && prev ? `+ ${formatMinutes((s.time - prev) / 60_000)}` : ''}</p>
              )}
              <span className={cn('absolute inset-x-0 bottom-0 h-0.5', done ? 'bg-primary' : 'bg-transparent')} />
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Items({ order }: { order: Order }) {
  return (
    <Card>
      <CardHeader title="Contenu" description={`${order.itemsCount} article${order.itemsCount > 1 ? 's' : ''}`} icon={<Package />} divided />
      <ul className="divide-y divide-border">
        {order.items.map((item) => (
          <li key={item.lineId} className="flex gap-3 px-5 py-3">
            <span className="w-8 shrink-0 font-mono text-sm text-fg-muted num">{item.quantity}×</span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium text-fg', item.adjustment?.type === 'removed' && 'line-through opacity-60')}>{item.name}</p>
              {item.options.length > 0 && <p className="text-xs text-fg-subtle">{item.options.map((o) => `${o.name}${o.quantity > 1 ? ` ×${o.quantity}` : ''}`).join(', ')}</p>}
              {item.comment && <p className="text-xs italic text-fg-muted">« {item.comment} »</p>}
              {item.adjustment && (
                <p className="text-xs text-warning">
                  {item.adjustment.type === 'removed' ? 'Retiré' : item.adjustment.type === 'replaced' ? `Remplacé par ${item.adjustment.replacementName ?? '—'}` : 'Quantité réduite'}
                  {item.adjustment.refundCents ? ` · ${euros(item.adjustment.refundCents)} remboursés` : ''}
                </p>
              )}
            </div>
            <span className="font-mono text-sm text-fg num">{euros(item.finalTotalCents ?? item.totalCents)}</span>
          </li>
        ))}
      </ul>
      {order.customerNote && <p className="border-t border-border px-5 py-3 text-sm text-fg-muted">Note du client : « {order.customerNote} »</p>}
    </Card>
  );
}

function Line({ label, value, strong, muted, negative }: { label: string; value: number; strong?: boolean; muted?: boolean; negative?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5 text-sm', strong && 'border-t border-border pt-2.5 font-medium')}>
      <dt className={muted ? 'text-fg-subtle' : 'text-fg-muted'}>{label}</dt>
      <dd className={cn('font-mono num', strong ? 'text-fg' : 'text-fg')}>{negative && value > 0 ? '−' : ''}{euros(value)}</dd>
    </div>
  );
}

function Amounts({ order }: { order: Order }) {
  const a = order.amounts;
  return (
    <Card>
      <CardHeader title="Prix, frais et paiement" icon={<CreditCard />} divided />
      <CardContent className="grid gap-6 md:grid-cols-2">
        <dl>
          <Line label="Sous-total articles" value={a.subtotalCents} />
          {a.serviceFeeCents > 0 && <Line label="Frais de service" value={a.serviceFeeCents} />}
          {a.smallOrderFeeCents > 0 && <Line label="Petite commande" value={a.smallOrderFeeCents} />}
          {order.fulfillment === 'delivery' && <Line label="Livraison" value={a.deliveryFeeCents} />}
          {a.surgeFeeCents > 0 && <Line label="Majoration heure de pointe" value={a.surgeFeeCents} />}
          {a.discount?.totalCents > 0 && <Line label={`Remise${order.promoCode ? ` (${order.promoCode})` : ''}`} value={a.discount.totalCents} negative />}
          {a.tipCents > 0 && <Line label="Pourboire (100 % au livreur)" value={a.tipCents} />}
          {a.walletAppliedCents > 0 && <Line label="Avoir utilisé" value={a.walletAppliedCents} negative />}
          <Line label="Total" value={a.totalCents} strong />
        </dl>
        <dl>
          <InfoRow label="Moyen de paiement">{PAYMENT_METHOD_LABELS[order.payment.method]}</InfoRow>
          {order.payment.label && <InfoRow label="Carte">{order.payment.label}</InfoRow>}
          <InfoRow label="État">{PAYMENT_STATUS_LABELS[order.payment.status]}</InfoRow>
          <InfoRow label="Débité">{euros(a.chargedCents)}</InfoRow>
          <InfoRow label="Remboursé">{euros(a.refundedCents)}</InfoRow>
          {a.discount?.totalCents > 0 && (
            <InfoRow label="Remise financée">
              commerce {euros(a.discount.restaurantFundedCents)} · Ciyou Eats {euros(a.discount.platformFundedCents)}
            </InfoRow>
          )}
          {order.commission && <InfoRow label="Commission appliquée">{(order.commission.bps / 100).toLocaleString('fr-FR')} %</InfoRow>}
        </dl>
      </CardContent>
    </Card>
  );
}

function Financials({ orderId }: { orderId: string }) {
  const fin = useDoc<OrderFinancials>(docAt(`${COLLECTIONS.orderFinancials}/${orderId}`));
  if (fin.loading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (fin.error) return <LoadError error={fin.error} compact />;
  if (!fin.data) {
    return (
      <Card>
        <CardHeader title="Répartition financière" icon={<Users />} divided />
        <EmptyState compact icon={<Receipt />} title="Répartition non encore calculée" description="Elle est établie à la livraison de la commande." />
      </Card>
    );
  }
  const s = fin.data.settlement;
  const refunds = fin.data.refunds ?? [];
  return (
    <Card>
      <CardHeader title="Répartition financière" description={`Payé par le client : ${euros(s.customerPaidCents)}`} icon={<Users />} divided />
      <CardContent className="grid gap-6 md:grid-cols-3">
        <div>
          <p className="eyebrow mb-2">Commerce</p>
          <dl>
            <Line label="Ventes TTC" value={s.restaurant.grossCents} />
            {s.restaurant.discountFundedCents > 0 && <Line label="Remise financée" value={s.restaurant.discountFundedCents} negative />}
            <Line label={`Commission ${(s.restaurant.commissionBps / 100).toLocaleString('fr-FR')} % TTC`} value={s.restaurant.commissionTtcCents} negative />
            {s.restaurant.paymentFeeCents > 0 && <Line label="Frais de paiement" value={s.restaurant.paymentFeeCents} negative />}
            {refunds.reduce((a, r) => a + r.restaurantCents, 0) > 0 && <Line label="Remboursements imputés" value={refunds.reduce((a, r) => a + r.restaurantCents, 0)} negative />}
            <Line label="Reversement" value={s.restaurant.payoutCents} strong />
          </dl>
        </div>
        <div>
          <p className="eyebrow mb-2">Livreur</p>
          {s.courier ? (
            <dl>
              <Line label={s.courier.model === 'flat_then_per_km' ? 'Forfait' : 'Prise en charge'} value={(s.courier.flatCents ?? 0) + s.courier.pickupCents + s.courier.dropoffCents} />
              {s.courier.distanceCents > 0 && <Line label="Distance" value={s.courier.distanceCents} />}
              {s.courier.waitingCents > 0 && <Line label="Attente" value={s.courier.waitingCents} />}
              {s.courier.surgeBonusCents > 0 && <Line label="Bonus de pointe" value={s.courier.surgeBonusCents} />}
              {s.courier.tipCents > 0 && <Line label="Pourboire" value={s.courier.tipCents} />}
              <Line label="Total livreur" value={s.courier.totalCents} strong />
            </dl>
          ) : (
            <p className="text-sm text-fg-subtle">Pas de livreur Ciyou Eats sur cette commande.</p>
          )}
        </div>
        <div>
          <p className="eyebrow mb-2">Ciyou Eats (HT)</p>
          <dl>
            <Line label="Commission" value={s.platform.commissionHtCents} />
            {s.platform.serviceFeeHtCents > 0 && <Line label="Frais de service" value={s.platform.serviceFeeHtCents} />}
            {s.platform.deliveryFeeHtCents > 0 && <Line label="Frais de livraison" value={s.platform.deliveryFeeHtCents} />}
            {s.platform.courierCostCents > 0 && <Line label="Coût livreur" value={s.platform.courierCostCents} negative />}
            {s.platform.promoCostCents > 0 && <Line label="Promotions" value={s.platform.promoCostCents} negative />}
            {s.platform.paymentCostCents > 0 && <Line label="Frais bancaires" value={s.platform.paymentCostCents} negative />}
            <Line label="Marge" value={fin.data.finalMarginCents ?? s.platform.marginCents} strong />
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

const ACTOR_LABELS: Record<string, string> = { customer: 'Client', restaurant: 'Commerce', driver: 'Livreur', admin: 'Support Ciyou Eats', system: 'Automatique' };
const EVENT_TONES: Partial<Record<OrderEvent['type'], Tone>> = { created: 'brand', driver_assigned: 'plum', driver_unassigned: 'amber', refund_issued: 'info', credit_issued: 'info', item_removed: 'amber', item_replaced: 'amber' };

function Chronology({ order }: { order: WithId<Order> }) {
  const { label } = useTranslation();
  const q = useMemo(() => query(collection(db, `${COLLECTIONS.orders}/${order.id}/events`), orderBy('at', 'asc'), limit(200)), [order.id]);
  const events = useCollection<OrderEvent>(q);
  return (
    <Card>
      <CardHeader title="Chronologie complète" description="Chaque étape et chaque action, avec son auteur." icon={<Clock />} divided />
      <CardContent>
        {events.loading ? (
          <ListSkeleton rows={4} />
        ) : events.error ? (
          <LoadError error={events.error} compact />
        ) : events.data.length === 0 ? (
          <EmptyState compact icon={<Clock />} title="Aucun événement" />
        ) : (
          <Timeline
            items={events.data.map((e) => {
              const at = toDate(e.at);
              const statusTone: Tone | undefined = e.to === 'cancelled' ? 'danger' : e.to === 'delivered' ? 'success' : undefined;
              return {
                id: e.id,
                title: e.type === 'status_changed' && e.to ? label('ORDER_STATUS_LABELS', e.to) : ORDER_EVENT_TYPE_LABELS[e.type],
                description: [e.message, `${ACTOR_LABELS[e.actor] ?? e.actor}${e.actorName && e.actor !== 'system' ? ` · ${e.actorName}` : ''}`, e.visibleToCustomer ? null : 'interne'].filter(Boolean).join(' — '),
                time: at ? formatDateTime(at) : '',
                tone: statusTone ?? EVENT_TONES[e.type] ?? 'neutral',
              };
            })}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Parties({ order }: { order: WithId<Order> }) {
  const d = order.delivery;
  return (
    <Card>
      <CardHeader title="Intervenants" icon={<Users />} divided />
      <CardContent>
        <dl className="divide-y divide-border">
          <InfoRow label={<span className="inline-flex items-center gap-1.5"><Store className="size-3.5" />Commerce</span>}>
            <Link to={`/restaurants/${order.restaurantId}`} className="hover:underline">{order.restaurantName}</Link>
          </InfoRow>
          <InfoRow label={<span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" />Client</span>}>
            <Link to={`/clients/${order.customerId}`} className="hover:underline">{order.customerName}</Link>
            {order.customerPhoneMasked && <span className="block font-mono text-2xs font-normal text-fg-subtle">{order.customerPhoneMasked}</span>}
          </InfoRow>
          {order.fulfillment === 'delivery' && (
            <InfoRow label={<span className="inline-flex items-center gap-1.5"><Bike className="size-3.5" />Livreur</span>}>
              {order.driverId ? (
                <Link to={`/livreurs/${order.driverId}`} className="hover:underline">{d?.driverName ?? 'Livreur'}</Link>
              ) : (
                <span className="text-fg-subtle">{d?.deliveredBy === 'restaurant' ? 'Livreur du commerce' : 'Non attribué'}</span>
              )}
              {d?.driverVehicle && <span className="block text-2xs font-normal text-fg-subtle">{d.driverVehicle}</span>}
            </InfoRow>
          )}
          {d && (
            <>
              <InfoRow label={<span className="inline-flex items-center gap-1.5"><Home className="size-3.5" />Adresse</span>}>
                {d.address.line1}
                <span className="block text-2xs font-normal text-fg-subtle">{[d.address.postalCode, d.address.city].filter(Boolean).join(' ')}</span>
              </InfoRow>
              <InfoRow label="Distance">{formatMeters(d.distanceMeters)}</InfoRow>
              <InfoRow label="Livraison assurée par">{d.deliveredBy === 'platform' ? 'Flotte Ciyou Eats' : 'Le commerce'}</InfoRow>
              {d.proof && <InfoRow label="Preuve de livraison">{d.proof.type === 'code' ? 'Code' : d.proof.type === 'photo' ? 'Photo' : d.proof.type === 'signature' ? 'Signature' : 'Remise en main propre'}</InfoRow>}
            </>
          )}
          {order.fulfillment === 'pickup' && <InfoRow label="Code de retrait">{order.pickupVerified ? 'Vérifié' : 'Non vérifié'}</InfoRow>}
          <InfoRow label="Origine">{order.source?.app === 'client_web' ? 'Site client' : order.source?.app === 'admin' ? 'Super admin' : 'Application client'}</InfoRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function OrderMap({ order }: { order: WithId<Order> }) {
  const restaurant = useDoc<Restaurant>(docAt(`${COLLECTIONS.restaurants}/${order.restaurantId}`));
  const location = useDoc<DriverLocation>(order.driverId && !['delivered', 'cancelled'].includes(order.status) ? docAt(`${COLLECTIONS.driverLocations}/${order.driverId}`) : null);
  const r = restaurant.data?.address?.geo ? { lat: restaurant.data.address.geo.latitude, lng: restaurant.data.address.geo.longitude } : null;
  const c = order.delivery?.geo ? { lat: order.delivery.geo.latitude, lng: order.delivery.geo.longitude } : null;
  const dPos = location.data?.position ? { lat: location.data.position.latitude, lng: location.data.position.longitude } : null;
  const points = [r, c, dPos].filter((p): p is { lat: number; lng: number } => Boolean(p));
  if (!points.length) return null;
  return (
    <Card className="overflow-hidden">
      <OpsMap center={points[0]!} zoom={13} height={260} className="rounded-none border-0">
        <MapFitBounds points={points} padding={48} />
        {r && <IconMarker position={r} tone="brand" label={order.restaurantName}><Store /></IconMarker>}
        {c && <IconMarker position={c} tone="teal" label="Client"><Home /></IconMarker>}
        {dPos && <DriverDot position={dPos} tone="plum" label={order.delivery?.driverName ?? 'Livreur'} active />}
      </OpsMap>
    </Card>
  );
}

function Dispatch({ order }: { order: WithId<Order> }) {
  const { can } = useAdminAccess();
  const q = useMemo(() => query(collection(db, COLLECTIONS.dispatchOffers), where('orderId', '==', order.id), orderBy('offeredAt', 'desc'), limit(30)), [order.id]);
  const offers = useCollection<DispatchOffer>(q);
  const drivers = useScopedDrivers();
  const byId = new Map(drivers.data.map((d) => [d.id, d]));
  const [dialog, setDialog] = useState<'relaunch' | 'force' | 'unassign' | null>(null);
  const [candidates, setCandidates] = useState<DispatchCandidate[] | null>(null);
  const preview = useMutation(fn.previewDispatch);
  const dispatch = useMutation(fn.dispatchOrder, {
    success: (r) => (r.assigned ? `${r.driverName ?? 'Le livreur'} prend en charge la commande` : r.offered ? 'Course proposée au livreur suivant' : 'Aucun livreur disponible pour le moment'),
  });
  const d = order.delivery!;
  const open = ['accepted', 'preparing', 'ready', 'assigned'].includes(order.status);
  const intervene = can('orders.intervene') && open;
  const statusLabel = d.dispatchStatus === 'assigned' ? 'Attribuée' : d.dispatchStatus === 'searching' ? 'Recherche en cours' : d.dispatchStatus === 'unavailable' ? 'Aucun livreur disponible' : order.driverId ? 'Attribuée' : 'Pas encore demandée';
  const statusTone: Tone = d.dispatchStatus === 'unavailable' ? 'danger' : d.dispatchStatus === 'searching' ? 'amber' : order.driverId ? 'success' : 'neutral';
  const offerLabels: Record<DispatchOffer['status'], { label: string; tone: Tone }> = {
    offered: { label: 'En attente', tone: 'amber' },
    accepted: { label: 'Acceptée', tone: 'success' },
    declined: { label: 'Refusée', tone: 'danger' },
    expired: { label: 'Sans réponse', tone: 'neutral' },
    cancelled: { label: 'Annulée', tone: 'neutral' },
  };
  return (
    <Card>
      <CardHeader title="Attribution" icon={<Radar />} actions={<Badge tone={statusTone}>{statusLabel}</Badge>} divided />
      <CardContent className="space-y-4">
        <dl className="divide-y divide-border">
          <InfoRow label="Tour de recherche">{d.dispatchRound ? `${d.dispatchRound}${d.dispatchRadiusMeters ? ` · ${formatMeters(d.dispatchRadiusMeters)}` : ''}` : '—'}</InfoRow>
          <InfoRow label="Tentatives">{d.dispatchAttempts ?? 0}</InfoRow>
          {d.courierRequestedAt && toDate(d.courierRequestedAt) && <InfoRow label="Livreur demandé à">{formatTime(toDate(d.courierRequestedAt)!)}</InfoRow>}
        </dl>
        {offers.data.length > 0 && (
          <div>
            <p className="eyebrow mb-2">Propositions</p>
            <ul className="space-y-1.5">
              {offers.data.map((o) => {
                const drv = byId.get(o.driverId);
                return (
                  <li key={o.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-fg">
                      {drv ? `${drv.firstName} ${drv.lastName.charAt(0)}.` : 'Livreur'} <span className="text-2xs text-fg-subtle">· tour {o.round} · {formatMeters(o.distanceToRestaurantMeters)}</span>
                    </span>
                    <Badge size="sm" tone={offerLabels[o.status].tone}>{offerLabels[o.status].label}</Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {candidates && (
          <div>
            <p className="eyebrow mb-2">Candidats évalués</p>
            {candidates.length === 0 ? (
              <p className="text-sm text-fg-subtle">Aucun livreur connecté dans la ville.</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.driverId} className="flex items-center justify-between gap-2 text-sm">
                    <span className={cn('min-w-0 truncate', c.eligible ? 'text-fg' : 'text-fg-subtle')}>
                      {c.displayName} <span className="text-2xs">· {VEHICLE_LABELS[c.vehicle]} · {formatMeters(c.distanceMeters)}</span>
                    </span>
                    {c.eligible ? <Badge size="sm" tone="success">Éligible</Badge> : <span className="text-right text-2xs text-fg-subtle">{c.excludedBecause}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={preview.loading}
            onClick={async () => {
              const r = await preview.mutate({ orderId: order.id });
              if (r) setCandidates(r.candidates);
            }}
          >
            Voir les candidats
          </Button>
          {intervene && !order.driverId && (
            <Button size="sm" variant="primary" leftIcon={<RotateCcw />} onClick={() => setDialog('relaunch')}>
              Relancer
            </Button>
          )}
          {intervene && (
            <Button size="sm" variant="secondary" leftIcon={<Bike />} onClick={() => setDialog('force')}>
              {order.driverId ? 'Changer de livreur' : 'Imposer un livreur'}
            </Button>
          )}
          {intervene && order.driverId && (
            <Button size="sm" variant="danger-soft" leftIcon={<UserX />} onClick={() => setDialog('unassign')}>
              Retirer et relancer
            </Button>
          )}
        </div>
        {!can('orders.intervene') && <p className="text-xs text-fg-subtle">L’intervention sur l’attribution n’entre pas dans vos droits.</p>}
      </CardContent>
      <ConfirmDialog
        open={dialog === 'relaunch' || dialog === 'unassign'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'unassign' ? 'Retirer le livreur et relancer' : 'Relancer l’attribution'}
        description={dialog === 'unassign' ? 'Le livreur actuel est libéré ; la recherche reprend avec les règles de la zone.' : 'Une nouvelle recherche démarre avec les règles de la zone.'}
        requireReason
        destructive={dialog === 'unassign'}
        confirmLabel={dialog === 'unassign' ? 'Retirer et relancer' : 'Relancer'}
        onConfirm={async (reason) => {
          await dispatch.mutate({ orderId: order.id, unassign: dialog === 'unassign', reason: reason ?? '' });
        }}
      />
      <ForceDriverDialog open={dialog === 'force'} onOpenChange={(o) => !o && setDialog(null)} order={order} onSubmit={(driverId, reason) => dispatch.mutate({ orderId: order.id, driverId, reason })} loading={dispatch.loading} />
    </Card>
  );
}

function ForceDriverDialog({ open, onOpenChange, order, onSubmit, loading }: { open: boolean; onOpenChange: (open: boolean) => void; order: WithId<Order>; onSubmit: (driverId: string, reason: string) => Promise<unknown>; loading: boolean }) {
  const drivers = useScopedDrivers();
  const [driverId, setDriverId] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const options = drivers.data
    .filter((d) => d.cityId === order.cityId && d.type === 'platform' && d.status === 'active' && d.id !== order.driverId)
    .sort((a, b) => Number(b.availability === 'online') - Number(a.availability === 'online'))
    .map((d) => ({ value: d.id, label: `${d.firstName} ${d.lastName}`, description: d.availability === 'online' ? 'Disponible' : d.availability === 'on_delivery' ? 'En course' : 'Hors ligne' }));
  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Bike />} title={order.driverId ? 'Changer de livreur' : 'Imposer un livreur'} description="Le livreur choisi reçoit directement la course. Action tracée dans le journal d’audit." />
        <DialogBody className="space-y-4">
          <FormField label="Livreur Ciyou Eats de la ville">
            <Combobox options={options} value={driverId} onChange={setDriverId} placeholder="Choisir un livreur…" searchPlaceholder="Rechercher…" />
          </FormField>
          <FormField label="Motif">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Ex. le client attend depuis 25 minutes, livreur disponible à 400 m" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={!driverId || reason.trim().length < 3}
            onClick={async () => {
              if (driverId && (await onSubmit(driverId, reason.trim()))) {
                setReason('');
                setDriverId(undefined);
                onOpenChange(false);
              }
            }}
          >
            Attribuer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Support({ order }: { order: WithId<Order> }) {
  if (!order.ticketIds?.length) {
    return (
      <Card>
        <CardHeader title="Support" icon={<LifeBuoy />} divided />
        <EmptyState compact icon={<LifeBuoy />} title="Aucun ticket" description="Aucune demande de support liée à cette commande." />
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Support" icon={<LifeBuoy />} description={`${order.ticketIds.length} ticket${order.ticketIds.length > 1 ? 's' : ''} lié${order.ticketIds.length > 1 ? 's' : ''}`} divided />
      <ul className="divide-y divide-border">
        {order.ticketIds.map((id) => (
          <li key={id}>
            <Link to={`/support/${id}`} className="flex items-center justify-between px-5 py-3 text-sm text-fg hover:bg-surface-2">
              Ouvrir le ticket
              <span className="font-mono text-2xs text-fg-subtle">{id.slice(0, 8)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
