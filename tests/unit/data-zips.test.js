// §2 src/data/zips.js: 42,354 ZIP centroids in the packed format
// (zip,lat*1000,lon*1000,cityIndex,ST records joined by ';').

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const REL = 'src/data/zips.js';
const CITY_TARGET = 18908;
const ZIP_TARGET = 42354;

let cached = null;
function load() {
  if (!cached) cached = loadData([REL]);
  return cached;
}

function records() {
  return load().ZIP_PACKED.split(';').map((r) => r.split(','));
}

test('§2 src/data/zips.js exists', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, REL)), 'missing src/data/zips.js');
});

test('§2 ZIP_CITIES is a unique non-empty string array within 1% of 18,908', () => {
  const { ZIP_CITIES } = load();
  assert.ok(Array.isArray(ZIP_CITIES), 'ZIP_CITIES must be an array');
  assert.ok(ZIP_CITIES.every((c) => typeof c === 'string' && c !== ''), 'every city must be a non-empty string');
  assert.equal(new Set(ZIP_CITIES).size, ZIP_CITIES.length, 'city names must be unique');
  assert.ok(
    Math.abs(ZIP_CITIES.length - CITY_TARGET) <= 0.01 * CITY_TARGET,
    `city count ${ZIP_CITIES.length}, expected 18,908 ±1%`
  );
});

test('§2 ZIP_PACKED is a string of about 42,354 records (±1%)', () => {
  const { ZIP_PACKED } = load();
  assert.equal(typeof ZIP_PACKED, 'string');
  const n = ZIP_PACKED.split(';').length;
  assert.ok(Math.abs(n - ZIP_TARGET) <= 0.01 * ZIP_TARGET, `record count ${n}, expected 42,354 ±1%`);
});

test('§2 every ZIP record has five fields and a unique 5-digit zip', () => {
  const recs = records();
  const bad = recs.filter((f) => f.length !== 5 || !/^\d{5}$/.test(f[0]));
  assert.deepEqual(bad.slice(0, 5).map((f) => f.join(',')), []);
  const zips = recs.map((f) => f[0]);
  assert.equal(new Set(zips).size, zips.length, 'zip codes must be unique');
});

test('§2 ZIP lat and lon are integers (×1000) inside the card ranges', () => {
  const bad = records().filter(
    ([, la, lo]) =>
      !/^-?\d+$/.test(la) ||
      !/^-?\d+$/.test(lo) ||
      Number(la) < -15000 || Number(la) > 72000 ||
      Number(lo) < -180000 || Number(lo) > 180000
  );
  assert.deepEqual(bad.slice(0, 5).map((f) => f.join(',')), []);
});

test('§2 ZIP cityIdx is an in-range integer and state is two capital letters', () => {
  const { ZIP_CITIES } = load();
  const bad = records().filter(
    ([, , , ci, st]) =>
      !/^\d+$/.test(ci) || Number(ci) >= ZIP_CITIES.length || !/^[A-Z]{2}$/.test(st)
  );
  assert.deepEqual(bad.slice(0, 5).map((f) => f.join(',')), []);
});

/** Looks a ZIP up in the packed string and decodes it. */
function spot(zip) {
  const { ZIP_CITIES } = load();
  const rec = records().find((f) => f[0] === zip);
  assert.ok(rec, `zip ${zip} not in ZIP_PACKED`);
  const [, la, lo, ci, st] = rec;
  return { city: ZIP_CITIES[Number(ci)], state: st, lat: Number(la) / 1000, lon: Number(lo) / 1000 };
}

test('§2 ZIP 11201 is Brooklyn, NY at about 40.69, -73.99', () => {
  const z = spot('11201');
  assert.equal(z.city, 'Brooklyn');
  assert.equal(z.state, 'NY');
  assert.ok(Math.abs(z.lat - 40.69) <= 0.05, `lat ${z.lat}`);
  assert.ok(Math.abs(z.lon - -73.99) <= 0.05, `lon ${z.lon}`);
});

test('§2 ZIP 10118 is New York, NY at about 40.75, -73.99', () => {
  const z = spot('10118');
  assert.equal(z.city, 'New York');
  assert.equal(z.state, 'NY');
  assert.ok(Math.abs(z.lat - 40.75) <= 0.05, `lat ${z.lat}`);
  assert.ok(Math.abs(z.lon - -73.99) <= 0.05, `lon ${z.lon}`);
});

test('§2 ZIP 59011 is Big Timber, MT at about 45.83, -109.95', () => {
  const z = spot('59011');
  assert.equal(z.city, 'Big Timber');
  assert.equal(z.state, 'MT');
  assert.ok(Math.abs(z.lat - 45.83) <= 0.2, `lat ${z.lat}`);
  assert.ok(Math.abs(z.lon - -109.95) <= 0.3, `lon ${z.lon}`);
});
