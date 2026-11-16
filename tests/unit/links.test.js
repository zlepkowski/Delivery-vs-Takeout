// POD.links.forChannel (docs/links-contract.md §0–§2, D-041), tested on its own.
//
// Expected values come from tests/fixtures/links/cases.json (hand-worked in build.py), from the
// data file's own values (src/data/links.js) and from the contract's rules, never from the code
// under test. Every test here must fail if its rule breaks, with no other test file present.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, APP_ROOT } = require('../helpers/load');

const FIX = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tests', 'fixtures', 'links', 'cases.json'), 'utf8'));
const CHANNELS = ['direct-d', 'direct-p', 'dd-d', 'dd-p', 'ue-d', 'ue-p', 'gh-d', 'gh-p'];
const FORBIDDEN_PRIVACY = ['Secret', '99999', '12.3456', '76.543', '77.77'];

// JSON round trip: returns main-realm objects. JSON.parse defines "__proto__" as an own key, so the
// cases' proto-named brands survive the copy (a plain property assignment would not).
const copy = (v) => JSON.parse(JSON.stringify(v));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Main-realm copy of a VM-realm result, so deepStrictEqual against literals works (ISS-008).
const plain = (v) => JSON.parse(JSON.stringify(v));

/** The named dataset from cases.json as a fresh copy, or null. */
function dataset(name) {
  return name === null ? null : copy(FIX.datasets[name]);
}

/** Every element is a {kind, label, href} with an https href (the contract's valid list). */
function assertValidList(out, msg) {
  assert.ok(Array.isArray(out), msg + ': not an array');
  for (const l of out) {
    assert.equal(typeof l.kind, 'string', msg + ': kind');
    assert.equal(typeof l.label, 'string', msg + ': label');
    assert.equal(typeof l.href, 'string', msg + ': href');
    assert.equal(l.href.indexOf('https://'), 0, msg + ': href is not https: ' + l.href);
  }
}

function deepFreeze(v) {
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

const { POD } = loadApp();
const REAL_D = POD.data;

// ------------------------------------------------------------------ the case table

test('§5 cases.json has at least 85 hand-worked cases (an emptied file cannot pass)', () => {
  assert.ok(FIX.cases.length >= 85, 'only ' + FIX.cases.length + ' cases');
  for (const c of FIX.cases) {
    assert.equal(c.fn, 'forChannel');
    assert.ok(c.data === null || own(FIX.datasets, c.data), 'unknown dataset ' + c.data);
  }
});

FIX.cases.forEach((c, i) => {
  test(`§2 [${i}] ${c.id}`, () => {
    const out = POD.links.forChannel(c.ch, copy(c.S), dataset(c.data));
    // Compare as main-realm JSON: keys in any order, but no extra keys and no missing ones.
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), c.expect);
  });
});

// ------------------------------------------------------------------ every result row hands off (D-041)

test('D-041 every result row hands off on the real data, for every brand and channel', () => {
  const BRANDS = REAL_D.BRANDS;
  const PROFILES = REAL_D.PROFILES;
  const IDS = Array.from(REAL_D.BRAND_IDS);
  assert.ok(IDS.length > 0, 'BRAND_IDS is empty');
  let rows = 0;
  for (const brand of IDS) {
    assert.ok(own(BRANDS, brand), 'no BRANDS entry for ' + brand);
    const name = BRANDS[brand].name;
    const profiled = own(PROFILES, brand);
    const stores = [null, { id: brand + '@1,2', lat: 40.7, lon: -74 }];
    for (const store of stores) {
      for (const ch of CHANNELS) {
        const S = { brand: brand, rest: { name: name }, store: store === null ? null : copy(store) };
        const out = POD.links.forChannel(ch, S, REAL_D);
        const where = brand + ' ' + ch + (store ? ' with store' : ' no store');
        rows++;
        assertValidList(out, where);
        if (ch === 'direct-d' && !profiled) {
          // D-006: this row never exists. The contract gives it nothing.
          assert.equal(out.length, 0, where + ' should be empty');
        } else if (ch === 'direct-d') {
          assert.equal(out.length, 1, where + ' should be the site only');
          assert.equal(out[0].kind, 'order', where);
        } else {
          assert.ok(out.length >= 1, where + ' gives no link');
        }
      }
    }
  }
  assert.ok(rows >= IDS.length * CHANNELS.length * 2, 'too few rows checked');
});

// ------------------------------------------------------------------ real-data pins (by hand from src/data/links.js)

test('D-041 Domino\'s dd-p and dd-d: the DoorDash search format, filled with the name', () => {
  const { POD } = loadApp();
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: null };
  const want = [{ kind: 'search', label: "Search DoorDash for Domino's", href: "https://www.doordash.com/search/store/Domino's/" }];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('dd-p', S, POD.data))), want);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('dd-d', S, POD.data))), want);
});

test('D-041 Uber Eats and Grubhub open their home pages (both modes), from the data file', () => {
  const { POD } = loadApp();
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: null };
  const ue = [{ kind: 'app', label: 'Open Uber Eats', href: 'https://www.ubereats.com/' }];
  const gh = [{ kind: 'app', label: 'Open Grubhub', href: 'https://www.grubhub.com/' }];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('ue-d', S, POD.data))), ue);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('ue-p', S, POD.data))), ue);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('gh-d', S, POD.data))), gh);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('gh-p', S, POD.data))), gh);
});

test("D-041 Domino's direct-p with its store: the order link, then directions at five decimals", () => {
  const { POD } = loadApp();
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } };
  // 40.755 and -73.989 at five decimals: 40.75500 and -73.98900 (hand-rounded).
  const want = [
    { kind: 'order', label: "Order from Domino's", href: 'https://www.dominos.com/' },
    { kind: 'dir', label: 'Directions in Google Maps', href: 'https://www.google.com/maps/dir/?api=1&destination=40.75500%2C-73.98900' },
  ];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('direct-p', S, POD.data))), want);
});

test('D-041 direct-d for Domino\'s is the chain\'s own site, and no map link', () => {
  const { POD } = loadApp();
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('direct-d', S, POD.data))),
    [{ kind: 'order', label: "Order from Domino's", href: 'https://www.dominos.com/' }]);
});

// ------------------------------------------------------------------ guards by name

test('§2.1 a channel that is not one of the eight gives nothing (no-dash, extra part, wrong mode, capitals)', () => {
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } };
  for (const ch of ['dd', 'direct', 'direct-', 'dd-p-x', 'ue-x', 'gh-d-x', 'direct-x', 'DD-P', 'constructor', '__proto__', 'toString', '']) {
    assert.deepStrictEqual(plain(POD.links.forChannel(ch, S, REAL_D)), [], 'channel ' + JSON.stringify(ch));
  }
});

// ------------------------------------------------------------------ own properties only (§0)

test('§0 an inherited S.store gets the map search, not directions', () => {
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: Object.create({ id: 'dominos@1', lat: 1, lon: 2 }) };
  const out = POD.links.forChannel('direct-p', S, REAL_D);
  assert.deepStrictEqual(plain(out), [
    { kind: 'order', label: "Order from Domino's", href: 'https://www.dominos.com/' },
    { kind: 'map', label: "Find Domino's in Google Maps", href: "https://www.google.com/maps/search/?api=1&query=Domino's" },
  ]);
});

test('§0 an inherited S.rest.name gives nothing', () => {
  const S = { brand: 'dominos', rest: Object.create({ name: "Domino's" }), store: null };
  assert.deepStrictEqual(plain(POD.links.forChannel('dd-p', S, REAL_D)), []);
});

test('§0 an inherited S.brand, S.rest or D.LINKS gives nothing', () => {
  const inheritedBrand = Object.create({ brand: 'dominos', rest: { name: "Domino's" }, store: null });
  assert.deepStrictEqual(plain(POD.links.forChannel('dd-p', inheritedBrand, REAL_D)), []);
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: null };
  assert.deepStrictEqual(plain(POD.links.forChannel('dd-p', S, Object.create(REAL_D))), []);
});

test('§0 an inherited order entry for the brand is not the chain\'s site', () => {
  const L = copy(FIX.datasets.T.LINKS);
  L.order = Object.create(L.order);   // dominos is inherited, not own
  const D = { LINKS: L };
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: null };
  assert.deepStrictEqual(plain(POD.links.forChannel('direct-d', S, D)), []);
});

test('§0 a __proto__ brand with no own entry gets nothing, and "constructor" as a brand gets nothing', () => {
  const S1 = { brand: '__proto__', rest: { name: 'P' }, store: null };
  const S2 = { brand: 'constructor', rest: { name: 'C' }, store: null };
  assert.deepStrictEqual(plain(POD.links.forChannel('direct-d', S1, dataset('T:no-links'))), []);
  assert.deepStrictEqual(plain(POD.links.forChannel('direct-d', S2, dataset('T'))), []);
});

// ------------------------------------------------------------------ purity (§0)

test('§0 the arguments are not changed by the call', () => {
  const S = copy({ brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } });
  const D = dataset('T');
  const before = JSON.stringify([S, D]);
  for (const ch of CHANNELS) POD.links.forChannel(ch, S, D);
  assert.equal(JSON.stringify([S, D]), before);
});

test('§0 deep-frozen S and D: no throw, and the same result as unfrozen', () => {
  const mk = () => ({ brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } });
  for (const ch of CHANNELS) {
    const plain = POD.links.forChannel(ch, mk(), dataset('T'));
    const frozen = POD.links.forChannel(ch, deepFreeze(mk()), deepFreeze(dataset('T')));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(frozen)), JSON.parse(JSON.stringify(plain)), ch);
  }
});

test('§0 the result is new each call: changing one result does not change the next', () => {
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } };
  const D = dataset('T');
  const first = POD.links.forChannel('direct-p', S, D);
  const snapshot = JSON.stringify(first);
  first[0].href = 'https://evil.example/';
  first[0].kind = 'changed';
  first.push({ kind: 'x', label: 'x', href: 'https://x.example/' });
  const second = POD.links.forChannel('direct-p', S, D);
  assert.notEqual(second, first);
  assert.notEqual(second[0], first[0]);
  assert.equal(JSON.stringify(second), snapshot);
});

test('§0 POD.data and POD.S are never read (a throwing getter is not touched)', () => {
  const sb = loadApp();
  const bad = () => { throw new Error('read during forChannel'); };
  Object.defineProperty(sb.POD, 'data', { get: bad, configurable: true });
  Object.defineProperty(sb.POD, 'S', { get: bad, configurable: true });
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } };
  const D = dataset('T');
  for (const ch of CHANNELS) {
    assert.doesNotThrow(() => sb.POD.links.forChannel(ch, S, D), ch);
  }
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sb.POD.links.forChannel('direct-p', S, D))), FIX.cases.find((c) => c.id === 'direct-p: the chain\'s site, then directions to the store').expect);
});

test('§0 no Date, document or window is read (they throw in the sandbox)', () => {
  const boom = () => { throw new Error('touched a global'); };
  const ThrowingDate = function () { boom(); };
  ThrowingDate.now = boom;
  const throwingDocument = new Proxy({}, { get: boom, has: boom, set: boom, getPrototypeOf: boom, ownKeys: boom });
  const sb = loadApp({ only: ['src/js/pod.js', 'src/js/links.js'], globals: { Date: ThrowingDate, document: throwingDocument } });
  const S = { brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } };
  const D = dataset('T');
  for (const ch of CHANNELS) {
    assert.doesNotThrow(() => sb.POD.links.forChannel(ch, S, D), ch);
  }
});

// ------------------------------------------------------------------ never throws (§0)

test('§0 junk calls return [] or a valid list and never throw', () => {
  const S = () => ({ brand: 'dominos', rest: { name: "Domino's" }, store: { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 } });
  const D = () => dataset('T');
  const fn = () => {};
  const junk = [
    ['no arguments', () => POD.links.forChannel(), []],
    ['all undefined', () => POD.links.forChannel(undefined, undefined, undefined), []],
    ['S a number', () => POD.links.forChannel('dd-p', 5, D()), []],
    ['S a string', () => POD.links.forChannel('dd-p', 'Domino\'s', D()), []],
    ['S a function', () => POD.links.forChannel('dd-p', fn, D()), []],
    ['S an array', () => POD.links.forChannel('dd-p', [S()], D()), []],
    ['S a symbol', () => POD.links.forChannel('dd-p', Symbol('s'), D()), []],
    ['D a number', () => POD.links.forChannel('dd-p', S(), 5), []],
    ['D a string', () => POD.links.forChannel('dd-p', S(), 'LINKS'), []],
    ['D a function', () => POD.links.forChannel('dd-p', S(), fn), []],
    ['D an array', () => POD.links.forChannel('dd-p', S(), []), []],
    ['D.LINKS a string', () => POD.links.forChannel('dd-p', S(), { LINKS: 'x' }), []],
    ['D.LINKS an array', () => POD.links.forChannel('dd-p', S(), { LINKS: [] }), []],
    ['D.LINKS null', () => POD.links.forChannel('dd-p', S(), { LINKS: null }), []],
    ['S.rest a string', () => POD.links.forChannel('dd-p', { brand: 'dominos', rest: "Domino's", store: null }, D()), []],
    ['S.rest null', () => POD.links.forChannel('dd-p', { brand: 'dominos', rest: null }, D()), []],
    ['S.brand a number', () => POD.links.forChannel('dd-p', { brand: 7, rest: { name: 'x' } }, D()), []],
    ['channel a number', () => POD.links.forChannel(5, S(), D()), []],
    ['channel a symbol', () => POD.links.forChannel(Symbol('dd-p'), S(), D()), []],
    ['channel null', () => POD.links.forChannel(null, S(), D()), []],
    ['S.store an array (map search only, no directions)', () => POD.links.forChannel('direct-p', { brand: 'dominos', rest: { name: "Domino's" }, store: [] }, D()),
      [
        { kind: 'order', label: "Order from Domino's", href: 'https://www.dominos.com/' },
        { kind: 'map', label: "Find Domino's in Google Maps", href: "https://www.google.com/maps/search/?api=1&query=Domino's" },
      ]],
  ];
  for (const [what, call, want] of junk) {
    let out;
    assert.doesNotThrow(() => { out = call(); }, what);
    assertValidList(out, what);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), want, what);
  }
});

// ------------------------------------------------------------------ privacy (§0)

test('§0 the user\'s own data never reaches a link, on every channel, with or without a store', () => {
  const sbase = { brand: 'dominos', rest: { name: "Domino's" } };
  const priv = Object.assign({}, sbase, {
    address: '123 Secret St, Springfield 99999',
    zip: '99999',
    pos: { lat: 12.34567, lon: 76.54321 },
    cart: { 0: 3 },
    manualSubtotal: 77.77,
  });
  const storeOf = { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 };
  for (const store of [null, storeOf]) {
    const clean = Object.assign({}, sbase, { store: store === null ? null : copy(storeOf) });
    const dirty = Object.assign(copy(priv), { store: store === null ? null : copy(storeOf) });
    for (const ch of CHANNELS) {
      const out = POD.links.forChannel(ch, dirty, dataset('T'));
      const text = JSON.stringify(out);
      for (const bad of FORBIDDEN_PRIVACY) {
        assert.equal(text.indexOf(bad), -1, ch + ' leaked ' + bad + ': ' + text);
      }
      // The user's fields change nothing: the same row as without them.
      assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(POD.links.forChannel(ch, clean, dataset('T')))), ch);
    }
  }
});

// ------------------------------------------------------------------ encoding traps (§0, §2.3)

test('§0 a lone surrogate name: DoorDash falls back to its home page, and there is no map search', () => {
  const S = { brand: 'x', rest: { name: 'Bad\uD800Name' }, store: null };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('dd-p', S, dataset('T')))),
    [{ kind: 'app', label: 'Open DoorDash', href: 'https://www.doordash.com/' }]);
  const out = POD.links.forChannel('direct-p', { brand: 'x', rest: { name: 'Bad\uD800Name' }, store: null }, dataset('T'));
  assert.deepStrictEqual(plain(out), []);
  const withStore = POD.links.forChannel('direct-p', { brand: 'dominos', rest: { name: 'Bad\uD800Name' }, store: { id: 'dominos@1,2', lat: 1, lon: 2 } }, dataset('T'));
  assert.equal(withStore.length, 2);
  assert.equal(withStore[0].kind, 'order');
  assert.equal(withStore[1].kind, 'dir');
  assert.ok(!JSON.stringify(withStore).includes('query='), 'a map search was built from a lone surrogate');
});

test('§0 (0.015625, -0.015625) rounds at five decimals as 0.01563%2C-0.01563 (an exact tie, both signs)', () => {
  const S = { brand: 'x', rest: { name: 'X' }, store: { id: 'x@1', lat: 0.015625, lon: -0.015625 } };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(POD.links.forChannel('direct-p', S, dataset('T')))),
    [{ kind: 'dir', label: 'Directions in Google Maps', href: 'https://www.google.com/maps/dir/?api=1&destination=0.01563%2C-0.01563' }]);
});
