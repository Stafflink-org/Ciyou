import { useEffect, useState } from 'react';
import { addDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Bug, CalendarCheck, Check, Plus, Siren } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
  formatDateTime,
} from '@golink/ui';
import { paths, type HaccpPestReport } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, toDate, useMutation } from '@/lib/firestore';
import { formatShortDay, todayIso } from '../_rh/dates';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard } from '../_rh/ui';
import { usePestReports, usePestVisits } from './data';
import { HaccpHeader } from './layout';

const KIND_LABELS: Record<HaccpPestReport['kind'], string> = { evidence: 'Traces, déjections', sighting: 'Nuisible aperçu', other: 'Autre' };

function VisitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [provider, setProvider] = useState('');
  const [visitDate, setVisitDate] = useState(todayIso());
  const [areas, setAreas] = useState('');
  const [observations, setObservations] = useState('');
  const [next, setNext] = useState('');
  useEffect(() => {
    if (open) {
      setProvider('');
      setVisitDate(todayIso());
      setAreas('');
      setObservations('');
      setNext('');
    }
  }, [open]);
  const save = useMutation(
    async () => {
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpPestVisits')), {
        provider: provider.trim(),
        visitDate,
        areasInspected: areas.trim() || null,
        observations: observations.trim() || null,
        report: null,
        nextVisitDate: next || null,
        createdBy: user!.uid,
        createdAt: serverTimestamp(),
      });
      return true;
    },
    { success: 'Passage enregistré' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<CalendarCheck />} title="Passage du prestataire" description="Visite de contrôle ou de traitement des nuisibles." />
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Prestataire" required>
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={80} />
            </FormField>
            <FormField label="Date du passage" required>
              <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Zones inspectées">
            <Input value={areas} onChange={(e) => setAreas(e.target.value)} maxLength={160} placeholder="Cuisine, réserve, local poubelles" />
          </FormField>
          <FormField label="Observations">
            <Textarea rows={3} value={observations} onChange={(e) => setObservations(e.target.value)} maxLength={1000} />
          </FormField>
          <FormField label="Prochain passage">
            <Input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={provider.trim().length < 2 || !visitDate} onClick={async () => { if (await save.mutate()) onClose(); }}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const [area, setArea] = useState('');
  const [kind, setKind] = useState<HaccpPestReport['kind']>('evidence');
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (open) {
      setArea('');
      setKind('evidence');
      setDescription('');
    }
  }, [open]);
  const save = useMutation(
    async () => {
      await addDoc(collectionAt(paths.restaurantSub(restaurantId, 'haccpPestReports')), {
        area: area.trim(),
        kind,
        description: description.trim(),
        status: 'open',
        reportedBy: user!.uid,
        reportedAt: serverTimestamp(),
        resolvedBy: null,
        resolvedAt: null,
      });
      return true;
    },
    { success: 'Signalement transmis au responsable' },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<Siren />} title="Signaler des nuisibles" description="Traces, déjections ou nuisible aperçu : signalez sans attendre." />
        <DialogBody className="space-y-4">
          <FormField label="Zone" required>
            <Input value={area} onChange={(e) => setArea(e.target.value)} maxLength={60} placeholder="Réserve sèche" />
          </FormField>
          <FormField label="Constat">
            <Select value={kind} onValueChange={(v) => setKind(v as HaccpPestReport['kind'])} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} />
          </FormField>
          <FormField label="Description" required>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.loading} disabled={area.trim().length < 2 || description.trim().length < 3} onClick={async () => { if (await save.mutate()) onClose(); }}>
            Signaler
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PestsPage() {
  useDocumentTitle('Nuisibles · HACCP · GoLink Restaurant');
  const can = useCan();
  const manage = can('haccp.manage');
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const directory = useStaffDirectory();
  const visits = usePestVisits();
  const reports = usePestReports();
  const [visitOpen, setVisitOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const today = todayIso();
  const treat = useMutation(
    async (id: string) => {
      await updateDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'haccpPestReports')), id), { status: 'treated', resolvedBy: user!.uid, resolvedAt: serverTimestamp() });
    },
    { success: 'Signalement traité' },
  );
  const next = visits.data.map((v) => v.nextVisitDate).filter((d): d is string => Boolean(d && d >= today)).sort()[0];

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Lutte contre les nuisibles"
        description="Passages du prestataire et signalements internes, conservés pour le registre sanitaire."
        actions={
          <>
            <Button leftIcon={<Siren />} onClick={() => setReportOpen(true)}>
              Signaler
            </Button>
            {manage && (
              <Button variant="primary" leftIcon={<Plus />} onClick={() => setVisitOpen(true)}>
                Passage prestataire
              </Button>
            )}
          </>
        }
      />
      {(visits.error || reports.error) && <ErrorCard error={visits.error ?? reports.error} />}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<CalendarCheck />} title="Passages du prestataire" description={next ? `Prochain passage prévu le ${formatShortDay(next)}` : 'Aucun passage planifié'} divided />
          {visits.loading ? (
            <Skeleton className="m-5 h-32" />
          ) : visits.data.length === 0 ? (
            <EmptyState compact icon={<CalendarCheck />} title="Aucun passage enregistré" description="Consignez chaque visite de votre prestataire agréé." />
          ) : (
            <ul className="divide-y divide-border">
              {visits.data.map((visit) => (
                <li key={visit.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-fg">{visit.provider}</p>
                    <span className="font-mono text-xs text-fg-muted num">{formatShortDay(visit.visitDate)}</span>
                  </div>
                  {visit.areasInspected && <p className="mt-0.5 text-xs text-fg-subtle">Zones : {visit.areasInspected}</p>}
                  {visit.observations && <p className="mt-1 text-sm text-fg-muted">{visit.observations}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Bug />} title="Signalements internes" description="Tout membre de l’équipe peut signaler un constat." divided />
          {reports.loading ? (
            <Skeleton className="m-5 h-32" />
          ) : reports.data.length === 0 ? (
            <EmptyState compact icon={<Bug />} title="Aucun signalement" description="Aucun nuisible signalé par l’équipe." />
          ) : (
            <ul className="divide-y divide-border">
              {reports.data.map((report) => {
                const at = toDate(report.reportedAt);
                return (
                  <li key={report.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-fg">{report.area}</p>
                        <Badge tone="neutral" size="sm">
                          {KIND_LABELS[report.kind]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-fg-muted">{report.description}</p>
                      <p className="mt-0.5 text-2xs text-fg-subtle">
                        {directory.nameOfUid(report.reportedBy)} · {at ? formatDateTime(at) : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill tone={report.status === 'open' ? 'danger' : 'success'} pulse={report.status === 'open'}>
                        {report.status === 'open' ? 'À traiter' : 'Traité'}
                      </StatusPill>
                      {manage && report.status === 'open' && (
                        <Button size="xs" leftIcon={<Check />} loading={treat.loading} onClick={() => void treat.mutate(report.id)}>
                          Traité
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      {manage && <VisitDialog open={visitOpen} onClose={() => setVisitOpen(false)} />}
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </PageContainer>
  );
}
