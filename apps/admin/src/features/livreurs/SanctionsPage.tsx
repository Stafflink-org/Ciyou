// Sanctions des livreurs (cahier §6) : avertissements, suspensions temporaires,
// désactivations, avec motif ; contestations à trancher (maintien ou annulation).
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Gavel, MessageSquareWarning, Plus, Scale } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  RadioGroup,
  SegmentedControl,
  Textarea,
  formatDate,
  formatRelative,
  type Tone,
} from '@golink/ui';
import { COLLECTIONS, SANCTION_TYPE_LABELS, type DriverSanction, type SanctionStatus, type WithId } from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { db } from '@/lib/firebase';
import { toDate, useCollection, useMutation } from '@/lib/firestore';
import { fn } from '../_operations/functions';
import { useScopedDrivers } from '../_operations/hooks';
import { ListSkeleton, LoadError } from '../_operations/ui';
import { SanctionDialog } from './dialogs';
import { DriversShell } from './shell';

type View = 'contested' | 'active' | 'all';
type Sanction = WithId<DriverSanction & { createdByName?: string; cityId?: string }>;

export const SANCTION_STATUS_META: Record<SanctionStatus, { label: string; tone: Tone }> = {
  active: { label: 'En cours', tone: 'amber' },
  contested: { label: 'Contestée', tone: 'brand' },
  upheld: { label: 'Maintenue', tone: 'danger' },
  overturned: { label: 'Annulée', tone: 'success' },
  expired: { label: 'Terminée', tone: 'neutral' },
};

const TYPE_TONES: Record<DriverSanction['type'], Tone> = { warning: 'amber', temporary_suspension: 'danger', deactivation: 'danger' };

export function useDriverSanctions() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.driverSanctions), orderBy('createdAt', 'desc'), limit(300)), []);
  return useCollection<DriverSanction & { createdByName?: string; cityId?: string }>(q);
}

export function SanctionsPage() {
  const { can } = useAdminAccess();
  const sanctions = useDriverSanctions();
  const drivers = useScopedDrivers();
  const byId = useMemo(() => new Map(drivers.data.map((d) => [d.id, d])), [drivers.data]);
  const [view, setView] = useState<View>('contested');
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Sanction | null>(null);
  const scoped = useMemo(() => sanctions.data.filter((s) => byId.has(s.driverId)), [sanctions.data, byId]);
  const counts = {
    contested: scoped.filter((s) => s.status === 'contested').length,
    active: scoped.filter((s) => s.status === 'active' || s.status === 'upheld').length,
  };
  const list = scoped.filter((s) => (view === 'all' ? true : view === 'contested' ? s.status === 'contested' : s.status === 'active' || s.status === 'upheld'));
  const driverName = (id: string) => (byId.get(id) ? `${byId.get(id)!.firstName} ${byId.get(id)!.lastName}` : 'Livreur');

  return (
    <DriversShell
      documentTitle="Sanctions des livreurs"
      title="Sanctions"
      description="Chaque sanction est motivée et peut être contestée par le livreur depuis son application."
      actions={
        can('drivers.sanction') ? (
          <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>
            Nouvelle sanction
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4">
        <SegmentedControl
          aria-label="Filtrer les sanctions"
          value={view}
          onValueChange={(v) => setView(v as View)}
          options={[
            { value: 'contested', label: 'Contestations à trancher', count: counts.contested },
            { value: 'active', label: 'En cours', count: counts.active },
            { value: 'all', label: 'Toutes' },
          ]}
        />
      </div>
      {sanctions.loading || drivers.loading ? (
        <ListSkeleton rows={3} />
      ) : sanctions.error ? (
        <LoadError error={sanctions.error} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Scale />}
            title={view === 'contested' ? 'Aucune contestation en attente' : 'Aucune sanction'}
            description={view === 'contested' ? 'Les contestations envoyées par les livreurs apparaîtront ici.' : 'Aucune sanction dans ce périmètre.'}
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((s) => {
            const created = toDate(s.createdAt);
            const ends = toDate(s.endsAt ?? null);
            return (
              <li key={s.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={`tone-${TYPE_TONES[s.type]} grid size-9 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg)`}>
                      <Gavel className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/livreurs/${s.driverId}`} className="font-medium text-fg hover:underline">
                          {driverName(s.driverId)}
                        </Link>
                        <Badge size="sm" tone={TYPE_TONES[s.type]}>{SANCTION_TYPE_LABELS[s.type]}</Badge>
                        <Badge size="sm" tone={SANCTION_STATUS_META[s.status].tone} variant="outline">
                          {SANCTION_STATUS_META[s.status].label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-fg">{s.reason}</p>
                      {s.details && <p className="mt-0.5 text-xs text-fg-muted">{s.details}</p>}
                      <p className="mt-1.5 text-2xs text-fg-subtle">
                        {created ? `Le ${formatDate(created)}` : ''}
                        {s.createdByName ? ` par ${s.createdByName}` : ''}
                        {ends ? ` · ${s.type === 'warning' ? 'au dossier' : 'jusqu’au'} ${formatDate(ends)}` : s.type === 'deactivation' ? ' · sans terme' : ''}
                      </p>
                      {s.contest && (
                        <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                            <MessageSquareWarning className="size-3.5 text-primary" /> Contestation du livreur
                            {toDate(s.contest.submittedAt) ? <span className="font-normal text-fg-subtle">· {formatRelative(toDate(s.contest.submittedAt)!)}</span> : null}
                          </p>
                          <p className="mt-1 text-sm text-fg-muted">« {s.contest.message} »</p>
                          {s.contest.decisionNote && <p className="mt-2 text-xs text-fg-subtle">Décision : {s.contest.decisionNote}</p>}
                        </div>
                      )}
                    </div>
                    {s.status === 'contested' && can('drivers.sanction') && (
                      <Button size="sm" variant="primary" onClick={() => setDeciding(s)}>
                        Trancher
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <NewSanctionPicker open={creating} onOpenChange={setCreating} onPick={(id) => (setCreating(false), setTarget(id))} />
      <SanctionDialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)} driverIds={target ? [target] : []} label={target ? driverName(target) : ''} />
      <ContestDialog sanction={deciding} driverName={deciding ? driverName(deciding.driverId) : ''} onOpenChange={(o) => !o && setDeciding(null)} />
    </DriversShell>
  );
}

function NewSanctionPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (id: string) => void }) {
  const drivers = useScopedDrivers();
  const [value, setValue] = useState<string | undefined>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader icon={<Gavel />} title="Nouvelle sanction" description="Choisissez le livreur concerné." />
        <DialogBody>
          <FormField label="Livreur">
            <Combobox
              options={drivers.data.filter((d) => d.status !== 'deactivated').map((d) => ({ value: d.id, label: `${d.firstName} ${d.lastName}` }))}
              value={value}
              onChange={setValue}
              placeholder="Choisir un livreur…"
              searchPlaceholder="Rechercher…"
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!value} onClick={() => value && onPick(value)}>
            Continuer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContestDialog({ sanction, driverName, onOpenChange }: { sanction: Sanction | null; driverName: string; onOpenChange: (open: boolean) => void }) {
  const [decision, setDecision] = useState<'upheld' | 'overturned'>('upheld');
  const [note, setNote] = useState('');
  const action = useMutation(fn.decideSanctionContest, { success: (r) => (r.status === 'overturned' ? 'Sanction annulée, le livreur est prévenu' : 'Sanction maintenue, le livreur est prévenu') });
  return (
    <Dialog open={Boolean(sanction)} onOpenChange={(o) => !action.loading && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader icon={<Scale />} title="Trancher la contestation" description={sanction ? `${driverName} · ${SANCTION_TYPE_LABELS[sanction.type]}` : ''} />
        <DialogBody className="space-y-4">
          {sanction?.contest && <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-fg-muted">« {sanction.contest.message} »</p>}
          <RadioGroup
            variant="cards"
            value={decision}
            onValueChange={(v) => setDecision(v as 'upheld' | 'overturned')}
            options={[
              { value: 'upheld', label: 'Maintenir', description: 'La sanction reste en vigueur.' },
              { value: 'overturned', label: 'Annuler', description: 'Le compte est rétabli immédiatement.' },
            ]}
          />
          <FormField label="Réponse au livreur" hint="Transmise au livreur et conservée dans le journal d’audit.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={action.loading}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={action.loading}
            disabled={note.trim().length < 3}
            onClick={async () => {
              if (!sanction) return;
              if (await action.mutate({ sanctionId: sanction.id, decision, note: note.trim() })) {
                setNote('');
                onOpenChange(false);
              }
            }}
          >
            Enregistrer la décision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
