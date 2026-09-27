import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge doit connaître l'échelle typographique GoLink (text-2xs, text-md…)
// pour ne pas la confondre avec des couleurs de texte.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['3xs', '2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] }],
      shadow: [{ shadow: ['xs', 'sm', 'card', 'md', 'lg', 'xl'] }],
    },
  },
});

/** Concatène des classes conditionnelles en résolvant les conflits Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
