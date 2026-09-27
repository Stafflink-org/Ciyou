import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Avatar as AvatarPrimitive, Progress as ProgressPrimitive, Tabs as TabsPrimitive, ToggleGroup } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { initials } from '../lib/format';
import { toneClass, type Tone } from '../lib/tones';

/* ----------------------------------------------------------------- Avatar */

const avatarSizes = {
  xs: 'size-6 text-3xs',
  sm: 'size-8 text-2xs',
  md: 'size-9 text-xs',
  lg: 'size-11 text-sm',
  xl: 'size-14 text-base',
} as const;

const avatarTones: Tone[] = ['brand', 'teal', 'amber', 'plum', 'info', 'success'];

function toneFromName(name: string): Tone {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return avatarTones[hash % avatarTones.length] ?? 'brand';
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof avatarSizes;
  /** Carré arrondi (restaurants, marques) plutôt que rond (personnes). */
  square?: boolean;
  /** Pastille de présence. */
  status?: 'online' | 'busy' | 'offline';
  className?: string;
}

export function Avatar({ name, src, size = 'md', square, status, className }: AvatarProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <AvatarPrimitive.Root
        className={cn(
          toneClass[toneFromName(name)],
          'inline-flex items-center justify-center overflow-hidden bg-(--tone-bg) font-semibold text-(--tone-fg) select-none',
          square ? 'rounded-lg' : 'rounded-full',
          avatarSizes[size],
        )}
      >
        {src && <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />}
        <AvatarPrimitive.Fallback delayMs={src ? 300 : 0}>{initials(name)}</AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {status && (
        <span
          aria-label={status === 'online' ? 'En ligne' : status === 'busy' ? 'Occupé' : 'Hors ligne'}
          className={cn(
            'absolute bottom-0 end-0 size-2.5 rounded-full ring-2 ring-surface',
            status === 'online' && 'bg-success',
            status === 'busy' && 'bg-warning',
            status === 'offline' && 'bg-fg-subtle',
          )}
        />
      )}
    </span>
  );
}

/** Pile d'avatars avec compteur de débordement. */
export function AvatarGroup({ names, max = 4, size = 'sm' }: { names: string[]; max?: number; size?: AvatarProps['size'] }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((name) => (
        <Avatar key={name} name={name} size={size} className="rounded-full ring-2 ring-surface" />
      ))}
      {rest > 0 && (
        <span className={cn('grid place-items-center rounded-full bg-surface-3 font-medium text-fg-muted ring-2 ring-surface', avatarSizes[size ?? 'sm'])}>
          +{rest}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Tabs */

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-scroll-ok
      className={cn('flex items-center gap-5 overflow-x-auto border-b border-border [scrollbar-width:none]', className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  count?: number;
  icon?: ReactNode;
}

export function TabsTrigger({ className, count, icon, children, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative -mb-px flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent text-sm font-medium text-fg-muted transition-colors',
        'hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-surface-3 px-1.5 py-px font-mono text-2xs text-fg-muted num">{count}</span>
      )}
    </TabsPrimitive.Trigger>
  );
}

/* ------------------------------------------------------- SegmentedControl */

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

export interface SegmentedControlProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/** Sélecteur exclusif compact (période, vue liste/carte…). */
export function SegmentedControl({ value, onValueChange, options, size = 'md', className, ...aria }: SegmentedControlProps) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next)}
      className={cn('inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5', className)}
      {...aria}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium text-fg-muted transition-[background-color,color,box-shadow] duration-150',
            'hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-sm',
            'dark:data-[state=on]:bg-surface-3',
            'focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-3.5',
            size === 'md' ? 'h-7 px-3 text-sm' : 'h-6 px-2.5 text-xs',
          )}
        >
          {option.icon}
          {option.label}
          {option.count !== undefined && <span className="font-mono text-2xs text-fg-subtle num">{option.count}</span>}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

/* ---------------------------------------------------------------- Progress */

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: Tone;
  size?: 'sm' | 'md';
  label?: ReactNode;
  /** Valeur affichée à droite du libellé. */
  valueLabel?: ReactNode;
  className?: string;
}

export function ProgressBar({ value, max = 100, tone = 'brand', size = 'md', label, valueLabel, className }: ProgressBarProps) {
  const ratio = Math.min(Math.max(value / max, 0), 1);
  return (
    <div className={cn(toneClass[tone], 'w-full', className)}>
      {(label || valueLabel) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-fg-muted">{label}</span>
          <span className="font-mono text-fg num">{valueLabel}</span>
        </div>
      )}
      <ProgressPrimitive.Root
        value={value}
        max={max}
        className={cn('relative w-full overflow-hidden rounded-full bg-surface-3', size === 'md' ? 'h-2' : 'h-1.5')}
      >
        <ProgressPrimitive.Indicator
          className="h-full rounded-full bg-(--tone-solid) transition-[width] duration-500 ease-out"
          style={{ width: `${ratio * 100}%` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md bg-[linear-gradient(90deg,var(--gl-surface-3)_0%,var(--gl-surface-2)_50%,var(--gl-surface-3)_100%)] bg-size-[200%_100%] animate-shimmer',
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------- EmptyState */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** « compact » pour l'intérieur d'un tableau ou d'une carte. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, compact, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-6 py-10' : 'px-6 py-16', className)}>
      {icon && (
        <div className="relative mb-4">
          <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary-soft blur-xl" />
          <div className="grid size-12 place-items-center rounded-2xl border border-border bg-surface text-fg-muted shadow-sm [&_svg]:size-5">
            {icon}
          </div>
        </div>
      )}
      <p className="font-display text-md font-semibold tracking-tight text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------- PageHeader & co */

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Fil d’Ariane" className={cn('flex items-center gap-1 text-xs text-fg-subtle', className)}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const content =
          item.href && !last ? (
            <a href={item.href} onClick={item.onClick} className="transition-colors hover:text-fg">
              {item.label}
            </a>
          ) : (
            <span className={cn(last && 'text-fg-muted')} aria-current={last ? 'page' : undefined}>
              {item.label}
            </span>
          );
        return (
          <span key={index} className="flex items-center gap-1">
            {content}
            {!last && <ChevronRight className="size-3 rtl:-scale-x-100" />}
          </span>
        );
      })}
    </nav>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  /** Contenu sous le titre (onglets, filtres). */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, breadcrumbs, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6 space-y-4', className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 basis-72">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="font-display text-2xl font-semibold tracking-display text-fg sm:text-[1.75rem] sm:leading-9">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-md text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export interface SectionProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function Section({ title, description, actions, className, children, ...props }: SectionProps) {
  return (
    <section className={cn('space-y-4', className)} {...props}>
      {(title || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && <h2 className="font-display text-lg font-semibold tracking-tight text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- Timeline */

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  time?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative', className)}>
      {items.map((item, index) => (
        <li key={item.id} className={cn(toneClass[item.tone ?? 'neutral'], 'relative flex gap-3.5 pb-5 last:pb-0')}>
          {index < items.length - 1 && <span aria-hidden="true" className="absolute start-[13px] top-7 bottom-0 w-px bg-border" />}
          <span className="relative z-10 grid size-[27px] shrink-0 place-items-center rounded-full border border-(--tone-border) bg-(--tone-bg) text-(--tone-fg) [&_svg]:size-3.5">
            {item.icon ?? <span className="size-1.5 rounded-full bg-(--tone-solid)" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-fg">{item.title}</p>
              {item.time && <span className="font-mono text-2xs text-fg-subtle">{item.time}</span>}
            </div>
            {item.description && <p className="mt-0.5 text-sm text-fg-muted">{item.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------------- Stepper */

export interface StepperStep {
  id: string;
  label: ReactNode;
  description?: ReactNode;
}

/** Étapes d'un parcours (inscription restaurant, suivi de commande…). */
export function Stepper({
  steps,
  current,
  orientation = 'horizontal',
  className,
}: {
  steps: StepperStep[];
  /** Index de l'étape en cours (0-based). */
  current: number;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  const vertical = orientation === 'vertical';
  return (
    <ol className={cn(vertical ? 'flex flex-col gap-0' : 'flex items-start', className)}>
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        const last = index === steps.length - 1;
        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn('relative flex', vertical ? 'gap-3 pb-6 last:pb-0' : 'flex-1 flex-col items-center text-center last:flex-none sm:last:flex-1')}
          >
            {!last && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute',
                  vertical ? 'start-[13px] top-8 bottom-1 w-px' : 'start-[calc(50%+18px)] end-[calc(-50%+18px)] top-[13px] h-px',
                  index < current ? 'bg-primary' : 'bg-border-strong',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors',
                state === 'done' && 'border-primary bg-primary text-primary-fg',
                state === 'current' && 'border-primary bg-surface text-primary-soft-fg ring-4 ring-primary/15',
                state === 'todo' && 'border-border-strong bg-surface text-fg-subtle',
              )}
            >
              {state === 'done' ? <Check className="size-3.5 stroke-3" /> : index + 1}
            </span>
            <div className={cn(vertical ? 'pt-1' : 'mt-2 hidden px-2 sm:block')}>
              <p className={cn('text-sm font-medium', state === 'todo' ? 'text-fg-subtle' : 'text-fg')}>{step.label}</p>
              {step.description && <p className="mt-0.5 text-xs text-fg-subtle">{step.description}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------- Kbd */

export function Kbd({ className, ...props }: ComponentPropsWithoutRef<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-2 px-1 font-mono text-3xs font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}
