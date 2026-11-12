// D-027 src/data/profiles.js against the hand-entered evidence in tools/data/profiles/*.json.
// Every expected value here comes from the evidence JSON (recomputed in this file with
// integer cents) or from the orchestrator's hand-computed pins below. Never from the generator.
// The shape tests live in data-profiles.test.js; this file checks the numbers and sources.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const EVIDENCE_DIR = path.join(APP_ROOT, 'tools', 'data', 'profiles');
const PLATFORMS = ['dd', 'ue', 'gh'];
const CATEGORIES_JSON = path.join(APP_ROOT, 'tools', 'data', 'categories.json');
// Same patterns as tools/build-profiles.py: platform evidence uses re.search (any https host inside
// the string); a markup source uses URL_RE, which is anchored at the start and at the end.
const HTTPS_RE = /https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const MARKUP_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[^\s*]*)?$/;

// Hand-computed pins (orchestrator, from the evidence observations).
const PINNED = [
  ['little_caesars', 'Crazy Bread', 4.49],           // obs 3.49 / 4.49 / 5.99 (odd count)
  ['dominos', '5-Cheese Mac & Cheese', 9.49],        // obs 8.99 / 9.99 (even count, sum 1898 cents)
  ['subway', 'Italian B.M.T. Footlong', 11.49],      // obs 11.29 / 11.49 / 12.79
  ['papa_johns', '6 Piece Spicy Buffalo Wings', 8.99], // obs 8.94 / 8.99 / 9.99
  ['chipotle', 'Chicken Burrito', 10.40],            // obs 9.35 / 10.40 / 11.50
];
const PINNED_WINGSTOP_FEE = 2.99;                    // all three fee observations are 2.99

let cached = null;
function load() {
  if (!cached) {
    cached = loadData([
      'src/data/zips.js', 'src/data/brands.js', 'src/data/profiles.js', 'src/data/categories.js',
    ]);
  }
  return cached;
}

/** tools/data/categories.json, parsed. This is the source the generator reads, not categories.js. */
function readCategories() {
  return JSON.parse(fs.readFileSync(CATEGORIES_JSON, 'utf8'));
}

/** Every chain evidence file, parsed. */
function evidence() {
  return fs.readdirSync(EVIDENCE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, f), 'utf8')) }));
}

/** Price to integer cents. Inputs are 2-decimal JSON numbers, so Math.round is exact here. */
const toCents = (x) => Math.round(x * 100);

/**
 * Median in integer cents, per D-027: sort; odd count -> middle; even count -> (a+b)/2,
 * and when a+b is odd the half cent rounds UP, i.e. (a+b+1)/2.
 */
function medianCents(values) {
  const v = values.map(toCents).sort((a, b) => a - b);
  const n = v.length;
  if (n % 2 === 1) return v[(n - 1) / 2];
  const sum = v[n / 2 - 1] + v[n / 2];
  return sum % 2 === 0 ? sum / 2 : (sum + 1) / 2;
}

/** Zip -> state from ZIP_PACKED records "zip,lat,lon,cityIdx,state" joined by ";". */
function zipStates() {
  const map = new Map();
  for (const rec of load().ZIP_PACKED.split(';')) {
    const f = rec.split(',');
    map.set(f[0], f[4]);
  }
  return map;
}

function menuItem(id, name) {
  const item = load().PROFILES[id].menu.find((m) => m[0] === name);
  assert.ok(item, `${id}: no menu item "${name}"`);
  return item;
}

test('D-027 each evidence file is named <id>.json for its own id', () => {
  const bad = evidence().filter((e) => e.file !== `${e.data.id}.json`).map((e) => e.file);
  assert.deepEqual(bad, []);
});

test('D-027 pinned: little_caesars "Crazy Bread" median is 4.49', () => {
  assert.equal(menuItem('little_caesars', 'Crazy Bread')[1], 4.49);
});

test('D-027 pinned: dominos "5-Cheese Mac & Cheese" median is 9.49 (even count, rounds up)', () => {
  assert.equal(menuItem('dominos', '5-Cheese Mac & Cheese')[1], 9.49);
});

test('D-027 pinned: subway "Italian B.M.T. Footlong" median is 11.49', () => {
  assert.equal(menuItem('subway', 'Italian B.M.T. Footlong')[1], 11.49);
});

test('D-027 pinned: papa_johns "6 Piece Spicy Buffalo Wings" median is 8.99', () => {
  assert.equal(menuItem('papa_johns', '6 Piece Spicy Buffalo Wings')[1], 8.99);
});

test('D-027 pinned: chipotle "Chicken Burrito" median is 10.40', () => {
  assert.equal(menuItem('chipotle', 'Chicken Burrito')[1], 10.40);
});

test('D-027 pinned: wingstop directFee is 2.99', () => {
  assert.equal(load().PROFILES.wingstop.directFee, PINNED_WINGSTOP_FEE);
});

test('D-027 pinned values are the medians of their evidence observations', () => {
  const byId = new Map(evidence().map((e) => [e.data.id, e.data]));
  const problems = [];
  for (const [id, name, want] of PINNED) {
    const item = byId.get(id).menu.find((m) => m.name === name);
    if (!item) {
      problems.push(`${id}: no evidence item "${name}"`);
      continue;
    }
    const got = medianCents(item.prices.map((p) => p.price));
    if (got !== toCents(want)) problems.push(`${id} ${name}: evidence median ${got} cents, pin ${toCents(want)}`);
  }
  assert.deepEqual(problems, []);
});

test('D-027 every profile menu matches its evidence: same names, order and dealItem flags', () => {
  const { PROFILES } = load();
  const problems = [];
  for (const { data } of evidence()) {
    const want = data.menu.map((m) => [m.name, m.dealItem]);
    const got = PROFILES[data.id].menu.map((m) => [m[0], m[2]]);
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(data.id);
  }
  assert.deepEqual(problems, []);
});

test('D-027 every menu price equals the integer-cent median of its evidence observations', () => {
  const { PROFILES } = load();
  const problems = [];
  for (const { data } of evidence()) {
    data.menu.forEach((item, i) => {
      const want = medianCents(item.prices.map((p) => p.price));
      const got = toCents(PROFILES[data.id].menu[i][1]);
      if (got !== want) problems.push(`${data.id} "${item.name}": got ${got} cents, want ${want}`);
    });
  }
  assert.deepEqual(problems, []);
});

test('D-027 directFee equals the integer-cent median of its fee observations when directDelivery is true', () => {
  const { PROFILES } = load();
  const problems = [];
  let checked = 0;
  for (const { data } of evidence()) {
    if (data.directDelivery !== true) continue;
    checked++;
    const want = medianCents(data.directFee.observed.map((o) => o.fee));
    const got = toCents(PROFILES[data.id].directFee);
    if (got !== want) problems.push(`${data.id}: got ${got} cents, want ${want}`);
  }
  assert.ok(checked > 0, 'no directDelivery chains were checked');
  assert.deepEqual(problems, []);
});

test('D-027 every observation zip exists in ZIP_PACKED and its state matches the observation', () => {
  const states = zipStates();
  const problems = [];
  const check = (where, obs) => {
    if (!states.has(obs.zip)) {
      problems.push(`${where}: zip ${obs.zip} not in ZIP_PACKED`);
    } else if (states.get(obs.zip) !== obs.state) {
      problems.push(`${where}: zip ${obs.zip} is ${states.get(obs.zip)}, observation says ${obs.state}`);
    }
  };
  for (const { data } of evidence()) {
    for (const item of data.menu) {
      for (const obs of item.prices) check(`${data.id} "${item.name}"`, obs);
    }
    if (data.directFee && Array.isArray(data.directFee.observed)) {
      for (const obs of data.directFee.observed) check(`${data.id} directFee`, obs);
    }
  }
  assert.ok(problems.length === 0, problems.join('\n'));
});

test('D-027 useCategory markup: markupEst is true and each listed platform equals categories.json for the brand category', () => {
  const { PROFILES, BRANDS } = load();
  const cats = readCategories();
  const problems = [];
  let checked = 0;
  for (const { data } of evidence()) {
    if (!data.markup || data.markup.useCategory !== true) continue;
    checked++;
    const p = PROFILES[data.id];
    const cat = BRANDS[data.id] && BRANDS[data.id].category;
    if (p.markupEst !== true) problems.push(`${data.id}: markupEst ${p.markupEst}`);
    if (!cats[cat]) {
      problems.push(`${data.id}: no categories.json entry for "${cat}"`);
      continue;
    }
    for (const k of Object.keys(data.platforms)) {
      const want = cats[cat].markup[k];
      if (typeof want !== 'number') problems.push(`${data.id}.${k}: categories.json ${cat} has no ${k} markup`);
      if (p.markup[k] !== want) problems.push(`${data.id}.${k}: got ${p.markup[k]}, categories.json ${cat} ${want}`);
    }
  }
  assert.ok(checked > 0, 'no useCategory chains were checked');
  assert.deepEqual(problems, []);
});

test('D-021 CATEGORY_DEFAULTS in categories.js equals tools/data/categories.json markup for all 10 categories', () => {
  const { CATEGORY_DEFAULTS } = load();
  const cats = readCategories();
  const names = Object.keys(cats).sort();
  assert.equal(names.length, 10);
  assert.deepEqual(Object.keys(CATEGORY_DEFAULTS).sort(), names);
  const problems = [];
  for (const c of names) {
    for (const k of PLATFORMS) {
      if (CATEGORY_DEFAULTS[c].markup[k] !== cats[c].markup[k]) {
        problems.push(`${c}.${k}: categories.js ${CATEGORY_DEFAULTS[c].markup[k]}, json ${cats[c].markup[k]}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('D-027 every profile: markupEst equals (useCategory is true), and sourced markup keeps the evidence values', () => {
  const { PROFILES } = load();
  const files = evidence();
  const problems = [];
  let checked = 0;
  for (const { data } of files) {
    const p = PROFILES[data.id];
    if (!p) {
      problems.push(`${data.id}: no PROFILES entry`);
      continue;
    }
    if (!data.markup) {
      problems.push(`${data.id}: no markup block in evidence`);
      continue;
    }
    checked++;
    const useCat = data.markup.useCategory === true;
    if (p.markupEst !== useCat) problems.push(`${data.id}: markupEst ${p.markupEst}, evidence useCategory ${useCat}`);
    if (!useCat) {
      if (!(typeof data.markup.source === 'string' && MARKUP_URL_RE.test(data.markup.source))) {
        problems.push(`${data.id}: sourced markup needs an https source URL`);
      }
      for (const k of Object.keys(data.platforms)) {
        if (p.markup[k] !== data.markup[k]) problems.push(`${data.id}.${k}: got ${p.markup[k]}, evidence ${data.markup[k]}`);
      }
    }
  }
  assert.ok(files.length > 0, 'no evidence files found');
  assert.equal(checked, files.length, 'every evidence file must be checked');
  assert.deepEqual(problems, []);
});

test('D-027 platforms equals the evidence platform keys in dd, ue, gh order', () => {
  const { PROFILES } = load();
  const problems = [];
  for (const { data } of evidence()) {
    const want = PLATFORMS.filter((k) => Object.prototype.hasOwnProperty.call(data.platforms, k));
    const got = PROFILES[data.id].platforms;
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${data.id}: got ${got}, want ${want}`);
  }
  assert.deepEqual(problems, []);
});

test('D-027 every platform evidence string cites an https:// source', () => {
  const problems = [];
  for (const { data } of evidence()) {
    for (const [k, ev] of Object.entries(data.platforms)) {
      if (typeof ev !== 'string' || !HTTPS_RE.test(ev)) problems.push(`${data.id}.${k}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('D-027 the set of evidence file ids equals the set of PROFILES keys', () => {
  const fileIds = evidence().map((e) => e.data.id).sort();
  const profileIds = Object.keys(load().PROFILES).sort();
  assert.deepEqual(fileIds, profileIds);
});
