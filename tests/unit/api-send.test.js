// api-send.test.js: pins POD.api.send (docs/api-contract.md §6.3, D-040) against a fake XMLHttpRequest
// installed in the app's VM sandbox. Every test loads a fresh page (a fresh sandbox), so the one-warning
// flag of a page load starts clean. Expected values are written from the contract text, not from send.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../helpers/load');

const BASE = 'https://worker.example.test';
const WARN = "Pickup or Delivery: the map server didn't answer, so built-in estimates are used.";
const J = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));   // across the VM realm (ISS-008)

// Asks written by hand in the shape §6.1 gives them.
const DRIVE = { kind: 'drive', key: '40.700,-74.000;40.712,-74.006', from: '40.700,-74.000', to: '40.712,-74.006' };
const GEO = { kind: 'geocode', key: '123 main st, brooklyn ny', q: '123 Main St, Brooklyn NY' };
const NEAR = { kind: 'nearby', key: '40.700,-74.000/5', lat: '40.700', lon: '-74.000', radius: 5 };
const OK_DRIVE = '{"miles":3.25,"minutes":9}';

// A fresh page: the real scripts in a VM, with a fake XMLHttpRequest and a fake console.
function page(apiBase, opts = {}) {
  const sb = loadApp();
  const log = { xhrs: [], warn: [], error: [] };
  class FakeXHR {
    constructor() {
      this.sets = {};          // every assignment to timeout, withCredentials and the on* handlers
      this.headers = [];
      this.opened = null;
      this.sent = 0;
      this.status = 0;
      this.responseText = '';
      log.xhrs.push(this);
    }
    open(method, url, async) {
      this.opened = { method, url, async };
      if (opts.openThrows) throw new Error('open refused');
    }
    setRequestHeader(name, value) { this.headers.push([name, value]); }
    send(body) {
      this.sent++;
      this.body = body;
      if (opts.sendThrows) throw new Error('send refused');
    }
  }
  for (const name of ['timeout', 'withCredentials', 'onload', 'onerror', 'ontimeout']) {
    Object.defineProperty(FakeXHR.prototype, name, {
      configurable: true,
      get() { return this.sets[name]; },
      set(v) { this.sets[name] = v; }
    });
  }
  sb.XMLHttpRequest = FakeXHR;
  sb.console = { warn: (m) => log.warn.push(m), error: (m) => log.error.push(m), log() {} };
  sb.POD.config.apiBase = apiBase;
  return { POD: sb.POD, log };
}

// Sends one ask on a fresh page; returns what the page saw.
function sendOne(ask, ...rest) {
  const p = page(rest.length ? rest[0] : BASE);   // an explicit undefined must stay undefined, not BASE
  const got = [];
  const ret = p.POD.api.send(ask, (v) => got.push(v));
  return { ret, got, log: p.log, x: p.log.xhrs[0], xhrs: p.log.xhrs };
}

// The fake Worker answers: set status and body, then fire the handler by hand.
function answer(x, status, text) {
  x.status = status;
  x.responseText = text;
  x.sets.onload();
}

// ---- enabled, and the URL -------------------------------------------------------

test('§6.3 apiBase "" (the committed value) sends nothing and returns false', () => {
  const r = sendOne(DRIVE, '');
  assert.equal(r.ret, false);
  assert.equal(r.xhrs.length, 0, 'no XMLHttpRequest constructed');
  assert.equal(r.got.length, 0, 'cb not called');
  assert.equal(r.log.warn.length, 0);
});

test('§6.3 an apiBase that is not an http(s) URL sends nothing and returns false', () => {
  for (const bad of ['worker.example.test', 'ftp://worker.example.test', 'https://worker example.test']) {
    const r = sendOne(DRIVE, bad);
    assert.equal(r.ret, false, bad);
    assert.equal(r.xhrs.length, 0, bad + ': no request');
    assert.equal(r.got.length, 0, bad + ': cb not called');
  }
});

test('§6.3 a non-string apiBase (undefined, 42, null) sends nothing and returns false', () => {
  for (const bad of [undefined, 42, null]) {
    const r = sendOne(DRIVE, bad);
    assert.equal(r.ret, false, String(bad));
    assert.equal(r.xhrs.length, 0, String(bad) + ': no XMLHttpRequest constructed');
    assert.equal(r.got.length, 0, String(bad) + ': cb not called');
  }
});

test('§6.3 a trailing "/" on apiBase is removed: no double slash', () => {
  const r = sendOne(DRIVE, BASE + '/');
  assert.equal(r.x.opened.url, BASE + '/drive?from=40.700%2C-74.000&to=40.712%2C-74.006');
  assert.equal(r.x.opened.url.indexOf('//', 'https://'.length), -1);
});

test('§6.3 an apiBase with a path prefix keeps its path and loses only the trailing "/"', () => {
  const r = sendOne(DRIVE, 'https://host.example.test/api/');
  assert.equal(r.x.opened.url, 'https://host.example.test/api/drive?from=40.700%2C-74.000&to=40.712%2C-74.006');
  assert.equal(r.x.opened.url.indexOf('/api//'), -1, 'no double slash after the prefix');
});

test('§6.3 drive URL: /drive?from=…&to=…, with "," as %2C', () => {
  const r = sendOne(DRIVE);
  assert.equal(r.x.opened.url, 'https://worker.example.test/drive?from=40.700%2C-74.000&to=40.712%2C-74.006');
});

test('§6.3 geocode URL: /geocode?q=…, with spaces as %20 and "," as %2C', () => {
  const r = sendOne(GEO);
  assert.equal(r.x.opened.url, 'https://worker.example.test/geocode?q=123%20Main%20St%2C%20Brooklyn%20NY');
});

test('§6.3 geocode q goes through encodeURIComponent: & # + are encoded, and so is a space', () => {
  // encodeURIComponent leaves ' unencoded (it's in its unreserved set), so the raw ' is the expected output.
  const r = sendOne({ kind: 'geocode', key: 'k', q: 'Tom & Jerry #1 + C\'s Diner' });
  assert.equal(r.x.opened.url, 'https://worker.example.test/geocode?q=Tom%20%26%20Jerry%20%231%20%2B%20C\'s%20Diner');
});

test('§6.3 nearby URL: /nearby?lat=…&lon=…&radius=…', () => {
  const r = sendOne(NEAR);
  assert.equal(r.x.opened.url, 'https://worker.example.test/nearby?lat=40.700&lon=-74.000&radius=5');
});

test('§6.3 a request is GET, async, with no custom header and no credentials', () => {
  for (const ask of [DRIVE, GEO, NEAR]) {
    const r = sendOne(ask);
    assert.equal(r.ret, true);
    assert.equal(r.xhrs.length, 1, ask.kind + ': one XMLHttpRequest');
    assert.equal(r.x.opened.method, 'GET', ask.kind);
    assert.equal(r.x.opened.async, true, ask.kind + ' async');
    assert.equal(r.x.headers.length, 0, ask.kind + ': no setRequestHeader');
    assert.notStrictEqual(r.x.sets.withCredentials, true, ask.kind + ': withCredentials never true');
    assert.equal(r.x.sent, 1, ask.kind + ': send() once');
  }
});

test('§6.3 timeout is 4000 ms for drive and geocode', () => {
  assert.equal(sendOne(DRIVE).x.sets.timeout, 4000);
  assert.equal(sendOne(GEO).x.sets.timeout, 4000);
});

test('§6.3 timeout is 10000 ms for nearby', () => {
  assert.equal(sendOne(NEAR).x.sets.timeout, 10000);
});

// ---- answers that pass ------------------------------------------------------------

test('§6.3 200 + valid drive JSON: cb gets checkDrive(body), so an extra field is dropped', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(DRIVE, (v) => got.push(v));
  answer(p.log.xhrs[0], 200, '{"miles":3.25,"minutes":9,"extra":"x"}');
  assert.equal(got.length, 1);
  assert.deepEqual(J(got[0]), { miles: 3.25, minutes: 9 });
  assert.equal(p.log.warn.length, 0, 'no warning on success');
  assert.equal(p.log.error.length, 0);
});

test('§6.3 200 + valid geocode JSON: cb gets checkGeocode(body)', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(GEO, (v) => got.push(v));
  answer(p.log.xhrs[0], 200, '{"lat":40.7128,"lon":-74.006,"zip":"10007","state":"NY","extra":1}');
  assert.deepEqual(J(got[0]), { lat: 40.7128, lon: -74.006, zip: '10007', state: 'NY' });
  assert.equal(p.log.warn.length, 0);
});

test('§6.3 200 + valid nearby JSON: cb gets checkNearby(body), a bad place dropped and extra fields stripped', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(NEAR, (v) => got.push(v));
  answer(p.log.xhrs[0], 200, JSON.stringify({ places: [
    { id: 'osm:n123', name: 'Corner Pizza', category: 'pizza', lat: 40.7, lon: -74, tags: { a: 1 } },
    { id: 'bogus', name: 'Nope', category: 'pizza', lat: 40.7, lon: -74 },
    { id: 'osm:w9', name: 'Cafe', category: 'coffee', lat: 40.71, lon: -74.01 }
  ] }));
  assert.deepEqual(J(got[0]), { places: [
    { id: 'osm:n123', name: 'Corner Pizza', category: 'pizza', lat: 40.7, lon: -74 },
    { id: 'osm:w9', name: 'Cafe', category: 'coffee', lat: 40.71, lon: -74.01 }
  ] });
  assert.equal(p.log.warn.length, 0);
});

// ---- answers that fail: cb(null) --------------------------------------------------

test('§6.3 200 + a body the check refuses: cb(null), and one warning', () => {
  const refused = [
    ['drive', DRIVE, '{"miles":1001,"minutes":5}'],
    ['drive', DRIVE, '{"miles":3,"minutes":-1}'],
    ['geocode', GEO, '{"lat":40.7,"lon":-74,"zip":"1120","state":"NY"}'],
    ['nearby', NEAR, '{"places":"none"}']
  ];
  for (const [kind, ask, text] of refused) {
    const p = page(BASE);
    const got = [];
    p.POD.api.send(ask, (v) => got.push(v));
    answer(p.log.xhrs[0], 200, text);
    assert.equal(got.length, 1, kind + ' ' + text);
    assert.strictEqual(got[0], null, kind + ' ' + text);
    assert.equal(p.log.warn.length, 1, kind + ' warns once');
  }
});

test('§6.3 200 + unparsable JSON: cb(null)', () => {
  for (const text of ['<html>', '{', '']) {
    const p = page(BASE);
    const got = [];
    p.POD.api.send(DRIVE, (v) => got.push(v));
    answer(p.log.xhrs[0], 200, text);
    assert.equal(got.length, 1, JSON.stringify(text));
    assert.strictEqual(got[0], null, JSON.stringify(text));
  }
});

test('§6.3 a status other than 200 is cb(null), even with a valid JSON body', () => {
  for (const status of [404, 500]) {
    const p = page(BASE);
    const got = [];
    p.POD.api.send(DRIVE, (v) => got.push(v));
    answer(p.log.xhrs[0], status, OK_DRIVE);
    assert.equal(got.length, 1, 'status ' + status);
    assert.strictEqual(got[0], null, 'status ' + status);
    assert.equal(p.log.warn.length, 1, 'status ' + status + ' warns');
  }
});

test('§6.3 status 204 (another 2xx) with a valid JSON body: cb(null)', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(DRIVE, (v) => got.push(v));
  answer(p.log.xhrs[0], 204, OK_DRIVE);
  assert.equal(got.length, 1);
  assert.strictEqual(got[0], null);
  assert.equal(p.log.warn.length, 1, '204 warns once');
});

test('§6.3 onerror: cb(null)', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(GEO, (v) => got.push(v));
  p.log.xhrs[0].sets.onerror();
  assert.equal(got.length, 1);
  assert.strictEqual(got[0], null);
});

test('§6.3 ontimeout: cb(null)', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(NEAR, (v) => got.push(v));
  p.log.xhrs[0].sets.ontimeout();
  assert.equal(got.length, 1);
  assert.strictEqual(got[0], null);
});

test('§6.3 open() throwing: cb(null) and send still returns true', () => {
  const p = page(BASE, { openThrows: true });
  const got = [];
  const ret = p.POD.api.send(DRIVE, (v) => got.push(v));
  assert.equal(ret, true);
  assert.equal(got.length, 1);
  assert.strictEqual(got[0], null);
  assert.equal(p.log.xhrs[0].sent, 0, 'no send after open threw');
});

test('§6.3 send() throwing: cb(null) and send still returns true', () => {
  const p = page(BASE, { sendThrows: true });
  const got = [];
  const ret = p.POD.api.send(GEO, (v) => got.push(v));
  assert.equal(ret, true);
  assert.equal(got.length, 1);
  assert.strictEqual(got[0], null);
});

// ---- asks that are refused -------------------------------------------------------

test('§6.3 an unknown ask.kind returns false and sends nothing', () => {
  const asks = [
    { kind: 'fuel', key: 'x' },
    { kind: 'vehicle', key: 'x', q: 'x' }
  ];
  for (const ask of asks) {
    const r = sendOne(ask);
    assert.equal(r.ret, false, ask.kind);
    assert.equal(r.xhrs.length, 0, ask.kind + ': no request');
    assert.equal(r.got.length, 0, ask.kind + ': cb not called');
  }
});

test('§6.3 a malformed ask returns false and sends nothing', () => {
  const malformed = [
    undefined,
    null,
    'drive',
    { kind: 'drive', key: 'k', from: 40.7, to: '40.712,-74.006' },              // from not a string
    { kind: 'drive', key: 'k', from: '40.700,-74.000' },                        // to missing
    { kind: 'geocode', key: 'k' },                                              // q missing
    { kind: 'nearby', key: 'k', lat: '40.700', lon: '-74.000', radius: '5' },  // radius not a number
    { kind: 'nearby', key: 'k', lat: 40.7, lon: '-74.000', radius: 5 }         // lat not a string
  ];
  for (const ask of malformed) {
    const r = sendOne(ask);
    assert.equal(r.ret, false, JSON.stringify(ask));
    assert.equal(r.xhrs.length, 0, JSON.stringify(ask) + ': no request');
    assert.equal(r.got.length, 0, JSON.stringify(ask) + ': cb not called');
  }
});

// ---- one callback, one warning, no console.error ----------------------------------

test('§6.3 cb is called exactly once when a late event fires after timeout or load', () => {
  const orders = [
    ['ontimeout', 'onerror'],
    ['ontimeout', 'onload200'],
    ['onload200', 'onerror'],
    ['onerror', 'onload200']
  ];
  for (const order of orders) {
    const p = page(BASE);
    const got = [];
    p.POD.api.send(DRIVE, (v) => got.push(v));
    const x = p.log.xhrs[0];
    for (const ev of order) {
      if (ev === 'onload200') { answer(x, 200, OK_DRIVE); } else { x.sets[ev](); }
    }
    assert.equal(got.length, 1, order.join(' then ') + ': cb count');
  }
});

test('§6.3 the first answer wins: a load after a timeout does not change the cb value', () => {
  const p = page(BASE);
  const got = [];
  p.POD.api.send(DRIVE, (v) => got.push(v));
  const x = p.log.xhrs[0];
  x.sets.ontimeout();
  answer(x, 200, OK_DRIVE);
  assert.equal(got.length, 1);
  assert.strictEqual(got[0], null);
});

test('§6.3 one console.warn, with the contract text, across several failures in one page load', () => {
  const p = page(BASE);
  const got = [];
  const send = (ask) => p.POD.api.send(ask, (v) => got.push(v));
  send(DRIVE); answer(p.log.xhrs[0], 404, OK_DRIVE);
  send(GEO); p.log.xhrs[1].sets.onerror();
  send(NEAR); p.log.xhrs[2].sets.ontimeout();
  send(DRIVE); answer(p.log.xhrs[3], 200, '<html>');
  assert.equal(got.length, 4);
  assert.ok(got.every((v) => v === null), 'every failure is cb(null)');
  assert.deepEqual(p.log.warn, [WARN]);
  assert.equal(p.log.error.length, 0, 'never console.error');
});

test('§6.3 a fresh page load warns again: the flag is per page, not per process', () => {
  const first = page(BASE);
  first.POD.api.send(DRIVE, () => {});
  answer(first.log.xhrs[0], 500, '');
  const second = page(BASE);
  second.POD.api.send(GEO, () => {});
  second.log.xhrs[0].sets.onerror();
  assert.deepEqual(first.log.warn, [WARN]);
  assert.deepEqual(second.log.warn, [WARN]);
});

test('§6.3 no console.warn and no console.error on a page of successes', () => {
  const p = page(BASE);
  p.POD.api.send(DRIVE, () => {});
  answer(p.log.xhrs[0], 200, OK_DRIVE);
  p.POD.api.send(GEO, () => {});
  answer(p.log.xhrs[1], 200, '{"lat":40.7,"lon":-74,"zip":null,"state":null}');
  p.POD.api.send(NEAR, () => {});
  answer(p.log.xhrs[2], 200, '{"places":[]}');
  assert.deepEqual(p.log.warn, []);
  assert.deepEqual(p.log.error, []);
});
