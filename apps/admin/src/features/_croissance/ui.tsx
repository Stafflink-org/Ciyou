// Composants communs des rubriques Croissance : onglets de rubrique, champs
// monétaires et pourcentages, date + heure, puces de choix, états.
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, Check, Lock } from 'lucide-react';
import { Button, Card, DatePicker, EmptyState, Input, TimeInput, cn } from '@golink/ui';
import { errorMessage } from '@/lib/firestore';

export interface RouteTab {
  to: string;
  label: string;
  end?: boolean;
  count?: number | null;
  hidden?: boolean;
}

/** Onglets de navigation entre les pages d'une rubrique (défilent horizontalement sur mobile). */
export function RouteTabs({ tabs, className }: { tabs: RouteTab[]; className?: string }) {
  return (
    <nav data-scroll-ok aria-label="Sections de la rubrique" className={cn('-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0', className)}>
      <ul className="flex min-w-max items-center gap-1 border-b border-border">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                    isActive ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
                  )
                }
              >
                {t.label}
                {t.count ? <span className="tone-brand num rounded-full bg-(--tone-bg) px-1.5 py-px font-mono text-2xs text-(--tone-fg)">{t.count}</span> : null}
              </NavLink>
            </li>
          ))}
      </ul>
    </nav>
  );
}

/** Erreur de chargement lisible, avec la suite à donner. */
export function LoadError({ error, compact }: { error: unknown; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={<AlertTriangle />}
      title="Chargement impossible"
      description={errorMessage(error, 'Les données n’ont pas pu être chargées. Vérifiez votre connexion puis rechargez la page.')}
      action={
        <Button size="sm" onClick={() => window.location.reload()}>
          Recharger
        </Button>
      }
    />
  );
}

/** Rubrique accessible mais action réservée : explication plutôt qu'un bouton qui échoue. */
export function RestrictedCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <EmptyState compact icon={<Lock />} title={title} description={description} />
    </Card>
  );
}

/** Ligne libellé / valeur d'une fiche. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2.5 text-sm', className)}>
      <dt className="min-w-0 max-w-[55%] [overflow-wrap:anywhere] text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatDecimal(n: number | null, digits = 2): string {
  if (n === null) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits, useGrouping: false });
}

/** Montant saisi en euros, stocké en centimes (null = vide). */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  invalid,
  ...aria
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(() => formatDecimal(value === null ? null : value / 100));
  useEffect(() => {
    const parsed = parseDecimal(text);
    const cents = parsed === null ? null : Math.round(parsed * 100);
    if (cents !== value) setText(formatDecimal(value === null ? null : value / 100));
    // Synchronise seulement quand la valeur change de l'extérieur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder}
      trailing={<span className="font-mono text-xs text-fg-subtle">€</span>}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseDecimal(e.target.value);
        onChange(parsed === null ? null : Math.max(0, Math.round(parsed * 100)));
      }}
      {...aria}
    />
  );
}

/** Nombre entier ou décimal avec unité (%, jours, points…). */
export function NumberInput({
  value,
  onChange,
  unit,
  id,
  decimals = 0,
  placeholder,
  disabled,
  invalid,
  ...aria
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  id?: string;
  decimals?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(() => formatDecimal(value, decimals));
  useEffect(() => {
    if (parseDecimal(text) !== value) setText(formatDecimal(value, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      inputMode={decimals ? 'decimal' : 'numeric'}
      value={text}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder}
      trailing={unit ? <span className="font-mono text-xs text-fg-subtle">{unit}</span> : undefined}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseDecimal(e.target.value);
        onChange(parsed === null ? null : decimals ? parsed : Math.round(parsed));
      }}
      {...aria}
    />
  );
}

/** Date + heure (heure de l'appareil), valeur en millisecondes. */
export function DateTimeField({
  value,
  onChange,
  minDate,
  placeholder = 'Choisir une date',
}: {
  value: number | null;
  onChange: (ms: number | null) => void;
  minDate?: Date;
  placeholder?: string;
}) {
  const date = value ? new Date(value) : undefined;
  const time = date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '10:00';
  const combine = (d: Date | undefined, t: string) => {
    if (!d) return onChange(null);
    const [h, m] = t.split(':').map(Number);
    const next = new Date(d);
    next.setHours(h ?? 0, m ?? 0, 0, 0);
    onChange(next.getTime());
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <DatePicker value={date} onChange={(d) => combine(d, time)} placeholder={placeholder} disabledDays={minDate ? { before: minDate } : undefined} />
      <TimeInput value={time} onChange={(t) => combine(date ?? new Date(), t)} step={15} aria-label="Heure" />
    </div>
  );
}

export interface ChipOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

/** Choix multiple sous forme de puces (canaux, modes de commande, formules…). */
export function ChipGroup<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChipOption<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors [&_svg]:size-3.5 disabled:opacity-50',
              on ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border-strong bg-surface text-fg-muted hover:text-fg',
            )}
          >
            {on ? <Check /> : o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Carte de réglage : titre, description, contenu. */
export function SettingsBlock({ icon, title, description, children, aside }: { icon?: ReactNode; title: string; description?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-fg-muted [&_svg]:size-[18px]">{icon}</div>}
          <div className="min-w-0">
            <h3 className="font-display text-md font-semibold tracking-tight text-fg">{title}</h3>
            {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="space-y-4 px-5 py-5">{children}</div>
    </Card>
  );
}
