// Validation des entrées avec zod, messages en français.
import { z } from 'zod';
import { fail } from './errors';

z.config(z.locales.fr());

export { z };

/** Valide `data` ; en cas d'échec, lève une erreur invalid-argument lisible. */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  const first = issues[0];
  const message = first ? (first.field ? `${first.field} : ${first.message}` : first.message) : 'Données invalides.';
  throw fail.invalid(message, { issues });
}

// Schémas réutilisables.
export const zId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Identifiant invalide');
export const zEmail = z.string().trim().toLowerCase().pipe(z.email('Adresse e-mail invalide'));
export const zName = z.string().trim().min(1).max(80);
export const zPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 .()-]{6,20}$/, 'Numéro de téléphone invalide');
export const zPassword = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères')
  .max(128)
  .regex(/[A-Za-z]/, 'Le mot de passe doit contenir une lettre')
  .regex(/[0-9]/, 'Le mot de passe doit contenir un chiffre');
export const zReason = z.string().trim().min(3, 'Indiquez un motif').max(500);
