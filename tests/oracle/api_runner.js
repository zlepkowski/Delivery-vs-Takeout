// api_runner.js: runs a batch of POD.api pure-function calls (docs/api-contract.md §6) through the
// real src/ scripts for the oracle.
//
//   node tests/oracle/api_runner.js <requests.json> <results.json>
//
// requests.json is {cases: [{fn, args, config?}]}. Args may carry {"$": tag} for values JSON can't
// hold: NaN, Infinity, -Infinity, -0, undefined, and "D" (the real POD.data, read before the call).
// `config` replaces POD.config for `enabled`.
//
// Each result is {ok: true, v} or {ok: false, err}, with undefined written as "__undefined__".
// Purity (contract §6) is checked as in vin_runner.js: a call that changes its arguments is an
// error; POD.data, POD.S and Date throw while a call runs (except `enabled`, which reads
// POD.config only); and every call is made twice with the first result scribbled over in between.
'use strict';

const fs = require('node:fs');
const { loadApp } = require('../helpers/load');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('usage: node tests/oracle/api_runner.js <requests.json> <results.json>');
  process.exit(2);
}

const sandbox = loadApp();
const POD = sandbox.POD;
const DATA = POD.data;
const FNS = ['enabled', 'fmt3', 'point', 'driveKey', 'geoQuery', 'geoKey', 'nearbyKey', 'nameKey',
  'checkDrive', 'checkGeocode', 'checkNearby', 'asks', 'placesFor'];
const { cases } = JSON.parse(fs.readFileSync(inFile, 'utf8'));

const TAGS = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0, undefined: undefined };
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$') return v.$ === 'D' ? DATA : TAGS[v.$];
    const o = {};
    for (const k of keys) Object.defineProperty(o, k, { value: decode(v[k]), enumerable: true, writable: true, configurable: true });   // "__proto__" stays a key
    return o;
  }
  return v;
}

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
    Object.defineProperty(POD, 'S', { value: undefined, writable: true, configurable: true, enumerable: true });
    sandbox.Date = savedDate;
  }
}

const out = [];
for (const c of cases) {
  try {
    if (FNS.indexOf(c.fn) < 0 || typeof POD.api[c.fn] !== 'function') throw new Error('no POD.api.' + c.fn);
    if (c.fn === 'enabled') {
      const saved = POD.config;
      POD.config = c.config || {};
      try { out.push({ ok: true, v: encode(POD.api.enabled()) }); } finally { POD.config = saved; }
      continue;
    }
    const before = JSON.stringify(encode(c.args));
    const args1 = decode(c.args);
    const v1 = poisoned(() => POD.api[c.fn].apply(null, args1));
    const after = JSON.stringify(encode(args1.map((a) => (a === DATA ? '$D' : a))));
    const plain = JSON.stringify(encode(decode(c.args).map((a) => (a === DATA ? '$D' : a))));
    if (after !== plain) throw new Error('purity: the call changed its arguments');
    const first = encode(v1);
    if (v1 !== null && typeof v1 === 'object') scribble(v1);
    const v2 = poisoned(() => POD.api[c.fn].apply(null, decode(c.args)));
    if (JSON.stringify(encode(v2)) !== JSON.stringify(first)) throw new Error('purity: a second call differs after the first result was changed');
    if (JSON.stringify(encode(c.args)) !== before) throw new Error('runner: request changed');
    out.push({ ok: true, v: first });
  } catch (e) {
    out.push({ ok: false, err: String(e && e.message || e) });
  }
}
fs.writeFileSync(outFile, JSON.stringify(out));
