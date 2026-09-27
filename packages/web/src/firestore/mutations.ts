import { useCallback, useRef, useState } from 'react';
import { httpsCallable, type Functions } from 'firebase/functions';
import { toast } from '@golink/ui';
import { errorMessage } from './errors';

/**
 * Fonction serveur (Cloud Function « callable », région europe-west1) typée.
 * Usage : `const placeOrder = callable<PlaceOrderInput, PlaceOrderResult>(functions, 'placeOrder');`
 */
export function callable<Input = void, Output = void>(functions: Functions, name: string) {
  const fn = httpsCallable<Input, Output>(functions, name);
  return async (input: Input): Promise<Output> => (await fn(input)).data;
}

export interface MutationOptions<Output> {
  /** Toast de succès (texte fixe ou calculé depuis le résultat). */
  success?: string | ((output: Output) => string);
  /** Toast d'erreur automatique (activé par défaut). */
  errorToast?: boolean;
}

export interface MutationState<Args extends unknown[], Output> {
  /** Lance l'action ; renvoie undefined en cas d'erreur (déjà signalée par toast). */
  mutate: (...args: Args) => Promise<Output | undefined>;
  loading: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * État de chargement, toasts et gestion d'erreur autour d'une écriture
 * (Cloud Function, updateDoc…). Les appels concurrents sont ignorés.
 */
export function useMutation<Args extends unknown[], Output>(
  action: (...args: Args) => Promise<Output>,
  { success, errorToast = true }: MutationOptions<Output> = {},
): MutationState<Args, Output> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);

  const mutate = useCallback(
    async (...args: Args) => {
      if (running.current) return undefined;
      running.current = true;
      setLoading(true);
      setError(null);
      try {
        const output = await action(...args);
        if (success) toast.success(typeof success === 'function' ? success(output) : success);
        return output;
      } catch (caught) {
        setError(caught);
        if (errorToast) toast.error(errorMessage(caught));
        return undefined;
      } finally {
        running.current = false;
        setLoading(false);
      }
    },
    [action, success, errorToast],
  );

  const reset = useCallback(() => setError(null), []);
  return { mutate, loading, error, reset };
}
