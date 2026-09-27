// Options d'exécution du domaine commandes : nombre d'instances borné pour
// rester sous le quota de processeurs de la région.
import type { CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { callable } from '../lib/callable';

export const ORDERS_MAX_INSTANCES = 5;

/** Options communes : fraction de processeur (profil 1re génération) et instances bornées. */
export const ORDERS_RUNTIME = { maxInstances: ORDERS_MAX_INSTANCES, cpu: 'gcf_gen1' } as const;

export function ordersCallable<Schema extends z.ZodType, Result>(
  schema: Schema,
  handler: (data: z.output<Schema>, request: CallableRequest<unknown>) => Promise<Result>,
  options: CallableOptions = {},
) {
  return callable(schema, handler, { ...ORDERS_RUNTIME, ...options });
}
