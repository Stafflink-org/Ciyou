// Fenêtres d'action de la rubrique Livreurs : sanction, message, demande de pièces,
// vérification d'un document (aperçu du fichier, date d'expiration, décision).
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ExternalLink, FileText, Gavel, MessageSquare, ShieldAlert, ShieldCheck } from 'lucide-react';
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
  Skeleton,
  Textarea,
  cn,
} from '@golink/ui';
import {
  DOCUMENT_STATUS_LABELS,
  PARTNER_DOCUMENT_LABELS,
  type PartnerDocument,
  type PartnerDocumentType,
  type SanctionType,
  type WithId,
} from '@golink/shared';
import { useMutation } from '@/lib/firestore';
import { bulkSummary, fn } from '../_operations/functions';
import type { RequirementState } from './lib';

// ------------------------------------------------------------------ Sanction

const SANCTION_REASONS = [
  'Retards répétés à la récupération',
  'Commandes non livrées',
  'Comportement inapproprié signalé',
  'Annulations abusives',
  'Non-respect des règles de sécurité',
  'Fraude ou tentative de fraude',
];

export function SanctionDialog({
  open,
  onOpenChange,
  driverIds,
  label,
  defaultType = 'warning',
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverIds: string[];
  label: string;
  defaultType?: SanctionType;
  onDone?: () => void;
}) {
  const [type, setType] = useState<SanctionType>(defaultType);
  const [preset, setPreset] = useState(SANCTION_REASONS[0]!);
  const [custom, setCustom] = useState('');
  const [details, setDetails] = useState('');
  const [days, setDays] = useState('7');
  useEffect(() => {
    if (open) {
      setType(defaultType);
      setCustom('');
      setDetails('');
    }
  }, [open, defaultType]);
  const reason = preset === 'other' ? custom.trim() : preset;
  const action = useMutation(fn.sanctionDriver, { success: (r) => bulkSummary(r, 'Sanction appliquée') });

  async function submit() {
    const result = await action.mutate({ driverIds, type, reason, details: details.trim() || null, durationDays: type === 'temporary_suspension' ? Number(days) : null });
    if (result) {
      onOpenChange(false);
      onDone?.();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !action.loading && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader icon={<Gavel />} title="Sanctionner" description={label} />
        <DialogBody className="space-y-5">
          <RadioGroup
            variant="cards"
            className="sm:grid-cols-1"
            value={type}
            onValueChange={(v) => setType(v as SanctionType)}
            options={[
              { value: 'warning', label: 'Avertissement', description: 'Le compte reste actif ; l’avertissement figure au dossier 30 jours.' },
              { value: 'temporary_suspension', label: 'Suspension temporaire', description: 'Plus aucune course proposée jusqu’à la date de fin. Levée automatique.' },
              { value: 'deactivation', label: 'Désactivation', description: 'Le compte est fermé jusqu’à réactivation manuelle.' },
            ]}
          />
          {type === 'temporary_suspension' && (
            <FormField label="Durée">
              <Select
                value={days}
                onValueChange={setDays}
                options={[1, 3, 7, 14, 30, 60].map((d) => ({ value: String(d), label: `${d} jour${d > 1 ? 's' : ''}` }))}
              />
            </FormField>
          )}
          <FormField label="Motif" hint="Transmis au livreur, qui peut contester la décision.">
            <Select value={preset} onValueChange={setPreset} options={[...SANCTION_REASONS.map((r) => ({ value: r, label: r })), { value: 'other', label: 'Autre motif…' }]} />
          </FormField>
          {preset === 'other' && (
            <FormField label="Motif précis">
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={200} placeholder="Ex. livraison à une mauvaise adresse, trois fois" />
            </FormField>
          )}
          <FormField label="Détails internes (facultatif)" hint="Contexte pour l’équipe : commandes concernées, échanges.">
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={2000} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button variant={type === 'warning' ? 'primary' : 'danger'} loading={action.loading} disabled={reason.length < 3 || driverIds.length === 0} onClick={() => void submit()}>
            {type === 'warning' ? 'Adresser l’avertissement' : type === 'temporary_suspension' ? 'Suspendre' : 'Désactiver'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Message

export function MessageDialog({ open, onOpenChange, driverIds, label, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; driverIds: string[]; label: string; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const action = useMutation(fn.bulkUpdateDrivers, { success: (r) => bulkSummary(r, 'Message envoyé') });
  useEffect(() => {
    if (open) {
      setTitle('');
      setBody('');
    }
  }, [open]);
  async function submit() {
    const result = await action.mutate({ driverIds, action: 'message', reason: `Message : ${title.trim()}`, message: { title: title.trim(), body: body.trim() } });
    if (result) {
      onOpenChange(false);
      onDone?.();
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !action.loading && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader icon={<MessageSquare />} title="Envoyer un message" description={`${label} · notification dans l’application livreur.`} />
        <DialogBody className="space-y-4">
          <FormField label="Titre" aside={<span className="font-mono text-2xs text-fg-subtle">{title.length}/80</span>}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Ex. Forte demande ce soir à Metz" />
          </FormField>
          <FormField label="Message" aside={<span className="font-mono text-2xs text-fg-subtle">{body.length}/600</span>}>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={600} placeholder="Bonus de pointe de 1 € par course entre 19 h et 22 h…" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={action.loading} disabled={title.trim().length < 2 || body.trim().length < 2} onClick={() => void submit()}>
            Envoyer à {driverIds.length} livreur{driverIds.length > 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Demande de pièces

export function RequestDocumentsDialog({
  open,
  onOpenChange,
  driverId,
  driverName,
  requirements,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  driverName: string;
  requirements: RequirementState[];
  onDone?: () => void;
}) {
  const defaults = useMemo(() => requirements.filter((r) => r.required && r.state !== 'valid' && r.state !== 'expiring' && r.state !== 'pending').map((r) => r.type), [requirements]);
  const [selected, setSelected] = useState<PartnerDocumentType[]>(defaults);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (open) {
      setSelected(defaults);
      setMessage('Merci de compléter votre dossier pour que nous puissions valider votre compte.');
    }
  }, [open, defaults]);
  const action = useMutation(fn.reviewDriverApplication, { success: 'Demande envoyée au livreur' });
  async function submit() {
    const result = await action.mutate({ driverId, decision: 'request_documents', reason: message.trim(), missingDocuments: selected });
    if (result) {
      onOpenChange(false);
      onDone?.();
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !action.loading && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader icon={<FileText />} title="Demander des documents" description={driverName} />
        <DialogBody className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-fg">Pièces à fournir</legend>
            {requirements.map((r) => (
              <label key={r.type} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-surface-2">
                <Checkbox
                  checked={selected.includes(r.type)}
                  onCheckedChange={(v) => setSelected((cur) => (v === true ? [...cur, r.type] : cur.filter((t) => t !== r.type)))}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{PARTNER_DOCUMENT_LABELS[r.type]}</span>
                  {!r.required && <span className="ml-1.5 text-xs text-fg-subtle">si concerné</span>}
                  <span className="block text-xs text-fg-subtle">{r.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <FormField label="Message au livreur">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button variant="primary" loading={action.loading} disabled={selected.length === 0 || message.trim().length < 3} onClick={() => void submit()}>
            Envoyer la demande
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Vérification d'un document

/** Fichier privé d'un livreur, lu par Cloud Function (droits vérifiés côté serveur), en URL locale. */
export function useFileUrl(path: string | null | undefined): { url: string | null; contentType: string | null; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ url: string | null; contentType: string | null; loading: boolean; error: boolean }>({ url: null, contentType: null, loading: Boolean(path), error: false });
  useEffect(() => {
    if (!path) {
      setState({ url: null, contentType: null, loading: false, error: false });
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setState({ url: null, contentType: null, loading: true, error: false });
    fn.getDriverFile({ path })
      .then((file) => {
        if (!alive) return;
        const bytes = Uint8Array.from(atob(file.dataBase64), (c) => c.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
        setState({ url: objectUrl, contentType: file.contentType, loading: false, error: false });
      })
      .catch(() => alive && setState({ url: null, contentType: null, loading: false, error: true }));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return state;
}

export function FilePreview({ path, contentType, name, className }: { path: string | null | undefined; contentType?: string | null; name?: string | null; className?: string }) {
  const file = useFileUrl(path);
  const isImage = Boolean((file.contentType ?? contentType)?.startsWith('image/'));
  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-surface-2', className)}>
      {file.loading ? (
        <Skeleton className="size-full min-h-56 rounded-none" />
      ) : file.error || !file.url ? (
        <div className="grid min-h-56 place-items-center p-6 text-center text-sm text-fg-subtle">Aperçu indisponible pour ce fichier.</div>
      ) : isImage ? (
        <img src={file.url} alt={name ?? 'Document'} className="mx-auto max-h-[420px] w-full object-contain" />
      ) : (
        <iframe src={file.url} title={name ?? 'Document'} className="h-[420px] w-full bg-white" />
      )}
      {file.url && (
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-elevated/90 px-2 py-1 text-xs font-medium text-fg shadow-md backdrop-blur hover:bg-elevated"
        >
          <ExternalLink className="size-3.5" /> Ouvrir
        </a>
      )}
    </div>
  );
}

export function DocumentReviewDialog({
  document,
  driverName,
  expires,
  open,
  onOpenChange,
}: {
  document: WithId<PartnerDocument> | null;
  driverName: string;
  expires: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [expiresAt, setExpiresAt] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setExpiresAt(document?.expiresAt ?? '');
      setRejecting(false);
      setReason('');
    }
  }, [open, document?.id, document?.expiresAt]);
  const action = useMutation(fn.reviewDriverDocument, {
    success: (r) => (r.status === 'approved' ? (r.driverUnblocked ? 'Document validé : le livreur est réactivé' : 'Document validé') : 'Document refusé, le livreur est prévenu'),
  });
  if (!document) return null;
  const today = new Date().toISOString().slice(0, 10);
  async function decide(decision: 'approve' | 'reject') {
    const result = await action.mutate({ documentId: document!.id, decision, reason: decision === 'reject' ? reason.trim() : null, expiresAt: decision === 'approve' ? expiresAt || null : null });
    if (result) onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !action.loading && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader icon={<ShieldCheck />} title={PARTNER_DOCUMENT_LABELS[document.type]} description={`${driverName} · ${DOCUMENT_STATUS_LABELS[document.status]}`} />
        <DialogBody className="space-y-4">
          <FilePreview path={document.file?.path} contentType={document.file?.contentType} name={document.file?.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Date d’expiration" hint={expires ? 'Obligatoire pour ce document : l’expiration est surveillée.' : 'Facultatif pour ce document.'}>
              <Input type="date" value={expiresAt} min={today} onChange={(e) => setExpiresAt(e.target.value)} leading={<CalendarClock className="size-4" />} />
            </FormField>
            {document.number && (
              <FormField label="Numéro">
                <Input value={document.number} readOnly />
              </FormField>
            )}
          </div>
          {rejecting && (
            <FormField label="Motif du refus" hint="Transmis au livreur avec la demande de nouveau dépôt.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Ex. photo floue, date de validité illisible" autoFocus />
            </FormField>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Fermer
          </Button>
          {rejecting ? (
            <Button variant="danger" leftIcon={<ShieldAlert />} loading={action.loading} disabled={reason.trim().length < 3} onClick={() => void decide('reject')}>
              Confirmer le refus
            </Button>
          ) : (
            <>
              <Button variant="danger-soft" onClick={() => setRejecting(true)} disabled={action.loading}>
                Refuser
              </Button>
              <Button variant="primary" leftIcon={<ShieldCheck />} loading={action.loading} disabled={expires && !expiresAt} onClick={() => void decide('approve')}>
                Valider le document
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
