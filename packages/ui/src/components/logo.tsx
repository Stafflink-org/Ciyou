import { cn } from '../lib/cn';
import logoMarkSrc from '../assets/logo-mark.png';

export interface LogoMarkProps {
  size?: number;
  /** Conservé pour compatibilité des appels existants ; le symbole officiel est en couleurs fixes. */
  variant?: 'color' | 'mono';
  className?: string;
}

/** Symbole Ciyou Eats officiel (livreur à scooter dans un « C »), fourni par le client. */
export function LogoMark({ size = 32, className }: LogoMarkProps) {
  return (
    <img
      src={logoMarkSrc}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn('shrink-0 select-none object-contain', className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export interface LogoProps extends LogoMarkProps {
  /** Libellé discret sous le nom (« Restaurant », « Super admin »). */
  caption?: string;
  /** Masque le nom (symbole seul). */
  markOnly?: boolean;
}

/** Logo complet : symbole + nom Ciyou Eats ; s'adapte à la couleur du texte parent. */
export function Logo({ size = 32, variant, caption, markOnly, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} variant={variant} />
      {!markOnly && (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className="font-display font-semibold tracking-[-0.045em]"
            style={{ fontSize: Math.round(size * 0.62) }}
          >
            Ciyou<span className="text-primary"> Eats</span>
          </span>
          {caption && <span className="mt-1 font-mono text-3xs uppercase tracking-eyebrow opacity-60">{caption}</span>}
        </span>
      )}
    </span>
  );
}
