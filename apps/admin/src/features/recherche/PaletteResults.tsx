import { Search } from 'lucide-react';
import { CommandResultGroup, CommandResultItem, CommandResultNote, Spinner } from '@golink/ui';
import { SEARCH_HIT_TYPE_LABELS } from '@golink/shared';
import { errorMessage } from '@/lib/firestore';
import { sortGroups, HIT_ICONS, HitStatus, hitHref, queryKind, useGlobalSearch } from './search';

/**
 * Résultats de la recherche universelle dans la palette ⌘K du shell : commandes,
 * commerces, clients, livreurs, factures et tickets, groupés par type.
 */
export function PaletteSearchResults({ query, enabled, onNavigate }: { query: string; enabled: boolean; onNavigate: (href: string) => void }) {
  const { result, loading, error, settled } = useGlobalSearch(query, 5, enabled);
  const q = query.trim();
  if (!enabled || q.length < 2) return null;
  const groups = sortGroups(result?.groups ?? [], query);
  const kind = queryKind(q);

  return (
    <>
      {groups.map((group) => (
        <CommandResultGroup key={`${settled}-${group.type}`} heading={SEARCH_HIT_TYPE_LABELS[group.type]}>
          {group.hits.map((hit) => {
            const href = hitHref(hit);
            return (
              <CommandResultItem
                key={`${settled}-${hit.type}-${hit.id}`}
                value={`recherche ${hit.type} ${hit.id}`}
                query={settled}
                icon={HIT_ICONS[hit.type]}
                title={hit.title}
                description={[hit.subtitle, hit.matched].filter(Boolean).join(' · ')}
                meta={<HitStatus type={hit.type} status={hit.status} />}
                onSelect={() => href && onNavigate(href)}
              />
            );
          })}
        </CommandResultGroup>
      ))}
      {loading ? (
        <CommandResultNote>
          <Spinner className="size-3.5" /> Recherche{kind ? ` par ${kind.toLowerCase()}` : ''} dans la plateforme…
        </CommandResultNote>
      ) : error ? (
        <CommandResultNote>{errorMessage(error)}</CommandResultNote>
      ) : settled && groups.length === 0 ? (
        <CommandResultNote>Aucune commande, aucun commerce, client, livreur, facture ou ticket pour « {settled} ».</CommandResultNote>
      ) : null}
      {settled && !loading && (
        <CommandResultGroup key={`${settled}-all`} heading="Recherche avancée">
          <CommandResultItem
            value="recherche voir-tout"
            query={settled}
            icon={<Search />}
            title={`Tous les résultats pour « ${q} »`}
            description="Afficher la page de recherche complète"
            onSelect={() => onNavigate(`/recherche?q=${encodeURIComponent(q)}`)}
          />
        </CommandResultGroup>
      )}
    </>
  );
}
