// §6 + D-009 + D-022 src/data/states.js: STATES rows, GRADE_ADD, and the dead ZIP3 table gone.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const REL = 'src/data/states.js';

const EXPECTED_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

let cached = null;
function load() {
  if (!cached) cached = loadData([REL]);
  return cached;
}

function rows() {
  return load().STATES;
}

test('§6 src/data/states.js exists', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, REL)), 'missing src/data/states.js');
});

test('D-009 STATES has exactly 51 rows', () => {
  assert.ok(Array.isArray(rows()), 'STATES must be an array');
  assert.equal(rows().length, 51);
});

test('D-009 every STATES row is [code, name, gasRegular, mealTaxPct] with no lat/lon', () => {
  const bad = rows()
    .map((r, i) => [i, r])
    .filter(([, r]) => !Array.isArray(r) || r.length !== 4)
    .map(([i]) => i);
  assert.deepEqual(bad, []);
});

test('§6 STATES codes are exactly the 50 states plus DC', () => {
  const codes = rows().map((r) => r[0]);
  assert.deepEqual(Array.from(codes).sort(), EXPECTED_CODES.slice().sort());
});

test('§6 every state name is a non-empty string', () => {
  const bad = rows().filter((r) => typeof r[1] !== 'string' || r[1] === '').map((r) => r[0]);
  assert.deepEqual(bad, []);
});

test('§6 gas is null or a number in [1.5, 7.0]', () => {
  const bad = rows()
    .filter((r) => r[2] !== null && !(typeof r[2] === 'number' && r[2] >= 1.5 && r[2] <= 7.0))
    .map((r) => `${r[0]}=${r[2]}`);
  assert.deepEqual(bad, []);
});

test('§6 meal tax is null or a number in [0, 15]', () => {
  const bad = rows()
    .filter((r) => r[3] !== null && !(typeof r[3] === 'number' && r[3] >= 0 && r[3] <= 15))
    .map((r) => `${r[0]}=${r[3]}`);
  assert.deepEqual(bad, []);
});

test('§6 DE, MT and OR have no sales tax (tax === 0)', () => {
  const byCode = Object.fromEntries(rows().map((r) => [r[0], r[3]]));
  assert.equal(byCode.DE, 0);
  assert.equal(byCode.MT, 0);
  assert.equal(byCode.OR, 0);
});

test('§6 GRADE_ADD has exactly the keys midgrade, premium, diesel', () => {
  const keys = Object.keys(load().GRADE_ADD).sort();
  assert.deepEqual(keys, ['diesel', 'midgrade', 'premium']);
});

test('§6 GRADE_ADD midgrade and premium are numbers in (0, 2]', () => {
  const g = load().GRADE_ADD;
  for (const k of ['midgrade', 'premium']) {
    assert.ok(typeof g[k] === 'number' && g[k] > 0 && g[k] <= 2, `${k}=${g[k]}`);
  }
});

test('§6 GRADE_ADD diesel is a number in [-1, 2.5]', () => {
  const d = load().GRADE_ADD.diesel;
  assert.ok(typeof d === 'number' && d >= -1 && d <= 2.5, `diesel=${d}`);
});

test('D-009 POD.data.ZIP3 is gone (dead code)', () => {
  assert.equal(load().ZIP3, undefined);
});

// D-022: which EIA weekly series each state's gas comes from. Expected values are
// the EIA PADD definitions and the D-022 rule (own state series where EIA publishes one).
const OWN_SERIES = { CA: 'SCA', CO: 'SCO', FL: 'SFL', MA: 'SMA', MN: 'SMN', NY: 'SNY', OH: 'SOH', TX: 'STX', WA: 'SWA' };
const PADD_SERIES = {
  R1X: ['CT', 'ME', 'NH', 'RI', 'VT'],
  R1Y: ['DE', 'DC', 'MD', 'NJ', 'PA'],
  R1Z: ['GA', 'NC', 'SC', 'VA', 'WV'],
  R20: ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'WI'],
  R30: ['AL', 'AR', 'LA', 'MS', 'NM'],
  R40: ['ID', 'MT', 'UT', 'WY'],
  R5XCA: ['AK', 'AZ', 'HI', 'NV', 'OR'],
};

function expectedSeries() {
  const out = { ...OWN_SERIES };
  for (const [area, codes] of Object.entries(PADD_SERIES)) {
    for (const c of codes) out[c] = area;
  }
  return out;
}

/** Reads each state row's EIA series from its trailing comment in states.js. */
function seriesByCode() {
  const text = fs.readFileSync(path.join(APP_ROOT, REL), 'utf8');
  const out = {};
  const re = /^\s*\["([A-Z]{2})",.*\/\/ gas: EIA EMM_EPMR_PTE_([A-Z0-9]+)_DPG/gm;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

test('D-022 the expected series table covers 51 unique state codes', () => {
  const exp = expectedSeries();
  assert.equal(Object.keys(exp).length, 51);
  assert.deepEqual(Object.keys(exp).sort(), EXPECTED_CODES.slice().sort());
});

test('D-022 each state takes gas from its own EIA series, or its PADD series', () => {
  const exp = expectedSeries();
  const actual = seriesByCode();
  const problems = [];
  for (const code of EXPECTED_CODES) {
    if (!(code in actual)) problems.push(`${code}: no EIA series comment`);
    else if (actual[code] !== exp[code]) problems.push(`${code}: ${actual[code]} (want ${exp[code]})`);
  }
  assert.deepEqual(problems, []);
});

test('D-022 states on the same EIA series report the same regular gas', () => {
  const gas = Object.fromEntries(rows().map((r) => [r[0], r[2]]));
  const bySeries = {};
  for (const [code, area] of Object.entries(seriesByCode())) {
    (bySeries[area] = bySeries[area] || []).push(code);
  }
  const problems = [];
  for (const [area, codes] of Object.entries(bySeries)) {
    const values = new Set(codes.map((c) => gas[c]));
    if (values.size > 1) {
      problems.push(`${area}: ${codes.map((c) => `${c}=${gas[c]}`).join(' ')}`);
    }
  }
  assert.deepEqual(problems, []);
});
