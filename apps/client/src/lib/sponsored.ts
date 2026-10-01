// Mise en avant payante (cahier §11, admin/experience/display.ts `trackSponsoredEvent`) :
// `impressions`/`clicks` n'avaient aucun producteur côté client — la Cloud Function existe
// désormais et n'a besoin que d'être appelée. Sur le modèle de `lib/funnel.ts` : anonyme,
// tolérant aux erreurs, jamais bloquant pour l'utilisateur.
import { callFunction } from './firestore';

type SponsoredEvent = 'impression' | 'click';

const send = callFunction<{ restaurantId: string; event: SponsoredEvent }, { ok: true }>('trackSponsoredEvent');

export function trackSponsoredEvent(event: SponsoredEvent, restaurantId: string | null | undefined): void {
  if (!restaurantId) return;
  send({ restaurantId, event }).catch(() => undefined);
}
