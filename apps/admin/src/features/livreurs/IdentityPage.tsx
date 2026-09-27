// Vérification d'identité par selfie (cahier §6) : file de revue (selfie comparé à la
// photo de référence), contrôles demandés, historique ; demande manuelle de contrôle.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Camera, CheckCircle2, Clock3, ScanFace, UserX } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Combobox,
  ConfirmDialog,
  EmptyState,
  FormField,
  ProgressBar,
  SegmentedControl,
  Textarea,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  formatRelative,
} from '@golink/ui';
import { COLLECTIONS, type IdentityCheck, type WithId } from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { bulkSummary, fn } from '../_operations/functions';
import { useNames, useScopedDrivers } from '../_operations/hooks';
import { ListSkeleton, LoadError } from '../_operations/ui';
import { useFileUrl } from './dialogs';
import { DriversShell } from './shell';

type View = 'submitted' | 'requested' | 'history';
type Check = WithId<IdentityCheck>;

const TRIGGER_LABELS: Record<IdentityCheck['trigger'], string> = {
  random: 'Contrôle aléatoire',
  login: 'À la connexion',
  fraud_signal: 'Signal de fraude',
  manual: 'Demande manuelle',
};

export function IdentityPage() {
  const { can } = useAdminAccess();
  const geo = useGeoScope();
  const allowed = can('drivers.validate');
  const [view, setView] = useState<View>('submitted');
  const [requesting, setRequesting] = useState(false);
  const q = useMemo(() => {
    if (!allowed) return null;
    const base = collection(db, COLLECTIONS.identityChecks);
    if (view === 'history') return query(base, where('status', 'in', ['passed', 'failed', 'expired']), orderBy('requestedAt', 'desc'), limit(100));
    return query(base, where('status', '==', view), orderBy('requestedAt', 'asc'), limit(100));
  }, [view, allowed]);
  const checks = useCollection<IdentityCheck>(q);
  const drivers = useScopedDrivers();
  const byId = useMemo(() => new Map(drivers.data.map((d) => [d.id, d])), [drivers.data]);
  // Périmètre : seuls les contrôles des livreurs visibles (ville du périmètre).
  const list = useMemo(() => checks.data.filter((c) => byId.has(c.driverId) || (!geo.cityIds && !c.cityId)), [checks.data, byId, geo.cityIds]);

  if (!allowed) {
    return (
      <DriversShell documentTitle="Vérification d’identité" title="Vérification d’identité" description="Contrôles par selfie.">
        <EmptyState icon={<ScanFace />} title="Accès réservé" description="La vérification d’identité n’entre pas dans vos droits." />
      </DriversShell>
    );
  }

  return (
    <DriversShell
      documentTitle="Vérification d’identité"
      title="Vérification d’identité"
      description="Selfies de contrôle : la personne qui livre doit être le titulaire du compte. Un échec suspend le compte."
      actions={
        <Button variant="primary" leftIcon={<Camera />} onClick={() => setRequesting(true)}>
          Demander un contrôle
        </Button>
      }
    >
      <div className="mb-4">
        <SegmentedControl
          aria-label="État des contrôles"
          value={view}
          onValueChange={(v) => setView(v as View)}
          options={[
            { value: 'submitted', label: 'À examiner', icon: <ScanFace /> },
            { value: 'requested', label: 'En attente du livreur', icon: <Clock3 /> },
            { value: 'history', label: 'Historique' },
          ]}
        />
      </div>
      {checks.loading || drivers.loading ? (
        <ListSkeleton rows={3} />
      ) : checks.error ? (
        <LoadError error={checks.error} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title={view === 'submitted' ? 'Aucun selfie à examiner' : view === 'requested' ? 'Aucun contrôle en attente' : 'Aucun contrôle terminé'}
            description="Des contrôles aléatoires sont lancés chaque jour ; vous pouvez aussi en demander à tout moment."
          />
        </Card>
      ) : view === 'submitted' ? (
        <ul className="grid gap-4 xl:grid-cols-2">
          {list.map((c) => (
            <li key={c.id}>
              <SelfieReview check={c} driverName={byId.get(c.driverId) ? `${byId.get(c.driverId)!.firstName} ${byId.get(c.driverId)!.lastName}` : 'Livreur'} />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="divide-y divide-border">
          {list.map((c) => {
            const d = byId.get(c.driverId);
            const at = toDate(view === 'history' ? (c.reviewedAt ?? c.requestedAt) : c.requestedAt);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link to={`/livreurs/${c.driverId}`} className="font-medium text-fg hover:underline">
                    {d ? `${d.firstName} ${d.lastName}` : 'Livreur'}
                  </Link>
                  <p className="text-xs text-fg-subtle">
                    {TRIGGER_LABELS[c.trigger]}
                    {c.reviewNote ? ` · ${c.reviewNote}` : ''}
                  </p>
                </div>
                <StatusBadge status={c.status} />
                {at && <span className="font-mono text-2xs text-fg-subtle">{formatRelative(at)}</span>}
              </div>
            );
          })}
        </Card>
      )}
      <RequestCheckDialog open={requesting} onOpenChange={setRequesting} />
    </DriversShell>
  );
}

function StatusBadge({ status }: { status: IdentityCheck['status'] }) {
  const map = {
    requested: { tone: 'info', label: 'Demandé' },
    submitted: { tone: 'brand', label: 'À examiner' },
    passed: { tone: 'success', label: 'Conforme' },
    failed: { tone: 'danger', label: 'Non conforme' },
    expired: { tone: 'neutral', label: 'Non réalisé' },
  } as const;
  return <Badge size="sm" tone={map[status].tone}>{map[status].label}</Badge>;
}

function Photo({ path, label }: { path: string | null | undefined; label: string }) {
  const file = useFileUrl(path);
  return (
    <figure className="min-w-0 flex-1">
      <div className="aspect-[3/4] overflow-hidden rounded-xl border border-border bg-surface-2">
        {file.url ? (
          <img src={file.url} alt={label} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center p-3 text-center text-xs text-fg-subtle">{file.loading ? 'Chargement…' : 'Photo indisponible'}</div>
        )}
      </div>
      <figcaption className="mt-1.5 text-center text-2xs text-fg-subtle">{label}</figcaption>
    </figure>
  );
}

function SelfieReview({ check, driverName }: { check: Check; driverName: string }) {
  const names = useNames();
  const [failing, setFailing] = useState(false);
  const pass = useMutation(fn.reviewIdentityCheck, { success: 'Identité confirmée' });
  const fail = useMutation(fn.reviewIdentityCheck, { success: 'Contrôle non conforme : le compte est suspendu' });
  const score = check.matchScore ?? null;
  const submitted = toDate(check.submittedAt ?? check.requestedAt);
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/livreurs/${check.driverId}`} className="font-medium text-fg hover:underline">
            {driverName}
          </Link>
          <p className="text-xs text-fg-subtle">
            {TRIGGER_LABELS[check.trigger]} · {names.city(check.cityId)}
            {submitted ? ` · reçu ${formatRelative(submitted)}` : ''}
          </p>
        </div>
        <StatusBadge status={check.status} />
      </div>
      <div className="flex gap-3">
        <Photo path={check.selfie?.path} label="Selfie envoyé" />
        <Photo path={check.referencePhoto?.path} label="Photo de la pièce d’identité" />
      </div>
      {score !== null && (
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg-muted">Ressemblance estimée</span>
            <span className={`font-mono num ${score < 0.6 ? 'text-danger' : score < 0.8 ? 'text-warning' : 'text-success'}`}>{Math.round(score * 100)} %</span>
          </div>
          <ProgressBar value={score * 100} tone={score < 0.6 ? 'danger' : score < 0.8 ? 'amber' : 'success'} size="sm" />
          <p className="text-2xs text-fg-subtle">Indication automatique : la décision vous appartient.</p>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="danger-soft" leftIcon={<UserX />} onClick={() => setFailing(true)}>
          Non conforme
        </Button>
        <Button variant="primary" leftIcon={<CheckCircle2 />} loading={pass.loading} onClick={() => void pass.mutate({ checkId: check.id, decision: 'pass' })}>
          C’est bien le titulaire
        </Button>
      </div>
      <ConfirmDialog
        open={failing}
        onOpenChange={setFailing}
        title="Contrôle non conforme"
        description={`${driverName} sera suspendu le temps d’un échange avec l’équipe.`}
        destructive
        requireReason
        reasonLabel="Constat (conservé au dossier)"
        confirmLabel="Suspendre le compte"
        onConfirm={async (reason) => {
          await fail.mutate({ checkId: check.id, decision: 'fail', reason: reason ?? '' });
        }}
      />
    </Card>
  );
}

function RequestCheckDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const drivers = useScopedDrivers();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const action = useMutation(fn.requestIdentityChecks, { success: (r) => bulkSummary(r, 'Contrôle demandé') });
  const options = drivers.data
    .filter((d) => d.status === 'active')
    .map((d) => ({ value: d.id, label: `${d.firstName} ${d.lastName}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return (
    <Dialog open={open} onOpenChange={(o) => !action.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Camera />} title="Demander un contrôle d’identité" description="Le livreur devra envoyer un selfie avant sa prochaine course." />
        <DialogBody className="space-y-4">
          <FormField label="Livreurs">
            <Combobox multiple options={options} value={selected} onChange={setSelected} placeholder="Choisir des livreurs…" searchPlaceholder="Rechercher un livreur…" />
          </FormField>
          <FormField label="Motif (journal d’audit)">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Ex. signalement d’un restaurant : livreur différent de la photo" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={action.loading}
            disabled={selected.length === 0 || reason.trim().length < 3}
            onClick={async () => {
              if (await action.mutate({ driverIds: selected, reason: reason.trim() })) {
                setSelected([]);
                setReason('');
                onOpenChange(false);
              }
            }}
          >
            Demander
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
