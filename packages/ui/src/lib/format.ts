// Formateurs fr-FR partagés (montants en euros, nombres, dates).

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurCompact = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const dateShort = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/** Montant en euros ; `cents` = true si la valeur est exprimée en centimes. */
export function formatEUR(value: number, options: { cents?: boolean; compact?: boolean } = {}): string {
  const amount = options.cents ? value / 100 : value;
  return (options.compact ? eurCompact : eur).format(amount);
}

export function formatNumber(value: number, options: { compact?: boolean; decimals?: boolean } = {}): string {
  if (options.compact) return compact.format(value);
  return (options.decimals ? decimal : integer).format(value);
}

/** Pourcentage : 0.125 → « 12,5 % ». */
export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

export function formatDate(date: Date | number): string {
  return dateShort.format(date);
}

export function formatDateTime(date: Date | number): string {
  return dateTime.format(date);
}

export function formatTime(date: Date | number): string {
  return time.format(date);
}

/** Durée relative courte : « il y a 5 minutes », « demain ». */
export function formatRelative(date: Date | number, now: Date | number = Date.now()): string {
  const diff = (typeof date === 'number' ? date : date.getTime()) - (typeof now === 'number' ? now : now.getTime());
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'à l’instant';
  if (abs < hour) return relative.format(Math.round(diff / minute), 'minute');
  if (abs < day) return relative.format(Math.round(diff / hour), 'hour');
  if (abs < 30 * day) return relative.format(Math.round(diff / day), 'day');
  return formatDate(date);
}

/** Initiales d'un nom : « Mina Kitchen » → « MK ». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  return `${first.charAt(0)}${last.charAt(0) || first.charAt(1)}`.toUpperCase();
}
