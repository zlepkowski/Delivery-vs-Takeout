// Phase 0 scaffold tests: the load harness works, the namespace contract
// holds, and the shared helpers behave. Later phases add their own files.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, scriptOrder } = require('../helpers/load');

test('index.html lists pod.js first and app.js last', () => {
  const order = scriptOrder();
  assert.ok(order.length >= 2, 'expected at least two scripts');
  assert.equal(order[0], 'src/js/pod.js');
  assert.equal(order[order.length - 1], 'src/js/app.js');
});

test('every script loads with no DOM (no DOM access at load time)', () => {
  const sb = loadApp();
  assert.equal(typeof sb.document, 'undefined');
  assert.equal(typeof sb.POD, 'object');
  assert.equal(typeof sb.POD.boot, 'function');
});

test('namespace exposes version, storage key and sub-namespaces', () => {
  const { POD } = loadApp({ only: ['pod.js'] });
  assert.match(POD.VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(POD.STORAGE_KEY, 'pod.v5');
  assert.equal(typeof POD.data, 'object');
  assert.equal(typeof POD.util, 'object');
});

test('round2 rounds half away from zero at the cent', () => {
  const { round2 } = loadApp({ only: ['pod.js'] }).POD.util;
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(15.62), 15.62);
  assert.equal(round2(0), 0);
});

test('money formats thousands and negatives', () => {
  const { money } = loadApp({ only: ['pod.js'] }).POD.util;
  assert.equal(money(15.62), '$15.62');
  assert.equal(money(1234.5), '$1,234.50');
  assert.equal(money(-3), '−$3.00');
  assert.equal(money(0), '$0.00');
});

test('clamp bounds both ends', () => {
  const { clamp } = loadApp({ only: ['pod.js'] }).POD.util;
  assert.equal(clamp(0.1, 0.4, 30), 0.4);
  assert.equal(clamp(45, 0.4, 30), 30);
  assert.equal(clamp(9.2, 0.4, 30), 9.2);
});
