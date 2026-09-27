// Petits composants de présentation partagés par les fiches restaurant et client.
import type { ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, EmptyState, cn, formatEUR } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';

export function eur(cents: number | null | undefined): string {
  return formatEUR(cents ?? 0, { cents: true });
}

export function bpsLabel(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`;
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card>
      <EmptyState
        compact
        icon={<AlertTriangle />}
        title="Chargement impossible"
        description={errorMessage(error)}
        action={
          onRetry ? (
            <Button size="sm" variant="secondary" leftIcon={<RotateCcw />} onClick={onRetry}>
              Réessayer
            </Button>
          ) : undefined
        }
      />
    </Card>
  );
}

/** Liste « libellé : valeur » en deux colonnes. */
export function Facts({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode } | null | false | undefined>; className?: string }) {
  return (
    <dl className={cn('divide-y divide-border', className)}>
      {items.filter(Boolean).map((item, index) => {
        const it = item as { label: ReactNode; value: ReactNode; hint?: ReactNode };
        return (
          <div key={index} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <dt className="min-w-0 max-w-[55%] [overflow-wrap:anywhere] text-sm text-fg-muted">{it.label}</dt>
            <dd className="min-w-0 break-words text-sm font-medium text-fg sm:text-right">
              {it.value}
              {it.hint && <span className="block text-xs font-normal text-fg-subtle">{it.hint}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function Panel({
  title,
  description,
  actions,
  icon,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} actions={actions} icon={icon} divided />
      <CardContent className={cn('pt-4', bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Pastille de score 0-100 (qualité, risque). */
export function ScoreRing({ value, size = 44, tone }: { value: number; size?: number; tone?: 'success' | 'amber' | 'danger' }) {
  const t = tone ?? (value >= 80 ? 'success' : value >= 65 ? 'amber' : 'danger');
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cn(`tone-${t}`, 'relative inline-grid shrink-0 place-items-center')} style={{ width: size, height: size }} aria-label={`Score ${value} sur 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--tone-solid)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)}
        />
      </svg>
      <span className="absolute font-display font-semibold text-fg num" style={{ fontSize: Math.max(11, Math.round(size * 0.3)) }}>
        {value}
      </span>
    </span>
  );
}
