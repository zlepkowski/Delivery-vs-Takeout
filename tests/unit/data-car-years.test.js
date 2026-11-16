// D-037 src/data/cars.js: CAR_YEARS (fuel economy by model year), checked against EPA's own
// records. EPA source: fueleconomy.gov vehicles.csv, sha256 1d553896a77898f6cf47128281337af268df053c90dc1365891c7c8abff82c82
// (the file D-023 and D-037 use). Each expected figure below was worked by the orchestrator from
// that file's records, with the arithmetic in the comment. Expected values never come from
// src/data/cars.js. The D-037 tests fail until the generator writes CAR_YEARS and the file is regenerated.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const REL = 'src/data/cars.js';
const RUN = '\\d+[*de]?@\\d{4}(?:-\\d{4})?';
const ROW_RE = new RegExp(
  '^[^|,:]+\\|[^|,:]+:' + RUN + '(?: ' + RUN + ')*' +
  '(?:,[^|,:]+:' + RUN + '(?: ' + RUN + ')*)*$'
);
const RUN_RE = /^(\d+)([*de]?)@(\d{4})(?:-(\d{4}))?$/;
const MAX_BYTES = 60 * 1024;

let cached = null;
function load() {
  if (!cached) cached = loadData([REL]);
  return cached;
}

/** CAR_YEARS from the file; fails with a readable message until the generator writes it. */
function years() {
  const { CAR_YEARS } = load();
  assert.ok(Array.isArray(CAR_YEARS), 'CAR_YEARS is missing from src/data/cars.js (run the generator with --years-since 2000)');
  return CAR_YEARS;
}

function parseRun(s) {
  const m = RUN_RE.exec(s);
  if (!m) return null;
  const first = Number(m[3]);
  return {
    value: Number(m[1]),
    suffix: m[2],
    first,
    last: m[4] === undefined ? first : Number(m[4]),
  };
}

/** "Make|Model:runs,Model:runs" -> { make, models: [{ name, runs: [run...] }] } */
function parseRow(row) {
  const bar = row.indexOf('|');
  const models = row.slice(bar + 1).split(',').map((m) => {
    const c = m.indexOf(':');
    return { name: m.slice(0, c), runs: m.slice(c + 1).split(' ').map(parseRun) };
  });
  return { make: row.slice(0, bar), models };
}

/** The run of the named model that covers a year (first <= year <= last), or undefined. */
function runCovering(make, model, year) {
  const row = years().find((r) => r.slice(0, r.indexOf('|')) === make);
  assert.ok(row, `no make "${make}" in CAR_YEARS`);
  const m = parseRow(row).models.find((x) => x.name === model);
  assert.ok(m, `no model "${model}" under "${make}" in CAR_YEARS`);
  return m.runs.find((r) => r && r.first <= year && year <= r.last);
}

function assertCovering(make, model, year, value, suffix) {
  const run = runCovering(make, model, year);
  assert.ok(run, `no run of ${make} ${model} covers ${year}`);
  assert.equal(run.value, value, `${make} ${model} ${year}: value`);
  assert.equal(run.suffix, suffix, `${make} ${model} ${year}: suffix`);
}

// ---- Non-D-037: the CAR_DATA this builds on still loads (passes now).

test('D-023 src/data/cars.js still defines CAR_DATA as a non-empty array of strings', () => {
  const { CAR_DATA } = load();
  assert.ok(Array.isArray(CAR_DATA) && CAR_DATA.length > 0);
  assert.ok(CAR_DATA.every((r) => typeof r === 'string'));
});

// ---- D-037: CAR_YEARS against EPA.

test('D-037 CAR_YEARS: every row matches the grammar, years are 2000 or later, and runs are newest first without overlap', () => {
  for (const row of years()) {
    assert.match(row, ROW_RE, 'grammar: ' + row);
    for (const model of parseRow(row).models) {
      for (const run of model.runs) {
        assert.ok(run, 'unparseable run in ' + row);
        assert.ok(run.first >= 2000, `run before 2000 in ${row}`);
        assert.ok(run.first <= run.last, 'first after last in ' + row);
      }
      for (let i = 1; i < model.runs.length; i++) {
        assert.ok(model.runs[i - 1].first > model.runs[i].last,
          `runs of ${model.name} out of order or overlapping in ${row}`);
      }
    }
  }
});

test('D-037 CAR_YEARS: makes are unique and every make and model is in codepoint order', () => {
  const rows = years();
  const makes = rows.map((r) => r.slice(0, r.indexOf('|')));
  assert.equal(new Set(makes).size, makes.length, 'makes must be unique');
  assert.deepEqual(makes, [...makes].sort(), 'makes must be in codepoint order');
  for (const row of rows) {
    const names = parseRow(row).models.map((m) => m.name);
    assert.deepEqual(names, [...names].sort(), 'models out of order in ' + row.slice(0, 40));
  }
});

test('D-037 CAR_YEARS: src/data/cars.js is under 60 KB (60 * 1024 bytes)', () => {
  years(); // the file must carry CAR_YEARS, not only CAR_DATA
  const size = fs.statSync(path.join(APP_ROOT, REL)).size;
  assert.ok(size < MAX_BYTES, `cars.js is ${size} bytes`);
});

test('D-037 Honda Accord: the run covering 2003 is 24', () => {
  // EPA 2003 Accord records: 21, 22, 25, 26 mpg. Median = (22 + 25) / 2 = 23.5 -> round half up = 24.
  assertCovering('Honda', 'Accord', 2003, 24, '');
});

test('D-037 Toyota Camry: the run covering 2018 is 32', () => {
  // EPA 2018 Camry records: 26, 26, 32, 32, 34, 46, 52 (7 values). The 4th of 7 sorted = 32.
  assertCovering('Toyota', 'Camry', 2018, 32, '');
});

test('D-037 Ford F150: the run covering 2019 is 19', () => {
  // EPA 2019 F150: 25 regular records vs 5 diesel, so regular. The 13th of 25 sorted values is 19.
  assertCovering('Ford', 'F150', 2019, 19, '');
});

test('D-037 Tesla Model 3: the run covering 2019 is 38e', () => {
  // EPA 2019 Model 3 combE values (mi/kWh): 28.9462, 28.9462, 27.4857, 25.8779, 25.6917, 25.3881.
  // 1000 / combE: 34.55, 34.55, 36.3826, 38.6430, 38.9244, 39.3917. Middle two of six are
  // 36.3826 and 38.6430; their mean is 37.5128 -> round half up = 38. Suffix e.
  assertCovering('Tesla', 'Model 3', 2019, 38, 'e');
});

test('D-037 Chevrolet Bolt EV: the run covering 2020 is 35e', () => {
  // EPA files the 2017-2023 car as baseModel "Bolt EV" (2020: combE 28.6629 -> 1000 / 28.6629 = 34.89 -> 35, electric).
  // "BOLT" is a different baseModel with only a 2027 record, so it has no 2020 figure (orchestrator, from vehicles.csv).
  assertCovering('Chevrolet', 'Bolt EV', 2020, 35, 'e');
});

test('D-037 BMW 3 Series: the run covering 2019 is 27* (premium)', () => {
  // EPA 2019 3 Series premium records: 23, 27, 27, 28, 30. The middle value is 27.
  assertCovering('BMW', '3 Series', 2019, 27, '*');
});

test('D-037 Honda Civic: the run covering 2015 is 33', () => {
  // EPA 2015 Civic regular records 31, 32, 33, 34, 44 beat one natural-gas and one premium record.
  // The middle value is 33.
  assertCovering('Honda', 'Civic', 2015, 33, '');
});

test('D-037 no run starts before 2000, and no Honda Accord run covers 1999', () => {
  // D-037 leaves years before --years-since 2000 out, so Honda Accord has no 1999 figure.
  for (const row of years()) {
    for (const model of parseRow(row).models) {
      for (const run of model.runs) assert.ok(run.first >= 2000, `${model.name} run starts ${run.first}`);
    }
  }
  assert.equal(runCovering('Honda', 'Accord', 1999), undefined);
});

test('D-037 Ram has no 2500 entry, because EPA does not rate it', () => {
  const row = years().find((r) => r.startsWith('Ram|'));
  assert.ok(row, 'Ram is missing from CAR_YEARS');
  const names = parseRow(row).models.map((m) => m.name);
  assert.ok(!names.some((n) => n.includes('2500')), 'Ram has a 2500 entry: ' + names.join(', '));
});

test('D-037 every CAR_DATA model is in CAR_YEARS, its newest run matches CAR_DATA, and that run ends in 2025 or later', () => {
  // CAR_DATA keeps only models whose latest model year is >= 2025 (D-023 --since 2025), so the newest
  // run of each must end at that latest year, which is 2025 or later.
  const { CAR_DATA } = load();
  const yearRows = new Map(years().map((r) => [r.slice(0, r.indexOf('|')), parseRow(r)]));
  let checked = 0;
  for (const row of CAR_DATA) {
    const make = parseRow(row).make;
    const cy = yearRows.get(make);
    assert.ok(cy, `CAR_DATA make "${make}" missing from CAR_YEARS`);
    const carModels = row.slice(row.indexOf('|') + 1).split(',');
    for (const m of carModels) {
      const c = m.indexOf(':');
      const name = m.slice(0, c);
      const cell = m.slice(c + 1);
      const suffix = /\d$/.test(cell) ? '' : cell.slice(-1);
      const value = Number(cell.replace(/[*de]$/, ''));
      const model = cy.models.find((x) => x.name === name);
      assert.ok(model, `CAR_DATA model "${make} ${name}" missing from CAR_YEARS`);
      const newest = model.runs[0];
      assert.equal(newest.value, value, `${make} ${name}: newest value`);
      assert.equal(newest.suffix, suffix, `${make} ${name}: newest suffix`);
      assert.ok(newest.last >= 2025, `${make} ${name}: newest run ends ${newest.last}`);
      checked++;
    }
  }
  assert.ok(checked > 1000, `only ${checked} CAR_DATA models checked`);
});
