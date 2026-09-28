// Fenêtres d'action de la fiche restaurant : suspension, réactivation, « voir
// comme le restaurant », décision sur le dossier d'inscription.
import { useState, type ReactNode } from 'react';
import { Ban, CheckCircle2, Eye, FileWarning, Play, XCircle } from 'lucide-react';
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  RadioGroup,
  Select,
  Textarea,
  TimeInput,
  toast,
} from '@golink/ui';
import { PARTNER_DOCUMENT_LABELS, type ApplicationDecision, type PartnerDocumentType, type Restaurant, type WithId } from '@golink/shared';
import { env } from '@/lib/env';
import { useMutation } from '@/lib/firestore';
import { reactivateRestaurant, reviewRestaurantApplication, startImpersonation, suspendRestaurant } from '../lib';

type R = WithId<Restaurant>;

function ReasonField({ value, onChange, label = 'Motif', hint = 'Conservé dans le journal d’audit.' }: { value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
  return (
    <FormField label={label} required hint={hint}>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={500} />
    </FormField>
  );
}

// ------------------------------------------------------------------ Suspension

export function SuspendDialog({ restaurant, open, onOpenChange }: { restaurant: R; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kind, setKind] = useState<'temporary' | 'permanent'>('temporary');
  const [date, setDate] = useState<Date | undefined>(() => new Date(Date.now() + 7 * 86_400_000));
  const [time, setTime] = useState('10:00');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const run = useMutation(suspendRestaurant, { success: (r) => (r.status === 'closed' ? 'Commerce fermé définitivement' : 'Commerce suspendu') });

  function until(): string | null {
    if (kind === 'permanent' || !date) return null;
    const [h, m] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h ?? 10, m ?? 0, 0, 0);
    return d.toISOString();
  }
  const untilIso = until();
  const invalidDate = kind === 'temporary' && (!untilIso || Date.parse(untilIso) <= Date.now());

  return (
    <Dialog open={open} onOpenChange={(o) => !run.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Ban className="text-danger" />} title={`Suspendre ${restaurant.name}`} description="Le commerce disparaît de l’application et ne reçoit plus de commandes. Le propriétaire est prévenu par e-mail." />
        <DialogBody className="space-y-4">
          <RadioGroup
            variant="cards"
            value={kind}
            onValueChange={(v) => setKind(v as typeof kind)}
            options={[
              { value: 'temporary', label: 'Temporaire', description: 'Réactivation automatique à la date choisie.' },
              { value: 'permanent', label: 'Définitive', description: 'Retrait de la plateforme, réactivable à la main.' },
            ]}
          />
          {kind === 'temporary' && (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <FormField label="Jusqu’au" required>
                <DatePicker value={date} onChange={setDate} disabledDays={{ before: new Date() }} />
              </FormField>
              <FormField label="Heure">
                <TimeInput value={time} onChange={setTime} aria-label="Heure de fin" />
              </FormField>
            </div>
          )}
          <ReasonField value={reason} onChange={setReason} />
          <FormField label="Message au restaurant" hint="Facultatif, ajouté à l’e-mail.">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={1000} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={run.loading}
            disabled={reason.trim().length < 3 || invalidDate}
            onClick={() =>
              void run
                .mutate({ restaurantId: restaurant.id, kind, until: untilIso, reason: reason.trim(), message: message.trim() || null })
                .then((r) => r && onOpenChange(false))
            }
          >
            {kind === 'permanent' ? 'Fermer définitivement' : 'Suspendre'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReactivateDialog({ restaurant, open, onOpenChange }: { restaurant: R; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState('');
  const run = useMutation(reactivateRestaurant, { success: 'Commerce réactivé' });
  const documents = restaurant.suspension?.kind === 'documents';
  return (
    <Dialog open={open} onOpenChange={(o) => !run.loading && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader icon={<Play />} title={`Réactiver ${restaurant.name}`} description="Le commerce redevient visible ; il rouvre depuis son back-office." />
        <DialogBody className="space-y-4">
          {documents && (
            <p className="tone-amber rounded-lg border border-(--tone-border) bg-(--tone-bg) px-3 py-2 text-sm text-(--tone-fg)">
              Suspension automatique pour document expiré : préférez valider un nouveau document, la réactivation sera alors automatique.
            </p>
          )}
          <ReasonField value={reason} onChange={setReason} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={run.loading}
            disabled={reason.trim().length < 3}
            onClick={() => void run.mutate({ restaurantId: restaurant.id, reason: reason.trim() }).then((r) => r && onOpenChange(false))}
          >
            Réactiver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ « Voir comme le restaurant »

export function ImpersonateDialog({ restaurant, open, onOpenChange }: { restaurant: R; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('30');
  const run = useMutation(startImpersonation);

  async function start() {
    const session = await run.mutate({ restaurantId: restaurant.id, reason: reason.trim(), durationMinutes: Number(duration) });
    if (!session) return;
    toast.success('Session « voir comme » ouverte', { description: 'Connectez-vous avec votre compte Ciyou Eats dans l’espace restaurant si besoin.' });
    window.open(`${env.restaurantAppUrl}/?voir-comme=${encodeURIComponent(restaurant.id)}`, '_blank', 'noopener');
    setReason('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !run.loading && onOpenChange(o)}>
      <DialogContent size="sm">
        <DialogHeader icon={<Eye />} title="Voir comme le restaurant" description={`Ouvre l’espace de ${restaurant.name} en lecture seule, pour dépanner le partenaire.`} />
        <DialogBody className="space-y-4">
          <ul className="space-y-1.5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-fg-muted">
            <li>· Lecture seule : aucune modification possible.</li>
            <li>· Ouverture, durée et fin enregistrées au journal d’audit.</li>
            <li>· La session se termine automatiquement à l’échéance.</li>
          </ul>
          <FormField label="Durée">
            <Select
              value={duration}
              onValueChange={setDuration}
              options={[
                { value: '15', label: '15 minutes' },
                { value: '30', label: '30 minutes' },
                { value: '60', label: '1 heure' },
                { value: '120', label: '2 heures' },
              ]}
            />
          </FormField>
          <ReasonField value={reason} onChange={setReason} label="Motif de l’accès" hint="Ex. : le gérant signale une erreur d’affichage de sa carte." />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={run.loading} disabled={reason.trim().length < 3} leftIcon={<Eye />} onClick={() => void start()}>
            Ouvrir l’espace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Décision sur le dossier

const DECISIONS: Record<ApplicationDecision, { title: string; icon: ReactNode; confirm: string; variant: 'primary' | 'danger' | 'secondary' }> = {
  approve: { title: 'Valider le dossier', icon: <CheckCircle2 className="text-success" />, confirm: 'Valider', variant: 'primary' },
  documents_missing: { title: 'Demander des documents', icon: <FileWarning />, confirm: 'Envoyer la demande', variant: 'primary' },
  reject: { title: 'Refuser le dossier', icon: <XCircle className="text-danger" />, confirm: 'Refuser', variant: 'danger' },
};

const REQUESTABLE: PartnerDocumentType[] = ['kbis', 'siret_notice', 'manager_id', 'bank_details', 'hygiene_certificate', 'other'];

export function DecisionDialog({
  restaurant,
  decision,
  onOpenChange,
  suggestedMissing,
}: {
  restaurant: R;
  decision: ApplicationDecision | null;
  onOpenChange: (o: boolean) => void;
  suggestedMissing: PartnerDocumentType[];
}) {
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState<PartnerDocumentType[]>(suggestedMissing);
  const [goLive, setGoLive] = useState(true);
  const run = useMutation(reviewRestaurantApplication, {
    success: (r) => (r.onboardingStatus === 'approved' ? 'Dossier validé' : r.onboardingStatus === 'rejected' ? 'Dossier refusé' : 'Demande de documents envoyée'),
  });
  if (!decision) return null;
  const meta = DECISIONS[decision];
  const needsReason = decision !== 'approve';
  const blocked = (needsReason && reason.trim().length < 3) || (decision === 'documents_missing' && missing.length === 0);

  return (
    <Dialog open={Boolean(decision)} onOpenChange={(o) => !run.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader
          icon={meta.icon}
          title={meta.title}
          description={
            decision === 'approve'
              ? `${restaurant.name} pourra recevoir des commandes. Le propriétaire est prévenu par e-mail.`
              : decision === 'reject'
                ? 'Le motif est envoyé au restaurant. Le dossier pourra être réexaminé plus tard.'
                : 'Le restaurant reçoit la liste des pièces à déposer depuis son back-office.'
          }
        />
        <DialogBody className="space-y-4">
          {decision === 'approve' && restaurant.status === 'onboarding' && (
            <label className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
              <Checkbox checked={goLive} onCheckedChange={(v) => setGoLive(v === true)} className="mt-0.5" aria-label="Mettre en ligne" />
              <span>
                <span className="block text-sm font-medium text-fg">Mettre en ligne immédiatement</span>
                <span className="block text-xs text-fg-subtle">Le commerce apparaît dans l’application ; il ouvre quand il le souhaite.</span>
              </span>
            </label>
          )}
          {decision === 'documents_missing' && (
            <FormField label="Pièces à fournir" required>
              <div className="grid gap-2 sm:grid-cols-2">
                {REQUESTABLE.map((type) => (
                  <label key={type} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm text-fg">
                    <Checkbox
                      checked={missing.includes(type)}
                      onCheckedChange={(v) => setMissing((list) => (v === true ? [...list, type] : list.filter((t) => t !== type)))}
                      aria-label={PARTNER_DOCUMENT_LABELS[type]}
                    />
                    {PARTNER_DOCUMENT_LABELS[type]}
                  </label>
                ))}
              </div>
            </FormField>
          )}
          {needsReason && <ReasonField value={reason} onChange={setReason} label={decision === 'reject' ? 'Motif du refus (envoyé au restaurant)' : 'Message au restaurant'} hint="Envoyé au restaurant et conservé dans le journal d’audit." />}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={run.loading}>
            Annuler
          </Button>
          <Button
            variant={meta.variant}
            loading={run.loading}
            disabled={blocked}
            onClick={() =>
              void run
                .mutate({ restaurantId: restaurant.id, decision, reason: reason.trim() || null, missingDocuments: missing, goLive })
                .then((r) => {
                  if (r) {
                    setReason('');
                    onOpenChange(false);
                  }
                })
            }
          >
            {meta.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
