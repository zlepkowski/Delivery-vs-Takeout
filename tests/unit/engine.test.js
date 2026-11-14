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
  const before = structuredClone(D.PROFILES.dominos.menu);
  const r = engine.restFor('dominos', D);
  r.menu[0][1] = 999;
  r.menu.push(['Injected', 1, false]);
  r.menu[1][2] = true;
  same(D.PROFILES.dominos.menu, before, 'PROFILES.dominos.menu');
  const again = engine.restFor('dominos', D);
  assert.equal(again.menu.length, before.length);
  assert.equal(again.menu[0][1], before[0][1]);
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
        menu: [['A', 5, true]],
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
  r.menu[0][1] = 0;
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

test('D-029 the hand-worked receipts are all loaded (at least 13 receipts, 65 cases)', () => {
  const cases = RECEIPTS.reduce((n, r) => n + r.cases.length, 0);
  assert.ok(RECEIPTS.length >= 13, `only ${RECEIPTS.length} receipts loaded`);
  assert.ok(cases >= 65, `only ${cases} receipt cases loaded`);
});
