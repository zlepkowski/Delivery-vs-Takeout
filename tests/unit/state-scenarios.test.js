// state-scenarios.test.js: runs the hand-worked scenarios in tests/fixtures/state/scenarios.json
// against POD.state (docs/state-contract.md, D-031). The fixture's `about` is the protocol.
//
// Expected values come only from the fixture (closed-form arithmetic in tests/fixtures/state/build.py).
// Contract §0 is checked on every step:
//   - the call doesn't throw;
//   - it doesn't change D, opts, storage or its argument objects;
//   - POD.data, POD.S and the sandbox's Date throw while it runs (it may read only its arguments);
//   - no object or array in S is shared with D or with a step's arguments.
// D and the arguments are built in this (host) realm, so a cross-realm `instanceof` fails here too.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadApp, APP_ROOT } = require('../helpers/load');

const FX = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tests', 'fixtures', 'state', 'scenarios.json'), 'utf8'));
const MIN_SCENARIOS = 74;
const MIN_PERIODS = 12;

const sandbox = loadApp({ only: ['pod.js', 'engine.js', 'geo.js', 'state.js'] });
const POD = sandbox.POD;
const ST = POD.state;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A host-realm copy that keeps undefined and non-finite numbers, so deepStrictEqual can compare across realms. */
function plain(v) {
  // Not v.map(): map builds its result with the VM array's own constructor, so it would stay in the VM realm.
  if (Array.isArray(v)) return Array.from(v, plain);
  if (v !== null && typeof v === 'object') {
    if (Object.prototype.toString.call(v) === '[object Date]') return 'Date(' + v.getTime() + ')';
    const o = {};
    for (const k of Object.keys(v)) o[k] = plain(v[k]);
    return o;
  }
  return v;
}

/** Walks own keys; array indexes allowed. `found` is false when a segment is missing. */
function walk(obj, dotted) {
  let cur = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || !hasOwn(cur, seg)) return { found: false, value: undefined };
    cur = cur[seg];
  }
  return { found: true, value: cur };
}

function objectsIn(v, set) {
  if (v !== null && typeof v === 'object' && !set.has(v)) {
    set.add(v);
    for (const k of Object.keys(v)) objectsIn(v[k], set);
  }
  return set;
}

function sharedPath(S, foreign, at) {
  if (S === null || typeof S !== 'object') return null;
  if (foreign.has(S)) return at || '(S itself)';
  for (const k of Object.keys(S)) {
    const hit = sharedPath(S[k], foreign, at ? at + '.' + k : k);
    if (hit) return hit;
  }
  return null;
}

function makeStorage(spec) {
  const log = { writes: 0, saved: undefined };
  if (!spec || spec.kind === 'none') return { storage: null, log };
  if (spec.kind === 'throwing') {
    return { storage: { getItem() { throw new Error('storage off'); }, setItem() { throw new Error('storage off'); } }, log };
  }
  if (spec.kind !== 'memory') throw new Error('unknown storage kind ' + spec.kind);
  const map = new Map();
  if (spec.value !== undefined) map.set(POD.STORAGE_KEY, spec.value);
  return {
    log,
    storage: {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { log.writes++; map.set(k, String(v)); if (k === POD.STORAGE_KEY) log.saved = String(v); }
    }
  };
}

function poisoned(fn) {
  const trap = (what) => ({ get() { throw new Error('purity: the call read ' + what); }, configurable: true });
  const data = POD.data;
  const savedDate = sandbox.Date;
  Object.defineProperty(POD, 'data', trap('POD.data'));
  Object.defineProperty(POD, 'S', trap('POD.S'));
  sandbox.Date = function () { throw new Error('purity: the call used Date'); };
  try {
    return fn();
  } finally {
    Object.defineProperty(POD, 'data', { value: data, writable: true, configurable: true, enumerable: true });
    delete POD.S;
    sandbox.Date = savedDate;
  }
}

function buildD(sc) {
  const D = clone(FX.datasets[sc.data]);
  for (const [k, v] of Object.entries(sc.patch || {})) D[k] = clone(v);
  return D;
}

/** Runs one scenario's steps; returns what the expectations need. */
function run(sc) {
  const D = buildD(sc);
  const { storage, log } = makeStorage(sc.storage);
  const storageBefore = JSON.stringify(sc.storage || null);
  let S;
  sc.steps.forEach((step, i) => {
    const where = 'step ' + i + ' ' + step.call;
    const sig = FX.signatures[step.call];
    assert.ok(sig, where + ': no signature in the fixture');
    assert.equal(typeof ST[step.call], 'function', 'POD.state.' + step.call + ' is not a function');
    const userArgs = clone(step.args);
    const opts = clone(step.opts);
    const now = new Date(step.now || FX.now);
    const args = [];
    for (const name of sig) {
      if (name === '*') args.push(...userArgs);
      else if (name === 'S') args.push(S);
      else if (name === 'D') args.push(D);
      else if (name === 'now') args.push(now);
      else if (name === 'opts') args.push(opts);
      else if (name === 'storage') args.push(storage);
      else throw new Error('unknown signature slot ' + name);
    }
    const dBefore = JSON.stringify(D);
    const argsBefore = JSON.stringify([userArgs, opts === undefined ? null : opts]);
    let ret;
    try {
      ret = poisoned(() => ST[step.call].apply(null, args));
    } catch (err) {
      assert.fail(where + ' threw: ' + (err && err.stack || err));
    }
    assert.equal(JSON.stringify(D), dBefore, where + ': changed D');
    assert.equal(JSON.stringify([userArgs, opts === undefined ? null : opts]), argsBefore, where + ': changed its arguments');
    assert.equal(now.getTime(), new Date(step.now || FX.now).getTime(), where + ': changed now');
    if (step.call === 'fresh' || step.call === 'load') S = ret;
    assert.ok(S !== null && typeof S === 'object', where + ': there is no S');
    const foreign = objectsIn(D, new Set());
    objectsIn(userArgs, foreign);
    objectsIn(opts, foreign);
    const shared = sharedPath(S, foreign, '');
    assert.equal(shared, null, where + ': S.' + shared + ' is shared with D or an argument (contract §0)');
    if (hasOwn(step, 'returns')) {
      assert.deepStrictEqual(plain(ret), step.returns, where + ': return value');
    }
  });
  assert.equal(JSON.stringify(sc.storage || null), storageBefore);
  return { S, D, log };
}

function check(sc, out, key, want) {
  const { S, log } = out;
  const label = sc.id + ' :: ' + key;
  const eq = (got) => assert.deepStrictEqual(plain(got), want, label);
  const fe = () => ST.forEngine(S);
  if (key === '$missing') return eq(ST.missing(S));
  if (key.startsWith('$appMissing.')) return eq(ST.appMissing(S, key.slice('$appMissing.'.length)));
  if (key === '$forEngine') {
    assert.equal(want, null, label + ': the fixture only checks $forEngine for null');
    return eq(fe());
  }
  if (key.startsWith('$forEngine.')) {
    const F = fe();
    assert.ok(F, label + ': forEngine(S) is null');
    return eq(walk(F, key.slice('$forEngine.'.length)).value);
  }
  if (key.startsWith('$calc.')) {
    const [ch, field] = key.slice('$calc.'.length).split('.');
    const r = POD.engine.calc(fe(), ch);
    assert.ok(r, label + ': calc returned null');
    return eq(r[field]);
  }
  if (key === '$allResults.ids') return eq(POD.engine.allResults(fe()).map((r) => r.id));
  if (key.startsWith('$getPath.')) {
    const got = ST.getPath(S, key.slice('$getPath.'.length));
    if (want === '$undefined') return assert.equal(got, undefined, label);
    return eq(got);
  }
  if (key === '$savedKeys' || key.startsWith('$saved.')) {
    assert.equal(typeof log.saved, 'string', label + ': nothing was saved under ' + POD.STORAGE_KEY);
    const saved = JSON.parse(log.saved);
    if (key === '$savedKeys') return assert.deepStrictEqual(Object.keys(saved).sort(), want, label);
    const w = walk(saved, key.slice('$saved.'.length));
    if (want === '$absent') return assert.equal(w.found, false, label + ': should not be saved');
    return assert.deepStrictEqual(w.value, want, label);
  }
  if (key.startsWith('$has.')) return assert.equal(walk(S, key.slice('$has.'.length)).found, want, label);
  if (key === '$storageWrites') return assert.equal(log.writes, want, label);
  if (key === '$protoClean') return; // checked around every scenario
  if (key.startsWith('$')) throw new Error('unknown check ' + key);
  const w = walk(S, key);
  assert.ok(w.found, label + ': S has no such path');
  return eq(w.value);
}

const protoNames = () => [
  Object.getOwnPropertyNames(Object.prototype).sort().join(),
  Object.getOwnPropertyNames(vm.runInContext('Object.prototype', sandbox)).sort().join()
];

test('fixture: every scenario and period case is present', () => {
  assert.equal(POD.STORAGE_KEY, 'pod.v5');
  assert.ok(FX.scenarios.length >= MIN_SCENARIOS, 'scenarios: ' + FX.scenarios.length);
  assert.ok(FX.periods.length >= MIN_PERIODS, 'periods: ' + FX.periods.length);
  const ids = new Set(FX.scenarios.map((s) => s.id));
  assert.equal(ids.size, FX.scenarios.length, 'scenario ids are unique');
});

for (const sc of FX.scenarios) {
  test('state ' + (sc.refs || []).join(' ') + ': ' + sc.id, () => {
    const before = protoNames();
    const out = run(sc);
    for (const [key, want] of Object.entries(sc.expect)) check(sc, out, key, want);
    assert.deepStrictEqual(protoNames(), before, 'Object.prototype gained a property');
  });
}

for (const [cadence, when, want] of FX.periods) {
  test('state §5.2: periodOf(' + JSON.stringify(cadence) + ', ' + JSON.stringify(when) + ')', () => {
    const now = when === null ? null : new Date(when);
    assert.equal(poisoned(() => ST.periodOf(cadence, now)), want);
  });
}
