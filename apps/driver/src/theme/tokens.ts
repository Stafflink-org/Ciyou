// Jetons visuels de l'app livreur Ciyou Eats — charte dédiée, distincte de l'app client et
// des back-offices (document client « Points à corriger », 30/09/2026) : vert vif #16C784
// (moderne, frais, dynamique), noir #0B0F10 (premium), blanc #FFFFFF (contraste). React
// Native n'a pas de variables CSS : ce module est la seule source de couleurs pour tous les
// composants (`src/ui/*`) et écrans — jamais un code hexadécimal écrit ailleurs.
export const colors = {
  canvas: '#F7FAF9',
  surface: '#FFFFFF',
  surfaceAlt: '#F7FAF9',
  surfaceRaised: '#ECF6F1',
  elevated: '#FFFFFF',
  border: '#E1EBE6',
  borderStrong: '#C7DAD2',

  fg: '#0B0F10',
  fgMuted: '#56635D',
  fgSubtle: '#8A9A93',
  onDark: '#F7FAF9',

  primary: '#16C784',
  primaryHover: '#12A96F',
  primaryFg: '#0B0F10',
  primarySoft: '#E3F9EE',
  primarySoftFg: '#0E8A5C',

  ink: '#0B0F10',
  inkHover: '#272E31',
  inkFg: '#FFFFFF',

  danger: '#BF3F2E',
  dangerSoft: '#FDF2F1',
  dangerSoftFg: '#9F3226',
  success: '#16C784',
  successSoft: '#E3F9EE',
  warning: '#C47A1B',
  warningSoft: '#FBF1E1',
  info: '#3A66A0',
  infoSoft: '#E6EEF6',
  infoSoftFg: '#2B4E7A',

  white: '#FFFFFF',
  overlay: 'rgba(11, 15, 16, 0.5)',
  skeleton: '#ECF6F1',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0B0F10',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sm: {
    shadowColor: '#0B0F10',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
} as const;

// Typographie : système par défaut (San Francisco / Roboto) en attente d'une
// police de marque ; les tailles/poids sont, eux, la charte à respecter partout.
export const font = {
  family: undefined as string | undefined,
  size: { xs: 12, sm: 13, base: 15, md: 17, lg: 20, xl: 24, xxl: 30 },
  weight: {
    regular: '400' as const,
    medium: '600' as const,
    bold: '700' as const,
  },
} as const;
