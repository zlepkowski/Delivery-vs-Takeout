// D-021 / D-027 src/data/categories.js: the default app markups for the 10 restaurant
// categories, used for unprofiled brands. Cross-checked against brands.js categories.
// Expected values come from the decisions, never from the generator.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const CATEGORIES_REL = 'src/data/categories.js';
const CATEGORIES = ['pizza', 'burger', 'chicken', 'mexican', 'sandwich', 'asian', 'coffee', 'dessert', 'casual', 'other'];
const PLATFORMS = ['dd', 'ue', 'gh'];

let cached = null;
function load() {
  if (!cached) cached = loadData(['src/data/brands.js', CATEGORIES_REL]);
  return cached;
}

test('D-027 src/data/categories.js exists', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, CATEGORIES_REL)), 'missing src/data/categories.js');
});

test('D-021 CATEGORY_DEFAULTS has exactly the 10 D-021 categories', () => {
  const { CATEGORY_DEFAULTS } = load();
  assert.ok(CATEGORY_DEFAULTS && typeof CATEGORY_DEFAULTS === 'object', 'CATEGORY_DEFAULTS must be an object');
  assert.deepEqual(Object.keys(CATEGORY_DEFAULTS).sort(), CATEGORIES.slice().sort());
});

test('D-027 each category default is exactly {markup, est}', () => {
  const { CATEGORY_DEFAULTS } = load();
  const bad = Object.keys(CATEGORY_DEFAULTS).filter(
    (c) => Object.keys(CATEGORY_DEFAULTS[c]).sort().join(',') !== 'est,markup'
  );
  assert.deepEqual(bad, []);
});

test('D-027 each category markup has exactly dd, ue and gh, with values 0 to 60', () => {
  const { CATEGORY_DEFAULTS } = load();
  const problems = [];
  for (const c of Object.keys(CATEGORY_DEFAULTS)) {
    const m = CATEGORY_DEFAULTS[c].markup;
    if (!m || typeof m !== 'object') {
      problems.push(`${c}: markup missing`);
      continue;
    }
    if (Object.keys(m).sort().join(',') !== PLATFORMS.slice().sort().join(',')) {
      problems.push(`${c}: markup keys ${Object.keys(m).join(',')}`);
    }
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 60) problems.push(`${c}: ${k} ${v}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('D-027 each category est flag is a boolean', () => {
  const { CATEGORY_DEFAULTS } = load();
  const bad = Object.keys(CATEGORY_DEFAULTS).filter((c) => typeof CATEGORY_DEFAULTS[c].est !== 'boolean');
  assert.deepEqual(bad, []);
});

test('D-021 every BRANDS category has a CATEGORY_DEFAULTS entry', () => {
  const { BRANDS, CATEGORY_DEFAULTS } = load();
  const missing = [...new Set(Object.keys(BRANDS).map((id) => BRANDS[id].category))]
    .filter((c) => !Object.prototype.hasOwnProperty.call(CATEGORY_DEFAULTS, c));
  assert.deepEqual(missing, []);
});
