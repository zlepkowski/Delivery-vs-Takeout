// js_runner.js: runs a batch of engine calls through the real src/js/engine.js for the oracle.
//
//   node tests/oracle/js_runner.js <requests.json> <results.json>
//
// Each request is {call: "calc"|"allResults"|"cartInfo"|"perMile", S, channel?, override?}.
// Each result is {ok: true, v} or {ok: false, err}. The engine is loaded the way the unit
// tests load it (tests/helpers/load.js, index.html order). The runner also checks purity:
// a call that changes its S or override is reported as an error.
'use strict';

const fs = require('node:fs');
const { loadApp } = require('../helpers/load');

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('usage: node tests/oracle/js_runner.js <requests.json> <results.json>');
  process.exit(2);
}

const E = loadApp({ only: ['pod.js', 'engine.js'] }).POD.engine;
const requests = JSON.parse(fs.readFileSync(inFile, 'utf8'));

function run(r) {
  const ov = r.override === null || r.override === undefined ? undefined : r.override;
  switch (r.call) {
    case 'calc': return E.calc(r.S, r.channel, ov);
    case 'allResults': return E.allResults(r.S, ov);
    case 'cartInfo': return E.cartInfo(r.S, ov);
    case 'perMile': return E.perMile(r.S);
    default: throw new Error('unknown call ' + r.call);
  }
}

const out = requests.map((r) => {
  const before = JSON.stringify([r.S, r.override]);
  try {
    const v = run(r);
    if (JSON.stringify([r.S, r.override]) !== before) {
      return { ok: false, err: 'purity: the call changed its S or override' };
    }
    return { ok: true, v: v === undefined ? null : v };
  } catch (e) {
    return { ok: false, err: String((e && e.stack) || e) };
  }
});

fs.writeFileSync(outFile, JSON.stringify(out));
