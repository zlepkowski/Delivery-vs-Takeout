// data-defaults.test.js: src/data/defaults.js against its evidence (D-032, docs/state-contract.md §2).
// The evidence is tools/data/defaults-platforms.json and tools/data/defaults-trip.json. Expected values
// come from those files and from the header's own claims, never from the loaded module alone.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const DEFAULTS_PATH = path.join(APP_ROOT, 'src', 'data', 'defaults.js');
const TEXT = fs.readFileSync(DEFAULTS_PATH, 'utf8');
const DATA = loadData(['src/data/defaults.js']);
const EVID = {
  plats: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tools', 'data', 'defaults-platforms.json'), 'utf8')).values,
  trip: JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tools', 'data', 'defaults-trip.json'), 'utf8')).values
};

const LEAVES = [
  'fees.regFee', 'fees.smallFee', 'fees.smallMin',
  'plats.dd.delFee', 'plats.dd.memberMin', 'plats.dd.memberSvc', 'plats.dd.pickDisc', 'plats.dd.svc', 'plats.dd.svcMin',
  'plats.gh.delFee', 'plats.gh.memberMin', 'plats.gh.memberSvc', 'plats.gh.pickDisc', 'plats.gh.svc', 'plats.gh.svcMin',
  'plats.ue.delFee', 'plats.ue.memberMin', 'plats.ue.memberSvc', 'plats.ue.pickDisc', 'plats.ue.svc', 'plats.ue.svcMin',
  'tips.tipDel', 'tips.tipPick',
  'trip.kwh', 'trip.mpg', 'trip.speed', 'trip.wear'
];
const CAPPED = new Set(['svc', 'memberSvc', 'pickDisc', 'tipDel', 'tipPick']);
const HEADER_END = TEXT.indexOf(' */');
const HEADER_LINES = TEXT.slice(0, HEADER_END).split('\n');

/** The dotted leaf paths of a DEFAULTS-shaped object. */
function leafPaths(obj, prefix) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const p = prefix ? prefix + '.' + k : k;
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

function getAt(obj, dotted) {
  return dotted.split('.').reduce((o, k) => o[k], obj);
}

/** The DEFAULTS path an evidence key feeds (the generator's TABLE), or null. */
function pathOfEvidence(key) {
  const m = /^(dd|ue|gh)\.(\w+)$/.exec(key);
  if (m) return 'plats.' + m[1] + '.' + m[2];
  if (['regFee', 'smallFee', 'smallMin'].includes(key)) return 'fees.' + key;
  if (['tipDel', 'tipPick'].includes(key)) return 'tips.' + key;
  if (['wear', 'kwh', 'speed', 'mpg'].includes(key)) return 'trip.' + key;
  return null;
}

const EVID_ALL = Object.assign({}, EVID.plats, EVID.trip);
const EVID_BY_PATH = {};
for (const key of Object.keys(EVID_ALL)) EVID_BY_PATH[pathOfEvidence(key)] = EVID_ALL[key];

test('D-032 §2 defaults: DEFAULTS has exactly the 27 leaf paths of D-032 and D-042 (trip.mpg added)', () => {
  assert.deepEqual(leafPaths(DATA.DEFAULTS).sort(), LEAVES.slice().sort());
  assert.equal(LEAVES.length, 27);
});

test('D-042 defaults: trip.mpg is pinned literally (value, source, read, est, decision) in DEFAULTS and DEFAULT_SOURCES', () => {
  assert.strictEqual(DATA.DEFAULTS.trip.mpg, 23);
  const src = DATA.DEFAULT_SOURCES['trip.mpg'];
  assert.strictEqual(src.source, 'https://www.eia.gov/outlooks/aeo/excel/aeotab7.xlsx');
  assert.strictEqual(src.read, '2026-11-16');
  assert.strictEqual(src.est, true);
  assert.strictEqual(src.decision, 'D-042');
  const ev = EVID.trip.mpg;
  assert.strictEqual(ev.value, 23);
  assert.strictEqual(ev.source, 'https://www.eia.gov/outlooks/aeo/excel/aeotab7.xlsx');
  assert.strictEqual(ev.read, '2026-11-16');
  assert.strictEqual(ev.est, true);
  assert.strictEqual(ev.decision, 'D-042');
  assert.match(ev.quote, /Light-Duty Stock 6\/': 2025 = 23\.04509353637695/);
  assert.match(ev.reason, /rounded DOWN to 23\.0/);
});

test('D-032 §2 defaults: the two evidence files map onto exactly those 27 paths', () => {
  const mapped = Object.keys(EVID_ALL).map(pathOfEvidence);
  assert.ok(mapped.every((p) => p !== null), 'every evidence key maps to a path');
  assert.deepEqual(mapped.slice().sort(), LEAVES.slice().sort());
});

test('D-032 §2 defaults: each value is null or a finite number >= 0, and the percentages are <= 100', () => {
  for (const p of LEAVES) {
    const v = getAt(DATA.DEFAULTS, p);
    if (v === null) continue;
    assert.equal(typeof v, 'number', p + ': a number or null');
    assert.ok(Number.isFinite(v), p + ': finite');
    assert.ok(v >= 0, p + ': >= 0');
    if (CAPPED.has(p.split('.').pop())) assert.ok(v <= 100, p + ': <= 100');
  }
});

test('D-032 §2 defaults: DEFAULT_SOURCES has exactly the 27 dotted keys, each with the four fields', () => {
  assert.deepEqual(Object.keys(DATA.DEFAULT_SOURCES).sort(), LEAVES.slice().sort());
  for (const p of LEAVES) {
    assert.deepEqual(Object.keys(DATA.DEFAULT_SOURCES[p]).sort(), ['decision', 'est', 'read', 'source'], p + ': fields');
  }
});

test('D-032 §2 defaults: DEFAULT_SOURCES entries are well formed (read date, est boolean, https source, D-nnn decision)', () => {
  const decisions = fs.readFileSync(path.join(APP_ROOT, 'docs', 'decisions.md'), 'utf8');
  const headings = new Set([...decisions.matchAll(/^\*\*(D-\d{3}) —/gm)].map((m) => m[1]));
  assert.ok(headings.size > 0, 'docs/decisions.md has D-nnn headings');
  for (const p of LEAVES) {
    const e = DATA.DEFAULT_SOURCES[p];
    assert.match(e.read, /^\d{4}-\d{2}-\d{2}$/, p + ': read is YYYY-MM-DD');
    const d = new Date(e.read + 'T00:00:00Z');
    assert.ok(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === e.read, p + ': read is a real date');
    assert.equal(typeof e.est, 'boolean', p + ': est is a boolean');
    if (e.source !== null) assert.match(e.source, /^https:\/\/\S+$/, p + ': source is an https URL');
    if (e.decision !== null) {
      assert.match(e.decision, /^D-\d{3}$/, p + ': decision is D-nnn');
      assert.ok(headings.has(e.decision), p + ': ' + e.decision + ' is a heading in docs/decisions.md');
    }
    if (getAt(DATA.DEFAULTS, p) !== null) {
      assert.ok(e.source !== null || e.decision !== null, p + ': a number has a source or a decision');
    }
  }
});

test('D-032 §2 defaults: every value equals its evidence value', () => {
  for (const p of LEAVES) {
    assert.strictEqual(getAt(DATA.DEFAULTS, p), EVID_BY_PATH[p].value, p + ': value');
  }
});

test('D-032 §2 defaults: DEFAULT_SOURCES agrees with the evidence entry (est, source, decision, read)', () => {
  for (const p of LEAVES) {
    const ev = EVID_BY_PATH[p];
    const src = DATA.DEFAULT_SOURCES[p];
    assert.equal(src.est, ev.est, p + ': est');
    assert.equal(src.read, ev.read, p + ': read');
    assert.equal(src.source, ev.source === undefined ? null : ev.source, p + ': source');
    assert.equal(src.decision, ev.decision === undefined ? null : ev.decision, p + ': decision');
  }
});

test('D-032 §2 defaults: every null value has a non-empty reason in its evidence entry, and so does every est value', () => {
  for (const p of LEAVES) {
    const ev = EVID_BY_PATH[p];
    if (ev.value === null) {
      assert.ok(typeof ev.reason === 'string' && ev.reason.trim() !== '', p + ': a null needs a reason');
    }
    if (ev.est) {
      assert.ok(typeof ev.reason === 'string' && ev.reason.trim() !== '', p + ': an est value needs a reason');
    }
  }
});

test('D-032 §2 defaults: the header Nulls line lists exactly the null paths', () => {
  const line = HEADER_LINES.find((l) => l.startsWith(' * Nulls:'));
  assert.ok(line, 'header has a Nulls: line');
  const body = line.slice(' * Nulls:'.length).trim().replace(/ \(not yet sourced, D-042\)$/, '');
  const listed = body === 'none' ? [] : body.split(', ');
  const nulls = LEAVES.filter((p) => getAt(DATA.DEFAULTS, p) === null);
  assert.deepEqual(listed.slice().sort(), nulls.slice().sort());
});

test('D-042 defaults: exactly these 14 paths are still null (not yet sourced), no others', () => {
  const nulls = LEAVES.filter((p) => getAt(DATA.DEFAULTS, p) === null).sort();
  assert.deepEqual(nulls, [
    'fees.regFee', 'fees.smallFee', 'fees.smallMin',
    'plats.dd.delFee',
    'plats.gh.delFee', 'plats.gh.memberMin', 'plats.gh.memberSvc', 'plats.gh.svc', 'plats.gh.svcMin',
    'plats.ue.delFee', 'plats.ue.memberMin', 'plats.ue.memberSvc', 'plats.ue.svc', 'plats.ue.svcMin'
  ]);
  for (const p of nulls) assert.strictEqual(DATA.DEFAULT_SOURCES[p].est, false, p + ': a null is not an estimate');
});

test('D-042 defaults: plats.dd.svcMin is pinned literally (value, source, read, est, decision) in DEFAULTS and DEFAULT_SOURCES', () => {
  const url = 'https://www.kiro7.com/news/local/navigating-delivery-fee-frenzy-which-apps-save-you-most/BDH2PITGPRAFLMLDSCXTBJ2FII/';
  assert.strictEqual(DATA.DEFAULTS.plats.dd.svcMin, 3);
  const src = DATA.DEFAULT_SOURCES['plats.dd.svcMin'];
  assert.strictEqual(src.source, url);
  assert.strictEqual(src.read, '2026-11-17');
  assert.strictEqual(src.est, true);
  assert.strictEqual(src.decision, 'D-042');
  const ev = EVID.plats['dd.svcMin'];
  assert.strictEqual(ev.value, 3);
  assert.strictEqual(ev.source, url);
  assert.strictEqual(ev.read, '2026-11-17');
  assert.strictEqual(ev.est, true);
  assert.strictEqual(ev.decision, 'D-042');
  assert.match(ev.quote, /DoorDash charges a flat 15% or \$3 minimum/);
  assert.match(ev.reason, /Median of \{3\} = 3/);
});

test('D-032 §2 defaults: every est path appears on the header Est lines, and no other path does', () => {
  const start = HEADER_LINES.findIndex((l) => l.startsWith(' * Est:'));
  assert.ok(start >= 0, 'header has an Est: line');
  const block = [];
  for (let i = start; i < HEADER_LINES.length; i++) block.push(HEADER_LINES[i]);
  const named = [];
  for (const line of block) {
    const m = /^ \* (?:Est: +| +)([a-zA-Z]+(?:\.[a-zA-Z]+)+): /.exec(line);
    if (m) named.push(m[1]);
  }
  const ests = LEAVES.filter((p) => DATA.DEFAULT_SOURCES[p].est === true);
  for (const p of ests) assert.ok(named.includes(p), p + ' is est: true and appears on the Est line');
  assert.deepEqual(named.slice().sort(), ests.slice().sort());
});

test('D-032 §2 defaults: python3 -I tools/build-defaults.py reproduces src/data/defaults.js byte for byte', () => {
  const asOf = /^ \* As of: +(\d{4}-\d{2}-\d{2})$/m.exec(TEXT);
  assert.ok(asOf, 'header has an As of: date');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defaults-build-'));
  const out = path.join(dir, 'defaults.js');
  try {
    const r = spawnSync('python3', ['-I', path.join(APP_ROOT, 'tools', 'build-defaults.py'),
      '--as-of', asOf[1], '--out', out], { cwd: APP_ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, 'build-defaults exits 0: ' + r.stderr);
    assert.equal(fs.readFileSync(out, 'utf8'), TEXT, 'the generated file equals src/data/defaults.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
