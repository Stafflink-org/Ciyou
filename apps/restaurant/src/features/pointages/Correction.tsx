import { useEffect, useState } from 'react';
import { orderBy, query } from 'firebase/firestore';
import { History, Pencil, Plus, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  IconButton,
  Skeleton,
  Switch,
  Textarea,
  TimeInput,
  Timeline,
  formatDateTime,
} from '@golink/ui';
import { SUBCOLLECTIONS, paths, type TimeEntry, type TimeEntryHistory, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useCollection, useMutation } from '@/lib/firestore';
import { formatFullDay } from '../_rh/dates';
import { correctTimeEntry } from '../_rh/functions';

const hhmm = (date: Date | null) => (date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '');

const FIELD_LABELS: Record<string, string> = { clockIn: 'Arrivée', clockOut: 'Sortie', breaks: 'Pauses' };

export interface CorrectionTarget {
  employeeId: string;
  employeeName: string;
  date: string;
  entry: WithId<TimeEntry> | null;
  planned?: { startTime: string; endTime: string } | null;
}

export function CorrectionDialog({ target, onClose }: { target: CorrectionTarget | null; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [running, setRunning] = useState(false);
  const [breaks, setBreaks] = useState<Array<{ start: string; end: string }>>([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!target) return;
    const entry = target.entry;
    setClockIn(hhmm(toDate(entry?.clockIn?.at)) || target.planned?.startTime || '10:30');
    setClockOut(hhmm(toDate(entry?.clockOut?.at)) || (entry?.clockIn ? '' : target.planned?.endTime || '15:00'));
    setRunning(Boolean(entry?.clockIn && !entry.clockOut));
    setBreaks((entry?.breaks ?? []).map((b) => ({ start: hhmm(toDate(b.start)), end: hhmm(toDate(b.end)) || hhmm(toDate(b.start)) })));
    setNotes(entry?.notes ?? '');
    setReason('');
  }, [target]);

  const save = useMutation(correctTimeEntry, { success: 'Pointage corrigé, historique mis à jour' });
  const invalid = !clockIn || (!running && !clockOut) || reason.trim().length < 3 || breaks.some((b) => !b.start || !b.end);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          icon={<Pencil />}
          title={target?.entry ? 'Corriger le pointage' : 'Saisir un pointage'}
          description={target ? `${target.employeeName} · ${formatFullDay(target.date)}` : undefined}
        />
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Arrivée" required>
              <TimeInput value={clockIn} onChange={setClockIn} step={1} aria-label="Heure d’arrivée" />
            </FormField>
            <FormField label="Sortie" required={!running} hint={clockOut && clockIn && clockOut < clockIn ? 'Le lendemain.' : undefined}>
              <TimeInput value={clockOut} onChange={setClockOut} step={1} disabled={running} aria-label="Heure de sortie" />
            </FormField>
          </div>
          <Switch label="Service toujours en cours" description="Aucune sortie pointée pour le moment." checked={running} onCheckedChange={setRunning} />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-fg">Pauses</p>
              <Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => setBreaks((b) => [...b, { start: '15:00', end: '15:20' }])} disabled={breaks.length >= 6}>
                Ajouter une pause
              </Button>
            </div>
            {breaks.length === 0 && <p className="text-xs text-fg-subtle">Aucune pause enregistrée.</p>}
            {breaks.map((pause, index) => (
              <div key={index} className="flex items-end gap-2">
                <FormField label="Début" className="flex-1">
                  <TimeInput value={pause.start} step={1} onChange={(v) => setBreaks((list) => list.map((b, i) => (i === index ? { ...b, start: v } : b)))} aria-label="Début de pause" />
                </FormField>
                <FormField label="Fin" className="flex-1">
                  <TimeInput value={pause.end} step={1} onChange={(v) => setBreaks((list) => list.map((b, i) => (i === index ? { ...b, end: v } : b)))} aria-label="Fin de pause" />
                </FormField>
                <IconButton label="Retirer la pause" variant="danger" onClick={() => setBreaks((list) => list.filter((_, i) => i !== index))}>
                  <X />
                </IconButton>
              </div>
            ))}
          </div>
          <FormField label="Note visible sur le pointage">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </FormField>
          <FormField label="Motif de la correction" required hint="Conservé dans l’historique et le journal d’audit.">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. oubli de pointage à la sortie" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={invalid}
            onClick={async () => {
              if (!target) return;
              const result = await save.mutate({
                restaurantId,
                employeeId: target.employeeId,
                date: target.date,
                clockIn,
                clockOut: running ? null : clockOut,
                breaks: breaks.map((b) => ({ start: b.start, end: b.end })),
                notes: notes.trim() || null,
                reason: reason.trim(),
              });
              if (result) onClose();
            }}
          >
            Enregistrer la correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EntryHistory({ entryId }: { entryId: string }) {
  const { restaurantId } = useRestaurantAccess();
  const history = useCollection<TimeEntryHistory>(
    query(collectionAt(`${paths.restaurantSub(restaurantId, 'timeEntries')}/${entryId}/${SUBCOLLECTIONS.timeEntries.history}`), orderBy('changedAt', 'desc')),
  );
  if (history.loading) return <Skeleton className="h-12" />;
  if (history.data.length === 0) {
    return <EmptyState compact icon={<History />} title="Aucune correction" description="Ce pointage n’a jamais été modifié." />;
  }
  return (
    <Timeline
      items={history.data.map((item) => {
        const at = toDate(item.changedAt);
        return {
          id: item.id,
          tone: 'plum' as const,
          icon: <Pencil />,
          title: `${FIELD_LABELS[item.field] ?? item.field} : ${item.oldValue ?? '—'} → ${item.newValue ?? '—'}`,
          description: `${item.changedByName ?? 'Responsable'}${item.reason ? ` · ${item.reason}` : ''}`,
          time: at ? formatDateTime(at) : undefined,
        };
      })}
    />
  );
}
