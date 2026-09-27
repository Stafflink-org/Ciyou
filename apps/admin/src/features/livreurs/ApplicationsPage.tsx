// File de validation des inscriptions (cahier §6, décision client : validation
// manuelle, tout en ligne). Dossier complet dans un tiroir : pièces, identité, décision.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Bike, CalendarDays, ClipboardCheck, FileCheck2, MapPin, Phone } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  SegmentedControl,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  formatRelative,
} from '@golink/ui';
import {
  DRIVER_TYPE_LABELS,
  PARTNER_DOCUMENT_LABELS,
  VEHICLE_LABELS,
  type Driver,
  type OnboardingStatus,
  type WithId,
} from '@golink/shared';
import { useAdminAccess } from '@/auth/AdminAccess';
import { toDate } from '@/lib/firestore';
import { useNames } from '../_operations/hooks';
import { InfoRow, ListSkeleton, LoadError, OnboardingPill } from '../_operations/ui';
import { ApplicationDecision, DocumentsChecklist, LegalIdentity, useDriverDocuments } from './components';
import { requirementStates, todayIso, useApplicationsQueue, useContactMask } from './lib';
import { DriversShell } from './shell';

type Filter = 'pending' | 'documents_missing' | 'draft';

export function ApplicationsPage() {
  const { can } = useAdminAccess();
  const queue = useApplicationsQueue(can('drivers.validate'));
  const [filter, setFilter] = useState<Filter>('pending');
  const [openId, setOpenId] = useState<string | null>(null);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, documents_missing: 0, draft: 0 };
    for (const d of queue.data) if (d.onboardingStatus in c) c[d.onboardingStatus as Filter] += 1;
    return c;
  }, [queue.data]);
  const list = useMemo(
    () => queue.data.filter((d) => d.onboardingStatus === filter).sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)),
    [queue.data, filter],
  );
  const open = queue.data.find((d) => d.id === openId) ?? null;

  if (!can('drivers.validate')) {
    return (
      <DriversShell documentTitle="Inscriptions des livreurs" title="Inscriptions" description="Validation des nouveaux livreurs.">
        <EmptyState icon={<ClipboardCheck />} title="Accès réservé" description="La validation des livreurs n’entre pas dans vos droits." />
      </DriversShell>
    );
  }

  return (
    <DriversShell
      documentTitle="Inscriptions des livreurs"
      title="Inscriptions"
      description="Chaque livreur est validé à la main, sans rendez-vous : vérifiez les pièces puis décidez."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="État des dossiers"
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          options={[
            { value: 'pending', label: 'À examiner', count: counts.pending },
            { value: 'documents_missing', label: 'Pièces demandées', count: counts.documents_missing },
            { value: 'draft', label: 'Inscription en cours', count: counts.draft },
          ]}
        />
        <p className="text-xs text-fg-subtle">Du plus ancien au plus récent</p>
      </div>
      {queue.loading ? (
        <ListSkeleton rows={3} />
      ) : queue.error ? (
        <LoadError error={queue.error} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileCheck2 />}
            title={filter === 'pending' ? 'Aucun dossier à examiner' : 'Aucun dossier dans cet état'}
            description={filter === 'pending' ? 'Les nouvelles inscriptions complètes apparaîtront ici.' : 'Rien à suivre pour le moment.'}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {list.map((d) => (
            <li key={d.id}>
              <ApplicationCard driver={d} onOpen={() => setOpenId(d.id)} />
            </li>
          ))}
        </ul>
      )}
      <Sheet open={Boolean(open)} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="sm:max-w-xl">{open && <Dossier driver={open} onDone={() => setOpenId(null)} />}</SheetContent>
      </Sheet>
    </DriversShell>
  );
}

function ApplicationCard({ driver, onOpen }: { driver: WithId<Driver>; onOpen: () => void }) {
  const names = useNames();
  const docs = useDriverDocuments(driver.id);
  const states = requirementStates(driver, docs.data, todayIso()).filter((s) => s.required);
  const valid = states.filter((s) => s.state === 'valid' || s.state === 'expiring').length;
  const toCheck = states.filter((s) => s.state === 'pending').length;
  const created = toDate(driver.createdAt);
  return (
    <Card interactive className="h-full p-4" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div className="flex items-start gap-3">
        <Avatar name={`${driver.firstName} ${driver.lastName}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-fg">
              {driver.firstName} {driver.lastName}
            </p>
            <OnboardingPill status={driver.onboardingStatus as OnboardingStatus} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{names.city(driver.cityId)}</span>
            <span className="inline-flex items-center gap-1"><Bike className="size-3" />{VEHICLE_LABELS[driver.vehicle.type]}</span>
            <span>{DRIVER_TYPE_LABELS[driver.type]}</span>
          </p>
        </div>
        {created && <span className="shrink-0 font-mono text-2xs text-fg-subtle">{formatRelative(created)}</span>}
      </div>
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-muted">Pièces obligatoires validées</span>
          <span className="font-mono text-fg num">
            {valid}/{states.length}
          </span>
        </div>
        <ProgressBar value={valid} max={Math.max(1, states.length)} tone={valid === states.length ? 'success' : 'brand'} size="sm" />
        <p className="text-2xs text-fg-subtle">
          {toCheck > 0 ? `${toCheck} document${toCheck > 1 ? 's' : ''} à vérifier` : driver.missingDocuments?.length ? `En attente : ${driver.missingDocuments.map((t) => PARTNER_DOCUMENT_LABELS[t]).join(', ')}` : valid === states.length ? 'Dossier complet : prêt à valider' : 'Pièces non encore déposées'}
        </p>
      </div>
    </Card>
  );
}

function Dossier({ driver, onDone }: { driver: WithId<Driver>; onDone: () => void }) {
  const names = useNames();
  const contact = useContactMask();
  const docs = useDriverDocuments(driver.id);
  const created = toDate(driver.createdAt);
  return (
    <>
      <SheetHeader title={`${driver.firstName} ${driver.lastName}`} description={`Inscription ${created ? formatRelative(created) : ''} · ${names.city(driver.cityId)}`} icon={<ClipboardCheck />} />
      <SheetBody className="space-y-6">
        <section>
          <h3 className="eyebrow mb-2">Candidat</h3>
          <dl className="divide-y divide-border">
            <InfoRow label="Téléphone"><span className="inline-flex items-center gap-1.5 font-mono"><Phone className="size-3 text-fg-subtle" />{contact.phone(driver.phone)}</span></InfoRow>
            <InfoRow label="E-mail">{contact.email(driver.email)}</InfoRow>
            <InfoRow label="Type">{DRIVER_TYPE_LABELS[driver.type]}</InfoRow>
            <InfoRow label="Véhicule">
              {VEHICLE_LABELS[driver.vehicle.type]}
              {driver.vehicle.plate ? <span className="ml-1.5 font-mono text-xs text-fg-subtle">{driver.vehicle.plate}</span> : null}
            </InfoRow>
            <InfoRow label="Inscrit le">{created ? <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3 text-fg-subtle" />{created.toLocaleDateString('fr-FR')}</span> : '—'}</InfoRow>
            {driver.rejectionReason && <InfoRow label="Dernier message">{driver.rejectionReason}</InfoRow>}
          </dl>
        </section>
        <section>
          <h3 className="eyebrow mb-2">Identité légale</h3>
          <LegalIdentity driverId={driver.id} />
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="eyebrow">Pièces justificatives</h3>
            <Badge size="sm" tone="neutral">{docs.data.length} déposée{docs.data.length > 1 ? 's' : ''}</Badge>
          </div>
          <DocumentsChecklist driver={driver} documents={docs.data} loading={docs.loading} error={docs.error} />
        </section>
      </SheetBody>
      <SheetFooter className="gap-2">
        <Button variant="ghost" asChild className="sm:mr-auto">
          <Link to={`/livreurs/${driver.id}`}>
            Fiche complète <ArrowUpRight className="size-4" />
          </Link>
        </Button>
        <ApplicationDecision driver={driver} documents={docs.data} onDone={onDone} />
      </SheetFooter>
    </>
  );
}
