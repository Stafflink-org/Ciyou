// Actions sur un compte client : avoir, blocage (unitaire ou groupé) et
// suppression conforme au RGPD. Motif obligatoire, tracé au journal d'audit.
import { useMemo, useState } from 'react';
import { Ban, Gift, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  Textarea,
  toast,
} from '@golink/ui';
import { CUSTOMER_CREDIT_REASON_LABELS, CUSTOMER_RETAINED_DATA, type CustomerCreditReason, type Order, type UserProfile, type WithId } from '@golink/shared';
import { errorMessage, useMutation } from '@/lib/firestore';
import { eur, plural } from '../../acteurs-commun/ui';
import { blockCustomer, creditCustomer, deleteCustomerAccount, useRefundPolicy } from '../lib';

export function BlockCustomerDialog({
  users,
  blocked,
  open,
  onOpenChange,
  onDone,
}: {
  users: WithId<UserProfile>[];
  blocked: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    let ok = 0;
    const failures: string[] = [];
    for (const user of users) {
      try {
        await blockCustomer({ userId: user.id, blocked, reason: reason.trim() });
        ok += 1;
      } catch (error) {
        failures.push(`${user.displayName} : ${errorMessage(error, 'échec')}`);
      }
    }
    setPending(false);
    if (ok) toast.success(blocked ? `${plural(ok, 'compte bloqué', 'comptes bloqués')}` : `${plural(ok, 'compte débloqué', 'comptes débloqués')}`);
    if (failures.length) toast.error(`${plural(failures.length, 'échec', 'échecs')}`, { description: failures.slice(0, 3).join(' · ') });
    setReason('');
    onDone?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader
          icon={blocked ? <Ban className="text-danger" /> : <ShieldCheck />}
          title={blocked ? (users.length > 1 ? `Bloquer ${users.length} comptes` : `Bloquer ${users[0]?.displayName ?? 'le compte'}`) : `Débloquer ${users[0]?.displayName ?? 'le compte'}`}
          description={
            blocked
              ? 'Le client est déconnecté et ne peut plus commander ni se reconnecter tant que le blocage est actif.'
              : 'Le client peut de nouveau se connecter et commander.'
          }
        />
        <DialogBody className="space-y-3">
          {users.length === 0 && <p className="text-sm text-fg-muted">Aucun compte actif dans la sélection.</p>}
          <FormField label="Motif" required hint="Conservé dans le journal d’audit.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={blocked ? 'Réclamations abusives répétées, fraude au paiement…' : ''} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant={blocked ? 'danger' : 'primary'} loading={pending} disabled={reason.trim().length < 3 || users.length === 0} onClick={() => void submit()}>
            {blocked ? 'Bloquer' : 'Débloquer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreditDialog({
  user,
  orders,
  open,
  onOpenChange,
}: {
  user: WithId<UserProfile>;
  orders: WithId<Order>[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  // Plafond fourni par le serveur (règle unique : agent, rôle, seuil plateforme).
  const policy = useRefundPolicy();
  const limitCents = policy?.limitCents ?? Number.MAX_SAFE_INTEGER;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<CustomerCreditReason>('commercial_gesture');
  const [orderId, setOrderId] = useState('none');
  const [validity, setValidity] = useState('180');
  const [note, setNote] = useState('');
  const run = useMutation(creditCustomer, { success: (r) => `Avoir crédité · nouveau solde ${eur(r.balanceAfterCents)}` });
  const cents = useMemo(() => {
    const n = Number(amount.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [amount]);
  const overLimit = cents > limitCents;
  const linked = orderId !== 'none' && (reason === 'refund' || reason === 'late_delivery');

  return (
    <Dialog open={open} onOpenChange={(o) => !run.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Gift />} title="Créditer un avoir" description={`Solde actuel de ${user.displayName} : ${eur(user.walletBalanceCents ?? 0)}. L’avoir est utilisable sur la prochaine commande.`} />
        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Montant" required error={overLimit ? `Au-delà de votre plafond (${eur(limitCents)})` : undefined}>
              <Input inputMode="decimal" trailing="€" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5,00" />
            </FormField>
            <FormField label="Motif">
              <Select value={reason} onValueChange={(v) => setReason(v as CustomerCreditReason)} options={Object.entries(CUSTOMER_CREDIT_REASON_LABELS).map(([value, label]) => ({ value, label }))} />
            </FormField>
            <FormField label="Commande liée">
              <Select
                value={orderId}
                onValueChange={setOrderId}
                options={[{ value: 'none', label: 'Aucune' }, ...orders.slice(0, 20).map((o) => ({ value: o.id, label: `${o.number} · ${o.restaurantName}` }))]}
              />
            </FormField>
            <FormField label="Validité">
              <Select
                value={validity}
                onValueChange={setValidity}
                options={[
                  { value: '30', label: '30 jours' },
                  { value: '90', label: '3 mois' },
                  { value: '180', label: '6 mois' },
                  { value: '365', label: '1 an' },
                  { value: 'none', label: 'Sans expiration' },
                ]}
              />
            </FormField>
          </div>
          {linked && (
            <p className="tone-info rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              Remboursement lié à une commande : le montant est imputé au commerce et déduit de son prochain reversement.
            </p>
          )}
          <FormField label="Contexte" required hint="Visible par l’équipe et conservé dans le journal d’audit.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="Plat manquant signalé au support, ticket T-000123…" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={run.loading}
            disabled={cents < 50 || overLimit || note.trim().length < 3}
            onClick={() =>
              void run
                .mutate({ userId: user.id, amountCents: cents, reason, note: note.trim(), orderId: orderId === 'none' ? null : orderId, validityDays: validity === 'none' ? null : Number(validity) })
                .then((r) => {
                  if (r) {
                    setAmount('');
                    setNote('');
                    onOpenChange(false);
                  }
                })
            }
          >
            Créditer {cents ? eur(cents) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCustomerDialog({ user, open, onOpenChange, onDeleted }: { user: WithId<UserProfile>; open: boolean; onOpenChange: (o: boolean) => void; onDeleted: () => void }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const run = useMutation(deleteCustomerAccount, { success: 'Compte supprimé et anonymisé' });
  const expected = 'SUPPRIMER';
  return (
    <Dialog open={open} onOpenChange={(o) => !run.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Trash2 className="text-danger" />} title="Supprimer le compte (RGPD)" description="Suppression définitive : le profil est anonymisé, les adresses, moyens de paiement et appareils sont effacés, la connexion est supprimée." />
        <DialogBody className="space-y-4">
          <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
            <p className="text-sm font-medium text-fg">Données conservées (obligations légales)</p>
            <ul className="mt-1.5 space-y-1 text-sm text-fg-muted">
              {CUSTOMER_RETAINED_DATA.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
          {(user.walletBalanceCents ?? 0) > 0 && (
            <p className="tone-amber rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              Le solde d’avoir de {eur(user.walletBalanceCents)} sera annulé.
            </p>
          )}
          <FormField label="Motif" required hint="Demande du client, obligation légale…">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </FormField>
          <FormField label={`Tapez ${expected} pour confirmer`} required>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={run.loading}
            disabled={reason.trim().length < 3 || confirm.trim().toUpperCase() !== expected}
            onClick={() =>
              void run.mutate({ userId: user.id, reason: reason.trim() }).then((r) => {
                if (r) {
                  onOpenChange(false);
                  onDeleted();
                }
              })
            }
          >
            Supprimer définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
