// D-023 and D-037 tools/build-cars.py, run offline on small hand-written EPA-style CSVs.
// Each test writes vehicles.csv into a temp dir, zips it as <cache>/vehicles.csv.zip (so fetch()
// never touches the network), runs the generator and reads the output with vm, like
// build-profiles.test.js. Expected values are worked by hand in each test's comment; none come
// from the generator. D-023-only tests run without --years-since; D-037 tests (names start with
// "D-037 ") pass it, and fail until the generator writes CAR_YEARS.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { APP_ROOT } = require('../helpers/load');

const SCRIPT = path.join(APP_ROOT, 'tools', 'build-cars.py');
const AS_OF = '2026-11-16';

// EPA fuelType1 spellings used by the fixtures.
const REG = 'Regular Gasoline';
const MID = 'Midgrade Gasoline';
const PREM = 'Premium Gasoline';
const DIES = 'Diesel';
const ELEC = 'Electricity';
const GAS = 'Natural Gas';
const H2 = 'Hydrogen';

/** One EPA record. Only the six columns the script reads. */
function rec(make, baseModel, year, fuelType1, comb08 = '', combE = '') {
  return { make, baseModel, year: String(year), fuelType1, comb08: String(comb08), combE: String(combE) };
}

function csvField(s) {
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvText(rows) {
  const cols = ['make', 'baseModel', 'year', 'fuelType1', 'comb08', 'combE'];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvField(r[c])).join(','));
  return lines.join('\n') + '\n';
}

// A fixed entry timestamp: the generator writes the zip's sha256 into the header, and a
// file-mtime stamp would make two runs differ by the second they were written (flaky rerun).
const ZIP_PY =
  'import sys, zipfile\n' +
  'with open(sys.argv[2], "rb") as f:\n' +
  '    data = f.read()\n' +
  'info = zipfile.ZipInfo(sys.argv[3], date_time=(2025, 1, 1, 0, 0, 0))\n' +
  'info.compress_type = zipfile.ZIP_DEFLATED\n' +
  'with zipfile.ZipFile(sys.argv[1], "w") as z:\n' +
  '    z.writestr(info, data)\n';

/**
 * Builds the cache, runs the generator and reads its output.
 * opts: since (default 2025), yearsSince (omitted = no flag), asOf, csvName (name inside the zip),
 * rawCsv (exact CSV text instead of rows).
 * Returns { ok, status, stderr, text, CAR_DATA, CAR_YEARS }.
 */
function runBuild(rows, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-cars-'));
  try {
    const cache = path.join(tmp, 'cache');
    fs.mkdirSync(cache);
    const csvPath = path.join(tmp, 'vehicles.csv');
    fs.writeFileSync(csvPath, opts.rawCsv !== undefined ? opts.rawCsv : csvText(rows));
    const zipPath = path.join(cache, 'vehicles.csv.zip');
    const zipped = spawnSync('python3', ['-I', '-c', ZIP_PY, zipPath, csvPath, opts.csvName || 'vehicles.csv'], { encoding: 'utf8' });
    assert.equal(zipped.status, 0, zipped.stderr);

    const out = path.join(tmp, 'cars.js');
    const args = [
      '-I', SCRIPT,
      '--since', String(opts.since !== undefined ? opts.since : 2025),
      '--as-of', opts.asOf !== undefined ? opts.asOf : AS_OF,
      '--cache', cache,
      '--out', out,
    ];
    if (opts.yearsSince !== undefined) args.push('--years-since', String(opts.yearsSince));
    const r = spawnSync('python3', args, { encoding: 'utf8', cwd: APP_ROOT });
    if (r.status !== 0) return { ok: false, status: r.status, stderr: r.stderr || '' };

    const text = fs.readFileSync(out, 'utf8');
    const sb = { POD: { data: {} } };
    vm.runInNewContext(text, sb);
    // structuredClone moves the VM-realm arrays into this realm, so deepStrictEqual works.
    return {
      ok: true,
      status: 0,
      stderr: r.stderr,
      text,
      CAR_DATA: structuredClone(sb.POD.data.CAR_DATA),
      CAR_YEARS: structuredClone(sb.POD.data.CAR_YEARS),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Runs the generator and insists on success. */
function buildOk(rows, opts) {
  const r = runBuild(rows, opts);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

/** The "value+suffix" for make/model in a packed CAR_DATA list, or undefined. */
function carCell(list, make, model) {
  for (const row of list) {
    const bar = row.indexOf('|');
    if (row.slice(0, bar) !== make) continue;
    for (const m of row.slice(bar + 1).split(',')) {
      const c = m.indexOf(':');
      if (m.slice(0, c) === model) return m.slice(c + 1);
    }
  }
  return undefined;
}

// ---- D-023: CAR_DATA ------------------------------------------------------------------------

test('D-023 --since keeps a model by its latest year and uses only that year\'s records', () => {
  // Corolla's latest year is 2025 (>= --since), so only its 2025 records count: 34 and 36 -> 35.
  // Using all its years would give median(10, 10, 34, 36) = 22.
  // Ranger's only year is 2025 = --since, so it is kept (boundary). Old's latest is 2024 < 2025: dropped.
  const r = buildOk([
    rec('Toyota', 'Corolla', 2023, REG, 10),
    rec('Toyota', 'Corolla', 2024, REG, 10),
    rec('Toyota', 'Corolla', 2025, REG, 34),
    rec('Toyota', 'Corolla', 2025, REG, 36),
    rec('Ford', 'Ranger', 2025, REG, 20),
    rec('Ford', 'Old', 2024, REG, 30),
  ], { since: 2025 });
  assert.deepEqual(r.CAR_DATA, ['Ford|Ranger:20', 'Toyota|Corolla:35']);
});

test('D-023 fuel: Regular and Midgrade are one group, so 2 regular ties 2 premium and Regular wins', () => {
  // Groups: regular = Regular + Midgrade = 2 records; premium = 2 records. Tie -> Regular.
  // Regular values 20, 22 -> median 21, no suffix.
  // Mutation: Midgrade counted apart -> Premium (2) beats Regular (1) -> median(40, 42) = 41, "41*".
  const r = buildOk([
    rec('Mazda', 'Miata', 2025, REG, 20),
    rec('Mazda', 'Miata', 2025, MID, 22),
    rec('Mazda', 'Miata', 2025, PREM, 40),
    rec('Mazda', 'Miata', 2025, PREM, 42),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Mazda|Miata:21']);
});

test('D-023 fuel: a plain majority wins, and Premium takes the * suffix and Diesel the d', () => {
  // Lexus RX: premium 3 > regular 1; median(30, 32, 34) = 32 -> "32*".
  // Ford Super Duty: diesel 2 > regular 1; median(15, 17) = 16 -> "16d".
  const r = buildOk([
    rec('Lexus', 'RX', 2025, PREM, 30),
    rec('Lexus', 'RX', 2025, PREM, 32),
    rec('Lexus', 'RX', 2025, PREM, 34),
    rec('Lexus', 'RX', 2025, REG, 25),
    rec('Ford', 'Super Duty', 2025, DIES, 15),
    rec('Ford', 'Super Duty', 2025, DIES, 17),
    rec('Ford', 'Super Duty', 2025, REG, 12),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Ford|Super Duty:16d', 'Lexus|RX:32*']);
});

test('D-023 fuel ties: Regular > Premium > Diesel > Electricity > other, one tie per model', () => {
  // Prem: premium 1, diesel 1 -> Premium wins (rank 1 < 2): median(30) = "30*".
  //   Mutation: Diesel wins -> "40d".
  // DieEl: diesel 1 (36), electric 1 -> Diesel wins: "36d".
  //   Mutation: Electricity wins -> 1000/25 = 40, "40e".
  // Ev: electric 1 (combE 25 -> 40), natural gas 1 (other) -> Electricity wins: "40e".
  //   Mutation: other wins -> model dropped.
  // Reg: regular 1 (28), natural gas 1 -> Regular wins: "28".
  //   Mutation: other wins -> model dropped.
  const r = buildOk([
    rec('Vanta', 'Prem', 2025, PREM, 30),
    rec('Vanta', 'Prem', 2025, DIES, 40),
    rec('Vanta', 'DieEl', 2025, DIES, 36),
    rec('Vanta', 'DieEl', 2025, ELEC, '', 25),
    rec('Vanta', 'Ev', 2025, ELEC, '', 25),
    rec('Vanta', 'Ev', 2025, GAS, 15),
    rec('Vanta', 'Reg', 2025, REG, 28),
    rec('Vanta', 'Reg', 2025, GAS, 12),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Vanta|DieEl:36d,Ev:40e,Prem:30*,Reg:28']);
});

test('D-023 a model whose winning fuel is other (natural gas, hydrogen, blank) is dropped, and so is its empty make', () => {
  // Gaseous Cng: natural gas 2 > regular 1 -> other wins -> dropped. Gaseous H2: hydrogen -> dropped.
  // Blanky: blank fuel 2 > regular 1 -> other wins -> dropped.
  // Kept: regular 33. Mutation: other not dropped -> Gaseous or Blanky would appear.
  const r = buildOk([
    rec('Gaseous', 'Cng', 2025, GAS, 15),
    rec('Gaseous', 'Cng', 2025, GAS, 16),
    rec('Gaseous', 'Cng', 2025, REG, 30),
    rec('Gaseous', 'H2', 2025, H2, 60),
    rec('Blanky', 'Mystery', 2025, '', 30),
    rec('Blanky', 'Mystery', 2025, '', 31),
    rec('Blanky', 'Mystery', 2025, REG, 40),
    rec('Solo', 'Kept', 2025, REG, 33),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Solo|Kept:33']);
});

test('D-023 median of an even count is the mean of the middle two, rounded half up (22.5 -> 23)', () => {
  // median(22, 23) = 22.5 -> round half up = 23. Python round(22.5) = 22 (to even), floor gives 22.
  const r = buildOk([
    rec('Dairy', 'Pair', 2025, REG, 22),
    rec('Dairy', 'Pair', 2025, REG, 23),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Dairy|Pair:23']);
});

test('D-023 median: 23.5 rounds up to 24, and an odd count takes the middle value, not min or mean', () => {
  // Half: median(23, 24) = 23.5 -> 24. Floor or banker's rounding on this row gives 23.
  // Trio: median(10, 30, 31) = 30. Min would give 10; the mean 23.67.
  const r = buildOk([
    rec('Dairy', 'Half', 2025, REG, 23),
    rec('Dairy', 'Half', 2025, REG, 24),
    rec('Dairy', 'Trio', 2025, REG, 10),
    rec('Dairy', 'Trio', 2025, REG, 30),
    rec('Dairy', 'Trio', 2025, REG, 31),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Dairy|Half:24,Trio:30']);
});

test('D-023 electric value is the median of 1000 / combE (mi/kWh x 10), not of combE and not of comb08', () => {
  // combE 20 -> 50, combE 25 -> 40; median(40, 50) = 45, suffix e.
  // Mutation: median of combE (22.5) then converted -> 44. Mutation: comb08 used -> 99.
  const r = buildOk([
    rec('Volt', 'Ion', 2025, ELEC, 99, 20),
    rec('Volt', 'Ion', 2025, ELEC, 99, 25),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Volt|Ion:45e']);
});

test('D-023 blank or zero comb08 and combE are skipped; a model with no usable value is dropped', () => {
  // Gas: values '', 0, 30 -> only 30 counts -> "30". Mutation: 0 counted -> median(0, 30) = 15.
  // Ev: combE '', 0, 25 -> only 25 counts -> 1000/25 = 40, "40e". Mutation: 0 counted -> crash.
  // None: regular '' and 0 -> no value -> dropped (Zeroes|None absent).
  const r = buildOk([
    rec('Zeroes', 'Gas', 2025, REG, ''),
    rec('Zeroes', 'Gas', 2025, REG, 0),
    rec('Zeroes', 'Gas', 2025, REG, 30),
    rec('Zeroes', 'Ev', 2025, ELEC, '', ''),
    rec('Zeroes', 'Ev', 2025, ELEC, '', 0),
    rec('Zeroes', 'Ev', 2025, ELEC, '', 25),
    rec('Zeroes', 'None', 2025, REG, ''),
    rec('Zeroes', 'None', 2025, REG, 0),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Zeroes|Ev:40e,Gas:30']);
});

test('D-023 makes merge case-insensitively under the most common spelling (MINI 2 vs Mini 1)', () => {
  // The first row is "Mini", so first-seen spelling would give "Mini". Counts: MINI 2, Mini 1 -> "MINI".
  // Mutation: case-sensitive grouping -> two make entries.
  const r = buildOk([
    rec('Mini', 'Clubman', 2025, REG, 29),
    rec('MINI', 'Cooper', 2025, REG, 30),
    rec('MINI', 'Countryman', 2025, REG, 28),
  ]);
  assert.deepEqual(r.CAR_DATA, ['MINI|Clubman:29,Cooper:30,Countryman:28']);
});

test('D-023 a make spelling tie (Ford 1, FORD 1) goes to the smallest string, "FORD"', () => {
  // "FORD" < "Ford" by codepoint ('O' 79 < 'o' 111). Ford is the first row, so first-seen would differ.
  const r = buildOk([
    rec('Ford', 'Escape', 2025, REG, 25),
    rec('FORD', 'Bronco', 2025, REG, 22),
  ]);
  assert.deepEqual(r.CAR_DATA, ['FORD|Bronco:22,Escape:25']);
});

test('D-023 commas, colons and bars in names become spaces, and whitespace collapses', () => {
  // "Test, Motors" -> "Test Motors". "Gran:  Turismo|GT" -> "Gran Turismo GT".
  // "  Club,  Wagon " -> "Club Wagon". Mutation: name kept raw -> the ',' and ':' break the packed string.
  const r = buildOk([
    rec('Test, Motors', 'Gran:  Turismo|GT', 2025, REG, 20),
    rec('Test, Motors', '  Club,  Wagon ', 2025, REG, 22),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Test Motors|Club Wagon:22,Gran Turismo GT:20']);
});

test('D-023 makes and models sort by codepoint: "BMW" before "Bentley", "Zeta" before "alpha"', () => {
  // 'M' (77) < 'e' (101), so BMW < Bentley. 'Z' (90) < 'a' (97), so Zeta < alpha.
  // Mutation: case-insensitive sort -> Bentley before BMW and alpha before Zeta.
  const r = buildOk([
    rec('Bentley', 'alpha', 2025, REG, 31),
    rec('Bentley', 'Zeta', 2025, REG, 30),
    rec('BMW', 'X3', 2025, REG, 25),
    rec('Acura', 'X', 2025, REG, 20),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Acura|X:20', 'BMW|X3:25', 'Bentley|Zeta:30,alpha:31']);
});

test('D-023 output is byte-identical on a rerun with the same input', () => {
  const rows = [
    rec('Lexus', 'RX', 2025, PREM, 30),
    rec('Lexus', 'RX', 2025, REG, 25),
    rec('Volt', 'Ion', 2025, ELEC, '', 25),
    rec('Ford', 'Escape', 2024, REG, 22),
  ];
  const a = buildOk(rows);
  const b = buildOk(rows);
  assert.ok(a.text.includes('POD.data.CAR_DATA'), 'output should assign POD.data.CAR_DATA');
  assert.equal(a.text, b.text);
});

test('D-023 records with a blank or non-numeric year, a blank make or a blank model are skipped', () => {
  // Only the first row is valid: Car median 30. Rows with '', 'TBD' years, a blank make or a blank
  // model would otherwise add 90, 60, 80, 70 and move the median.
  const r = buildOk([
    rec('Solo', 'Car', 2025, REG, 30),
    rec('Solo', 'Car', '', REG, 90),
    rec('Solo', 'Car', 'TBD', REG, 60),
    rec('', 'Car', 2025, REG, 80),
    rec('Solo', '', 2025, REG, 70),
  ]);
  assert.deepEqual(r.CAR_DATA, ['Solo|Car:30']);
});

test('D-023 a zip without vehicles.csv is refused with a message and exit status 1', () => {
  const r = runBuild([rec('Solo', 'Car', 2025, REG, 30)], { csvName: 'other.csv' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /vehicles\.csv not found in zip/);
});

test('D-023 an --as-of that is not YYYY-MM-DD is refused with exit status 1', () => {
  const r = runBuild([rec('Solo', 'Car', 2025, REG, 30)], { asOf: '2026-11-6' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--as-of must be YYYY-MM-DD/);
});

// ---- D-037: CAR_YEARS -------------------------------------------------------------------------
//
// One fixture for the D-037 tests, run with --since 2000 --years-since 2000 unless a test says
// otherwise. Hand-worked values are in each test. The model names and years are invented.

const YEARS_FIXTURE = [
  // Alpha: 2001-2003 = 20; 2004-2005 = 22; 2006 has no record; 2007 = 22.
  rec('Acme', 'Alpha', 2001, REG, 20),
  rec('Acme', 'Alpha', 2002, REG, 20),
  rec('Acme', 'Alpha', 2003, REG, 20),
  rec('Acme', 'Alpha', 2004, REG, 22),
  rec('Acme', 'Alpha', 2005, REG, 22),
  rec('Acme', 'Alpha', 2007, REG, 22),
  // Bravo: 2019 regular 30 (one record); 2020 electric, combE 25 -> 1000/25 = 40.
  rec('Acme', 'Bravo', 2019, REG, 30),
  rec('Acme', 'Bravo', 2020, ELEC, '', 25),
  // Charlie: 2011 = 25; 2012 natural gas 2 > regular 1 -> no figure; 2013 = 25;
  // 2014 regular with blank comb08 -> no usable value -> no figure; 2015 = 25.
  rec('Acme', 'Charlie', 2011, REG, 25),
  rec('Acme', 'Charlie', 2012, GAS, 15),
  rec('Acme', 'Charlie', 2012, GAS, 16),
  rec('Acme', 'Charlie', 2012, REG, 25),
  rec('Acme', 'Charlie', 2013, REG, 25),
  rec('Acme', 'Charlie', 2014, REG, ''),
  rec('Acme', 'Charlie', 2015, REG, 25),
  // Echo: a 1999 record (before --years-since 2000) and 2000-2001 at 26. 1999 is left out.
  rec('Acme', 'Echo', 1999, REG, 40),
  rec('Acme', 'Echo', 2000, REG, 26),
  rec('Acme', 'Echo', 2001, REG, 26),
  // Foxtrot: only a 1999 record -> absent everywhere.
  rec('Acme', 'Foxtrot', 1999, REG, 40),
  // Hotel: 2016-2017 premium 30; 2018 regular 30 -> the suffix change splits the runs.
  rec('Acme', 'Hotel', 2016, PREM, 30),
  rec('Acme', 'Hotel', 2017, PREM, 30),
  rec('Acme', 'Hotel', 2018, REG, 30),
  // Zulu is spelled "ACME" once; "Acme" has most records, so the make is "Acme".
  rec('ACME', 'Zulu', 2002, REG, 18),
  // Oldcar: only 1999 records -> no make at all.
  rec('Oldcar', 'Relic', 1999, REG, 20),
  // Zeno Ion: 2021 electric combE 25 -> 40; 2022 combE 20 -> 50 and combE 25 -> 40, median 45.
  rec('Zeno', 'Ion', 2021, ELEC, '', 25),
  rec('Zeno', 'Ion', 2022, ELEC, '', 20),
  rec('Zeno', 'Ion', 2022, ELEC, '', 25),
];

const RUN = '\\d+[*de]?@\\d{4}(?:-\\d{4})?';
const ROW_RE = new RegExp(
  '^[^|,:]+\\|[^|,:]+:' + RUN + '(?: ' + RUN + ')*' +
  '(?:,[^|,:]+:' + RUN + '(?: ' + RUN + ')*)*$'
);
const RUN_RE = /^(\d+)([*de]?)@(\d{4})(?:-(\d{4}))?$/;

function parseRun(s) {
  const m = RUN_RE.exec(s);
  if (!m) return { bad: s };
  const first = Number(m[3]);
  return {
    value: Number(m[1]),
    suffix: m[2],
    first,
    last: m[4] === undefined ? first : Number(m[4]),
    hasRange: m[4] !== undefined,
  };
}

/** The runs string for make/model in a packed CAR_YEARS list, or undefined. */
function yearsCell(years, make, model) {
  for (const row of years) {
    const bar = row.indexOf('|');
    if (row.slice(0, bar) !== make) continue;
    for (const m of row.slice(bar + 1).split(',')) {
      const c = m.indexOf(':');
      if (m.slice(0, c) === model) return m.slice(c + 1);
    }
  }
  return undefined;
}

test('D-037 CAR_YEARS: runs are newest first, equal neighbours merge, and a missing year splits the runs', () => {
  // Alpha: 2007 = 22 (2006 has no record, so it splits); 2004-2005 = 22; 2001-2003 = 20.
  // Mutation: no split at the gap -> "22@2004-2007 20@2001-2003". Oldest first -> reversed order.
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Alpha'), '22@2007 22@2004-2005 20@2001-2003');
});

test('D-037 CAR_YEARS: each model year uses only that year\'s records', () => {
  // Bravo 2019: regular 30 -> "30@2019" (single year, no range). 2020: electric, 1000/25 = 40 -> "40e@2020".
  // Mutation: the 2020 figure uses the 2019 records too -> the fuel/value change.
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Bravo'), '40e@2020 30@2019');
});

test('D-037 CAR_YEARS: a year with other fuel or no usable value splits the runs', () => {
  // Charlie 2012: natural gas 2 beats regular 1 -> no figure. 2014: regular with blank comb08 -> no figure.
  // 2011, 2013 and 2015 are all 25 regular. Mutation: 2012 takes regular's 25 -> "25@2011-2013" merges.
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Charlie'), '25@2015 25@2013 25@2011');
});

test('D-037 CAR_YEARS: a change of suffix splits a run, and the premium year keeps its *', () => {
  // Hotel 2016-2017 premium 30 -> "30*@2016-2017". 2018 regular 30 -> "30@2018".
  // Mutation: suffix ignored when merging -> "30@2016-2018".
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Hotel'), '30@2018 30*@2016-2017');
});

test('D-037 CAR_YEARS: years before --years-since are left out; a model with only older records is absent', () => {
  // Echo: 1999 (40) is before 2000 and is left out -> "26@2000-2001". Mutation: 1999 kept -> "26@2000-2001 40@1999".
  // Foxtrot has only 1999 records: absent. Oldcar has only 1999 records: no make at all.
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Echo'), '26@2000-2001');
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Foxtrot'), undefined);
  assert.equal(yearsCell(r.CAR_YEARS, 'Oldcar', 'Relic'), undefined);
  assert.ok(!r.CAR_YEARS.some((row) => row.startsWith('Oldcar|')), 'no empty or old-only make');
});

test('D-037 CAR_YEARS: electric figures are per year, mi/kWh x 10 with e; 2021 and 2022 differ', () => {
  // Zeno Ion 2021: combE 25 -> 40 -> "40e". 2022: combE 20 -> 50 and 25 -> 40, median 45 -> "45e".
  // Newest first: "45e@2022 40e@2021". Mutation: 2022 uses the 2021 record too -> different median.
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(yearsCell(r.CAR_YEARS, 'Zeno', 'Ion'), '45e@2022 40e@2021');
});

test('D-037 CAR_YEARS: a model below --since is kept in CAR_YEARS and dropped from CAR_DATA', () => {
  // With --since 2010: Alpha (latest 2007) and Zulu (2002) are below it, so not in CAR_DATA.
  // CAR_YEARS keeps every model with a record in 2000 or later, so Alpha's runs are still there.
  const r = buildOk(YEARS_FIXTURE, { since: 2010, yearsSince: 2000 });
  assert.equal(carCell(r.CAR_DATA, 'Acme', 'Alpha'), undefined);
  assert.equal(carCell(r.CAR_DATA, 'Acme', 'Zulu'), undefined);
  assert.equal(carCell(r.CAR_DATA, 'Acme', 'Charlie'), '25');
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Alpha'), '22@2007 22@2004-2005 20@2001-2003');
  assert.equal(yearsCell(r.CAR_YEARS, 'Acme', 'Zulu'), '18@2002');
});

test('D-037 CAR_YEARS: make spellings match CAR_DATA ("Acme", not "ACME"), and no entry is empty', () => {
  // Every CAR_DATA make appears in CAR_YEARS with the same spelling. Zulu sits under "Acme".
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  const yearMakes = r.CAR_YEARS.map((row) => row.slice(0, row.indexOf('|')));
  assert.ok(!yearMakes.includes('ACME'), 'make spelled ACME in CAR_YEARS');
  assert.equal(yearMakes.length, new Set(yearMakes).size, 'makes unique');
  for (const row of r.CAR_DATA) {
    assert.ok(yearMakes.includes(row.slice(0, row.indexOf('|'))), 'CAR_DATA make missing from CAR_YEARS: ' + row);
  }
  for (const row of r.CAR_YEARS) {
    const bar = row.indexOf('|');
    assert.ok(bar > 0, 'empty make: ' + row);
    assert.ok(row.length > bar + 1, 'no models: ' + row);
    assert.ok(!row.slice(bar + 1).split(',').some((m) => m.endsWith(':') || m.startsWith(':')), 'empty entry: ' + row);
  }
});

test('D-037 CAR_YEARS: the newest run of each CAR_DATA model equals its CAR_DATA value and suffix, and ends at its latest year', () => {
  // Hand-worked latest years: Alpha 2007, Bravo 2020, Charlie 2015, Echo 2001, Hotel 2018, Zulu 2002, Zeno Ion 2022.
  const LATEST = { 'Acme|Alpha': 2007, 'Acme|Bravo': 2020, 'Acme|Charlie': 2015, 'Acme|Echo': 2001,
    'Acme|Hotel': 2018, 'Acme|Zulu': 2002, 'Zeno|Ion': 2022 };
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  const seen = new Set();
  for (const row of r.CAR_DATA) {
    const bar = row.indexOf('|');
    const make = row.slice(0, bar);
    for (const m of row.slice(bar + 1).split(',')) {
      const c = m.indexOf(':');
      const model = m.slice(0, c);
      const cell = m.slice(c + 1);
      const runs = yearsCell(r.CAR_YEARS, make, model).split(' ').map(parseRun);
      const newest = runs[0];
      const key = make + '|' + model;
      seen.add(key);
      assert.equal(String(newest.value) + newest.suffix, cell, key + ' newest run value/suffix');
      assert.equal(newest.last, LATEST[key], key + ' newest run ends at latest year');
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(LATEST).sort());
});

test('D-037 CAR_YEARS: every row matches the grammar, runs are newest first, and they do not overlap', () => {
  // Grammar: "Make|Model:runs,Model:runs"; a run is value, optional suffix, '@', first year,
  // then '-last' only for a range (a single year has none, and "2003-2003" is refused).
  const r = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.ok(r.CAR_YEARS.length > 0);
  for (const row of r.CAR_YEARS) {
    assert.match(row, ROW_RE, 'grammar: ' + row);
    const bar = row.indexOf('|');
    for (const m of row.slice(bar + 1).split(',')) {
      const runs = m.slice(m.indexOf(':') + 1).split(' ').map(parseRun);
      for (const run of runs) {
        assert.ok(!run.bad, 'bad run ' + run.bad);
        assert.ok(run.first <= run.last, 'first year after last: ' + row);
        if (run.hasRange) assert.ok(run.last > run.first, 'single year written as a range: ' + row);
      }
      for (let i = 1; i < runs.length; i++) {
        assert.ok(runs[i - 1].first > runs[i].last, 'runs out of order or overlapping: ' + row);
      }
    }
  }
});

test('D-037 CAR_YEARS: a rerun with the same input is byte-identical', () => {
  const a = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  const b = buildOk(YEARS_FIXTURE, { since: 2000, yearsSince: 2000 });
  assert.equal(a.text, b.text);
  assert.ok(a.CAR_YEARS.length > 0, 'CAR_YEARS must be written');
});
