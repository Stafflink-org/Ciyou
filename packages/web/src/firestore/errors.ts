import { FirebaseError } from 'firebase/app';
import { hasTranslation, translate } from '../i18n/core';

// Messages traduits dans i18n/<langue>/common.json (clés « errors.<code> »).
// Les codes Functions arrivent préfixés « functions/ », ceux de Firestore sans préfixe.
// Codes Functions dont le message est rédigé par le serveur (en français) et affichable tel quel.
const SERVER_WORDED = new Set(['invalid-argument', 'failed-precondition', 'already-exists', 'not-found', 'permission-denied', 'out-of-range']);

function known(code: string): string | undefined {
  const key = `errors.${code}`;
  return hasTranslation(key) ? translate(key) : undefined;
}

/** Message lisible pour une erreur quelconque, dans la langue courante de l'interface. */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof FirebaseError) {
    const isFunctions = error.code.startsWith('functions/');
    const code = isFunctions ? error.code.slice('functions/'.length) : error.code;
    if (isFunctions && SERVER_WORDED.has(code) && error.message && error.message !== code.toUpperCase()) {
      // Le SDK Functions suffixe le message d'un statut HTTP « [400] » : on le retire.
      return error.message.replace(/\s*\[\d{3}\]$/, '');
    }
    return known(code) ?? known(error.code) ?? fallback ?? translate('errors.default');
  }
  return fallback ?? translate('errors.default');
}

/** Code d'erreur Firebase sans préfixe de service, ou null. */
export function errorCode(error: unknown): string | null {
  if (!(error instanceof FirebaseError)) return null;
  return error.code.replace(/^(functions|firestore|storage)\//, '');
}
