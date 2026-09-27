// Champs numériques des réglages : montants (saisis en euros, stockés en centimes),
// nombres avec unité, distances (saisies en km, stockées en mètres), pourcentages.
import { useEffect, useState } from 'react';
import { Input } from '@golink/ui';

function parseDecimal(value: string): number | null {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function display(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined) return '';
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: decimals, useGrouping: false });
}

interface BaseProps {
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
}

/** Champ décimal générique (valeur affichée ↔ valeur stockée via un facteur). */
function ScaledInput({ value, onChange, factor, decimals, unit, min, max, ...rest }: BaseProps & { value: number | null | undefined; onChange: (value: number | null) => void; factor: number; decimals: number; unit: string; min?: number; max?: number }) {
  const [text, setText] = useState(() => display(value === null || value === undefined ? null : value / factor, decimals));
  useEffect(() => {
    const current = parseDecimal(text);
    const external = value === null || value === undefined ? null : value / factor;
    if (current === null ? external !== null : Math.abs(current - (external ?? NaN)) > 1e-9) setText(display(external, decimals));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      {...rest}
      inputMode="decimal"
      value={text}
      trailing={<span className="font-mono text-xs text-fg-subtle">{unit}</span>}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseDecimal(e.target.value);
        if (parsed === null) return onChange(null);
        const precision = factor === 1 ? 10 ** decimals : 1;
        let scaled = Math.round(parsed * factor * precision) / precision;
        if (min !== undefined) scaled = Math.max(min, scaled);
        if (max !== undefined) scaled = Math.min(max, scaled);
        onChange(scaled);
      }}
      onBlur={() => setText(display(value === null || value === undefined ? null : value / factor, decimals))}
    />
  );
}

/** Montant en euros ; valeur en centimes. */
export function EuroInput(props: BaseProps & { value: number | null | undefined; onChange: (cents: number | null) => void; max?: number }) {
  return <ScaledInput {...props} factor={100} decimals={2} unit="€" min={0} />;
}

/** Distance en kilomètres ; valeur en mètres. */
export function KmInput(props: BaseProps & { value: number | null | undefined; onChange: (meters: number | null) => void; max?: number }) {
  return <ScaledInput {...props} factor={1000} decimals={2} unit="km" min={0} />;
}

/** Nombre entier avec unité. */
export function UnitInput(props: BaseProps & { value: number | null | undefined; onChange: (value: number | null) => void; unit: string; min?: number; max?: number; decimals?: number }) {
  const { decimals = 0, ...rest } = props;
  return <ScaledInput {...rest} factor={1} decimals={decimals} />;
}

/** Pourcentage ; valeur en points de base (10 000 = 100 %). */
export function PercentInput(props: BaseProps & { value: number | null | undefined; onChange: (bps: number | null) => void; max?: number }) {
  return <ScaledInput {...props} factor={100} decimals={2} unit="%" min={0} max={props.max ?? 10_000} />;
}
