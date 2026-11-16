// api-cases.test.js: runs the hand-worked seam cases (tests/fixtures/api/cases.json, written by
// build.py from docs/api-contract.md §6, D-040) against POD.api in the app's VM.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../helpers/load');

const ROOT = path.join(__dirname, '..', '..');
const DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'api', 'cases.json'), 'utf8'));
const app = loadApp();
const POD = app.POD;
const J = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));   // across the VM realm (ISS-008)
const TAGS = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0, undefined: undefined };

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$') return v.$ === 'D' ? POD.data : TAGS[v.$];
    const o = {};
    for (const k of keys) o[k] = decode(v[k]);
    return o;
  }
  return v;
}

function closeRows(got, want) {
  assert.equal(got.length, want.length, 'row count');
  for (let i = 0; i < want.length; i++) {
    const { mi, ...rest } = want[i];
    const { mi: gmi, ...grest } = got[i];
    assert.deepEqual(grest, rest, 'row ' + i);
    assert.equal(typeof gmi, 'number', 'row ' + i + ' mi');
    assert.ok(Math.abs(gmi - mi) <= 1e-9 * Math.max(1, Math.abs(mi)), 'row ' + i + ' mi ' + gmi + ' vs ' + mi);
  }
}

test('cases.json holds the seam cases (a guard: an empty file must not pass)', () => {
  assert.ok(DOC.seam.length >= 134, 'expected at least 134 seam cases, found ' + DOC.seam.length);
  const fns = new Set(DOC.seam.map((c) => c.fn));
  for (const f of ['enabled', 'fmt3', 'point', 'driveKey', 'geoQuery', 'geoKey', 'nearbyKey', 'nameKey', 'checkDrive',
    'checkGeocode', 'checkNearby', 'asks', 'placesFor', 'remember']) {
    assert.ok(fns.has(f), 'cases for ' + f);
  }
});

test('POD.api exposes the contract constants', () => {
  assert.deepEqual(J(POD.api.NEARBY_RADII), [2, 5, 10]);
  assert.equal(POD.api.NEARBY_WANT, 10);
  assert.equal(POD.api.NEARBY_SHOW, 10);
  assert.equal(POD.api.TIMEOUT_MS, 4000);
  assert.equal(POD.api.NEARBY_TIMEOUT_MS, 10000);
});

test('the committed config leaves the Worker off (D-040)', () => {
  assert.equal(POD.config.apiBase, '');
  assert.equal(POD.api.enabled(), false);
});

DOC.seam.forEach((c, i) => {
  const label = c.fn + (c.label ? ': ' + c.label : '(' + JSON.stringify(c.args).slice(0, 80) + ')');
  test('seam #' + i + ' ' + label, () => {
    if (c.fn === 'enabled') {
      const saved = POD.config;
      POD.config = decode(c.config || {});
      try { assert.equal(POD.api.enabled(), c.returns); } finally { POD.config = saved; }
      return;
    }
    if (c.fn === 'remember') {
      const [D, opts, ask, value] = decode(c.args);
      POD.api.remember(D, opts, ask, value);
      assert.deepEqual(J(D), c.after.D, 'D after');
      assert.deepEqual(J(opts), c.after.opts, 'opts after');
      return;
    }
    const got = J(POD.api[c.fn].apply(null, decode(c.args)));
    if (c.fn === 'placesFor' && c.returns.length) closeRows(got, c.returns);
    else assert.deepEqual(got === undefined ? '__undefined__' : got, c.returns);
  });
});
