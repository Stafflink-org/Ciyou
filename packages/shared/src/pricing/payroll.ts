// Moteur de paie des restaurants (France, convention HCR par défaut).
// Entrées en minutes et en centimes, sorties en centimes entiers. Les taux sont
// en points de base (1 000 = 10 %) ; certains taux légaux ont des décimales.
//
// Simplifications assumées (bulletin de gestion, pas un logiciel de paie agréé) :
// - heures supplémentaires décomptées par semaine civile, sur la part de la semaine
//   comprise dans le mois ;
// - salariés mensualisés (option `monthly`) : salaire de base sur l'horaire du
//   contrat, absences rémunérées maintenues, absences non rémunérées déduites au
//   taux horaire ; extras : absences rémunérées payées au taux horaire du contrat ;
// - maladie et congé sans solde non rémunérés (le maintien de salaire se saisit en prime) ;
// - réduction générale des cotisations patronales non calculée.
import type { PayslipAdjustment, PayslipLine, PayrollSettings } from '../models/workforce';
import { roundCents, type Bps, type Cents } from './money';

/** Durée légale hebdomadaire au-delà de laquelle les heures sont supplémentaires. */
export const LEGAL_WEEKLY_HOURS = 35;
/** Plafond mensuel de la sécurité sociale 2026. */
export const PMSS_2026_CENTS: Cents = 400_500;
/** SMIC horaire brut de référence. */
export const SMIC_HOURLY_CENTS: Cents = 1_188;

type ContributionBase = 'gross' | 'gross_98_25' | 'pmss_t1' | 'pmss_t2';

interface ContributionRule {
  id: string;
  label: string;
  employeeRateBps: Bps;
  employerRateBps: Bps;
  base: ContributionBase;
  /** Réservée aux cadres (executive) ou aux non-cadres. */
  appliesTo?: 'executive' | 'non_executive';
}

/** Cotisations 2026 du régime général (valeurs de référence). */
export const PAYROLL_CONTRIBUTIONS_2026: readonly ContributionRule[] = [
  { id: 'maladie', label: 'Sécurité sociale – maladie, maternité, invalidité, décès', employeeRateBps: 0, employerRateBps: 700, base: 'gross' },
  { id: 'at_mp', label: 'Accidents du travail – maladies professionnelles', employeeRateBps: 0, employerRateBps: 0, base: 'gross' },
  { id: 'vieillesse_plafonnee', label: 'Assurance vieillesse plafonnée', employeeRateBps: 690, employerRateBps: 855, base: 'pmss_t1' },
  { id: 'vieillesse_deplafonnee', label: 'Assurance vieillesse déplafonnée', employeeRateBps: 40, employerRateBps: 202, base: 'gross' },
  { id: 'agirc_arrco_t1', label: 'Retraite complémentaire Agirc-Arrco T1', employeeRateBps: 315, employerRateBps: 472, base: 'pmss_t1' },
  { id: 'agirc_arrco_t2', label: 'Retraite complémentaire Agirc-Arrco T2', employeeRateBps: 864, employerRateBps: 1295, base: 'pmss_t2' },
  { id: 'ceg_t1', label: 'Contribution d’équilibre général T1', employeeRateBps: 86, employerRateBps: 129, base: 'pmss_t1' },
  { id: 'ceg_t2', label: 'Contribution d’équilibre général T2', employeeRateBps: 108, employerRateBps: 162, base: 'pmss_t2' },
  { id: 'prevoyance', label: 'Prévoyance HCR', employeeRateBps: 38, employerRateBps: 38, base: 'pmss_t1', appliesTo: 'non_executive' },
  { id: 'famille', label: 'Allocations familiales', employeeRateBps: 0, employerRateBps: 345, base: 'gross' },
  { id: 'chomage', label: 'Assurance chômage', employeeRateBps: 0, employerRateBps: 400, base: 'gross' },
  { id: 'ags', label: 'AGS (garantie des salaires)', employeeRateBps: 0, employerRateBps: 25, base: 'gross' },
  { id: 'fnal', label: 'FNAL', employeeRateBps: 0, employerRateBps: 10, base: 'pmss_t1' },
  { id: 'csa', label: 'Contribution solidarité autonomie', employeeRateBps: 0, employerRateBps: 30, base: 'gross' },
  { id: 'formation', label: 'Formation professionnelle et apprentissage', employeeRateBps: 0, employerRateBps: 123, base: 'gross' },
  { id: 'csg_deductible', label: 'CSG déductible de l’impôt sur le revenu', employeeRateBps: 680, employerRateBps: 0, base: 'gross_98_25' },
  { id: 'csg_crds', label: 'CSG et CRDS non déductibles', employeeRateBps: 290, employerRateBps: 0, base: 'gross_98_25' },
];

/** Barème mensuel du taux neutre du prélèvement à la source (métropole). Seuils en centimes de net imposable. */
const NEUTRAL_WITHHOLDING_GRID: ReadonlyArray<readonly [Cents, Bps]> = [
  [162_000, 0],
  [168_300, 50],
  [179_100, 130],
  [191_100, 210],
  [204_200, 290],
  [215_100, 350],
  [229_400, 410],
  [271_400, 530],
  [325_000, 750],
  [380_600, 950],
  [449_000, 1140],
  [540_800, 1380],
  [675_900, 1590],
  [901_500, 1820],
  [1_933_300, 2060],
  [4_156_900, 2340],
];

export function neutralWithholdingRateBps(taxableNetCents: Cents): Bps {
  for (const [ceiling, rate] of NEUTRAL_WITHHOLDING_GRID) if (taxableNetCents <= ceiling) return rate;
  return 4300;
}

export type PayrollRules = Pick<
  PayrollSettings,
  | 'applyHcrOvertime'
  | 'overtimeRatesBps'
  | 'nightBonusBps'
  | 'sundayBonusBps'
  | 'holidayBonusBps'
  | 'mealAllowance'
  | 'healthInsurance'
  | 'accidentRateBps'
>;

export interface PayrollEmployeeInput {
  hourlyRateCents: Cents;
  weeklyHours: number;
  socialCategory: 'employee' | 'supervisor' | 'executive';
  /** Taux personnalisé transmis par l'administration fiscale ; null : taux neutre. */
  withholdingTaxRateBps?: Bps | null;
  /**
   * Salarié mensualisé (CDI, CDD, apprentissage) : salaire de base calculé sur
   * l'horaire contractuel (× 52 / 12), heures au-delà du contrat en supplément,
   * absences non rémunérées déduites. Sinon (extras) : payé aux heures pointées.
   */
  monthly?: boolean;
}

export interface PayrollComputationInput {
  employee: PayrollEmployeeInput;
  rules: PayrollRules;
  /** Minutes travaillées par semaine civile (part de la semaine comprise dans la période). */
  weeklyWorkedMinutes: number[];
  nightMinutes: number;
  sundayMinutes: number;
  holidayMinutes: number;
  workedDays: number;
  /** Jours d'absence rémunérée (congés payés, RTT, formation, événement familial). */
  paidAbsenceDays: number;
  unpaidAbsenceDays: number;
  adjustments?: PayslipAdjustment[];
  /** Plafond de la sécurité sociale (centimes), par défaut PMSS 2026. */
  pmssCents?: Cents;
}

export interface PayrollHours {
  regular: number;
  overtime10: number;
  overtime20: number;
  overtime50: number;
  night: number;
  sunday: number;
  holiday: number;
}

export interface PayrollContributionLine {
  label: string;
  baseCents: Cents;
  employeeRateBps: number;
  employerRateBps: number;
  employeeCents: Cents;
  employerCents: Cents;
}

export interface PayrollComputation {
  hours: PayrollHours;
  lines: PayslipLine[];
  grossCents: Cents;
  bonusCents: Cents;
  mealAllowanceCents: Cents;
  deductionsCents: Cents;
  employeeContributionsCents: Cents;
  employerContributionsCents: Cents;
  taxableNetCents: Cents;
  withholdingTaxRateBps: Bps;
  withholdingTaxCents: Cents;
  netCents: Cents;
  /** Coût total employeur : brut + cotisations patronales. */
  employerCostCents: Cents;
  contributions: PayrollContributionLine[];
}

/** Heures (arrondies au centième) à partir de minutes. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** Montant de `minutes` au taux horaire, majoré de `bonusBps` (0 : taux normal). */
export function minutesAmount(minutes: number, hourlyRateCents: Cents, bonusBps: Bps = 0): Cents {
  return roundCents((minutes * hourlyRateCents * (10_000 + bonusBps)) / 600_000);
}

/** Majoration seule (ex. +10 % de nuit) sur `minutes`. */
function bonusOnlyAmount(minutes: number, hourlyRateCents: Cents, bonusBps: Bps): Cents {
  return roundCents((minutes * hourlyRateCents * bonusBps) / 600_000);
}

interface OvertimeSplit {
  regular: number;
  first: number;
  second: number;
  beyond: number;
}

/**
 * Découpe les minutes d'une semaine : HCR 36e-39e (+10 %), 40e-43e (+20 %), 44e et au-delà (+50 %) ;
 * régime légal : 36e-43e (taux « first », +25 % par défaut) et au-delà (+50 %).
 */
export function splitWeeklyMinutes(minutes: number, hcr: boolean): OvertimeSplit {
  const legal = LEGAL_WEEKLY_HOURS * 60;
  const regular = Math.min(minutes, legal);
  const over = Math.max(0, minutes - legal);
  if (hcr) {
    const first = Math.min(over, 4 * 60);
    const second = Math.min(Math.max(0, over - 4 * 60), 4 * 60);
    return { regular, first, second, beyond: Math.max(0, over - 8 * 60) };
  }
  const first = Math.min(over, 8 * 60);
  return { regular, first, second: 0, beyond: Math.max(0, over - 8 * 60) };
}

function contributionBase(base: ContributionBase, grossCents: Cents, pmss: Cents): Cents {
  switch (base) {
    case 'gross':
      return grossCents;
    case 'gross_98_25':
      return roundCents(Math.min(grossCents, pmss * 4) * 0.9825);
    case 'pmss_t1':
      return Math.min(grossCents, pmss);
    case 'pmss_t2':
      return Math.max(0, Math.min(grossCents, pmss * 8) - pmss);
  }
}

/** Réglages de paie par défaut d'un établissement (convention HCR). */
export const DEFAULT_PAYROLL_SETTINGS: Omit<PayrollSettings, 'updatedAt' | 'updatedBy'> = {
  country: 'FR',
  collectiveAgreement: 'HCR (IDCC 1979)',
  nafCode: '5610A',
  weeklyLegalHours: 35,
  applyHcrOvertime: true,
  overtimeRatesBps: { first: 1000, second: 2000, beyond: 5000 },
  nightWindow: { from: '22:00', to: '07:00' },
  nightBonusBps: 1000,
  sundayBonusBps: 0,
  holidayBonusBps: 10000,
  mealAllowance: { enabled: true, mealsPerDay: 1, rateCents: 427 },
  healthInsurance: { monthlyCents: 4200, employerShareBps: 5000 },
  accidentRateBps: 230,
  payDay: 5,
  paidLeaveDaysPerYear: 25,
};

const percent = (bps: number) => `${(bps / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

/** Majoration légale minimale des heures complémentaires (temps partiel). */
const COMPLEMENTARY_HOURS_BPS: Bps = 1_000;

/** Calcule un bulletin de paie mensuel. */
export function computePayroll(input: PayrollComputationInput): PayrollComputation {
  const { employee, rules } = input;
  const rate = employee.hourlyRateCents;
  const pmss = input.pmssCents ?? PMSS_2026_CENTS;
  const hcr = rules.applyHcrOvertime;

  // 1. Heures : normales et supplémentaires par semaine.
  const weeks = input.weeklyWorkedMinutes.map((minutes) => Math.max(0, minutes));
  const dailyMinutes = Math.round((employee.weeklyHours * 60) / 5);
  const paidAbsenceMinutes = Math.round(input.paidAbsenceDays * dailyMinutes);
  const unpaidAbsenceMinutes = Math.round(input.unpaidAbsenceDays * dailyMinutes);
  const { first, second, beyond } = rules.overtimeRatesBps;

  // 2. Rémunération brute ligne par ligne.
  const lines: PayslipLine[] = [];
  const push = (line: PayslipLine) => {
    if (line.amountCents !== 0) lines.push(line);
  };

  /** Heures majorées payées en plus de la base (hors structurelles). */
  let overtime: OvertimeSplit;
  let hours: Pick<PayrollHours, 'regular' | 'overtime10' | 'overtime20' | 'overtime50'>;

  if (employee.monthly) {
    // Mensualisation : horaire contractuel lissé sur l'année (52 semaines / 12 mois).
    const contractMinutes = Math.round(employee.weeklyHours * 60);
    const structural = splitWeeklyMinutes(contractMinutes, hcr);
    const monthly = (minutes: number) => Math.round((minutes * 52) / 12);
    const extra = { complementary: 0, first: 0, second: 0, beyond: 0 };
    for (const minutes of weeks) {
      if (minutes <= contractMinutes) continue;
      const week = splitWeeklyMinutes(minutes, hcr);
      extra.complementary += week.regular - structural.regular;
      extra.first += week.first - structural.first;
      extra.second += week.second - structural.second;
      extra.beyond += week.beyond - structural.beyond;
    }
    overtime = { regular: extra.complementary, first: extra.first, second: extra.second, beyond: extra.beyond };
    const baseMinutes = monthly(structural.regular);
    push({ label: 'Salaire de base mensualisé', quantity: minutesToHours(baseMinutes), unitCents: rate, amountCents: minutesAmount(baseMinutes, rate), kind: 'base' });
    push({
      label: hcr ? `Heures structurelles 36e à 39e (+${percent(first)})` : `Heures structurelles 36e à 43e (+${percent(first)})`,
      quantity: minutesToHours(monthly(structural.first)),
      unitCents: minutesAmount(60, rate, first),
      amountCents: minutesAmount(monthly(structural.first), rate, first),
      kind: 'base',
    });
    push({
      label: `Heures structurelles 40e à 43e (+${percent(second)})`,
      quantity: minutesToHours(monthly(structural.second)),
      unitCents: minutesAmount(60, rate, second),
      amountCents: minutesAmount(monthly(structural.second), rate, second),
      kind: 'base',
    });
    push({
      label: 'Heures complémentaires (+10 %)',
      quantity: minutesToHours(extra.complementary),
      unitCents: minutesAmount(60, rate, COMPLEMENTARY_HOURS_BPS),
      amountCents: minutesAmount(extra.complementary, rate, COMPLEMENTARY_HOURS_BPS),
      kind: 'overtime',
    });
    push({
      label: 'Absences non rémunérées',
      quantity: -minutesToHours(unpaidAbsenceMinutes),
      unitCents: rate,
      amountCents: -minutesAmount(unpaidAbsenceMinutes, rate),
      kind: 'absence',
    });
    hours = {
      regular: minutesToHours(Math.max(0, baseMinutes + extra.complementary - unpaidAbsenceMinutes)),
      overtime10: minutesToHours(monthly(structural.first) + extra.first),
      overtime20: minutesToHours(monthly(structural.second) + extra.second),
      overtime50: minutesToHours(monthly(structural.beyond) + extra.beyond),
    };
  } else {
    overtime = weeks.reduce<OvertimeSplit>(
      (acc, minutes) => {
        const week = splitWeeklyMinutes(minutes, hcr);
        return { regular: acc.regular + week.regular, first: acc.first + week.first, second: acc.second + week.second, beyond: acc.beyond + week.beyond };
      },
      { regular: 0, first: 0, second: 0, beyond: 0 },
    );
    push({ label: 'Salaire de base (heures travaillées)', quantity: minutesToHours(overtime.regular), unitCents: rate, amountCents: minutesAmount(overtime.regular, rate), kind: 'base' });
    push({
      label: 'Absences rémunérées (congés, RTT, formation)',
      quantity: minutesToHours(paidAbsenceMinutes),
      unitCents: rate,
      amountCents: minutesAmount(paidAbsenceMinutes, rate),
      kind: 'absence',
    });
    hours = {
      regular: minutesToHours(overtime.regular + paidAbsenceMinutes),
      overtime10: minutesToHours(overtime.first),
      overtime20: minutesToHours(overtime.second),
      overtime50: minutesToHours(overtime.beyond),
    };
  }

  push({
    label: hcr ? `Heures supplémentaires 36e à 39e (+${percent(first)})` : `Heures supplémentaires 36e à 43e (+${percent(first)})`,
    quantity: minutesToHours(overtime.first),
    unitCents: minutesAmount(60, rate, first),
    amountCents: minutesAmount(overtime.first, rate, first),
    kind: 'overtime',
  });
  push({
    label: `Heures supplémentaires 40e à 43e (+${percent(second)})`,
    quantity: minutesToHours(overtime.second),
    unitCents: minutesAmount(60, rate, second),
    amountCents: minutesAmount(overtime.second, rate, second),
    kind: 'overtime',
  });
  push({
    label: `Heures supplémentaires au-delà de la 43e (+${percent(beyond)})`,
    quantity: minutesToHours(overtime.beyond),
    unitCents: minutesAmount(60, rate, beyond),
    amountCents: minutesAmount(overtime.beyond, rate, beyond),
    kind: 'overtime',
  });
  push({
    label: `Majoration heures de nuit (+${percent(rules.nightBonusBps)})`,
    quantity: minutesToHours(input.nightMinutes),
    unitCents: bonusOnlyAmount(60, rate, rules.nightBonusBps),
    amountCents: bonusOnlyAmount(input.nightMinutes, rate, rules.nightBonusBps),
    kind: 'overtime',
  });
  push({
    label: `Majoration dimanche (+${percent(rules.sundayBonusBps)})`,
    quantity: minutesToHours(input.sundayMinutes),
    unitCents: bonusOnlyAmount(60, rate, rules.sundayBonusBps),
    amountCents: bonusOnlyAmount(input.sundayMinutes, rate, rules.sundayBonusBps),
    kind: 'overtime',
  });
  push({
    label: `Majoration jours fériés (+${percent(rules.holidayBonusBps)})`,
    quantity: minutesToHours(input.holidayMinutes),
    unitCents: bonusOnlyAmount(60, rate, rules.holidayBonusBps),
    amountCents: bonusOnlyAmount(input.holidayMinutes, rate, rules.holidayBonusBps),
    kind: 'overtime',
  });

  let bonusCents = 0;
  let deductionsCents = 0;
  for (const adjustment of input.adjustments ?? []) {
    const amount = Math.abs(Math.round(adjustment.amountCents));
    if (adjustment.kind === 'bonus') {
      bonusCents += amount;
      push({ label: adjustment.label, amountCents: amount, kind: 'bonus' });
    } else {
      deductionsCents += amount;
    }
  }

  const meal = rules.mealAllowance;
  const mealCount = meal.enabled ? input.workedDays * meal.mealsPerDay : 0;
  const mealRate = meal.rateCents ?? 0;
  const mealAllowanceCents = mealCount * mealRate;
  push({ label: 'Avantage en nature nourriture', quantity: mealCount, unitCents: mealRate, amountCents: mealAllowanceCents, kind: 'allowance' });

  const grossCents = lines.reduce((total, line) => total + line.amountCents, 0);

  // 3. Cotisations.
  const executive = employee.socialCategory === 'executive';
  const contributions: PayrollContributionLine[] = [];
  let csgNonDeductible = 0;
  for (const rule of PAYROLL_CONTRIBUTIONS_2026) {
    if (rule.appliesTo === 'executive' && !executive) continue;
    if (rule.appliesTo === 'non_executive' && executive) continue;
    const employerRateBps =
      rule.id === 'at_mp'
        ? rules.accidentRateBps
        : rule.id === 'maladie' && grossCents > roundCents(2.5 * SMIC_HOURLY_CENTS * 151.67)
          ? 1300
          : rule.id === 'famille' && grossCents > roundCents(3.5 * SMIC_HOURLY_CENTS * 151.67)
            ? 525
            : rule.employerRateBps;
    const baseCents = contributionBase(rule.base, grossCents, pmss);
    const employeeCents = roundCents((baseCents * rule.employeeRateBps) / 10_000);
    const employerCents = roundCents((baseCents * employerRateBps) / 10_000);
    if (baseCents <= 0 || (employeeCents === 0 && employerCents === 0)) continue;
    if (rule.id === 'csg_crds') csgNonDeductible = employeeCents;
    contributions.push({ label: rule.label, baseCents, employeeRateBps: rule.employeeRateBps, employerRateBps, employeeCents, employerCents });
  }

  // Complémentaire santé : forfait mensuel partagé.
  const health = rules.healthInsurance;
  let healthEmployer = 0;
  if (health.monthlyCents > 0 && grossCents > 0) {
    healthEmployer = roundCents((health.monthlyCents * health.employerShareBps) / 10_000);
    const healthEmployee = health.monthlyCents - healthEmployer;
    contributions.push({
      label: 'Complémentaire santé (forfait)',
      baseCents: health.monthlyCents,
      employeeRateBps: 10_000 - health.employerShareBps,
      employerRateBps: health.employerShareBps,
      employeeCents: healthEmployee,
      employerCents: healthEmployer,
    });
  }

  const employeeContributionsCents = contributions.reduce((total, c) => total + c.employeeCents, 0);
  const employerContributionsCents = contributions.reduce((total, c) => total + c.employerCents, 0);

  // 4. Net imposable, prélèvement à la source et net à payer.
  const taxableNetCents = Math.max(0, grossCents - (employeeContributionsCents - csgNonDeductible) + healthEmployer);
  const withholdingTaxRateBps =
    employee.withholdingTaxRateBps !== null && employee.withholdingTaxRateBps !== undefined && employee.withholdingTaxRateBps >= 0
      ? employee.withholdingTaxRateBps
      : neutralWithholdingRateBps(taxableNetCents);
  const withholdingTaxCents = roundCents((taxableNetCents * withholdingTaxRateBps) / 10_000);
  const netCents = grossCents - employeeContributionsCents - mealAllowanceCents - withholdingTaxCents - deductionsCents;

  return {
    hours: {
      ...hours,
      night: minutesToHours(input.nightMinutes),
      sunday: minutesToHours(input.sundayMinutes),
      holiday: minutesToHours(input.holidayMinutes),
    },
    lines,
    grossCents,
    bonusCents,
    mealAllowanceCents,
    deductionsCents,
    employeeContributionsCents,
    employerContributionsCents,
    taxableNetCents,
    withholdingTaxRateBps,
    withholdingTaxCents,
    netCents,
    employerCostCents: grossCents + employerContributionsCents,
    contributions,
  };
}
