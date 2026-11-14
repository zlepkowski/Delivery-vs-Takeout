// state.test.js: Phase 4.4. Groups A-C prove the Phase 4 done-when conditions by name. Groups D-G
// prove the contract properties the hand-worked scenarios (state-scenarios.test.js) don't reach.
// Contract: docs/state-contract.md (D-031, with its amendment in docs/decisions.md) and D-032.
//
// Expected values come only from the contract text, the S1 fixture (datasets.S1), the shipped data
// tables (POD.data, copied into this realm), the sourced evidence files and literal facts. Never from
// state.js output. Deep comparisons go through J(), a JSON round trip, so VM-realm arrays and objects
// compare cleanly (ISS-008: a VM array's map() stays in the VM realm).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('node:util');
const { loadApp, APP_ROOT } = require('../helpers/load');

const FX = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tests', 'fixtures', 'state', 'scenarios.json'), 'utf8'));
const EVID = {
  plats: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tools', 'data', 'defaults-platforms.json'), 'utf8')).values,
  trip: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tools', 'data', 'defaults-trip.json'), 'utf8')).values
};

const J = (v) => JSON.parse(JSON.stringify(v));
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r3 = (x) => Math.round(x * 1000) / 1000;             // contract §4.2 gas rounding
const NOW = new Date(2026, 10, 13, 12);                     // host realm; local time, as periodOf reads it
const APPS = ['dd', 'ue', 'gh'];

// Two sandboxes. S1 tests use the subset the fixture uses; the real-data tests load every script.
const S1SB = loadApp({ only: ['pod.js', 'engine.js', 'geo.js', 'state.js'] });
const S1ST = S1SB.POD.state;
const FULL = loadApp();
const ST = FULL.POD.state;
const REAL = structuredClone(FULL.POD.data);               // host-realm copy of the shipped tables

const s1Data = () => J(FX.datasets.S1);                     // a fresh host-realm copy of S1
const vmObjectProto = (sb) => vm.runInContext('Object.prototype', sb);

/** A host-realm storage: getItem returns null for a missing key, like localStorage. */
function memStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); }
  };
}

/** The state code of a ZIP, read from the packed table (field 5). */
function packedState(code) {
  const rec = REAL.ZIP_PACKED.split(';').find((r) => r.split(',')[0] === code);
  assert.ok(rec, 'ZIP ' + code + ' is in ZIP_PACKED');
  return rec.split(',')[4];
}

function stateRow(code) {
  const row = REAL.STATES.find((r) => r[0] === code);
  assert.ok(row, 'STATES has ' + code);
  return row;
}

/** Walks an object's own keys and returns every object and array reachable from it. */
function objectsIn(v, set) {
  if (v !== null && typeof v === 'object' && !set.has(v)) {
    set.add(v);
    for (const k of Object.keys(v)) objectsIn(v[k], set);
  }
  return set;
}

/** The first object of `set` reachable from v, or null (a shared object breaks contract §0). */
function sharedWith(v, set) {
  if (v === null || typeof v !== 'object') return null;
  if (set.has(v)) return true;
  for (const k of Object.keys(v)) {
    if (sharedWith(v[k], set)) return true;
  }
  return null;
}

/** Prototype names of this realm's Object.prototype and the S1 sandbox's Object.prototype. */
function protoSnapshot(sb) {
  return [
    Object.getOwnPropertyNames(Object.prototype).sort().join(),
    Object.getOwnPropertyNames(vmObjectProto(sb)).sort().join()
  ];
}

/** A real-data state: an address (NY 10001), a premium car, a profiled brand with all three markups, miles pinned. */
function readyState() {
  const S = ST.fresh(REAL);
  ST.setAddress(S, REAL, 'Main St, New York NY 10001', undefined);
  ST.setCar(S, REAL, 'Acura', 'ADX');
  ST.setBrand(S, REAL, 'subway', undefined);             // no tiles loaded: the trip needs them, so pin it below
  assert.equal(ST.pinMiles(S, 3), true);
  return S;
}

// ---- A: the done-when conditions of the cascade (real POD.data) --------------------------------

test('done-when: the cascade: a fresh state asks for rest, tax, mpg, gas, miles and minutes', () => {
  assert.deepEqual(J(ST.missing(ST.fresh(REAL))), ['rest', 'tax', 'mpg', 'gas', 'miles', 'minutes']);
});

test('done-when: the cascade: setAddress takes tax and gas from the ZIP state row', () => {
  const S = ST.fresh(REAL);
  ST.setAddress(S, REAL, 'Main St, New York NY 10001', undefined);
  assert.equal(packedState('10001'), 'NY', 'literal fact: 10001 is in New York');
  const row = stateRow('NY');
  assert.equal(S.zip, '10001');
  assert.equal(S.state, 'NY');
  assert.equal(S.tax, row[3]);
  assert.equal(S.gas, r3(row[2]), 'regular gas: the state row, rounded as §4.2');
});

test('done-when: the cascade: setCar to a premium car sets fuel, mpg and gas with the premium spread', () => {
  const S = ST.fresh(REAL);
  ST.setAddress(S, REAL, 'Main St, New York NY 10001', undefined);
  ST.setCar(S, REAL, 'Acura', 'ADX');
  assert.ok(REAL.CAR_DATA.some((r) => /^Acura\|(.*,)?ADX:28\*(,|$)/.test(r)), 'CAR_DATA lists ADX:28* (premium)');
  assert.equal(S.fuel, 'premium');
  assert.equal(S.mpg, 28);
  assert.equal(S.miPerKwh, null);
  const row = stateRow('NY');
  assert.equal(S.gas, r3(row[2] + REAL.GRADE_ADD.premium), 'gas = state gas + GRADE_ADD.premium (§4.2)');
  assert.equal(S.tax, row[3]);
});

test('done-when: the cascade: a new address in another state re-derives tax and gas and keeps fuel and mpg', () => {
  const S = ST.fresh(REAL);
  ST.setAddress(S, REAL, 'Main St, New York NY 10001', undefined);
  ST.setCar(S, REAL, 'Acura', 'ADX');
  ST.setAddress(S, REAL, 'Ranch Rd, Helena MT 59601', undefined);
  assert.equal(packedState('59601'), 'MT', 'literal fact: 59601 is in Montana');
  const mt = stateRow('MT');
  assert.notEqual(mt[3], stateRow('NY')[3], 'the two states have different meal taxes in the data');
  assert.equal(S.state, 'MT');
  assert.equal(S.tax, mt[3]);
  assert.equal(S.gas, r3(mt[2] + REAL.GRADE_ADD.premium));
  assert.equal(S.fuel, 'premium');
  assert.equal(S.mpg, 28);
  assert.equal(S.make, 'Acura');
});

test('done-when: the cascade: derive run twice gives the same JSON', () => {
  const S = ST.fresh(REAL);
  ST.setAddress(S, REAL, 'Main St, New York NY 10001', undefined);
  ST.setCar(S, REAL, 'Acura', 'ADX');
  ST.setBrand(S, REAL, 'subway', undefined);
  ST.pinMiles(S, 3);
  // A card and a manual credit, so the wallet has entries that a second derive could duplicate.
  assert.equal(ST.toggleCard(S, REAL, 'chase_sapphire_reserve', true, NOW), true);
  assert.equal(ST.addManualCredit(S, REAL, { name: 'Gift', amount: 25, cadence: 'annual', plats: ['dd'] }, NOW), 'manual.1');
  assert.ok(S.credits.length > 1, 'the wallet has entries');
  const before = JSON.stringify(S);
  ST.derive(S, REAL, NOW, undefined);
  const once = JSON.stringify(S);
  ST.derive(S, REAL, NOW, undefined);
  assert.equal(once, before, 'derive on an already derived state changes nothing');
  assert.equal(JSON.stringify(S), once, 'the second derive gives the same JSON');
});

// The round trip on S1: six states built only by actions, each saved and loaded back with the same clock.
const ROUND_TRIP = {
  'an address only': (S, D) => {
    S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
  },
  'a pinned trip': (S, D) => {
    S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
    S1ST.setCar(S, D, 'Acme', 'Sport');
    S1ST.setBrand(S, D, 'pz', undefined);
    assert.equal(S1ST.pinMiles(S, 2.5), true);
  },
  'a picked store': (S, D) => {
    S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
    S1ST.setBrand(S, D, 'pz', undefined);
    const st = S1ST.pickStore(S, D, { brand: 'pz', id: 'pz@40050,-74000', lat: 40.05, lon: -74 }, undefined);
    assert.equal(st.status, 'ok');
    assert.equal(S.storePicked, true);
  },
  'a GPS position': (S, D) => {
    S1ST.setBrand(S, D, 'pz', undefined);
    assert.equal(S1ST.setPosition(S, D, 40.02, -74, undefined).status, 'ok');
    assert.equal(S.pos.src, 'gps');
  },
  'cards, opt-in, used and two manual credits': (S, D) => {
    S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
    assert.equal(S1ST.toggleCard(S, D, 'c_gold', true, NOW), true);
    assert.equal(S1ST.toggleCard(S, D, 'c_dd', true, NOW), true);
    assert.equal(S1ST.setOptIn(S, D, 'c_gold.resy', true, NOW), true);
    assert.equal(S1ST.markUsed(S, D, 'c_gold.dining', true, NOW), true);
    assert.equal(S1ST.addManualCredit(S, D, { name: 'Gift card', amount: 25, cadence: 'annual', plats: ['dd'] }, NOW), 'manual.1');
    assert.equal(S1ST.addManualCredit(S, D, { name: 'Perk', amount: 5, cadence: 'monthly', plats: ['direct'], modes: ['p'] }, NOW), 'manual.2');
  },
  'promos and fee edits through setPath': (S, D) => {
    S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
    S1ST.setBrand(S, D, 'pz', undefined);
    const edits = [
      ['promos.dd.type', 'percent'], ['promos.dd.value', 10], ['promos.dd.cap', 5],
      ['plats.dd.delFee', 2.99], ['plats.ue.cardMember', false], ['plats.gh.memberOwn', true],
      ['tipDel', 18], ['regFee', 1.5], ['plats.direct.on', false]
    ];
    for (const [p, v] of edits) assert.equal(S1ST.setPath(S, p, v), true, 'setPath ' + p);
    // §3: setPath re-derives nothing (plats.gh.member is stale until the caller runs the apply step).
    // The page runs derive after each edit, so the state the round trip starts from is derived.
    S1ST.derive(S, D, NOW, undefined);
  },
  'a profiled brand with a cart, dealOn off and changed numbers': (S, D) => {
    S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
    S1ST.setBrand(S, D, 'pz', undefined);
    assert.equal(S1ST.setQty(S, 0, 2), true, 'setQty on a profiled brand');
    assert.equal(S.cart['0'], 2);
    const edits = [
      ['dealOn', false], ['wear', 0.2], ['hourly', 12], ['kwh', 0.25], ['speed', 35], ['manualSubtotal', 14.5]
    ];
    for (const [p, v] of edits) assert.equal(S1ST.setPath(S, p, v), true, 'setPath ' + p);
    S1ST.derive(S, D, NOW, undefined);
  }
};

test('done-when: the cascade: seven S1 states built by actions survive save and load unchanged', () => {
  const names = Object.keys(ROUND_TRIP);
  assert.ok(names.length >= 5, 'at least five states');
  for (const name of names) {
    const D = s1Data();
    const S = S1ST.fresh(D);
    ROUND_TRIP[name](S, D);
    const st = memStorage();
    assert.equal(S1ST.save(S, st), true, name + ': save returns true');
    const loaded = S1ST.load(st, D, NOW, undefined);
    assert.deepEqual(J(loaded), J(S), name + ': JSON of load(save(S)) equals JSON of S');
  }
});

// ---- B: syncCredits keeps used flags, manual credits and opt-ins (real POD.data.CARDS) ----------

const cardKeys = (pred) => REAL.CARDS.flatMap((c) => c.credits.filter(pred).map((k) => c.id + '.' + k.id));

/** Each card credit's plats: [] when locked, or restricted and not opted in; else the cards.js plats. */
function checkTiers(S, optedIn) {
  for (const c of S.credits) {
    if (c.manual) continue;
    const card = REAL.CARDS.find((x) => x.id === c.cardId);
    const src = card.credits.find((k) => card.id + '.' + k.id === c.key);
    if (src.locked || (src.restricted && !optedIn.has(c.key))) {
      assert.deepEqual(J(c.plats), [], c.key + ': no plats without the tier it needs');
    } else {
      assert.deepEqual(J(c.plats), J(src.plats), c.key + ': plats equal cards.js');
    }
  }
}

test('done-when: syncCredits keeps used, manual credits and opt-ins', () => {
  const S = ST.fresh(REAL);
  const cardIds = REAL.CARDS.map((c) => c.id);
  for (const id of cardIds) assert.equal(ST.toggleCard(S, REAL, id, true, NOW), true);
  checkTiers(S, new Set());   // before any opt-in: restricted credits have no plats
  for (const k of cardKeys((c) => c.restricted)) assert.equal(ST.setOptIn(S, REAL, k, true, NOW), true, 'opt in ' + k);
  for (const e of J(S.credits)) assert.equal(ST.markUsed(S, REAL, e.key, true, NOW), true, 'used ' + e.key);
  const m1 = ST.addManualCredit(S, REAL, { name: 'Manual one', amount: 20, cadence: 'monthly', plats: ['dd'] }, NOW);
  const m2 = ST.addManualCredit(S, REAL, { name: 'Manual two', amount: 7, cadence: 'once', plats: ['direct'], modes: ['p'] }, NOW);
  assert.equal(m1, 'manual.1');
  assert.equal(m2, 'manual.2');
  assert.equal(ST.markUsed(S, REAL, m1, true, NOW), true);
  assert.equal(ST.markUsed(S, REAL, m2, true, NOW), true);
  const kept = J({ creditOptIn: S.creditOptIn, usedIn: S.usedIn, manualCredits: S.manualCredits });

  for (const id of cardIds) assert.equal(ST.toggleCard(S, REAL, id, false, NOW), true);
  assert.deepEqual(J(S.credits.map((c) => c.key)), [m1, m2], 'with no card, only the two manual credits remain');
  assert.ok(S.credits.every((c) => c.used === true && c.manual === true), 'the manual credits are still used');
  assert.deepEqual(J({ creditOptIn: S.creditOptIn, usedIn: S.usedIn, manualCredits: S.manualCredits }), kept,
    'opt-ins, used flags and manual credits are unchanged by the toggles off');

  for (const id of [...cardIds].reverse()) assert.equal(ST.toggleCard(S, REAL, id, true, NOW), true);
  const want = [...cardKeys(() => true), m1, m2];
  assert.deepEqual(J(S.credits.map((c) => c.key)), want, 'credits come back in D.CARDS order, manual last');
  assert.ok(S.credits.every((c) => c.used === true), 'every credit is used after the toggles back on');
  checkTiers(S, new Set(cardKeys((c) => c.restricted)));   // every restricted credit is opted in now
  assert.deepEqual(J({ creditOptIn: S.creditOptIn, usedIn: S.usedIn, manualCredits: S.manualCredits }), kept);
});

// ---- C: a throwing storage falls back to defaults -----------------------------------------------

function throwingStorage() {
  const counts = { getItem: 0, setItem: 0 };
  return {
    counts,
    getItem() { counts.getItem++; throw new Error('storage off'); },
    setItem() { counts.setItem++; throw new Error('storage off'); }
  };
}

function defaultJson() {
  const S = ST.fresh(REAL);
  ST.derive(S, REAL, NOW, undefined);
  return JSON.stringify(S);
}

test('done-when: a throwing storage falls back to defaults', () => {
  const st = throwingStorage();
  assert.equal(JSON.stringify(ST.load(st, REAL, NOW, undefined)), defaultJson());
  assert.equal(st.counts.setItem, 0, 'load never calls setItem');
});

test('done-when: storage null, {}, or a getItem that returns an object all fall back to defaults', () => {
  const want = defaultJson();
  assert.equal(JSON.stringify(ST.load(null, REAL, NOW, undefined)), want, 'storage null');
  assert.equal(JSON.stringify(ST.load({}, REAL, NOW, undefined)), want, 'storage {}');
  const objectReturning = { getItem() { return { address: 'x' }; } };
  assert.equal(JSON.stringify(ST.load(objectReturning, REAL, NOW, undefined)), want, 'getItem returns an object');
});

test('done-when: a getItem that throws while setItem works falls back, and load never calls setItem', () => {
  const counts = { setItem: 0 };
  const storage = {
    getItem() { throw new Error('read off'); },
    setItem() { counts.setItem++; }
  };
  assert.equal(JSON.stringify(ST.load(storage, REAL, NOW, undefined)), defaultJson());
  assert.equal(counts.setItem, 0);
});

test('done-when: load of a valid saved text never calls setItem', () => {
  const writes = { n: 0 };
  const saved = memStorage();
  const S = ST.fresh(REAL);
  ST.setAddress(S, REAL, 'Main St, New York NY 10001', undefined);
  assert.equal(ST.save(S, saved), true);
  const storage = {
    getItem: (k) => saved.getItem(k),
    setItem() { writes.n++; }
  };
  const loaded = ST.load(storage, REAL, NOW, undefined);
  assert.equal(writes.n, 0, 'load writes nothing');
  assert.equal(loaded.zip, '10001', 'the saved address is read back');
});

test('done-when: save returns false when storage is null, {} or setItem throws', () => {
  const S = ST.fresh(REAL);
  const throws = () => { throw new Error('quota'); };
  assert.equal(ST.save(S, null), false, 'storage null');
  assert.equal(ST.save(S, {}), false, 'storage without setItem');
  assert.equal(ST.save(S, { getItem: throws, setItem: throws }), false, 'setItem throws');
  assert.equal(ST.save(S, { setItem: throws }), false, 'setItem throws alone');
});

function evidenceField(S, key) {
  const m = /^(dd|ue|gh)\.(\w+)$/.exec(key);
  if (m) return S.plats[m[1]][m[2]];
  return S[key];
}

test('done-when: fresh(D) copies the sourced defaults exactly and leaves the nulls null', () => {
  const S = ST.fresh(REAL);
  const all = Object.assign({}, EVID.plats, EVID.trip);
  assert.equal(Object.keys(all).length, 26, 'the two evidence files hold 26 values');
  for (const key of Object.keys(all)) {
    const got = evidenceField(S, key);
    assert.strictEqual(got, all[key].value, 'fresh ' + key + ' equals its evidence value');
  }
});

// ---- D: never throws (§0) -----------------------------------------------------------------------

const JUNK = [undefined, null, NaN, Infinity, -1, 0, '', 'x', {}, [], true, JSON.parse('{"__proto__":{"x":1}}')];
const JUNK_D = [{}, { CARDS: 'x' }, { CARDS: [null, { id: 5 }, { id: 'c', credits: 'x' }] }, { DEFAULTS: { plats: null } }];
const PH = { S: Symbol('S'), D: Symbol('D'), MEM: Symbol('MEM') };

/** A state with an address, a car, a brand and a card, on S1 data. */
function builtS1() {
  const D = s1Data();
  const S = S1ST.fresh(D);
  S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
  S1ST.setCar(S, D, 'Acme', 'Sport');
  S1ST.setBrand(S, D, 'pz', undefined);
  S1ST.toggleCard(S, D, 'c_gold', true, NOW);
  return S;
}

/** Every POD.state function with a valid argument list. PH.S, PH.D, PH.MEM are placeholders. */
const CALLS = {
  fresh: [PH.D],
  getPath: [PH.S, 'plats.dd.svc'],
  setPath: [PH.S, 'plats.dd.svc', 3],
  applyCar: [PH.S, PH.D],
  applyState: [PH.S, PH.D],
  applyAddress: [PH.S, PH.D],
  applyBrand: [PH.S, PH.D],
  autoMiles: [PH.S, PH.D, undefined],
  applyMinutes: [PH.S],
  syncCredits: [PH.S, PH.D, NOW],
  derive: [PH.S, PH.D, NOW, undefined],
  setAddress: [PH.S, PH.D, 'Main St, NY 10001', undefined],
  setPosition: [PH.S, PH.D, 40.02, -74, undefined],
  setCar: [PH.S, PH.D, 'Acme', 'Sport'],
  setBrand: [PH.S, PH.D, 'pz', undefined],
  pickStore: [PH.S, PH.D, { brand: 'pz', id: 'pz@40050,-74000', lat: 40.05, lon: -74 }, undefined],
  setQty: [PH.S, 0, 1],
  pinMiles: [PH.S, 2.5],
  unpinMiles: [PH.S, PH.D, undefined],
  toggleCard: [PH.S, PH.D, 'c_gold', true, NOW],
  setOptIn: [PH.S, PH.D, 'c_gold.resy', true, NOW],
  markUsed: [PH.S, PH.D, 'c_gold.dining', true, NOW],
  addManualCredit: [PH.S, PH.D, { name: 'Gift', amount: 5, cadence: 'once', plats: ['dd'] }, NOW],
  removeManualCredit: [PH.S, PH.D, 'manual.1', NOW],
  periodOf: ['monthly', NOW],
  missing: [PH.S],
  appMissing: [PH.S, 'dd'],
  forEngine: [PH.S],
  load: [PH.MEM, PH.D, NOW, undefined],
  save: [PH.S, PH.MEM]
};

test('D-031 §3 setPath refuses an object, an array, undefined, NaN and ±Infinity, and changes nothing', () => {
  const D = s1Data();
  const S = S1ST.fresh(D);
  S1ST.setAddress(S, D, 'Main St, NY 10001', undefined);
  const before = JSON.stringify(S);
  const svc = S1ST.getPath(S, 'plats.dd.svc');
  assert.equal(svc, 15, 'literal: the S1 dd svc default is 15');
  for (const v of [{}, [], { a: 1 }, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(S1ST.setPath(S, 'plats.dd.svc', v), false, 'setPath refuses ' + util.inspect(v));
    assert.ok(Object.is(S1ST.getPath(S, 'plats.dd.svc'), 15), 'the value is still 15 after ' + util.inspect(v));
  }
  assert.equal(JSON.stringify(S), before, 'S is unchanged');
});

function fill(tmpl, S, D, storage) {
  return tmpl.map((v) => (v === PH.S ? S : v === PH.D ? D : v === PH.MEM ? storage : v));
}

test('D-031 §0 every POD.state function takes junk in each non-S argument without throwing', () => {
  assert.deepEqual(Object.keys(CALLS).sort(), Object.keys(ST).sort(), 'the table covers every POD.state function');
  for (const name of Object.keys(CALLS)) {
    const tmpl = CALLS[name];
    for (const variant of ['fresh', 'built']) {
      const slots = tmpl.map((v, i) => i).filter((i) => tmpl[i] !== PH.S);
      const cases = [null];
      for (const i of slots) for (const junk of JUNK) cases.push([i, junk]);
      for (const c of cases) {
        const S = variant === 'fresh' ? S1ST.fresh(s1Data()) : builtS1();
        const D = s1Data();
        const storage = memStorage();
        const args = fill(tmpl, S, D, storage);
        if (c !== null) args[c[0]] = c[1];
        const label = name + ' [' + variant + '] arg ' + (c ? c[0] + '=' + util.inspect(c[1]) : 'none');
        try {
          S1ST[name](...args);
        } catch (e) {
          assert.fail(label + ' threw: ' + (e && e.message));
        }
        assert.ok(Array.isArray(S1ST.missing(S)), label + ': missing(S) is an array afterwards');
      }
    }
  }
});

test('D-031 §0 fresh, derive, load, syncCredits and forEngine take a junk D without throwing', () => {
  for (const junk of JUNK_D) {
    const label = util.inspect(junk);
    assert.doesNotThrow(() => S1ST.fresh(junk), label + ': fresh');
    for (const variant of ['fresh', 'built']) {
      const S = variant === 'fresh' ? S1ST.fresh(junk) : builtS1();
      assert.doesNotThrow(() => S1ST.derive(S, junk, NOW, undefined), label + ': derive ' + variant);
      assert.doesNotThrow(() => S1ST.syncCredits(S, junk, NOW), label + ': syncCredits ' + variant);
      assert.doesNotThrow(() => S1ST.forEngine(S), label + ': forEngine ' + variant);
      assert.ok(Array.isArray(S1ST.missing(S)), label + ': missing(S) is an array');
    }
    assert.doesNotThrow(() => S1ST.load(memStorage(), junk, NOW, undefined), label + ': load');
    assert.doesNotThrow(() => S1ST.load(throwingStorage(), junk, NOW, undefined), label + ': load, throwing storage');
  }
});

// ---- E: prototype pollution (§3, §6, §8) --------------------------------------------------------

const PROTO_KEYS = ['__proto__', 'constructor', 'prototype'];

test('D-031 §3 §6 setOptIn, markUsed, removeManualCredit and setPath refuse __proto__, constructor and prototype', () => {
  const before = protoSnapshot(S1SB);
  const D = s1Data();
  const S = S1ST.fresh(D);
  S1ST.toggleCard(S, D, 'c_gold', true, NOW);
  for (const k of PROTO_KEYS) {
    assert.equal(typeof S1ST.setOptIn(S, D, k, true, NOW), 'boolean', 'setOptIn ' + k);
    assert.equal(S1ST.markUsed(S, D, k, true, NOW), false, 'markUsed ' + k + ': no such credit');
    assert.equal(S1ST.removeManualCredit(S, D, k, NOW), false, 'removeManualCredit ' + k);
    assert.equal(S1ST.setPath(S, k, 1), false, 'setPath ' + k);
    assert.equal(S1ST.setPath(S, 'plats.dd.' + k, 1), false, 'setPath plats.dd.' + k);
    assert.equal(S1ST.setPath(S, 'cart.' + k, 1), false, 'setPath cart.' + k);
    assert.equal(S1ST.setPath(S, k + '.x', 1), false, 'setPath ' + k + '.x');
  }
  for (const k of PROTO_KEYS) {
    assert.equal(hasOwn(S.creditOptIn, k), false, 'creditOptIn has no own ' + k);
  }
  assert.deepEqual(protoSnapshot(S1SB), before, 'neither Object.prototype gained a property');
  assert.equal(Object.getPrototypeOf(S.creditOptIn), vmObjectProto(S1SB));
});

test('D-031 §8 load of a saved text with __proto__ keys gains nothing and keeps the VM prototype', () => {
  const before = protoSnapshot(S1SB);
  const text = '{"cart":{"__proto__":{"x":1}},"creditOptIn":{"__proto__":true},"milesBy":{"constructor":3},' +
    '"usedIn":{"__proto__":"x"},"plats":{"__proto__":{"on":false}},"promos":{"__proto__":{"type":"dollar"}}}';
  const storage = { getItem: () => text, setItem() { throw new Error('load never writes'); } };
  const S = S1ST.load(storage, s1Data(), NOW, undefined);
  assert.deepEqual(protoSnapshot(S1SB), before, 'neither Object.prototype gained a property');
  for (const field of ['cart', 'creditOptIn', 'milesBy', 'usedIn']) {
    assert.equal(Object.getPrototypeOf(S[field]), vmObjectProto(S1SB), 'S.' + field + ' keeps the VM Object.prototype');
    assert.deepEqual(Object.keys(S[field]), [], 'S.' + field + ' has no key from the text');
  }
  assert.equal(S.plats.dd.on, true, 'the plats key did not reach dd');
  assert.equal(S.promos.dd.type, 'none', 'the promos key did not reach dd');
});

// ---- F: forEngine (§7, D-032) -------------------------------------------------------------------

test('D-032 §7 forEngine returns a copy that shares nothing with S, and S is unchanged', () => {
  const S = readyState();
  assert.deepEqual(J(ST.missing(S)), [], 'the ready state has nothing missing');
  const set = objectsIn(S, new Set());
  const before = JSON.stringify(S);
  const F = ST.forEngine(S);
  assert.ok(F !== null, 'forEngine is not null when missing(S) is []');
  assert.equal(JSON.stringify(S), before, 'the call leaves S as it was');
  assert.equal(sharedWith(F, set), null, 'no object of the copy is an object of S');
});

test('D-032 §7 appMissing lists exactly the evidence nulls of each app, then the shared fees', () => {
  const S = readyState();
  for (const app of APPS) {
    const want = [];
    for (const f of ['delFee', 'svc', 'svcMin', 'memberSvc', 'memberMin', 'pickDisc']) {
      if (EVID.plats[app + '.' + f].value === null) want.push('plats.' + app + '.' + f);
    }
    for (const f of ['regFee', 'smallMin', 'smallFee']) {
      if (EVID.plats[f].value === null) want.push(f);
    }
    assert.deepEqual(J(ST.appMissing(S, app)), want, app + ': appMissing');
    assert.equal(S.plats[app].markup, REAL.PROFILES.subway.markup[app], app + ': markup comes from the profile, not the evidence');
  }
});

test('D-033 §7 forEngine: an app missing only delivery inputs keeps pickup (noDelivery), and only those apps', () => {
  const S = readyState();
  // D-032: under the real defaults every app lacks only delivery inputs (pickDisc is 0, markup comes from the profile).
  for (const app of APPS) {
    const miss = J(ST.appMissing(S, app));
    assert.ok(miss.length > 0, app + ' has empty delivery fees under the real defaults');
    assert.ok(!miss.includes('plats.' + app + '.markup') && !miss.includes('plats.' + app + '.pickDisc'),
      app + ': markup and pickDisc are present');
  }
  const F = ST.forEngine(S);
  for (const app of APPS) {
    assert.equal(F.plats[app].on, true, app + ' keeps its pickup in the copy');
    assert.equal(F.plats[app].noDelivery, true, app + ' loses its delivery in the copy');
  }
  assert.equal(F.plats.direct.on, true, 'direct is not an app and stays on');
  assert.equal(Object.prototype.hasOwnProperty.call(F.plats.direct, 'noDelivery'), false, 'direct never gets noDelivery');
  for (const app of APPS) {
    assert.equal(Object.prototype.hasOwnProperty.call(S.plats[app], 'noDelivery'), false, app + ': S itself is unchanged');
  }
  const ids = J(FULL.POD.engine.allResults(F).map((r) => r.id));
  for (const app of APPS) {
    if (S.rest.platforms.includes(app)) assert.ok(ids.includes(app + '-p'), app + '-p is priced');
    assert.ok(!ids.includes(app + '-d'), app + '-d is left out');
  }

  // Fill every field dd lacks: dd is then complete and has no noDelivery; ue and gh keep theirs.
  assert.equal(ST.setPath(S, 'plats.dd.delFee', 2.99), true);
  assert.equal(ST.setPath(S, 'plats.dd.svcMin', 3), true);
  assert.equal(ST.setPath(S, 'regFee', 0), true);
  assert.equal(ST.setPath(S, 'smallMin', 10), true);
  assert.equal(ST.setPath(S, 'smallFee', 2.5), true);
  assert.deepEqual(J(ST.appMissing(S, 'dd')), [], 'dd is complete');
  const F2 = ST.forEngine(S);
  assert.equal(F2.plats.dd.on, true, 'a complete app stays on');
  assert.equal(Object.prototype.hasOwnProperty.call(F2.plats.dd, 'noDelivery'), false, 'a complete app gets no noDelivery');
  assert.equal(F2.plats.ue.noDelivery, true);
  assert.equal(F2.plats.gh.noDelivery, true);

  // A missing pickup input (pickDisc) switches the whole app off, with no noDelivery.
  assert.equal(ST.setPath(S, 'plats.ue.pickDisc', null), true);
  const F3 = ST.forEngine(S);
  assert.equal(F3.plats.ue.on, false, 'a missing pickDisc switches ue off');
  assert.equal(Object.prototype.hasOwnProperty.call(F3.plats.ue, 'noDelivery'), false, 'an app switched off gets no noDelivery');
  assert.equal(S.plats.ue.on, true, 'the user switch on S is unchanged');
});

// ---- G: periodOf across realms (§5.2) -----------------------------------------------------------

test('D-031 §5.2 periodOf gives the same answer for a host-realm Date and a VM-realm Date', () => {
  const vmNow = vm.runInContext('new Date(2026, 10, 13, 12)', S1SB);
  const vmBad = vm.runInContext('new Date(NaN)', S1SB);
  const want = { monthly: '2026-11', quarterly: '2026-Q4', semiannual: '2026-H2', annual: '2026', once: 'once', weekly: null };
  for (const cadence of Object.keys(want)) {
    assert.equal(S1ST.periodOf(cadence, NOW), want[cadence], 'host Date, ' + cadence);
    assert.equal(S1ST.periodOf(cadence, vmNow), want[cadence], 'VM Date, ' + cadence);
  }
  assert.equal(S1ST.periodOf('monthly', vmBad), null, 'an invalid VM Date is null');
  assert.equal(S1ST.periodOf('monthly', new Date(NaN)), null, 'an invalid host Date is null');
});

// ---- H: the per-item promo index (D-036; state contract §2, §6, §8) -----------------------------
// Expected values are the contract's text: a fresh promo's item is null, setBrand clears it, load
// keeps an integer >= 0 (0 included) and drops anything else alone, and save/load keeps it.

test('D-036 §2 fresh gives item: null for every app, with the other promo fields at their blank values', () => {
  const S = ST.fresh(REAL);
  for (const p of APPS) {
    assert.deepEqual(J(S.promos[p]), { type: 'none', value: 0, cap: 0, min: 0, item: null }, p + ' promo');
  }
});

test('D-036 §1 setPath("promos.dd.item", 2) returns true and writes the index', () => {
  const S = ST.fresh(REAL);
  assert.equal(ST.setPath(S, 'promos.dd.item', 2), true);
  assert.equal(S.promos.dd.item, 2);
  assert.equal(ST.getPath(S, 'promos.dd.item'), 2);
});

test('D-036 §6 setBrand clears every app\'s item and keeps type, value, cap and min', () => {
  const S = ST.fresh(REAL);
  APPS.forEach((p, n) => {
    assert.equal(ST.setPath(S, 'promos.' + p + '.type', 'bogo'), true, p + ' type');
    assert.equal(ST.setPath(S, 'promos.' + p + '.value', 0), true, p + ' value');
    assert.equal(ST.setPath(S, 'promos.' + p + '.cap', 20), true, p + ' cap');
    assert.equal(ST.setPath(S, 'promos.' + p + '.min', 30), true, p + ' min');
    assert.equal(ST.setPath(S, 'promos.' + p + '.item', 2 + n), true, p + ' item');
  });
  ST.setBrand(S, REAL, 'dominos', undefined);
  for (const p of APPS) {
    assert.deepEqual(J(S.promos[p]), { type: 'bogo', value: 0, cap: 20, min: 30, item: null }, p + ' after setBrand');
  }
});

test('D-036 §8 load keeps an integer item >= 0 (0 included) and drops each other value alone, keeping the rest of the promo', () => {
  // item 0 is an integer >= 0: kept. "0" (a string), true, 1.5, -1 and {} are dropped to null.
  const cases = [[0, 0], [3, 3], ['0', null], [true, null], [1.5, null], [-1, null], [{}, null]];
  for (const [saved, want] of cases) {
    const text = JSON.stringify({ promos: { dd: { type: 'bogo', value: 0, cap: 20, min: 30, item: saved } } });
    const storage = { getItem: () => text, setItem() { throw new Error('load never writes'); } };
    const S = ST.load(storage, REAL, NOW, undefined);
    assert.deepEqual(J(S.promos.dd), { type: 'bogo', value: 0, cap: 20, min: 30, item: want },
      'saved item ' + JSON.stringify(saved));
    assert.equal(S.promos.ue.item, null, 'the other app keeps its blank item');
  }
});

test('D-036 §8 a save and load round trip keeps promos[p].item', () => {
  const S = ST.fresh(REAL);
  assert.equal(ST.setPath(S, 'promos.ue.type', 'bogo'), true);
  assert.equal(ST.setPath(S, 'promos.ue.item', 4), true);
  const st = memStorage();
  assert.equal(ST.save(S, st), true, 'save returns true');
  const loaded = ST.load(st, REAL, NOW, undefined);
  assert.equal(loaded.promos.ue.item, 4, 'ue item after load');
  assert.equal(loaded.promos.dd.item, null, 'dd item stays null');
});
