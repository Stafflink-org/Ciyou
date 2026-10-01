// Ligne compacte d'une commande dans la file (vue liste, alignée sur la
// maquette de référence) : numéro, client, service, délai, statut, total et
// action rapide en bout de ligne. Toute la ligne ouvre la fiche détaillée.
import { CalendarClock, MessageSquareText, Pin, PinOff, Sparkles } from 'lucide-react';
import { Badge, cn, formatEUR } from '@golink/ui';
import { elapsedLabel, itemsSummary, type OrderRow } from '../lib';
import { Countdown, CourierLine, FulfillmentBadge, OrderStatus, PrimaryActions } from './parts';

interface OrderListRowProps {
  order: OrderRow;
  now: number;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
}

export function OrderListRow({ order, now, pinned, onTogglePin, onOpen }: OrderListRowProps) {
  const hasNotes = Boolean(order.customerNote) || order.items.some((i) => i.comment);
  const isNew = order.status === 'new';

  return (
    <li
      className={cn(
        'group relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2',
        isNew && 'bg-primary-soft/40',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        aria-label={`Ouvrir la commande ${order.number} de ${order.customerName}`}
      />

      {/* Numéro + client */}
      <div className="relative z-10 min-w-0 flex-1 basis-56 pointer-events-none">
        <div className="flex items-center gap-1.5">
          <span className="num font-mono text-sm font-semibold tracking-tight text-fg">{order.number}</span>
          {pinned && <Pin className="size-3.5 shrink-0 fill-current text-primary" aria-label="Épinglée" />}
          {order.flags.firstOrder && (
            <Badge tone="plum" size="sm" icon={<Sparkles />}>
              1re
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-fg-muted">
          <span className="font-medium text-fg">{order.customerName}</span> · {itemsSummary(order)}
        </p>
        {hasNotes && (
          <p className="tone-amber mt-1 flex max-w-sm items-start gap-1 text-xs text-(--tone-fg)">
            <MessageSquareText className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-1">{order.customerNote ?? order.items.find((i) => i.comment)?.comment}</span>
          </p>
        )}
      </div>

      {/* Service */}
      <div className="relative z-10 flex shrink-0 flex-col items-start gap-1 pointer-events-none">
        <FulfillmentBadge mode={order.fulfillment} size="sm" />
        <CourierLine order={order} />
      </div>

      {/* Délai */}
      <div className="relative z-10 flex shrink-0 flex-col items-start gap-0.5 pointer-events-none">
        <Countdown order={order} now={now} />
        <span className="text-2xs text-fg-subtle">{elapsedLabel(order, now)}</span>
        {order.scheduledFor && (
          <Badge tone="info" size="sm" icon={<CalendarClock />}>
            {order.scheduledFor.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </Badge>
        )}
      </div>

      {/* Statut */}
      <div className="relative z-10 shrink-0 pointer-events-none">
        <OrderStatus order={order} />
      </div>

      {/* Total */}
      <div className="relative z-10 shrink-0 text-right pointer-events-none">
        <span className="num block font-mono text-sm font-semibold text-fg">{formatEUR(order.amounts.totalCents, { cents: true })}</span>
        <span className="block text-2xs text-fg-subtle">
          {order.itemsCount} article{order.itemsCount > 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions rapides */}
      <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5">
        <div className="pointer-events-auto flex gap-1.5 empty:hidden">
          <PrimaryActions order={order} size="sm" />
        </div>
        <button
          type="button"
          onClick={onTogglePin}
          className="pointer-events-auto grid size-7 shrink-0 place-items-center rounded-lg text-fg-subtle opacity-0 transition hover:bg-surface-3 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={pinned ? `Désépingler ${order.number}` : `Épingler ${order.number}`}
          title={pinned ? 'Désépingler' : 'Épingler en haut de la file'}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
      </div>
    </li>
  );
}
