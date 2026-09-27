// Fabrique de fonctions appelables : validation zod des entrées, erreurs
// converties en messages français, journalisation des erreurs inattendues.
// `invoker: 'public'` est posé ici pour que chaque déploiement rende le service
// Cloud Run appelable sans jeton IAM (l'authentification reste celle de Firebase Auth
// vérifiée dans le handler) ; sans cela les appels répondent 403 côté Google Frontend.
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { fail } from './errors';
import { parseInput } from './validation';

export function callable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return onCall<unknown, Promise<Result>>({ cors: true, invoker: 'public', ...options }, async (request) => {
    const data = parseInput(schema, request.data ?? {}) as z.output<Schema>;
    try {
      return await handler(data, request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('Erreur inattendue', { error: error instanceof Error ? error.stack : String(error) });
      throw fail.internal();
    }
  });
}
