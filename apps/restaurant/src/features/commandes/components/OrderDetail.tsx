// Fiche commande complète : étapes, panier (options, commentaires), client,
// livraison, paiement, répartition côté restaurant, chronologie et actions.
import { useMemo, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  Bike,
  CheckCircle2,
  Copy,
  CreditCard,
  KeyRound,
  LifeBuoy,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Printer,
  Receipt,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Timeline,
  cn,
  formatDateTime,
  formatEUR,
  formatTime,
  toast,
  type TimelineItem,
  type Tone,
} from '@golink/ui';
import {
  CANCEL_REASON_LABELS,
  ORDER_EVENT_TYPE_LABELS,
  labelOf,
  ORDER_STEPS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatBps,
  formatDistance,
  type OrderEvent,
  type OrderStatus,
  type WithId,
} from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { errorMessage, toDate } from '@/lib/firestore';
import { useNow, useOrderEvents } from '../hooks';
import { CLOSED_STATUSES, fulfillmentLabel, statusMeta, type OrderRow } from '../lib';
import { useOrderActions } from './OrderActions';
import { ItemAdjustmentBadge, ItemUnavailableButton } from './ItemUnavailable';
import { Countdown, CourierLine, FulfillmentBadge, OrderStatus as StatusPillFor, PrimaryActions } from './parts';
import { getLocale, useTranslation } from '@golink/web';

const EVENT_TONES: Partial<Record<OrderEvent['type'], Tone>> = {
  created: 'brand',
  driver_assigned: 'info',
  prep_time_extended: 'amber',
  pickup_code_verified: 'success',
  refund_issued: 'danger',
  note_added: 'plum',
  payment_updated: 'neutral',
};

const STATUS_EVENT_TONES: Partial<Record<OrderStatus, Tone>> = {
  preparing: 'amber',
  ready: 'teal',
  assigned: 'info',
  picked_up: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

const ACTOR_LABELS: Record<OrderEvent['actor'], string> = {
  customer: 'Client',
  restaurant: 'Restaurant',
  driver: 'Livreur',
  admin: 'Support GoLink',
  system: 'Automatique',
};

function eventTitle(event: OrderEvent): string {
  if (event.type === 'status_changed' && event.to) return labelOf('ORDER_STATUS_LABELS', event.to, getLocale());
  return ORDER_EVENT_TYPE_LABELS[event.type];
}

function Block({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg [&_svg]:size-4 [&_svg]:text-fg-subtle">
          {icon}
          {title}
        </h3>
        {action}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

function Line({ label, value, strong, muted, text, className }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; text?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1 text-sm', className)}>
      <span className={cn(muted ? 'text-fg-subtle' : 'text-fg-muted')}>{label}</span>
      <span className={cn('text-right', !text && 'num font-mono', strong ? 'font-semibold text-fg' : 'text-fg')}>{value}</span>
    </div>
  );
}

const eur = (cents: number) => formatEUR(cents, { cents: true });

/** Étapes du parcours selon le mode, avec l'horodatage de chacune. */
function Steps({ order }: { order: OrderRow }) {
  const { t, label: tLabel } = useTranslation();
  const steps = ORDER_STEPS[order.fulfillment].filter((s) => s !== 'accepted');
  const cancelled = order.status === 'cancelled';
  const currentIndex = steps.indexOf(order.status === 'accepted' ? 'preparing' : order.status);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:flex sm:gap-0" aria-label="Étapes de la commande">
      {steps.map((step, index) => {
        const at = order.timeline[step];
        const done = Boolean(at) && !cancelled ? true : index < currentIndex;
        const current = !cancelled && index === currentIndex;
        const label = step === 'delivered' && order.fulfillment !== 'delivery' ? t('accueil:status.handedOver') : step === 'new' ? t('accueil:status.received') : tLabel('ORDER_STATUS_LABELS', step);
        return (
          <li key={step} className="relative flex min-w-0 flex-1 items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5 sm:pr-3">
            <span className="flex shrink-0 items-center gap-2 sm:w-full">
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border-2',
                  done && 'border-primary bg-primary text-primary-fg',
                  current && !done && 'border-primary bg-surface',
                  !done && !current && 'border-border-strong bg-surface',
                )}
              >
                {done && <CheckCircle2 className="size-3" />}
                {current && !done && <span className="size-1.5 animate-pulse rounded-full bg-primary" />}
              </span>
              <span className={cn('hidden h-0.5 flex-1 rounded-full sm:block', index === steps.length - 1 && 'invisible', done ? 'bg-primary/60' : 'bg-border')} />
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate text-xs font-medium', done || current ? 'text-fg' : 'text-fg-subtle')}>{label}</span>
              <span className="num block font-mono text-2xs text-fg-subtle">{at ? formatTime(toDate(at) ?? new Date()) : '—'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function OrderDetail({ order, compactHeader }: { order: OrderRow; compactHeader?: boolean }) {
  const can = useCan();
  const actions = useOrderActions();
  const now = useNow();
  const events = useOrderEvents(order.id);
  const closed = CLOSED_STATUSES.includes(order.status);
  const meta = statusMeta(order);
  const settlement = order.restaurantSettlement;
  const d = order.delivery;
  const discount = order.amounts.discount;

  const timelineItems = useMemo<TimelineItem[]>(
    () =>
      [...events.data].reverse().map((e: WithId<OrderEvent>) => ({
        id: e.id,
        title: eventTitle(e),
        description: [e.message, e.actorName ? `${ACTOR_LABELS[e.actor]} · ${e.actorName}` : ACTOR_LABELS[e.actor]].filter(Boolean).join(' — '),
        time: formatDateTime(toDate(e.at) ?? new Date()),
        tone: (e.type === 'status_changed' && e.to ? STATUS_EVENT_TONES[e.to] : EVENT_TONES[e.type]) ?? 'neutral',
      })),
    [events.data],
  );

  const copyNumber = () => {
    void navigator.clipboard?.writeText(order.number).then(() => toast.success(`${order.number} copié.`));
  };

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className={cn('space-y-4', compactHeader && 'pr-10')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Commande · {formatDateTime(toDate(order.createdAt) ?? new Date())}</p>
            <h2 className="num mt-1 font-display text-2xl font-semibold tracking-display text-fg sm:text-3xl">{order.number}</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Pour <span className="font-medium text-fg">{order.customerName}</span> · {order.itemsCount} article{order.itemsCount > 1 ? 's' : ''} ·{' '}
              <span className="num font-mono text-fg">{eur(order.amounts.totalCents)}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Countdown order={order} now={now} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Plus d’actions" variant="secondary" size="sm">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem icon={<Printer />} onSelect={() => actions.print(order)}>
                  Imprimer le ticket cuisine
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Copy />} onSelect={copyNumber}>
                  Copier le numéro
                </DropdownMenuItem>
                {can('orders.manage') && (
                  <DropdownMenuItem icon={<LifeBuoy />} onSelect={() => actions.open('report', order)}>
                    Signaler un problème
                  </DropdownMenuItem>
                )}
                {!closed && can('orders.cancel') && order.status !== 'new' && order.status !== 'picked_up' && order.status !== 'assigned' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Ban />} destructive onSelect={() => actions.open('cancel', order)}>
                      Annuler la commande
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPillFor order={order} />
          <FulfillmentBadge mode={order.fulfillment} />
          {order.flags.firstOrder && <Badge tone="plum">Première commande</Badge>}
          {order.flags.late && <Badge tone="danger">En retard de {order.flags.lateMinutes} min</Badge>}
          {order.containsAlcohol && <Badge tone="amber" icon={<ShieldCheck />}>Alcool · pièce d’identité</Badge>}
          {order.test && <Badge tone="neutral">Démonstration</Badge>}
        </div>
        {!closed && (
          <div className="flex flex-wrap gap-2">
            <PrimaryActions order={order} size="md" stretch />
          </div>
        )}
      </div>

      {order.status !== 'cancelled' && (
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3.5">
          <Steps order={order} />
        </div>
      )}

      {order.status === 'cancelled' && order.cancellation && (
        <div className="tone-danger rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3.5 text-sm">
          <p className="flex items-center gap-2 font-semibold text-(--tone-fg)">
            <AlertTriangle className="size-4" /> {CANCEL_REASON_LABELS[order.cancellation.reason]}
          </p>
          {order.cancellation.details && <p className="mt-1 text-fg">{order.cancellation.details}</p>}
          <p className="mt-2 text-xs text-fg-muted">
            {ACTOR_LABELS[order.cancellation.by]} · {formatDateTime(toDate(order.cancellation.at) ?? new Date())} · client remboursé de {eur(order.cancellation.refundCents)}
            {can('finance.view') && (order.cancellation.restaurantChargeCents ?? 0) > 0 && <> · dont {eur(order.cancellation.restaurantChargeCents ?? 0)} imputés à votre établissement</>}
          </p>
        </div>
      )}

      {order.status === 'ready' && order.fulfillment === 'pickup' && can('orders.manage') && (
        <div className="tone-success flex flex-col gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-(--tone-fg)">
              <KeyRound className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">Remise au client</p>
              <p className="text-xs text-fg-muted">Demandez à {order.customerName} le code reçu avec sa commande avant de remettre le sac.</p>
            </div>
          </div>
          <Button variant="primary" leftIcon={<KeyRound />} onClick={() => actions.open('pickup', order)}>
            Saisir le code
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Block title="Panier" icon={<Receipt />} action={<span className="text-xs text-fg-subtle">{order.itemsCount} article{order.itemsCount > 1 ? 's' : ''}</span>}>
            <ul className="divide-y divide-border">
              {order.items.map((item) => {
                const groups = new Map<string, typeof item.options>();
                for (const o of item.options) groups.set(o.groupName, [...(groups.get(o.groupName) ?? []), o]);
                return (
                  <li key={item.lineId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <span className="num grid h-7 min-w-7 shrink-0 place-items-center rounded-md bg-primary-soft px-1 font-mono text-xs font-semibold text-primary-soft-fg">{item.quantity}×</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className={cn('text-sm font-semibold text-fg', item.adjustment?.type === 'removed' && 'line-through opacity-60')}>{item.name}</p>
                          <span className="num shrink-0 font-mono text-sm text-fg">{eur(item.totalCents)}</span>
                        </div>
                        <p className="text-xs text-fg-subtle">
                          {eur(item.unitPriceCents)} l’unité{item.optionsPriceCents > 0 && <> · suppléments {eur(item.optionsPriceCents)}</>}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <ItemAdjustmentBadge order={order} item={item} />
                          <ItemUnavailableButton order={order} item={item} />
                        </div>
                        {groups.size > 0 && (
                          <div className="mt-2 space-y-0.5 border-l-2 border-border pl-3 text-xs text-fg-muted">
                            {[...groups.entries()].map(([group, opts]) => (
                              <p key={group}>
                                <span className="font-medium text-fg">{group} :</span>{' '}
                                {opts.map((o) => `${o.quantity > 1 ? `${o.quantity}× ` : ''}${o.name}${o.priceCents > 0 ? ` (+${eur(o.priceCents)})` : ''}`).join(' · ')}
                              </p>
                            ))}
                          </div>
                        )}
                        {item.comment && (
                          <p className="tone-amber mt-2 flex items-start gap-1.5 rounded-md bg-(--tone-bg) px-2.5 py-1.5 text-xs text-(--tone-fg)">
                            <MessageSquareText className="mt-px size-3.5 shrink-0" /> {item.comment}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Block>

          {order.customerNote && (
            <div className="tone-amber rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-(--tone-fg)">
                <MessageSquareText className="size-3.5" /> Note du client
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{order.customerNote}</p>
            </div>
          )}

          <Block title="Chronologie" icon={<CheckCircle2 />}>
            {events.loading ? (
              <div className="space-y-3">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : events.error ? (
              <p className="text-sm text-danger">{errorMessage(events.error)}</p>
            ) : timelineItems.length === 0 ? (
              <p className="text-sm text-fg-subtle">Aucun événement enregistré pour cette commande.</p>
            ) : (
              <Timeline items={timelineItems} />
            )}
          </Block>
        </div>

        <div className="min-w-0 space-y-4">
          <Block title="Client" icon={<User />}>
            <p className="text-sm font-semibold text-fg">{order.customerName}</p>
            {order.customerPhoneMasked && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted">
                <Phone className="size-3.5" /> {order.customerPhoneMasked}
                <span className="text-fg-subtle">· numéro masqué</span>
              </p>
            )}
            {order.pickupCode && order.fulfillment !== 'delivery' && !closed && (
              <p className="mt-2 text-xs text-fg-subtle">Le client présente un code à 4 chiffres au comptoir.</p>
            )}
            {order.pickupVerified && (
              <p className="tone-success mt-2 flex items-center gap-1.5 text-xs font-medium text-(--tone-fg)">
                <CheckCircle2 className="size-3.5" /> Code de retrait vérifié
              </p>
            )}
          </Block>

          {d && (
            <Block title="Livraison" icon={<MapPin />}>
              <p className="text-sm font-medium text-fg">{d.address.line1}</p>
              {d.address.line2 && <p className="text-sm text-fg">{d.address.line2}</p>}
              <p className="text-sm text-fg-muted">
                {d.address.postalCode} {d.address.city}
              </p>
              {d.address.details && <p className="mt-1 text-xs text-fg-muted">{d.address.details}</p>}
              {d.address.instructions && <p className="mt-1 text-xs italic text-fg-muted">« {d.address.instructions} »</p>}
              <div className="mt-3 space-y-0.5 border-t border-border pt-2.5">
                <Line label="Distance" value={formatDistance(d.distanceMeters)} />
                <Line label="Livré par" text value={d.deliveredBy === 'platform' ? 'Livreur GoLink' : 'Vos livreurs'} />
                {d.promisedTo && !closed && <Line label="Promise au client" text value={`avant ${formatTime(toDate(d.promisedTo) ?? new Date())}`} />}
                {d.estimatedArrivalAt && order.status === 'picked_up' && <Line label="Arrivée estimée" value={formatTime(toDate(d.estimatedArrivalAt) ?? new Date())} />}
              </div>
              {(d.driverName || !closed) && (
                <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5">
                  {d.driverName ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <Bike className="size-4 shrink-0 text-fg-subtle" />
                        <span className="truncate font-medium text-fg">{d.driverName}</span>
                      </span>
                      <span className="text-xs text-fg-subtle">{[d.driverVehicle, d.driverPhoneMasked].filter(Boolean).join(' · ')}</span>
                    </div>
                  ) : (
                    <CourierLine order={order} />
                  )}
                </div>
              )}
            </Block>
          )}

          <Block title="Paiement" icon={<CreditCard />} action={<Badge tone={order.payment.status === 'paid' ? 'success' : order.payment.status === 'refunded' || order.payment.status === 'failed' ? 'danger' : 'neutral'} size="sm">{PAYMENT_STATUS_LABELS[order.payment.status]}</Badge>}>
            <Line label="Moyen" text value={order.payment.label ?? PAYMENT_METHOD_LABELS[order.payment.method]} />
            {order.payment.method === 'cash' && !closed && <p className="mt-1 text-xs text-fg-subtle">Encaissé {order.fulfillment === 'delivery' ? 'par le livreur à la remise' : 'au comptoir'}.</p>}
            <div className="mt-2 space-y-0.5 border-t border-border pt-2">
              <Line label="Sous-total articles" value={eur(order.amounts.subtotalCents)} />
              {discount.totalCents > 0 && <Line label={`Remise${order.promoCode ? ` (${order.promoCode})` : ''}`} value={`−${eur(discount.totalCents)}`} />}
              {order.amounts.deliveryFeeCents > 0 && <Line label="Frais de livraison" value={eur(order.amounts.deliveryFeeCents)} muted />}
              {order.amounts.serviceFeeCents > 0 && <Line label="Frais de service" value={eur(order.amounts.serviceFeeCents)} muted />}
              {order.amounts.smallOrderFeeCents > 0 && <Line label="Petite commande" value={eur(order.amounts.smallOrderFeeCents)} muted />}
              {order.amounts.tipCents > 0 && <Line label="Pourboire livreur" value={eur(order.amounts.tipCents)} muted />}
              <Line label="Payé par le client" value={eur(order.amounts.totalCents)} strong className="border-t border-border pt-2" />
              {order.amounts.refundedCents > 0 && <Line label="Remboursé" value={`−${eur(order.amounts.refundedCents)}`} />}
            </div>
          </Block>

          {can('finance.view') && settlement && order.status !== 'cancelled' && (
            <Block title="Votre part" icon={<Receipt />} action={<span className="text-2xs text-fg-subtle">{order.status === 'delivered' ? 'Définitive' : 'Estimation'}</span>}>
              <Line label="Ventes" value={eur(settlement.grossCents)} />
              {settlement.discountFundedCents > 0 && <Line label="Remises financées par vous" value={`−${eur(settlement.discountFundedCents)}`} />}
              <Line label={`Commission GoLink (${formatBps(settlement.commissionBps)} HT)`} value={`−${eur(settlement.commissionTtcCents)}`} />
              <p className="-mt-0.5 pb-1 text-right text-2xs text-fg-subtle">dont TVA {eur(settlement.commissionVatCents)}</p>
              {settlement.deliveryFeeCents > 0 && <Line label="Frais de livraison conservés" value={eur(settlement.deliveryFeeCents)} />}
              {settlement.paymentFeeCents > 0 && <Line label="Frais de paiement" value={`−${eur(settlement.paymentFeeCents)}`} />}
              <Line label="Reversement" value={eur(settlement.payoutCents)} strong className="border-t border-border pt-2" />
            </Block>
          )}

          {!closed && (
            <p className="text-center text-xs text-fg-subtle">
              {fulfillmentLabel(order.fulfillment)} · {meta.label.toLowerCase()} · actualisé en temps réel
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
