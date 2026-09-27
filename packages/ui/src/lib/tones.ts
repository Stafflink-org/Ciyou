// Tons sémantiques partagés : chaque classe tone-* fixe --tone-fg/bg/border/solid (voir styles/index.css).

export type Tone = 'neutral' | 'brand' | 'amber' | 'success' | 'danger' | 'info' | 'plum' | 'teal';

export const toneClass: Record<Tone, string> = {
  neutral: 'tone-neutral',
  brand: 'tone-brand',
  amber: 'tone-amber',
  success: 'tone-success',
  danger: 'tone-danger',
  info: 'tone-info',
  plum: 'tone-plum',
  teal: 'tone-teal',
};
