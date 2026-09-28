// Éléments d'affichage partagés : statut, mode, minuteur, action principale.
import { Bike, Check, ChevronDown, Clock3, Flame, PackageCheck, ShoppingBag, Timer, Utensils } from 'lucide-react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  StatusPill,
  cn,
  toneClass,
  type Tone,
} from '@golink/ui';
import { PREP_EXTENSION_STEPS, type FulfillmentMode, type Order } from '@golink/shared';
import { useCan } from '@/auth/RestaurantAccess';
import { FULFILLMENT_TONES, countdownOf, formatCountdown, fulfillmentLabel, statusMeta, type OrderRow } from '../lib';
import { useOrderActions } from './OrderActions';

export function OrderStatus({ order, className }: { order: Pick<Order, 'status' | 'fulfillment'>; className?: string }) {
  const meta = statusMeta(order);
  return (
    <StatusPill tone={meta.tone} pulse={meta.pulse} className={className}>
      {meta.label}
    </StatusPill>
  );
}

const MODE_ICONS: Record<FulfillmentMode, typeof Bike> = { delivery: Bike, pickup: ShoppingBag, dine_in: Utensils };

export function FulfillmentBadge({ mode, size = 'md' }: { mode: FulfillmentMode; size?: 'sm' | 'md' }) {
  const Icon = MODE_ICONS[mode];
  return (
    <Badge tone={FULFILLMENT_TONES[mode]} size={size} icon={<Icon />}>
      {fulfillmentLabel(mode)}
    </Badge>
  );
}

const COUNTDOWN_LABELS = { accept: 'pour accepter', prep: 'avant la fin de préparation', pickup: '', delivery: 'avant l’arrivée' } as const;

/** Minuteur de l'étape en cours, avec jauge ; rouge une fois le délai dépassé. */
export function Countdown({ order, now, variant = 'pill' }: { order: Order; now: number; variant?: 'pill' | 'bar' }) {
  const cd = countdownOf(order, now);
  if (!cd) return null;
  const overdue = cd.seconds < 0;
  const urgent = !overdue && (cd.kind === 'accept' ? cd.seconds <= 90 : cd.seconds <= 180);
  const tone: Tone = overdue ? 'danger' : urgent ? 'amber' : cd.kind === 'accept' ? 'brand' : 'neutral';
  const label = overdue
    ? cd.kind === 'accept'
      ? 'Délai d’acceptation dépassé'
      : cd.kind === 'delivery'
        ? 'Arrivée prévue dépassée'
        : 'Temps de préparation dépassé'
    : `${formatCountdown(cd.seconds)} ${COUNTDOWN_LABELS[cd.kind]}`;

  if (variant === 'bar') {
    const ratio = Math.max(0, Math.min(1, cd.seconds / cd.total));
    return (
      <div className={cn(toneClass[tone], 'h-1 w-full overflow-hidden bg-surface-3')} aria-hidden>
        <div className="h-full bg-(--tone-solid) transition-[width] duration-1000 ease-linear" style={{ width: `${(overdue ? 1 : ratio) * 100}%` }} />
      </div>
    );
  }
  return (
    <span
      role="timer"
      aria-label={label}
      title={label}
      className={cn(
        toneClass[tone],
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-(--tone-border) bg-(--tone-bg) px-2 font-mono text-xs font-medium text-(--tone-fg) num',
        overdue && 'animate-pulse',
      )}
    >
      {cd.kind === 'accept' ? <Timer className="size-3.5" /> : <Clock3 className="size-3.5" />}
      {formatCountdown(cd.seconds)}
    </span>
  );
}

/**
 * Action principale attendue à l'étape de la commande (et actions secondaires
 * utiles), selon les droits du membre.
 */
export function PrimaryActions({ order, size = 'sm', stretch }: { order: OrderRow; size?: 'sm' | 'md'; stretch?: boolean | 'always' }) {
  const can = useCan();
  const actions = useOrderActions();
  const busy = actions.busyId === order.id;
  if (!can('orders.manage')) return null;
  const block = stretch === 'always' ? 'flex-1 px-2' : stretch ? 'flex-1 sm:flex-none' : undefined;
  const delivery = order.fulfillment === 'delivery';
  const ownDelivery = order.delivery?.deliveredBy === 'restaurant';

  switch (order.status) {
    case 'new':
      return (
        <>
          <Button size={size} variant="ghost" className={block} onClick={() => actions.open('reject', order)}>
            Refuser
          </Button>
          <Button size={size} variant="primary" className={block} leftIcon={<Check />} onClick={() => actions.open('accept', order)}>
            Accepter
          </Button>
        </>
      );
    case 'accepted':
      return (
        <Button size={size} variant="primary" className={block} loading={busy} leftIcon={<Flame />} onClick={() => void actions.startPreparation(order)}>
          Lancer la préparation
        </Button>
      );
    case 'preparing':
      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size={size} variant="secondary" className={block} rightIcon={<ChevronDown />} disabled={busy}>
                + Temps
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Prolonger la préparation</DropdownMenuLabel>
              {PREP_EXTENSION_STEPS.map((m) => (
                <DropdownMenuItem key={m} icon={<Clock3 />} onSelect={() => void actions.extend(order, m)}>
                  + {m} minutes
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size={size} variant="primary" className={block} loading={busy} leftIcon={<PackageCheck />} onClick={() => void actions.markReady(order)}>
            Marquer prête
          </Button>
        </>
      );
    case 'ready':
      if (order.fulfillment === 'pickup') {
        return (
          <Button size={size} variant="primary" className={block} leftIcon={<Check />} onClick={() => actions.open('pickup', order)}>
            Remettre au client
          </Button>
        );
      }
      if (order.fulfillment === 'dine_in') {
        return (
          <Button size={size} variant="primary" className={block} loading={busy} leftIcon={<Utensils />} onClick={() => void actions.complete(order)}>
            Commande servie
          </Button>
        );
      }
      if (delivery && !order.driverId) {
        return ownDelivery ? (
          <Button size={size} variant="primary" className={block} leftIcon={<Bike />} onClick={() => actions.open('courier', order)}>
            Attribuer un livreur
          </Button>
        ) : (
          <Button size={size} variant="primary" className={block} loading={busy || order.delivery?.dispatchStatus === 'searching'} leftIcon={<Bike />} onClick={() => void actions.requestCourier(order)}>
            {order.delivery?.dispatchStatus === 'unavailable' ? 'Relancer la recherche' : 'Demander un livreur'}
          </Button>
        );
      }
      return null;
    case 'assigned':
      return ownDelivery ? (
        <Button size={size} variant="primary" className={block} loading={busy} leftIcon={<PackageCheck />} onClick={() => void actions.markPickedUp(order)}>
          Remise au livreur
        </Button>
      ) : null;
    case 'picked_up':
      return ownDelivery ? (
        <Button size={size} variant="primary" className={block} loading={busy} leftIcon={<Check />} onClick={() => void actions.complete(order)}>
          Marquer livrée
        </Button>
      ) : null;
    default:
      return null;
  }
}

/** Ligne d'état du livreur pour une livraison. */
export function CourierLine({ order }: { order: Order }) {
  if (order.fulfillment !== 'delivery' || !order.delivery) return null;
  const d = order.delivery;
  if (order.status === 'cancelled' || order.status === 'delivered') {
    return d.driverName ? <span className="text-xs text-fg-subtle">Livreur : {d.driverName}</span> : null;
  }
  if (d.driverName) {
    const where = order.status === 'picked_up' ? 'en route vers le client' : order.status === 'assigned' ? 'en approche du restaurant' : 'attribué';
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
        <Bike className="size-3.5 text-fg-subtle" />
        <span className="font-medium text-fg">{d.driverName}</span> · {where}
      </span>
    );
  }
  if (d.dispatchStatus === 'searching') {
    return <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted"><Bike className="size-3.5 animate-pulse" /> Recherche d’un livreur…</span>;
  }
  if (d.dispatchStatus === 'unavailable') {
    return <span className="tone-amber inline-flex items-center gap-1.5 text-xs font-medium text-(--tone-fg)"><Bike className="size-3.5" /> Aucun livreur disponible, nouvelle recherche en cours</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
      <Bike className="size-3.5" /> {d.deliveredBy === 'restaurant' ? 'Livraison par vos livreurs' : 'Un livreur GoLink sera appelé avant la fin de préparation'}
    </span>
  );
}
