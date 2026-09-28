import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { BadgeEuro, Clock3, Download, FileWarning, Link2, Plus, Users } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageContainer,
  PageHeader,
  StatCard,
  StatusBadge,
  createColumnHelper,
  formatEUR,
  formatNumber,
} from '@golink/ui';
import { CONTRACT_TYPE_LABELS, EMPLOYEE_STATUS_LABELS, paths, type Employee, type EmployeeDocument, type WithId } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';
import { addDays, formatDays, formatShortDay, todayIso } from '../_rh/dates';
import { csvEuros, downloadCsv } from '../_rh/export';
import { useEmployees } from '../_rh/hooks';
import { EMPLOYEE_STATUS, ErrorCard, PersonCell } from '../_rh/ui';
import { EmployeeFormSheet } from './EmployeeFormSheet';

const column = createColumnHelper<WithId<Employee>>();

/** Salaire mensuel brut de base estimé : taux × heures × 52 / 12. */
export function monthlyBaseCents(employee: Pick<Employee, 'hourlyRateCents' | 'weeklyHours'>): number {
  return Math.round((employee.hourlyRateCents * employee.weeklyHours * 52) / 12);
}

export function EmployeesPage() {
  useDocumentTitle('Employés · Ciyou Eats Restaurant');
  const navigate = useNavigate();
  const can = useCan();
  const { restaurant, restaurantId } = useRestaurantAccess();
  const employees = useEmployees();
  const [formOpen, setFormOpen] = useState(false);
  const canManage = can('team.manage');

  const expiring = useCollection<EmployeeDocument>(
    canManage
      ? query(
          collectionAt(paths.restaurantSub(restaurantId, 'employeeDocuments')),
          where('expiresAt', '<=', addDays(todayIso(), 30)),
          orderBy('expiresAt'),
          limit(50),
        )
      : null,
  );

  const active = useMemo(() => employees.data.filter((e) => e.status === 'active' || e.status === 'on_leave'), [employees.data]);
  const weeklyHours = active.reduce((total, e) => total + e.weeklyHours, 0);
  const payroll = active.reduce((total, e) => total + monthlyBaseCents(e), 0);
  const linked = active.filter((e) => e.uid).length;

  const columns = useMemo(
    () => [
      column.accessor((e) => `${e.firstName} ${e.lastName}`, {
        id: 'name',
        header: 'Salarié',
        cell: (info) => <PersonCell name={info.getValue()} subtitle={info.row.original.email ?? 'Aucune adresse e-mail'} />,
      }),
      column.accessor('position', {
        header: 'Poste',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-fg">{info.getValue()}</p>
            <p className="truncate text-xs text-fg-subtle">{info.row.original.department ?? '—'}</p>
          </div>
        ),
      }),
      column.accessor('contractType', {
        header: 'Contrat',
        cell: (info) => (
          <div className="flex flex-col items-start gap-0.5">
            <Badge tone={info.getValue() === 'cdi' ? 'teal' : 'plum'} size="sm">
              {CONTRACT_TYPE_LABELS[info.getValue()]}
            </Badge>
            {info.row.original.endDate && <span className="text-2xs text-fg-subtle">jusqu’au {formatShortDay(info.row.original.endDate)}</span>}
          </div>
        ),
      }),
      column.accessor('weeklyHours', {
        header: 'Heures / sem.',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm num">{formatNumber(info.getValue(), { decimals: true })} h</span>,
      }),
      column.accessor('hourlyRateCents', {
        header: 'Taux horaire',
        meta: { align: 'right' },
        cell: (info) => <span className="font-mono text-sm num">{formatEUR(info.getValue(), { cents: true })}</span>,
      }),
      column.accessor('paidLeaveBalanceDays', {
        header: 'Congés',
        meta: { align: 'right' },
        cell: (info) => (
          <span className={info.getValue() < 0 ? 'font-mono text-sm text-danger num' : 'font-mono text-sm num'}>{formatDays(info.getValue())}</span>
        ),
      }),
      column.accessor('status', {
        header: 'Statut',
        cell: (info) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={info.getValue()} map={EMPLOYEE_STATUS} />
            {info.row.original.uid && (
              <span title="Compte Ciyou Eats relié" className="text-fg-subtle">
                <Link2 className="size-3.5" aria-label="Compte Ciyou Eats relié" />
              </span>
            )}
          </div>
        ),
      }),
    ],
    [],
  );

  function exportRows(rows: WithId<Employee>[]) {
    downloadCsv(
      `equipe-${restaurant.slug ?? restaurantId}-${todayIso()}`,
      rows.map((e) => ({
        Prénom: e.firstName,
        Nom: e.lastName,
        'E-mail': e.email ?? '',
        Téléphone: e.phone ?? '',
        Poste: e.position,
        Service: e.department ?? '',
        Contrat: CONTRACT_TYPE_LABELS[e.contractType],
        Entrée: e.hireDate,
        Fin: e.endDate ?? '',
        'Heures / semaine': e.weeklyHours,
        'Taux horaire (€)': csvEuros(e.hourlyRateCents),
        'Congés (j)': e.paidLeaveBalanceDays,
        'RTT (j)': e.rttBalanceDays,
        Statut: EMPLOYEE_STATUS_LABELS[e.status],
      })),
    );
  }

  const expiringCount = expiring.data.length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Équipe & RH"
        title="Employés"
        description={`Fiches, contrats et rémunérations de l’équipe de ${restaurant.name}.`}
        actions={
          <>
            <Button leftIcon={<Download />} onClick={() => exportRows(employees.data)} disabled={employees.data.length === 0}>
              Exporter
            </Button>
            {canManage && (
              <Button variant="primary" leftIcon={<Plus />} onClick={() => setFormOpen(true)}>
                Nouveau salarié
              </Button>
            )}
          </>
        }
      />

      {employees.error && <ErrorCard error={employees.error} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Effectif"
          value={formatNumber(active.length)}
          icon={<Users />}
          tone="brand"
          loading={employees.loading}
          footer={`${linked} avec un compte Ciyou Eats · ${employees.data.length - active.length} sorti(s) ou inactif(s)`}
        />
        <StatCard
          label="Heures contractuelles"
          value={`${formatNumber(weeklyHours, { decimals: true })} h`}
          icon={<Clock3 />}
          tone="info"
          loading={employees.loading}
          footer="Volume hebdomadaire de l’équipe active."
        />
        <StatCard
          label="Masse salariale de base"
          value={formatEUR(payroll, { cents: true, compact: payroll > 10_000_000 })}
          icon={<BadgeEuro />}
          tone="teal"
          loading={employees.loading}
          footer="Brut mensuel estimé, hors heures supplémentaires."
        />
        <StatCard
          label="Documents à renouveler"
          value={canManage ? formatNumber(expiringCount) : '—'}
          icon={<FileWarning />}
          tone={expiringCount > 0 ? 'amber' : 'success'}
          loading={canManage && expiring.loading}
          footer={canManage ? 'Expirés ou expirant dans les 30 jours.' : 'Réservé aux responsables d’équipe.'}
        />
      </div>

      <div className="mt-6">
        <DataTable
          data={employees.data}
          columns={columns}
          getRowId={(e) => e.id}
          loading={employees.loading}
          searchPlaceholder="Rechercher un salarié, un poste…"
          itemLabel="salariés"
          onRowClick={(e) => navigate(`/equipe/employes/${e.id}`)}
          initialSorting={[{ id: 'name', desc: false }]}
          filters={[
            {
              id: 'status',
              label: 'Statut',
              options: Object.entries(EMPLOYEE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
              getValue: (e) => e.status,
            },
            {
              id: 'contract',
              label: 'Contrat',
              options: Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
              getValue: (e) => e.contractType,
            },
            {
              id: 'department',
              label: 'Service',
              options: [...new Set(employees.data.map((e) => e.department ?? 'Non renseigné'))].map((d) => ({ value: d, label: d })),
              getValue: (e) => e.department ?? 'Non renseigné',
            },
          ]}
          bulkActions={[{ label: 'Exporter la sélection', icon: <Download />, onClick: (rows, clear) => { exportRows(rows); clear(); } }]}
          emptyState={
            <EmptyState
              compact
              icon={<Users />}
              title="Aucun salarié pour le moment"
              description="Créez les fiches de votre équipe pour planifier, suivre les pointages et préparer la paie."
              action={
                canManage ? (
                  <Button variant="primary" leftIcon={<Plus />} onClick={() => setFormOpen(true)}>
                    Ajouter un salarié
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      {canManage && (
        <EmployeeFormSheet
          open={formOpen}
          onOpenChange={setFormOpen}
          employees={employees.data}
          onSaved={(id) => navigate(`/equipe/employes/${id}`)}
        />
      )}
    </PageContainer>
  );
}
