// Recherche universelle (cahier §2) : appel de globalSearch avec délai de frappe,
// icônes et libellés par type, lien vers la fiche.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bike, FileText, LifeBuoy, ShoppingBag, Store, User } from 'lucide-react';
import { StatusPill, type Tone } from '@golink/ui';
import {
  DRIVER_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  RESTAURANT_STATUS_LABELS,
  TICKET_STATUS_LABELS,
  type GlobalSearchHit,
  type GlobalSearchInput,
  type GlobalSearchResult,
  type SearchHitType,
} from '@golink/shared';
import { callFunction } from '@/lib/firestore';
import { entityHref } from '../pilotage-commun/links';

const globalSearch = callFunction<GlobalSearchInput, GlobalSearchResult>('globalSearch');

export const HIT_ICONS: Record<SearchHitType, ReactNode> = {
  order: <ShoppingBag />,
  restaurant: <Store />,
  client: <User />,
  driver: <Bike />,
  invoice: <FileText />,
  ticket: <LifeBuoy />,
};

const BY_NAME: SearchHitType[] = ['restaurant', 'client', 'driver', 'ticket', 'invoice', 'order'];
const BY_REFERENCE: Partial<Record<string, SearchHitType>> = {
  'Numéro de commande': 'order',
  'Numéro de facture': 'invoice',
  'Numéro de ticket': 'ticket',
  SIRET: 'restaurant',
};

/** Groupes triés : le type visé par un numéro d'abord, sinon les fiches avant les commandes. */
export function sortGroups<G extends { type: SearchHitType }>(groups: G[], query: string): G[] {
  const kind = queryKind(query);
  const first = kind ? BY_REFERENCE[kind] : undefined;
  const rank = (type: SearchHitType) => (type === first ? -1 : BY_NAME.indexOf(type));
  return [...groups].sort((a, b) => rank(a.type) - rank(b.type));
}

const STATUS_TONES: Record<string, Tone> = {
  active: 'success',
  delivered: 'success',
  paid: 'success',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'danger',
  suspended: 'danger',
  blocked: 'danger',
  overdue: 'danger',
  paused: 'amber',
  pending: 'brand',
  open: 'brand',
  onboarding: 'info',
  delivering: 'info',
};

const STATUS_LABELS: Record<SearchHitType, Record<string, string>> = {
  order: ORDER_STATUS_LABELS,
  restaurant: RESTAURANT_STATUS_LABELS,
  client: { active: 'Actif', blocked: 'Bloqué', pending_deletion: 'Suppression demandée', deleted: 'Supprimé' },
  driver: DRIVER_STATUS_LABELS,
  invoice: INVOICE_STATUS_LABELS,
  ticket: TICKET_STATUS_LABELS,
};

/** Pastille de statut d'un résultat, libellée selon son type. */
export function HitStatus({ type, status }: { type: SearchHitType; status?: string | null }) {
  if (!status) return null;
  const label = STATUS_LABELS[type][status];
  if (!label) return null;
  return (
    <StatusPill tone={STATUS_TONES[status] ?? 'neutral'} className="text-2xs">
      {label}
    </StatusPill>
  );
}

export function hitHref(hit: GlobalSearchHit): string | null {
  return entityHref({ type: hit.type, id: hit.id });
}

/** Détection du motif saisi (aide affichée sous le champ). */
export function queryKind(query: string): string | null {
  const q = query.trim();
  if (/^gl-?\d{3,}$/i.test(q)) return 'Numéro de commande';
  if (/^\S+@\S+$/.test(q)) return 'Adresse e-mail';
  if (/^\+?[\d\s.-]{8,}$/.test(q)) return q.replace(/\D/g, '').length === 14 ? 'SIRET' : 'Téléphone';
  if (/^(fa|av|fac|inv)[-\s]?\d+/i.test(q)) return 'Numéro de facture';
  // Vrai format des numéros émis (`formatInvoiceNumber`, `functions/src/finance/argent/common.ts`) :
  // `SÉRIE-ANNÉE-000000`, la série pouvant elle-même contenir un tiret (ex. `LU-ABO-2026-000002`).
  // Sans cette branche, taper le numéro réel d'une facture n'était jamais reconnu comme tel par le
  // regroupement des résultats (`docs/AUDIT_COUVERTURE_CDC.md` §2) — seul l'exemple d'écran (« FA-2026 »,
  // qui ne correspond à aucune série réelle) était couvert.
  if (/^[a-z]{2,4}(-[a-z]{2,6}){0,2}-\d{4}-\d{3,}$/i.test(q)) return 'Numéro de facture';
  if (/^(t|tk|tic)[-\s]?\d+/i.test(q)) return 'Numéro de ticket';
  return null;
}

export interface SearchState {
  result: GlobalSearchResult | null;
  loading: boolean;
  error: unknown;
  /** Requête effectivement envoyée (après délai). */
  settled: string;
}

/** Recherche avec délai de frappe (250 ms) ; ignore les réponses dépassées. */
export function useGlobalSearch(query: string, limit = 5, enabled = true): SearchState {
  const [state, setState] = useState<SearchState>({ result: null, loading: false, error: null, settled: '' });
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      seq.current += 1;
      setState({ result: null, loading: false, error: null, settled: '' });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const id = ++seq.current;
    const timer = window.setTimeout(() => {
      globalSearch({ query: q, limit })
        .then((result) => {
          if (seq.current === id) setState({ result, loading: false, error: null, settled: q });
        })
        .catch((error: unknown) => {
          if (seq.current === id) setState({ result: null, loading: false, error, settled: q });
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, limit, enabled]);
  return state;
}
