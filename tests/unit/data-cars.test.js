// §6 + D-023 src/data/cars.js: CAR_DATA, one packed string per make
// ("Make|Model:value[suffix],Model:value[suffix]").

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const REL = 'src/data/cars.js';
const ROW_RE = /^[^|,:]+\|[^|,:]+:\d+[*de]?(,[^|,:]+:\d+[*de]?)*$/;
// Value ranges by suffix: none and '*' are MPG, 'd' is diesel MPG, 'e' is mi/kWh x 10.
const RANGE = { '': [8, 150], '*': [8, 150], d: [15, 60], e: [15, 70] };

let cached = null;
function load() {
  if (!cached) cached = loadData([REL]);
  return cached;
}

function parseRow(row) {
  const bar = row.indexOf('|');
  const make = row.slice(0, bar);
  const models = row
    .slice(bar + 1)
    .split(',')
    .map((m) => {
      const c = m.indexOf(':');
      const v = m.slice(c + 1);
      const suffix = /\d$/.test(v) ? '' : v.slice(-1);
      return { name: m.slice(0, c), suffix, value: parseInt(v, 10) };
    });
  return { make, models };
}

function parsed() {
  return load().CAR_DATA.map(parseRow);
}

function isAscending(list) {
  return list.every((x, i) => i === 0 || list[i - 1] < x);
}

test('§6 src/data/cars.js exists', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, REL)), 'missing src/data/cars.js');
});

test('§6 CAR_DATA is an array of strings in the Make|Model:value format', () => {
  const { CAR_DATA } = load();
  assert.ok(Array.isArray(CAR_DATA), 'CAR_DATA must be an array');
  const bad = CAR_DATA.filter((r) => typeof r !== 'string' || !ROW_RE.test(r));
  assert.deepEqual(bad.slice(0, 5), []);
});

test('D-023 makes are unique and in ascending plain-string order', () => {
  const makes = parsed().map((r) => r.make);
  assert.equal(new Set(makes).size, makes.length, 'makes must be unique');
  assert.ok(isAscending(makes), 'makes must be ascending');
});

test('D-023 models within each make are unique and in ascending order', () => {
  const problems = [];
  for (const { make, models } of parsed()) {
    const names = models.map((m) => m.name);
    if (new Set(names).size !== names.length) problems.push(`${make}: duplicate model`);
    if (!isAscending(names)) problems.push(`${make}: models not ascending`);
  }
  assert.deepEqual(problems, []);
});

test('§6 there are 35 to 60 makes', () => {
  const n = parsed().length;
  assert.ok(n >= 35 && n <= 60, `make count ${n}`);
});

test('§6 there are 280 to 420 models in total', () => {
  const n = parsed().reduce((s, r) => s + r.models.length, 0);
  assert.ok(n >= 280 && n <= 420, `model count ${n}`);
});

test('§6 values fall in the range for their suffix', () => {
  const problems = [];
  for (const { make, models } of parsed()) {
    for (const m of models) {
      const [lo, hi] = RANGE[m.suffix];
      if (!(m.value >= lo && m.value <= hi)) {
        problems.push(`${make} ${m.name}: ${m.value}${m.suffix} outside ${lo}-${hi}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('§6 Toyota Prius has no suffix and a value of at least 45', () => {
  const toyota = parsed().find((r) => r.make === 'Toyota');
  assert.ok(toyota, 'no Toyota make');
  const prius = toyota.models.find((m) => m.name === 'Prius');
  assert.ok(prius, 'no Prius model');
  assert.equal(prius.suffix, '');
  assert.ok(prius.value >= 45, `Prius value ${prius.value}`);
});

test('§6 every Tesla model has suffix e (electric)', () => {
  const tesla = parsed().find((r) => r.make === 'Tesla');
  assert.ok(tesla && tesla.models.length > 0, 'no Tesla models');
  const bad = tesla.models.filter((m) => m.suffix !== 'e').map((m) => m.name);
  assert.deepEqual(bad, []);
});

test('D-023 make MINI exists and no make is spelled Mini', () => {
  const makes = parsed().map((r) => r.make);
  assert.ok(makes.includes('MINI'), 'MINI missing');
  assert.ok(!makes.includes('Mini'), 'Mini must be merged into MINI');
});

test('D-023 no two makes differ only by case', () => {
  const makes = parsed().map((r) => r.make.toLowerCase());
  assert.equal(new Set(makes).size, makes.length);
});
