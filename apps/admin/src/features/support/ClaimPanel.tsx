// Réclamation d'un client jointe au ticket : photos, contrôles automatiques (doublon, date,
// cohérence) et décision de l'agent (acceptation avec remboursement imputé, ou refus motivé).
import { useEffect, useState } from 'react';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { CheckCircle2, ImageOff, TriangleAlert, XCircle } from 'lucide-react';
import { Badge, Button, ConfirmDialog, FormField, formatEUR, toast } from '@golink/ui';
import {
  CLAIM_CHECK_LABELS,
  CLAIM_STATUS_LABELS,
  CLAIM_TYPE_LABELS,
  COLLECTIONS,
  type ClaimPhoto,
  type OrderClaim,
} from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { storage } from '@/lib/firebase';
import { callFunction, docAt, errorMessage, useDoc } from '@/lib/firestore';
import { EuroInput } from '../_operations/inputs';
import { Panel } from '../_experience/ui';

const decideOrderClaim = callFunction<{ claimId: string; decision: 'accept' | 'reject'; amountCents?: number | null; reason: string }, { status: 'accepted' | 'rejected'; refundedCents: number }>('decideOrderClaim');

function Photo({ photo }: { photo: ClaimPhoto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getDownloadURL(storageRef(storage, photo.path))
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [photo.path]);
  if (failed) return <div className="grid aspect-square place-items-center rounded-lg border border-border bg-surface-2 text-fg-subtle"><ImageOff className="size-5" /></div>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border bg-surface-2">
      <img src={url} alt="Photo de la réclamation" className="size-full object-cover" loading="lazy" />
    </a>
  ) : (
    <div className="aspect-square animate-pulse rounded-lg bg-surface-3" />
  );
}

export function ClaimPanel({ claimId }: { claimId: string }) {
  const can = useCan();
  const claim = useDoc<OrderClaim>(docAt(`${COLLECTIONS.orderClaims}/${claimId}`));
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const data = claim.data;
  useEffect(() => setAmount(data?.claimedCents ?? null), [data?.claimedCents]);

  if (claim.loading || claim.error || !data) return null;
  const pending = data.status === 'pending_review';
  const tone = data.verdict === 'clean' ? 'success' : data.verdict === 'suspect' ? 'amber' : 'danger';

  return (
    <Panel
      title="Réclamation avec photo"
      description={`${CLAIM_TYPE_LABELS[data.type]} · ${formatEUR(data.claimedCents)} réclamés`}
      actions={<Badge tone={tone}>{data.verdict === 'clean' ? 'Aucun signal' : data.verdict === 'suspect' ? 'À vérifier' : 'Refusée automatiquement'}</Badge>}
      bodyClassName="space-y-4"
    >
      {data.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {data.photos.map((photo) => (
            <Photo key={photo.path} photo={photo} />
          ))}
        </div>
      )}
      <ul className="space-y-1.5">
        {data.checks.map((check) => (
          <li key={check.code} className="flex items-start gap-2 text-xs">
            {check.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-success" /> : check.severity === 'blocking' ? <XCircle className="mt-px size-3.5 shrink-0 text-danger" /> : <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber" />}
            <span className="text-fg-muted">
              <span className="font-medium text-fg">{CLAIM_CHECK_LABELS[check.code]} : </span>
              {check.detail}
            </span>
          </li>
        ))}
      </ul>
      {pending && can('refunds.create') ? (
        <div className="space-y-3 border-t border-border pt-3">
          <FormField label="Montant à rembourser" hint="Imputé selon la règle « qui paie » (par défaut : le commerce).">
            <EuroInput value={amount} onChange={setAmount} />
          </FormField>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={!amount} onClick={() => setDecision('accept')}>
              Accepter
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDecision('reject')}>
              Refuser
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-fg-muted">
          {CLAIM_STATUS_LABELS[data.status]}
          {data.status === 'accepted' ? ` · ${formatEUR(data.grantedCents)} remboursés` : ''}
          {data.decisionNote ? ` · ${data.decisionNote}` : ''}
        </p>
      )}
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === 'accept' ? `Rembourser ${formatEUR(amount ?? 0)} ?` : 'Refuser la réclamation ?'}
        description={decision === 'accept' ? 'Le client est remboursé sur son moyen de paiement d’origine et prévenu.' : 'Le client reçoit le motif du refus.'}
        confirmLabel={decision === 'accept' ? 'Accepter et rembourser' : 'Refuser'}
        destructive={decision === 'reject'}
        requireReason
        onConfirm={async (reason) => {
          if (!decision) return;
          try {
            const result = await decideOrderClaim({ claimId, decision, amountCents: decision === 'accept' ? amount : null, reason: reason ?? '' });
            toast.success(result.status === 'accepted' ? `${formatEUR(result.refundedCents)} remboursés` : 'Réclamation refusée');
          } catch (error) {
            toast.error(errorMessage(error));
            throw error;
          }
        }}
      />
    </Panel>
  );
}
