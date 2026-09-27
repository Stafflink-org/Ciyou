import { useEffect, useState } from 'react';
import { doc, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { CalendarDays, Check, ChevronLeft, ChevronRight, UserCheck } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, IconButton, PageContainer, Skeleton, Switch, cn } from '@golink/ui';
import { paths, type HaccpPersonnelCheck, type StaffDirectoryEntry, type WithId } from '@golink/shared';
import { useAuth, useDocumentTitle } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection, useMutation } from '@/lib/firestore';
import { addDays, formatFullDay, mondayOf, todayIso } from '../_rh/dates';
import { useStaffDirectory } from '../_rh/hooks';
import { ErrorCard } from '../_rh/ui';
import { useWeekShifts } from '../planning/data';
import { HaccpHeader } from './layout';

type Checks = Pick<HaccpPersonnelCheck, 'cleanUniform' | 'handWashing' | 'noSymptoms' | 'hairProtected'>;
const ITEMS: Array<[keyof Checks, string]> = [
  ['cleanUniform', 'Tenue propre'],
  ['handWashing', 'Lavage des mains'],
  ['noSymptoms', 'Aucun symptôme'],
  ['hairProtected', 'Cheveux protégés'],
];

function Row({ employee, day, existing }: { employee: WithId<StaffDirectoryEntry>; day: string; existing?: WithId<HaccpPersonnelCheck> }) {
  const { restaurantId } = useRestaurantAccess();
  const { user } = useAuth();
  const id = employee.employeeId ?? employee.id;
  const [checks, setChecks] = useState<Checks>({ cleanUniform: true, handWashing: true, noSymptoms: true, hairProtected: true });
  useEffect(() => {
    setChecks(
      existing
        ? { cleanUniform: existing.cleanUniform, handWashing: existing.handWashing, noSymptoms: existing.noSymptoms, hairProtected: existing.hairProtected }
        : { cleanUniform: true, handWashing: true, noSymptoms: true, hairProtected: true },
    );
  }, [existing, day]);
  const save = useMutation(
    async () => {
      await setDoc(doc(collectionAt(paths.restaurantSub(restaurantId, 'haccpPersonnelChecks')), `${id}_${day}`), {
        employeeId: id,
        date: day,
        ...checks,
        validatedBy: user!.uid,
        validatedAt: serverTimestamp(),
      });
      return true;
    },
    { success: `Contrôle de ${employee.firstName} enregistré` },
  );
  const failing = ITEMS.filter(([key]) => !checks[key]).length;
  const status =
    failing > 0 ? (
      <Badge tone="danger">
        {failing} écart{failing > 1 ? 's' : ''}
      </Badge>
    ) : existing ? (
      <Badge tone="success" icon={<Check />}>
        Contrôlé
      </Badge>
    ) : (
      <Badge tone="neutral">À contrôler</Badge>
    );
  return (
    <li className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-3 lg:w-48 lg:shrink-0">
        <Avatar name={employee.displayName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{employee.displayName}</p>
          <p className="truncate text-xs text-fg-subtle">{employee.position ?? '—'}</p>
        </div>
        <div className="ml-auto shrink-0 lg:hidden">{status}</div>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 [&_label]:whitespace-nowrap">
        {ITEMS.map(([key, label]) => (
          <Switch key={key} size="sm" label={label} checked={checks[key]} onCheckedChange={(v) => setChecks((c) => ({ ...c, [key]: v }))} className={cn(!checks[key] && '[&_span]:text-danger')} />
        ))}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <div className="hidden w-24 justify-end lg:flex">{status}</div>
        <Button className="lg:w-32" size="sm" variant={existing ? 'secondary' : 'primary'} loading={save.loading} onClick={() => void save.mutate()}>
          {existing ? 'Mettre à jour' : 'Valider'}
        </Button>
      </div>
    </li>
  );
}

export function PersonnelPage() {
  useDocumentTitle('Hygiène du personnel · HACCP · GoLink Restaurant');
  const { restaurantId } = useRestaurantAccess();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const directory = useStaffDirectory();
  const shifts = useWeekShifts(mondayOf(day));
  const checks = useCollection<HaccpPersonnelCheck>(query(collectionAt(paths.restaurantSub(restaurantId, 'haccpPersonnelChecks')), where('date', '==', day)));
  const onShift = new Set(shifts.data.filter((s) => s.date === day).map((s) => s.employeeId));
  const people = directory.employees.filter((e) => e.active && (onShift.size === 0 || onShift.has(e.employeeId ?? e.id)));
  const done = people.filter((e) => checks.data.some((c) => c.employeeId === (e.employeeId ?? e.id))).length;

  return (
    <PageContainer wide>
      <HaccpHeader title="Hygiène du personnel" description="Contrôle quotidien de la tenue, du lavage des mains et de l’absence de symptômes de l’équipe en service." />
      {(checks.error || directory.error) && <ErrorCard error={checks.error ?? directory.error} />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <IconButton label="Jour précédent" variant="secondary" size="sm" onClick={() => setDay(addDays(day, -1))}>
            <ChevronLeft />
          </IconButton>
          <div className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg shadow-xs">
            <CalendarDays className="size-4 text-fg-subtle" />
            {formatFullDay(day)}
          </div>
          <IconButton label="Jour suivant" variant="secondary" size="sm" onClick={() => setDay(addDays(day, 1))} disabled={day >= today}>
            <ChevronRight />
          </IconButton>
        </div>
        <p className="text-sm text-fg-muted">
          <span className="font-semibold text-fg num">{done}</span> / {people.length} contrôlé{done > 1 ? 's' : ''} · {onShift.size > 0 ? 'équipe planifiée ce jour' : 'toute l’équipe active'}
        </p>
      </div>
      <Card>
        {directory.loading || checks.loading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : people.length === 0 ? (
          <EmptyState icon={<UserCheck />} title="Personne à contrôler" description="Aucun salarié actif n’est planifié ce jour-là." />
        ) : (
          <ul className="divide-y divide-border">
            {people.map((employee) => (
              <Row key={employee.id} employee={employee} day={day} existing={checks.data.find((c) => c.employeeId === (employee.employeeId ?? employee.id))} />
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
