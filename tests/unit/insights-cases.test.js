// Fixture cases for POD.insights.build (docs/insights-contract.md, D-034).
//
// The expected output in tests/fixtures/insights/cases.json comes from the Python reference
// (tests/oracle/insights.py, on the engine oracle) and arithmetic worked by hand in
// tests/fixtures/insights/build.py, never from src/js/insights.js. Each case runs the real
// scripts in the VM: F = base merged with the case's patch, R = POD.engine.allResults(F).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, APP_ROOT } = require('../helpers/load');

const FIX = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tests', 'fixtures', 'insights', 'cases.json'), 'utf8'));
const { POD } = loadApp();

function plain(v) {
  // Not v.map(): map would build the copy with the VM array's own constructor.
  if (Array.isArray(v)) return Array.from(v, plain);
  if (v !== null && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = plain(v[k]);
    return o;
  }
  return v;
}

function merge(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (FIX.replace.includes(k) || v === null || typeof v !== 'object' || Array.isArray(v) ||
        out[k] === null || typeof out[k] !== 'object' || Array.isArray(out[k])) {
      out[k] = JSON.parse(JSON.stringify(v));
    } else {
      out[k] = merge(out[k], v);
    }
  }
  return out;
}

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

const dateOf = (now) => (now ? new Date(now[0], now[1], now[2], 12) : new Date(NaN));

test('D-034 the insight fixtures are all loaded (at least 41 cases, 145 insights)', () => {
  assert.ok(FIX.cases.length >= 41, 'only ' + FIX.cases.length + ' cases');
  const n = FIX.cases.reduce((s, c) => s + c.expect.length, 0);
  assert.ok(n >= 145, 'only ' + n + ' expected insights');
  const ids = new Set();
  for (const c of FIX.cases) for (const x of c.expect) ids.add(x.id);
  for (const id of ['unlock', 'distance', 'fuel', 'minimum', 'wallet', 'timing', 'locked', 'nuance', 'spread']) {
    assert.ok(ids.has(id), 'no fixture case shows ' + id);
  }
});

for (const c of FIX.cases) {
  test('D-034 insights ' + c.id + ': ' + c.title, () => {
    const F = merge(FIX.base, c.patch);
    const R = POD.engine.allResults(F);
    const now = dateOf(c.now);
    const before = JSON.stringify([F, R]);
    const t0 = now.getTime();
    const got = POD.insights.build(F, R, now);
    assert.ok(Array.isArray(got), 'build returns an array');
    assert.deepStrictEqual(plain(got), c.expect);
    assert.equal(negZero(got, 'build'), null, 'a -0 in the output');
    assert.equal(JSON.stringify([F, R]), before, 'build changed F or R');
    assert.ok(Object.is(now.getTime(), t0), 'build changed now');
  });
}

test('D-034 §1 bad input gives [] and never throws', () => {
  const F = merge(FIX.base, {});
  const R = POD.engine.allResults(F);
  const now = dateOf([2026, 10, 14]);
  const junk = [
    [null, R, now], [undefined, R, now], [42, R, now], [[], R, now], [merge(F, { rest: null }), R, now],
    [F, null, now], [F, undefined, now], [F, {}, now], [F, [], now], [F, 'R', now],
  ];
  for (const [f, r, n] of junk) {
    let out;
    assert.doesNotThrow(() => { out = POD.insights.build(f, r, n); }, JSON.stringify([f === F ? 'F' : f, r === R ? 'R' : r]));
    assert.deepStrictEqual(plain(out), [], 'junk gives []');
  }
  for (const n of [undefined, null, 'today', {}, new Date(NaN)]) {
    let out;
    assert.doesNotThrow(() => { out = POD.insights.build(F, R, n); }, 'now = ' + String(n));
    assert.ok(Array.isArray(out), 'a bad now still returns an array');
    assert.ok(!plain(out).some((x) => x.id === 'timing'), 'no Timing without a valid date');
  }
});
