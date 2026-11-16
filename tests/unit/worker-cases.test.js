// worker-cases.test.js: runs the hand-worked Worker cases (tests/fixtures/api/cases.json, written by
// build.py from docs/api-contract.md, D-040) against worker/src/index.js's handle(request, env, deps).
// The fake fetch answers only the URLs a case lists; nothing reaches the network.
'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'api', 'cases.json'), 'utf8'));
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);

let handle;
before(async () => {
  ({ handle } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'index.js')).href));
});

function fakeKV(spec) {
  const puts = [];
  if (spec === null) return { kv: undefined, puts };
  if (spec === 'throws') {
    const no = async () => { throw new Error('KV is down'); };
    return { kv: { get: no, put: no }, puts };
  }
  const store = new Map();
  if (spec && spec.preset) for (const [k, v] of Object.entries(spec.preset)) store.set(k, JSON.stringify(v));
  const bad = [];
  const kv = {
    async get(key, type) {
      if (type !== 'json') bad.push('get(' + key + ') without "json"');
      return store.has(key) ? JSON.parse(store.get(key)) : null;
    },
    async put(key, value, opts) {
      if (typeof value !== 'string') bad.push('put(' + key + ') with a non-string value');
      puts.push({ key, value: JSON.parse(value), ttl: opts && opts.expirationTtl });
      store.set(key, value);
    },
  };
  return { kv, puts, bad };
}

// Records every call; problems are collected and asserted after handle() returns, because a throw
// inside fetch would only turn into a 502 and hide the mistake.
function fakeFetch(upstream, ua) {
  const calls = [];
  const problems = [];
  async function fetch(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    calls.push(url);
    const headers = new Headers((init && init.headers) || (typeof input === 'object' && input.headers) || undefined);
    if (headers.get('user-agent') !== ua) problems.push(url + ': User-Agent ' + JSON.stringify(headers.get('user-agent')));
    const signal = (init && init.signal) || (typeof input === 'object' && input.signal);
    if (!(signal instanceof AbortSignal)) problems.push(url + ': no AbortSignal (the contract times every provider call out)');
    const r = upstream[url];
    if (!r) {
      problems.push('unexpected upstream URL ' + url);
      throw new TypeError('no such fixture');
    }
    if (r.reject) throw new TypeError('fetch failed');
    const body = r.text !== undefined ? r.text : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    return new Response(body, { status: r.status, headers: { 'content-type': r.contentType || 'application/json' } });
  }
  return { fetch, calls, problems };
}

test('cases.json holds the Worker cases (a guard: an empty file must not pass)', () => {
  assert.ok(DOC.worker.length >= 87, 'expected at least 87 Worker cases, found ' + DOC.worker.length);
  const names = new Set(DOC.worker.map((c) => c.name));
  assert.equal(names.size, DOC.worker.length, 'case names are unique');
  for (const p of ['/drive', '/geocode', '/nearby']) {
    assert.ok(DOC.worker.some((c) => c.request.url.includes(p + '?') && c.expect.status === 200), p + ' has a 200 case');
  }
});

for (const c of DOC.worker) {
  test('worker ' + c.refs.join(' ') + ': ' + c.name, async () => {
    const headers = {};
    if (c.request.origin !== null) headers.Origin = c.request.origin;
    const request = new Request(c.request.url, { method: c.request.method, headers });
    const { kv, puts, bad } = fakeKV(c.kv);
    const env = Object.assign({}, c.env);
    if (kv) env.POD_CACHE = kv;
    const ff = fakeFetch(c.upstream, c.env.USER_AGENT);
    const res = await handle(request, env, { fetch: ff.fetch, now: () => NOW });

    assert.deepEqual(ff.problems, [], 'upstream calls');
    if (bad) assert.deepEqual(bad, [], 'KV usage');
    const e = c.expect;
    assert.equal(res.status, e.status, 'status');
    for (const [k, v] of Object.entries(e.headers)) assert.equal(res.headers.get(k), v, 'header ' + k);
    for (const k of e.absentHeaders || []) assert.equal(res.headers.get(k), null, 'header ' + k + ' must be absent');
    const text = await res.text();
    if (e.body === null) {
      assert.equal(text, '', 'no body');
    } else {
      const body = JSON.parse(text);
      if (e.body.error) {
        assert.deepEqual(Object.keys(body), ['error'], 'an error body has only "error"');
        assert.equal(body.error.code, e.body.error.code, 'error code');
        assert.equal(typeof body.error.message, 'string', 'error message');
        assert.ok(body.error.message.length > 0, 'error message is not empty');
      } else {
        assert.deepEqual(body, e.body, 'body');
      }
    }
    assert.deepEqual(ff.calls, e.upstreamCalls, 'upstream URLs, in order');
    assert.deepEqual(puts, e.kvPuts, 'KV puts, in order');
  });
}
