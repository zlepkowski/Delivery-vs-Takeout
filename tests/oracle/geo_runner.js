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
// Each result is {ok: true, v} or {ok: false, err}. The runner also checks purity: a call
// that changes its arguments (D's tables, opts, rec) is reported as an error.
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
const POD = loadApp({ extra: tileFiles.map((f) => path.join(STORES, f)) }).POD;
const G = POD.geo;
const D_POS = { zipCount: 0, zipByCode: 1, nearestZip: 2, zipSpacing: 1, estimateMiles: 2,
  cellsFor: 3, storesNear: 2, nearestStore: 3 };
const { datasets, cases } = JSON.parse(fs.readFileSync(inFile, 'utf8'));

function realD(c) {
  const D = {};
  for (const k of Object.keys(POD.data)) if (k !== 'TILES') D[k] = POD.data[k];
  const all = POD.data.TILES;
  const cells = c.tiles === undefined || c.tiles === null ? Object.keys(all) : c.tiles;
  D.TILES = {};
  for (const cell of cells) D.TILES[cell] = all[cell];
  for (const [cell, run] of Object.entries(c.tileRun || {})) D.TILES[cell] = { run, s: all[cell].s };
  return D;
}

function synthD(c) {
  const D = JSON.parse(JSON.stringify(datasets[c.data]));
  for (const [k, v] of Object.entries(c.patch || {})) D[k] = JSON.parse(JSON.stringify(v));
  return D;
}

// A fingerprint of everything a call could mutate (the real ZIP string is immutable, so skip it).
function fingerprint(D, args) {
  const d = {};
  if (D) for (const k of Object.keys(D)) if (k !== 'ZIP_PACKED') d[k] = D[k];
  return JSON.stringify([d, args.filter((a) => a !== D)]);
}

const out = cases.map((c) => {
  try {
    const D = c.data === null || c.data === undefined ? null : (c.data === 'real' ? realD(c) : synthD(c));
    const args = JSON.parse(JSON.stringify(c.args));
    if (Object.prototype.hasOwnProperty.call(D_POS, c.call)) args.splice(D_POS[c.call], 0, D);
    if (typeof G[c.call] !== 'function') throw new Error('POD.geo.' + c.call + ' is not a function');
    const before = fingerprint(D, args);
    const v = G[c.call].apply(null, args);
    if (fingerprint(D, args) !== before) throw new Error('purity: the call changed its arguments');
    return { ok: true, v: v === undefined ? '__undefined__' : JSON.parse(JSON.stringify(v)) };
  } catch (err) {
    return { ok: false, err: String(err && err.stack || err) };
  }
});
fs.writeFileSync(outFile, JSON.stringify(out));
