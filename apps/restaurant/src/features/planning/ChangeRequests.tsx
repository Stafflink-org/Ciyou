import { useEffect, useState } from 'react';
import { addDoc, doc, updateDoc } from 'firebase/firestore';
import { ArrowRight, Check, MessageSquareMore, Repeat2, X } from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  StatusBadge,
  Textarea,
  TimeInput,
  formatRelative,
} from '@golink/ui';
import { paths, type Shift, type ShiftChangeRequest, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, toDate, updatedFields, useMutation } from '@/lib/firestore';
import { formatFullDay, formatShortDay } from '../_rh/dates';
import { reviewShiftChangeRequest } from '../_rh/functions';
import type { StaffDirectory } from '../_rh/hooks';
import { REQUEST_STATUS } from '../_rh/ui';

export function PendingRequestsPanel({
  requests,
  shifts,
  directory,
}: {
  requests: WithId<ShiftChangeRequest>[];
  shifts: WithId<Shift>[];
  directory: StaffDirectory;
}) {
  const { restaurantId } = useRestaurantAccess();
  const [rejecting, setRejecting] = useState<WithId<ShiftChangeRequest> | null>(null);
  const review = useMutation(reviewShiftChangeRequest, {
    success: (result) => (result.status === 'approved' ? 'Demande acceptée, planning mis à jour' : 'Demande refusée'),
  });
  if (requests.length === 0) return null;

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        icon={<Repeat2 />}
        title={`Demandes de modification · ${requests.length}`}
        description="Les salariés proposent un changement de créneau. Une réponse leur est notifiée."
        divided
      />
      <ul className="divide-y divide-border">
        {requests.map((request) => {
          const person = directory.byEmployeeId.get(request.employeeId);
          const current = request.shiftId ? shifts.find((s) => s.id === request.shiftId) : null;
          const created = toDate(request.createdAt);
          return (
            <li key={request.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Avatar name={person?.displayName ?? 'Salarié'} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {person?.displayName ?? 'Salarié'}
                    {created && <span className="ml-2 text-xs font-normal text-fg-subtle">{formatRelative(created)}</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">
                    {current ? (
                      <>
                        <span className="font-mono num">{formatShortDay(current.date)} {current.startTime}–{current.endTime}</span>
                        <ArrowRight className="size-3.5" />
                      </>
                    ) : null}
                    <span className="font-mono font-medium text-fg num">
                      {formatShortDay(request.date)} {request.startTime}–{request.endTime}
                    </span>
                  </p>
                  {request.note && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-sm text-fg-muted">
                      <MessageSquareMore className="mt-0.5 size-3.5 shrink-0" />« {request.note} »
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 pl-11 lg:pl-0">
                <Button size="sm" variant="ghost" leftIcon={<X />} onClick={() => setRejecting(request)}>
                  Refuser
                </Button>
                <Button
                  size="sm"
                  variant="contrast"
                  leftIcon={<Check />}
                  loading={review.loading}
                  onClick={() => void review.mutate({ restaurantId, requestId: request.id, decision: 'approve' })}
                >
                  Accepter
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="Refuser la demande"
        description="Le salarié reçoit le motif dans ses notifications."
        confirmLabel="Refuser la demande"
        destructive
        requireReason
        reasonLabel="Motif communiqué au salarié"
        onConfirm={async (reason) => {
          if (rejecting) await review.mutate({ restaurantId, requestId: rejecting.id, decision: 'reject', reason });
        }}
      />
    </Card>
  );
}

/** Demande de modification d'un créneau par le salarié. */
export function RequestChangeDialog({
  shift,
  employeeId,
  onClose,
}: {
  shift: WithId<Shift> | null;
  employeeId: string | null;
  onClose: () => void;
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (shift) {
      setDate(shift.date);
      setStartTime(shift.startTime);
      setEndTime(shift.endTime);
      setNote('');
    }
  }, [shift]);

  const send = useMutation(
    async () => {
      const data: Omit<ShiftChangeRequest, 'createdAt' | 'updatedAt'> = {
        employeeId: employeeId!,
        employeeUid: user!.uid,
        shiftId: shift?.id ?? null,
        date,
        startTime,
        endTime,
        note: note.trim() || null,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      };
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'shiftChangeRequests')), { ...data, ...createdFields(user!.uid) });
      return true;
    },
    { success: 'Demande envoyée à votre responsable' },
  );

  return (
    <Dialog open={shift !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<Repeat2 />} title="Demander une modification" description={shift ? `Créneau du ${formatFullDay(shift.date)}, ${shift.startTime}–${shift.endTime}` : undefined} />
        <DialogBody className="space-y-4">
          <FormField label="Jour souhaité">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Début">
              <TimeInput value={startTime} onChange={setStartTime} aria-label="Début souhaité" />
            </FormField>
            <FormField label="Fin">
              <TimeInput value={endTime} onChange={setEndTime} aria-label="Fin souhaitée" />
            </FormField>
          </div>
          <FormField label="Message" hint="Expliquez brièvement la raison.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={send.loading}
            disabled={!date || !startTime || !endTime || !employeeId}
            onClick={async () => {
              if (await send.mutate()) onClose();
            }}
          >
            Envoyer la demande
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MyRequestsList({ requests }: { requests: WithId<ShiftChangeRequest>[] }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const cancel = useMutation(
    async (id: string) => {
      await updateDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'shiftChangeRequests')), id), { status: 'cancelled', ...updatedFields(user!.uid) });
    },
    { success: 'Demande annulée' },
  );
  if (requests.length === 0) return null;
  return (
    <Card className="mt-4">
      <CardHeader icon={<Repeat2 />} title="Mes demandes de modification" divided />
      <ul className="divide-y divide-border">
        {requests.slice(0, 6).map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="font-mono text-fg num">
              {formatShortDay(request.date)} · {request.startTime}–{request.endTime}
            </span>
            <span className="flex items-center gap-2">
              {request.status === 'rejected' && request.rejectionReason && <span className="text-xs text-fg-subtle">{request.rejectionReason}</span>}
              <StatusBadge status={request.status} map={REQUEST_STATUS} />
              {request.status === 'pending' && (
                <Button size="xs" variant="ghost" onClick={() => void cancel.mutate(request.id)}>
                  Annuler
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
