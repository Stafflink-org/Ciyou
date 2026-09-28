import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Search, SearchX } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Input, Kbd, PageContainer, PageHeader, Skeleton, formatDateTime, formatNumber } from '@golink/ui';
import { SEARCH_HIT_TYPE_LABELS } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { LoadError } from '../pilotage-commun/components';
import { sortGroups, HIT_ICONS, HitStatus, hitHref, queryKind, useGlobalSearch } from './search';

const PREVIEW = 6;
const EXAMPLES = ['GL-10482', 'Mina Kitchen', 'contact@', '+33 6', 'SIRET', 'FA-2026'];

/** Recherche universelle, résultats complets groupés par type (cahier §2). */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [query, setQuery] = useState(initial);
  const [expanded, setExpanded] = useState<string[]>([]);
  useDocumentTitle(query.trim() ? `« ${query.trim()} » · Recherche · Ciyou Eats Admin` : 'Recherche · Ciyou Eats Admin');
  const { result, loading, error, settled } = useGlobalSearch(query, 20);
  const groups = sortGroups(result?.groups ?? [], query);
  const total = groups.reduce((s, g) => s + g.hits.length, 0);
  const kind = queryKind(query);

  useEffect(() => {
    const q = query.trim();
    if (q === (params.get('q') ?? '')) return;
    const next = new URLSearchParams(params);
    if (q) next.set('q', q);
    else next.delete('q');
    setParams(next, { replace: true });
  }, [query, params, setParams]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Recherche universelle"
        title="Recherche"
        description={
          <>
            Numéro de commande, nom, e-mail, téléphone, SIRET, numéro de facture ou de ticket. Raccourci <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> depuis n’importe quelle
            page.
          </>
        }
      />
      <div className="relative">
        <Input
          autoFocus
          size="lg"
          leading={<Search />}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setExpanded([]);
          }}
          placeholder="GL-10482, Mina Kitchen, jean.dupont@…, 06…, 812 345 678 00012"
          aria-label="Rechercher dans la plateforme"
        />
      </div>
      <p className="mt-2 min-h-5 text-xs text-fg-subtle">
        {query.trim().length < 2
          ? 'Saisissez au moins 2 caractères.'
          : loading
            ? `Recherche${kind ? ` par ${kind.toLowerCase()}` : ''}…`
            : result
              ? `${formatNumber(total)} résultat${total > 1 ? 's' : ''} en ${formatNumber(result.tookMs)} ms${kind ? ` · ${kind}` : ''}`
              : ''}
      </p>

      <div className="mt-4 space-y-4">
        {query.trim().length < 2 ? (
          <Card>
            <EmptyState
              icon={<Search />}
              title="Que cherchez-vous ?"
              description="Les résultats sont limités aux rubriques et aux villes de votre périmètre ; les coordonnées sont masquées sans le droit d’accès aux données personnelles."
              action={
                <div className="flex flex-wrap justify-center gap-1.5">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setQuery(example)}
                      className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-fg-muted hover:border-border-strong hover:text-fg"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              }
            />
          </Card>
        ) : error ? (
          <Card>
            <LoadError error={error} className="py-12" />
          </Card>
        ) : loading && !result ? (
          Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </Card>
          ))
        ) : settled && groups.length === 0 ? (
          <Card>
            <EmptyState
              icon={<SearchX />}
              title={`Aucun résultat pour « ${settled} »`}
              description="Vérifiez l’orthographe, ou cherchez par numéro de commande, e-mail ou téléphone complet."
            />
          </Card>
        ) : (
          groups.map((group) => (
            <Card key={group.type}>
              <CardHeader
                title={SEARCH_HIT_TYPE_LABELS[group.type]}
                icon={HIT_ICONS[group.type]}
                actions={<Badge>{formatNumber(group.hits.length)}</Badge>}
                divided
              />
              <ul className="divide-y divide-border">
                {(expanded.includes(group.type) ? group.hits : group.hits.slice(0, PREVIEW)).map((hit) => {
                  const href = hitHref(hit);
                  const body = (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{hit.title}</span>
                        <span className="block truncate text-xs text-fg-subtle">{[hit.subtitle, hit.matched].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <HitStatus type={hit.type} status={hit.status} />
                      {hit.at && <span className="hidden shrink-0 font-mono text-2xs text-fg-subtle sm:inline">{formatDateTime(new Date(hit.at))}</span>}
                      {href && <ChevronRight className="size-4 shrink-0 text-fg-subtle" />}
                    </>
                  );
                  return (
                    <li key={`${hit.type}-${hit.id}`}>
                      {href ? (
                        <Link to={href} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-5 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {group.hits.length > PREVIEW && !expanded.includes(group.type) && (
                <button
                  type="button"
                  onClick={() => setExpanded([...expanded, group.type])}
                  className="w-full border-t border-border px-5 py-2.5 text-center text-xs font-medium text-primary-soft-fg hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                >
                  Afficher les {formatNumber(group.hits.length)} résultats
                </button>
              )}
            </Card>
          ))
        )}
      </div>
    </PageContainer>
  );
}
