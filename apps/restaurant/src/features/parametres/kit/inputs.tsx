// Champs spécialisés : montants en euros (stockés en centimes), entiers avec unité,
// listes de valeurs (mots-clés, e-mails, numéros) sous forme de puces.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input, cn } from '@golink/ui';

const euro = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function centsToText(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : euro.format(cents / 100).replace(/ | /g, ' ');
}

/** « 12,5 » ou « 12.50 » → 1250 ; null si vide ; NaN si illisible. */
export function parseEuroText(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Montant saisi en euros (virgule ou point), stocké en centimes. La saisie brute
 * est conservée pendant la frappe : aucune valeur n'est réécrite sous les doigts.
 */
export function MoneyInput({
  value,
  onChange,
  nullable,
  id,
  invalid,
  placeholder,
  disabled,
  className,
  ...aria
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  nullable?: boolean;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(centsToText(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(centsToText(value));
  }, [value, focused]);

  const parsed = parseEuroText(text);
  const bad = Number.isNaN(parsed) || (!nullable && parsed === null);

  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      value={text}
      placeholder={placeholder ?? (nullable ? 'Aucun' : '0,00')}
      disabled={disabled}
      invalid={invalid || (bad && text !== '')}
      trailing={<span className="font-mono">€</span>}
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const next = parseEuroText(text);
        if (next === null && !nullable) setText(centsToText(value));
        else if (!Number.isNaN(next)) setText(centsToText(next));
      }}
      onChange={(event) => {
        setText(event.target.value);
        const next = parseEuroText(event.target.value);
        if (next === null ? nullable : !Number.isNaN(next)) onChange(next);
      }}
      {...aria}
    />
  );
}

/** Entier borné avec unité (minutes, commandes, jours…). */
export function IntegerInput({
  value,
  onChange,
  min,
  max,
  unit,
  id,
  invalid,
  disabled,
  className,
  nullable,
  placeholder,
  ...aria
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  unit?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  nullable?: boolean;
  placeholder?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? '' : String(value));
  }, [value, focused]);
  const number = text === '' ? null : Number(text);
  const outOfRange = number !== null && (!Number.isInteger(number) || number < min || number > max);

  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      invalid={invalid || outOfRange || (!nullable && text === '' && !focused)}
      trailing={unit ? <span className="font-mono">{unit}</span> : undefined}
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (text === '') {
          if (!nullable) setText(value === null ? '' : String(value));
          return;
        }
        const clamped = Math.min(max, Math.max(min, Math.round(Number(text) || 0)));
        setText(String(clamped));
        onChange(clamped);
      }}
      onChange={(event) => {
        const raw = event.target.value.replace(/[^\d]/g, '');
        setText(raw);
        if (raw === '') {
          if (nullable) onChange(null);
          return;
        }
        const next = Number(raw);
        if (next >= min && next <= max) onChange(next);
      }}
      {...aria}
    />
  );
}

/** Liste de valeurs en puces : Entrée ou virgule pour ajouter, retour arrière pour retirer. */
export function ChipsInput({
  values,
  onChange,
  placeholder,
  max,
  validate,
  id,
  invalid,
  disabled,
  inputMode,
  ...aria
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  max?: number;
  /** Renvoie un message d'erreur si la valeur est refusée. */
  validate?: (value: string) => string | null;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'email' | 'tel';
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = max !== undefined && values.length >= max;

  const commit = () => {
    const value = text.trim().replace(/,$/, '');
    if (!value) return;
    const problem = validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setError('Déjà dans la liste.');
      return;
    }
    onChange([...values, value]);
    setText('');
    setError(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <div
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 shadow-xs transition-colors',
          'focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/20',
          invalid || error ? 'border-danger' : 'border-border-strong',
          disabled && 'opacity-60',
        )}
      >
        {values.map((value) => (
          <span key={value} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-surface-3 pl-2 pr-1 text-xs font-medium text-fg">
            <span className="truncate">{value}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="grid size-4 place-items-center rounded text-fg-subtle hover:bg-surface-2 hover:text-fg"
                aria-label={`Retirer ${value}`}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!full && !disabled && (
          <input
            id={id}
            value={text}
            inputMode={inputMode}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            onBlur={commit}
            placeholder={values.length === 0 ? placeholder : 'Ajouter…'}
            className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
            {...aria}
          />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-danger-soft-fg">{error}</p>}
    </div>
  );
}
