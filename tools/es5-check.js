#!/usr/bin/env node
// es5-check — fails if any shipped script uses syntax newer than ES5.
//
// BUILD.md §3: the page is ES5-only (var, function; no arrows, let/const,
// template literals, classes, destructuring, spread, default params...).
// This parses every .js file under the given paths (default: src/) with
// acorn at ecmaVersion 5 and reports file:line:col for the first violation
// in each file.
//
// Usage: node tools/es5-check.js [path ...]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push('src');

function walk(p, out) {
  const abs = path.resolve(root, p);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (abs.endsWith('.js')) out.push(abs);
    return out;
  }
  for (const name of fs.readdirSync(abs).sort()) {
    walk(path.join(abs, name), out);
  }
  return out;
}

const files = targets.flatMap((t) => walk(t, []));
let failed = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    acorn.parse(src, { ecmaVersion: 5, sourceType: 'script', locations: true });
  } catch (err) {
    failed++;
    const rel = path.relative(root, file);
    const loc = err.loc ? `${err.loc.line}:${err.loc.column + 1}` : '?';
    const line = err.loc ? src.split('\n')[err.loc.line - 1] : '';
    console.error(`ES5 violation  ${rel}:${loc}  ${err.message.replace(/\s*\(\d+:\d+\)$/, '')}`);
    if (line) console.error(`    ${line.trim().slice(0, 160)}`);
  }
}

if (failed) {
  console.error(`\nes5-check: ${failed} of ${files.length} file(s) failed.`);
  process.exit(1);
}
console.log(`es5-check: ${files.length} file(s) OK`);
