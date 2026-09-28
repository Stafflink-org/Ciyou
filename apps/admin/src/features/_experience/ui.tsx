// Briques d'interface partagées par les rubriques Affichage, Avis et Support.
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, Bold, Eye, Heading2, Heading3, Italic, Link2, List, ListOrdered, PencilLine, Quote, RotateCw, Star } from 'lucide-react';
import { Button, Card, EmptyState, IconButton, Tooltip, cn } from '@golink/ui';
import { parseRichText, type RichBlock, type RichInline } from '@golink/shared';
import { errorMessage } from '@/lib/firestore';

// ------------------------------------------------------------------ Navigation par onglets

export interface SubNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  count?: number | null;
  end?: boolean;
  hidden?: boolean;
}

/** Onglets de navigation d'une rubrique (liens, historique du navigateur conservé). */
export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
  return (
    <nav data-scroll-ok aria-label="Sections de la rubrique" className={cn('-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]', className)}>
      <ul className="flex min-w-max items-center gap-1 border-b border-border">
        {items.filter((i) => !i.hidden).map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors [&_svg]:size-4',
                  isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                )
              }
            >
              {item.icon}
              {item.label}
              {item.count ? (
                <span className="rounded-full bg-surface-3 px-1.5 py-px font-mono text-2xs text-fg-muted num">{item.count}</span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ------------------------------------------------------------------ États

export function LoadError({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={<AlertTriangle />}
      title="Chargement impossible"
      description={errorMessage(error)}
      action={onRetry ? <Button size="sm" leftIcon={<RotateCw />} onClick={onRetry}>Réessayer</Button> : undefined}
    />
  );
}

export function Panel({ title, description, actions, children, className, bodyClassName }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn('min-w-0', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="font-display text-md font-semibold tracking-tight text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </Card>
  );
}

export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="min-w-0 max-w-[55%] [overflow-wrap:anywhere] text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{children}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ Notes

export function Stars({ value, size = 'sm', className }: { value: number; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span className={cn('tone-amber inline-flex items-center gap-0.5', className)} role="img" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(size === 'sm' ? 'size-3.5' : 'size-4.5', n <= Math.round(value) ? 'fill-(--tone-solid) text-(--tone-solid)' : 'fill-transparent text-fg-subtle/50')}
          strokeWidth={1.75}
        />
      ))}
    </span>
  );
}

export function ratingTone(value: number | null | undefined): 'success' | 'amber' | 'danger' | 'neutral' {
  if (value === null || value === undefined || value === 0) return 'neutral';
  if (value >= 4.3) return 'success';
  if (value >= 3.5) return 'amber';
  return 'danger';
}

// ------------------------------------------------------------------ Texte enrichi

function Inline({ nodes }: { nodes: RichInline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'break':
            return <br key={i} />;
          case 'strong':
            return <strong key={i} className="font-semibold text-fg"><Inline nodes={node.children} /></strong>;
          case 'em':
            return <em key={i}><Inline nodes={node.children} /></em>;
          case 'link':
            return (
              <a key={i} href={node.href} target="_blank" rel="noreferrer noopener" className="text-primary-soft-fg underline underline-offset-2">
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: RichBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 2
        ? <h2 className="mt-6 font-display text-lg font-semibold tracking-tight text-fg first:mt-0"><Inline nodes={block.children} /></h2>
        : <h3 className="mt-5 text-md font-semibold text-fg first:mt-0"><Inline nodes={block.children} /></h3>;
    case 'paragraph':
      return <p className="mt-3 first:mt-0"><Inline nodes={block.children} /></p>;
    case 'quote':
      return <blockquote className="tone-info mt-3 rounded-lg border-l-2 border-(--tone-solid) bg-(--tone-bg) px-4 py-2 text-(--tone-fg)"><Inline nodes={block.children} /></blockquote>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('mt-3 space-y-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, i) => <li key={i}><Inline nodes={item} /></li>)}
        </Tag>
      );
    }
  }
}

/** Rendu sûr du texte enrichi (aucun HTML interprété). */
export function RichText({ source, className }: { source: string | null | undefined; className?: string }) {
  const blocks = parseRichText(source);
  if (blocks.length === 0) return <p className={cn('text-sm text-fg-subtle', className)}>Aucun contenu.</p>;
  return (
    <div className={cn('text-sm leading-relaxed text-fg-muted [overflow-wrap:anywhere]', className)}>
      {blocks.map((block, i) => <Block key={i} block={block} />)}
    </div>
  );
}

type Wrap = { before: string; after?: string; line?: boolean; placeholder: string };

const TOOLS: Array<{ label: string; icon: ReactNode; wrap: Wrap }> = [
  { label: 'Titre', icon: <Heading2 />, wrap: { before: '## ', line: true, placeholder: 'Titre de section' } },
  { label: 'Sous-titre', icon: <Heading3 />, wrap: { before: '### ', line: true, placeholder: 'Sous-titre' } },
  { label: 'Gras', icon: <Bold />, wrap: { before: '**', after: '**', placeholder: 'texte en gras' } },
  { label: 'Italique', icon: <Italic />, wrap: { before: '*', after: '*', placeholder: 'texte en italique' } },
  { label: 'Lien', icon: <Link2 />, wrap: { before: '[', after: '](https://)', placeholder: 'texte du lien' } },
  { label: 'Liste à puces', icon: <List />, wrap: { before: '- ', line: true, placeholder: 'élément' } },
  { label: 'Liste numérotée', icon: <ListOrdered />, wrap: { before: '1. ', line: true, placeholder: 'étape' } },
  { label: 'Encadré', icon: <Quote />, wrap: { before: '> ', line: true, placeholder: 'information importante' } },
];

/**
 * Éditeur de texte enrichi : barre de mise en forme, raccourcis ⌘B / ⌘I,
 * aperçu fidèle au rendu des applications.
 */
export function RichTextEditor({
  value,
  onChange,
  minRows = 12,
  placeholder = 'Rédigez le contenu…',
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function apply(wrap: Wrap) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || wrap.placeholder;
    let insert: string;
    if (wrap.line) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const prefix = start === lineStart ? '' : '\n';
      insert = `${prefix}${selected.split('\n').map((l) => `${wrap.before}${l}`).join('\n')}`;
    } else {
      insert = `${wrap.before}${selected}${wrap.after ?? ''}`;
    }
    const next = value.slice(0, start) + insert + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + insert.length - (wrap.after?.length ?? 0);
      el.setSelectionRange(wrap.line ? start + insert.length : cursor - selected.length, wrap.line ? start + insert.length : cursor);
    });
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xs focus-within:border-primary/60', disabled && 'opacity-60')}>
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-surface-2 px-1.5 py-1 [scrollbar-width:none]">
        {TOOLS.map((tool) => (
          <Tooltip key={tool.label} content={tool.label}>
            <IconButton type="button" variant="ghost" size="sm" label={tool.label} disabled={disabled || preview} onClick={() => apply(tool.wrap)}>
              {tool.icon}
            </IconButton>
          </Tooltip>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Button type="button" variant="ghost" size="xs" leftIcon={preview ? <PencilLine /> : <Eye />} onClick={() => setPreview((p) => !p)} className="ml-auto shrink-0">
          {preview ? 'Modifier' : 'Aperçu'}
        </Button>
      </div>
      {preview ? (
        <div className="max-h-[60vh] min-h-48 overflow-y-auto px-4 py-3">
          <RichText source={value} />
        </div>
      ) : (
        <textarea
          ref={ref}
          id={id}
          aria-label={ariaLabel}
          value={value}
          disabled={disabled}
          rows={minRows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (e.key === 'b') { e.preventDefault(); apply(TOOLS[2]!.wrap); }
            if (e.key === 'i') { e.preventDefault(); apply(TOOLS[3]!.wrap); }
          }}
          className="block w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle"
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Divers

export function Kpi({ label, value, hint, tone = 'neutral', icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'success' | 'amber' | 'danger' | 'info' | 'brand'; icon?: ReactNode }) {
  return (
    <div className={cn(`tone-${tone}`, 'min-w-0 rounded-xl border border-border bg-surface px-4 py-3 shadow-card')}>
      <div className="flex items-center gap-2 text-xs text-fg-muted [&_svg]:size-3.5 [&_svg]:text-(--tone-solid)">{icon}{label}</div>
      <div className="mt-1 truncate font-display text-2xl font-semibold tracking-display text-fg num">{value}</div>
      {hint && <div className="mt-0.5 truncate text-2xs text-fg-subtle">{hint}</div>}
    </div>
  );
}
