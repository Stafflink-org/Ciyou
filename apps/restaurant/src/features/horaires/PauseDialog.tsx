import { useEffect, useState } from 'react';
import { Pause } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, FormField, Input, RadioGroup } from '@golink/ui';

const DURATIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 heure' },
  { value: '120', label: '2 heures' },
  { value: 'day', label: 'Jusqu’à demain matin' },
];

const REASONS = ['Rush en cuisine', 'Rupture de produits', 'Problème technique', 'Manque de personnel'];

/** Minutes restantes jusqu'au lendemain 6 h (heure locale du navigateur). */
function minutesUntilTomorrow(): number {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  next.setHours(6, 0, 0, 0);
  return Math.max(10, Math.round((next.getTime() - now.getTime()) / 60_000));
}

/** Pause temporaire des nouvelles commandes, avec reprise automatique. */
export function PauseDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (minutes: number, reason: string | null) => Promise<boolean>;
  loading: boolean;
}) {
  const [duration, setDuration] = useState('30');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setDuration('30');
      setReason('');
    }
  }, [open]);

  const confirm = async () => {
    const minutes = duration === 'day' ? minutesUntilTomorrow() : Number(duration);
    if (await onConfirm(minutes, reason.trim() || null)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<Pause />}
          title="Mettre les commandes en pause"
          description="Votre établissement apparaîtra « momentanément indisponible » dans l’app, puis rouvrira automatiquement."
        />
        <DialogBody className="space-y-5">
          <RadioGroup variant="cards" value={duration} onValueChange={setDuration} options={DURATIONS} />
          <FormField label="Motif (facultatif)" hint="Pour l’historique de votre équipe, non visible des clients.">
            <Input value={reason} maxLength={120} list="golink-pause-reasons" onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <datalist id="golink-pause-reasons">
            {REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void confirm()}>
            Mettre en pause
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
