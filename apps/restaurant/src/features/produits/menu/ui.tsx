// Petits composants partagés par les écrans de la carte.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ImageOff, Plus, X } from 'lucide-react';
import { ALLERGENS, ALLERGEN_LABELS, MENU_LIMITS, type Allergen, type ImageRef, type MenuSchedule } from '@golink/shared';
import { Badge, cn, formatEUR, Input, toneClass, type Tone } from '@golink/ui';
import { DAY_INITIALS, DAY_LABELS, saleState, stockState, STOCK_STATE_META } from './helpers';

/** Vignette d'un produit ou d'une section, avec repli sobre sans photo. */
export function Thumb({ image, alt, className, size = 'md' }: { image?: ImageRef | null; alt: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-9 w-12', md: 'h-11 w-[58px]', lg: 'h-16 w-[86px]' } as const;
  const [failed, setFailed] = useState(false);
  const src = image?.thumbUrl || image?.url;
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-lg border border-border bg-surface-3', sizes[size], className)}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-fg-subtle" aria-label={`${alt} : pas de photo`} role="img">
          <ImageOff className="size-4" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/**
 * Prix affiché ; `suffix` marque un montant indicatif (vente au poids : « /kg » sur le prix de
 * référence, prix variable : « env. » avant le montant) pour ne jamais afficher un prix fixe trompeur.
 */
export function Price({ cents, className, suffix }: { cents: number; className?: string; suffix?: string }) {
  return (
    <span className={cn('num font-mono text-sm font-medium text-fg', className)}>
      {suffix === 'variable' && 'env. '}
      {formatEUR(cents, { cents: true })}
      {suffix === 'weight' && <span className="font-sans font-normal text-fg-subtle"> /kg</span>}
    </span>
  );
}

/** Libellé du mode de vente d'un produit, quand il n'est pas à l'unité. */
export function saleUnitSuffix(product: { saleUnit?: 'unit' | 'weight' | 'variable' }): 'weight' | 'variable' | undefined {
  return product.saleUnit === 'weight' ? 'weight' : product.saleUnit === 'variable' ? 'variable' : undefined;
}

/** Pastille ronde colorée + libellé (statut compact). */
export function Dot({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn(toneClass[tone], 'inline-flex items-center gap-1.5 text-xs font-medium text-(--tone-fg)', className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-(--tone-solid)" aria-hidden="true" />
      {children}
    </span>
  );
}

export function SaleBadge({ product }: { product: Parameters<typeof saleState>[0] }) {
  const state = saleState(product);
  return (
    <Badge tone={state.tone} size="sm">
      {state.label}
    </Badge>
  );
}

export function StockPill({ product }: { product: Parameters<typeof stockState>[0] }) {
  const state = stockState(product);
  const meta = STOCK_STATE_META[state];
  if (state === 'untracked') return <span className="text-xs text-fg-subtle">Non suivi</span>;
  return (
    <span className={cn(toneClass[meta.tone], 'num inline-flex items-center gap-1.5 rounded-md bg-(--tone-bg) px-1.5 py-0.5 font-mono text-xs font-medium text-(--tone-fg)')}>
      {product.stock}
      <span className="sr-only"> en stock, {meta.label.toLowerCase()}</span>
    </span>
  );
}

/** Sélecteur des 14 allergènes réglementaires (puces à bascule). */
export function AllergenPicker({ value, onChange, disabled }: { value: Allergen[]; onChange: (value: Allergen[]) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Allergènes présents" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {ALLERGENS.map((allergen) => {
        const active = value.includes(allergen);
        return (
          <button
            key={allergen}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(active ? value.filter((a) => a !== allergen) : [...value, allergen])}
            className={cn(
              'flex min-h-9 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
              active
                ? 'tone-amber border-(--tone-border) bg-(--tone-bg) font-medium text-(--tone-fg)'
                : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
            )}
          >
            <span className="truncate">{ALLERGEN_LABELS[allergen]}</span>
            <span
              aria-hidden="true"
              className={cn('grid size-4 shrink-0 place-items-center rounded-full border text-[9px]', active ? 'border-transparent bg-(--tone-solid) text-white' : 'border-border-strong')}
            >
              {active ? '✓' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Puces à bascule génériques (régimes, jours…). */
export function ToggleChips<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: Array<{ value: T; label: string }>;
  value: T[];
  onChange: (value: T[]) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(active ? value.filter((v) => v !== option.value) : [...value, option.value])}
            className={cn(
              'inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
              active ? 'border-primary bg-primary-soft font-medium text-primary-soft-fg' : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Saisie d'étiquettes (Entrée ou virgule pour valider). */
export function TagInput({ value, onChange, disabled, id }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean; id?: string }) {
  const [draft, setDraft] = useState('');
  function add() {
    const tag = draft.trim().replace(/,$/, '').slice(0, MENU_LIMITS.tagLength);
    if (!tag || value.some((t) => t.toLowerCase() === tag.toLowerCase()) || value.length >= MENU_LIMITS.tags) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  }
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Étiquettes">
          {value.map((tag) => (
            <li key={tag} className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 pl-2 pr-1 text-xs text-fg">
              {tag}
              {!disabled && (
                <button type="button" aria-label={`Retirer l’étiquette ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))} className="grid size-5 place-items-center rounded text-fg-subtle hover:bg-surface-3 hover:text-fg">
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        disabled={disabled || value.length >= MENU_LIMITS.tags}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        maxLength={MENU_LIMITS.tagLength + 1}
        placeholder={value.length >= MENU_LIMITS.tags ? `${MENU_LIMITS.tags} étiquettes au maximum` : 'Ex. best-seller, à partager… puis Entrée'}
        trailing={draft ? <Plus aria-hidden="true" /> : undefined}
      />
    </div>
  );
}

/** Créneaux de vente : jours + plage horaire. */
export function ScheduleEditor({
  value,
  onChange,
  disabled,
}: {
  value: MenuSchedule | null;
  onChange: (value: MenuSchedule | null) => void;
  disabled?: boolean;
}) {
  const enabled = value !== null;
  const schedule = value ?? { days: [0, 1, 2, 3, 4], from: '11:30', to: '14:30' };
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Disponibilité horaire" className="grid gap-2 sm:grid-cols-2">
        {[
          { key: false, title: 'Toute la journée', text: 'Pendant les horaires d’ouverture' },
          { key: true, title: 'Créneaux précis', text: 'Ex. formule du midi en semaine' },
        ].map((option) => (
          <button
            key={String(option.key)}
            type="button"
            role="radio"
            aria-checked={enabled === option.key}
            disabled={disabled}
            onClick={() => onChange(option.key ? schedule : null)}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
              enabled === option.key ? 'border-primary bg-primary-soft/60' : 'border-border bg-surface hover:border-border-strong',
            )}
          >
            <span className="block text-sm font-medium text-fg">{option.title}</span>
            <span className="block text-xs text-fg-subtle">{option.text}</span>
          </button>
        ))}
      </div>
      {enabled && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
          <div role="group" aria-label="Jours" className="flex flex-wrap gap-1.5">
            {DAY_INITIALS.map((initial, day) => {
              const active = schedule.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  aria-label={DAY_LABELS[day]}
                  title={DAY_LABELS[day]}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ ...schedule, days: active ? schedule.days.filter((d) => d !== day) : [...schedule.days, day].sort((a, b) => a - b) })
                  }
                  className={cn(
                    'grid size-9 place-items-center rounded-lg border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                    active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-fg-muted hover:text-fg',
                  )}
                >
                  {initial}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>De</span>
            <Input
              type="time"
              aria-label="Heure de début"
              value={schedule.from}
              disabled={disabled}
              onChange={(event) => onChange({ ...schedule, from: event.target.value })}
              className="w-[7.5rem]"
            />
            <span>à</span>
            <Input
              type="time"
              aria-label="Heure de fin"
              value={schedule.to}
              disabled={disabled}
              onChange={(event) => onChange({ ...schedule, to: event.target.value })}
              className="w-[7.5rem]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Bloc de page « carte » : titre, description, contenu. */
export function Panel({ title, description, actions, children, className, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('rounded-xl border border-border bg-surface shadow-card', className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-md font-semibold tracking-tight text-fg">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
