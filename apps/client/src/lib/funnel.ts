// Tunnel de commande (cahier §3 Analytics, admin/pilotage/analytics.ts `funnel()`) :
// les deux dernières étapes (paiement lancé, payé) sont déjà dérivées des commandes
// côté serveur, mais les trois premières (ouverture de l'app, fiche commerce
// consultée, ajout au panier) exigent que l'application cliente les signale — la
// Cloud Function `trackFunnelEvent` (functions/src/admin/pilotage/platform-stats.ts)
// existe déjà et n'avait tout simplement jamais été appelée par personne (corrigé
// cdc-fix-residuals-7 : la ligne « Tunnel de commande » restait ABSENTE faute de
// ces trois appels, alors que toute la collecte et l'agrégation étaient prêtes).
// Anonyme, tolérant aux erreurs (jamais bloquant pour l'utilisateur).
import { callFunction } from './firestore';

type FunnelEvent = 'app_open' | 'restaurant_view' | 'add_to_cart';

const send = callFunction<{ event: FunnelEvent; countryId: string; cityId: string }, { ok: true }>('trackFunnelEvent');

export function trackFunnelEvent(event: FunnelEvent, target: { countryId?: string | null; cityId?: string | null } | null | undefined): void {
  if (!target?.countryId || !target?.cityId) return;
  send({ event, countryId: target.countryId, cityId: target.cityId }).catch(() => undefined);
}
