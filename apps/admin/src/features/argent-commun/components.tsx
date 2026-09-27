// Composants communs des rubriques « Argent » : navigation par onglets, états,
// encadrés, lignes de détail, dialogue d'action motivée, sélecteur de période,
// menu d'export.
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, ChevronDown, Download, FileSpreadsheet, FileText, Info, Lock, RotateCw } from 'lucide-react';
import {
  Button,
  Card,
  DateRangePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  SegmentedControl,
  Textarea,
  cn,
  toneClass,
  type Tone,
} from '@golink/ui';
import { useCan } from '@/auth/AdminAccess';
import { errorMessage } from '@/lib/firestore';
import type { AdminPermission } from '@golink/shared';
import { isoDay } from './format';
import type { Period, PeriodPreset } from './hooks';

export interface SubNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  end?: boolean;
  permission?: AdminPermission;
  count?: number | null;
}

/** Onglets d'une rubrique (routes du module) ; défile horizontalement sur mobile. */
export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
  const can = useCan();
  const visible = items.filter((item) => !item.permission || can(item.permission));
  if (visible.length <= 1) return null;
  return (
    <nav data-scroll-ok aria-label="Sections de la rubrique" className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <div className="inline-flex min-w-max items-center gap-1 rounded-xl border border-border bg-surface-2 p-1">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors [&_svg]:size-4',
                isActive ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
              )
            }
          >
            {item.icon}
            {item.label}
            {item.count ? (
              <span className="tone-danger rounded-full bg-(--tone-bg) px-1.5 font-mono text-2xs font-medium text-(--tone-fg) num">{item.count}</span>
            ) : null}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** État d'erreur de chargement, avec relance. */
export function ErrorPanel({ error, onRetry, compact, className }: { error: unknown; onRetry?: () => void; compact?: boolean; className?: string }) {
  const denied = (error as { code?: string } | null)?.code?.includes('permission-denied');
  return (
    <Card className={className}>
      <EmptyState
        compact={compact}
        icon={denied ? <Lock /> : <AlertTriangle />}
        title={denied ? 'Accès non autorisé' : 'Chargement impossible'}
        description={
          denied
            ? 'Votre rôle ne donne pas accès à ces données. Demandez l’accès à un super administrateur.'
            : errorMessage(error, 'Les données n’ont pas pu être chargées. Vérifiez votre connexion puis réessayez.')
        }
        action={
          denied ? undefined : (
            <Button size="sm" variant="secondary" leftIcon={<RotateCw />} onClick={onRetry ?? (() => window.location.reload())}>
              Réessayer
            </Button>
          )
        }
      />
    </Card>
  );
}

/** Encadré d'information ou d'alerte. */
export function Callout({ tone = 'info', icon, title, children, action, className }: { tone?: Tone; icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn(toneClass[tone], 'flex flex-col gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 sm:flex-row sm:flex-wrap sm:items-start', className)}>
      <div className="flex min-w-0 flex-1 gap-3">
        <div className="mt-0.5 shrink-0 text-(--tone-fg) [&_svg]:size-[18px]">{icon ?? (tone === 'danger' || tone === 'amber' ? <AlertTriangle /> : <Info />)}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{title}</p>
          {children && <div className="mt-0.5 text-sm text-fg-muted">{children}</div>}
        </div>
      </div>
      {action && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 sm:self-center">{action}</div>}
    </div>
  );
}

/** Ligne libellé / valeur (fiches de détail). */
export function DetailRow({ label, value, strong, hint, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; hint?: ReactNode; tone?: 'danger' | 'success' | 'muted' }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className={cn('text-sm', strong ? 'font-semibold text-fg' : 'text-fg-muted')}>{label}</p>
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
      <div
        className={cn(
          'min-w-0 max-w-[65%] text-right font-mono text-sm num [overflow-wrap:anywhere]',
          strong ? 'font-semibold text-fg' : 'text-fg',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
          tone === 'muted' && 'text-fg-subtle',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Petit bloc « libellé / valeur » en grille (fiches). */
export function Fact({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

/**
 * Dialogue d'action sensible : champs propres à l'action et motif obligatoire
 * (journal d'audit). `onSubmit` renvoie true pour fermer (false : erreur affichée par toast).
 */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  confirmLabel = 'Confirmer',
  destructive,
  disabled,
  reasonLabel = 'Motif (conservé dans le journal d’audit)',
  reasonPlaceholder,
  size = 'sm',
  children,
  onSubmit,
  requireReason = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  requireReason?: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const blocked = (requireReason && reason.trim().length < 3) || disabled;
  const close = (next: boolean) => {
    if (pending) return;
    if (!next) setReason('');
    onOpenChange(next);
  };
  async function submit() {
    setPending(true);
    try {
      const ok = await onSubmit(reason.trim());
      if (ok) {
        setReason('');
        onOpenChange(false);
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size={size}>
        <DialogHeader title={title} description={description} icon={icon ?? (destructive ? <AlertTriangle className="text-danger" /> : undefined)} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!blocked) void submit();
          }}
        >
          <DialogBody className="space-y-4 pt-2">
            {children}
            {requireReason && (
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-fg">{reasonLabel}</span>
                <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder={reasonPlaceholder ?? 'Ex. : demande du commerce, régularisation après contrôle…'} maxLength={500} />
              </label>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" variant={destructive ? 'danger' : 'primary'} loading={pending} disabled={blocked}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PRESETS: Array<{ value: Exclude<PeriodPreset, 'custom'>; label: string }> = [
  { value: '7d', label: '7 j' },
  { value: '30d', label: '30 j' },
  { value: '90d', label: '90 j' },
  { value: 'ytd', label: 'Année' },
];

const RANGE_PRESETS = [
  { label: 'Mois en cours', range: () => ({ from: new Date(new Date().getFullYear(), new Date().getMonth(), 1), to: new Date() }) },
  { label: 'Mois précédent', range: () => ({ from: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), to: new Date(new Date().getFullYear(), new Date().getMonth(), 0) }) },
  { label: 'Trimestre écoulé', range: () => ({ from: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1), to: new Date(new Date().getFullYear(), new Date().getMonth(), 0) }) },
  { label: 'Depuis le 1er janvier', range: () => ({ from: new Date(new Date().getFullYear(), 0, 1), to: new Date() }) },
];

const parse = (value: string) => {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

export function PeriodBar({ period, onPreset, onCustom, className }: { period: Period; onPreset: (preset: Exclude<PeriodPreset, 'custom'>) => void; onCustom: (from: string, to: string) => void; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <SegmentedControl
        aria-label="Période"
        size="sm"
        value={PRESETS.some((p) => p.value === period.preset) ? period.preset : ''}
        onValueChange={(value) => onPreset(value as Exclude<PeriodPreset, 'custom'>)}
        options={PRESETS}
      />
      <DateRangePicker
        className="min-w-0 max-w-full sm:min-w-56"
        value={{ from: parse(period.from), to: parse(period.to) }}
        presets={RANGE_PRESETS}
        onChange={(range) => {
          if (!range?.from) return;
          onCustom(isoDay(range.from), isoDay(range.to ?? range.from));
        }}
      />
    </div>
  );
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/** Menu d'export (CSV, Excel, PDF selon les formats proposés). */
export function ExportMenu({ onExport, formats = ['csv', 'xlsx'], disabled, label = 'Exporter' }: { onExport: (format: ExportFormat) => void | Promise<void>; formats?: ExportFormat[]; disabled?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const run = async (format: ExportFormat) => {
    setBusy(true);
    try {
      await onExport(format);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" leftIcon={<Download />} rightIcon={<ChevronDown />} loading={busy} disabled={disabled}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.includes('csv') && (
          <DropdownMenuItem icon={<FileText />} onSelect={() => void run('csv')}>
            CSV (tableur)
          </DropdownMenuItem>
        )}
        {formats.includes('xlsx') && (
          <DropdownMenuItem icon={<FileSpreadsheet />} onSelect={() => void run('xlsx')}>
            Classeur Excel
          </DropdownMenuItem>
        )}
        {formats.includes('pdf') && (
          <DropdownMenuItem icon={<FileText />} onSelect={() => void run('pdf')}>
            PDF
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Montant aligné en chiffres tabulaires, coloré selon le signe si demandé. */
export function Money({ cents, signed, className, muted }: { cents: number; signed?: boolean; className?: string; muted?: boolean }) {
  const text = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Math.abs(cents) / 100);
  return (
    <span className={cn('font-mono num whitespace-nowrap', signed && cents < 0 && 'text-danger', signed && cents > 0 && 'text-success', muted && 'text-fg-subtle', className)}>
      {cents < 0 ? '− ' : signed && cents > 0 ? '+ ' : ''}
      {text}
    </span>
  );
}
