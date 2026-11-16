// check-site.test.js: the D-039 gates in tools/check-site.js, on small fake site folders.
//
// A good site is built once in a temp dir from the repo's own src/ (index.html + src/ minus
// src/data/stores, as tests/e2e/helpers.js buildSite does). Its store tiles are the real fixture
// tiles for their cells (tests/fixtures/stores/, which make the ZIP 10118 canary and the Big Timber
// search real) and a stub for every other TILE_INDEX cell. Each broken case copies the good site and
// makes one small text edit, which must visibly land before checkSite runs (a no-op edit would make
// the case vacuous).
//
// Expected values come from D-039, BUILD.md section 8, progress.md's Phase 3 notes (the fixture
// geo answers) and the fixture data, never from running checkSite and copying its output.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { before, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const childProcess = require('node:child_process');
const { APP_ROOT } = require('../helpers/load');
const { checkSite } = require(path.join(APP_ROOT, 'tools', 'check-site.js'));

const CLI = path.join(APP_ROOT, 'tools', 'check-site.js');
const FIXTURE_TILES = path.join(APP_ROOT, 'tests', 'fixtures', 'stores');
const AS_OF = '2026-11-16';
const GATES = ['brands', 'drift', 'canary', 'states', 'es5'];

// Pinned by the orchestrator's Phase 3 notes and D-039 (see the good-site test).
const CANARY_BRANDS_PINNED = 82;
const COMMITTED_TOTAL_PINNED = 182567;

/** Loads a committed data file the way the browser does (POD.data), in a fresh VM. */
function loadRepoData(file) {
  const sb = { POD: { data: {} } };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  return sb.POD.data;
}

const REPO_BRANDS = path.join(APP_ROOT, 'src', 'data', 'brands.js');
const REPO_DATA = loadRepoData(REPO_BRANDS);
const REPO_PROFILES = loadRepoData(path.join(APP_ROOT, 'src', 'data', 'profiles.js')).PROFILES;
const BRANDS_RUN = REPO_DATA.BRANDS_RUN;
const TILE_INDEX = REPO_DATA.TILE_INDEX;
const BRAND_IDS = REPO_DATA.BRAND_IDS;

function stubTile(cell) {
  return '(function (root) {\n  "use strict";\n  var POD = root.POD;\n  POD.data = POD.data || {};\n' +
    '  POD.data.TILES = POD.data.TILES || {};\n' +
    '  POD.data.TILES["' + cell + '"] = {"run": "' + BRANDS_RUN + '", "s": ""};\n' +
    '})(typeof window !== "undefined" ? window : this);\n';
}

function fixtureCells() {
  return fs.readdirSync(FIXTURE_TILES).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
}

/** The brand ids that have at least one store in a fixture tile. */
function fixtureBrandIds() {
  const used = new Set();
  for (const cell of fixtureCells()) {
    const s = fs.readFileSync(path.join(FIXTURE_TILES, cell + '.js'), 'utf8').match(/"s": "([^"]*)"/)[1];
    for (const rec of s.split(';')) used.add(BRAND_IDS[Number(rec.split(',')[0])]);
  }
  return used;
}

let BASE = null;
let GOOD = null;

before(() => {
  BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'check-site-test-'));
  GOOD = path.join(BASE, 'good');
  fs.mkdirSync(GOOD);
  fs.copyFileSync(path.join(APP_ROOT, 'index.html'), path.join(GOOD, 'index.html'));
  const stores = path.join(APP_ROOT, 'src', 'data', 'stores');
  fs.cpSync(path.join(APP_ROOT, 'src'), path.join(GOOD, 'src'), {
    recursive: true,
    filter: (p) => !p.startsWith(stores),
  });
  const outStores = path.join(GOOD, 'src', 'data', 'stores');
  fs.mkdirSync(outStores, { recursive: true });
  const fixtures = new Set(fixtureCells());
  for (const cell of fixtures) {
    assert.ok(Object.prototype.hasOwnProperty.call(TILE_INDEX, cell), 'fixture ' + cell + ' is not in TILE_INDEX');
    fs.copyFileSync(path.join(FIXTURE_TILES, cell + '.js'), path.join(outStores, cell + '.js'));
  }
  for (const cell of Object.keys(TILE_INDEX)) {
    if (!fixtures.has(cell)) fs.writeFileSync(path.join(outStores, cell + '.js'), stubTile(cell));
  }
});

after(() => {
  if (BASE) fs.rmSync(BASE, { recursive: true, force: true });
});

/** A fresh copy of the good site for one case. */
function freshSite(name) {
  const dir = path.join(BASE, name);
  fs.cpSync(GOOD, dir, { recursive: true });
  return dir;
}

/** Replaces one exact string in an out file. The string must occur exactly once. */
function editOnce(dir, rel, from, to) {
  const file = path.join(dir, rel);
  const text = fs.readFileSync(file, 'utf8');
  const hits = text.split(from).length - 1;
  assert.equal(hits, 1, 'edit target must occur once in ' + rel + ': ' + from);
  const next = text.replace(from, () => to);
  assert.notEqual(next, text, 'edit did not change ' + rel);
  fs.writeFileSync(file, next);
}

/** Removes the one line of an out file that contains the given text. */
function removeLine(dir, rel, contains) {
  const file = path.join(dir, rel);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = lines.filter((l) => l.includes(contains));
  assert.equal(hits.length, 1, 'exactly one line in ' + rel + ' must contain: ' + contains);
  const next = lines.filter((l) => !l.includes(contains));
  assert.equal(next.length, lines.length - 1, 'line removal did not land in ' + rel);
  fs.writeFileSync(file, next.join('\n'));
}

// ---- brands.js as a model: each BRANDS and TILE_INDEX line, editable and written back -----------

function parseBrands(dir) {
  const file = path.join(dir, 'src', 'data', 'brands.js');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const brands = [];
  const tiles = [];
  lines.forEach((text, i) => {
    let m = /^    "([^"]+)": \{.*"stores": (\d+)\},$/.exec(text);
    if (m) {
      brands.push({ i: i, id: m[1], stores: Number(m[2]), removed: false });
      return;
    }
    m = /^    "(-?\d+_-?\d+)": (\d+),$/.exec(text);
    if (m) tiles.push({ i: i, cell: m[1], count: Number(m[2]) });
  });
  return { file: file, lines: lines, brands: brands, tiles: tiles };
}

function brandSum(model) {
  return model.brands.filter((b) => !b.removed).reduce((n, b) => n + b.stores, 0);
}

function tileSum(model) {
  return model.tiles.reduce((n, t) => n + t.count, 0);
}

/** Moves the TILE_INDEX total by delta: onto the largest cell if up, off the largest cells if down. */
function balanceTiles(model) {
  let delta = brandSum(model) - tileSum(model);
  const order = model.tiles.slice().sort((a, b) => b.count - a.count || (a.cell < b.cell ? -1 : 1));
  if (delta > 0) {
    order[0].count += delta;
    return;
  }
  for (const t of order) {
    if (delta === 0) break;
    const take = Math.min(t.count, -delta);
    t.count -= take;
    delta += take;
  }
  assert.equal(delta, 0, 'could not balance TILE_INDEX');
}

/** Writes the model back, then re-reads the file and checks each value landed. */
function commitBrands(model) {
  const lines = model.lines.slice();
  for (const b of model.brands) {
    if (b.removed) { lines[b.i] = null; continue; }
    lines[b.i] = lines[b.i].replace(/"stores": \d+\},$/, () => '"stores": ' + b.stores + '},');
  }
  for (const t of model.tiles) lines[t.i] = '    "' + t.cell + '": ' + t.count + ',';
  fs.writeFileSync(model.file, lines.filter((x) => x !== null).join('\n'));
  // Re-read the file and check every value landed, one by one.
  const again = parseBrands(path.dirname(path.dirname(path.dirname(model.file))));
  const kept = model.brands.filter((b) => !b.removed);
  assert.equal(again.brands.length, kept.length, 'brand removal did not land');
  kept.forEach((b, k) => {
    assert.equal(again.brands[k].id, b.id, 'brand order changed');
    assert.equal(again.brands[k].stores, b.stores, 'stores did not land for ' + b.id);
  });
  assert.equal(again.tiles.length, model.tiles.length, 'TILE_INDEX line count changed');
  model.tiles.forEach((t, k) => assert.equal(again.tiles[k].count, t.count, 'TILE_INDEX count did not land for ' + t.cell));
}

/** Checks the result: not ok, the named gate failed with the fragment, and the allowed gates only. */
function assertFails(res, gate, fragment, allowedOthers) {
  const others = allowedOthers || [];
  assert.equal(res.ok, false, 'the site should fail');
  const hit = res.failures.some((f) => f.gate === gate && f.msg.includes(fragment));
  assert.ok(hit, 'no ' + gate + ' failure containing ' + JSON.stringify(fragment) + '; got ' +
    JSON.stringify(res.failures));
  for (const f of res.failures) {
    assert.ok(f.gate === gate || others.includes(f.gate), 'unexpected ' + f.gate + ' failure: ' + f.msg);
  }
  return res;
}

/** Checks that the only failures are in the one gate, and at least one has the fragment. */
function assertOnly(res, gate, fragment) {
  return assertFails(res, gate, fragment, []);
}

function run(dir) {
  return checkSite(dir, APP_ROOT, AS_OF);
}

// ---- the good site -------------------------------------------------------------------------------

test('D-039 a good site passes all five gates', () => {
  const res = run(GOOD);
  assert.deepEqual(res.failures, [], 'the good site must pass: ' + JSON.stringify(res.failures));
  assert.equal(res.ok, true);
});

test('D-039 the good site report: ZIP 10118 canary has at least 15 brands and Big Timber goes to the Livingston Domino\'s', () => {
  const res = run(GOOD);
  const canary = res.report.find((l) => /^canary ZIP 10118: \d+ brands within 5 mi$/.test(l));
  assert.ok(canary, 'a canary report line is missing: ' + JSON.stringify(res.report));
  const n = Number(/^canary ZIP 10118: (\d+) brands/.exec(canary)[1]);
  assert.ok(n >= 15, 'canary brands ' + n + ' must be at least 15 (D-039 gate 3)');
  assert.equal(n, CANARY_BRANDS_PINNED, 'canary count differs from the pinned Phase 3 value for 10118');

  const bt = res.report.find((l) => l.startsWith('big timber 59011 -> dominos:'));
  assert.ok(bt, 'a Big Timber report line is missing: ' + JSON.stringify(res.report));
  assert.ok(bt.includes('store dominos@45670,-110546'), 'nearest Domino\'s should be dominos@45670,-110546: ' + bt);
  assert.ok(bt.includes('30.9 mi straight'), 'straight line should be 30.9 mi: ' + bt);
  assert.ok(bt.includes('trip 77.2 mi'), 'trip should be 77.2 mi: ' + bt);
  assert.ok(bt.includes('one way 38.6 mi'), 'one way should be 38.6 mi: ' + bt);
  // D-039 dry-run criterion: one way within 25% of the real ~33 mi drive (BUILD.md section 8).
  const oneWay = Number(/one way ([\d.]+) mi/.exec(bt)[1]);
  assert.ok(oneWay >= 24.75 && oneWay <= 41.25, 'one way ' + oneWay + ' is outside 33 mi +/- 25%');
});

// ---- gate: brands --------------------------------------------------------------------------------

test('D-039 brands: a site with fewer than 150 brands fails the brands gate', () => {
  const dir = freshSite('few-brands');
  const model = parseBrands(dir);
  const fixtureSet = fixtureBrandIds();
  const profiled = new Set(Object.keys(REPO_PROFILES));
  // Drop the smallest non-profiled brands that no fixture tile names (so no geo lookup can meet a
  // missing brand) until exactly 149 remain.
  const candidates = model.brands
    .filter((b) => !profiled.has(b.id) && !fixtureSet.has(b.id))
    .sort((a, b) => a.stores - b.stores || (a.id < b.id ? -1 : 1));
  const drop = model.brands.length - 149;
  assert.ok(candidates.length >= drop, 'not enough droppable brands');
  for (const b of candidates.slice(0, drop)) b.removed = true;
  balanceTiles(model);
  commitBrands(model);
  const res = run(dir);
  assertOnly(res, 'brands', 'only 149 brands, need at least 150');
});

test('D-039 brands: a PROFILES key missing from BRANDS fails the brands gate', () => {
  const dir = freshSite('profile-not-in-brands');
  editOnce(dir, path.join('src', 'data', 'profiles.js'), '  root.POD.data.PROFILES = {',
    '  root.POD.data.PROFILES = {\n    "zz_not_a_brand": {},');
  const res = run(dir);
  assertOnly(res, 'brands', 'PROFILES keys not in BRANDS: zz_not_a_brand');
});

test('D-039 brands: a TILE_INDEX cell with no tile file fails the brands gate', () => {
  const dir = freshSite('index-cell-no-file');
  fs.rmSync(path.join(dir, 'src', 'data', 'stores', '-83_135.js'));
  assert.equal(fs.existsSync(path.join(dir, 'src', 'data', 'stores', '-83_135.js')), false);
  const res = run(dir);
  assertOnly(res, 'brands', 'TILE_INDEX cells with no tile file: -83_135');
});

test('D-039 brands: a tile file not named in TILE_INDEX fails the brands gate', () => {
  const dir = freshSite('file-not-in-index');
  assert.equal(Object.prototype.hasOwnProperty.call(TILE_INDEX, '1_1'), false, '1_1 must not be a TILE_INDEX cell');
  fs.writeFileSync(path.join(dir, 'src', 'data', 'stores', '1_1.js'), stubTile('1_1'));
  const res = run(dir);
  assertOnly(res, 'brands', 'tile files not in TILE_INDEX: 1_1');
});

test('D-039 brands: a TILE_INDEX count one above the BRANDS stores fails the brands gate', () => {
  const dir = freshSite('index-count');
  editOnce(dir, path.join('src', 'data', 'brands.js'), '    "-83_135": 1,', '    "-83_135": 2,');
  const res = run(dir);
  assertOnly(res, 'brands', 'TILE_INDEX counts sum to');
  const msg = res.failures.find((f) => f.gate === 'brands').msg;
  const m = /sum to (\d+) but BRANDS stores sum to (\d+)/.exec(msg);
  assert.ok(m, 'message names both sums: ' + msg);
  assert.equal(Number(m[1]) - Number(m[2]), 1, 'the TILE_INDEX sum should be exactly one more than BRANDS');
});

// ---- gate: drift ---------------------------------------------------------------------------------

test('D-039 drift: total stores cut below 80% of committed fails the drift gate', () => {
  const dir = freshSite('total-79');
  const model = parseBrands(dir);
  for (const b of model.brands) b.stores = Math.floor(0.79 * b.stores);
  for (const t of model.tiles) t.count = Math.floor(0.79 * t.count);
  balanceTiles(model);
  commitBrands(model);
  const res = run(dir);
  assertOnly(res, 'drift', 'is under 80% of committed ' + COMMITTED_TOTAL_PINNED);
  const msg = res.failures.find((f) => f.gate === 'drift').msg;
  const total = Number(/total stores (\d+) is under/.exec(msg)[1]);
  assert.ok(total < 0.8 * COMMITTED_TOTAL_PINNED, 'total ' + total + ' should be under 80% of ' + COMMITTED_TOTAL_PINNED);
});

test('D-039 drift: one profiled brand at 49% of its committed count fails the drift gate', () => {
  const dir = freshSite('dominos-49');
  const model = parseBrands(dir);
  const dom = model.brands.find((b) => b.id === 'dominos');
  assert.ok(dom && dom.stores === 7316, 'dominos should be committed at 7316 stores');
  dom.stores = Math.floor(0.49 * dom.stores);
  balanceTiles(model);
  commitBrands(model);
  const res = run(dir);
  assertOnly(res, 'drift', 'profiled brand dominos has 3584 stores, under 50% of committed 7316');
});

test('D-039 drift: a profiled brand dropped from BRANDS fails drift, because drift can only see it through brands', () => {
  // A profiled brand missing from OUT's BRANDS is reachable only with PROFILES still naming it: the
  // brands gate reports the PROFILES key, and drift reports the brand as missing. Dropping it from
  // PROFILES as well would hide it from drift, and the brands gate would then pass. The geo lookup
  // also meets the id in tiles near ZIP 10118, so the canary may fail too; that is the fail-closed
  // result, and the canary is allowed here.
  const dir = freshSite('profiled-dropped');
  const model = parseBrands(dir);
  const wingstop = model.brands.find((b) => b.id === 'wingstop');
  assert.ok(wingstop && wingstop.stores > 0, 'wingstop should be a committed profiled brand');
  wingstop.removed = true;
  balanceTiles(model);
  commitBrands(model);
  const res = run(dir);
  assertFails(res, 'drift', 'profiled brand wingstop is missing from OUT', ['brands', 'canary']);
  assert.ok(res.failures.some((f) => f.gate === 'brands' && f.msg.includes('PROFILES keys not in BRANDS: wingstop')),
    'the brands gate should name wingstop as a PROFILES key not in BRANDS');
});

// ---- gate: canary --------------------------------------------------------------------------------

test('D-039 canary: 10118 with its tiles stubbed out fails the canary gate', () => {
  const dir = freshSite('canary-stubbed');
  // 40_-74 holds Manhattan and Brooklyn; 40_-75 holds the Jersey City side within 5 mi. Both are
  // stubbed. (Stubbing 40_-74 alone leaves 40_-75's stores, so 10118 still finds 59 brands.)
  for (const cell of ['40_-74', '40_-75']) {
    const file = path.join(dir, 'src', 'data', 'stores', cell + '.js');
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, stubTile(cell));
    assert.notEqual(fs.readFileSync(file, 'utf8'), before, cell + ' stub did not land');
  }
  const res = run(dir);
  assertOnly(res, 'canary', 'ZIP 10118 storesNear:');
  const msg = res.failures.find((f) => f.gate === 'canary').msg;
  const stores = Number(/stores=(\d+)/.exec(msg)[1]);
  const radius = Number(/radius=(\d+)/.exec(msg)[1]);
  assert.ok(radius !== 5 || stores < 15, 'the 5 mi search should find fewer than 15 brands: ' + msg);
});

test('D-039 canary: tiles written with lat/lon at x100 instead of x1000 fail the canary gate', () => {
  const dir = freshSite('canary-scale');
  for (const cell of fixtureCells()) {
    const file = path.join(dir, 'src', 'data', 'stores', cell + '.js');
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/"s": "([^"]*)"/, (m, s) => {
      const recs = s.split(';').map((r) => {
        const f = r.split(',');
        return [f[0], Math.round(Number(f[1]) / 10), Math.round(Number(f[2]) / 10)].join(',');
      });
      return '"s": "' + recs.join(';') + '"';
    });
    assert.notEqual(next, text, cell + ' scale edit did not land');
    fs.writeFileSync(file, next);
  }
  const res = run(dir);
  assertOnly(res, 'canary', 'ZIP 10118 storesNear:');
});

test('D-039 canary: fewer than 15 brands within 5 mi, rescued by a wider radius, still fails the canary gate', () => {
  const dir = freshSite('canary-radius');
  // Drop every 40_-74 and 40_-75 record in a box that holds all of the 5 mi circle around 10118
  // (centre 40.749, -73.986; the box is +/-0.10 lat and +/-0.12 lon, and 5 mi is about 0.072 x 0.093).
  // Stores 5 to 10 mi out remain, so the search expands to 10 mi and finds 15 or more there.
  for (const cell of ['40_-74', '40_-75']) {
    const file = path.join(dir, 'src', 'data', 'stores', cell + '.js');
    const text = fs.readFileSync(file, 'utf8');
    let dropped = 0;
    const next = text.replace(/"s": "([^"]*)"/, (m, s) => {
      const kept = s.split(';').filter((r) => {
        const f = r.split(',').map(Number);
        const near = Math.abs(f[1] / 1000 - 40.749) < 0.1 && Math.abs(f[2] / 1000 + 73.986) < 0.12;
        if (near) dropped++;
        return !near;
      });
      return '"s": "' + kept.join(';') + '"';
    });
    assert.ok(dropped > 0, 'no records were dropped from ' + cell);
    fs.writeFileSync(file, next);
  }
  const res = run(dir);
  assertOnly(res, 'canary', 'ZIP 10118 storesNear:');
  const msg = res.failures.find((f) => f.gate === 'canary').msg;
  assert.ok(msg.includes('radius=10'), 'the search should have widened to 10 mi: ' + msg);
  assert.ok(msg.includes('partial=false'), 'the wider search is complete, so the failure is the radius: ' + msg);
});

test('D-039 canary: a stale tile (another run id) inside the 10118 search fails the canary gate as partial', () => {
  const dir = freshSite('canary-stale-tile');
  const file = path.join(dir, 'src', 'data', 'stores', '40_-74.js');
  editOnce(dir, path.join('src', 'data', 'stores', '40_-74.js'), '"run": "' + BRANDS_RUN + '"',
    '"run": "2026-10-31-13-00-00"');
  assert.ok(fs.readFileSync(file, 'utf8').includes('"run": "2026-10-31-13-00-00"'));
  const res = run(dir);
  assertOnly(res, 'canary', 'ZIP 10118 storesNear:');
  const msg = res.failures.find((f) => f.gate === 'canary').msg;
  assert.ok(msg.includes('partial=true'), 'a tile from another run makes the search partial: ' + msg);
});

// ---- gate: states --------------------------------------------------------------------------------

const AL_ROW = '["AL", "Alabama", 3.481, 9.46]';

test('D-039 states: a gasRegular of 0.5 fails the states gate', () => {
  const dir = freshSite('gas-half');
  editOnce(dir, path.join('src', 'data', 'states.js'), AL_ROW, '["AL", "Alabama", 0.5, 9.46]');
  assertOnly(run(dir), 'states', 'AL gasRegular 0.5 is not a number in [1.50, 8.00]');
});

test('D-039 states: a state code changed (51 rows, one wrong code) fails the states gate', () => {
  const dir = freshSite('code-changed');
  editOnce(dir, path.join('src', 'data', 'states.js'), AL_ROW, '["AX", "Alabama", 3.481, 9.46]');
  assertOnly(run(dir), 'states', 'state codes differ from the committed file');
});

test('D-039 states: a null gasRegular fails the states gate', () => {
  const dir = freshSite('gas-null');
  editOnce(dir, path.join('src', 'data', 'states.js'), AL_ROW, '["AL", "Alabama", null, 9.46]');
  assertOnly(run(dir), 'states', 'AL gasRegular null is not a number');
});

test('D-039 states: a mealTaxPct that differs from the committed file fails the states gate', () => {
  const dir = freshSite('meal-tax');
  editOnce(dir, path.join('src', 'data', 'states.js'), AL_ROW, '["AL", "Alabama", 3.481, 9.99]');
  assertOnly(run(dir), 'states', 'AL mealTaxPct 9.99 differs from committed 9.46');
});

test('D-039 states: a removed state row (50 codes) fails the states gate', () => {
  const dir = freshSite('row-removed');
  removeLine(dir, path.join('src', 'data', 'states.js'), '["AL", "Alabama", 3.481, 9.46]');
  assertOnly(run(dir), 'states', 'STATES has 50 rows, want 51');
});

test('D-039 states: GRADE_ADD.premium of 3.0 fails the states gate', () => {
  const dir = freshSite('premium-3');
  editOnce(dir, path.join('src', 'data', 'states.js'), 'premium: 1.02,', 'premium: 3.0,');
  assertOnly(run(dir), 'states', 'GRADE_ADD.premium 3 is not a number in [0.00, 2.50]');
});

test('D-039 states: a missing GAS_WEEK fails the states gate', () => {
  const dir = freshSite('gas-week-missing');
  removeLine(dir, path.join('src', 'data', 'states.js'), 'root.POD.data.GAS_WEEK = ');
  assertOnly(run(dir), 'states', 'is not a YYYY-MM-DD date');
});

test('D-039 states: GAS_WEEK 15 days before the as-of date fails the states gate', () => {
  const dir = freshSite('gas-week-15');
  editOnce(dir, path.join('src', 'data', 'states.js'), 'root.POD.data.GAS_WEEK = "2026-11-09";',
    'root.POD.data.GAS_WEEK = "2026-11-01";');
  assertOnly(run(dir), 'states', 'GAS_WEEK 2026-11-01 is more than 14 days before 2026-11-16');
});

test('D-039 states: GAS_WEEK after the as-of date fails the states gate', () => {
  const dir = freshSite('gas-week-future');
  editOnce(dir, path.join('src', 'data', 'states.js'), 'root.POD.data.GAS_WEEK = "2026-11-09";',
    'root.POD.data.GAS_WEEK = "2026-11-17";');
  assertOnly(run(dir), 'states', 'GAS_WEEK 2026-11-17 is after the as-of date 2026-11-16');
});

test('D-039 states: GAS_WEEK exactly 14 days before the as-of date passes', () => {
  const dir = freshSite('gas-week-14');
  editOnce(dir, path.join('src', 'data', 'states.js'), 'root.POD.data.GAS_WEEK = "2026-11-09";',
    'root.POD.data.GAS_WEEK = "2026-11-02";');
  const res = run(dir);
  assert.deepEqual(res.failures, [], 'a 14-day-old week is inside the gate: ' + JSON.stringify(res.failures));
  assert.equal(res.ok, true);
  assert.ok(res.report.includes('GAS_WEEK 2026-11-02 (14 days before 2026-11-16)'), JSON.stringify(res.report));
});

// ---- gate: es5 -----------------------------------------------------------------------------------

test('D-039 es5: an ES6 let in the site\'s src/js/app.js fails the es5 gate', () => {
  const dir = freshSite('es6-let');
  const file = path.join(dir, 'src', 'js', 'app.js');
  fs.appendFileSync(file, '\nlet shadowed = 1;\n');
  assert.ok(fs.readFileSync(file, 'utf8').includes('let shadowed'), 'the let did not land');
  const res = run(dir);
  assertOnly(res, 'es5', 'app.js');
  assert.ok(res.failures.find((f) => f.gate === 'es5').msg.includes('ES5 violation'), JSON.stringify(res.failures));
});

// ---- the CLI -------------------------------------------------------------------------------------

function cli(args) {
  return childProcess.spawnSync(process.execPath, [CLI, ...args], { cwd: APP_ROOT, encoding: 'utf8' });
}

test('D-039 CLI: the good site exits 0 and prints OK for all five gates', () => {
  const r = cli([GOOD, '.', '--as-of', AS_OF]);
  assert.equal(r.status, 0, 'stderr: ' + r.stderr + ' stdout: ' + r.stdout);
  for (const g of GATES) assert.ok(r.stdout.includes('check-site: OK ' + g + '\n'), 'missing OK line for ' + g);
  assert.equal(r.stdout.includes('check-site: FAIL'), false);
});

test('D-039 CLI: a broken site exits 1 with a check-site: FAIL line', () => {
  const dir = freshSite('cli-broken');
  editOnce(dir, path.join('src', 'data', 'states.js'), AL_ROW, '["AL", "Alabama", 0.5, 9.46]');
  const r = cli([dir, '.', '--as-of', AS_OF]);
  assert.equal(r.status, 1, 'stdout: ' + r.stdout);
  assert.match(r.stdout, /check-site: FAIL states: AL gasRegular 0\.5 /);
  assert.ok(r.stdout.includes('check-site: OK brands\n'), 'the other gates still print OK');
});

test('D-039 CLI: a run without --as-of exits 2 with usage', () => {
  const r = cli([GOOD, '.']);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('usage: node tools/check-site.js'), 'stderr: ' + r.stderr);
});
