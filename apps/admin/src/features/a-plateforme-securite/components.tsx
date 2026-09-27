// Composants communs de la rubrique « Plateforme & sécurité » : navigation par
// onglets, états de chargement, encadrés et dialogue d'action motivée (journal
// d'audit). Repris du même contrat que les autres rubriques (voir argent-commun).
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, Info, Lock, RotateCw } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Textarea,
  cn,
  toneClass,
  type Tone,
} from '@golink/ui';
import type { AdminPermission } from '@golink/shared';
import { useCan } from '@/auth/AdminAccess';
import { errorMessage } from '@/lib/firestore';

export interface SubNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  end?: boolean;
  /** Une seule permission, ou plusieurs (l'une suffit — ex. un onglet ouvert à deux rôles distincts). */
  permission?: AdminPermission | readonly AdminPermission[];
  count?: number | null;
}

function hasAny(can: (p: AdminPermission) => boolean, permission?: AdminPermission | readonly AdminPermission[]): boolean {
  if (!permission) return true;
  return Array.isArray(permission) ? permission.some(can) : can(permission as AdminPermission);
}

export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
  const can = useCan();
  const visible = items.filter((item) => hasAny(can, item.permission));
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
            {item.count ? <span className="tone-danger rounded-full bg-(--tone-bg) px-1.5 font-mono text-2xs font-medium text-(--tone-fg) num">{item.count}</span> : null}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * Garde de page : le menu ne masque que la rubrique dans son ensemble
 * (`platform.access`) ; chaque page vérifie ici son propre droit fin avant
 * d'afficher des données ou un formulaire (accès direct par URL sinon possible).
 */
export function RequirePermission({ permission, title, children }: { permission: AdminPermission | readonly AdminPermission[]; title: string; children: ReactNode }) {
  const can = useCan();
  if (hasAny(can, permission)) return <>{children}</>;
  return (
    <Card>
      <EmptyState icon={<Lock />} title="Accès réservé" description={`« ${title} » n’entre pas dans vos droits. Demandez l’accès à un super administrateur.`} />
    </Card>
  );
}

export function ErrorPanel({ error, onRetry, compact, className }: { error: unknown; onRetry?: () => void; compact?: boolean; className?: string }) {
  const denied = (error as { code?: string } | null)?.code?.includes('permission-denied');
  return (
    <Card className={className}>
      <EmptyState
        compact={compact}
        icon={denied ? <Lock /> : <AlertTriangle />}
        title={denied ? 'Accès non autorisé' : 'Chargement impossible'}
        description={denied ? 'Votre rôle ne donne pas accès à ces données. Demandez l’accès à un super administrateur.' : errorMessage(error, 'Les données n’ont pas pu être chargées. Vérifiez votre connexion puis réessayez.')}
        action={denied ? undefined : <Button size="sm" variant="secondary" leftIcon={<RotateCw />} onClick={onRetry ?? (() => window.location.reload())}>Réessayer</Button>}
      />
    </Card>
  );
}

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

export function DetailRow({ label, value, strong, hint }: { label: ReactNode; value: ReactNode; strong?: boolean; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className={cn('text-sm', strong ? 'font-semibold text-fg' : 'text-fg-muted')}>{label}</p>
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
      <div className={cn('min-w-0 max-w-[65%] text-right font-mono text-sm num [overflow-wrap:anywhere]', strong ? 'font-semibold text-fg' : 'text-fg')}>{value}</div>
    </div>
  );
}

export function Fact({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Dialogue d'action motivée : le motif est conservé dans le journal d'audit. */
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
                <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder={reasonPlaceholder ?? 'Ex. : demande de la direction, contrôle de sécurité…'} maxLength={500} />
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
