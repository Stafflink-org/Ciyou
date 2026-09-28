// Options d'exécution des fonctions « Argent » : fraction de processeur et nombre
// d'instances bornés (quota de processeurs partagé de la région).
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { callable } from '../../lib/callable';

// Peu d'instances, fraction de processeur : le quota de processeurs de la région est partagé.
export const ARGENT_RUNTIME = { maxInstances: 2, cpu: 'gcf_gen1', memory: '256MiB', timeoutSeconds: 120 } as const;
export const ARGENT_HEAVY_RUNTIME = { maxInstances: 1, cpu: 'gcf_gen1', memory: '512MiB', timeoutSeconds: 540 } as const;

export function argentCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...ARGENT_RUNTIME, ...options });
}
