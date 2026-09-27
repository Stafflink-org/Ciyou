import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../lib/cn';
import { toneClass, type Tone } from '../lib/tones';

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  /** Carte cliquable : effet de survol. */
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddings = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' } as const;

export function Card({ className, interactive, padding = 'none', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border border-border bg-surface shadow-card',
        interactive && 'transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-border-strong hover:shadow-md',
        paddings[padding],
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** Actions alignées à droite (boutons, menu…). */
  actions?: ReactNode;
  icon?: ReactNode;
  /** Trait de séparation sous l'en-tête. */
  divided?: boolean;
}

export function CardHeader({ title, description, eyebrow, actions, icon, divided, className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5', divided ? 'border-b border-border pb-4' : 'pb-1', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
        {icon && (
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-[18px]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h3 className="font-display text-md font-semibold tracking-tight text-balance text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-fg-muted', className)}
      {...props}
    />
  );
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Variation relative (0.12 = +12 %) comparée à la période précédente. */
  delta?: number;
  /** Libellé de comparaison, ex. « vs semaine dernière ». */
  deltaLabel?: ReactNode;
  /** Une hausse est-elle une mauvaise nouvelle (taux d'annulation…) ? */
  invertDelta?: boolean;
  icon?: ReactNode;
  tone?: Tone;
  /** Mini-graphique (Sparkline) affiché en pied de carte. */
  chart?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const deltaFormat = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/** Indicateur clé : libellé, valeur, tendance et graphique optionnel. */
export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  invertDelta,
  icon,
  tone = 'brand',
  chart,
  footer,
  loading,
  onClick,
  className,
}: StatCardProps) {
  const direction = delta === undefined || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  const positive = direction === 'flat' ? null : (direction === 'up') !== Boolean(invertDelta);
  const DeltaIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        toneClass[tone],
        'group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface p-5 text-start shadow-card',
        onClick && 'transition-[border-color,box-shadow] duration-200 hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-fg-muted [overflow-wrap:anywhere]">{label}</p>
        {icon && (
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-4">
            {icon}
          </div>
        )}
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-28 animate-pulse rounded-md bg-surface-3" />
      ) : (
        <p className="num mt-2 truncate font-display text-3xl font-semibold tracking-display text-fg">{value}</p>
      )}
      {(delta !== undefined || deltaLabel) && !loading && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {delta !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono font-medium num',
                positive === null && 'bg-surface-3 text-fg-muted',
                positive === true && 'tone-success bg-(--tone-bg) text-(--tone-fg)',
                positive === false && 'tone-danger bg-(--tone-bg) text-(--tone-fg)',
              )}
            >
              <DeltaIcon className="size-3" />
              {deltaFormat.format(delta)}
            </span>
          )}
          {deltaLabel && <span className="text-fg-subtle">{deltaLabel}</span>}
        </div>
      )}
      {chart && <div className="-mx-1 mt-4 h-12">{chart}</div>}
      {footer && <div className="mt-4 border-t border-border pt-3 text-xs text-fg-muted">{footer}</div>}
    </Tag>
  );
}
