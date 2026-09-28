import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  DEFAULT_ADMIN_ROLE_PERMISSIONS,
  DEFAULT_STAFF_ROLE_PERMISSIONS,
  RESTAURANT_PERMISSIONS,
  STAFF_ROLES,
  buildSearchKeywords,
  canTransition,
  defaultCurrencyOfCountry,
  encodeGeohash,
  formatBps,
  formatCountdown,
  formatMoney,
  formatOrderNumber,
  formatPrice,
  haversineMeters,
  isPointInPolygon,
  isValidIsoDay,
  maskEmail,
  maskIban,
  maskPhone,
  nextOrderStatus,
  parseOrderNumber,
  parsePriceInput,
  resolveRestaurantCurrency,
  slugify,
  toDayKey,
} from '../src';

const NBSP = ' ';
const NNBSP = ' ';

test('devise du compte d’un restaurant (repli pays puis EUR)', () => {
  assert.equal(resolveRestaurantCurrency({ currency: 'MAD' }, { currency: 'EUR' }, 'FR'), 'MAD', 'la devise du restaurant l’emporte');
  assert.equal(resolveRestaurantCurrency({ currency: undefined }, { currency: 'DZD' }, 'DZ'), 'DZD', 'à défaut, celle du pays');
  assert.equal(resolveRestaurantCurrency({}, null, 'TN'), 'TND', 'à défaut, celle habituelle du pays (sans document pays)');
  assert.equal(resolveRestaurantCurrency(null, null, null), 'EUR', 'à défaut de tout, EUR');
  assert.equal(defaultCurrencyOfCountry('MA'), 'MAD');
  assert.equal(defaultCurrencyOfCountry('inconnu'), 'EUR');
  assert.equal(formatMoney(12_500, 'TND').includes('12,500'), true, 'le dinar tunisien a 3 décimales');
});

test('formats de prix fr-FR', () => {
  assert.equal(formatPrice(1250).replace(NNBSP, NBSP), `12,50${NBSP}€`);
  assert.equal(formatBps(1250), `12,5${NBSP}%`);
  assert.equal(parsePriceInput('12,5'), 1250);
  assert.equal(parsePriceInput('3.99 €'), 399);
  assert.equal(parsePriceInput('abc'), null);
});

test('dates et durées', () => {
  assert.equal(formatCountdown(125), '02:05');
  assert.equal(toDayKey(new Date(Date.UTC(2026, 2, 18, 23, 30))), '20260319'); // Paris = UTC+1
  assert.equal(isValidIsoDay('2026-02-30'), false);
  assert.equal(isValidIsoDay('2026-02-28'), true);
});

test('numéros de commande', () => {
  assert.equal(formatOrderNumber(482), 'GL-00482');
  assert.equal(parseOrderNumber(' #gl 10482 '), 'GL-10482');
  assert.equal(parseOrderNumber('SL-10482'), null);
});

test('slugs et mots-clés de recherche', () => {
  assert.equal(slugify('Crêperie de l’Été !'), 'creperie-de-l-ete');
  const keys = buildSearchKeywords('Mina Kitchen', 'camille@exemple.fr');
  assert.ok(keys.includes('mi') && keys.includes('kitchen') && keys.includes('camille'));
});

test('masquage des données personnelles', () => {
  assert.equal(maskEmail('camille@exemple.fr'), 'c••••••@exemple.fr');
  assert.equal(maskPhone('+33 6 12 34 56 78'), '+33 6 •• •• •• 78');
  assert.equal(maskIban('FR76 3000 6000 0112 3456 7890 189'), 'FR76 •••• •••• 0189');
});

test('géographie : distance, polygone, geohash', () => {
  const metz = { lat: 49.1193, lng: 6.1757 };
  const nancy = { lat: 48.6921, lng: 6.1844 };
  const d = haversineMeters(metz, nancy);
  assert.ok(d > 47_000 && d < 48_000);
  const square = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 0 },
  ];
  assert.equal(isPointInPolygon({ lat: 0.5, lng: 0.5 }, square), true);
  assert.equal(isPointInPolygon({ lat: 1.5, lng: 0.5 }, square), false);
  assert.equal(encodeGeohash({ lat: 57.64911, lng: 10.40744 }, 11), 'u4pruydqqvj');
});

test('cycle de vie des commandes', () => {
  assert.equal(nextOrderStatus('ready', 'delivery'), 'assigned');
  assert.equal(nextOrderStatus('ready', 'pickup'), 'delivered');
  assert.equal(nextOrderStatus('delivered', 'delivery'), null);
  assert.equal(canTransition('new', 'accepted', 'restaurant', 'delivery'), true);
  assert.equal(canTransition('assigned', 'picked_up', 'restaurant', 'delivery'), false);
  assert.equal(canTransition('picked_up', 'cancelled', 'customer', 'delivery'), false);
  assert.equal(canTransition('ready', 'delivered', 'restaurant', 'delivery'), false);
});

test('matrices de permissions complètes et cohérentes', () => {
  for (const role of ADMIN_ROLES) {
    for (const p of DEFAULT_ADMIN_ROLE_PERMISSIONS[role]) assert.ok(ADMIN_PERMISSIONS.includes(p), `${role} : ${p}`);
  }
  for (const role of STAFF_ROLES) {
    for (const p of DEFAULT_STAFF_ROLE_PERMISSIONS[role]) assert.ok(RESTAURANT_PERMISSIONS.includes(p), `${role} : ${p}`);
  }
  assert.ok(!DEFAULT_ADMIN_ROLE_PERMISSIONS.support.includes('admins.manage'));
});
