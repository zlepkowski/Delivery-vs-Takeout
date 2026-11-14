// engine.test.js: POD.engine (docs/engine-contract.md, D-029) against the hand-worked
// receipts in tests/fixtures/receipts/. Expected values come from the receipts' `expect`
// blocks, the contract and the data files. Never from running the engine.
//
//   node --test tests/unit/engine.test.js

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, APP_ROOT } = require('../helpers/load');
const { loadData } = require('../helpers/data');

const RECEIPT_DIR = path.join(APP_ROOT, 'tests', 'fixtures', 'receipts');
const REPLACE_WHOLE = new Set(['cart', 'creditOptIn', 'markup']);

const clone = (x) => JSON.parse(JSON.stringify(x));
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** README merge rule: objects merge key by key, except cart/creditOptIn/markup (replace whole). */
function merge(base, patch) {
  const out = clone(base);
  if (!patch) { return out; }
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (!REPLACE_WHOLE.has(key) && isPlainObj(pv) && isPlainObj(out[key])) {
      out[key] = merge(out[key], pv);
    } else {
      out[key] = clone(pv);
    }
  }
  return out;
}

/** Compare with a label, keeping the default diff. */
function same(actual, expected, label) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (e) {
    e.message = `${label}: ${e.message}`;
    throw e;
  }
}

const BASE = JSON.parse(fs.readFileSync(path.join(RECEIPT_DIR, '_base.json'), 'utf8')).S;
const RECEIPTS = fs.readdirSync(RECEIPT_DIR)
  .filter((f) => /^r\d\d-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(RECEIPT_DIR, f), 'utf8')));

function receipt(prefix) {
  const r = RECEIPTS.find((x) => x.id.startsWith(prefix + '-'));
  if (!r) { throw new Error('no receipt ' + prefix); }
  return r;
}

/** The receipt's state: merge(base.S, receipt.patch). */
function receiptState(prefix) {
  return merge(BASE, receipt(prefix).patch);
}

/** A case's state: merge(receipt state, case.patch). */
function caseAt(prefix, index) {
  const r = receipt(prefix);
  const kase = r.cases[index];
  if (!kase) { throw new Error(`${prefix} has no case #${index}`); }
  return { kase, S: merge(merge(BASE, r.patch), kase.patch) };
}

const { POD } = loadApp({ only: ['pod.js', 'engine.js'] });
const engine = POD.engine;

// ---------------------------------------------------------------------------
// 1. Receipts: one test per case
// ---------------------------------------------------------------------------

function checkCalc(S, kase) {
  const exp = kase.expect;
  const r = engine.calc(S, kase.channel, kase.override);
  if (Object.prototype.hasOwnProperty.call(exp, 'result')) {
    // A {"result": null} case must carry nothing else; a mixed case fails loudly.
    same(Object.keys(exp), ['result'], 'expect keys with result');
    assert.strictEqual(r, null, `${kase.channel} should be unavailable`);
    return;
  }
  assert.notStrictEqual(r, null, `${kase.channel} should be available`);
  // structuredClone moves the VM-realm result into this realm (ISS-008) and keeps -0 distinct from 0.
  const got = structuredClone(r);
  for (const key of Object.keys(exp)) {
    if (key === 'parts') {
      // parts is a subset check: each named sub-field must match
      for (const pk of Object.keys(exp.parts)) {
        same(got.parts[pk], exp.parts[pk], `parts.${pk}`);
      }
    } else {
      same(got[key], exp[key], key);
    }
  }
}

function checkAll(S, kase) {
  const exp = kase.expect;
  const all = structuredClone(engine.allResults(S, kase.override));
  same(all.map((r) => r.id), exp.order, 'order');
  for (const id of Object.keys(exp.net || {})) {
    const r = all.find((x) => x.id === id);
    assert.ok(r, `${id} missing from allResults`);
    same(r.net, exp.net[id], `net ${id}`);
  }
}

function checkCart(S, kase) {
  const ci = structuredClone(engine.cartInfo(S, kase.override));
  for (const key of Object.keys(kase.expect)) {
    same(ci[key], kase.expect[key], key);
  }
}

for (const r of RECEIPTS) {
  const ref = r.refs[0];
  const base = merge(BASE, r.patch);
  r.cases.forEach((kase, i) => {
    const label = kase.call === 'calc' ? `calc ${kase.channel}` : kase.call;
    test(`${ref} ${r.id} #${i} ${label}`, () => {
      const S = merge(base, kase.patch);
      if (kase.call === 'calc') { checkCalc(S, kase); }
      else if (kase.call === 'allResults') { checkAll(S, kase); }
      else if (kase.call === 'cartInfo') { checkCart(S, kase); }
      else { throw new Error('unknown call ' + kase.call); }
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Section 9 traps, by name
// ---------------------------------------------------------------------------

test('§9.1 a restricted credit without opt-in does not apply', () => {
  const { kase, S } = caseAt('r05', 0);
  assert.equal(kase.channel, 'direct-p');
  const r = engine.calc(S, 'direct-p');
  assert.equal(r.net, 30.70);
  assert.equal(r.credit, 0);
  assert.ok(!r.lines.some((l) => l[0] === 'Card credits'), 'no Card credits row');
});

test('§9.2 a promo minimum is tested on marked-up food', () => {
  // Menu subtotal 26.98 is under the $31 minimum, but marked-up food 31.11 clears it.
  const withPromo = caseAt('r02', 0);
  assert.equal(withPromo.kase.channel, 'dd-d');
  const r = engine.calc(withPromo.S, 'dd-d');
  assert.equal(r.parts.food, 31.11);
  assert.equal(r.disc, 6.22);
  assert.deepEqual(structuredClone(r.lines).find((l) => l[0] === 'Promo'), ['Promo', -6.22]);

  // Minimum raised to 31.12: food 31.11 is under it, so no promo.
  const noPromo = caseAt('r02', 3);
  assert.equal(noPromo.kase.channel, 'dd-d');
  assert.deepEqual(noPromo.kase.patch, { promos: { dd: { min: 31.12 } } });
  const r2 = engine.calc(noPromo.S, 'dd-d');
  assert.equal(r2.disc, 0);
  assert.equal(r2.net, 46.10);
  assert.ok(!r2.lines.some((l) => l[0] === 'Promo'), 'no Promo row');
});

test('§9.3 an unavailable channel is null, never $0', () => {
  const S = receiptState('r01');
  assert.equal(engine.calc(S, 'direct-d'), null);
  assert.equal(engine.calc(S, 'gh-d'), null);
  const ids = structuredClone(engine.allResults(S)).map((r) => r.id);
  assert.ok(!ids.includes('direct-d'), 'allResults has no direct-d');
  assert.ok(!ids.includes('gh-d'), 'allResults has no gh-d');
  assert.ok(!ids.includes('gh-p'), 'allResults has no gh-p (Domino\'s is not on Grubhub)');
});

test('§9.4 the tip uses the pre-discount food', () => {
  const { kase, S } = caseAt('r02', 0);
  assert.equal(kase.channel, 'dd-d');
  const r = engine.calc(S, 'dd-d');
  // 31.11 × 15% = 4.6665 → 4.67 (on the discounted 24.89 it would be 3.73)
  assert.equal(r.parts.tip, 4.67);
});

// ---------------------------------------------------------------------------
// 3. Purity
// ---------------------------------------------------------------------------

test('purity: calc, allResults and cartInfo leave S and override unchanged', () => {
  const sb = loadApp({ only: ['pod.js', 'engine.js'] });
  const e = sb.POD.engine;
  const S = receiptState('r02');
  const override = { cart: { '0': 1, '3': 2 }, manualSubtotal: 12, miles: 9, minutes: 20 };
  const sCopy = clone(S);
  const oCopy = clone(override);

  for (const ch of e.CHANNELS) { e.calc(S, ch, override); }
  e.allResults(S, override);
  e.cartInfo(S, override);

  assert.deepStrictEqual(S, sCopy);
  assert.deepStrictEqual(override, oCopy);
});

test('purity: calc does not read POD.S or POD.data', () => {
  const sb = loadApp({ only: ['pod.js', 'engine.js'] });
  const e = sb.POD.engine;
  const S = receiptState('r01');
  assert.equal(receipt('r01').cases[1].channel, 'direct-p');

  sb.POD.S = undefined;
  sb.POD.data = undefined;
  let r = e.calc(S, 'direct-p');
  assert.equal(r.net, 30.70);

  // A bogus POD.S must not leak into the result either.
  sb.POD.S = { rest: null, plats: null, cart: { '0': 9 }, tax: 0, miles: 999 };
  r = e.calc(S, 'direct-p');
  assert.equal(r.net, 30.70);
  assert.equal(e.calc(S, 'dd-d').net, 46.10);
});

// ---------------------------------------------------------------------------
// 4. Channels
// ---------------------------------------------------------------------------

test('CHANNELS is the contract\'s eight ids in order', () => {
  same(structuredClone(engine.CHANNELS), [
    'direct-d', 'direct-p', 'dd-d', 'dd-p', 'ue-d', 'ue-p', 'gh-d', 'gh-p'
  ], 'CHANNELS');
});

test('calc with an unknown channel id returns null', () => {
  const S = receiptState('r01');
  for (const ch of ['direct-x', 'dd', 'direct', 'uber-d', 'dd-d-x', '']) {
    assert.equal(engine.calc(S, ch), null, `calc(${JSON.stringify(ch)})`);
  }
});

// ---------------------------------------------------------------------------
// 5. perMile (contract 5.7, unrounded)
// ---------------------------------------------------------------------------

test('perMile: base car is gas ÷ mpg + wear (4.116 ÷ 30 + 0.1 = 0.2372)', () => {
  const S = Object.assign(clone(BASE), { fuel: 'regular', gas: 4.116, mpg: 30, wear: 0.1 });
  assert.ok(Math.abs(engine.perMile(S) - 0.2372) < 1e-12);
});

test('perMile: EV is kwh ÷ miPerKwh + wear (0.2 ÷ 3.5 + 0.1)', () => {
  const S = Object.assign(clone(BASE), { fuel: 'ev', kwh: 0.2, miPerKwh: 3.5, wear: 0.1 });
  assert.ok(Math.abs(engine.perMile(S) - (0.2 / 3.5 + 0.1)) < 1e-12);
});

test('perMile: mpg 0 gives wear only', () => {
  const S = Object.assign(clone(BASE), { fuel: 'regular', gas: 4.116, mpg: 0, wear: 0.1 });
  assert.ok(Math.abs(engine.perMile(S) - 0.1) < 1e-12);
});

test('perMile: EV with miPerKwh 0 gives wear only', () => {
  const S = Object.assign(clone(BASE), { fuel: 'ev', kwh: 0.2, miPerKwh: 0, wear: 0.1 });
  assert.ok(Math.abs(engine.perMile(S) - 0.1) < 1e-12);
});

// ---------------------------------------------------------------------------
// 6. restFor (contract 2.1, D-006, D-028)
// ---------------------------------------------------------------------------

const D = loadData(['src/data/brands.js', 'src/data/profiles.js', 'src/data/categories.js']);

test('restFor: dominos is profiled, with no direct delivery and no directFee key', () => {
  const r = engine.restFor('dominos', D);
  assert.equal(r.profiled, true);
  assert.equal(r.name, 'Domino\'s');
  same(structuredClone(r.platforms), ['dd', 'ue'], 'platforms');
  assert.equal(r.directDelivery, false);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'directFee'), false, 'no directFee key');
});

test('restFor: dominos menu equals the profile menu, as a copy', () => {
  const r = engine.restFor('dominos', D);
  same(structuredClone(r.menu), D.PROFILES.dominos.menu, 'menu');
  assert.notStrictEqual(r.menu, D.PROFILES.dominos.menu);
  assert.notStrictEqual(r.menu[0], D.PROFILES.dominos.menu[0]);
});

test('restFor: mutating the returned menu does not change the data tables', () => {
  // Menu items are objects (D-036): {name, price, dealItem, markup?}. The writes must land on the copy,
  // so each one is checked on r first; otherwise a no-op write would pass vacuously.
  const before = structuredClone(D.PROFILES.dominos.menu);
  const r = engine.restFor('dominos', D);
  r.menu[0].price = 999;
  r.menu.push({ name: 'Injected', price: 1, dealItem: false });
  r.menu[1].dealItem = !before[1].dealItem;
  assert.equal(r.menu[0].price, 999, 'the copy took the price write');
  assert.equal(r.menu.length, before.length + 1, 'the copy took the push');
  assert.equal(r.menu[1].dealItem, !before[1].dealItem, 'the copy took the dealItem write');
  same(D.PROFILES.dominos.menu, before, 'PROFILES.dominos.menu');
  const again = engine.restFor('dominos', D);
  assert.equal(again.menu.length, before.length);
  assert.equal(again.menu[0].price, before[0].price);
  assert.equal(again.menu[1].dealItem, before[1].dealItem);
});

test('D-036 restFor copies an item\'s markup object: the copy shares nothing with D', () => {
  const H = {
    BRANDS: { m: { name: 'M', category: 'pizza' } },
    CATEGORY_DEFAULTS: { pizza: { markup: { dd: 1, ue: 2, gh: 3 }, est: true } },
    PROFILES: {
      m: {
        menu: [{ name: 'A', price: 5, dealItem: false, markup: { dd: 30 } }],
        deal: null, directDelivery: false, directSvc: null, amexGoldDirect: false,
        platforms: ['dd'], markup: { dd: 15 }, markupEst: false
      }
    }
  };
  const before = structuredClone(H);
  const r = engine.restFor('m', H);
  same(structuredClone(r.menu[0].markup), { dd: 30 }, 'the copied item markup');
  assert.notStrictEqual(r.menu[0].markup, H.PROFILES.m.menu[0].markup, 'a new object, not D\'s');
  r.menu[0].markup.dd = 99;
  assert.equal(r.menu[0].markup.dd, 99, 'the copy took the write');
  same(H, before, 'H (the data tables) after the write');
});

test('restFor: wingstop has direct delivery at a 2.99 fee', () => {
  const r = engine.restFor('wingstop', D);
  assert.equal(r.profiled, true);
  assert.equal(r.directDelivery, true);
  assert.equal(r.directFee, 2.99);
});

test('restFor: taco_bell is unprofiled with the mexican category markup (D-028)', () => {
  const r = engine.restFor('taco_bell', D);
  assert.equal(r.profiled, false);
  assert.equal(r.name, 'Taco Bell');
  same(structuredClone(r.menu), [], 'menu');
  assert.equal(r.deal, null);
  assert.equal(r.directDelivery, false);
  same(structuredClone(r.platforms), ['dd', 'ue', 'gh'], 'platforms');
  assert.equal(r.markupEst, true);
  const cats = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tools', 'data', 'categories.json'), 'utf8'));
  same(structuredClone(r.markup), cats.mexican.markup, 'markup vs tools/data/categories.json mexican');
});

test('restFor: an unknown brand gives null', () => {
  assert.equal(engine.restFor('no_such_brand', D), null);
});

test('D-029 §2.1 restFor returns null when an unprofiled brand\'s category has no default (never 0% markup)', () => {
  // Clone the real tables, then drop the mexican default. taco_bell is unprofiled, category mexican.
  const noDefault = structuredClone(D);
  delete noDefault.CATEGORY_DEFAULTS['mexican'];
  assert.equal(engine.restFor('taco_bell', noDefault), null);
});

test('D-029 §2.1 restFor name falls back to the brand id for a profiled brand missing from BRANDS', () => {
  // dominos is profiled; without its BRANDS entry the name is the id itself (contract 2.1).
  const noBrand = structuredClone(D);
  delete noBrand.BRANDS['dominos'];
  assert.equal(engine.restFor('dominos', noBrand).name, 'dominos');
});

// Guard (orchestrator): the receipt tests above are generated from files, so a broken glob
// would make them vanish while the suite still passes. Pin the floor.
test('D-029 §2.1 restFor shares no array or object with D (platforms, markup, deal, directSvc, menu rows)', () => {
  const H = {
    BRANDS: { f: { name: 'F', category: 'pizza' }, g: { name: 'G', category: 'pizza' } },
    CATEGORY_DEFAULTS: { pizza: { markup: { dd: 1, ue: 2, gh: 3 }, est: true } },
    PROFILES: {
      f: {
        menu: [{ name: 'A', price: 5, dealItem: true }],
        deal: { label: 'L', price: 4, minItems: 1, scope: 'both' },
        directDelivery: true,
        directFee: 2,
        directSvc: { flat: 1, modes: ['d'] },
        amexGoldDirect: false,
        platforms: ['dd'],
        markup: { dd: 10 },
        markupEst: false
      }
    }
  };
  const before = structuredClone(H);
  const r = engine.restFor('f', H);
  r.platforms.push('ue');
  r.markup.dd = 99;
  r.deal.price = 0;
  r.directSvc.modes.push('p');
  r.menu[0].price = 0;
  assert.equal(r.menu[0].price, 0, 'the copy took the price write');
  assert.deepStrictEqual(H, before);
});

test('D-029 §2.1 restFor copies an unprofiled brand\'s category markup (CATEGORY_DEFAULTS unchanged)', () => {
  const H = {
    BRANDS: { g: { name: 'G', category: 'pizza' } },
    CATEGORY_DEFAULTS: { pizza: { markup: { dd: 1, ue: 2, gh: 3 }, est: true } },
    PROFILES: {}
  };
  const before = structuredClone(H.CATEGORY_DEFAULTS);
  const r = engine.restFor('g', H);
  r.markup.dd = 99;
  assert.deepStrictEqual(H.CATEGORY_DEFAULTS, before);
});

test('D-029 the hand-worked receipts are all loaded (at least 15 receipts, 91 cases)', () => {
  const cases = RECEIPTS.reduce((n, r) => n + r.cases.length, 0);
  assert.ok(RECEIPTS.length >= 15, `only ${RECEIPTS.length} receipts loaded`);
  assert.ok(cases >= 91, `only ${cases} receipt cases loaded`);
});

// ---------------------------------------------------------------------------
// 7. Per-item markup and BOGO (D-036; engine contract §2.1, §5.2, §5.4, §6)
//    Base: _base.json (Domino's, New York). Pizza = item 0 at 21.99, wings = 2 at 11.99,
//    Coke = 6 at 4.99. App markup 15.3% on dd and ue (gh isn't on Domino's platforms).
//    Every expected value below is worked by hand in its comment. Nothing is read from the engine.
//    S is built with clone() (JSON), then NaN and Infinity are assigned directly, since JSON can't carry them.
// ---------------------------------------------------------------------------

const PIZZA = 'Large (14") ExtravaganZZa';
const COKE = 'Coke® (2 L)';

/** A fresh base state: cart {0: 1, 6: 1}, menu subtotal 26.98. */
const baseS = () => clone(BASE);

test('D-036 §5.2 a per-item markup changes only its own line, and only on its own app', () => {
  // Pizza at 40% on dd: 21.99 × 1 × 1.40 = 30.786; Coke at the app's 15.3%: 4.99 × 1.153 = 5.75347.
  // dd food = 30.786 + 5.75347 = 36.53947 → 36.54. dd-p tax = 36.54 × 8.54% = 3.120516 → 3.12.
  // drive (as r01) 1.42. dd-p gross = 36.54 + 3.12 + 1.42 = 41.08 = net.
  const S = baseS();
  S.rest.menu[0].markup = { dd: 40 };
  const dd = engine.calc(S, 'dd-p');
  assert.equal(dd.parts.food, 36.54, 'dd food with the pizza at 40%');
  assert.deepStrictEqual(structuredClone(dd.lines)[0], ['Food', 36.54]);
  assert.equal(dd.net, 41.08);
  // Uber Eats has no override for the pizza: 26.98 × 1.153 = 31.10794 → 31.11, as in r01.
  assert.equal(engine.calc(S, 'ue-p').parts.food, 31.11, 'ue food is unchanged');
  // Its own line only: Coke at 40% on Uber Eats, pizza at the app's 15.3% (21.99 × 1.153 = 25.35447).
  // ue food = 25.35447 + 4.99 × 1.40 = 25.35447 + 6.986 = 32.34047 → 32.34. dd food is unchanged at 31.11.
  const S2 = baseS();
  S2.rest.menu[6].markup = { ue: 40 };
  assert.equal(engine.calc(S2, 'ue-p').parts.food, 32.34, 'ue food with Coke at 40%');
  assert.equal(engine.calc(S2, 'dd-p').parts.food, 31.11, 'dd food is unchanged by a ue override');
});

test('D-036 §5.2 an item markup of 0 is used as 0%, not as the app markup', () => {
  // Pizza at 0% on dd: 21.99 × 1.00 = 21.99; + Coke 5.75347 = 27.74347 → 27.74.
  // tax = 27.74 × 8.54% = 2.368996 → 2.37; gross = 27.74 + 2.37 + 1.42 = 31.53.
  const S = baseS();
  S.rest.menu[0].markup = { dd: 0 };
  const r = engine.calc(S, 'dd-p');
  assert.equal(r.parts.food, 27.74);
  assert.equal(r.net, 31.53);
});

test('D-036 §2.1 each malformed item markup falls back to the app markup (15.3%), never to 0%', () => {
  // Pizza falls back to 15.3%: food 31.11 (r01), dd-p tax 31.11 × 8.54% = 2.656794 → 2.66,
  // gross = 31.11 + 2.66 + 1.42 = 35.19.
  const bad = [
    ['-1', -1], ['"20"', '20'], ['true', true], ['null', null],
    ['NaN', NaN], ['Infinity', Infinity], ['[10]', [10]], ['{}', {}]
  ];
  for (const [label, v] of bad) {
    const S = baseS();
    S.rest.menu[0].markup = { dd: v };
    const r = engine.calc(S, 'dd-p');
    assert.equal(r.parts.food, 31.11, 'markup.dd = ' + label + ': food');
    assert.equal(r.net, 35.19, 'markup.dd = ' + label + ': net');
  }
  // A markup that is not an object at all falls back the same way.
  const S = baseS();
  S.rest.menu[0].markup = 30;
  assert.equal(engine.calc(S, 'dd-p').parts.food, 31.11, 'markup = 30 (not an object): food');
});

test('D-036 §5.2 the food is rounded once, not per item (31.11, where per-item rounding gives 31.10)', () => {
  // 21.99 × 1.153 = 25.35447 → 25.35 and 4.99 × 1.153 = 5.75347 → 5.75: the lines sum to 31.10.
  // Summed first: 31.10794 → 31.11. The contract says 31.11 (§5.2).
  const r = engine.calc(baseS(), 'dd-p');
  assert.equal(r.parts.food, 31.11);
});

test('D-036 §5.4 BOGO free count is floor(q/2) for q = 0 to 5 (pizza at 15.3% on Uber Eats, no cap)', () => {
  // free = floor(q/2). promo = round2(21.99 × free × 1.153):
  //   q=0: 0; q=1: 0; q=2: 25.35447 → 25.35; q=3: 25.35; q=4: 50.70894 → 50.71; q=5: 50.71.
  const want = [0, 0, 25.35, 25.35, 50.71, 50.71];
  for (let q = 0; q <= 5; q++) {
    const S = baseS();
    S.cart = { '0': q };
    S.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 0, item: 0 };
    const r = engine.calc(S, 'ue-p');
    assert.equal(r.disc, want[q], 'q = ' + q + ': disc');
    assert.deepStrictEqual(structuredClone(r.notes), want[q] > 0 ? ['BOGO: ' + PIZZA] : [], 'q = ' + q + ': notes');
  }
});

test('D-036 §5.4 an invalid BOGO item gives no promo, no note and no throw', () => {
  // Cart {0: 2, 6: 1}: food = 50.70894 + 5.75347 = 56.46241 → 56.46. No promo.
  // tax = 56.46 × 8.54% = 4.821684 → 4.82. ue-p gross = 56.46 + 4.82 + 1.42 = 62.70 = net.
  const cases = [
    ['null', (P) => { P.item = null; }],
    ['missing key', (P) => { delete P.item; }],
    ['"0" (a string)', (P) => { P.item = '0'; }],
    ['true', (P) => { P.item = true; }],
    ['1.5', (P) => { P.item = 1.5; }],
    ['-1', (P) => { P.item = -1; }],
    ['8 (menu.length)', (P) => { P.item = 8; }],
    ['NaN', (P) => { P.item = NaN; }],
    ['Infinity', (P) => { P.item = Infinity; }],
    ['2 (wings, not in the cart)', (P) => { P.item = 2; }]
  ];
  for (const [label, set] of cases) {
    const S = baseS();
    S.cart = { '0': 2, '6': 1 };
    S.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 0 };
    set(S.promos.ue);
    let r = null;
    assert.doesNotThrow(() => { r = engine.calc(S, 'ue-p'); }, 'item ' + label + ': no throw');
    assert.equal(r.disc, 0, 'item ' + label + ': disc');
    assert.equal(r.net, 62.70, 'item ' + label + ': net');
    assert.deepStrictEqual(structuredClone(r.notes), [], 'item ' + label + ': no BOGO note');
    assert.ok(!structuredClone(r.lines).some((l) => l[0] === 'Promo'), 'item ' + label + ': no Promo row');
  }
});

test('D-036 §5.4 a BOGO cap limits the promo; a cap that does not bind leaves it alone', () => {
  // Cart {0: 2}: food 50.70894 → 50.71; free 1, promo 25.35447.
  // cap 20: promo = 20. tax = (50.71 − 20) × 8.54% = 30.71 × 0.0854 = 2.622634 → 2.62.
  //   gross = 50.71 + 2.62 + 1.42 = 54.75; net = 54.75 − 20 = 34.75.
  // cap 30 does not bind: promo 25.35 (as r15).
  const capped = baseS();
  capped.cart = { '0': 2 };
  capped.promos.ue = { type: 'bogo', value: 0, cap: 20, min: 0, item: 0 };
  const a = engine.calc(capped, 'ue-p');
  assert.equal(a.disc, 20);
  assert.equal(a.parts.food, 50.71);
  assert.equal(a.net, 34.75);

  const loose = baseS();
  loose.cart = { '0': 2 };
  loose.promos.ue = { type: 'bogo', value: 0, cap: 30, min: 0, item: 0 };
  assert.equal(engine.calc(loose, 'ue-p').disc, 25.35);
});

test('D-036 §5.4 the BOGO minimum is tested on the marked-up food: at equality it applies, a cent above it does not', () => {
  // Cart {0: 2, 6: 1} on Uber Eats delivery: food 56.46. Net with the promo (25.35) is 52.70 (r15).
  // Without it: 56.46 + 10.46 fees + 4.82 tax + 8.47 tip = 80.21.
  const at = baseS();
  at.cart = { '0': 2, '6': 1 };
  at.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 56.46, item: 0 };
  const eq = engine.calc(at, 'ue-d');
  assert.equal(eq.disc, 25.35, 'min 56.46 at equality');
  assert.equal(eq.net, 52.70);

  const above = baseS();
  above.cart = { '0': 2, '6': 1 };
  above.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 56.47, item: 0 };
  const no = engine.calc(above, 'ue-d');
  assert.equal(no.disc, 0, 'min 56.47: no promo');
  assert.equal(no.net, 80.21);
  assert.deepStrictEqual(structuredClone(no.notes), []);

  // §9.2: the menu subtotal is 21.99 × 2 + 4.99 = 48.97, under a min of 50, but the marked-up food 56.46 clears it.
  const markedUp = baseS();
  markedUp.cart = { '0': 2, '6': 1 };
  markedUp.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 50, item: 0 };
  assert.equal(engine.calc(markedUp, 'ue-d').disc, 25.35, 'min 50 on food 56.46 applies');
});

test('D-036 §6 the BOGO note is exactly "BOGO: " + the item\'s name, and it names the chosen item', () => {
  // Coke (item 6) at 4.99 with 2 in the cart on Uber Eats pickup:
  // food = 4.99 × 2 × 1.153 = 11.50694 → 11.51. promo = 4.99 × 1 × 1.153 = 5.75347 → 5.75.
  // tax = (11.51 − 5.75) × 8.54% = 5.76 × 0.0854 = 0.491904 → 0.49. gross = 11.51 + 0.49 + 1.42 = 13.42.
  // net = 13.42 − 5.75 = 7.67.
  const S = baseS();
  S.cart = { '6': 2 };
  S.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 0, item: 6 };
  const r = engine.calc(S, 'ue-p');
  assert.equal(r.disc, 5.75);
  assert.equal(r.net, 7.67);
  same(structuredClone(r.notes), ['BOGO: ' + COKE], 'notes');
});

test('D-036 §5.4 an unprofiled brand gets no BOGO, even with a menu on it: food 23.06, net 26.45', () => {
  // Estimate: manualSubtotal 20 × 1.153 = 23.06. tax = 23.06 × 8.54% = 1.969324 → 1.97.
  // gross = 23.06 + 1.97 + 1.42 = 26.45. No BOGO applies (§5.4 needs a profiled brand).
  const S = baseS();
  S.rest = {
    id: 'taco_bell', name: 'Taco Bell', profiled: false, menu: [], deal: null, directDelivery: false,
    directSvc: null, amexGoldDirect: false, platforms: ['dd', 'ue', 'gh'],
    markup: { dd: 15.3, ue: 15.3, gh: 15.3 }, markupEst: true
  };
  S.manualSubtotal = 20;
  S.cart = {};
  S.promos.ue = { type: 'bogo', value: 0, cap: 0, min: 0, item: 0 };
  let r = engine.calc(S, 'ue-p');
  assert.equal(r.parts.food, 23.06);
  assert.equal(r.disc, 0);
  assert.equal(r.net, 26.45);
  same(structuredClone(r.notes), ['Estimate'], 'notes');

  // The same brand with an artificial menu entry and a cart: still no BOGO, because the brand is unprofiled.
  S.rest.menu = [{ name: PIZZA, price: 21.99, dealItem: false }];
  S.cart = { '0': 2 };
  r = engine.calc(S, 'ue-p');
  assert.equal(r.disc, 0, 'unprofiled with a menu entry: no promo');
  same(structuredClone(r.notes), ['Estimate'], 'unprofiled with a menu entry: notes');
});

test('D-036 §4 malformed cart lines give no line and no throw', () => {
  // qty "2", null and true are not finite numbers: no line, so the cart is empty.
  // Empty cart on dd-p: food 0, tax 0, drive 1.42 → net 1.42.
  for (const q of ['2', null, true]) {
    const S = baseS();
    S.cart = { '0': q };
    let ci = null;
    assert.doesNotThrow(() => { ci = engine.cartInfo(S); }, 'qty ' + JSON.stringify(q));
    assert.equal(ci.menuSub, 0, 'qty ' + JSON.stringify(q) + ': menuSub');
    assert.equal(ci.qty, 0, 'qty ' + JSON.stringify(q) + ': qty');
    const r = engine.calc(S, 'dd-p');
    assert.equal(r.net, 1.42, 'qty ' + JSON.stringify(q) + ': net');
  }
  // A cart line whose menu entry is null gives no line; the other line still counts.
  // Coke only: menuSub 4.99, qty 1. dd-p food = 4.99 × 1.153 = 5.75347 → 5.75; tax 5.75 × 8.54% = 0.49105 → 0.49;
  // net = 5.75 + 0.49 + 1.42 = 7.66.
  const N = baseS();
  N.rest.menu[0] = null;
  N.cart = { '0': 1, '6': 1 };
  const ci = engine.cartInfo(N);
  assert.equal(ci.menuSub, 4.99);
  assert.equal(ci.qty, 1);
  let r = null;
  assert.doesNotThrow(() => { r = engine.calc(N, 'dd-p'); });
  assert.equal(r.parts.food, 5.75);
  assert.equal(r.net, 7.66);
});

test('D-036 purity: calc and allResults with a BOGO and item markups leave S, its menu items and the override unchanged', () => {
  const S = baseS();
  S.rest.menu[0].markup = { ue: 10 };
  S.rest.menu[6].markup = { dd: 40 };
  S.promos.ue = { type: 'bogo', value: 0, cap: 30, min: 0, item: 0 };
  const override = { cart: { '0': 2, '6': 1 }, miles: 9 };
  const sBefore = clone(S);
  const oBefore = clone(override);

  // The BOGO really fires here, so the check isn't vacuous: pizza at 10% on ue,
  // food 54.13 (21.99 × 2 × 1.10 = 48.378, + 5.75347), promo 24.19 (21.99 × 1 × 1.10 = 24.189, under the cap of 30).
  const r = engine.calc(S, 'ue-d', override);
  assert.equal(r.parts.food, 54.13);
  assert.equal(r.disc, 24.19);

  for (const ch of engine.CHANNELS) { engine.calc(S, ch, override); }
  engine.allResults(S, override);
  assert.deepStrictEqual(S, sBefore, 'S');
  assert.deepStrictEqual(S.rest.menu[0].markup, { ue: 10 }, 'the pizza markup');
  assert.deepStrictEqual(override, oBefore, 'override');
});
