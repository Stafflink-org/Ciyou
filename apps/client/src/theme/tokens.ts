// Jetons visuels de l'app client Ciyou Eats — charte transmise par le client (document
// « Points à corriger », 30/09/2026) : orange #FF6B00/#FF8A00, noir #0B0F10, blanc, gris
// #98A2B3, alignée sur `packages/ui/src/styles/tokens.css` (thème « restaurant » clair).
// React Native n'a pas de variables CSS : ce module est l'équivalent en constantes
// TypeScript, seule source de couleurs pour tous les composants (`src/ui/*`) et écrans —
// jamais un code hexadécimal écrit ailleurs.
export const colors = {
  canvas: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F7F8FA',
  surfaceRaised: '#EEF0F3',
  elevated: '#FFFFFF',
  border: '#E4E7EB',
  borderStrong: '#C9CFD6',

  fg: '#0B0F10',
  fgMuted: '#667085',
  fgSubtle: '#98A2B3',
  onDark: '#F7F8FA',

  primary: '#FF6B00',
  primaryHover: '#E86000',
  primaryFg: '#FFFFFF',
  primarySoft: '#FFF1E6',
  primarySoftFg: '#B34D00',

  ink: '#0B0F10',
  inkHover: '#272E31',
  inkFg: '#FFFFFF',

  danger: '#BF3F2E',
  dangerSoft: '#FDF2F1',
  dangerSoftFg: '#9F3226',
  success: '#39705F',
  successSoft: '#E9F4EF',
  warning: '#C47A1B',
  warningSoft: '#FBF1E1',
  info: '#3A66A0',

  white: '#FFFFFF',
  overlay: 'rgba(11, 15, 16, 0.5)',
  skeleton: '#EEF0F3',
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
