import { useEffect, useState } from 'react';
import { addDoc } from 'firebase/firestore';
import { CalendarPlus } from 'lucide-react';
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
  Switch,
  Textarea,
  toast,
} from '@golink/ui';
import { ABSENCE_TYPES, ABSENCE_TYPE_LABELS, paths, type Absence, type AbsenceType, type StaffDirectoryEntry, type WithId } from '@golink/shared';
import { useAuth } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, createdFields, useMutation } from '@/lib/firestore';
import { addDays, countAbsenceDays, formatDays, todayIso } from '../_rh/dates';
import { TEAM_FILE_ACCEPT, TEAM_FILE_MAX_BYTES, uploadTeamFile } from '../_rh/files';
import { reviewAbsence } from '../_rh/functions';

export function AbsenceRequestDialog({
  open,
  onOpenChange,
  mode,
  employees,
  myEmployeeId,
  balances,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** « self » : demande du salarié ; « manager » : saisie pour un salarié. */
  mode: 'self' | 'manager';
  employees: WithId<StaffDirectoryEntry>[];
  myEmployeeId: string | null;
  balances?: Map<string, { paid: number; rtt: number }>;
}) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState<AbsenceType>('paid_leave');
  const [startDate, setStartDate] = useState(addDays(todayIso(), 7));
  const [endDate, setEndDate] = useState(addDays(todayIso(), 7));
  const [halfDayStart, setHalfDayStart] = useState(false);
  const [halfDayEnd, setHalfDayEnd] = useState(false);
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [approveNow, setApproveNow] = useState(true);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(mode === 'self' ? (myEmployeeId ?? '') : (employees[0]?.employeeId ?? ''));
    setType('paid_leave');
    setStartDate(addDays(todayIso(), 7));
    setEndDate(addDays(todayIso(), 7));
    setHalfDayStart(false);
    setHalfDayEnd(false);
    setReason('');
    setFiles([]);
    setApproveNow(true);
  }, [open, mode, myEmployeeId, employees]);

  const duration = countAbsenceDays({ startDate, endDate, halfDayStart, halfDayEnd });
  const balance = balances?.get(employeeId);
  const balanceValue = type === 'paid_leave' ? balance?.paid : type === 'rtt' ? balance?.rtt : undefined;
  const invalid = !employeeId || !startDate || !endDate || endDate < startDate || duration <= 0;

  const submit = useMutation(
    async () => {
      const entry = employees.find((e) => (e.employeeId ?? e.id) === employeeId);
      const attachment = files[0] ? await uploadTeamFile(restaurantId, `absences/${employeeId}`, files[0], user!.uid) : null;
      const data: Omit<Absence, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> = {
        employeeId,
        employeeUid: mode === 'self' ? user!.uid : (entry?.uid ?? null),
        type,
        startDate,
        endDate,
        halfDayStart,
        halfDayEnd,
        durationDays: duration,
        reason: reason.trim() || null,
        attachment,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
      };
      const ref = await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'absences')), { ...data, ...createdFields(user!.uid) });
      if (mode === 'manager' && approveNow) {
        await reviewAbsence({ restaurantId, absenceId: ref.id, decision: 'approve', allowNegativeBalance: true, removeShifts: true });
      }
      return true;
    },
    { success: mode === 'self' ? 'Demande envoyée à votre responsable' : approveNow ? 'Absence enregistrée et acceptée' : 'Absence enregistrée' },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          icon={<CalendarPlus />}
          title={mode === 'self' ? 'Demander une absence' : 'Saisir une absence'}
          description={mode === 'self' ? 'Votre responsable est notifié et vous répond dans l’application.' : 'Congé, arrêt maladie, formation… pour un membre de l’équipe.'}
        />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'manager' && (
              <FormField label="Salarié" required>
                <Select value={employeeId} onValueChange={setEmployeeId} options={employees.map((e) => ({ value: e.employeeId ?? e.id, label: e.displayName }))} />
              </FormField>
            )}
            <FormField label="Type d’absence" required className={mode === 'self' ? 'sm:col-span-2' : undefined}>
              <Select value={type} onValueChange={(v) => setType(v as AbsenceType)} options={ABSENCE_TYPES.map((t) => ({ value: t, label: ABSENCE_TYPE_LABELS[t] }))} />
            </FormField>
            <FormField label="Du" required>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
              />
            </FormField>
            <FormField label="Au" required error={endDate < startDate ? 'La fin doit suivre le début' : undefined}>
              <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormField>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label="Premier jour : après-midi seulement" checked={halfDayStart} onCheckedChange={(v) => setHalfDayStart(v === true)} />
            <Checkbox label="Dernier jour : matin seulement" checked={halfDayEnd} onCheckedChange={(v) => setHalfDayEnd(v === true)} disabled={startDate === endDate} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
            <span className="text-fg-muted">
              Durée décomptée : <span className="font-mono font-semibold text-fg num">{formatDays(duration)}</span>
            </span>
            {balanceValue !== undefined && (
              <span className={balanceValue - duration < 0 ? 'text-danger' : 'text-fg-muted'}>
                Solde après : <span className="font-mono font-semibold num">{formatDays(balanceValue - duration)}</span>
              </span>
            )}
          </div>
          <FormField label="Motif ou précision">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </FormField>
          {(type === 'sick' || type === 'family_event' || type === 'training') && (
            <FormField label="Justificatif" hint="Arrêt de travail, convocation… PDF ou photo, 15 Mo au maximum.">
              <FileUpload value={files} onChange={setFiles} accept={TEAM_FILE_ACCEPT} maxSize={TEAM_FILE_MAX_BYTES} onReject={(message) => toast.error(message)} />
            </FormField>
          )}
          {mode === 'manager' && (
            <Switch
              label="Accepter directement"
              description="Le solde est mis à jour et les créneaux prévus pendant l’absence sont retirés du planning."
              checked={approveNow}
              onCheckedChange={setApproveNow}
            />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={submit.loading}
            disabled={invalid}
            onClick={async () => {
              if (await submit.mutate()) onOpenChange(false);
            }}
          >
            {mode === 'self' ? 'Envoyer la demande' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
