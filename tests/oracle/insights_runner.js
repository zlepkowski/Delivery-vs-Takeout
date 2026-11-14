// insights_runner.js: runs POD.insights.build through the real src/ scripts for the oracle.
//
//   node tests/oracle/insights_runner.js <requests.json> <results.json>
//
// Each request is {F, now}: now is [year, month0, day] (a local date at noon) or null (an
// invalid Date). The runner prices R = POD.engine.allResults(F) and returns
// {ok: true, v: POD.insights.build(F, R, now)} or {ok: false, err}. It loads every script in
// index.html order (tests/helpers/load.js), so a missing <script> tag fails the run. Purity:
// a call that changes F, R or now is an error, and POD.data / POD.S are poisoned during it.
'use strict';

const fs = require('node:fs');
const { loadApp } = require('../helpers/load');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('usage: node tests/oracle/insights_runner.js <requests.json> <results.json>');
  process.exit(2);
}

const { POD } = loadApp();
if (!POD.insights || typeof POD.insights.build !== 'function') {
  console.error('insights_runner: POD.insights.build is missing (is src/js/insights.js in index.html?)');
  process.exit(3);
}
const requests = JSON.parse(fs.readFileSync(inFile, 'utf8'));
/** JSON would turn -0 into 0, so look for it before the round trip. */
function negZero(v, at) {
  if (typeof v === 'number') return Object.is(v, -0) ? at : null;
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      const hit = negZero(v[k], at + '.' + k);
      if (hit) return hit;
    }
  }
  return null;
}
const trap = new Proxy({}, { get() { throw new Error('purity: read POD.data or POD.S'); } });

const out = requests.map((r) => {
  try {
    const R = POD.engine.allResults(r.F);
    const now = r.now ? new Date(r.now[0], r.now[1], r.now[2], 12) : new Date(NaN);
    const before = JSON.stringify([r.F, R]);
    const t0 = now.getTime();
    const data = POD.data;
    POD.data = trap;
    POD.S = trap;
    let v;
    try {
      v = POD.insights.build(r.F, R, now);
    } finally {
      POD.data = data;
      delete POD.S;
    }
    if (JSON.stringify([r.F, R]) !== before || !Object.is(now.getTime(), t0)) {
      return { ok: false, err: 'purity: build changed F, R or now' };
    }
    const nz = negZero(v, 'build');
    if (nz) return { ok: false, err: 'a -0 at ' + nz + ' (contract §0: data numbers are x + 0)' };
    return { ok: true, v: JSON.parse(JSON.stringify(v === undefined ? '__undefined__' : v)) };
  } catch (e) {
    return { ok: false, err: String((e && e.stack) || e) };
  }
});

fs.writeFileSync(outFile, JSON.stringify(out));
