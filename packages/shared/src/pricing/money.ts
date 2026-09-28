// Arithmétique monétaire en centimes entiers.
// Tous les montants du moteur sont des entiers (centimes d'euro) ; les taux sont
// exprimés en points de base (1 % = 100 bps, 100 % = 10 000 bps).

/** Montant en centimes (entier). */
export type Cents = number;
/** Taux en points de base : 1 000 = 10 %. */
export type Bps = number;

export const BPS_SCALE = 10_000;

/** Arrondi commercial au centime (demi à l'écart de zéro). */
export function roundCents(value: number): Cents {
  const rounded = Math.round(Math.abs(value) + Number.EPSILON * Math.abs(value));
  return value < 0 ? -rounded : rounded;
}

/** Applique un taux en bps à un montant : applyBps(1 000, 1 500) = 150. */
export function applyBps(amount: Cents, rate: Bps): Cents {
  return roundCents((amount * rate) / BPS_SCALE);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

/** Vérifie qu'un montant est un entier de centimes positif ou nul. */
export function assertCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} doit être un entier de centimes positif (reçu : ${value}).`);
  }
}

/**
 * Répartit un montant proportionnellement à des poids, sans perte d'un centime
 * (méthode du plus fort reste). La somme des parts vaut exactement `total`.
 */
export function allocateProRata(total: Cents, weights: readonly number[]): Cents[] {
  const weightSum = sum(weights);
  if (weights.length === 0) return [];
  if (weightSum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / weightSum);
  const parts = raw.map((r) => Math.floor(r));
  let remainder = total - sum(parts);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    parts[order[k].i] += 1;
    remainder -= 1;
  }
  return parts;
}

/** Montant HT contenu dans un montant TTC pour un taux de TVA donné. */
export function htFromTtc(ttc: Cents, vatRate: Bps): Cents {
  return roundCents((ttc * BPS_SCALE) / (BPS_SCALE + vatRate));
}

/** TVA contenue dans un montant TTC. */
export function vatFromTtc(ttc: Cents, vatRate: Bps): Cents {
  return ttc - htFromTtc(ttc, vatRate);
}

/** TVA due sur un montant HT. */
export function vatOnHt(ht: Cents, vatRate: Bps): Cents {
  return applyBps(ht, vatRate);
}
