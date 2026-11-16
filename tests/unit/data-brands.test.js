// D-021 src/data/brands.js + tests/fixtures/stores/*.js: the brand index and the
// store tiles it indexes. §8 check: the nearest Domino's from Big Timber.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData, haversineMi } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const BRANDS_REL = 'src/data/brands.js';
const CATEGORIES = ['pizza', 'burger', 'chicken', 'mexican', 'sandwich', 'asian', 'coffee', 'dessert', 'casual', 'other'];
const CELLS = ['40_-74', '40_-75', '45_-111', '45_-110', '45_-109', '46_-111', '46_-110', '46_-109'];
const BIG_TIMBER = { lat: 45.8338, lon: -109.9554 };

const fixtureRel = (cell) => `tests/fixtures/stores/${cell}.js`;
const fixturePresent = (cell) => fs.existsSync(path.join(APP_ROOT, fixtureRel(cell)));
const FIXTURES = CELLS.filter(fixturePresent).map(fixtureRel);

// Known brands, by Wikidata id: [wikidata, expected id, expected category].
const KNOWN = [
  ['Q839466', 'dominos', 'pizza'],
  ['Q37158', 'starbucks', 'coffee'],
  ['Q752941', 'taco_bell', 'mexican'],
  ['Q8025339', 'wingstop', 'chicken'],
  ['Q1131810', 'five_guys', 'burger'],
  ['Q244457', 'subway', 'sandwich'],
  ['Q2759586', 'papa_johns', 'pizza'],
  ['Q465751', 'chipotle', 'mexican'],
  ['Q1045842', 'the_cheesecake_factory', 'casual'],
];

let cached = null;
function load() {
  if (!cached) cached = loadData([BRANDS_REL, ...FIXTURES]);
  return cached;
}

/** Records of a tile as [b, la, lo] strings. An empty s has no records. */
function rawRecords(tile) {
  return tile.s === '' ? [] : tile.s.split(';').map((r) => r.split(','));
}

/** Records of a tile as [b, la, lo] numbers (NaN if malformed). */
function parsed(tile) {
  return rawRecords(tile).map((r) => r.map(Number));
}

function loadedTiles() {
  const { TILES = {} } = load();
  return Object.keys(TILES).sort().map((cell) => [cell, TILES[cell]]);
}

test('D-021 src/data/brands.js exists', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, BRANDS_REL)), 'missing src/data/brands.js');
});

test('D-021 BRANDS is an object and BRAND_IDS is its sorted keys', () => {
  const { BRANDS, BRAND_IDS } = load();
  assert.ok(BRANDS && typeof BRANDS === 'object' && !Array.isArray(BRANDS), 'BRANDS must be an object');
  assert.deepEqual(Array.from(BRAND_IDS), Object.keys(BRANDS).sort());
});

test('D-021 brand ids match the slug pattern', () => {
  const { BRANDS } = load();
  const bad = Object.keys(BRANDS).filter((id) => !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(id));
  assert.deepEqual(bad, []);
});

test('D-021 each brand has a non-empty name, a known category, a Wikidata id and stores >= 25', () => {
  const { BRANDS } = load();
  const problems = [];
  for (const id of Object.keys(BRANDS)) {
    const b = BRANDS[id];
    if (typeof b.name !== 'string' || b.name === '') problems.push(`${id}: name`);
    if (!CATEGORIES.includes(b.category)) problems.push(`${id}: category ${b.category}`);
    if (typeof b.wikidata !== 'string' || !/^Q\d+$/.test(b.wikidata)) problems.push(`${id}: wikidata ${b.wikidata}`);
    if (!Number.isInteger(b.stores) || b.stores < 25) problems.push(`${id}: stores ${b.stores}`);
  }
  assert.deepEqual(problems, []);
});

test('D-021 each brand has exactly name, category, wikidata and stores (no profiled key)', () => {
  const { BRANDS } = load();
  const bad = Object.keys(BRANDS).filter((id) => Object.keys(BRANDS[id]).sort().join(',') !== 'category,name,stores,wikidata');
  assert.deepEqual(bad, []);
});

test('D-021 Wikidata ids are unique across brands', () => {
  const { BRANDS } = load();
  const wds = Object.keys(BRANDS).map((id) => BRANDS[id].wikidata);
  assert.equal(new Set(wds).size, wds.length);
});

test('D-021 there are 150 to 400 brands', () => {
  const n = Object.keys(load().BRANDS).length;
  assert.ok(n >= 150 && n <= 400, `brand count ${n}`);
});

test('D-021 BRANDS_RUN is a run id like 2026-10-31-13-32-34', () => {
  assert.match(String(load().BRANDS_RUN), /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
});

test('D-021 TILE_INDEX keys look like cells and values are positive integers', () => {
  const { TILE_INDEX } = load();
  assert.ok(TILE_INDEX && typeof TILE_INDEX === 'object', 'TILE_INDEX must be an object');
  const keys = Object.keys(TILE_INDEX);
  assert.deepEqual(keys.filter((k) => !/^-?\d+_-?\d+$/.test(k)), []);
  assert.deepEqual(keys.filter((k) => !Number.isInteger(TILE_INDEX[k]) || TILE_INDEX[k] <= 0), []);
});

test('D-021 TILE_INDEX sums to the sum of BRANDS[*].stores', () => {
  const { BRANDS, TILE_INDEX } = load();
  const tiles = Object.keys(TILE_INDEX).reduce((s, k) => s + TILE_INDEX[k], 0);
  const brands = Object.keys(BRANDS).reduce((s, id) => s + BRANDS[id].stores, 0);
  assert.equal(tiles, brands);
});

for (const [wikidata, id, category] of KNOWN) {
  test(`D-021 ${wikidata} is ${id} in category ${category}`, () => {
    const { BRANDS } = load();
    const hits = Object.keys(BRANDS).filter((k) => BRANDS[k].wikidata === wikidata);
    assert.deepEqual(hits, [id]);
    assert.equal(BRANDS[id].category, category);
  });
}

test('D-021 40_-74 and 45_-111 tile fixtures are committed', () => {
  for (const cell of ['40_-74', '45_-111']) {
    assert.ok(fixturePresent(cell), `missing ${fixtureRel(cell)}`);
  }
});

test('D-021 each fixture cell is either committed or absent from TILE_INDEX', () => {
  const { TILE_INDEX } = load();
  const bad = CELLS.filter((c) => !fixturePresent(c) && Object.prototype.hasOwnProperty.call(TILE_INDEX, c));
  assert.deepEqual(bad, []);
});

test('D-021 every loaded tile has run equal to BRANDS_RUN', () => {
  const { BRANDS_RUN } = load();
  const bad = loadedTiles().filter(([, t]) => t.run !== BRANDS_RUN).map(([c, t]) => `${c}: ${t.run}`);
  assert.deepEqual(bad, []);
});

test('D-021 every tile record is b,la,lo with integers and b inside BRAND_IDS', () => {
  const { BRAND_IDS } = load();
  const problems = [];
  for (const [cell, tile] of loadedTiles()) {
    for (const r of rawRecords(tile)) {
      const ok = r.length === 3 && /^\d+$/.test(r[0]) && /^-?\d+$/.test(r[1]) && /^-?\d+$/.test(r[2]) &&
        Number(r[0]) < BRAND_IDS.length;
      if (!ok) problems.push(`${cell}: ${r.join(',')}`);
      if (problems.length >= 5) break;
    }
  }
  assert.deepEqual(problems, []);
});

test('D-021 every tile record sits inside its cell (floor of lat and lon)', () => {
  const problems = [];
  for (const [cell, tile] of loadedTiles()) {
    const [clat, clon] = cell.split('_').map(Number);
    for (const [, la, lo] of parsed(tile)) {
      if (Math.floor(la / 1000) !== clat || Math.floor(lo / 1000) !== clon) {
        problems.push(`${cell}: ${la},${lo}`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 5), []);
});

test('D-021 tile records are strictly ascending by (b, la, lo), so no duplicates', () => {
  const problems = [];
  for (const [cell, tile] of loadedTiles()) {
    const recs = parsed(tile);
    for (let i = 1; i < recs.length; i++) {
      const [p, c] = [recs[i - 1], recs[i]];
      const cmp = p[0] - c[0] || p[1] - c[1] || p[2] - c[2];
      if (!(cmp < 0)) {
        problems.push(`${cell}: record ${i} not after ${i - 1}`);
        break;
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('D-021 each tile record count equals its TILE_INDEX entry', () => {
  const { TILE_INDEX } = load();
  const bad = loadedTiles()
    .filter(([cell, tile]) => rawRecords(tile).length !== TILE_INDEX[cell])
    .map(([cell, tile]) => `${cell}: ${rawRecords(tile).length} vs ${TILE_INDEX[cell]}`);
  assert.deepEqual(bad, []);
});

test('D-021 40_-74 has at least 1000 records', () => {
  const tile = load().TILES && load().TILES['40_-74'];
  assert.ok(tile, 'no 40_-74 tile loaded');
  assert.ok(parsed(tile).length >= 1000, `records ${parsed(tile).length}`);
});

for (const id of ['dominos', 'starbucks']) {
  test(`D-021 40_-74 includes at least one ${id} store`, () => {
    const { BRAND_IDS, TILES } = load();
    const b = BRAND_IDS.indexOf(id);
    assert.ok(b >= 0, `${id} not in BRAND_IDS`);
    assert.ok(parsed(TILES['40_-74']).some((r) => r[0] === b), `no ${id} store in 40_-74`);
  });
}

test('§8 from Big Timber the nearest Domino\'s in the loaded MT tiles is 20 to 40 mi away', () => {
  const { BRAND_IDS } = load();
  const b = BRAND_IDS.indexOf('dominos');
  assert.ok(b >= 0, 'dominos not in BRAND_IDS');
  let best = Infinity;
  for (const [cell, tile] of loadedTiles()) {
    if (!/^4[56]_/.test(cell)) continue; // MT cells only
    for (const [br, la, lo] of parsed(tile)) {
      if (br === b) best = Math.min(best, haversineMi(BIG_TIMBER.lat, BIG_TIMBER.lon, la / 1000, lo / 1000));
    }
  }
  assert.ok(best >= 20 && best <= 40, `nearest dominos ${best.toFixed(1)} mi`);
});
