import type { ReactNode } from 'react';
import { AlertTriangle, Info, RotateCw } from 'lucide-react';
import { Button, Card, EmptyState, cn, toneClass, type Tone } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';

/** État d'erreur de chargement, avec relance. */
export function ErrorPanel({ error, onRetry, compact, className }: { error: unknown; onRetry?: () => void; compact?: boolean; className?: string }) {
  return (
    <Card className={className}>
      <EmptyState
        compact={compact}
        icon={<AlertTriangle />}
        title="Chargement impossible"
        description={errorMessage(error, 'Les données n’ont pas pu être chargées. Vérifiez votre connexion puis réessayez.')}
        action={
          onRetry ? (
            <Button size="sm" variant="secondary" leftIcon={<RotateCw />} onClick={onRetry}>
              Réessayer
            </Button>
          ) : (
            <Button size="sm" variant="secondary" leftIcon={<RotateCw />} onClick={() => window.location.reload()}>
              Recharger la page
            </Button>
          )
        }
      />
    </Card>
  );
}

/** Encadré d'information ou d'alerte. */
export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        toneClass[tone],
        'flex flex-col gap-3 rounded-xl border border-(--tone-border) bg-(--tone-bg) p-4 sm:flex-row sm:items-start',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <div className="mt-0.5 shrink-0 text-(--tone-fg) [&_svg]:size-[18px]">{icon ?? (tone === 'danger' || tone === 'amber' ? <AlertTriangle /> : <Info />)}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{title}</p>
          {children && <div className="mt-0.5 text-sm text-fg-muted">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 sm:self-center">{action}</div>}
    </div>
  );
}

/** Ligne libellé / valeur (fiches de détail). */
export function DetailRow({ label, value, strong, hint }: { label: ReactNode; value: ReactNode; strong?: boolean; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className={cn('text-sm', strong ? 'font-semibold text-fg' : 'text-fg-muted')}>{label}</p>
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
      <div className={cn('shrink-0 text-right font-mono text-sm num', strong ? 'font-semibold text-fg' : 'text-fg')}>{value}</div>
    </div>
  );
}
