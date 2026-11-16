// ISS-011 tools/build-states.py: the generator's rules, run offline on hand-written EIA pages.
// Every series the script asks for (4 U.S. + 7 regional + 9 state = 20) has a page in a temp cache,
// so no test reaches the network. Fixture numbers are invented; every expected value is worked out
// by hand from the fixture below (the arithmetic is in the comments). The generator is never run to
// produce an expected value.
//
// Base fixture (tests/fixtures/build-states/ holds only the copied tax CSV):
//   chosen week W = 2026-01-05 (latest date in the U.S. regular series); prior week P = 2025-12-29.
//   Each regional and state series has a distinct P value, so a value taken from the wrong week shows.
//   PADD 5X (AK AZ HI NV OR) has W = 3.400; WA's own series has W = 4.100; TX's own series has W = 2.500
//   while its PADD 3 series has W = 2.990, so TX shows whether the state series was used.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { APP_ROOT } = require('../helpers/load');

const SCRIPT = path.join(APP_ROOT, 'tools', 'build-states.py');
const FIXTURE_TAX = path.join(APP_ROOT, 'tests', 'fixtures', 'build-states', 'state-tax.csv');
const AS_OF = '2026-01-06';
const WEEK = '2026-01-05';

// The 20 series the script requests, by EIA id (4 U.S., 7 regional, 9 state).
const ALL_SIDS = [
  'EMM_EPMR_PTE_NUS_DPG', 'EMM_EPMM_PTE_NUS_DPG', 'EMM_EPMP_PTE_NUS_DPG', 'EMD_EPD2D_PTE_NUS_DPG',
  'EMM_EPMR_PTE_R1X_DPG', 'EMM_EPMR_PTE_R1Y_DPG', 'EMM_EPMR_PTE_R1Z_DPG', 'EMM_EPMR_PTE_R20_DPG',
  'EMM_EPMR_PTE_R30_DPG', 'EMM_EPMR_PTE_R40_DPG', 'EMM_EPMR_PTE_R5XCA_DPG',
  'EMM_EPMR_PTE_SCA_DPG', 'EMM_EPMR_PTE_SCO_DPG', 'EMM_EPMR_PTE_SFL_DPG', 'EMM_EPMR_PTE_SMA_DPG',
  'EMM_EPMR_PTE_SMN_DPG', 'EMM_EPMR_PTE_SNY_DPG', 'EMM_EPMR_PTE_SOH_DPG', 'EMM_EPMR_PTE_STX_DPG',
  'EMM_EPMR_PTE_SWA_DPG',
];

/** An EIA-style history page: a <title> and rows of [label, [[MM/DD, value], ...]]. */
function page(title, rows) {
  const body = rows.map(([label, pairs]) => {
    const cells = [`<td class='B6'>&nbsp;&nbsp;${label}</td>`];
    for (const [md, v] of pairs) {
      cells.push(`<td class='B5'>${md}&nbsp;</td>`);
      cells.push(`<td class='B3'>${v}&nbsp;&nbsp;&nbsp;</td>`);
    }
    return `<tr>\n ${cells.join('\n ')}</tr>`;
  }).join('\n');
  return `<!DOCTYPE HTML PUBLIC '-//W3C//DTD HTML 4.01 Transitional//EN'>\n<html>\n<head>\n` +
    `<title>${title}</title>\n</head>\n<body>\n<table>\n<tr><th>Month</th><th>Week</th></tr>\n` +
    `${body}\n</table>\n</body>\n</html>\n`;
}

const BASE = {
  // U.S. grade series (titles contain the fragments US_SERIES expects).
  EMM_EPMR_PTE_NUS_DPG: page('Weekly U.S. Regular All Formulations Retail Gasoline Prices  (Dollars per Gallon)', [
    ['2025-Dec', [['12/29', '3.050']]],
    ['2026-Jan', [['01/05', '3.100']]],
  ]),
  // Midgrade W 3.545 - regular W 3.100 = 0.445 (half-up 0.45; half-even would give 0.44).
  EMM_EPMM_PTE_NUS_DPG: page('Weekly U.S. Midgrade Retail Gasoline Prices (Dollars per Gallon)', [
    ['2025-Dec', [['12/29', '3.000']]],
    ['2026-Jan', [['01/05', '3.545']]],
  ]),
  // Premium W 3.600 - regular W 3.100 = 0.500. Prior-week premium 3.040 would give -0.01 instead.
  EMM_EPMP_PTE_NUS_DPG: page('Weekly U.S. Premium Retail Gasoline Prices (Dollars per Gallon)', [
    ['2025-Dec', [['12/29', '3.040']]],
    ['2026-Jan', [['01/05', '3.600']]],
  ]),
  // Diesel W 3.345 - regular W 3.100 = 0.245 (half-up 0.25; half-even would give 0.24).
  EMD_EPD2D_PTE_NUS_DPG: page('U.S. No 2 Diesel Retail Prices (Dollars per Gallon)', [
    ['2025-Dec', [['12/29', '3.500']]],
    ['2026-Jan', [['01/05', '3.345']]],
  ]),
  // PADD 1A: the 2025-Jan row (listed after 2026-Jan) must keep its own year, so 01/05 2026 is 3.110, not 9.999.
  EMM_EPMR_PTE_R1X_DPG: page('Weekly New England (PADD 1A) Retail Gasoline Prices', [
    ['2026-Jan', [['01/05', '3.110']]],
    ['2025-Dec', [['12/29', '3.010']]],
    ['2025-Jan', [['01/05', '9.999']]],
  ]),
  EMM_EPMR_PTE_R1Y_DPG: page('Weekly Central Atlantic (PADD 1B) Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.020']]],
    ['2026-Jan', [['01/05', '3.120']]],
  ]),
  EMM_EPMR_PTE_R1Z_DPG: page('Weekly Lower Atlantic (PADD 1C) Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.030']]],
    ['2026-Jan', [['01/05', '3.130']]],
  ]),
  // PADD 2: W value is padded (&nbsp;); later weeks hold NA, W and an empty cell, all skipped.
  EMM_EPMR_PTE_R20_DPG: page('Weekly Midwest Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '2.950']]],
    ['2026-Jan', [['01/05', '3.140'], ['01/12', 'NA'], ['01/19', 'W'], ['01/26', '']]],
  ]),
  EMM_EPMR_PTE_R30_DPG: page('Weekly Gulf Coast Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '2.900']]],
    ['2026-Jan', [['01/05', '2.990']]],
  ]),
  EMM_EPMR_PTE_R40_DPG: page('Weekly Rocky Mountain Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.100']]],
    ['2026-Jan', [['01/05', '3.200']]],
  ]),
  EMM_EPMR_PTE_R5XCA_DPG: page('Weekly West Coast (PADD 5) Except California Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.300']]],
    ['2026-Jan', [['01/05', '3.400']]],
  ]),
  EMM_EPMR_PTE_SCA_DPG: page('Weekly California Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.900']]],
    ['2026-Jan', [['01/05', '4.000']]],
  ]),
  EMM_EPMR_PTE_SCO_DPG: page('Weekly Colorado Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.000']]],
    ['2026-Jan', [['01/05', '3.105']]],
  ]),
  EMM_EPMR_PTE_SFL_DPG: page('Weekly Florida Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '2.800']]],
    ['2026-Jan', [['01/05', '3.000']]],
  ]),
  EMM_EPMR_PTE_SMA_DPG: page('Weekly Massachusetts Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.300']]],
    ['2026-Jan', [['01/05', '3.400']]],
  ]),
  EMM_EPMR_PTE_SMN_DPG: page('Weekly Minnesota Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '2.950']]],
    ['2026-Jan', [['01/05', '3.050']]],
  ]),
  EMM_EPMR_PTE_SNY_DPG: page('Weekly New York Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '3.450']]],
    ['2026-Jan', [['01/05', '3.500']]],
  ]),
  EMM_EPMR_PTE_SOH_DPG: page('Weekly Ohio Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '2.900']]],
    ['2026-Jan', [['01/05', '2.950']]],
  ]),
  EMM_EPMR_PTE_STX_DPG: page('Weekly Texas Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '2.400']]],
    ['2026-Jan', [['01/05', '2.500']]],
  ]),
  EMM_EPMR_PTE_SWA_DPG: page('Weekly Washington Regular Retail Gasoline Prices', [
    ['2025-Dec', [['12/29', '4.050']]],
    ['2026-Jan', [['01/05', '4.100']]],
  ]),
};

// Expected STATES gas at W, worked out by hand from the base fixture. PADD membership is the
// generator's STATES list (per EIA's PADD glossary): 1A CT ME NH RI VT; 1B DE DC MD NJ PA;
// 1C GA NC SC VA WV; 2 IL IN IA KS KY MI MO NE ND OK SD TN WI; 3 AL AR LA MS NM; 4 ID MT UT WY;
// 5X AK AZ HI NV OR. The nine state-series states use their own series. 5+5+5+13+5+4+5+9 = 51.
const AT_WEEK = {
  CT: 3.110, ME: 3.110, NH: 3.110, RI: 3.110, VT: 3.110, // 1A W
  DE: 3.120, DC: 3.120, MD: 3.120, NJ: 3.120, PA: 3.120, // 1B W
  GA: 3.130, NC: 3.130, SC: 3.130, VA: 3.130, WV: 3.130, // 1C W
  IL: 3.140, IN: 3.140, IA: 3.140, KS: 3.140, KY: 3.140, MI: 3.140, MO: 3.140, // PADD 2 W
  NE: 3.140, ND: 3.140, OK: 3.140, SD: 3.140, TN: 3.140, WI: 3.140,
  AL: 2.990, AR: 2.990, LA: 2.990, MS: 2.990, NM: 2.990, // PADD 3 W
  ID: 3.200, MT: 3.200, UT: 3.200, WY: 3.200, // PADD 4 W
  AK: 3.400, AZ: 3.400, HI: 3.400, NV: 3.400, OR: 3.400, // PADD 5X W
  CA: 4.000, CO: 3.105, FL: 3.000, MA: 3.400, MN: 3.050, NY: 3.500, OH: 2.950, TX: 2.500, WA: 4.100, // own series W
};

const PADD2_CODES = ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'WI'];

/** Writes one page per series into dir. Overrides replace base pages by series id. */
function writeCache(dir, overrides) {
  fs.mkdirSync(dir, { recursive: true });
  const pages = Object.assign({}, BASE, overrides);
  for (const sid of ALL_SIDS) {
    // Every series must be present, or the script would try the network.
    assert.ok(typeof pages[sid] === 'string', `fixture missing page for ${sid}`);
    fs.writeFileSync(path.join(dir, `eia_${sid}.htm`), pages[sid]);
  }
}

/** Runs the generator once. Returns { ok, status, stdout, stderr }. */
function runScript({ cache, tax, out, asOf }) {
  try {
    const stdout = execFileSync('python3', [
      '-I', SCRIPT, '--as-of', asOf, '--cache', cache, '--tax', tax, '--out', out,
    ], { cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    return { ok: true, status: 0, stdout: String(stdout), stderr: '' };
  } catch (err) {
    return { ok: false, status: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}

/** Reads the written states.js: STATES, GRADE_ADD, GAS_WEEK, header text and the Nulls line. */
function readOutput(src) {
  const sb = { POD: { data: {} } };
  vm.runInNewContext(src, sb);
  const nulls = /^ \* Nulls:\s+(.*)$/m.exec(src);
  return {
    header: src.slice(0, src.indexOf('*/') + 2),
    nulls: nulls ? nulls[1] : null,
    STATES: structuredClone(sb.POD.data.STATES),
    GRADE_ADD: structuredClone(sb.POD.data.GRADE_ADD),
    GAS_WEEK: sb.POD.data.GAS_WEEK,
  };
}

/** Builds states.js from a fixture cache in a temp dir, and reads it back before cleanup. */
function generate(overrides = {}, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-states-'));
  try {
    const cache = path.join(tmp, 'cache');
    const out = path.join(tmp, 'states.js');
    writeCache(cache, overrides);
    const run = runScript({ cache, tax: opts.tax || FIXTURE_TAX, out, asOf: AS_OF });
    const res = { ok: run.ok, status: run.status, stdout: run.stdout, stderr: run.stderr, outExists: fs.existsSync(out) };
    if (run.ok) Object.assign(res, readOutput(fs.readFileSync(out, 'utf8')));
    return res;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** code -> gas, from a STATES array. */
function gasMap(rows) {
  const m = {};
  for (const r of rows) m[r[0]] = r[2];
  return m;
}

/** AT_WEEK with the listed codes set to null. */
function withNulls(codes) {
  const m = Object.assign({}, AT_WEEK);
  for (const c of codes) m[c] = null;
  return m;
}

/** Writes a tax CSV in a temp dir from a text transform, and returns its path. */
function taxVariant(tmp, transform) {
  const p = path.join(tmp, 'tax.csv');
  fs.writeFileSync(p, transform(fs.readFileSync(FIXTURE_TAX, 'utf8')), 'utf8');
  return p;
}

/** Runs generate() with a tax CSV variant, in a temp dir that is cleaned up. */
function generateWithTax(transform) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-states-tax-'));
  try {
    return generate({}, { tax: taxVariant(tmp, transform) });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('ISS-011 happy path: a complete set of fixture pages builds 51 rows, exits 0, and the Nulls line says none', () => {
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.STATES.length, 51);
  assert.equal(r.nulls, 'none');
  assert.match(r.header, /week ending 2026-01-05/);
});

test('D-022 the week is the latest date in the U.S. regular series, not a later date in another grade series', () => {
  // Midgrade has an extra 01/12 value (3.700). If the week were the latest date in any series, the
  // U.S. regular value for that week is missing and every state would be null.
  const r = generate({
    EMM_EPMM_PTE_NUS_DPG: page('Weekly U.S. Midgrade Retail Gasoline Prices (Dollars per Gallon)', [
      ['2025-Dec', [['12/29', '3.000']]],
      ['2026-Jan', [['01/05', '3.545'], ['01/12', '3.700']]],
    ]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.header, /week ending 2026-01-05/);
  assert.deepEqual(gasMap(r.STATES), AT_WEEK);
});

test('D-022 the STATES gas values for all 51 rows come from the chosen week only (not the prior week P)', () => {
  // Each expected value is the W entry of AT_WEEK. A prior-week value would be off by 0.05 to 0.10.
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(gasMap(r.STATES), AT_WEEK);
});

test('D-022 a regional series without the week gives null for its states, never an older week, and the Nulls line names them', () => {
  // PADD 5X has only 2025-12-29 (3.300). Its states AK AZ HI NV OR must be null, not 3.300.
  const r = generate({
    EMM_EPMR_PTE_R5XCA_DPG: page('Weekly West Coast (PADD 5) Except California Retail Gasoline Prices', [
      ['2025-Dec', [['12/29', '3.300']]],
    ]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(gasMap(r.STATES), withNulls(['AK', 'AZ', 'HI', 'NV', 'OR']));
  assert.equal(r.nulls, 'gasRegular null for AK, AZ, HI, NV, OR (EIA series missing for week 2026-01-05)');
  assert.match(r.stdout, /EMM_EPMR_PTE_R5XCA_DPG: no value for week 2026-01-05/);
});

test('D-022 a state series without the week gives null for that state, not its older week or its PADD value', () => {
  // WA has only 2025-12-29 (4.050). Its PADD 5X value is 3.400 at W, so a PADD fallback would show 3.400.
  const r = generate({
    EMM_EPMR_PTE_SWA_DPG: page('Weekly Washington Regular Retail Gasoline Prices', [
      ['2025-Dec', [['12/29', '4.050']]],
    ]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(gasMap(r.STATES), withNulls(['WA']));
  assert.equal(r.nulls, 'gasRegular null for WA (EIA series missing for week 2026-01-05)');
});

test('ISS-011 a regional series whose title lacks its fragment gives null for its states, and a PROBLEM line', () => {
  // R20's title is not "Midwest", so PADD 2 is rejected. Its states must be null, the rest unchanged.
  const r = generate({
    EMM_EPMR_PTE_R20_DPG: page('Weekly Mountain Region Retail Gasoline Prices', [
      ['2026-Jan', [['01/05', '3.140']]],
    ]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(gasMap(r.STATES), withNulls(PADD2_CODES));
  assert.match(r.nulls, /^gasRegular null for IL, IN, IA, KS, KY, MI, MO, NE, ND, OK, SD, TN, WI \(/);
  assert.match(r.stdout, /PROBLEM: EMM_EPMR_PTE_R20_DPG: title .* does not contain 'Midwest'/);
});

test('ISS-011 a state series whose title lacks its fragment gives null for that state, not its PADD value', () => {
  // TX's page is titled for Oklahoma. TX must be null; PADD 3 (2.990 at W) must not stand in for it.
  const r = generate({
    EMM_EPMR_PTE_STX_DPG: page('Weekly Oklahoma Retail Gasoline Prices', [
      ['2026-Jan', [['01/05', '2.500']]],
    ]),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(gasMap(r.STATES).TX, null);
  assert.deepEqual(gasMap(r.STATES), withNulls(['TX']));
  assert.match(r.nulls, /^gasRegular null for TX \(/);
});

test('ISS-011 a YYYY-Mon row label sets the year of its MM/DD cells', () => {
  // PADD 1A lists 2026-Jan before 2025-Jan. The 2025-Jan 01/05 cell is 9.999 and must not replace 2026-01-05.
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  const gas = gasMap(r.STATES);
  assert.equal(gas.CT, 3.110);
  assert.equal(gas.VT, 3.110);
  assert.equal(r.STATES.some((row) => row[2] === 9.999), false);
});

test('ISS-011 &nbsp;-padded values parse, empty and NA/W cells are skipped, and NA at the chosen week gives null', () => {
  // OH's own series has NA at 01/05 and 2.900 at 12/29. The NA week must be null, not 2.900.
  // Midwest's padded 3.140 must parse; its NA, W and empty cells must not break the parse.
  const r = generate({
    EMM_EPMR_PTE_SOH_DPG: page('Weekly Ohio Regular Retail Gasoline Prices', [
      ['2025-Dec', [['12/29', '2.900']]],
      ['2026-Jan', [['01/05', 'NA']]],
    ]),
  });
  assert.equal(r.status, 0, r.stderr);
  const gas = gasMap(r.STATES);
  assert.equal(gas.OH, null);
  assert.equal(gas.IL, 3.140);
  assert.match(r.nulls, /^gasRegular null for OH \(/);
});

test('D-022 a state with its own series uses it, not its PADD: TX is 2.500 (own), not 2.990 (PADD 3)', () => {
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  const tx = r.STATES.find((row) => row[0] === 'TX');
  assert.equal(tx[2], 2.500);
  assert.notEqual(tx[2], 2.990);
  const al = r.STATES.find((row) => row[0] === 'AL');
  assert.equal(al[2], 2.990);
});

test('D-022 GRADE_ADD rounds exact .xx5 values half up: 3.545 - 3.100 = 0.445 gives 0.45, 3.345 - 3.100 = 0.245 gives 0.25', () => {
  // Half-even would give 0.44 and 0.24. Half-up gives 0.45 and 0.25.
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.GRADE_ADD.midgrade, 0.45);
  assert.equal(r.GRADE_ADD.diesel, 0.25);
});

test('D-022 GRADE_ADD is the U.S. grade minus U.S. regular for the chosen week: premium 3.600 - 3.100 = 0.50', () => {
  // Prior-week regular (3.050) would give 0.55. Prior-week premium (3.040) would give -0.01.
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.GRADE_ADD.premium, 0.5);
});

test('D-022 a gas value is written exactly as EIA prints it: Colorado 3.105 is not rounded to 3.11 or 3.10', () => {
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  const co = r.STATES.find((row) => row[0] === 'CO');
  assert.equal(co[2], 3.105);
  // The generated line itself carries three decimals.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-states-lit-'));
  try {
    const out = path.join(tmp, 'states.js');
    const cache = path.join(tmp, 'cache');
    writeCache(cache, {});
    const run = runScript({ cache, tax: FIXTURE_TAX, out, asOf: AS_OF });
    assert.equal(run.ok, true, run.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /\["CO", "Colorado", 3\.105, 7\.89\]/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D-022 tax comes from the CSV: AL 9.46, AK 1.82, CA 9.03, DC 10.0 (meal), NH 8.5 (meal), TX 8.20; Nulls says none', () => {
  // Values copied from tools/data/state-tax.csv (its taxPct column).
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  const tax = {};
  for (const row of r.STATES) tax[row[0]] = row[3];
  assert.equal(tax.AL, 9.46);
  assert.equal(tax.AK, 1.82);
  assert.equal(tax.CA, 9.03);
  assert.equal(tax.DC, 10);
  assert.equal(tax.NH, 8.5);
  assert.equal(tax.TX, 8.2);
  assert.equal(r.nulls, 'none');
});

test('ISS-011 a duplicate tax code exits non-zero with the duplicate message', () => {
  const r = generateWithTax((csv) => csv + 'AL,9.46,combined,https://taxfoundation.org/data/all/state/2026-sales-tax-rates-midyear/,2026-07-01,duplicate row\n');
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /duplicate tax row AL/);
  assert.equal(r.outExists, false);
});

test('ISS-011 a bad tax kind exits non-zero with the bad-kind message', () => {
  const r = generateWithTax((csv) => csv.replace(/^AL,([^,]*),combined,/m, 'AL,$1,snack,'));
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bad kind for AL: snack/);
  assert.equal(r.outExists, false);
});

test('ISS-011 a missing state code (50 tax rows) exits non-zero with the code-mismatch message', () => {
  const r = generateWithTax((csv) => csv.replace(/^AL,.*\n/m, ''));
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tax CSV codes do not match the 51 STATES rows/);
  assert.equal(r.outExists, false);
});

test('D-022 an empty taxPct gives null for that state and names it in the Nulls line', () => {
  const r = generateWithTax((csv) => csv.replace(/^AL,[^,]*,/m, 'AL,,'));
  assert.equal(r.status, 0, r.stderr);
  const al = r.STATES.find((row) => row[0] === 'AL');
  assert.equal(al[3], null);
  assert.equal(al[2], 2.990);
  assert.equal(r.nulls, 'mealTaxPct null for AL (no sourced rate; see tools/data/state-tax.csv note and docs/issues.md)');
});

test('ISS-011 a U.S. regular series with a title mismatch exits 1 with FATAL on stderr and writes no output', () => {
  const r = generate({
    EMM_EPMR_PTE_NUS_DPG: page('Weekly Something Else Entirely', [
      ['2026-Jan', [['01/05', '3.100']]],
    ]),
  });
  assert.equal(r.ok, false, 'generator should exit non-zero');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FATAL: U\.S\. regular series unavailable/);
  assert.match(r.stderr, /EMM_EPMR_PTE_NUS_DPG: title/);
  assert.equal(r.outExists, false);
});

test('ISS-011 rows are sorted by code (51 of them), and a second run on the same inputs is byte-identical', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-states-det-'));
  try {
    const cache = path.join(tmp, 'cache');
    writeCache(cache, {});
    const out1 = path.join(tmp, 'a.js');
    const out2 = path.join(tmp, 'b.js');
    const first = runScript({ cache, tax: FIXTURE_TAX, out: out1, asOf: AS_OF });
    const second = runScript({ cache, tax: FIXTURE_TAX, out: out2, asOf: AS_OF });
    assert.equal(first.ok, true, first.stderr);
    assert.equal(second.ok, true, second.stderr);
    assert.ok(fs.readFileSync(out1).equals(fs.readFileSync(out2)), 'two runs differ');
    const { STATES } = readOutput(fs.readFileSync(out1, 'utf8'));
    const codes = STATES.map((row) => row[0]);
    assert.equal(codes.length, 51);
    assert.deepEqual(codes, codes.slice().sort());
    assert.equal(new Set(codes).size, 51);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('D-039 the output assigns POD.data.GAS_WEEK to the chosen week as a YYYY-MM-DD string, and the header still names the week', () => {
  const r = generate();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.GAS_WEEK, WEEK);
  assert.match(r.header, /week ending 2026-01-05/);
});
