import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { ORDER_STATUS, type StatusMeta } from '../lib/status';
import { toneClass, type Tone } from '../lib/tones';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** « soft » (fond teinté, défaut), « outline » (contour) ou « solid ». */
  variant?: 'soft' | 'outline' | 'solid';
  icon?: ReactNode;
  size?: 'sm' | 'md';
}

/** Étiquette compacte (formule, catégorie, compteur…). */
export function Badge({ tone = 'neutral', variant = 'soft', icon, size = 'md', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        toneClass[tone],
        'inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md font-medium [&_svg]:size-3',
        size === 'md' ? 'h-[22px] px-2 text-xs' : 'h-[18px] px-1.5 text-2xs',
        variant === 'soft' && 'bg-(--tone-bg) text-(--tone-fg)',
        variant === 'outline' && 'border border-(--tone-border) text-(--tone-fg)',
        variant === 'solid' && 'bg-(--tone-solid) text-white',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Point animé pour les états « en direct » (en livraison, en ligne…). */
  pulse?: boolean;
}

/** Pastille de statut arrondie avec point coloré. */
export function StatusPill({ tone = 'neutral', pulse, className, children, ...props }: StatusPillProps) {
  return (
    <span
      className={cn(
        toneClass[tone],
        'inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-(--tone-border) bg-(--tone-bg) ps-2 pe-2.5 text-xs font-medium text-(--tone-fg)',
        className,
      )}
      {...props}
    >
      <span className="relative flex size-1.5">
        {pulse && <span className="absolute inline-flex size-full animate-ping rounded-full bg-(--tone-solid) opacity-60" />}
        <span className="relative inline-flex size-1.5 rounded-full bg-(--tone-solid)" />
      </span>
      {children}
    </span>
  );
}

/** Pastille d'un statut connu ; repli neutre sur la clé brute sinon. */
export function StatusBadge({
  status,
  map = ORDER_STATUS,
  className,
}: {
  status: string;
  map?: Record<string, StatusMeta>;
  className?: string;
}) {
  const meta = map[status] ?? { label: status, tone: 'neutral' as const };
  return (
    <StatusPill tone={meta.tone} pulse={meta.pulse} className={className}>
      {meta.label}
    </StatusPill>
  );
}
