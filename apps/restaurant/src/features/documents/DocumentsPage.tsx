import { useMemo, useState, type ReactNode } from 'react';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  FileText,
  History,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  PageContainer,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatusPill,
  cn,
  formatDate,
  toneClass,
  formatRelative,
  toast,
  type Tone,
} from '@golink/ui';
import { DOCUMENT_STATUS_LABELS, ONBOARDING_STATUS_LABELS, PARTNER_DOCUMENT_LABELS, type PartnerDocument, type WithId } from '@golink/shared';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { errorMessage, toDate } from '@/lib/firestore';
import { privateFileUrl } from '../parametres/kit/storage';
import { LoadError, Notice } from '../parametres/kit/ui';
import { ContractSection } from './ContractSection';
import {
  daysUntil,
  requirementState,
  requirementsFor,
  usePartnerDocuments,
  type DocumentRequirement,
  type RequirementState,
} from './hooks';
import { UploadDialog } from './UploadDialog';

const STATE_META: Record<RequirementState, { label: string; tone: Tone; icon: ReactNode }> = {
  missing: { label: 'À déposer', tone: 'neutral', icon: <Upload /> },
  pending: { label: 'En vérification', tone: 'info', icon: <Clock3 /> },
  approved: { label: 'Validé', tone: 'success', icon: <CircleCheck /> },
  rejected: { label: 'Refusé', tone: 'danger', icon: <CircleAlert /> },
  expired: { label: 'Expiré', tone: 'danger', icon: <CircleAlert /> },
  expiring: { label: 'Expire bientôt', tone: 'amber', icon: <CalendarClock /> },
};

const DOC_TONES: Record<PartnerDocument['status'], Tone> = { pending: 'info', approved: 'success', rejected: 'danger', expired: 'danger' };

function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** « il y a 3 jours » récent, « le 31 mai 2026 » au-delà d'un mois. */
function uploadedLabel(date: Date): string {
  const relative = formatRelative(date);
  return /^(il y a|à l’instant|hier|aujourd)/.test(relative) ? relative : `le ${relative}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

async function openFile(doc: PartnerDocument) {
  try {
    const url = await privateFileUrl(doc.file.path);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    toast.error(errorMessage(error, 'Fichier indisponible.'));
  }
}

/** Justificatifs (KYC) et contrat partenaire de l'établissement. */
export function DocumentsPage() {
  const { restaurant } = useRestaurantAccess();
  const docs = usePartnerDocuments();
  const [upload, setUpload] = useState<DocumentRequirement | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const requirements = requirementsFor();
  const rows = useMemo(
    () =>
      requirements.map((req) => {
        const history = docs.data.filter((d) => d.type === req.type);
        return { req, latest: history[0], history, state: requirementState(history[0]) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs.data],
  );
  const required = rows.filter((r) => r.req.required);
  const validated = required.filter((r) => r.state === 'approved' || r.state === 'expiring').length;
  const blocking = required.filter((r) => ['missing', 'rejected', 'expired'].includes(r.state));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Configuration"
        title="Documents et contrat"
        description="Les justificatifs exigés par la réglementation et notre prestataire de paiement, et votre contrat partenaire Ciyou Eats."
        actions={
          <StatusPill tone={restaurant.onboardingStatus === 'approved' ? 'success' : restaurant.onboardingStatus === 'rejected' ? 'danger' : 'info'}>
            Dossier : {ONBOARDING_STATUS_LABELS[restaurant.onboardingStatus].toLowerCase()}
          </StatusPill>
        }
      />

      <div className="space-y-6">
        <ContractSection />

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted">
                <FileText className="size-[18px]" />
              </div>
              <div>
                <h2 className="font-display text-md font-semibold tracking-tight text-fg">Justificatifs</h2>
                <p className="mt-0.5 text-sm text-fg-muted">Vérifiés par l’équipe Ciyou Eats. Une pièce expirée suspend les versements.</p>
              </div>
            </div>
            {!docs.loading && (
              <div className="w-full sm:w-56">
                <ProgressBar
                  value={validated}
                  max={required.length}
                  tone={validated === required.length ? 'success' : 'brand'}
                  label="Pièces obligatoires validées"
                  valueLabel={`${validated} / ${required.length}`}
                />
              </div>
            )}
          </div>

          {docs.error ? (
            <div className="p-5">
              <LoadError message={errorMessage(docs.error)} />
            </div>
          ) : docs.loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <>
              {blocking.length > 0 && (
                <div className="px-5 pt-5">
                  <Notice tone={blocking.some((b) => b.state !== 'missing') ? 'danger' : 'amber'} title={`${blocking.length} pièce${blocking.length > 1 ? 's' : ''} à fournir`}>
                    {blocking.map((b) => PARTNER_DOCUMENT_LABELS[b.req.type]).join(', ')}.
                  </Notice>
                </div>
              )}
              <ul className="divide-y divide-border">
                {rows.map(({ req, latest, state }) => {
                  const meta = STATE_META[state];
                  const uploadedAt = toDate(latest?.file.uploadedAt);
                  const days = latest?.expiresAt ? daysUntil(latest.expiresAt) : null;
                  return (
                    <li key={req.type} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:gap-5">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className={cn(toneClass[meta.tone], 'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4')}>
                          {meta.icon}
                        </span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                            {PARTNER_DOCUMENT_LABELS[req.type]}
                            {req.required ? <Badge size="sm">Obligatoire</Badge> : <Badge size="sm" variant="outline">Facultatif</Badge>}
                          </p>
                          {latest ? (
                            <p className="mt-0.5 truncate text-xs text-fg-subtle">
                              {latest.file.name ?? 'Fichier'} · {formatBytes(latest.file.size)}
                              {uploadedAt ? ` · déposé ${uploadedLabel(uploadedAt)}` : ''}
                              {latest.number ? ` · n° ${latest.number}` : ''}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-xs text-fg-subtle">{req.hint}</p>
                          )}
                          {state === 'rejected' && latest?.rejectionReason && (
                            <p className="mt-1 text-xs text-danger-soft-fg">Motif du refus : {latest.rejectionReason}</p>
                          )}
                          {latest?.expiresAt && days !== null && (
                            <p className={cn('mt-1 text-xs', days < 0 ? 'text-danger-soft-fg' : days <= 30 ? 'text-fg' : 'text-fg-subtle')}>
                              {days < 0 ? `Expiré depuis le ${formatDate(localDate(latest.expiresAt))}` : `Valable jusqu’au ${formatDate(localDate(latest.expiresAt))}${days <= 30 ? ` (${days} jour${days > 1 ? 's' : ''})` : ''}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 md:justify-end">
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                        {latest && (
                          <Button variant="ghost" size="sm" leftIcon={<Download />} onClick={() => void openFile(latest)}>
                            Voir
                          </Button>
                        )}
                        <Button
                          variant={req.required && (state === 'missing' || state === 'rejected' || state === 'expired') ? 'primary' : 'secondary'}
                          size="sm"
                          leftIcon={latest ? <RefreshCw /> : <Upload />}
                          onClick={() => setUpload(req)}
                        >
                          {latest ? 'Remplacer' : 'Déposer'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {docs.data.length > 0 && (
                <div className="border-t border-border">
                  <button
                    type="button"
                    aria-expanded={showHistory}
                    onClick={() => setShowHistory((v) => !v)}
                    className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                  >
                    <History className="size-4" />
                    Historique des dépôts ({docs.data.length})
                  </button>
                  {showHistory && <HistoryTable docs={docs.data} />}
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <UploadDialog requirement={upload} onClose={() => setUpload(null)} />
    </PageContainer>
  );
}

function HistoryTable({ docs }: { docs: Array<WithId<PartnerDocument>> }) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-surface-2">
          <tr className="text-left">
            {['Document', 'Fichier', 'Déposé le', 'Statut', ''].map((h) => (
              <th key={h} className="px-5 py-2 font-mono text-3xs font-medium uppercase tracking-eyebrow text-fg-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {docs.map((doc) => {
            const at = toDate(doc.file.uploadedAt);
            return (
              <tr key={doc.id}>
                <td className="px-5 py-2.5 font-medium text-fg">{PARTNER_DOCUMENT_LABELS[doc.type]}</td>
                <td className="max-w-56 truncate px-5 py-2.5 text-fg-muted">{doc.file.name ?? '—'}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-fg-muted num">{at ? formatDate(at) : '—'}</td>
                <td className="px-5 py-2.5">
                  <StatusPill tone={DOC_TONES[doc.status]}>{DOCUMENT_STATUS_LABELS[doc.status]}</StatusPill>
                </td>
                <td className="px-5 py-2.5 text-right">
                  <Button variant="ghost" size="xs" leftIcon={<Download />} onClick={() => void openFile(doc)}>
                    Ouvrir
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

