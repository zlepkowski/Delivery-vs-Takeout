// The ES5 gate must actually reject modern syntax, or it guards nothing.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const CHECK = path.join(APP_ROOT, 'tools', 'es5-check.js');

function run(args) {
  return spawnSync(process.execPath, [CHECK, ...args], { cwd: APP_ROOT, encoding: 'utf8' });
}

test('es5-check passes the shipped src/', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stderr);
});

test('es5-check rejects an arrow function with file:line:col', () => {
  const r = run(['tests/fixtures/es5-violation.js']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tests\/fixtures\/es5-violation\.js:3:\d+/);
});
