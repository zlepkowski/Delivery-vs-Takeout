// D-027 tools/build-profiles.py: the median, rounding and rejection rules, run on small fixtures.
// Each fixture differs from tests/fixtures/build-profiles/valid/chipotle.json in one field only.
// Expected prices are the D-027 rule applied by hand (the fixture prices are invented).
// The generator is run with the real tools/data/categories.json and src/data/brands.js defaults.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const FIXTURES = path.join(APP_ROOT, 'tests', 'fixtures', 'build-profiles');
const AS_OF = '2026-11-12';

/**
 * Runs the generator on one fixture case. Returns { ok, stderr, PROFILES } where PROFILES is
 * read from the written src/data/profiles.js when the run succeeds.
 */
function build(caseName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-profiles-'));
  try {
    const outProfiles = path.join(tmp, 'p.js');
    const outCategories = path.join(tmp, 'c.js');
    const args = [
      '-I', 'tools/build-profiles.py',
      '--as-of', AS_OF,
      '--profiles-dir', path.join(FIXTURES, caseName),
      '--out-profiles', outProfiles,
      '--out-categories', outCategories,
    ];
    try {
      execFileSync('python3', args, { cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return { ok: false, status: err.status, stderr: String(err.stderr || '') };
    }
    const sb = { POD: { data: {} } };
    vm.runInNewContext(fs.readFileSync(outProfiles, 'utf8'), sb);
    // structuredClone moves the VM-realm objects into this realm, so deepStrictEqual works.
    return { ok: true, status: 0, stderr: '', PROFILES: structuredClone(sb.POD.data.PROFILES) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Menu price of the named item in a built profile. */
function priceOf(profiles, name) {
  const item = profiles.chipotle.menu.find((m) => m[0] === name);
  assert.ok(item, `no menu item "${name}"`);
  return item[1];
}

test('D-027 build-profiles: the valid fixture builds, with the hand-computed medians', () => {
  const r = build('valid');
  assert.equal(r.status, 0, r.stderr);
  const p = r.PROFILES.chipotle;
  // Item A 4.00/5.00/6.00 (odd) -> 5.00; B 7.10/8.20 (even, 15.30/2) -> 7.65;
  // C 12.00/13.00 -> 12.50; D 2.50/3.00/2.50 (odd) -> 2.50; E 1.10/1.20 -> 1.15.
  assert.deepEqual(p.menu, [
    ['Item A', 5.00, false],
    ['Item B', 7.65, false],
    ['Item C', 12.50, false],
    ['Item D', 2.50, false],
    ['Item E', 1.15, false],
  ]);
  assert.equal(p.deal, null);
  assert.equal(p.directDelivery, false);
  assert.equal('directFee' in p, false);
  assert.deepEqual(p.platforms, ['dd']);
  assert.equal(p.amexGoldDirect, false);
  assert.equal(p.markupEst, true);
});

test('D-027 build-profiles: a useCategory chain takes the mexican category default for dd', () => {
  const r = build('valid');
  assert.equal(r.status, 0, r.stderr);
  // Chipotle is "mexican" in brands.js; mexican dd is read from the evidence file, not the generator.
  const cats = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tools', 'data', 'categories.json'), 'utf8'));
  const { BRANDS } = loadData(['src/data/brands.js']);
  assert.equal(BRANDS.chipotle.category, 'mexican');
  assert.equal(r.PROFILES.chipotle.markup.dd, cats.mexican.markup.dd);
});

test('D-027 build-profiles: median rounds half up, 8.99 and 9.02 give 9.01 (not 9.00)', () => {
  const r = build('half-up');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(priceOf(r.PROFILES, 'Item B'), 9.01);
});

test('D-027 build-profiles: an even count with an exact average, 8.99 and 9.99 give 9.49', () => {
  const r = build('even-exact');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(priceOf(r.PROFILES, 'Item B'), 9.49);
});

test('D-027 build-profiles: an odd count takes the middle value, 3.49/4.49/5.99 give 4.49 (not the mean)', () => {
  const r = build('odd');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(priceOf(r.PROFILES, 'Item B'), 4.49);
});

test('D-027 build-profiles: a menu item seen in only one state is rejected', () => {
  const r = build('reject-one-state');
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /observations must span >= 2 states/);
  assert.match(r.stderr, /Item B/);
});

test('§9.3 build-profiles: directDelivery true with direct fees of 0 is rejected', () => {
  const r = build('reject-zero-fee');
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /directFee/);
  assert.match(r.stderr, /bad fee/);
});

test('D-027 build-profiles: a directFee with directDelivery false is rejected', () => {
  const r = build('reject-fee-without-delivery');
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /directFee given but directDelivery is false/);
});

test('D-027 build-profiles: sourced markup keeps the fixture values and is not an estimate', () => {
  const r = build('sourced-markup');
  assert.equal(r.status, 0, r.stderr);
  // Markup numbers are the fixture's own (dd 4.5, ue 6); the generator must not swap in a category default.
  assert.deepEqual(r.PROFILES.chipotle.markup, { dd: 4.5, ue: 6 });
  assert.equal(r.PROFILES.chipotle.markupEst, false);
});

test('D-027 build-profiles: sourced markup with no source URL is rejected', () => {
  const r = build('reject-markup-no-source');
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /markup needs a source url/);
});

test('D-027 build-profiles: platform evidence with no https URL is rejected', () => {
  const r = build('reject-no-https');
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /platform dd evidence needs an https URL/);
});
