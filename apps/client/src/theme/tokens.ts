// Jetons visuels de l'app client Ciyou Eats — même identité que les back-offices
// (`packages/ui/src/styles/tokens.css`, thème « restaurant » clair, qui est déjà
// la palette client : corail #E8784B, encre #19343B, fonds crème). React Native
// n'a pas de variables CSS : ce module est l'équivalent en constantes TypeScript,
// seule source de couleurs pour tous les composants (`src/ui/*`) et écrans —
// jamais un code hexadécimal écrit ailleurs.
export const colors = {
  canvas: '#F6F2EA',
  surface: '#FFFDF9',
  surfaceAlt: '#FAF6EF',
  surfaceRaised: '#F2ECE1',
  elevated: '#FFFFFF',
  border: '#E8E0D2',
  borderStrong: '#D8CEBC',

  fg: '#19343B',
  fgMuted: '#587070',
  fgSubtle: '#879793',
  onDark: '#F8F4EC',

  primary: '#E8784B',
  primaryHover: '#DF6A3B',
  primaryFg: '#1C0D06',
  primarySoft: '#FDEEE6',
  primarySoftFg: '#B04824',

  ink: '#19343B',
  inkHover: '#243F44',
  inkFg: '#F8F4EC',

  danger: '#BF3F2E',
  dangerSoft: '#FDF2F1',
  dangerSoftFg: '#9F3226',
  success: '#39705F',
  successSoft: '#E9F4EF',
  warning: '#C47A1B',
  warningSoft: '#FBF1E1',
  info: '#3A66A0',

  white: '#FFFFFF',
  overlay: 'rgba(15, 34, 39, 0.5)',
  skeleton: '#EFE8DA',
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
    shadowColor: '#19343B',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  sm: {
    shadowColor: '#19343B',
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
