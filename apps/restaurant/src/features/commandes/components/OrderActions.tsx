// Actions sur une commande et leurs fenêtres (acceptation, refus, annulation,
// remise par code, livreur propre, signalement). Un seul jeu de fenêtres par page,
// partagé par les cartes du service et la fiche commande.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { limit, query, where } from 'firebase/firestore';
import { AlertTriangle, Bike, CheckCircle2, Clock, KeyRound, LifeBuoy, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  RadioGroup,
  Select,
  Skeleton,
  Slider,
  Switch,
  Textarea,
  cn,
  formatEUR,
  toast,
} from '@golink/ui';
import {
  CANCEL_REASON_LABELS,
  ORDER_ISSUE_CATEGORIES,
  ORDER_ISSUE_CATEGORY_LABELS,
  ORDER_REJECT_REASONS,
  ORDER_REJECT_REASON_LABELS,
  PREP_MINUTES_MAX,
  PREP_MINUTES_MIN,
  RESTAURANT_CANCEL_REASONS,
  paths,
  type OrderIssueCategory,
  type OrderRejectReason,
  type RestaurantCancelReason,
  type RestaurantCourier,
} from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, errorMessage, useCollection, useMutation } from '@/lib/firestore';
import { ordersApi } from '../api';
import type { OrderRow } from '../lib';
import { printKitchenTicket } from './KitchenTicket';

type DialogKind = 'accept' | 'reject' | 'cancel' | 'pickup' | 'report' | 'courier';

interface OrderActionsValue {
  open: (kind: DialogKind, order: OrderRow) => void;
  startPreparation: (order: OrderRow) => Promise<void>;
  markReady: (order: OrderRow) => Promise<void>;
  requestCourier: (order: OrderRow) => Promise<void>;
  extend: (order: OrderRow, minutes: number) => Promise<void>;
  complete: (order: OrderRow) => Promise<void>;
  markPickedUp: (order: OrderRow) => Promise<void>;
  print: (order: OrderRow) => void;
  /** Commande dont une action rapide est en cours. */
  busyId: string | null;
}

const OrderActionsContext = createContext<OrderActionsValue | null>(null);

export function useOrderActions(): OrderActionsValue {
  const value = useContext(OrderActionsContext);
  if (!value) throw new Error('useOrderActions doit être utilisé sous <OrderActionsProvider>.');
  return value;
}

const PREP_PRESETS = [10, 15, 20, 25, 30, 45];

export function OrderActionsProvider({ children }: { children: ReactNode }) {
  const { restaurant } = useRestaurantAccess();
  const [dialog, setDialog] = useState<{ kind: DialogKind; order: OrderRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const close = useCallback(() => setDialog(null), []);

  const quick = useCallback(async <T,>(order: OrderRow, action: () => Promise<T>, success: string | ((result: T) => string)) => {
    setBusyId(order.id);
    try {
      const result = await action();
      toast.success(typeof success === 'function' ? success(result) : success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }, []);

  const value = useMemo<OrderActionsValue>(
    () => ({
      open: (kind, order) => setDialog({ kind, order }),
      startPreparation: (order) => quick(order, () => ordersApi.startPreparation({ orderId: order.id }), `${order.number} : préparation lancée.`),
      markReady: (order) =>
        quick(order, () => ordersApi.markReady({ orderId: order.id }), (r) =>
          r.status === 'assigned' ? `${order.number} est prête : le livreur est en route.` : `${order.number} est prête.`,
        ),
      requestCourier: (order) =>
        quick(order, () => ordersApi.requestCourier({ orderId: order.id }), (r) =>
          r.assigned ? `${r.driverName ?? 'Un livreur'} prend en charge ${order.number}.` : 'Aucun livreur disponible pour l’instant : nouvelle recherche automatique dans 2 minutes.',
        ),
      extend: (order, minutes) => quick(order, () => ordersApi.extendPrep({ orderId: order.id, minutes }), `Préparation de ${order.number} prolongée de ${minutes} min.`),
      complete: (order) =>
        quick(order, () => ordersApi.complete({ orderId: order.id }), order.fulfillment === 'dine_in' ? `${order.number} servie.` : `${order.number} livrée.`),
      markPickedUp: (order) => quick(order, () => ordersApi.markPickedUp({ orderId: order.id }), `${order.number} remise au livreur.`),
      print: (order) => printKitchenTicket(order, restaurant.name),
      busyId,
    }),
    [quick, busyId, restaurant.name],
  );

  return (
    <OrderActionsContext.Provider value={value}>
      {children}
      {dialog?.kind === 'accept' && <AcceptDialog order={dialog.order} onClose={close} />}
      {dialog?.kind === 'reject' && <RejectDialog order={dialog.order} onClose={close} />}
      {dialog?.kind === 'cancel' && <CancelDialog order={dialog.order} onClose={close} />}
      {dialog?.kind === 'pickup' && <PickupDialog order={dialog.order} onClose={close} />}
      {dialog?.kind === 'report' && <ReportDialog order={dialog.order} onClose={close} />}
      {dialog?.kind === 'courier' && <OwnCourierDialog order={dialog.order} onClose={close} />}
    </OrderActionsContext.Provider>
  );
}

// ------------------------------------------------------------------ Fenêtres

interface DialogProps {
  order: OrderRow;
  onClose: () => void;
}

function Shell({ onClose, children, size = 'sm' }: { onClose: () => void; children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size={size}>{children}</DialogContent>
    </Dialog>
  );
}

function AcceptDialog({ order, onClose }: DialogProps) {
  const [minutes, setMinutes] = useState(order.prepMinutes || 20);
  const { mutate, loading } = useMutation(ordersApi.accept, { success: `${order.number} acceptée · prête dans ${minutes} min.` });
  const readyAt = new Date(Date.now() + minutes * 60_000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <Shell onClose={onClose}>
      <DialogHeader
        icon={<Clock />}
        title={`Accepter ${order.number}`}
        description={`${order.itemsCount} article${order.itemsCount > 1 ? 's' : ''} pour ${order.customerName} — le client est prévenu du temps annoncé.`}
      />
      <DialogBody className="space-y-5">
        <div className="rounded-xl border border-border bg-surface-2 p-4 text-center">
          <p className="eyebrow">Temps de préparation</p>
          <p className="num mt-1 font-display text-5xl font-semibold tracking-display text-fg">
            {minutes}
            <span className="ml-1 text-xl text-fg-muted">min</span>
          </p>
          <p className="mt-1 text-xs text-fg-subtle">Prête vers {readyAt}</p>
        </div>
        <Slider
          value={[minutes]}
          min={PREP_MINUTES_MIN}
          max={60}
          step={1}
          onValueChange={([v]) => setMinutes(v ?? minutes)}
          formatValue={(v) => `${v} min`}
          aria-label="Temps de préparation en minutes"
        />
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="group" aria-label="Durées proposées">
          {PREP_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setMinutes(preset)}
              className={cn(
                'h-8 rounded-full border px-2 text-sm font-medium transition-colors',
                minutes === preset ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
              )}
            >
              {preset} min
            </button>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={loading}
          leftIcon={<CheckCircle2 />}
          onClick={async () => {
            if (await mutate({ orderId: order.id, prepMinutes: Math.min(PREP_MINUTES_MAX, minutes) })) onClose();
          }}
        >
          Accepter et lancer
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function RejectDialog({ order, onClose }: DialogProps) {
  const [reason, setReason] = useState<OrderRejectReason>('item_unavailable');
  const [details, setDetails] = useState('');
  const { mutate, loading } = useMutation(ordersApi.reject, { success: `${order.number} refusée : le client est remboursé intégralement.` });
  const needsDetails = reason === 'restaurant_rejected' && details.trim().length < 3;

  return (
    <Shell onClose={onClose}>
      <DialogHeader
        icon={<XCircle className="text-danger" />}
        title={`Refuser ${order.number} ?`}
        description="Le client est prévenu et remboursé intégralement ; le remboursement est déduit de votre prochain reversement. Les refus répétés pèsent sur votre visibilité."
      />
      <DialogBody className="space-y-4">
        <RadioGroup
          value={reason}
          onValueChange={(v) => setReason(v as OrderRejectReason)}
          options={ORDER_REJECT_REASONS.map((r) => ({ value: r, label: ORDER_REJECT_REASON_LABELS[r] }))}
        />
        <FormField label="Précisions" hint={reason === 'restaurant_rejected' ? 'Obligatoire pour ce motif.' : 'Facultatif, visible dans la fiche.'}>
          <Textarea rows={3} value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} placeholder="Ex. rupture de pain plat, four en panne…" />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Garder la commande
        </Button>
        <Button
          variant="danger"
          loading={loading}
          disabled={needsDetails}
          onClick={async () => {
            if (await mutate({ orderId: order.id, reason, details: details.trim() || null })) onClose();
          }}
        >
          Refuser la commande
        </Button>
      </DialogFooter>
    </Shell>
  );
}

const CANCEL_HINTS: Partial<Record<RestaurantCancelReason, string>> = {
  customer_absent: 'Client absent après le délai d’attente : la commande est clôturée sans remboursement, vous êtes payé normalement.',
  customer_request: 'Le client est remboursé intégralement ; le montant est déduit de votre prochain reversement.',
};

function CancelDialog({ order, onClose }: DialogProps) {
  const [reason, setReason] = useState<RestaurantCancelReason>('item_unavailable');
  const [details, setDetails] = useState('');
  const [restock, setRestock] = useState(true);
  const { mutate, loading } = useMutation(ordersApi.cancel);
  const refundable = order.amounts.chargedCents - order.amounts.refundedCents;
  const refundPreview = order.payment.method === 'cash' || (reason === 'customer_absent') ? 0 : refundable;

  return (
    <Shell onClose={onClose} size="md">
      <DialogHeader
        icon={<AlertTriangle className="text-danger" />}
        title={`Annuler ${order.number} ?`}
        description="Cette action est définitive. Le motif est enregistré dans la fiche et le journal d’audit."
      />
      <DialogBody className="space-y-4">
        <FormField label="Motif" required>
          <Select value={reason} onValueChange={(v) => setReason(v as RestaurantCancelReason)} options={RESTAURANT_CANCEL_REASONS.map((r) => ({ value: r, label: CANCEL_REASON_LABELS[r] }))} />
        </FormField>
        <FormField label="Détail du motif" required hint="3 caractères au moins.">
          <Textarea rows={3} value={details} maxLength={500} autoFocus onChange={(e) => setDetails(e.target.value)} placeholder="Ex. produit indisponible, demande du client par téléphone…" />
        </FormField>
        <Switch checked={restock} onCheckedChange={setRestock} label="Remettre les articles en stock" description="Les quantités commandées sont réintégrées aux stocks suivis." />
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-fg">Remboursement du client</p>
            <p className="text-xs text-fg-subtle">{CANCEL_HINTS[reason] ?? 'Remboursement intégral sur le moyen de paiement d’origine, déduit de votre prochain reversement.'}</p>
          </div>
          <span className="num font-mono font-semibold text-fg">{formatEUR(refundPreview, { cents: true })}</span>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Conserver
        </Button>
        <Button
          variant="danger"
          loading={loading}
          disabled={details.trim().length < 3}
          onClick={async () => {
            const result = await mutate({ orderId: order.id, reason, details: details.trim(), restock });
            if (result) {
              toast.success(result.refundCents > 0 ? `${order.number} annulée · ${formatEUR(result.refundCents, { cents: true })} remboursés.` : `${order.number} annulée.`);
              onClose();
            }
          }}
        >
          Confirmer l’annulation
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function PickupDialog({ order, onClose }: DialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { mutate, loading, error: failure } = useMutation(ordersApi.confirmPickup, { errorToast: false });

  const submit = async () => {
    if (!code.trim()) {
      setError('Saisissez le code communiqué au client.');
      return;
    }
    const result = await mutate({ orderId: order.id, code: code.trim() });
    if (result) {
      toast.success(`Code vérifié : ${order.number} remise à ${order.customerName}.`);
      onClose();
    }
  };
  const shown = error ?? (failure ? errorMessage(failure) : null);

  return (
    <Shell onClose={onClose}>
      <DialogHeader icon={<KeyRound />} title="Remettre la commande" description={`Demandez à ${order.customerName} le code à 4 chiffres affiché dans son application.`} />
      <DialogBody>
        <form
          id={`pickup-${order.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormField label="Code de retrait" error={shown ?? undefined}>
            <Input
              value={code}
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              size="lg"
              className="text-center font-mono text-2xl tracking-[0.5em]"
              placeholder="····"
              onChange={(e) => {
                setCode(e.target.value.replace(/\s/g, ''));
                setError(null);
              }}
            />
          </FormField>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Retour
        </Button>
        <Button type="submit" form={`pickup-${order.id}`} variant="primary" loading={loading} disabled={!code.trim()}>
          Vérifier et remettre
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function ReportDialog({ order, onClose }: DialogProps) {
  const [category, setCategory] = useState<OrderIssueCategory>(order.fulfillment === 'delivery' ? 'courier_late' : 'other');
  const [message, setMessage] = useState('');
  const { mutate, loading } = useMutation(ordersApi.reportIssue, { success: (r) => `Signalement ${r.ticketNumber} transmis au support Ciyou Eats.` });

  return (
    <Shell onClose={onClose} size="md">
      <DialogHeader icon={<LifeBuoy />} title="Signaler un problème" description={`Le support Ciyou Eats reçoit votre message avec la fiche de ${order.number} et vous répond dans la messagerie.`} />
      <DialogBody className="space-y-4">
        <FormField label="Nature du problème">
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as OrderIssueCategory)}
            options={ORDER_ISSUE_CATEGORIES.filter((c) => order.fulfillment === 'delivery' || !c.startsWith('courier')).map((c) => ({ value: c, label: ORDER_ISSUE_CATEGORY_LABELS[c] }))}
          />
        </FormField>
        <FormField label="Description" required hint="10 caractères au moins.">
          <Textarea rows={4} value={message} maxLength={1500} onChange={(e) => setMessage(e.target.value)} placeholder="Décrivez la situation : ce qui s’est passé, depuis quand, ce que vous attendez du support." />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={loading}
          disabled={message.trim().length < 10}
          onClick={async () => {
            if (await mutate({ orderId: order.id, category, message: message.trim() })) onClose();
          }}
        >
          Envoyer au support
        </Button>
      </DialogFooter>
    </Shell>
  );
}

function OwnCourierDialog({ order, onClose }: DialogProps) {
  const { restaurantId } = useRestaurantAccess();
  const couriers = useCollection<RestaurantCourier>(
    query(collectionAt(paths.restaurantSub(restaurantId, 'couriers')), where('relation', '==', 'own'), where('status', '==', 'active'), limit(50)),
  );
  const [driverId, setDriverId] = useState<string | null>(null);
  const { mutate, loading } = useMutation(ordersApi.assignOwnCourier, { success: (r) => `${r.driverName} livre ${order.number}.` });

  return (
    <Shell onClose={onClose}>
      <DialogHeader icon={<Bike />} title="Attribuer un livreur" description={`Choisissez l’un de vos livreurs pour ${order.number}. Il voit la course dans son application.`} />
      <DialogBody className="space-y-2">
        {couriers.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : couriers.error ? (
          <p className="text-sm text-danger">{errorMessage(couriers.error)}</p>
        ) : couriers.data.length === 0 ? (
          <EmptyState compact icon={<Bike />} title="Aucun livreur actif" description="Ajoutez vos livreurs ou réactivez-les depuis la rubrique Livreurs." />
        ) : (
          couriers.data.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setDriverId(c.id)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                driverId === c.id ? 'border-primary bg-primary-soft/50' : 'border-border hover:border-border-strong',
              )}
            >
              <span>
                <span className="block text-sm font-medium text-fg">{c.displayName}</span>
                <span className="text-xs text-fg-subtle">{c.deliveriesCount} livraison{c.deliveriesCount > 1 ? 's' : ''} pour vous</span>
              </span>
              {driverId === c.id && <Badge tone="brand">Choisi</Badge>}
            </button>
          ))
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={loading}
          disabled={!driverId}
          onClick={async () => {
            if (driverId && (await mutate({ orderId: order.id, driverId }))) onClose();
          }}
        >
          Attribuer
        </Button>
      </DialogFooter>
    </Shell>
  );
}
