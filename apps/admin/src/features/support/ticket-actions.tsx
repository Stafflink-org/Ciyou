// Actions depuis un ticket : remboursement, avoir, contact des parties, escalade,
// chat en direct, validation d'un remboursement en attente.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Flame, HandCoins, MessageSquareShare, MessagesSquare, Undo2, Wallet } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  RadioGroup,
  Select,
  Textarea,
} from '@golink/ui';
import {
  REFUND_CAUSES,
  REFUND_CAUSE_LABELS,
  type ContactTicketPartyInput,
  type CreditFromTicketInput,
  type EscalateTicketInput,
  type Order,
  type RefundCause,
  type RefundFromTicketInput,
  type RefundFromTicketResult,
  type SupportAgent,
  type SupportTicket,
  type WithId,
} from '@golink/shared';
import { callFunction, useMutation } from '@/lib/firestore';
import { useRefundPolicy } from '../clients/lib';
import { euros, parseEuros } from '../_experience/format';

const refundFromTicket = callFunction<RefundFromTicketInput, RefundFromTicketResult>('refundFromTicket');
const creditFromTicket = callFunction<CreditFromTicketInput, { walletTransactionId: string; balanceCents: number }>('creditFromTicket');
const contactTicketParty = callFunction<ContactTicketPartyInput, { recipients: number }>('contactTicketParty');
const escalateTicket = callFunction<EscalateTicketInput, { escalated: boolean }>('escalateTicket');
const openSupportChat = callFunction<{ orderId: string; ticketId: string | null; withDriver: boolean; withRestaurant: boolean; message: string }, { conversationId: string }>('openSupportChat');

type Props = { open: boolean; onOpenChange: (open: boolean) => void; ticket: WithId<SupportTicket> };

export function RefundDialog({ open, onOpenChange, ticket, order, refundableCents, limitCents }: Props & { order: WithId<Order> | null; refundableCents: number; limitCents: number | null }) {
  const [amount, setAmount] = useState('');
  const [cause, setCause] = useState<RefundCause>('missing_item');
  const [reason, setReason] = useState('');
  const cents = parseEuros(amount);
  const { mutate, loading } = useMutation(refundFromTicket, {
    success: (r) => (r.status === 'pending_approval' ? 'Demande transmise pour validation' : r.status === 'failed' ? 'Remboursement enregistré, échec chez le prestataire' : 'Remboursement effectué'),
  });
  const overLimit = cents !== null && limitCents !== null && cents > limitCents;
  const invalid = cents === null || cents < 50 || cents > refundableCents || reason.trim().length < 3;

  async function submit() {
    if (cents === null) return;
    const r = await mutate({ ticketId: ticket.id, amountCents: cents, cause, reason: reason.trim() });
    if (r) {
      setAmount('');
      setReason('');
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<Undo2 />} title="Rembourser le client" description={order ? `Commande ${order.number} · ${order.restaurantName}` : undefined} />
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-2 p-3 text-sm">
            <div><div className="text-xs text-fg-muted">Payé par le client</div><div className="font-mono num text-fg">{order ? euros(order.amounts.chargedCents) : '—'}</div></div>
            <div><div className="text-xs text-fg-muted">Encore remboursable</div><div className="font-mono num text-fg">{euros(refundableCents)}</div></div>
          </div>
          <FormField
            label="Montant"
            required
            aside={<button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setAmount((refundableCents / 100).toFixed(2).replace('.', ','))}>Montant total</button>}
            hint={limitCents !== null ? `Votre plafond sans validation : ${limitCents >= 1e9 ? 'illimité' : euros(limitCents)}.` : undefined}
            error={amount && (cents === null || cents > refundableCents) ? (cents === null ? 'Montant invalide.' : `Maximum ${euros(refundableCents)}.`) : undefined}
          >
            <Input className="w-36" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,50" trailing="€" />
          </FormField>
          <FormField label="Cause" hint="Détermine l’imputation : par décision de Ciyou Eats, le commerce supporte les remboursements (règle paramétrable).">
            <Select value={cause} onValueChange={(v) => setCause(v as RefundCause)} options={REFUND_CAUSES.map((c) => ({ value: c, label: REFUND_CAUSE_LABELS[c] }))} />
          </FormField>
          <FormField label="Motif" required hint="Conservé dans le journal d’audit.">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Boisson manquante confirmée par le restaurant." />
          </FormField>
          {overLimit && (
            <p className="tone-amber rounded-lg bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              Au-delà de votre plafond : la demande sera transmise à un responsable, le client sera remboursé après validation.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={invalid} onClick={() => void submit()}>
            {overLimit ? 'Demander la validation' : cents ? `Rembourser ${euros(cents)}` : 'Rembourser'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreditDialog({ open, onOpenChange, ticket, limitCents, defaultValidityDays }: Props & { limitCents: number | null; defaultValidityDays: number }) {
  const [amount, setAmount] = useState('5');
  const [validity, setValidity] = useState(String(defaultValidityDays));
  const [chargedTo, setChargedTo] = useState<'restaurant' | 'platform'>(ticket.restaurantId ? 'restaurant' : 'platform');
  const [reason, setReason] = useState('');
  const cents = parseEuros(amount);
  const days = Number(validity);
  const { mutate, loading } = useMutation(creditFromTicket, { success: (r) => `Avoir ajouté · solde du client ${euros(r.balanceCents)}` });
  // Montant maximal d'un avoir : réglage de la plateforme (Paiements > Frais et remboursements), lu du serveur.
  const policy = useRefundPolicy();
  const maxCredit = policy?.maxCreditCents ?? 50_000;
  const invalid = cents === null || cents < 50 || cents > maxCredit || !Number.isInteger(days) || days < 1 || reason.trim().length < 3;

  async function submit() {
    if (cents === null) return;
    const r = await mutate({ ticketId: ticket.id, amountCents: cents, reason: reason.trim(), chargedTo, validityDays: days });
    if (r) {
      setReason('');
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<Wallet />} title="Créditer un avoir" description={`Crédit sur le compte Ciyou Eats de ${ticket.requesterName}, déduit automatiquement de ses prochaines commandes.`} />
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Montant" required hint={`${limitCents !== null && limitCents < 1e9 ? `Plafond : ${euros(limitCents)}. ` : ''}Avoir maximal : ${euros(maxCredit)}.`}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} trailing="€" />
            </FormField>
            <FormField label="Validité">
              <Input inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value.replace(/\D/g, ''))} trailing="jours" />
            </FormField>
          </div>
          <FormField label="Imputation">
            <RadioGroup
              variant="cards"
              value={chargedTo}
              onValueChange={(v) => setChargedTo(v as 'restaurant' | 'platform')}
              options={[
                { value: 'restaurant', label: 'Commerce', description: 'Déduit du prochain reversement (règle par défaut).', disabled: !ticket.restaurantId },
                { value: 'platform', label: 'Geste commercial Ciyou Eats', description: 'Supporté par la plateforme.' },
              ]}
            />
          </FormField>
          <FormField label="Motif" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Retard de 35 minutes, commande arrivée tiède." />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={invalid} leftIcon={<HandCoins />} onClick={() => void submit()}>
            {cents ? `Créditer ${euros(cents)}` : 'Créditer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContactDialog({ open, onOpenChange, ticket }: Props) {
  const parties = useMemo(
    () => [
      { value: 'requester', label: `Demandeur · ${ticket.requesterName}` },
      ...(ticket.restaurantId && ticket.requesterType !== 'restaurant' ? [{ value: 'restaurant', label: 'Restaurant de la commande' }] : []),
      ...(ticket.driverId && ticket.requesterType !== 'driver' ? [{ value: 'driver', label: 'Livreur de la commande' }] : []),
    ],
    [ticket],
  );
  const [party, setParty] = useState<ContactTicketPartyInput['party']>('requester');
  const [message, setMessage] = useState('');
  const { mutate, loading } = useMutation(contactTicketParty, { success: (r) => `Message envoyé (${r.recipients} destinataire${r.recipients > 1 ? 's' : ''})` });

  async function submit() {
    if (await mutate({ ticketId: ticket.id, party, message: message.trim() })) {
      setMessage('');
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<MessageSquareShare />} title="Contacter une partie" description="Notification dans l’application du destinataire ; l’envoi est tracé dans le ticket." />
        <DialogBody className="space-y-4">
          <FormField label="Destinataire">
            <Select value={party} onValueChange={(v) => setParty(v as ContactTicketPartyInput['party'])} options={parties} />
          </FormField>
          <FormField label="Message" required>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="Bonjour, pouvez-vous nous confirmer l’oubli de la boisson sur la commande ?" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={message.trim().length < 5} onClick={() => void submit()}>Envoyer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EscalateDialog({ open, onOpenChange, ticket, agents }: Props & { agents: SupportAgent[] }) {
  const managers = agents.filter((a) => a.canEscalate);
  const [target, setTarget] = useState('queue');
  const [reason, setReason] = useState('');
  const release = ticket.escalated;
  const { mutate, loading } = useMutation(escalateTicket, { success: release ? 'Escalade levée' : 'Ticket escaladé' });

  async function submit() {
    const r = await mutate({ ticketId: ticket.id, escalateTo: release || target === 'queue' ? null : target, reason: reason.trim(), release });
    if (r) {
      setReason('');
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          icon={<Flame />}
          title={release ? 'Lever l’escalade' : 'Escalader à un responsable'}
          description={release ? 'Le ticket revient au traitement courant.' : 'Priorité relevée à « Haute » au minimum ; le responsable est notifié.'}
        />
        <DialogBody className="space-y-4">
          {!release && (
            <FormField label="Responsable">
              <Select
                value={target}
                onValueChange={setTarget}
                options={[{ value: 'queue', label: 'File des responsables (premier disponible)' }, ...managers.map((m) => ({ value: m.uid, label: `${m.displayName} · ${m.openTickets} ouverts` }))]}
              />
            </FormField>
          )}
          <FormField label="Motif" required hint="Contexte transmis au responsable et conservé dans le journal d’audit.">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={release ? 'Remboursement validé, reprise par l’agent.' : 'Client menaçant de porter plainte, montant au-delà de mon plafond.'} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant={release ? 'primary' : 'danger'} loading={loading} disabled={reason.trim().length < 3} onClick={() => void submit()}>
            {release ? 'Lever l’escalade' : 'Escalader'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LiveChatDialog({ open, onOpenChange, ticket }: Props) {
  const navigate = useNavigate();
  const [withDriver, setWithDriver] = useState(false);
  const [withRestaurant, setWithRestaurant] = useState(false);
  const [message, setMessage] = useState('Bonjour, ici le support Ciyou Eats. Je prends en charge votre commande, pouvez-vous me préciser la situation ?');
  const { mutate, loading } = useMutation(openSupportChat, { success: 'Chat ouvert' });

  async function submit() {
    if (!ticket.orderId) return;
    const r = await mutate({ orderId: ticket.orderId, ticketId: ticket.id, withDriver, withRestaurant, message: message.trim() });
    if (r) {
      onOpenChange(false);
      navigate(`/support/chat?c=${r.conversationId}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader icon={<MessagesSquare />} title="Ouvrir un chat en direct" description="Discussion en temps réel avec le client pendant la commande." />
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Checkbox checked={withDriver} onCheckedChange={(v) => setWithDriver(v === true)} disabled={!ticket.driverId} label="Inviter le livreur" description={ticket.driverId ? undefined : 'Aucun livreur assigné.'} />
            <Checkbox checked={withRestaurant} onCheckedChange={(v) => setWithRestaurant(v === true)} disabled={!ticket.restaurantId} label="Inviter le restaurant" />
          </div>
          <FormField label="Premier message" required>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={loading} disabled={message.trim().length < 2} onClick={() => void submit()}>Ouvrir le chat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
