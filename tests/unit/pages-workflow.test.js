// pages-workflow.test.js: the D-039 refresh wiring, pinned as text (no YAML library).
//
// .github/workflows/pages.yml: the weekly schedule, the dry_run input, when the deploy job runs,
// and the cache env that keeps a stale ATP or EIA download out of the build.
// tools/build-site.sh: the states.js regeneration, the check-site call on OUT and ROOT, and
// set -euo pipefail, so a failing gate fails the build and Pages keeps the last good deploy.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { APP_ROOT } = require('../helpers/load');

const WORKFLOW = path.join(APP_ROOT, '.github', 'workflows', 'pages.yml');
const BUILD = path.join(APP_ROOT, 'tools', 'build-site.sh');
const yml = fs.readFileSync(WORKFLOW, 'utf8');
const sh = fs.readFileSync(BUILD, 'utf8');
// The command lines (not the header comments, which name the same tools).
const STATES_CMD = 'python3 -I "$ROOT/tools/build-states.py"';
const GATE_CMD = 'node "$ROOT/tools/check-site.js"';

/** The text of one top-level job, from its "  name:" line to the next job (or the end). */
function jobBlock(name) {
  const start = yml.indexOf('\n  ' + name + ':\n');
  assert.ok(start >= 0, 'job ' + name + ' is missing from pages.yml');
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z_]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The text of the workflow's on: block, up to the top-level permissions: key. */
function onBlock() {
  const start = yml.indexOf('\non:\n');
  assert.ok(start >= 0, 'pages.yml has no on: block');
  return yml.slice(start, yml.indexOf('\npermissions:', start));
}

/** Evaluates a GitHub expression with the event and input fixed. Only the operators used here. */
function evalIf(expr, eventName, dryRun) {
  const js = expr
    .replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '')
    .replace(/github\.event_name/g, JSON.stringify(eventName))
    .replace(/inputs\.dry_run/g, dryRun ? 'true' : 'false')
    .replace(/!=/g, '!==');
  return vm.runInNewContext(js, {});
}

// ---- pages.yml -----------------------------------------------------------------------------------

test('D-039 pages.yml keeps the weekly schedule: Mondays at 07:17 UTC', () => {
  assert.match(onBlock(), /\n  schedule:\n    - cron: '17 7 \* \* 1'/);
});

test('D-039 pages.yml: workflow_dispatch has a boolean dry_run input defaulting to false', () => {
  const on = onBlock();
  assert.match(on, /\n  workflow_dispatch:\n    inputs:\n/);
  const i = on.indexOf('\n      dry_run:\n');
  assert.ok(i >= 0, 'dry_run input is missing under workflow_dispatch');
  const block = on.slice(i);
  assert.match(block, /\n        type: boolean\n/, 'dry_run must be typed boolean');
  assert.match(block, /\n        default: false\n/, 'dry_run must default to false');
});

test('D-039 pages.yml: the deploy job skips only a workflow_dispatch run with dry_run set', () => {
  const deploy = jobBlock('deploy');
  const m = /\n    if: (.+)\n/.exec(deploy);
  assert.ok(m, 'the deploy job has no if: line');
  const expr = m[1];
  assert.equal(expr, "${{ github.event_name != 'workflow_dispatch' || !inputs.dry_run }}");
  // The four cases that matter: a push and the weekly schedule deploy, a dry run does not, and a
  // dispatch without dry_run deploys.
  assert.equal(evalIf(expr, 'push', false), true, 'a push to main must deploy');
  assert.equal(evalIf(expr, 'schedule', false), true, 'the weekly schedule must deploy');
  assert.equal(evalIf(expr, 'workflow_dispatch', false), true, 'a dispatch without dry_run must deploy');
  assert.equal(evalIf(expr, 'workflow_dispatch', true), false, 'a dispatch with dry_run must skip the deploy');
  assert.match(deploy, /\n    needs: build\n/, 'deploy must wait for the build');
});

test('D-039 pages.yml: the build job has no if, so every gate runs on every trigger', () => {
  assert.equal(/\n    if:/.test(jobBlock('build')), false);
});

test('D-039 pages.yml: the build step runs build-site.sh with ATP_CACHE and EIA_CACHE set', () => {
  const build = jobBlock('build');
  const i = build.indexOf('      - name: Build site');
  assert.ok(i >= 0, 'the build job has no "Build site" step');
  const step = build.slice(i, build.indexOf('      - uses: actions/configure-pages', i));
  assert.match(step, /\n        run: bash tools\/build-site\.sh _site\n/);
  assert.match(step, /\n          ATP_CACHE: \$\{\{ runner\.temp \}\}\/atp-cache\n/, 'ATP_CACHE must be a fresh runner temp dir');
  assert.match(step, /\n          EIA_CACHE: \$\{\{ runner\.temp \}\}\/eia-cache\n/, 'EIA_CACHE must be a fresh runner temp dir');
  assert.match(step, /\n          ATP_RUN: latest\n/);
});

// ---- tools/build-site.sh -------------------------------------------------------------------------

/** The command that starts on a line containing the marker, through its continuation lines. */
function commandAt(marker) {
  const lines = sh.split('\n');
  const i = lines.findIndex((l) => l.includes(marker));
  assert.ok(i >= 0, 'build-site.sh has no line with ' + marker);
  const out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k]);
    if (!lines[k].trimEnd().endsWith('\\')) break;
  }
  return { text: out.join('\n'), line: i };
}

test('D-039 build-site.sh runs under set -euo pipefail before any build step', () => {
  const strict = sh.split('\n').findIndex((l) => l === 'set -euo pipefail');
  assert.ok(strict >= 0, 'set -euo pipefail is missing');
  assert.ok(strict < commandAt(STATES_CMD).line, 'strict mode must come before the states build');
  assert.ok(strict < commandAt(GATE_CMD).line, 'strict mode must come before the gates');
});

test('D-039 build-site.sh regenerates states.js into OUT from the repo\'s state-tax.csv', () => {
  assert.ok(fs.existsSync(path.join(APP_ROOT, 'tools', 'data', 'state-tax.csv')), 'tools/data/state-tax.csv is missing');
  const cmd = commandAt(STATES_CMD);
  assert.match(cmd.text, /python3 -I "\$ROOT\/tools\/build-states\.py"/);
  assert.match(cmd.text, /--out "\$OUT\/src\/data\/states\.js"/, 'states.js must be written into OUT');
  assert.match(cmd.text, /--tax "\$ROOT\/tools\/data\/state-tax\.csv"/, 'tax must come from the repo csv');
  assert.match(cmd.text, /--cache "\$EIA_CACHE"/, 'EIA downloads must use the EIA cache');
  assert.match(cmd.text, /--as-of "\$AS_OF"/);
});

test('D-039 build-site.sh: a fresh EIA cache by default, so an old gas week is never reused', () => {
  assert.match(sh, /\nEIA_CACHE="\$\{EIA_CACHE:-\$\(mktemp -d\)\}"\n/);
});

test('D-039 build-site.sh runs check-site.js on OUT and ROOT, and a FAIL is not swallowed', () => {
  // The gate runs inside the per-candidate loop, as "if ! node ...; then" (a failing gate skips that
  // ATP run and tries the next). The line must not be guarded by ||, and the script must exit 1 when
  // no candidate passed every gate.
  const cmd = commandAt(GATE_CMD);
  assert.match(cmd.text.trim(), /^(if ! )?node "\$ROOT\/tools\/check-site\.js" "\$OUT" "\$ROOT" --as-of "\$AS_OF"( > "\$clog" 2>&1; then)?$/);
  assert.equal(/\|\|/.test(cmd.text), false, 'the gate call must not be guarded by ||');
  assert.equal(/\bset \+e\b/.test(sh), false, 'the script must not turn off errexit');
  const lines = sh.split('\n');
  const guard = lines.findIndex((l) => l === 'if [ -z "$PASSED" ]; then');
  assert.ok(guard >= 0, 'no exit path when no candidate passed');
  assert.ok(lines.slice(guard, guard + 5).some((l) => /^\s*exit 1$/.test(l)), 'no candidate passing must exit 1');
});

test('D-039 build-site.sh orders the steps: copy src, regenerate states, then the gates', () => {
  const lines = sh.split('\n');
  const copy = lines.findIndex((l) => l.includes('cp -R "$ROOT/src/." "$OUT/src/"'));
  const states = commandAt(STATES_CMD).line;
  const gates = commandAt(GATE_CMD).line;
  assert.ok(copy >= 0, 'the src copy is missing');
  assert.ok(copy < states, 'the src copy must come before states');
  assert.ok(states < gates, 'states must be built before the gates run');
  assert.ok(lines[gates].includes('node "$ROOT/tools/check-site.js" "$OUT" "$ROOT"'), 'the gate call names OUT and ROOT');
});
