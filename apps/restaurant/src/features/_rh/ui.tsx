// Composants communs des rubriques Équipe & RH.
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar, Button, Card, IconButton, cn, type StatusMeta, type Tone } from '@golink/ui';
import type {
  EmployeeStatus,
  HaccpNonConformityStatus,
  HaccpSeverity,
  PayslipStatus,
  RequestStatus,
  StaffDirectoryEntry,
  TaskPriority,
  TaskStatus,
  TimeEntryStatus,
  WeekValidationStatus,
} from '@golink/shared';
import { errorMessage } from '@/lib/firestore';
import { addDays, addMonths, currentPeriod, formatMonth, formatWeekRange, mondayOf, todayIso } from './dates';

// ------------------------------------------------------------------ Statuts

export const REQUEST_STATUS: Record<RequestStatus, StatusMeta> = {
  pending: { label: 'En attente', tone: 'amber', pulse: true },
  approved: { label: 'Acceptée', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};

export const TIME_ENTRY_STATUS: Record<TimeEntryStatus, StatusMeta> = {
  open: { label: 'En service', tone: 'info', pulse: true },
  pending: { label: 'À valider', tone: 'amber' },
  validated: { label: 'Validé', tone: 'success' },
  corrected: { label: 'Corrigé', tone: 'plum' },
  rejected: { label: 'Refusé', tone: 'danger' },
};

export const WEEK_STATUS: Record<WeekValidationStatus, StatusMeta> = {
  pending: { label: 'À valider', tone: 'amber' },
  employee_validated: { label: 'Validée par le salarié', tone: 'info' },
  manager_validated: { label: 'Validée', tone: 'success' },
  rejected: { label: 'Refusée', tone: 'danger' },
};

export const PAYSLIP_STATUS: Record<PayslipStatus, StatusMeta> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  generated: { label: 'À valider', tone: 'amber' },
  validated: { label: 'Validé', tone: 'success' },
  sent: { label: 'Envoyé', tone: 'info' },
};

export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  todo: { label: 'À faire', tone: 'neutral' },
  in_progress: { label: 'En cours', tone: 'info', pulse: true },
  review: { label: 'À vérifier', tone: 'amber' },
  done: { label: 'Terminée', tone: 'success' },
};

export const TASK_PRIORITY_TONE: Record<TaskPriority, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'amber',
  urgent: 'danger',
};

export const NC_STATUS: Record<HaccpNonConformityStatus, StatusMeta> = {
  open: { label: 'Ouverte', tone: 'danger', pulse: true },
  in_progress: { label: 'En traitement', tone: 'amber' },
  resolved: { label: 'Résolue', tone: 'success' },
};

export const SEVERITY_TONE: Record<HaccpSeverity, Tone> = { minor: 'amber', major: 'brand', critical: 'danger' };

export const EMPLOYEE_STATUS: Record<EmployeeStatus, StatusMeta> = {
  active: { label: 'Actif', tone: 'success' },
  inactive: { label: 'Inactif', tone: 'neutral' },
  on_leave: { label: 'En congé', tone: 'amber' },
  terminated: { label: 'Sorti', tone: 'neutral' },
};

// ------------------------------------------------------------------ Personnes

export function PersonCell({
  name,
  subtitle,
  size = 'sm',
  className,
  trailing,
}: {
  name: string;
  subtitle?: ReactNode;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <Avatar name={name} size={size} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">
          {name}
          {trailing}
        </p>
        {subtitle && <p className="truncate text-xs text-fg-subtle">{subtitle}</p>}
      </div>
    </div>
  );
}

export function DirectoryPerson({ entry, fallback = 'Salarié', subtitle }: { entry?: StaffDirectoryEntry | null; fallback?: string; subtitle?: ReactNode }) {
  return <PersonCell name={entry?.displayName ?? fallback} subtitle={subtitle ?? entry?.position ?? undefined} />;
}

// ------------------------------------------------------------------ États

export function ErrorCard({ error, title = 'Impossible de charger ces données', message }: { error?: unknown; title?: string; message?: string }) {
  return (
    <Card className="tone-danger flex items-start gap-3 border-(--tone-border) bg-(--tone-bg) p-4 text-(--tone-fg)">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm opacity-90">{message ?? errorMessage(error)}</p>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Navigation

export interface SubNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  end?: boolean;
}

/** Onglets de sous-pages (routes du même module). */
export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
  return (
    <nav aria-label="Sections" className={cn('-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0', className)}>
      <div className="flex min-w-max items-center gap-5 border-b border-border">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'relative -mb-px flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 text-sm font-medium transition-colors [&_svg]:size-4',
                isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )
            }
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="rounded-full bg-primary-soft px-1.5 py-px font-mono text-2xs text-primary-soft-fg num">{item.count}</span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function WeekSwitcher({ monday, onChange, className }: { monday: string; onChange: (monday: string) => void; className?: string }) {
  const current = mondayOf(todayIso());
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <IconButton label="Semaine précédente" variant="secondary" size="sm" onClick={() => onChange(addDays(monday, -7))}>
        <ChevronLeft />
      </IconButton>
      <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg shadow-xs">
        <CalendarDays className="size-4 shrink-0 text-fg-subtle" />
        <span className="truncate num">{formatWeekRange(monday)}</span>
      </div>
      <IconButton label="Semaine suivante" variant="secondary" size="sm" onClick={() => onChange(addDays(monday, 7))}>
        <ChevronRight />
      </IconButton>
      {monday !== current && (
        <Button size="sm" variant="ghost" onClick={() => onChange(current)}>
          Cette semaine
        </Button>
      )}
    </div>
  );
}

export function MonthSwitcher({ period, onChange, className }: { period: string; onChange: (period: string) => void; className?: string }) {
  const current = currentPeriod();
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <IconButton label="Mois précédent" variant="secondary" size="sm" onClick={() => onChange(addMonths(period, -1))}>
        <ChevronLeft />
      </IconButton>
      <div className="flex h-8 min-w-36 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg shadow-xs">
        <CalendarDays className="size-4 shrink-0 text-fg-subtle" />
        {formatMonth(period)}
      </div>
      <IconButton label="Mois suivant" variant="secondary" size="sm" onClick={() => onChange(addMonths(period, 1))} disabled={period >= current}>
        <ChevronRight />
      </IconButton>
    </div>
  );
}

/** Ligne « libellé : valeur » des panneaux de détail. */
export function DetailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2.5 text-sm', className)}>
      <span className="shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 text-right font-medium text-fg">{children}</span>
    </div>
  );
}

/** Petit indicateur chiffré en ligne (bandeau de synthèse compact). */
export function MiniStat({ label, value, tone = 'neutral', hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className={cn(`tone-${tone}`, 'min-w-0 rounded-xl border border-border bg-surface px-4 py-3 shadow-card')}>
      <p className="truncate text-xs font-medium text-fg-muted">{label}</p>
      <p className="num mt-1 truncate font-display text-xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-0.5 truncate text-2xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
