// Réponses types de l'établissement : lecture, sélecteur réutilisé par les avis et la messagerie.
import { useMemo, useState } from 'react';
import { orderBy, query } from 'firebase/firestore';
import { FileText, Search } from 'lucide-react';
import { Button, EmptyState, Input, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@golink/ui';
import {
  paths,
  renderMessageTemplate,
  type MessageVariable,
  type ReplyTemplate,
  type ReplyTemplateKind,
  type WithId,
} from '@golink/shared';
import { useCan, useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, useCollection } from '@/lib/firestore';

export type TemplateRow = WithId<ReplyTemplate>;

export function useReplyTemplates() {
  const { restaurantId } = useRestaurantAccess();
  const can = useCan();
  const allowed = can('marketing.manage') || can('reviews.reply') || can('messages.use');
  return useCollection<ReplyTemplate>(allowed ? query(collectionAt(paths.restaurantSub(restaurantId, 'replyTemplates')), orderBy('title')) : null);
}

/** Sélecteur de réponse type : filtre par usage (et par note pour les avis), variables remplacées. */
export function TemplatePicker({
  kind,
  rating,
  variables,
  onPick,
  label = 'Réponses types',
}: {
  kind: ReplyTemplateKind;
  rating?: number;
  variables: Partial<Record<MessageVariable, string>>;
  onPick: (text: string, templateId: string) => void;
  label?: string;
}) {
  const templates = useReplyTemplates();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return templates.data
      .filter((t) => t.kind === kind)
      .filter((t) => !needle || `${t.title} ${t.body} ${t.shortcut ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const fa = rating !== undefined && a.ratings.includes(rating) ? 0 : 1;
        const fb = rating !== undefined && b.ratings.includes(rating) ? 0 : 1;
        return fa - fb || b.usageCount - a.usageCount;
      });
  }, [templates.data, kind, rating, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" leftIcon={<FileText />}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-border p-2">
          <Input size="sm" leading={<Search />} placeholder="Rechercher une réponse…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {templates.loading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : list.length === 0 ? (
            <EmptyState compact icon={<FileText />} title="Aucune réponse type" description="Créez-en dans Marketing › Modèles." className="py-6" />
          ) : (
            list.map((t) => (
              <button
                key={t.id}
                type="button"
                className="block w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
                onClick={() => {
                  onPick(renderMessageTemplate(t.body, variables), t.id);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{t.title}</span>
                  {rating !== undefined && t.ratings.includes(rating) && <span className="shrink-0 text-2xs font-medium text-primary-soft-fg">Suggérée</span>}
                </span>
                <span className="line-clamp-2 text-xs text-fg-muted">{t.body}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
