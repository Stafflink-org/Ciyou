// Options d'exécution du pilotage : instances bornées (quota de processeurs de la
// région) et mémoire relevée pour les calculs d'analytics et la génération de fichiers.
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { callable } from '../../lib/callable';

export const PILOTAGE_RUNTIME = { maxInstances: 3, cpu: 'gcf_gen1' } as const;
export const PILOTAGE_HEAVY_RUNTIME = { maxInstances: 3, memory: '512MiB', timeoutSeconds: 120 } as const;

export function pilotageCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...PILOTAGE_RUNTIME, ...options });
}
