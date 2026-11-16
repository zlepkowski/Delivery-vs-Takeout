// D-021 / BUILD.md §7: every embedded dataset carries a provenance header and is
// loaded by index.html between pod.js and app.js. Vacuously true with no files.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOrder, APP_ROOT } = require('../helpers/load');

const DATA_DIR = path.join(APP_ROOT, 'src', 'data');

/** Top-level src/data/*.js only; src/data/stores/ (generated) is excluded. */
function dataFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort();
}

const REQUIRED_LINES = [
  ['Source', /^\s*\*\s*Source:/m],
  ['As of YYYY-MM-DD', /^\s*\*\s*As of:\s*\d{4}-\d{2}-\d{2}/m],
  ['Method', /^\s*\*\s*Method:/m],
  ['Nulls', /^\s*\*\s*Nulls:/m],
  ['Est', /^\s*\*\s*Est:/m],
];

/** Returns a list of problems with a file's provenance header (empty = ok). */
function headerProblems(text) {
  const src = text.replace(/^﻿/, '').trimStart();
  if (!src.startsWith('/*')) return ['does not start with a /* comment'];
  const end = src.indexOf('*/');
  if (end < 0) return ['provenance comment is not closed'];
  const header = src.slice(0, end);
  return REQUIRED_LINES.filter(([, re]) => !re.test(header)).map(
    ([label]) => `missing "* ${label}" line`
  );
}

test('D-021 every src/data/*.js starts with a provenance header', () => {
  const problems = [];
  for (const f of dataFiles()) {
    const text = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
    for (const p of headerProblems(text)) problems.push(`${f}: ${p}`);
  }
  assert.deepEqual(problems, []);
});

test('D-021 every src/data/*.js is listed in index.html after pod.js and before app.js', () => {
  const order = scriptOrder();
  const pod = order.indexOf('src/js/pod.js');
  const app = order.indexOf('src/js/app.js');
  const problems = [];
  for (const f of dataFiles()) {
    const i = order.indexOf('src/data/' + f);
    if (i < 0) problems.push(`${f}: not in index.html`);
    else if (!(i > pod && i < app)) problems.push(`${f}: at index ${i}, need between ${pod} and ${app}`);
  }
  assert.deepEqual(problems, []);
});
