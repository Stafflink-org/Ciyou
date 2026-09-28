import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { orderBy, query } from 'firebase/firestore';
import { AlertTriangle, Download, Search, Wheat } from 'lucide-react';
import { Button, Card, EmptyState, Input, PageContainer, Skeleton, Tooltip, cn } from '@golink/ui';
import { ALLERGENS, ALLERGEN_LABELS, paths, type Product } from '@golink/shared';
import { useDocumentTitle } from '@golink/web';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';
import { downloadCsv } from '../_rh/export';
import { ErrorCard } from '../_rh/ui';
import { HaccpHeader } from './layout';

/** Tableau des 14 allergènes réglementaires, vue de la carte (source : fiches produits). */
export function AllergensPage() {
  useDocumentTitle('Allergènes · HACCP · Ciyou Eats Restaurant');
  const { restaurantId, restaurant } = useRestaurantAccess();
  const can = useCan();
  const products = useCollection<Product>(query(collectionAt(paths.restaurantSub(restaurantId, 'products')), orderBy('name')));
  const [search, setSearch] = useState('');
  const list = useMemo(
    () => products.data.filter((p) => !search || p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [products.data, search],
  );
  const undeclared = products.data.filter((p) => !p.allergensDeclared).length;

  function exportCsv() {
    downloadCsv(
      `allergenes-${restaurant.slug}`,
      products.data.map((p) => ({
        Produit: p.name,
        ...Object.fromEntries(ALLERGENS.map((a) => [ALLERGEN_LABELS[a], p.allergens.includes(a) ? 'Oui' : ''])),
        Déclaration: p.allergensDeclared ? 'Complète' : 'À compléter',
      })),
    );
  }

  return (
    <PageContainer wide>
      <HaccpHeader
        title="Allergènes"
        description="Les 14 allergènes réglementaires de chaque plat, tels que déclarés dans la carte. À afficher et à présenter sur demande."
        actions={
          <Button leftIcon={<Download />} onClick={exportCsv} disabled={products.data.length === 0}>
            Exporter
          </Button>
        }
      />
      {products.error && <ErrorCard error={products.error} />}
      {undeclared > 0 && (
        <div className="tone-amber mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-(--tone-border) bg-(--tone-bg) px-4 py-3 text-sm text-(--tone-fg)">
          <AlertTriangle className="size-4" />
          {undeclared} produit{undeclared > 1 ? 's' : ''} sans déclaration d’allergènes confirmée.
          {can('menu.edit') && (
            <Link to="/produits" className="font-medium underline underline-offset-2">
              Compléter la carte
            </Link>
          )}
        </div>
      )}
      <div className="mb-4 flex justify-end">
        <Input size="sm" leading={<Search />} placeholder="Rechercher un plat…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-72" aria-label="Rechercher un plat" />
      </div>
      <Card className="overflow-hidden">
        {products.loading ? (
          <Skeleton className="m-5 h-64" />
        ) : list.length === 0 ? (
          <EmptyState icon={<Wheat />} title="Aucun plat à afficher" description="Les allergènes proviennent des fiches produits de la carte." />
        ) : (
          <div data-scroll-ok className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th className="sticky left-0 z-30 border-b border-r border-border bg-surface-2 px-4 py-2 text-left eyebrow">Plat</th>
                  {ALLERGENS.map((a) => (
                    <th key={a} className="border-b border-border bg-surface-2 px-1 py-2 align-bottom">
                      <span className="mx-auto block w-4 whitespace-nowrap text-2xs font-medium text-fg-muted [writing-mode:vertical-rl] rotate-180">{ALLERGEN_LABELS[a]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((product) => (
                  <tr key={product.id} className="hover:bg-surface-2">
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-4 py-2 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-fg">{product.name}</span>
                        {!product.allergensDeclared && (
                          <Tooltip content="Déclaration à confirmer">
                            <AlertTriangle className="tone-amber size-3.5 shrink-0 text-(--tone-solid)" aria-label="Déclaration à confirmer" />
                          </Tooltip>
                        )}
                      </span>
                    </th>
                    {ALLERGENS.map((a) => {
                      const has = product.allergens.includes(a);
                      return (
                        <td key={a} className="border-b border-border px-1 py-2 text-center">
                          <span
                            aria-label={has ? `Contient : ${ALLERGEN_LABELS[a]}` : undefined}
                            className={cn('mx-auto block size-5 rounded-full', has ? 'tone-danger border border-(--tone-border) bg-(--tone-bg)' : '')}
                          >
                            {has && <span className="block text-center text-2xs font-bold leading-5 text-(--tone-fg)">●</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
