// geo_runner.js: runs a batch of POD.geo calls through the real src/js/geo.js for the oracle.
//
//   node tests/oracle/geo_runner.js <requests.json> <results.json>
//
// requests.json is {datasets: {name: D}, cases: [{call, args, data, patch?, tiles?, tileRun?}]}.
//   data "real"  -> POD.data as index.html loads it, with D.TILES = the fixture tiles in
//                   tests/fixtures/stores/ (all of them, or the cells listed in `tiles`);
//                   `tileRun` replaces a tile's run id.
//   data <name>  -> a copy of datasets[name], with `patch` replacing whole top-level keys.
//   data null    -> the call takes no D.
// D is inserted into args at the position the contract gives (docs/geo-contract.md §1).
// The strings "__NaN__", "__Infinity__" and "__-Infinity__" in args stand for those numbers
// (JSON has no literal for them), and a non-finite number in a result is written back the
// same way, so a NaN or Infinity can never pass for null.
//
// Each result is {ok: true, v} or {ok: false, err}. Purity (contract §0) is checked three ways:
//   - a call that changes its arguments (D's tables, opts, rec) is an error;
//   - POD.data, POD.S and Date throw while the call runs (the code may read only its arguments);
//   - every call is made twice, with the first result scribbled over in between: if the
//     second result differs, a returned object was shared with a cache.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadApp, APP_ROOT } = require('../helpers/load');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('usage: node tests/oracle/geo_runner.js <requests.json> <results.json>');
  process.exit(2);
}

const STORES = path.join('tests', 'fixtures', 'stores');
const tileFiles = fs.readdirSync(path.join(APP_ROOT, STORES)).filter((f) => f.endsWith('.js')).sort();
const sandbox = loadApp({ extra: tileFiles.map((f) => path.join(STORES, f)) });
const POD = sandbox.POD;
const G = POD.geo;
const DATA = POD.data;
const D_POS = { zipCount: 0, zipByCode: 1, nearestZip: 2, zipSpacing: 1, estimateMiles: 2,
  cellsFor: 3, storesNear: 2, nearestStore: 3 };
const TAGS = { __NaN__: NaN, __Infinity__: Infinity, '__-Infinity__': -Infinity };
const { datasets, cases } = JSON.parse(fs.readFileSync(inFile, 'utf8'));

function realD(c) {
  const D = {};
  for (const k of Object.keys(DATA)) if (k !== 'TILES') D[k] = DATA[k];
  const cells = c.tiles === undefined || c.tiles === null ? Object.keys(DATA.TILES) : c.tiles;
  D.TILES = {};
  for (const cell of cells) D.TILES[cell] = DATA.TILES[cell];
  for (const [cell, run] of Object.entries(c.tileRun || {})) D.TILES[cell] = { run, s: DATA.TILES[cell].s };
  return D;
}

function synthD(c) {
  const D = JSON.parse(JSON.stringify(datasets[c.data]));
  for (const [k, v] of Object.entries(c.patch || {})) D[k] = JSON.parse(JSON.stringify(v));
  return D;
}

function untag(v) {
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(TAGS, v)) return TAGS[v];
  if (Array.isArray(v)) return v.map(untag);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = untag(v[k]);
    return o;
  }
  return v;
}

// JSON with non-finite numbers tagged and undefined made visible.
function encode(v) {
  if (v === undefined) return '__undefined__';
  return JSON.parse(JSON.stringify(v, (k, x) => {
    if (typeof x === 'number' && !isFinite(x)) return isNaN(x) ? '__NaN__' : (x > 0 ? '__Infinity__' : '__-Infinity__');
    if (x === undefined) return '__undefined__';
    return x;
  }));
}

// A fingerprint of everything a call could mutate (the real ZIP string is immutable, so skip it).
function fingerprint(D, args) {
  const d = {};
  if (D) for (const k of Object.keys(D)) if (k !== 'ZIP_PACKED') d[k] = D[k];
  return JSON.stringify(encode([d, args.filter((a) => a !== D)]));
}

// Overwrite every field of a result, recursively, the way careless caller code might.
function scribble(v) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { scribble(v[i]); v[i] = 'SCRIBBLED'; }
    v.push('SCRIBBLED');
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) { scribble(v[k]); v[k] = 'SCRIBBLED'; }
  }
}

function poisoned(fn) {
  const trap = (what) => ({ get() { throw new Error('purity: the call read ' + what); }, configurable: true });
  const savedDate = sandbox.Date;
  Object.defineProperty(POD, 'data', trap('POD.data'));
  Object.defineProperty(POD, 'S', trap('POD.S'));
  sandbox.Date = function () { throw new Error('purity: the call used Date'); };
  try {
    return fn();
  } finally {
    Object.defineProperty(POD, 'data', { value: DATA, writable: true, configurable: true, enumerable: true });
    delete POD.S;
    sandbox.Date = savedDate;
  }
}

const out = cases.map((c) => {
  try {
    const D = c.data === null || c.data === undefined ? null : (c.data === 'real' ? realD(c) : synthD(c));
    const args = untag(JSON.parse(JSON.stringify(c.args)));
    if (Object.prototype.hasOwnProperty.call(D_POS, c.call)) args.splice(D_POS[c.call], 0, D);
    if (typeof G[c.call] !== 'function') throw new Error('POD.geo.' + c.call + ' is not a function');
    const before = fingerprint(D, args);
    const first = poisoned(() => G[c.call].apply(null, args));
    if (fingerprint(D, args) !== before) throw new Error('purity: the call changed its arguments');
    const v = encode(first);
    scribble(first);
    const again = encode(poisoned(() => G[c.call].apply(null, args)));
    if (JSON.stringify(again) !== JSON.stringify(v)) {
      throw new Error('purity: a second call returned something else after the first result was changed ' +
        '(a returned object is shared with a cache)');
    }
    return { ok: true, v };
  } catch (err) {
    return { ok: false, err: String(err && err.stack || err) };
  }
});
fs.writeFileSync(outFile, JSON.stringify(out));
