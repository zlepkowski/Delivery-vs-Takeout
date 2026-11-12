// D-026 / D-027 src/data/profiles.js: the profiled chains, their menus, direct-only
// deals, direct-delivery fees and app markups. Checked against brands.js ids.
// §9.3 (zero fees read as free) and §12 (the three Amex Gold partners).
// Expected values come from the decisions and spec, never from the generator.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const PROFILES_REL = 'src/data/profiles.js';
const PROFILED = [
  'dominos', 'taco_bell', 'chipotle', 'papa_johns', 'wingstop', 'pizza_hut',
  'five_guys', 'buffalo_wild_wings', 'little_caesars', 'the_cheesecake_factory',
  'subway', 'dunkin',
];
const AMEX_GOLD_DIRECT = ['five_guys', 'buffalo_wild_wings', 'the_cheesecake_factory'];
const PLATFORMS = ['dd', 'ue', 'gh'];
const SCOPES = ['both', 'pickup', 'delivery'];
const BASE_KEYS = ['amexGoldDirect', 'deal', 'directDelivery', 'markup', 'markupEst', 'menu', 'platforms'];

/** True when n has at most two decimal places (tolerant of float noise). */
const atMost2 = (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

let cached = null;
function load() {
  if (!cached) cached = loadData(['src/data/brands.js', PROFILES_REL]);
  return cached;
}

function profileEntries() {
  const { PROFILES } = load();
  return Object.keys(PROFILES).sort().map((id) => [id, PROFILES[id]]);
}

test('D-026 src/data/profiles.js exists', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, PROFILES_REL)), 'missing src/data/profiles.js');
});

test('D-026 every profile key is one of the 12 chains and is in BRAND_IDS', () => {
  const { PROFILES, BRAND_IDS } = load();
  const ids = Object.keys(PROFILES);
  assert.deepEqual(ids.filter((id) => !PROFILED.includes(id)), []);
  assert.deepEqual(ids.filter((id) => !Array.from(BRAND_IDS).includes(id)), []);
});

test('D-026 at least 6 of the 12 chains are profiled', () => {
  const n = Object.keys(load().PROFILES).length;
  assert.ok(n >= 6, `only ${n} profiles`);
});

test('D-026 the header "Chains not yet profiled" line lists exactly the missing chains', () => {
  const { PROFILES } = load();
  const missing = PROFILED.filter((id) => !Object.prototype.hasOwnProperty.call(PROFILES, id)).sort();
  const text = fs.readFileSync(path.join(APP_ROOT, PROFILES_REL), 'utf8');
  const m = text.match(/Chains not yet profiled:([^\n]*)/);
  if (!m) {
    assert.deepEqual(missing, [], 'header has no "Chains not yet profiled" line');
    return;
  }
  const listed = m[1].split(/[\s,]+/).filter((t) => t !== '' && t !== 'none').sort();
  assert.deepEqual(listed, missing);
});

test('D-027 each profile has exactly the §6 keys, with directFee only when directDelivery is true', () => {
  const problems = [];
  for (const [id, p] of profileEntries()) {
    const expected = BASE_KEYS.concat(p.directDelivery === true ? ['directFee'] : []).sort();
    const actual = Object.keys(p).sort();
    if (actual.join(',') !== expected.join(',')) problems.push(`${id}: keys ${actual.join(',')}`);
  }
  assert.deepEqual(problems, []);
});

test('D-027 no profile has a profiled or name key', () => {
  const bad = profileEntries().filter(([, p]) => 'profiled' in p || 'name' in p).map(([id]) => id);
  assert.deepEqual(bad, []);
});

test('D-027 menu has 5 to 10 entries, each [name, price, isDealItem] with 0 < price < 200', () => {
  const problems = [];
  for (const [id, p] of profileEntries()) {
    if (!Array.isArray(p.menu) || p.menu.length < 5 || p.menu.length > 10) {
      problems.push(`${id}: menu length ${p.menu && p.menu.length}`);
      continue;
    }
    p.menu.forEach((item, i) => {
      if (!Array.isArray(item) || item.length !== 3) {
        problems.push(`${id}[${i}]: not a 3-tuple`);
        return;
      }
      const [name, price, isDeal] = item;
      if (typeof name !== 'string' || name === '') problems.push(`${id}[${i}]: name`);
      if (typeof price !== 'number' || !(price > 0 && price < 200)) problems.push(`${id}[${i}]: price ${price}`);
      if (typeof isDeal !== 'boolean') problems.push(`${id}[${i}]: isDealItem ${isDeal}`);
    });
  }
  assert.deepEqual(problems, []);
});

test('D-027 menu prices have at most 2 decimals', () => {
  const bad = [];
  for (const [id, p] of profileEntries()) {
    for (const [name, price] of p.menu) {
      if (typeof price === 'number' && !atMost2(price)) bad.push(`${id}: ${name} ${price}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('D-027 menu item names are unique within each profile', () => {
  const bad = [];
  for (const [id, p] of profileEntries()) {
    const names = p.menu.map((item) => item[0]);
    if (new Set(names).size !== names.length) bad.push(id);
  }
  assert.deepEqual(bad, []);
});

test('D-027 deal is null or exactly {label, price, minItems, scope}', () => {
  const bad = [];
  for (const [id, p] of profileEntries()) {
    if (p.deal === null) continue;
    const keys = p.deal && typeof p.deal === 'object' ? Object.keys(p.deal).sort().join(',') : '';
    if (keys !== 'label,minItems,price,scope') bad.push(`${id}: ${keys || typeof p.deal}`);
  }
  assert.deepEqual(bad, []);
});

test('D-027 a non-null deal has price > 0 (at most 2 decimals), integer minItems >= 1, and a valid scope', () => {
  const problems = [];
  for (const [id, p] of profileEntries()) {
    const d = p.deal;
    if (d === null) continue;
    if (typeof d.label !== 'string' || d.label === '') problems.push(`${id}: label`);
    if (typeof d.price !== 'number' || !(d.price > 0) || !atMost2(d.price)) problems.push(`${id}: price ${d.price}`);
    if (!Number.isInteger(d.minItems) || d.minItems < 1) problems.push(`${id}: minItems ${d.minItems}`);
    if (!SCOPES.includes(d.scope)) problems.push(`${id}: scope ${d.scope}`);
  }
  assert.deepEqual(problems, []);
});

test('D-027 a non-null deal has a deal item on the menu, and a null deal has none', () => {
  const problems = [];
  for (const [id, p] of profileEntries()) {
    const hasDealItem = p.menu.some((item) => item[2] === true);
    if (p.deal !== null && !hasDealItem) problems.push(`${id}: deal with no deal item`);
    if (p.deal === null && hasDealItem) problems.push(`${id}: deal item with no deal`);
  }
  assert.deepEqual(problems, []);
});

test('§9.3 directDelivery is a boolean', () => {
  const bad = profileEntries().filter(([, p]) => typeof p.directDelivery !== 'boolean').map(([id]) => id);
  assert.deepEqual(bad, []);
});

test('§9.3 directDelivery true requires a finite directFee > 0', () => {
  const bad = profileEntries()
    .filter(([, p]) => p.directDelivery === true)
    .filter(([, p]) => typeof p.directFee !== 'number' || !Number.isFinite(p.directFee) || !(p.directFee > 0))
    .map(([id, p]) => `${id}: directFee ${p.directFee}`);
  assert.deepEqual(bad, []);
});

test('§9.3 directDelivery false has no directFee key (never a $0 fee)', () => {
  const bad = profileEntries()
    .filter(([, p]) => p.directDelivery === false)
    .filter(([, p]) => 'directFee' in p)
    .map(([id, p]) => `${id}: directFee ${p.directFee}`);
  assert.deepEqual(bad, []);
});

test('§9.3 no profile has a directFee of 0', () => {
  const bad = profileEntries().filter(([, p]) => p.directFee === 0).map(([id]) => id);
  assert.deepEqual(bad, []);
});

test('D-027 platforms is an ordered subset of dd, ue, gh with no duplicates', () => {
  const bad = [];
  for (const [id, p] of profileEntries()) {
    if (!Array.isArray(p.platforms)) {
      bad.push(`${id}: not an array`);
      continue;
    }
    const inOrder = PLATFORMS.filter((x) => p.platforms.includes(x));
    if (p.platforms.join(',') !== inOrder.join(',')) bad.push(`${id}: ${p.platforms.join(',')}`);
  }
  assert.deepEqual(bad, []);
});

test('D-027 markup has exactly the listed platforms as keys, with values 0 to 60', () => {
  const problems = [];
  for (const [id, p] of profileEntries()) {
    const keys = Object.keys(p.markup).sort().join(',');
    const want = p.platforms.slice().sort().join(',');
    if (keys !== want) problems.push(`${id}: markup keys ${keys} vs platforms ${want}`);
    for (const k of Object.keys(p.markup)) {
      const v = p.markup[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 60) problems.push(`${id}: ${k} ${v}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('D-027 markupEst is a boolean', () => {
  const bad = profileEntries().filter(([, p]) => typeof p.markupEst !== 'boolean').map(([id]) => id);
  assert.deepEqual(bad, []);
});

test('§12 amexGoldDirect is a boolean on every profile', () => {
  const bad = profileEntries().filter(([, p]) => typeof p.amexGoldDirect !== 'boolean').map(([id]) => id);
  assert.deepEqual(bad, []);
});

test('§12 amexGoldDirect is true exactly for five_guys, buffalo_wild_wings and the_cheesecake_factory', () => {
  const bad = profileEntries()
    .filter(([id, p]) => p.amexGoldDirect !== AMEX_GOLD_DIRECT.includes(id))
    .map(([id, p]) => `${id}: amexGoldDirect ${p.amexGoldDirect}`);
  assert.deepEqual(bad, []);
});
