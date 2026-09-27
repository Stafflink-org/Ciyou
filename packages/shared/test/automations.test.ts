import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RANKING_WEIGHTS,
  baseRankingScore,
  checkRegistrationNumber,
  computeLateCredit,
  finalRankingScore,
  merchantInactivityAction,
} from '../src';

test('SIRET : clé de Luhn contrôlée', () => {
  assert.equal(checkRegistrationNumber('FR', '732 829 320 00074').ok, true); // SIRET valide (Danone)
  assert.equal(checkRegistrationNumber('FR', '73282932000075').ok, false);
  assert.equal(checkRegistrationNumber('FR', '1234').ok, false);
});

test('numéros d’entreprise des autres pays', () => {
  assert.equal(checkRegistrationNumber('BE', '0403.170.701').ok, true);
  assert.equal(checkRegistrationNumber('BE', '0403170702').ok, false);
  assert.equal(checkRegistrationNumber('LU', 'B123456').ok, true);
  assert.equal(checkRegistrationNumber('LU', '12345').ok, false);
  assert.equal(checkRegistrationNumber('MA', '001234567000089').ok, true);
  assert.equal(checkRegistrationNumber('DZ', '000216001234567').ok, true);
  assert.equal(checkRegistrationNumber('TN', '1234567A').ok, true);
  assert.equal(checkRegistrationNumber('XX', '1234567').ok, false);
});

test('inactivité : alerte à 15 jours, retrait 30 jours après', () => {
  const rules = { inactivityAlertDays: 15, inactivityRemovalDaysAfterAlert: 30 };
  assert.equal(merchantInactivityAction(14, rules), 'none');
  assert.equal(merchantInactivityAction(15, rules), 'alert');
  assert.equal(merchantInactivityAction(44, rules), 'alert');
  assert.equal(merchantInactivityAction(45, rules), 'remove');
});

test('avoir de retard : paliers et plafonds', () => {
  assert.equal(computeLateCredit(10, 3000), 0);
  assert.equal(computeLateCredit(25, 3000), 300);
  assert.equal(computeLateCredit(25, 9000), 500);
  assert.equal(computeLateCredit(45, 3000), 900);
  assert.equal(computeLateCredit(45, 9000), 1500);
});

test('classement : sponsorisé et formule pesés, note peu fiable tirée vers la moyenne', () => {
  const ctx = { maxOrders: 100, nowMs: Date.UTC(2026, 8, 26) };
  const base = { ratingAverage: 4.5, ratingCount: 50, ordersCount: 50, planCode: 'basic' as const, sponsored: false, launchedAtMs: null };
  const plain = baseRankingScore(base, ctx, DEFAULT_RANKING_WEIGHTS);
  const sponsored = baseRankingScore({ ...base, sponsored: true }, ctx, DEFAULT_RANKING_WEIGHTS);
  assert.ok(sponsored > plain);
  const premium = baseRankingScore({ ...base, planCode: 'premium' }, ctx, DEFAULT_RANKING_WEIGHTS);
  assert.ok(premium > plain);
  const fewReviews = baseRankingScore({ ...base, ratingCount: 1, ratingAverage: 5 }, ctx, DEFAULT_RANKING_WEIGHTS);
  const manyReviews = baseRankingScore({ ...base, ratingCount: 60, ratingAverage: 5 }, ctx, DEFAULT_RANKING_WEIGHTS);
  assert.ok(fewReviews < manyReviews);
  const recent = baseRankingScore({ ...base, launchedAtMs: ctx.nowMs - 5 * 86_400_000 }, ctx, DEFAULT_RANKING_WEIGHTS);
  assert.ok(recent > plain);
  const near = finalRankingScore(plain, 1, DEFAULT_RANKING_WEIGHTS);
  const far = finalRankingScore(plain, 0, DEFAULT_RANKING_WEIGHTS);
  assert.ok(near > far && near <= 1);
});
