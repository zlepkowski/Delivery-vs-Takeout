// geo.test.js: POD.geo (docs/geo-contract.md, D-030, BUILD.md section 8).
//
// Expected values come only from tests/fixtures/geo/synthetic.json (hand-worked), real.json
// (the Python reference), the contract, and literal facts. Nothing is copied from geo.js output.
// The generated tests mirror tests/oracle/geo_runner.js: D is built the same way, and each call
// is checked for purity (arguments unchanged, no POD.data / POD.S / Date read, a second call
// after the first result is scribbled over gives the same answer).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, APP_ROOT, scriptOrder } = require('../helpers/load');

const FIX = path.join(APP_ROOT, 'tests', 'fixtures', 'geo');
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const SYN = readFixture('synthetic.json');
const REAL = readFixture('real.json');

const MIN_SYNTHETIC_CASES = 129;
const MIN_REAL_CASES = 71;

// Contract section for each call, used in test names.
const SECTION = {
  distMi: '§2', zipCount: '§3', zipByCode: '§3', nearestZip: '§3', zipSpacing: '§4',
  estimateMiles: '§5', tripMiles: '§6', cellOf: '§7', cellsFor: '§7', tilePath: '§7',
  storesNear: '§9', nearestStore: '§10'
};
// Where D goes in each call's arguments (contract §1), as in tests/oracle/geo_runner.js.
const D_POS = {
  zipCount: 0, zipByCode: 1, nearestZip: 2, zipSpacing: 1, estimateMiles: 2,
  cellsFor: 3, storesNear: 2, nearestStore: 3
};
const TAGS = { __NaN__: NaN, __Infinity__: Infinity, '__-Infinity__': -Infinity };
// Unrounded numbers, compared with relative tolerance 1e-9 (contract §2).
const TOLERANT_KEYS = new Set(['mi', 'spacing', 'zipsPerStore']);
const BAD_NUMBERS = [NaN, Infinity, -Infinity, undefined];
const GEO_NAMES = [
  'distMi', 'zipCount', 'zipByCode', 'nearestZip', 'zipSpacing', 'estimateMiles', 'tripMiles',
  'cellOf', 'cellsFor', 'tilePath', 'storesNear', 'nearestStore'
];

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- helpers ----------------------------------------------------------------

/** Replaces the "__NaN__" style tags in fixture args with the numbers they stand for. Returns a fresh copy. */
function untag(v) {
  if (typeof v === 'string' && hasOwn(TAGS, v)) return TAGS[v];
  if (Array.isArray(v)) return v.map(untag);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = untag(v[k]);
    return o;
  }
  return v;
}

/** A JSON-like copy that keeps non-finite numbers and undefined visible, for before/after comparisons. */
function snap(v) {
  if (v === undefined) return '__undefined__';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '__nonfinite__' + String(v);
  if (typeof v === 'function' || typeof v === 'symbol') return '__' + typeof v + '__';
  if (Array.isArray(v)) return v.map(snap);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = snap(v[k]);
    return o;
  }
  return v;
}

function describe(v) {
  try { return JSON.stringify(snap(v)); } catch (e) { return String(v); }
}

/** Compares an actual result with a fixture expectation (JSON-shaped). NaN and Infinity always fail. */
function compareValue(actual, expected, where, tolerant) {
  if (expected === null) {
    assert.ok(actual === null, `${where}: expected null, actual ${describe(actual)}`);
    return;
  }
  if (typeof expected === 'number') {
    assert.ok(typeof actual === 'number', `${where}: expected ${expected}, actual ${describe(actual)}`);
    assert.ok(Number.isFinite(actual), `${where}: expected ${expected}, actual ${actual}`);
    if (tolerant) {
      const tol = 1e-9 * Math.max(1, Math.abs(expected));
      assert.ok(Math.abs(actual - expected) <= tol, `${where}: expected ${expected}, actual ${actual}`);
    } else {
      assert.ok(actual === expected, `${where}: expected ${expected}, actual ${actual}`);
    }
    return;
  }
  if (typeof expected === 'string' || typeof expected === 'boolean') {
    assert.ok(actual === expected, `${where}: expected ${JSON.stringify(expected)}, actual ${describe(actual)}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array, actual ${describe(actual)}`);
    assert.equal(actual.length, expected.length, `${where}: array length`);
    for (let i = 0; i < expected.length; i++) compareValue(actual[i], expected[i], `${where}[${i}]`, tolerant);
    return;
  }
  assert.ok(actual !== null && typeof actual === 'object' && !Array.isArray(actual),
    `${where}: expected an object, actual ${describe(actual)}`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: object keys`);
  for (const k of Object.keys(expected)) {
    compareValue(actual[k], expected[k], `${where}.${k}`, TOLERANT_KEYS.has(k));
  }
}

/** Overwrites every field of a result, the way careless caller code might. */
function scribble(v) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { scribble(v[i]); v[i] = 'SCRIBBLED'; }
    v.push('SCRIBBLED');
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) { scribble(v[k]); v[k] = 'SCRIBBLED'; }
  }
}

/** Everything a call could mutate: D without its (immutable) ZIP string, and the other arguments. */
function fingerprint(D, rawArgs) {
  let d = null;
  if (D !== null && typeof D === 'object') {
    d = {};
    for (const k of Object.keys(D)) if (k !== 'ZIP_PACKED') d[k] = D[k];
  }
  return JSON.stringify(snap([d, rawArgs]));
}

function restoreProp(obj, key, desc) {
  if (desc) Object.defineProperty(obj, key, desc);
  else delete obj[key];
}

/** Runs fn with POD.data, POD.S and Date unavailable, so the call can only read its arguments. */
function withTraps(sb, fn) {
  const POD = sb.POD;
  const savedData = Object.getOwnPropertyDescriptor(POD, 'data');
  const savedS = Object.getOwnPropertyDescriptor(POD, 'S');
  const hadDate = hasOwn(sb, 'Date');
  const savedDate = sb.Date;
  const trap = (what) => ({
    configurable: true,
    get() { throw new Error('purity: the call read ' + what); }
  });
  Object.defineProperty(POD, 'data', trap('POD.data'));
  Object.defineProperty(POD, 'S', trap('POD.S'));
  sb.Date = function () { throw new Error('purity: the call used Date'); };
  try {
    return fn();
  } finally {
    restoreProp(POD, 'data', savedData);
    restoreProp(POD, 'S', savedS);
    if (hadDate) sb.Date = savedDate; else delete sb.Date;
  }
}

function callGeo(sb, name, args) {
  return withTraps(sb, () => sb.POD.geo[name].apply(null, args));
}

/** Arguments with D put where contract section 1 says. */
function fullArgs(call, D, rawArgs) {
  const a = rawArgs.slice();
  if (D !== null && hasOwn(D_POS, call)) a.splice(D_POS[call], 0, D);
  return a;
}

// ---- datasets and sandboxes ---------------------------------------------------

/** A dataset from synthetic.json, JSON-copied, with its patch applied (as in geo_runner.js). */
function synthD(c) {
  if (c.data === 'real') throw new Error('synthD called for a real case');
  if (!hasOwn(SYN.datasets, c.data)) throw new Error('unknown dataset ' + c.data);
  const D = JSON.parse(JSON.stringify(SYN.datasets[c.data]));
  for (const [k, v] of Object.entries(c.patch || {})) D[k] = JSON.parse(JSON.stringify(v));
  return D;
}

/** A synthetic dataset by name, with top-level keys replaced by `patch` (a JSON value per key). */
function synD(name, patch) {
  return synthD({ data: name, patch: patch || {} });
}

const STORES = path.join('tests', 'fixtures', 'stores');
const TILE_FILES = fs.readdirSync(path.join(APP_ROOT, STORES))
  .filter((f) => f.endsWith('.js')).sort().map((f) => path.join(STORES, f));

// The synthetic sandbox runs only pod.js and geo.js, so it cannot see the app's data.
const synSb = loadApp({ only: ['pod.js', 'geo.js'] });
// The real sandbox runs the whole app plus every fixture tile, as the oracle runner does.
const realSb = loadApp({ extra: TILE_FILES });
const REAL_DATA = realSb.POD.data;

/** The real D for a real case: POD.data with the listed tiles (default all), tileRun applied. */
function realD(c) {
  const D = {};
  for (const k of Object.keys(REAL_DATA)) if (k !== 'TILES') D[k] = REAL_DATA[k];
  const cells = c.tiles === undefined || c.tiles === null ? Object.keys(REAL_DATA.TILES) : c.tiles;
  D.TILES = {};
  for (const cell of cells) D.TILES[cell] = REAL_DATA.TILES[cell];
  for (const [cell, run] of Object.entries(c.tileRun || {})) {
    D.TILES[cell] = { run, s: REAL_DATA.TILES[cell].s };
  }
  return D;
}

function caseById(fixture, id) {
  const hits = fixture.cases.filter((c) => c.id === id);
  assert.equal(hits.length, 1, `fixture case "${id}" should exist exactly once`);
  return hits[0];
}

// ---- generated: every fixture case ---------------------------------------------

/** Runs one fixture case on sb with D, checking the expectation and purity. */
function runCase(sb, c, D) {
  assert.equal(typeof sb.POD.geo[c.call], 'function', `POD.geo.${c.call} is not a function`);
  const rawArgs = untag(c.args);
  assert.ok(Array.isArray(rawArgs), 'args must be an array');
  const tolerant = c.call === 'distMi' || c.call === 'zipSpacing';
  const before = fingerprint(D, rawArgs);
  const first = callGeo(sb, c.call, fullArgs(c.call, D, rawArgs));
  assert.equal(fingerprint(D, rawArgs), before, 'the call changed its arguments (D, opts or a record)');
  const shot = JSON.stringify(snap(first));
  compareValue(first, c.expect, 'result', tolerant);
  scribble(first);
  const again = callGeo(sb, c.call, fullArgs(c.call, D, rawArgs));
  assert.equal(JSON.stringify(snap(again)), shot,
    'a second call differed after the first result was scribbled over (a returned object is shared with a cache)');
}

function sectionOf(call) {
  return SECTION[call] || '§0';
}

test('D-030 §0 the fixture files hold at least 129 synthetic and 71 real cases, with unique ids', () => {
  assert.ok(SYN.cases.length >= MIN_SYNTHETIC_CASES,
    `synthetic.json has ${SYN.cases.length} cases, expected at least ${MIN_SYNTHETIC_CASES}`);
  assert.ok(REAL.cases.length >= MIN_REAL_CASES,
    `real.json has ${REAL.cases.length} cases, expected at least ${MIN_REAL_CASES}`);
  for (const [name, cases] of [['synthetic', SYN.cases], ['real', REAL.cases]]) {
    const ids = new Set(cases.map((c) => c.id));
    assert.equal(ids.size, cases.length, `${name} case ids must be unique`);
  }
});

for (const c of SYN.cases) {
  test(`D-030 ${sectionOf(c.call)} synthetic: ${c.id}`, () => {
    const D = c.data === null || c.data === undefined ? null : synthD(c);
    runCase(synSb, c, D);
  });
}

for (const c of REAL.cases) {
  test(`D-030 ${sectionOf(c.call)} real: ${c.id}`, () => {
    if (c.data !== 'real') throw new Error(`real case ${c.id} has data ${c.data}`);
    runCase(realSb, c, realD(c));
  });
}

// ---- named done-when checks ----------------------------------------------------

test('BUILD.md §13.5 59011 vs 10118 Domino\'s estimates differ by ≥10×', () => {
  const G = realSb.POD.geo;
  const D = realD({});
  const rec10118 = G.zipByCode('10118', D);
  const rec59011 = G.zipByCode('59011', D);
  assert.ok(rec10118 && rec59011, 'both ZIPs must be in the table');
  const a = G.estimateMiles(rec10118, 'dominos', D);
  const b = G.estimateMiles(rec59011, 'dominos', D);
  assert.ok(a && b, 'both estimates must exist');
  // Pinned from real.json (estimateMiles 10118 dominos / 59011 dominos).
  assert.equal(a.one, 0.4);
  assert.equal(a.round, 1.1);
  assert.equal(b.one, 10.4);
  assert.equal(b.round, 25.9);
  assert.ok(b.one >= 10 * a.one, `one: ${b.one} vs ${a.one}`);
  assert.ok(b.round >= 10 * a.round, `round: ${b.round} vs ${a.round}`);
});

test('D-030 §4 an uncached zipSpacing averages under 10 ms', () => {
  const G = realSb.POD.geo;
  const D = realD({});
  // Warm up: the table is unpacked, and one spacing is computed.
  assert.equal(G.zipCount(D), caseById(REAL, 'zipCount').expect);
  const warm = G.zipByCode('10118', D);
  assert.ok(typeof G.zipSpacing(warm, D) === 'number', 'warm-up spacing must be a number');

  // Fifty records: every 847th raw record of ZIP_PACKED, starting at index 5.
  const raws = D.ZIP_PACKED.split(';');
  const recs = [];
  for (let k = 0; k < 50; k++) {
    const f = raws[5 + 847 * k].split(',');
    recs.push({ zip: f[0], la: Number(f[1]) / 1000, lo: Number(f[2]) / 1000 });
  }
  const points = new Set(recs.map((r) => r.la + ',' + r.lo));
  points.add(warm.la + ',' + warm.lo);
  assert.equal(points.size, 51, 'the 50 query points must be distinct and uncached');
  assert.equal(new Set(recs.map((r) => r.zip)).size, 50, 'the 50 ZIPs must be distinct');

  const t0 = process.hrtime.bigint();
  const values = recs.map((r) => G.zipSpacing(r, D));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  for (let i = 0; i < values.length; i++) {
    assert.ok(typeof values[i] === 'number' && Number.isFinite(values[i]),
      `spacing ${i} (${recs[i].zip}) must be a finite number, got ${values[i]}`);
  }
  const mean = ms / values.length;
  assert.ok(mean < 10, `mean uncached zipSpacing ${mean.toFixed(3)} ms, limit 10 ms`);
});

test('D-021 storesNear finds stores outside the user\'s own cell', () => {
  const G = realSb.POD.geo;
  const both = realD({ tiles: ['40_-74', '40_-75'] });
  const r = G.storesNear(40.749, -73.986, both);
  assert.equal(r.status, 'ok');
  assert.ok(r.stores.some((s) => G.cellOf(s.lat, s.lon) !== '40_-74'),
    'at least one store must lie outside cell 40_-74');

  // With 40_-75 reported failed (and not loaded), the result is partial.
  const own = realD({ tiles: ['40_-74'] });
  const p = G.storesNear(40.749, -73.986, own, { failed: { '40_-75': true } });
  assert.equal(p.status, 'ok');
  assert.equal(p.partial, true);
});

// ---- malformed input (contract §0, §3, §7, §8) ----------------------------------

test('D-030 §0 a NaN, an infinite or a missing lat or lon gives null, never a throw', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  const T1 = synD('T1');
  for (const bad of BAD_NUMBERS) {
    const tag = String(bad);
    assert.equal(G.distMi(bad, 0, 10, 0), null, `distMi lat1=${tag}`);
    assert.equal(G.distMi(0, bad, 10, 0), null, `distMi lon1=${tag}`);
    assert.equal(G.distMi(0, 0, bad, 0), null, `distMi lat2=${tag}`);
    assert.equal(G.distMi(0, 0, 10, bad), null, `distMi lon2=${tag}`);
    assert.equal(G.cellOf(bad, 0), null, `cellOf lat=${tag}`);
    assert.equal(G.cellOf(0, bad), null, `cellOf lon=${tag}`);
    assert.equal(G.nearestZip(bad, 0, Z1), null, `nearestZip lat=${tag}`);
    assert.equal(G.nearestZip(0, bad, Z1), null, `nearestZip lon=${tag}`);
    assert.equal(G.zipSpacing({ la: bad, lo: 0 }, Z1), null, `zipSpacing la=${tag}`);
    assert.equal(G.zipSpacing({ la: 0, lo: bad }, Z1), null, `zipSpacing lo=${tag}`);
    assert.equal(G.estimateMiles({ la: bad, lo: 0 }, 'b1', Z1), null, `estimateMiles la=${tag}`);
    assert.equal(G.estimateMiles({ la: 0, lo: bad }, 'b1', Z1), null, `estimateMiles lo=${tag}`);
    assert.equal(G.storesNear(bad, 0.5, T1), null, `storesNear lat=${tag}`);
    assert.equal(G.storesNear(10.5, bad, T1), null, `storesNear lon=${tag}`);
    assert.equal(G.nearestStore(bad, 0.5, 's00', T1), null, `nearestStore lat=${tag}`);
    assert.equal(G.nearestStore(10.5, bad, 's00', T1), null, `nearestStore lon=${tag}`);
    assert.equal(G.cellsFor(bad, 0, 5, T1), null, `cellsFor lat=${tag}`);
    assert.equal(G.cellsFor(0, bad, 5, T1), null, `cellsFor lon=${tag}`);
  }
  assert.equal(G.zipSpacing(undefined, Z1), null, 'zipSpacing with no record');
  assert.equal(G.zipSpacing(null, Z1), null, 'zipSpacing with a null record');
});

test('D-030 §7 a NaN, an infinite, a missing or a non-positive radius gives null from cellsFor', () => {
  const G = synSb.POD.geo;
  const T1 = synD('T1');
  for (const bad of [...BAD_NUMBERS, 0, -5, '5']) {
    assert.equal(G.cellsFor(10.5, 0.5, bad, T1), null, `cellsFor r=${String(bad)}`);
  }
});

test('D-030 §6 a NaN, an infinite, a missing or a negative straight-line distance gives null from tripMiles', () => {
  const G = synSb.POD.geo;
  for (const bad of [...BAD_NUMBERS, -1, '1']) {
    assert.equal(G.tripMiles(bad), null, `tripMiles(${String(bad)})`);
  }
});

test('D-030 §0 a missing or wrong-typed D gives null (zipCount gives 0), never a throw', () => {
  const G = synSb.POD.geo;
  for (const D of [undefined, null, 'x', [], 5]) {
    const tag = describe(D);
    assert.equal(G.zipCount(D), 0, `zipCount(${tag})`);
    assert.equal(G.zipByCode('00001', D), null, `zipByCode(${tag})`);
    assert.equal(G.nearestZip(10, 0, D), null, `nearestZip(${tag})`);
    assert.equal(G.zipSpacing({ la: 10, lo: 0 }, D), null, `zipSpacing(${tag})`);
    assert.equal(G.estimateMiles({ la: 10, lo: 0 }, 'b1', D), null, `estimateMiles(${tag})`);
    assert.equal(G.storesNear(10.5, 0.5, D), null, `storesNear(${tag})`);
    assert.equal(G.nearestStore(10.5, 0.5, 's00', D), null, `nearestStore(${tag})`);
    assert.equal(G.cellsFor(10.5, 0.5, 5, D), null, `cellsFor(${tag})`);
  }
});

test('D-030 §8 a null tile, or a tile whose s is not a string, makes the result partial and never throws', () => {
  const G = synSb.POD.geo;
  const tile11 = SYN.datasets.T1.TILES['11_0'];
  const bad = [null, 'text', { run: 'run-A', s: 5 }, { run: 'run-A', s: null }];
  for (const tile of bad) {
    const D = synD('T1', { TILES: { '10_0': tile, '11_0': tile11 } });
    const tag = describe(tile);
    const r = G.storesNear(10.5, 0.5, D);
    assert.equal(r.status, 'ok', `storesNear with 10_0 = ${tag}`);
    assert.equal(r.partial, true, `storesNear partial with 10_0 = ${tag}`);
    assert.equal(r.radius, 50, `storesNear radius with 10_0 = ${tag}`);
    const n = G.nearestStore(10.5, 0.5, 's00', D);
    assert.equal(n.status, 'ok', `nearestStore with 10_0 = ${tag}`);
    assert.equal(n.partial, true, `nearestStore partial with 10_0 = ${tag}`);
  }
});

test('D-030 §8 a BRAND_IDS entry that is not a string is skipped, never a throw', () => {
  const G = synSb.POD.geo;
  for (const entry of [5, null, {}, ['s00']]) {
    const ids = SYN.datasets.T1.BRAND_IDS.slice();
    ids[0] = entry;
    const D = synD('T1', { BRAND_IDS: ids });
    const r = G.storesNear(10.5, 0.5, D);
    assert.equal(r.status, 'ok', `storesNear with BRAND_IDS[0] = ${describe(entry)}`);
    assert.ok(r.stores.every((s) => s.brand !== 's00'), 'no store of the skipped brand s00');
    assert.equal(G.nearestStore(10.5, 0.5, 's00', D), null, 's00 is no longer a brand id');
    const other = G.nearestStore(10.5, 0.5, 's01', D);
    assert.equal(other.status, 'ok');
    assert.equal(other.store.brand, 's01');
  }
});

test('D-030 §8 a brand id of "__proto__" in BRAND_IDS finds no store and never throws', () => {
  const G = synSb.POD.geo;
  const ids = SYN.datasets.T1.BRAND_IDS.slice();
  ids[0] = '__proto__';
  const D = synD('T1', { BRAND_IDS: ids });
  const r = G.storesNear(10.5, 0.5, D);
  assert.equal(r.status, 'ok');
  assert.ok(r.stores.every((s) => s.brand !== '__proto__'), 'no store of the prototype key');
  const n = G.nearestStore(10.5, 0.5, '__proto__', D);
  assert.equal(n.status, 'ok');
  assert.equal(n.store, null, 'a brand id with no own BRANDS entry has no store');
});

test('D-030 §5 "constructor", "__proto__" and "hasOwnProperty" are not brands and not ZIP codes', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  const T1 = synD('T1');
  for (const id of ['constructor', '__proto__', 'hasOwnProperty']) {
    assert.equal(G.estimateMiles({ la: 10, lo: 0 }, id, Z1), null, `estimateMiles ${id}`);
    assert.equal(G.nearestStore(10.5, 0.5, id, T1), null, `nearestStore ${id}`);
    assert.equal(G.zipByCode(id, Z1), null, `zipByCode ${id}`);
  }
});

// ---- purity and isolation (contract §0, §3, §4) ----------------------------------

test('D-030 §0 no call changes D or opts', () => {
  const G = synSb.POD.geo;
  const T1 = synD('T1');
  const Z1 = synD('Z1');
  const opts = { failed: { '11_0': true } };
  const dBefore = JSON.stringify(T1);
  const zBefore = JSON.stringify(Z1);
  const oBefore = JSON.stringify(opts);
  G.storesNear(10.5, 0.5, T1, opts);
  G.nearestStore(10.5, 0.5, 's15', T1, opts);
  G.nearestStore(10.5, 0.5, 'zz', T1, opts);
  G.zipCount(T1);
  G.zipByCode('00001', Z1);
  G.nearestZip(10, 0, Z1);
  G.zipSpacing({ la: 10, lo: 0 }, Z1);
  G.estimateMiles({ la: 10, lo: 0 }, 'b10', Z1);
  G.cellsFor(10.5, 0.5, 25, T1);
  assert.equal(JSON.stringify(T1), dBefore, 'T1 unchanged');
  assert.equal(JSON.stringify(Z1), zBefore, 'Z1 unchanged');
  assert.equal(JSON.stringify(opts), oBefore, 'opts unchanged');
});

test('D-030 §0 a record or store the caller changes does not change the next result', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  const T1 = synD('T1');

  const rec = G.zipByCode('00001', Z1);
  rec.la = 99; rec.lo = 99; rec.c = 'X'; rec.z = '99999'; rec.st = 'ZZ';
  compareValue(G.zipByCode('00001', Z1), caseById(SYN, 'Z1 zipByCode first of the stacked codes').expect, 'zipByCode');

  const near = G.nearestZip(10, 0, Z1);
  scribble(near);
  compareValue(G.nearestZip(10, 0, Z1), caseById(SYN, 'Z1 nearestZip tie at the query point -> smaller zip').expect,
    'nearestZip');

  const est = G.estimateMiles({ la: 10, lo: 0 }, 'b10', Z1);
  scribble(est);
  compareValue(G.estimateMiles({ la: 10, lo: 0 }, 'b10', Z1),
    caseById(SYN, 'Z1 estimateMiles, 10 stores, 10 ZIPs').expect, 'estimateMiles');

  const s = G.storesNear(10.5, 0.5, T1);
  scribble(s);
  compareValue(G.storesNear(10.5, 0.5, T1),
    caseById(SYN, 'T1 storesNear widens to 25 and stops at exactly 15 brands').expect, 'storesNear');

  const n = G.nearestStore(10.5, 0.5, 's00', T1);
  scribble(n);
  compareValue(G.nearestStore(10.5, 0.5, 's00', T1),
    caseById(SYN, 'T1 nearestStore s00 picks its nearer store').expect, 'nearestStore');
});

test('D-030 §3 alternating two ZIP tables gives each its own answers', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  const real = realD({});
  compareValue(G.zipCount(Z1), 10, 'Z1 count');
  compareValue(G.zipCount(real), caseById(REAL, 'zipCount').expect, 'real count');
  compareValue(G.zipCount(Z1), 10, 'Z1 count again');
  compareValue(G.zipByCode('00001', Z1), caseById(SYN, 'Z1 zipByCode first of the stacked codes').expect, 'Z1 00001');
  compareValue(G.zipByCode('10118', real), caseById(REAL, 'zipByCode 10118').expect, 'real 10118');
  compareValue(G.zipByCode('00001', Z1), caseById(SYN, 'Z1 zipByCode first of the stacked codes').expect, 'Z1 00001 again');
  compareValue(G.zipSpacing({ la: 10, lo: 0 }, Z1),
    caseById(SYN, 'Z1 zipSpacing 00001: distinct points, own point excluded').expect, 'Z1 spacing', true);
  compareValue(G.zipSpacing(G.zipByCode('10118', real), real), caseById(REAL, 'zipSpacing 10118').expect,
    'real spacing', true);
  compareValue(G.zipSpacing({ la: 10, lo: 0 }, Z1),
    caseById(SYN, 'Z1 zipSpacing 00001: distinct points, own point excluded').expect, 'Z1 spacing again', true);
});

test('D-030 §3 the same ZIP_PACKED with other ZIP_CITIES gives the new city', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  const cities = Z1.ZIP_CITIES.slice();
  cities[0] = 'Omega';
  const Z2 = synD('Z1', { ZIP_CITIES: cities });
  assert.equal(G.zipByCode('00001', Z1).c, 'Alpha');
  assert.equal(G.zipByCode('00001', Z2).c, 'Omega');
  assert.equal(G.zipByCode('00001', Z1).c, 'Alpha', 'the first table still answers with its own city');
});

test('D-030 §8 the same cell and run with another s gives the new stores', () => {
  const G = synSb.POD.geo;
  const T1 = synD('T1');
  const other = synD('T1', {
    TILES: { '10_0': { run: 'run-A', s: '0,10500,500' }, '11_0': SYN.datasets.T1.TILES['11_0'] }
  });
  const first = G.storesNear(10.5, 0.5, T1);
  compareValue(first, caseById(SYN, 'T1 storesNear widens to 25 and stops at exactly 15 brands').expect, 'T1 first');
  const alt = G.storesNear(10.5, 0.5, other);
  assert.equal(alt.stores[0].id, 's00@10500,500', 'the new tile holds one store at the query point');
  assert.equal(alt.stores[0].mi, 0);
  assert.equal(G.nearestStore(10.5, 0.5, 's00', other).store.id, 's00@10500,500');
  compareValue(G.nearestStore(10.5, 0.5, 's00', T1),
    caseById(SYN, 'T1 nearestStore s00 picks its nearer store').expect, 'T1 back to the original tile');
});

test('D-030 §3 the ZIP table cache still answers after more than 8 distinct tables', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  for (let i = 0; i < 12; i++) {
    const zip = String(10000 + i);
    const D = { ZIP_PACKED: zip + ',10000,0,0,AA', ZIP_CITIES: ['Alpha'], BRANDS: {}, BRANDS_RUN: 'x' };
    assert.equal(G.zipCount(D), 1, `table ${i} count`);
    assert.equal(G.zipByCode(zip, D).z, zip, `table ${i} lookup`);
  }
  compareValue(G.zipCount(Z1), 10, 'Z1 count after the bound');
  compareValue(G.zipByCode('00001', Z1), caseById(SYN, 'Z1 zipByCode first of the stacked codes').expect, 'Z1 00001 after the bound');
  compareValue(G.zipSpacing({ la: 10, lo: 0 }, Z1),
    caseById(SYN, 'Z1 zipSpacing 00001: distinct points, own point excluded').expect, 'Z1 spacing after the bound', true);
});

test('D-030 §4 the spacing cache still answers after more than 20,000 distinct points', () => {
  const G = synSb.POD.geo;
  const Z1 = synD('Z1');
  for (let i = 0; i < 20050; i++) {
    G.zipSpacing({ la: 1 + i * 0.00001, lo: 0.5 }, Z1);
  }
  compareValue(G.zipSpacing({ la: 10, lo: 0 }, Z1),
    caseById(SYN, 'Z1 zipSpacing 00001: distinct points, own point excluded').expect, 'Z1 spacing after the bound', true);
});

// ---- index.html and the exposed surface (contract §1) ----------------------------

test('D-030 §1 index.html loads pod.js, then engine.js, then geo.js, then app.js', () => {
  const order = scriptOrder();
  const at = (p) => order.indexOf(p);
  assert.ok(at('src/js/geo.js') > -1, 'src/js/geo.js is listed');
  assert.ok(at('src/js/pod.js') < at('src/js/geo.js'), 'pod.js before geo.js');
  assert.ok(at('src/js/engine.js') < at('src/js/geo.js'), 'engine.js before geo.js');
  assert.ok(at('src/js/geo.js') < at('src/js/app.js'), 'geo.js before app.js');
});

test('D-030 §1 POD.geo exposes every name in the contract, with the constants\' values', () => {
  const G = loadApp().POD.geo;
  assert.ok(G && typeof G === 'object', 'POD.geo is an object');
  for (const name of GEO_NAMES) assert.equal(typeof G[name], 'function', `POD.geo.${name}`);
  assert.equal(G.R_MI, 3958.8);
  assert.equal(G.ROAD, 1.25);
  assert.equal(JSON.stringify(G.RADII), '[5,10,25,50]');
  assert.equal(G.WANT, 15);
  assert.equal(G.NEIGHBORS, 6);
});

// ---- hand-worked checks that the fixtures don't reach ---------------------------

test('D-030 §4 zipSpacing falls back to a full scan when the ±1.2° band misses the six nearest points', () => {
  // Hand-worked. Along a meridian or the equator, distance = R x pi/180 x degrees (contract §2).
  // The query is (0, 0). The point (1.25, 0) is outside the latitude band of ±1.2, yet nearer
  // than the equator points at 3..8 degrees east. The six nearest are 1.25, 3, 4, 5, 6 and 7 degrees.
  const perDeg = 3958.8 * Math.PI / 180;
  const packed = '00001,1250,0,0,AA;00003,0,3000,0,AA;00004,0,4000,0,AA;00005,0,5000,0,AA;' +
    '00006,0,6000,0,AA;00007,0,7000,0,AA;00008,0,8000,0,AA';
  const D = { ZIP_PACKED: packed, ZIP_CITIES: ['Alpha'], BRANDS: {}, BRANDS_RUN: 'x' };
  const expected = (1.25 + 3 + 4 + 5 + 6 + 7) * perDeg / 6;
  compareValue(synSb.POD.geo.zipSpacing({ la: 0, lo: 0 }, D), expected, 'zipSpacing', true);
});

test('D-030 §6 tripMiles rounds a half up: a 0.1 mi straight line is 0.3 mi round trip', () => {
  // 0.1 x 2 x 1.25 = 0.25, and round1 is Math.round(x * 10) / 10 = 3 / 10 (half up, not to even or down).
  const G = synSb.POD.geo;
  assert.equal(G.tripMiles(0.1), 0.3);
});
