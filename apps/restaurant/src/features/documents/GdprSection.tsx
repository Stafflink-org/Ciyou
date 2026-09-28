// Dépôt d'une demande RGPD par l'établissement lui-même (§29, auto-service) : accès,
// portabilité, rectification, effacement, opposition. Sans cet écran, seule l'équipe
// support pouvait ouvrir une demande pour le compte du commerce.
import { useState } from 'react';
import { Download, ShieldQuestion } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Select,
  StatusPill,
  Textarea,
  formatDate,
  toast,
  type Tone,
} from '@golink/ui';
import { GDPR_REQUEST_STATUS_LABELS, GDPR_REQUEST_TYPE_LABELS, type GdprRequestStatus, type GdprRequestType } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, toDate, useMutation } from '@/lib/firestore';
import { getGdprExportLink, submitGdprRequest } from '../parametres/kit/api';
import { LoadError } from '../parametres/kit/ui';
import { useGdprRequests } from './hooks';

const STATUS_TONE: Record<GdprRequestStatus, Tone> = {
  received: 'info',
  identity_check: 'amber',
  in_progress: 'info',
  completed: 'success',
  rejected: 'danger',
};

const TYPES: GdprRequestType[] = ['access', 'portability', 'rectification', 'erasure', 'objection'];

/** Données personnelles (RGPD) : demander un accès, une portabilité, une rectification, un effacement, ou s'opposer — pour l'établissement. */
export function GdprSection() {
  const { restaurantId, restaurant } = useRestaurantAccess();
  const requests = useGdprRequests();
  const [open, setOpen] = useState(false);

  const open3 = requests.data.filter((r) => r.status !== 'completed' && r.status !== 'rejected');
  const hasOpen = open3.length > 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted">
            <ShieldQuestion className="size-[18px]" />
          </div>
          <div>
            <h2 className="font-display text-md font-semibold tracking-tight text-fg">Données personnelles</h2>
            <p className="mt-0.5 text-sm text-fg-muted">
              Demandez l’accès, la portabilité, la rectification ou l’effacement des données de {restaurant.name} détenues par Ciyou Eats, ou opposez-vous à un traitement. Réponse sous 30 jours.
            </p>
          </div>
        </div>
        <Button variant="secondary" disabled={hasOpen} onClick={() => setOpen(true)}>
          {hasOpen ? 'Demande en cours' : 'Faire une demande'}
        </Button>
      </div>

      {requests.error ? (
        <div className="p-5 pt-0">
          <LoadError message={errorMessage(requests.error)} />
        </div>
      ) : requests.data.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {requests.data.map((r) => {
            const receivedAt = toDate(r.receivedAt);
            const dueAt = toDate(r.dueAt);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{GDPR_REQUEST_TYPE_LABELS[r.type]}</p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    Déposée {receivedAt ? `le ${formatDate(receivedAt)}` : ''}
                    {dueAt ? ` · réponse attendue avant le ${formatDate(dueAt)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.status === 'completed' && r.export ? <DownloadExportButton requestId={r.id} /> : null}
                  <StatusPill tone={STATUS_TONE[r.status]}>{GDPR_REQUEST_STATUS_LABELS[r.status]}</StatusPill>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <GdprDialog restaurantId={restaurantId} open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

/** Téléchargement de l'export via un lien signé (15 minutes), jamais un fichier public. */
function DownloadExportButton({ requestId }: { requestId: string }) {
  const [loading, setLoading] = useState(false);

  const download = async () => {
    setLoading(true);
    try {
      const result = await getGdprExportLink({ requestId });
      if (result) window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(errorMessage(error, 'Le lien de téléchargement n’a pas pu être généré.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" leftIcon={<Download className="size-4" />} loading={loading} onClick={() => void download()}>
      Télécharger
    </Button>
  );
}

function GdprDialog({ restaurantId, open, onClose }: { restaurantId: string; open: boolean; onClose: () => void }) {
  const [type, setType] = useState<GdprRequestType>('access');
  const [notes, setNotes] = useState('');
  const submit = useMutation(submitGdprRequest, { success: () => 'Demande enregistrée. Vous recevrez une réponse sous 30 jours au plus tard.' });

  const send = async () => {
    const result = await submit.mutate({ restaurantId, type, notes: notes.trim() || null });
    if (result) {
      setNotes('');
      onClose();
    } else if (submit.error) {
      toast.error(errorMessage(submit.error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submit.loading && onClose()}>
      <DialogContent>
        <DialogHeader icon={<ShieldQuestion />} title="Données personnelles" description="Votre demande est transmise à l’équipe Ciyou Eats, qui vous répond par e-mail." />
        <DialogBody className="space-y-4">
          <FormField label="Type de demande" required>
            <Select value={type} onValueChange={(v) => setType(v as GdprRequestType)} options={TYPES.map((t) => ({ value: t, label: GDPR_REQUEST_TYPE_LABELS[t] }))} />
          </FormField>
          <FormField label="Détails (facultatif)" hint="Précisez ce que vous souhaitez, s’il y a lieu.">
            <Textarea value={notes} maxLength={1000} rows={4} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submit.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={submit.loading} onClick={() => void send()}>
            Envoyer la demande
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
