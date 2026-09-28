// Carte d'une commande dans le service : numéro, client, contenu, minuteur,
// livreur et action principale. Toute la carte ouvre la fiche.
import { CalendarClock, MessageSquareText, Pin, PinOff, Sparkles } from 'lucide-react';
import { Badge, cn, formatEUR } from '@golink/ui';
import { elapsedLabel, type OrderRow } from '../lib';
import { Countdown, CourierLine, FulfillmentBadge, OrderStatus, PrimaryActions } from './parts';

interface OrderCardProps {
  order: OrderRow;
  now: number;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
  showStatus?: boolean;
}

const MAX_LINES = 3;

export function OrderCard({ order, now, pinned, onTogglePin, onOpen, showStatus }: OrderCardProps) {
  const extra = order.items.length - MAX_LINES;
  const hasNotes = Boolean(order.customerNote) || order.items.some((i) => i.comment);
  const isNew = order.status === 'new';

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-200 hover:border-border-strong hover:shadow-md',
        isNew ? 'border-primary/60 ring-1 ring-primary/25' : 'border-border',
        pinned && !isNew && 'border-fg-subtle/40',
      )}
    >
      {/* La carte entière ouvre la fiche ; les boutons restent au-dessus. */}
      <button type="button" onClick={onOpen} className="absolute inset-0 z-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" aria-label={`Ouvrir la commande ${order.number} de ${order.customerName}`} />
      <div className="pointer-events-none relative z-10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="num font-mono text-sm font-semibold tracking-tight text-fg">{order.number}</span>
              {pinned && <Pin className="size-3.5 fill-current text-primary" aria-label="Épinglée" />}
            </div>
            <p className="mt-0.5 text-2xs text-fg-subtle">{elapsedLabel(order, now)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Countdown order={order} now={now} />
            <button
              type="button"
              onClick={onTogglePin}
              className="pointer-events-auto grid size-7 place-items-center rounded-lg text-fg-subtle opacity-70 transition hover:bg-surface-3 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={pinned ? `Désépingler ${order.number}` : `Épingler ${order.number}`}
              title={pinned ? 'Désépingler' : 'Épingler en haut de la file'}
            >
              {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 truncate text-sm font-semibold text-fg">{order.customerName}</span>
          <FulfillmentBadge mode={order.fulfillment} size="sm" />
          {order.flags.firstOrder && (
            <Badge tone="plum" size="sm" icon={<Sparkles />}>
              1re commande
            </Badge>
          )}
          {order.scheduledFor && (
            <Badge tone="info" size="sm" icon={<CalendarClock />}>
              {order.scheduledFor.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          )}
          {showStatus && <OrderStatus order={order} className="h-5 text-2xs" />}
        </div>

        <ul className="mt-3 space-y-1 text-sm">
          {order.items.slice(0, MAX_LINES).map((item) => (
            <li key={item.lineId} className="flex gap-2 text-fg">
              <span className="num w-6 shrink-0 font-mono text-xs font-semibold leading-5 text-primary-soft-fg">{item.quantity}×</span>
              <span className="min-w-0 flex-1 truncate leading-5">
                {item.name}
                {item.options.length > 0 && <span className="text-fg-subtle"> · {item.options.map((o) => o.name).join(', ')}</span>}
              </span>
            </li>
          ))}
          {extra > 0 && <li className="pl-8 text-xs text-fg-subtle">+ {extra} autre{extra > 1 ? 's' : ''} article{extra > 1 ? 's' : ''}</li>}
        </ul>

        {hasNotes && (
          <p className="tone-amber mt-3 flex items-start gap-1.5 rounded-lg bg-(--tone-bg) px-2.5 py-1.5 text-xs text-(--tone-fg)">
            <MessageSquareText className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2">{order.customerNote ?? order.items.find((i) => i.comment)?.comment}</span>
          </p>
        )}

        <div className="mt-3 min-h-4">
          <CourierLine order={order} />
        </div>

        <div className="mt-3 border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="num font-mono text-sm font-semibold text-fg">{formatEUR(order.amounts.totalCents, { cents: true })}</span>
            <span className="text-2xs text-fg-subtle">
              {order.itemsCount} article{order.itemsCount > 1 ? 's' : ''}
              {order.payment.method === 'cash' ? ' · espèces à encaisser' : ''}
            </span>
          </div>
          <div className="pointer-events-auto mt-2.5 flex gap-1.5 empty:hidden">
            <PrimaryActions order={order} size="sm" stretch="always" />
          </div>
        </div>
      </div>
      <Countdown order={order} now={now} variant="bar" />
    </article>
  );
}
