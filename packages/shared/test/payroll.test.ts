import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePayroll,
  minutesAmount,
  neutralWithholdingRateBps,
  splitWeeklyMinutes,
  type PayrollComputationInput,
  type PayrollRules,
} from '../src/pricing';

const HCR: PayrollRules = {
  applyHcrOvertime: true,
  overtimeRatesBps: { first: 1000, second: 2000, beyond: 5000 },
  nightBonusBps: 1000,
  sundayBonusBps: 0,
  holidayBonusBps: 10000,
  mealAllowance: { enabled: true, mealsPerDay: 1, rateCents: 427 },
  healthInsurance: { monthlyCents: 4200, employerShareBps: 5000 },
  accidentRateBps: 230,
};

const base: PayrollComputationInput = {
  employee: { hourlyRateCents: 1500, weeklyHours: 35, socialCategory: 'employee', withholdingTaxRateBps: 0 },
  rules: HCR,
  weeklyWorkedMinutes: [35 * 60, 35 * 60, 35 * 60, 35 * 60],
  nightMinutes: 0,
  sundayMinutes: 0,
  holidayMinutes: 0,
  workedDays: 20,
  paidAbsenceDays: 0,
  unpaidAbsenceDays: 0,
};

test('découpage hebdomadaire HCR : 36e-39e +10 %, 40e-43e +20 %, au-delà +50 %', () => {
  assert.deepEqual(splitWeeklyMinutes(35 * 60, true), { regular: 2100, first: 0, second: 0, beyond: 0 });
  assert.deepEqual(splitWeeklyMinutes(39 * 60, true), { regular: 2100, first: 240, second: 0, beyond: 0 });
  assert.deepEqual(splitWeeklyMinutes(45 * 60, true), { regular: 2100, first: 240, second: 240, beyond: 120 });
  assert.deepEqual(splitWeeklyMinutes(45 * 60, false), { regular: 2100, first: 480, second: 0, beyond: 120 });
});

test('montant horaire en centimes entiers', () => {
  assert.equal(minutesAmount(60, 1500), 1500);
  assert.equal(minutesAmount(90, 1500, 1000), 2475);
  assert.equal(minutesAmount(1, 1188), 20);
});

test('bulletin simple : brut, avantage repas, net cohérent', () => {
  const result = computePayroll(base);
  // 140 h × 15 € = 2 100 € + 20 repas × 4,27 € = 85,40 €.
  assert.equal(result.grossCents, 210_000 + 8_540);
  assert.equal(result.mealAllowanceCents, 8_540);
  assert.equal(result.hours.regular, 140);
  assert.equal(result.hours.overtime10, 0);
  assert.ok(result.employeeContributionsCents > 0 && result.employerContributionsCents > result.employeeContributionsCents);
  assert.equal(
    result.netCents,
    result.grossCents - result.employeeContributionsCents - result.mealAllowanceCents - result.withholdingTaxCents - result.deductionsCents,
  );
  for (const value of [result.grossCents, result.netCents, result.taxableNetCents, result.employerCostCents]) {
    assert.ok(Number.isInteger(value));
  }
});

test('heures supplémentaires, nuit, primes et retenues', () => {
  const result = computePayroll({
    ...base,
    weeklyWorkedMinutes: [41 * 60],
    nightMinutes: 120,
    workedDays: 5,
    adjustments: [
      { label: 'Prime de service', amountCents: 5000, kind: 'bonus' },
      { label: 'Acompte', amountCents: 10000, kind: 'deduction' },
    ],
  });
  assert.equal(result.hours.overtime10, 4);
  assert.equal(result.hours.overtime20, 2);
  const overtime = result.lines.filter((line) => line.kind === 'overtime');
  // 4 h × 16,50 € + 2 h × 18 € + majoration de nuit 2 h × 1,50 €.
  assert.equal(overtime.reduce((s, l) => s + l.amountCents, 0), 6_600 + 3_600 + 300);
  assert.equal(result.bonusCents, 5000);
  assert.equal(result.deductionsCents, 10000);
});

test('absences rémunérées payées au taux du contrat', () => {
  const result = computePayroll({ ...base, weeklyWorkedMinutes: [], workedDays: 0, paidAbsenceDays: 5 });
  // 5 jours × 7 h × 15 €.
  assert.equal(result.grossCents, 52_500);
});

test('prélèvement à la source : taux neutre si aucun taux personnalisé', () => {
  assert.equal(neutralWithholdingRateBps(150_000), 0);
  assert.equal(neutralWithholdingRateBps(200_000), 290);
  const result = computePayroll({ ...base, employee: { ...base.employee, withholdingTaxRateBps: null } });
  assert.equal(result.withholdingTaxRateBps, neutralWithholdingRateBps(result.taxableNetCents));
});

test('mensualisation : 39 h HCR = 151,67 h de base + 17,33 h structurelles à +10 %', () => {
  const employee = { ...base.employee, weeklyHours: 39, monthly: true };
  const result = computePayroll({ ...base, employee, weeklyWorkedMinutes: [39 * 60, 39 * 60], workedDays: 0 });
  // 2 100 min × 52 / 12 = 9 100 min ; 240 min × 52 / 12 = 1 040 min.
  assert.equal(result.hours.regular, 151.67);
  assert.equal(result.hours.overtime10, 17.33);
  assert.equal(result.grossCents, minutesAmount(9_100, 1500) + minutesAmount(1_040, 1500, 1000));
});

test('mensualisation : heures au-delà du contrat majorées, absences non rémunérées déduites', () => {
  const employee = { ...base.employee, monthly: true };
  const monthlyBase = minutesAmount(9_100, 1500);
  const extra = computePayroll({ ...base, employee, weeklyWorkedMinutes: [37 * 60, 35 * 60], workedDays: 0 });
  assert.equal(extra.grossCents, monthlyBase + minutesAmount(120, 1500, 1000));
  const absent = computePayroll({ ...base, employee, weeklyWorkedMinutes: [], workedDays: 0, unpaidAbsenceDays: 2 });
  assert.equal(absent.grossCents, monthlyBase - minutesAmount(2 * 7 * 60, 1500));
  const partTime = computePayroll({ ...base, employee: { ...employee, weeklyHours: 24 }, weeklyWorkedMinutes: [26 * 60], workedDays: 0 });
  assert.equal(partTime.grossCents, minutesAmount(Math.round((24 * 60 * 52) / 12), 1500) + minutesAmount(120, 1500, 1000));
});
