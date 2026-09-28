// Fiche restaurant, onglet « Dossier & documents » : étapes de l'inscription,
// pièces obligatoires (validation, refus, expiration, relance), contrat signé.
import { useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { BellRing, CheckCircle2, ExternalLink, FileCheck2, FileSignature, FileText, FileWarning, ShieldCheck, XCircle } from 'lucide-react';
import {
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Skeleton,
  StatusBadge,
  Stepper,
  Textarea,
  Tooltip,
  cn,
  formatDateTime,
  toast,
} from '@golink/ui';
import {
  COLLECTIONS,
  PARTNER_DOCUMENT_LABELS,
  REQUIRED_RESTAURANT_DOCUMENTS,
  paths,
  type ApplicationDecision,
  type LegalAcceptance,
  type PartnerDocument,
  type PartnerDocumentType,
  type Restaurant,
  type RestaurantLegal,
  type WithId,
} from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { storage } from '@/lib/firebase';
import { collectionAt, docAt, errorMessage, toDate, useCollection, useDoc, useMutation } from '@/lib/firestore';
import { Facts, Panel } from '../../acteurs-commun/ui';
import { AutoValidationChecks } from '../components/AutoValidationPanel';
import { DecisionDialog } from '../components/RestaurantDialogs';
import { DOCUMENT_STATUS_META, daysUntil, formatDay, reviewDocument, sendDocumentReminder } from '../lib';

type Doc = WithId<PartnerDocument>;

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function ExpiryLabel({ day }: { day: string | null | undefined }) {
  const left = daysUntil(day);
  if (left === null) return <span className="text-xs text-fg-subtle">Sans expiration</span>;
  if (left < 0) return <span className="text-xs font-medium text-danger">Expiré le {formatDay(day)}</span>;
  if (left <= 30) return <span className="text-xs font-medium text-(--tone-fg) tone-amber">Expire dans {left} j ({formatDay(day)})</span>;
  return <span className="text-xs text-fg-subtle">Valide jusqu’au {formatDay(day)}</span>;
}

export async function openFile(path: string) {
  try {
    const url = await getDownloadURL(storageRef(storage, path));
    window.open(url, '_blank', 'noopener');
  } catch (error) {
    toast.error('Fichier indisponible', { description: errorMessage(error) });
  }
}

export function DocumentReviewDialog({ doc, decision, onClose }: { doc: Doc | null; decision: 'approve' | 'reject'; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState<Date | undefined>(() => (doc?.expiresAt ? new Date(`${doc.expiresAt}T12:00:00`) : undefined));
  const run = useMutation(reviewDocument, { success: (r) => (r.unblocked ? 'Document validé : commerce débloqué' : decision === 'approve' ? 'Document validé' : 'Document refusé') });
  if (!doc) return null;
  const label = PARTNER_DOCUMENT_LABELS[doc.type];
  return (
    <Dialog open onOpenChange={(o) => !o && !run.loading && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          icon={decision === 'approve' ? <CheckCircle2 className="text-success" /> : <XCircle className="text-danger" />}
          title={decision === 'approve' ? `Valider : ${label}` : `Refuser : ${label}`}
          description={decision === 'approve' ? 'Vérifiez la lisibilité, le nom du titulaire et la date de validité.' : 'Le restaurant reçoit le motif et dépose une nouvelle version.'}
        />
        <DialogBody className="space-y-4">
          <Button variant="secondary" size="sm" leftIcon={<ExternalLink />} onClick={() => void openFile(doc.file.path)}>
            Ouvrir le fichier ({doc.file.name ?? 'document'})
          </Button>
          {decision === 'approve' ? (
            <FormField label="Date d’expiration" hint="Laissez vide si la pièce n’expire pas (RIB…). Relances automatiques à J-30 et J-7.">
              <DatePicker value={expires} onChange={setExpires} disabledDays={{ before: new Date() }} placeholder="Sans expiration" />
            </FormField>
          ) : (
            <FormField label="Motif du refus" required hint="Envoyé au restaurant et conservé dans le journal d’audit.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Document illisible, extrait Kbis de plus de 3 mois…" />
            </FormField>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={run.loading}>
            Annuler
          </Button>
          <Button
            variant={decision === 'approve' ? 'primary' : 'danger'}
            loading={run.loading}
            disabled={decision === 'reject' && reason.trim().length < 3}
            onClick={() =>
              void run
                .mutate({ documentId: doc.id, decision, reason: decision === 'reject' ? reason.trim() : null, expiresAt: decision === 'approve' ? (expires ? isoDay(expires) : null) : undefined })
                .then((r) => r && onClose())
            }
          >
            {decision === 'approve' ? 'Valider la pièce' : 'Refuser la pièce'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DossierTab({ restaurant }: { restaurant: WithId<Restaurant> }) {
  const can = useCan();
  const canValidate = can('restaurants.validate');
  const [review, setReview] = useState<{ doc: Doc; decision: 'approve' | 'reject' } | null>(null);
  const [decision, setDecision] = useState<ApplicationDecision | null>(null);
  const remind = useMutation(sendDocumentReminder, { success: 'Relance envoyée au restaurant' });

  const docsQuery = useMemo(
    () =>
      query(
        collectionAt(COLLECTIONS.partnerDocuments),
        where('ownerType', '==', 'restaurant'),
        where('ownerId', '==', restaurant.id),
        orderBy('createdAt', 'desc'),
        limit(100),
      ),
    [restaurant.id],
  );
  const docs = useCollection<PartnerDocument>(docsQuery);
  const legal = useDoc<RestaurantLegal>(canValidate || can('restaurants.commercial') || can('finance.view') ? docAt(`${paths.restaurant(restaurant.id)}/private/legal`) : null);
  const acceptancesQuery = useMemo(
    () => query(collectionAt(COLLECTIONS.legalAcceptances), where('restaurantId', '==', restaurant.id), where('userType', '==', 'restaurant'), orderBy('acceptedAt', 'desc'), limit(10)),
    [restaurant.id],
  );
  const acceptances = useCollection<LegalAcceptance>(acceptancesQuery);

  const today = isoDay(new Date());
  const groups = REQUIRED_RESTAURANT_DOCUMENTS.map((group) => {
    const candidates = docs.data.filter((d) => group.types.includes(d.type));
    const valid = candidates.find((d) => d.status === 'approved' && (!d.expiresAt || d.expiresAt >= today));
    const pending = candidates.find((d) => d.status === 'pending');
    const state: 'valid' | 'pending' | 'missing' = valid ? 'valid' : pending ? 'pending' : 'missing';
    return { ...group, state, doc: valid ?? pending ?? candidates[0] ?? null };
  });
  const missingTypes: PartnerDocumentType[] = groups.filter((g) => g.state === 'missing').map((g) => g.types[0]!);
  const allValid = groups.every((g) => g.state === 'valid');
  const contractSigned = Boolean(legal.data?.partnerTermsAcceptedAt) || acceptances.data.length > 0;

  const steps = [
    { id: 'signup', label: 'Inscription' },
    { id: 'documents', label: 'Documents' },
    { id: 'review', label: 'Validation' },
    { id: 'live', label: 'En ligne' },
  ];
  const current =
    restaurant.onboardingStatus === 'approved' ? (restaurant.status === 'onboarding' ? 2 : 3) : restaurant.onboardingStatus === 'pending' ? 2 : restaurant.onboardingStatus === 'rejected' ? 2 : 1;
  const inQueue = restaurant.onboardingStatus === 'pending' || restaurant.onboardingStatus === 'documents_missing' || restaurant.onboardingStatus === 'rejected';

  return (
    <div className="space-y-6">
      <Panel
        title="Parcours d’inscription"
        icon={<FileCheck2 />}
        description={
          restaurant.onboardingStatus === 'rejected'
            ? `Dossier refusé${restaurant.rejectionReason ? ` : « ${restaurant.rejectionReason} »` : ''}`
            : restaurant.onboardingStatus === 'approved'
              ? 'Dossier validé.'
              : allValid
                ? 'Toutes les pièces obligatoires sont validées : le dossier peut être approuvé.'
                : 'Validez chaque pièce obligatoire avant d’approuver le dossier.'
        }
        actions={
          canValidate && inQueue ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" leftIcon={<XCircle />} onClick={() => setDecision('reject')}>
                Refuser
              </Button>
              <Button size="sm" variant="secondary" leftIcon={<FileWarning />} onClick={() => setDecision('documents_missing')}>
                Demander des pièces
              </Button>
              <Tooltip content={allValid ? (contractSigned ? 'Valider et mettre en ligne' : 'Contrat partenaire non signé') : 'Pièces obligatoires à valider d’abord'}>
                <span>
                  <Button size="sm" variant="primary" leftIcon={<CheckCircle2 />} disabled={!allValid || !contractSigned} onClick={() => setDecision('approve')}>
                    Valider le dossier
                  </Button>
                </span>
              </Tooltip>
            </div>
          ) : undefined
        }
      >
        <Stepper steps={steps} current={current} />
        {restaurant.missingDocuments?.length && restaurant.onboardingStatus === 'documents_missing' ? (
          <p className="mt-4 text-sm text-fg-muted">
            Pièces demandées : {restaurant.missingDocuments.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', ')}.
          </p>
        ) : null}
      </Panel>

      {(inQueue || restaurant.autoValidation) && <AutoValidationChecks restaurantId={restaurant.id} autoValidation={restaurant.autoValidation} canRun={canValidate} inQueue={inQueue && restaurant.onboardingStatus !== 'rejected'} />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="Pièces justificatives"
          icon={<FileText />}
          description="Kbis ou avis SIRET, pièce d’identité du gérant et RIB sont obligatoires. Une pièce expirée bloque les commandes."
          actions={
            canValidate && missingTypes.length > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<BellRing />}
                loading={remind.loading}
                onClick={() => void remind.mutate({ restaurantId: restaurant.id, documentTypes: missingTypes })}
              >
                Relancer
              </Button>
            ) : undefined
          }
          bodyClassName="space-y-5"
        >
          <ul className="grid gap-2 sm:grid-cols-3">
            {groups.map((g) => (
              <li
                key={g.key}
                className={cn(
                  'rounded-xl border px-3 py-2.5',
                  g.state === 'valid' ? 'tone-success border-(--tone-border) bg-(--tone-bg)' : g.state === 'pending' ? 'tone-info border-(--tone-border) bg-(--tone-bg)' : 'tone-amber border-(--tone-border) bg-(--tone-bg)',
                )}
              >
                <p className="text-xs font-medium text-(--tone-fg)">{g.state === 'valid' ? 'Validée' : g.state === 'pending' ? 'À vérifier' : 'Manquante'}</p>
                <p className="mt-0.5 text-sm text-fg">{g.label}</p>
              </li>
            ))}
          </ul>

          {docs.error ? (
            <p className="text-sm text-danger">{errorMessage(docs.error)}</p>
          ) : docs.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : docs.data.length === 0 ? (
            <EmptyState compact icon={<FileText />} title="Aucun document déposé" description="Le restaurant dépose ses pièces depuis la rubrique Documents de son espace." />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {docs.data.map((doc) => (
                <li key={doc.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-fg">{PARTNER_DOCUMENT_LABELS[doc.type]}</p>
                      <StatusBadge status={doc.status} map={DOCUMENT_STATUS_META} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-fg-subtle">
                      {doc.file.name ?? 'Fichier'} · déposé {toDate(doc.createdAt) ? formatDateTime(toDate(doc.createdAt)!) : ''}
                      {doc.remindersSent ? ` · ${doc.remindersSent} relance${doc.remindersSent > 1 ? 's' : ''}` : ''}
                    </p>
                    <div className="mt-0.5">
                      {doc.status === 'rejected' && doc.rejectionReason ? <span className="text-xs text-danger">Refusé : {doc.rejectionReason}</span> : <ExpiryLabel day={doc.expiresAt} />}
                    </div>
                  </div>
                  {canValidate && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button size="xs" variant="ghost" leftIcon={<ExternalLink />} onClick={() => void openFile(doc.file.path)}>
                        Ouvrir
                      </Button>
                      {doc.status !== 'rejected' && (
                        <Button size="xs" variant="ghost" onClick={() => setReview({ doc, decision: 'reject' })}>
                          Refuser
                        </Button>
                      )}
                      {doc.status !== 'approved' && (
                        <Button size="xs" variant="secondary" onClick={() => setReview({ doc, decision: 'approve' })}>
                          Valider
                        </Button>
                      )}
                      {doc.status === 'approved' && (
                        <Button size="xs" variant="ghost" onClick={() => setReview({ doc, decision: 'approve' })}>
                          Modifier l’expiration
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Contrat partenaire" icon={<FileSignature />}>
            {acceptances.loading ? (
              <Skeleton className="h-20 w-full" />
            ) : contractSigned ? (
              <Facts
                items={[
                  { label: 'Version', value: legal.data?.partnerTermsVersion || acceptances.data[0]?.version || '—' },
                  {
                    label: 'Signé le',
                    value: (() => {
                      const at = toDate(legal.data?.partnerTermsAcceptedAt ?? acceptances.data[0]?.acceptedAt);
                      return at ? formatDateTime(at) : '—';
                    })(),
                  },
                  { label: 'Signataire', value: legal.data?.partnerTermsSignatureName || acceptances.data[0]?.signatureName || '—' },
                  acceptances.data.length > 1 && { label: 'Acceptations', value: `${acceptances.data.length} versions` },
                ]}
              />
            ) : (
              <div className="flex items-start gap-3 text-sm text-fg-muted">
                <FileWarning className="mt-0.5 size-4 shrink-0 text-(--tone-fg) tone-amber" />
                Le contrat n’est pas encore signé. Le propriétaire l’accepte en ligne depuis la rubrique Documents de son espace.
              </div>
            )}
          </Panel>

          <Panel title="Identité légale" icon={<ShieldCheck />}>
            {legal.loading ? (
              <Skeleton className="h-28 w-full" />
            ) : legal.error || !legal.data ? (
              <p className="text-sm text-fg-muted">{legal.error ? 'Réservé aux validateurs, à la finance et à l’équipe commerciale.' : 'Informations légales non renseignées.'}</p>
            ) : (
              <Facts
                items={[
                  { label: 'Raison sociale', value: legal.data.legalName || '—', hint: legal.data.legalForm ?? undefined },
                  { label: 'SIRET / RCS', value: <span className="font-mono">{legal.data.siret || '—'}</span> },
                  { label: 'TVA intracommunautaire', value: legal.data.vatNumber || '—' },
                  { label: 'Gérant', value: legal.data.managerName || '—', hint: legal.data.managerEmail },
                  { label: 'IBAN', value: <span className="font-mono">{legal.data.ibanMasked || '—'}</span> },
                  { label: 'DAC7', value: legal.data.dac7Complete ? <Badge tone="success">Complet</Badge> : <Badge tone="amber">À compléter</Badge> },
                ]}
              />
            )}
          </Panel>
        </div>
      </div>

      {review && <DocumentReviewDialog key={`${review.doc.id}-${review.decision}`} doc={review.doc} decision={review.decision} onClose={() => setReview(null)} />}
      <DecisionDialog key={decision ?? 'none'} restaurant={restaurant} decision={decision} onOpenChange={(o) => !o && setDecision(null)} suggestedMissing={missingTypes} />
    </div>
  );
}
