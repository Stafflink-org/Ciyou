import { useId } from 'react';
import { cn } from '../lib/cn';

export interface LogoMarkProps {
  size?: number;
  /** « color » : tuile orange ; « mono » : tuile de la couleur du texte courant. */
  variant?: 'color' | 'mono';
  className?: string;
}

/**
 * Symbole GoLink : un « G » dessiné comme un itinéraire — la boucle part du
 * restaurant (point) et revient vers le centre, le client.
 */
export function LogoMark({ size = 32, variant = 'color', className }: LogoMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const color = variant === 'color';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      {color && (
        <defs>
          <linearGradient id={`${uid}-tile`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f09264" />
            <stop offset="1" stopColor="#e2693a" />
          </linearGradient>
        </defs>
      )}
      <rect width="32" height="32" rx="9" fill={color ? `url(#${uid}-tile)` : 'currentColor'} />
      {color && <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" stroke="#ffffff" strokeOpacity="0.18" />}
      <path
        d="M20.8 10.2A8.2 8.2 0 1 0 23.7 16.4H16.9"
        stroke={color ? '#0f2227' : 'var(--gl-canvas, #ffffff)'}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.3" cy="7.4" r="1.9" fill={color ? '#fdfbf7' : 'var(--gl-canvas, #ffffff)'} />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** Libellé discret sous le nom (« Restaurant », « Super admin »). */
  caption?: string;
  /** Masque le nom (symbole seul). */
  markOnly?: boolean;
}

/** Logo complet : symbole + nom GoLink ; s'adapte à la couleur du texte parent. */
export function Logo({ size = 32, variant = 'color', caption, markOnly, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} variant={variant} />
      {!markOnly && (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className="font-display font-semibold tracking-[-0.045em]"
            style={{ fontSize: Math.round(size * 0.62) }}
          >
            Go<span className="text-primary">Link</span>
          </span>
          {caption && <span className="mt-1 font-mono text-3xs uppercase tracking-eyebrow opacity-60">{caption}</span>}
        </span>
      )}
    </span>
  );
}
