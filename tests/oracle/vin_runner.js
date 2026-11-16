// vin_runner.js: runs a batch of POD.vin calls (docs/vin-contract.md) and POD.state car-table calls
// (docs/state-contract.md §4.0) through the real src/ scripts for the oracle.
//
//   node tests/oracle/vin_runner.js <requests.json> <results.json>
//
// requests.json is {datasets: {name: D}, cases: [{fn, args, data?}]}. `data` names a dataset (a
// fresh deep copy per call); D goes into args where the contract puts it (D_POS). run.py resolves
// recorded vPIC fixtures into args before it writes the file.
//
// Each result is {ok: true, v} or {ok: false, err}, with undefined written as "__undefined__".
// Purity (contract §0) is checked three ways, as in geo_runner.js: a call that changes its
// arguments is an error; POD.data, POD.S and Date throw while the call runs; and every call is
// made twice with the first result scribbled over in between.
'use strict';

const fs = require('node:fs');
const { loadApp } = require('../helpers/load');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('usage: node tests/oracle/vin_runner.js <requests.json> <results.json>');
  process.exit(2);
}

const sandbox = loadApp();
const POD = sandbox.POD;
const DATA = POD.data;
const VIN_FNS = ['clean', 'check', 'url', 'decode', 'key', 'match'];
const D_POS = { clean: null, check: null, url: null, decode: null, key: null, match: 1,
  carMakes: 0, carModels: 0, carYears: 0, carLookup: 0 };
const { datasets, cases } = JSON.parse(fs.readFileSync(inFile, 'utf8'));

function encode(v) {
  if (v === undefined) return '__undefined__';
  return JSON.parse(JSON.stringify(v, (k, x) => {
    if (typeof x === 'number' && !isFinite(x)) return isNaN(x) ? '__NaN__' : (x > 0 ? '__Infinity__' : '__-Infinity__');
    if (x === undefined) return '__undefined__';
    return x;
  }));
}

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

function target(fn) {
  const owner = VIN_FNS.indexOf(fn) >= 0 ? POD.vin : POD.state;
  if (!owner || typeof owner[fn] !== 'function') {
    throw new Error((VIN_FNS.indexOf(fn) >= 0 ? 'POD.vin.' : 'POD.state.') + fn + ' is not a function');
  }
  return owner[fn];
}

const out = cases.map((c) => {
  try {
    const f = target(c.fn);
    const args = JSON.parse(JSON.stringify(c.args));
    if (!Object.prototype.hasOwnProperty.call(D_POS, c.fn)) throw new Error('unknown fn ' + c.fn);
    if (D_POS[c.fn] !== null) {
      const D = c.data === undefined || c.data === null ? null : JSON.parse(JSON.stringify(datasets[c.data]));
      args.splice(D_POS[c.fn], 0, D);
    }
    const before = JSON.stringify(args);
    const first = poisoned(() => f.apply(null, args));
    if (JSON.stringify(args) !== before) throw new Error('purity: the call changed its arguments');
    const v = encode(first);
    scribble(first);
    const again = encode(poisoned(() => f.apply(null, args)));
    if (JSON.stringify(again) !== JSON.stringify(v)) {
      throw new Error('purity: a second call returned something else after the first result was changed');
    }
    return { ok: true, v };
  } catch (err) {
    return { ok: false, err: String(err && err.stack || err) };
  }
});
fs.writeFileSync(outFile, JSON.stringify(out));
