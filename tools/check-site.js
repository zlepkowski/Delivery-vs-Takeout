#!/usr/bin/env node
// check-site.js: the D-039 gates on a built site folder (the output of tools/build-site.sh).
//
//   node tools/check-site.js OUT ROOT --as-of YYYY-MM-DD
//
// OUT is the built folder (index.html + src/). ROOT is the repo, whose committed
// src/data/brands.js, src/data/profiles.js and src/data/states.js are the reference.
//
// Gates (each prints FAIL or OK; any FAIL makes the exit code 1):
//   brands  at least 150 brands; every PROFILES key in BRANDS; TILE_INDEX cells = tile files;
//           TILE_INDEX counts sum to the stores in BRANDS
//   drift   total stores >= 80% of the committed total; each profiled brand >= 50% of its committed count
//   canary  storesNear at ZIP 10118 through the real src/js/geo.js on the built tiles: ok, not partial,
//           radius 5, >= 15 stores
//   states  same 51 codes in order; gasRegular in [1.50, 8.00]; mealTaxPct equal to ROOT's;
//           GRADE_ADD spreads in [0, 2.50]; GAS_WEEK a date from asOf - 14 days to asOf
//   es5     tools/es5-check.js passes on OUT/src
//
// Report lines (printed, never gating): the brands run, counts, GAS_WEEK, and Big Timber (ZIP 59011)
// to its nearest Domino's.
//
// Exports checkSite(out, root, asOf) -> {ok, failures: [{gate, msg}], report: [string]}.
// Node 22, CommonJS. Tools are not under the ES5 rule (only src/ is).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const childProcess = require('node:child_process');

const GATES = ['brands', 'drift', 'canary', 'states', 'es5'];
const MIN_BRANDS = 150;
const MIN_TOTAL_RATIO = 0.8;
const MIN_BRAND_RATIO = 0.5;
const GAS_MIN = 1.5;
const GAS_MAX = 8;
const GRADE_MIN = 0;
const GRADE_MAX = 2.5;
const MAX_GAS_AGE_DAYS = 14;
const CANARY_ZIP = '10118';
const CANARY_RADIUS = 5;
const CANARY_MIN_STORES = 15;
const BIG_TIMBER_ZIP = '59011';
const BIG_TIMBER_BRAND = 'dominos';
const MAX_TILE_ROUNDS = 6;
const DAY_MS = 86400000;

function isNum(x) { return typeof x === 'number' && isFinite(x); }
function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function fmt1(x) { return isNum(x) ? x.toFixed(1) : 'n/a'; }
function listHead(arr) { return arr.slice(0, 5).join(', ') + (arr.length > 5 ? ' (+' + (arr.length - 5) + ' more)' : ''); }

/** A fresh VM sandbox shaped like the browser's global: window === global, POD.data exists. */
function newSandbox() {
  const sb = { POD: { data: {} } };
  sb.window = sb;
  vm.createContext(sb);
  return sb;
}

/** Runs one file in the sandbox. Throws with the file name if it can't parse or run. */
function runFile(sb, file) {
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  } catch (err) {
    throw new Error('cannot run ' + path.basename(file) + ': ' + err.message);
  }
}

/** Loads files into one sandbox. Returns the sandbox, or null after recording the error in msgs. */
function loadFiles(msgs, files) {
  const sb = newSandbox();
  for (const file of files) {
    if (!fs.existsSync(file)) {
      msgs.push('missing ' + file);
      return null;
    }
    try {
      runFile(sb, file);
    } catch (err) {
      msgs.push(err.message);
      return null;
    }
  }
  return sb;
}

function tileFileNames(out) {
  const dir = path.join(out, 'src', 'data', 'stores');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).map((f) => f.replace(/\.js$/, ''));
}

function sumStores(brands) {
  let total = 0;
  for (const id of Object.keys(brands)) {
    const n = brands[id] && brands[id].stores;
    total += isNum(n) ? n : 0;
  }
  return total;
}

// ---- gate: brands -----------------------------------------------------------

function gateBrands(c) {
  const brandsFile = path.join(c.out, 'src', 'data', 'brands.js');
  const profFile = path.join(c.out, 'src', 'data', 'profiles.js');
  const sb = loadFiles(c.msgs, [brandsFile, profFile]);
  if (!sb) return;
  const D = sb.POD.data;
  const brands = D.BRANDS;
  if (!isObj(brands)) { c.msgs.push('brands.js has no POD.data.BRANDS object'); return; }
  const ids = Object.keys(brands);
  if (ids.length < MIN_BRANDS) c.msgs.push('only ' + ids.length + ' brands, need at least ' + MIN_BRANDS);

  const profiles = isObj(D.PROFILES) ? D.PROFILES : null;
  if (!profiles) {
    c.msgs.push('profiles.js has no POD.data.PROFILES object');
  } else {
    const missing = Object.keys(profiles).filter((k) => !hasOwn(brands, k));
    if (missing.length) c.msgs.push('PROFILES keys not in BRANDS: ' + listHead(missing));
  }

  const index = D.TILE_INDEX;
  let tiles = 0;
  if (!isObj(index)) {
    c.msgs.push('brands.js has no TILE_INDEX object');
  } else {
    const cells = Object.keys(index).sort();
    const files = tileFileNames(c.out).sort();
    const fileSet = new Set(files);
    const indexSet = new Set(cells);
    const onlyIndex = cells.filter((k) => !fileSet.has(k));
    const onlyFiles = files.filter((k) => !indexSet.has(k));
    if (onlyIndex.length) c.msgs.push('TILE_INDEX cells with no tile file: ' + listHead(onlyIndex));
    if (onlyFiles.length) c.msgs.push('tile files not in TILE_INDEX: ' + listHead(onlyFiles));
    tiles = files.length;
    let indexSum = 0;
    let bad = false;
    for (const k of cells) {
      if (isNum(index[k])) indexSum += index[k]; else bad = true;
    }
    if (bad) c.msgs.push('TILE_INDEX has a non-number count');
    const storeSum = sumStores(brands);
    if (indexSum !== storeSum) {
      c.msgs.push('TILE_INDEX counts sum to ' + indexSum + ' but BRANDS stores sum to ' + storeSum);
    }
  }
  const stores = sumStores(brands);
  c.report.push('brands run ' + D.BRANDS_RUN + ': ' + ids.length + ' brands, ' + tiles +
    ' tiles, ' + stores + ' stores');
  c.outBrands = brands;
}

// ---- gate: drift ------------------------------------------------------------

function gateDrift(c) {
  const outSb = loadFiles(c.msgs, [
    path.join(c.out, 'src', 'data', 'brands.js'),
    path.join(c.out, 'src', 'data', 'profiles.js'),
  ]);
  const rootSb = loadFiles(c.msgs, [
    path.join(c.root, 'src', 'data', 'brands.js'),
    path.join(c.root, 'src', 'data', 'profiles.js'),
  ]);
  if (!outSb || !rootSb) return;
  const outBrands = outSb.POD.data.BRANDS;
  const outProfiles = outSb.POD.data.PROFILES;
  const comBrands = rootSb.POD.data.BRANDS;
  const comProfiles = rootSb.POD.data.PROFILES;
  if (!isObj(outBrands) || !isObj(comBrands)) { c.msgs.push('BRANDS missing from OUT or the committed brands.js'); return; }
  if (!isObj(outProfiles) || !isObj(comProfiles)) { c.msgs.push('PROFILES missing from OUT or the committed profiles.js'); return; }

  const outTotal = sumStores(outBrands);
  const comTotal = sumStores(comBrands);
  if (!(comTotal > 0)) { c.msgs.push('committed brands.js has no stores'); return; }
  if (outTotal < MIN_TOTAL_RATIO * comTotal) {
    c.msgs.push('total stores ' + outTotal + ' is under ' + (MIN_TOTAL_RATIO * 100) + '% of committed ' + comTotal);
  }
  for (const id of Object.keys(outProfiles).sort()) {
    if (!hasOwn(comBrands, id)) continue; // a new profiled brand has no committed count to compare
    const cc = comBrands[id].stores;
    if (!hasOwn(outBrands, id)) { c.msgs.push('profiled brand ' + id + ' is missing from OUT'); continue; }
    const oc = outBrands[id].stores;
    if (!isNum(oc) || oc < MIN_BRAND_RATIO * cc) {
      c.msgs.push('profiled brand ' + id + ' has ' + oc + ' stores, under ' + (MIN_BRAND_RATIO * 100) +
        '% of committed ' + cc);
    }
  }
}

// ---- tile loading and geo calls (canary and Big Timber) ----------------------

/**
 * Calls a POD.geo lookup, loading the tiles it asks for, at most MAX_TILE_ROUNDS times.
 * call(opts) must return the geo result. A tile that won't load is recorded in opts.failed.
 */
function geoCall(sb, out, call) {
  const failed = {};
  let res = call({ failed: failed });
  let rounds = 0;
  while (res && res.status === 'need' && rounds < MAX_TILE_ROUNDS) {
    rounds++;
    for (const cell of res.need) {
      const rel = sb.POD.geo.tilePath(cell);
      const file = rel ? path.join(out, rel) : null;
      let loaded = false;
      if (file && fs.existsSync(file)) {
        try { runFile(sb, file); loaded = true; } catch (err) { loaded = false; }
      }
      if (!loaded) failed[cell] = true;
    }
    res = call({ failed: failed });
  }
  return res;
}

function geoSandbox(c) {
  return loadFiles(c.msgs, [
    path.join(c.root, 'src', 'js', 'pod.js'),
    path.join(c.root, 'src', 'js', 'geo.js'),
    path.join(c.out, 'src', 'data', 'zips.js'),
    path.join(c.out, 'src', 'data', 'brands.js'),
  ]);
}

// ---- gate: canary -----------------------------------------------------------

function gateCanary(c) {
  const sb = geoSandbox(c);
  if (!sb) return;
  const D = sb.POD.data;
  const rec = sb.POD.geo.zipByCode(CANARY_ZIP, D);
  if (!rec) { c.msgs.push('ZIP ' + CANARY_ZIP + ' not found in zips.js'); return; }
  const res = geoCall(sb, c.out, (opts) => sb.POD.geo.storesNear(rec.la, rec.lo, D, opts));
  if (!res) { c.msgs.push('storesNear returned null for ZIP ' + CANARY_ZIP); return; }
  const n = res.stores ? res.stores.length : 0;
  const summary = 'status=' + res.status + ' partial=' + res.partial + ' radius=' + res.radius + ' stores=' + n;
  if (res.status === 'need') {
    c.msgs.push('ZIP ' + CANARY_ZIP + ' still needs tiles after ' + MAX_TILE_ROUNDS + ' rounds (' + summary + ')');
  } else if (res.status !== 'ok' || res.partial !== false || res.radius !== CANARY_RADIUS || n < CANARY_MIN_STORES) {
    c.msgs.push('ZIP ' + CANARY_ZIP + ' storesNear: ' + summary + ' (want ok, not partial, radius ' +
      CANARY_RADIUS + ', at least ' + CANARY_MIN_STORES + ' stores)');
  } else {
    c.report.push('canary ZIP ' + CANARY_ZIP + ': ' + n + ' brands within ' + CANARY_RADIUS + ' mi');
  }
}

// ---- gate: states -----------------------------------------------------------

function readStates(msgs, file) {
  const sb = loadFiles(msgs, [file]);
  if (!sb) return null;
  return sb.POD.data;
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(s + 'T00:00:00Z');
  return isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

function gateStates(c) {
  const out = readStates(c.msgs, path.join(c.out, 'src', 'data', 'states.js'));
  const root = readStates(c.msgs, path.join(c.root, 'src', 'data', 'states.js'));
  if (!out || !root) return;
  const outRows = out.STATES;
  const rootRows = root.STATES;
  if (!Array.isArray(outRows) || !Array.isArray(rootRows)) { c.msgs.push('STATES is not an array'); return; }

  const outCodes = outRows.map((r) => (Array.isArray(r) ? r[0] : null));
  const rootCodes = rootRows.map((r) => (Array.isArray(r) ? r[0] : null));
  if (outRows.length !== 51) c.msgs.push('STATES has ' + outRows.length + ' rows, want 51');
  if (outCodes.join(' ') !== rootCodes.join(' ')) {
    c.msgs.push('state codes differ from the committed file (OUT ' + outCodes.length + ' rows, committed ' + rootCodes.length + ')');
  }
  const rootByCode = {};
  for (const r of rootRows) if (Array.isArray(r)) rootByCode[r[0]] = r;

  for (const r of outRows) {
    if (!Array.isArray(r)) { c.msgs.push('a STATES row is not an array'); continue; }
    const gas = r[2];
    if (!isNum(gas) || gas < GAS_MIN || gas > GAS_MAX) {
      c.msgs.push(r[0] + ' gasRegular ' + gas + ' is not a number in [' + GAS_MIN.toFixed(2) + ', ' + GAS_MAX.toFixed(2) + ']');
    }
    const want = rootByCode[r[0]];
    if (!want) {
      c.msgs.push(r[0] + ' is not in the committed file');
    } else if (r[3] !== want[3]) {
      c.msgs.push(r[0] + ' mealTaxPct ' + r[3] + ' differs from committed ' + want[3]);
    }
  }

  const grade = out.GRADE_ADD;
  if (!isObj(grade)) {
    c.msgs.push('GRADE_ADD is missing');
  } else {
    for (const k of ['midgrade', 'premium', 'diesel']) {
      const v = grade[k];
      if (!isNum(v) || v < GRADE_MIN || v > GRADE_MAX) {
        c.msgs.push('GRADE_ADD.' + k + ' ' + v + ' is not a number in [' + GRADE_MIN.toFixed(2) + ', ' + GRADE_MAX.toFixed(2) + ']');
      }
    }
  }

  const week = out.GAS_WEEK;
  if (!isDate(week)) {
    c.msgs.push('GAS_WEEK ' + JSON.stringify(week) + ' is not a YYYY-MM-DD date');
  } else {
    const gasMs = Date.parse(week + 'T00:00:00Z');
    const asMs = Date.parse(c.asOf + 'T00:00:00Z');
    if (gasMs > asMs) {
      c.msgs.push('GAS_WEEK ' + week + ' is after the as-of date ' + c.asOf);
    } else if (gasMs < asMs - MAX_GAS_AGE_DAYS * DAY_MS) {
      c.msgs.push('GAS_WEEK ' + week + ' is more than ' + MAX_GAS_AGE_DAYS + ' days before ' + c.asOf);
    }
    c.report.push('GAS_WEEK ' + week + ' (' + Math.round((asMs - gasMs) / DAY_MS) + ' days before ' + c.asOf + ')');
  }
}

// ---- gate: es5 --------------------------------------------------------------

function gateEs5(c) {
  const script = path.join(c.root, 'tools', 'es5-check.js');
  const r = childProcess.spawnSync(process.execPath, [script, path.join(c.out, 'src')], { encoding: 'utf8' });
  if (r.error) { c.msgs.push('cannot run es5-check: ' + r.error.message); return; }
  if (r.status !== 0) {
    const text = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(0, 3).join(' | ');
    c.msgs.push('es5-check exit ' + r.status + ': ' + text);
  }
}

// ---- report only: Big Timber -------------------------------------------------

function bigTimberReport(c) {
  try {
    const sb = geoSandbox(c);
    if (!sb) { c.report.push('big timber: skipped (geo data did not load)'); return; }
    const D = sb.POD.data;
    const rec = sb.POD.geo.zipByCode(BIG_TIMBER_ZIP, D);
    if (!rec) { c.report.push('big timber: ZIP ' + BIG_TIMBER_ZIP + ' not found'); return; }
    const res = geoCall(sb, c.out, (opts) => sb.POD.geo.nearestStore(rec.la, rec.lo, BIG_TIMBER_BRAND, D, opts));
    if (!res || !res.store) {
      c.report.push('big timber ' + BIG_TIMBER_ZIP + ' -> ' + BIG_TIMBER_BRAND + ': no store found (status ' +
        (res ? res.status : 'null') + ')');
      return;
    }
    const s = res.store;
    c.report.push('big timber ' + BIG_TIMBER_ZIP + ' -> ' + BIG_TIMBER_BRAND + ': store ' + s.id + ', ' +
      fmt1(s.mi) + ' mi straight, trip ' + fmt1(s.trip) + ' mi, one way ' +
      (isNum(s.trip) ? fmt1(s.trip / 2) : 'n/a') + ' mi');
  } catch (err) {
    c.report.push('big timber: unavailable (' + err.message + ')');
  }
}

// ---- entry points -----------------------------------------------------------

const GATE_FNS = { brands: gateBrands, drift: gateDrift, canary: gateCanary, states: gateStates, es5: gateEs5 };

function checkSite(out, root, asOf) {
  const outAbs = path.resolve(out);
  const rootAbs = path.resolve(root);
  const failures = [];
  const report = [];
  const c = { out: outAbs, root: rootAbs, asOf: asOf, report: report, msgs: [] };
  if (!isDate(asOf)) {
    return { ok: false, failures: [{ gate: 'states', msg: 'as-of ' + JSON.stringify(asOf) + ' is not YYYY-MM-DD' }], report: report };
  }
  for (const gate of GATES) {
    c.msgs = [];
    try {
      GATE_FNS[gate](c);
    } catch (err) {
      c.msgs.push('exception: ' + (err && err.message ? err.message : String(err)));
    }
    for (const msg of c.msgs) failures.push({ gate: gate, msg: msg });
  }
  bigTimberReport(c);
  return { ok: failures.length === 0, failures: failures, report: report };
}

function usage() {
  console.error('usage: node tools/check-site.js OUT ROOT --as-of YYYY-MM-DD');
  return 2;
}

function main(argv) {
  const pos = [];
  let asOf = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--as-of') { asOf = argv[++i]; } else { pos.push(argv[i]); }
  }
  if (pos.length !== 2 || !asOf) return usage();
  const res = checkSite(pos[0], pos[1], asOf);
  for (const gate of GATES) {
    const fails = res.failures.filter((f) => f.gate === gate);
    if (fails.length === 0) {
      console.log('check-site: OK ' + gate);
    } else {
      for (const f of fails) console.log('check-site: FAIL ' + f.gate + ': ' + f.msg);
    }
  }
  for (const line of res.report) console.log('check-site: report ' + line);
  return res.ok ? 0 : 1;
}

module.exports = { checkSite };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
