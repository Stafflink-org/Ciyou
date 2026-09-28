import { useEffect, useState } from 'react';
import { ShieldCheck, Upload } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FileUpload,
  FormField,
  Input,
  ProgressBar,
  toast,
} from '@golink/ui';
import { PARTNER_DOCUMENT_LABELS } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage } from '@/lib/firestore';
import { uploadDocument } from '../parametres/kit/api';
import { DOCUMENT_MAX_BYTES, uploadPrivateDocument } from '../parametres/kit/storage';
import type { DocumentRequirement } from './hooks';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dépôt d'un justificatif : fichier privé, puis enregistrement pour vérification par Ciyou Eats. */
export function UploadDialog({ requirement, onClose }: { requirement: DocumentRequirement | null; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const [files, setFiles] = useState<File[]>([]);
  const [number, setNumber] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (requirement) {
      setFiles([]);
      setNumber('');
      setIssuedAt('');
      setExpiresAt('');
      setProgress(null);
    }
  }, [requirement]);

  if (!requirement) return null;
  const label = PARTNER_DOCUMENT_LABELS[requirement.type];
  const today = todayIso();
  const errors = {
    file: files.length === 0 ? 'Ajoutez le fichier.' : null,
    number: requirement.number && !number.trim() ? 'Indiquez le numéro.' : null,
    expiresAt: requirement.expires && !expiresAt ? 'Indiquez la date d’expiration.' : expiresAt && expiresAt <= today ? 'Ce document est déjà expiré.' : null,
    issuedAt: issuedAt && issuedAt > today ? 'Date dans le futur.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const busy = progress !== null;

  const submit = async () => {
    const file = files[0];
    if (!file || invalid) return;
    try {
      setProgress(0);
      const storagePath = await uploadPrivateDocument(restaurantId, requirement.type, file, setProgress);
      await uploadDocument({
        restaurantId,
        type: requirement.type,
        storagePath,
        fileName: file.name,
        number: number.trim() || null,
        issuedAt: issuedAt || null,
        expiresAt: expiresAt || null,
      });
      toast.success(`${label} envoyé : l’équipe Ciyou Eats le vérifie et vous tient informé.`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, 'Le dépôt a échoué. Réessayez.'));
      setProgress(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<Upload />} title={`Déposer : ${label}`} description={requirement.hint} />
        <DialogBody className="space-y-5">
          <FileUpload
            value={files}
            onChange={setFiles}
            accept={ACCEPT}
            maxSize={DOCUMENT_MAX_BYTES}
            hint="PDF, JPG, PNG ou HEIC"
            disabled={busy}
            onReject={(message) => toast.error(message)}
          />
          {(requirement.number || requirement.expires) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {requirement.number && (
                <FormField label="Numéro" required error={number ? errors.number : undefined}>
                  <Input value={number} className="font-mono" onChange={(e) => setNumber(e.target.value)} />
                </FormField>
              )}
              <FormField label="Délivré le" error={errors.issuedAt}>
                <Input type="date" value={issuedAt} max={today} onChange={(e) => setIssuedAt(e.target.value)} />
              </FormField>
              {requirement.expires && (
                <FormField label="Expire le" required error={expiresAt ? errors.expiresAt : undefined} hint="Nous vous préviendrons 30 jours avant.">
                  <Input type="date" value={expiresAt} min={today} onChange={(e) => setExpiresAt(e.target.value)} />
                </FormField>
              )}
            </div>
          )}
          {progress !== null && <ProgressBar value={progress * 100} label="Envoi sécurisé" valueLabel={`${Math.round(progress * 100)} %`} />}
          <p className="flex items-start gap-2 text-xs text-fg-subtle">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Fichier stocké de façon privée : seuls les responsables de l’établissement et l’équipe de vérification Ciyou Eats y ont accès.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant="primary" leftIcon={<Upload />} loading={busy} disabled={invalid} onClick={() => void submit()}>
            Envoyer pour vérification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
