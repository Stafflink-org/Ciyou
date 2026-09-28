import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { LifeBuoy } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FileUpload,
  FormField,
  Input,
  Select,
  Skeleton,
  Textarea,
  formatDate,
  toast,
} from '@golink/ui';
import { COLLECTIONS, type Order } from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { createSupportTicket, replyToSupportTicket, uploadTicketFiles, useTicketReasons } from './lib';

export function NewTicketDialog({
  open,
  onOpenChange,
  onCreated,
  defaultOrderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ticketId: string) => void;
  defaultOrderId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open && <Body onClose={() => onOpenChange(false)} onCreated={onCreated} defaultOrderId={defaultOrderId ?? null} />}</DialogContent>
    </Dialog>
  );
}

function Body({ onClose, onCreated, defaultOrderId }: { onClose: () => void; onCreated: (ticketId: string) => void; defaultOrderId: string | null }) {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const reasons = useTicketReasons();
  const orders = useCollection<Order>(can('orders.view') ? query(collectionAt(COLLECTIONS.orders), where('restaurantId', '==', restaurantId), orderBy('createdAt', 'desc'), limit(50)) : null);
  const [reasonId, setReasonId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [orderId, setOrderId] = useState(defaultOrderId ?? '');
  const [urgent, setUrgent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [touched, setTouched] = useState(false);
  const reason = reasons.data.find((r) => r.id === reasonId);

  const errors = useMemo(
    () => ({
      reason: !reasonId ? 'Choisissez un motif.' : undefined,
      subject: subject.trim().length < 5 ? 'Précisez l’objet (5 caractères minimum).' : undefined,
      body: body.trim().length < 10 ? 'Décrivez votre demande en quelques phrases.' : undefined,
      order: reason?.requiresOrder && !orderId ? 'Ce motif nécessite la commande concernée.' : undefined,
    }),
    [reasonId, subject, body, reason, orderId],
  );
  const shown: Partial<typeof errors> = touched ? errors : {};

  const create = useMutation(
    async () => {
      const ticket = await createSupportTicket({ restaurantId, reasonId, subject: subject.trim(), body: body.trim(), orderId: orderId || null, urgent });
      if (files.length) {
        try {
          const attachments = await uploadTicketFiles(ticket.ticketId, files);
          await replyToSupportTicket({ ticketId: ticket.ticketId, body: '', attachments, appendToMessageId: ticket.messageId });
        } catch {
          toast.error('La demande est créée, mais les pièces jointes n’ont pas pu être envoyées. Ajoutez-les depuis le ticket.');
        }
      }
      return ticket;
    },
    { success: (t) => `Demande ${t.number} envoyée au support GoLink.` },
  );

  return (
    <>
      <DialogHeader icon={<LifeBuoy />} title="Nouvelle demande au support" description="Notre équipe vous répond dans les délais indiqués, directement dans ce fil." />
      <DialogBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Motif" required error={shown.reason}>
            {reasons.loading ? (
              <Skeleton className="h-9" />
            ) : (
              <Select value={reasonId} onValueChange={setReasonId} placeholder="Choisir un motif…" options={reasons.data.map((r) => ({ value: r.id, label: r.label.fr }))} />
            )}
          </FormField>
          <FormField label={reason?.requiresOrder ? 'Commande concernée' : 'Commande concernée (facultatif)'} required={reason?.requiresOrder} error={shown.order}>
            <Select
              value={orderId || 'none'}
              onValueChange={(v) => setOrderId(v === 'none' ? '' : v)}
              disabled={!can('orders.view')}
              options={[
                { value: 'none', label: 'Aucune commande' },
                ...orders.data.map((o) => ({ value: o.id, label: `${o.number} · ${o.customerName}`, description: formatDate(toDate(o.createdAt) ?? new Date()) })),
              ]}
            />
          </FormField>
        </div>
        <FormField label="Objet" required error={shown.subject} aside={`${subject.length}/120`}>
          <Input maxLength={120} placeholder="Ex. Écart sur le reversement du 15 septembre" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label="Votre message" required error={shown.body} aside={`${body.length}/5000`}>
          <Textarea rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Décrivez la situation, les montants ou horaires concernés, et ce que vous attendez de nous." />
        </FormField>
        <FileUpload
          value={files}
          onChange={setFiles}
          accept="image/jpeg,image/png,image/webp,application/pdf"
          multiple
          maxFiles={5}
          maxSize={10 * 1024 * 1024}
          hint="Captures d’écran ou PDF, 5 fichiers au plus"
          onReject={(message) => toast.error(message)}
        />
        <Checkbox
          checked={urgent}
          onCheckedChange={(v) => setUrgent(v === true)}
          label="C’est urgent"
          description="Service bloqué ou commandes impossibles : votre demande est traitée en priorité."
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={create.loading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          loading={create.loading}
          onClick={async () => {
            setTouched(true);
            if (Object.values(errors).some(Boolean)) return;
            const ticket = await create.mutate();
            if (ticket) {
              onClose();
              onCreated(ticket.ticketId);
            }
          }}
        >
          Envoyer la demande
        </Button>
      </DialogFooter>
    </>
  );
}
