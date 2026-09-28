// Blocs partagés par les pages Livreurs : liste des pièces exigées avec leur état et
// leur vérification, identité légale, décision sur une inscription.
import { useMemo, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { CheckCircle2, CircleDashed, Clock3, FileText, FileWarning, ShieldCheck, ThumbsDown, XCircle } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Skeleton, Tooltip, cn, formatDate, type Tone } from '@golink/ui';
import {
  COLLECTIONS,
  PARTNER_DOCUMENT_LABELS,
  type Driver,
  type DriverPrivate,
  type PartnerDocument,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { docAt, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { InfoRow, LoadError } from '../_operations/ui';
import { DocumentReviewDialog, RequestDocumentsDialog } from './dialogs';
import { requirementStates, todayIso, type RequirementState } from './lib';

const STATE_META: Record<RequirementState['state'], { label: string; tone: Tone; icon: React.ReactNode }> = {
  valid: { label: 'Validé', tone: 'success', icon: <CheckCircle2 /> },
  expiring: { label: 'Expire bientôt', tone: 'amber', icon: <Clock3 /> },
  pending: { label: 'À vérifier', tone: 'info', icon: <ShieldCheck /> },
  rejected: { label: 'Refusé', tone: 'danger', icon: <XCircle /> },
  expired: { label: 'Expiré', tone: 'danger', icon: <FileWarning /> },
  missing: { label: 'Manquant', tone: 'neutral', icon: <CircleDashed /> },
};

export function useDriverDocuments(driverId: string | null) {
  const q = useMemo(
    () => (driverId ? query(collection(db, COLLECTIONS.partnerDocuments), where('ownerType', '==', 'driver'), where('ownerId', '==', driverId), orderBy('createdAt', 'desc')) : null),
    [driverId],
  );
  return useCollection<PartnerDocument>(q);
}

/** Pièces exigées du livreur, état de chacune et vérification. */
export function DocumentsChecklist({ driver, documents, loading, error }: { driver: WithId<Driver>; documents: WithId<PartnerDocument>[]; loading: boolean; error: unknown }) {
  const { can } = useAdminAccess();
  const [review, setReview] = useState<{ doc: WithId<PartnerDocument>; expires: boolean } | null>(null);
  const today = todayIso();
  const states = useMemo(() => requirementStates(driver, documents, today), [driver, documents, today]);
  const extra = documents.filter((d) => !states.some((s) => s.document?.id === d.id));
  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (error) return <LoadError error={error} compact />;
  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {states.map((s) => {
          const meta = STATE_META[s.state];
          const reviewable = s.document && can('drivers.validate') && (s.document.status === 'pending' || s.state === 'expiring' || s.document.status === 'approved');
          return (
            <li key={s.type} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={cn(`tone-${meta.tone}`, 'grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4')}>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">
                  {PARTNER_DOCUMENT_LABELS[s.type]}
                  {!s.required && <span className="ml-1.5 text-xs font-normal text-fg-subtle">si concerné</span>}
                </p>
                <p className="truncate text-xs text-fg-subtle">
                  {s.document
                    ? [
                        s.document.createdAt ? `Déposé le ${formatDate(toDate(s.document.createdAt)!)}` : null,
                        s.document.expiresAt ? `expire le ${s.document.expiresAt.split('-').reverse().join('/')}` : null,
                        s.document.rejectionReason ? `motif : ${s.document.rejectionReason}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : s.hint}
                </p>
              </div>
              <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
              {reviewable && (
                <Button size="xs" variant={s.document!.status === 'pending' ? 'primary' : 'secondary'} onClick={() => setReview({ doc: s.document!, expires: s.expires })}>
                  {s.document!.status === 'pending' ? 'Vérifier' : 'Voir'}
                </Button>
              )}
            </li>
          );
        })}
        {extra.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <FileText className="size-4 text-fg-subtle" />
            <span className="flex-1 text-fg-muted">
              {PARTNER_DOCUMENT_LABELS[d.type]} <span className="text-xs text-fg-subtle">· version antérieure</span>
            </span>
            <Button size="xs" variant="ghost" onClick={() => setReview({ doc: d, expires: false })}>
              Voir
            </Button>
          </li>
        ))}
      </ul>
      <DocumentReviewDialog
        open={Boolean(review)}
        onOpenChange={(o) => !o && setReview(null)}
        document={review?.doc ?? null}
        expires={review?.expires ?? false}
        driverName={`${driver.firstName} ${driver.lastName}`}
      />
    </>
  );
}

/** Identité légale (driverPrivate) : naissance, nationalité, statut d'indépendant. */
export function LegalIdentity({ driverId }: { driverId: string }) {
  const { can } = useAdminAccess();
  const allowed = can('personal_data.view');
  const priv = useDoc<DriverPrivate>(allowed ? docAt(`${COLLECTIONS.driverPrivate}/${driverId}`) : null);
  if (!allowed) return <p className="text-sm text-fg-subtle">Identité légale, adresse et coordonnées bancaires masquées pour votre rôle (permission « Données personnelles non masquées » requise).</p>;
  if (priv.loading) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (priv.error) return <LoadError error={priv.error} compact />;
  const p = priv.data;
  if (!p) return <p className="text-sm text-fg-subtle">Informations légales non renseignées.</p>;
  return (
    <dl className="divide-y divide-border">
      <InfoRow label="Date de naissance">{p.birthDate ? p.birthDate.split('-').reverse().join('/') : '—'}</InfoRow>
      <InfoRow label="Nationalité">{p.nationality || '—'}</InfoRow>
      <InfoRow label="SIRET">{p.siret ? <span className="font-mono">{p.siret}</span> : '—'}</InfoRow>
      <InfoRow label="URSSAF valide jusqu’au">{p.urssafValidUntil ? p.urssafValidUntil.split('-').reverse().join('/') : '—'}</InfoRow>
      <InfoRow label="IBAN">{p.ibanMasked ? <span className="font-mono">{p.ibanMasked}</span> : '—'}</InfoRow>
      <InfoRow label="Compte de paiement">{p.stripeAccountStatus === 'enabled' ? <Badge tone="success" size="sm">Actif</Badge> : p.stripeAccountStatus ? <Badge tone="amber" size="sm">À compléter</Badge> : '—'}</InfoRow>
      <InfoRow label="Données DAC7">{p.dac7Complete ? 'Complètes' : 'Incomplètes'}</InfoRow>
    </dl>
  );
}

/** Décision sur une inscription : valider, demander des pièces, refuser. */
export function ApplicationDecision({ driver, documents, onDone }: { driver: WithId<Driver>; documents: WithId<PartnerDocument>[]; onDone?: () => void }) {
  const [requesting, setRequesting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const today = todayIso();
  const states = useMemo(() => requirementStates(driver, documents, today), [driver, documents, today]);
  const blocking = states.filter((s) => s.required && s.state !== 'valid' && s.state !== 'expiring');
  const approve = useMutation(fn.reviewDriverApplication, { success: 'Inscription validée : le livreur peut se connecter' });
  const reject = useMutation(fn.reviewDriverApplication, { success: 'Inscription refusée, le livreur est prévenu' });
  const name = `${driver.firstName} ${driver.lastName}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      <Button variant="danger-soft" leftIcon={<ThumbsDown />} onClick={() => setRejecting(true)}>
        Refuser
      </Button>
      <Button variant="secondary" leftIcon={<FileText />} onClick={() => setRequesting(true)}>
        Demander des pièces
      </Button>
      <Tooltip content={blocking.length ? `À valider d’abord : ${blocking.map((b) => PARTNER_DOCUMENT_LABELS[b.type]).join(', ')}` : 'Toutes les pièces obligatoires sont validées.'}>
        <span>
          <Button
            variant="primary"
            leftIcon={<ShieldCheck />}
            loading={approve.loading}
            disabled={blocking.length > 0}
            onClick={async () => {
              if (await approve.mutate({ driverId: driver.id, decision: 'approve' })) onDone?.();
            }}
          >
            Valider l’inscription
          </Button>
        </span>
      </Tooltip>
      <RequestDocumentsDialog open={requesting} onOpenChange={setRequesting} driverId={driver.id} driverName={name} requirements={states} onDone={onDone} />
      <ConfirmDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Refuser l’inscription"
        description={`${name} sera prévenu du refus et de son motif. Le compte est désactivé.`}
        destructive
        requireReason
        reasonLabel="Motif du refus (transmis au livreur)"
        confirmLabel="Refuser l’inscription"
        onConfirm={async (reason) => {
          if (await reject.mutate({ driverId: driver.id, decision: 'reject', reason: reason ?? '' })) onDone?.();
        }}
      />
    </div>
  );
}
