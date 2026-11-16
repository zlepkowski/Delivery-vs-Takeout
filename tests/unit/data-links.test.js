// POD.data.LINKS (src/data/links.js, docs/links-contract.md §1, D-041), checked on its own.
// The pinned values are the ones D-041 records (the user's confirmed DoorDash format, the Uber Eats
// and Grubhub home pages, Google Maps' two formats); the chain domains come from each chain's own
// research evidence in tools/data/profiles/<id>.json.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadData } = require('../helpers/data');
const { APP_ROOT } = require('../helpers/load');

const PROFILES_DIR = path.join(APP_ROOT, 'tools', 'data', 'profiles');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let cached = null;
function load() {
  if (!cached) cached = loadData(['src/data/links.js', 'src/data/profiles.js']);
  return cached;
}

/** A real calendar date in YYYY-MM-DD form. */
function isRealDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isHttps(s) {
  return typeof s === 'string' && s.indexOf('https://') === 0;
}

test('§1 asOf is a date, and it is the date D-041 records (2026-11-16)', () => {
  const { LINKS } = load();
  assert.ok(isRealDate(LINKS.asOf), 'asOf is not a date: ' + LINKS.asOf);
  assert.equal(LINKS.asOf, '2026-11-16');
});

test('§1 shape: apps has exactly dd, ue and gh; each home is https and ends with /', () => {
  const { LINKS } = load();
  assert.deepStrictEqual(Object.keys(LINKS.apps).sort(), ['dd', 'gh', 'ue']);
  for (const p of ['dd', 'ue', 'gh']) {
    const a = LINKS.apps[p];
    assert.ok(isHttps(a.home), p + '.home is not https: ' + a.home);
    assert.ok(a.home.endsWith('/'), p + '.home does not end with /: ' + a.home);
  }
});

test('§1 shape: each app search is null or an https string holding {q}', () => {
  const { LINKS } = load();
  for (const p of ['dd', 'ue', 'gh']) {
    const s = LINKS.apps[p].search;
    if (s === null) continue;
    assert.ok(isHttps(s), p + '.search is not https: ' + s);
    assert.ok(s.indexOf('{q}') >= 0, p + '.search has no {q}: ' + s);
  }
});

test('§1 shape: every app, maps and order entry has a non-empty source and a date checked', () => {
  const { LINKS } = load();
  const entries = [];
  for (const p of ['dd', 'ue', 'gh']) entries.push([p, LINKS.apps[p]]);
  entries.push(['maps', LINKS.maps]);
  for (const id of Object.keys(LINKS.order)) entries.push(['order.' + id, LINKS.order[id]]);
  for (const [name, e] of entries) {
    assert.equal(typeof e.source, 'string', name + '.source is not a string');
    assert.notEqual(e.source.trim(), '', name + '.source is empty');
    assert.ok(isRealDate(e.checked), name + '.checked is not a YYYY-MM-DD date: ' + e.checked);
    assert.ok(e.checked <= LINKS.asOf, name + '.checked (' + e.checked + ') is after asOf');
  }
});

test('§1 shape: maps has a non-empty name, a dir with {lat} and {lon}, and a search with {q}', () => {
  const { LINKS } = load();
  const m = LINKS.maps;
  assert.equal(typeof m.name, 'string');
  assert.notEqual(m.name, '');
  assert.ok(isHttps(m.dir), 'maps.dir is not https: ' + m.dir);
  assert.ok(m.dir.indexOf('{lat}') >= 0 && m.dir.indexOf('{lon}') >= 0, 'maps.dir lacks {lat} or {lon}: ' + m.dir);
  assert.ok(isHttps(m.search), 'maps.search is not https: ' + m.search);
  assert.ok(m.search.indexOf('{q}') >= 0, 'maps.search lacks {q}: ' + m.search);
});

test('§1 shape: every order url is https and is the chain\'s home page (a path of /, no deep path)', () => {
  const { LINKS } = load();
  for (const id of Object.keys(LINKS.order)) {
    const url = LINKS.order[id].url;
    assert.ok(isHttps(url), id + '.url is not https: ' + url);
    assert.equal(new URL(url).pathname, '/', id + '.url is a deep path: ' + url);
  }
});

test('D-041 key sets: order has exactly the profiled chains (a new profile needs its checked link)', () => {
  const { LINKS, PROFILES } = load();
  assert.deepStrictEqual(Object.keys(LINKS.order).sort(), Object.keys(PROFILES).sort());
  assert.ok(Object.keys(PROFILES).length >= 9, 'PROFILES looks emptied');
});

test('D-041 the DoorDash search format is the one the user confirmed on 2026-11-16', () => {
  const { LINKS } = load();
  assert.equal(LINKS.apps.dd.search, 'https://www.doordash.com/search/store/{q}/');
  assert.equal(LINKS.apps.dd.home, 'https://www.doordash.com/');
});

test('D-041 Uber Eats and Grubhub have no confirmed search format, so both are null (home pages only)', () => {
  const { LINKS } = load();
  assert.equal(LINKS.apps.ue.search, null);
  assert.equal(LINKS.apps.gh.search, null);
  assert.equal(LINKS.apps.ue.home, 'https://www.ubereats.com/');
  assert.equal(LINKS.apps.gh.home, 'https://www.grubhub.com/');
});

test('D-041 Google Maps is the map, with its two keyless formats exactly as the file records them', () => {
  const { LINKS } = load();
  assert.equal(LINKS.maps.name, 'Google Maps');
  assert.equal(LINKS.maps.dir, 'https://www.google.com/maps/dir/?api=1&destination={lat}%2C{lon}');
  assert.equal(LINKS.maps.search, 'https://www.google.com/maps/search/?api=1&query={q}');
});

test('D-041 each chain\'s link is on its own domain: the last two host labels appear in its profile evidence', () => {
  const { LINKS } = load();
  for (const id of Object.keys(LINKS.order)) {
    const file = path.join(PROFILES_DIR, id + '.json');
    assert.ok(fs.existsSync(file), 'no research evidence for ' + id + ' at ' + file);
    const text = fs.readFileSync(file, 'utf8');
    const host = new URL(LINKS.order[id].url).hostname;
    const domain = host.split('.').slice(-2).join('.');
    assert.ok(text.indexOf(domain) >= 0, id + ': ' + domain + ' is not in its own profile evidence');
  }
});
