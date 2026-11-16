// worker.test.js: the Worker's router edges that the case table (worker-cases.test.js over
// tests/fixtures/api/cases.json) can't express: methods, exact paths, odd query strings, provider
// timeouts, the default export, the error body and Vary for every §1 code, and KV values of the
// wrong shape (docs/api-contract.md §0–§5, D-040). handle() gets a fake fetch and a fake KV. The
// global fetch is replaced by a stub that throws for the whole file, so nothing can reach the network.
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const BASE = 'https://worker.test';
const UA = 'pod-tests/1.0';
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const ENV = { USER_AGENT: UA, ALLOW_ORIGINS: 'https://example.test' };
const OSRM = 'https://router.project-osrm.org';          // §0 default OSRM_URL
const NOMINATIM = 'https://nominatim.openstreetmap.org'; // §0 default NOMINATIM_URL
const OVERPASS = 'https://overpass-api.de/api/interpreter'; // §0 default OVERPASS_URL
const CODES = ['bad_param', 'too_far', 'no_endpoint', 'no_route', 'not_found', 'method', 'upstream', 'not_configured'];
const RUN_TIMEOUT_MS = 14000;   // the patience of run(): a provider timeout of 9 s must end well before it

// §2 upstream URL: {OSRM_URL}/route/v1/driving/{fromLon},{fromLat};{toLon},{toLat}?overview=false&alternatives=false&steps=false
function osrmUrl(fromLat, fromLon, toLat, toLon) {
  return `${OSRM}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false&alternatives=false&steps=false`;
}
const DRIVE_Q = '/drive?from=45.834,-109.95&to=45.67,-110.546';   // Big Timber to Livingston, about 33.9 mi (§2)
const DRIVE_URL = osrmUrl(45.834, -109.95, 45.67, -110.546);
const NEARBY_Q = '/nearby?lat=45.834&lon=-109.95&radius=5';
const GEO_Q = '/geocode?q=Big+Timber%2C+MT';
// A valid OSRM answer: 16093.44 m is exactly 10 miles and 600 s is exactly 10 minutes (§2).
const OSRM_OK = { code: 'Ok', routes: [{ distance: 16093.44, duration: 600 }] };

// Installed for the whole file: any fetch that isn't the test's own fake is a bug, not a request.
const realFetch = globalThis.fetch;
const blocked = [];
function blockedFetch(input) {
  blocked.push(String(input));
  throw new TypeError('worker.test.js never uses the network: ' + String(input));
}

let handle;
let defaultExport;
let MESSAGES;
before(async () => {
  globalThis.fetch = blockedFetch;
  ({ handle, default: defaultExport } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'index.js')).href));
  ({ MESSAGES } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'util.js')).href));
});
after(() => {
  globalThis.fetch = realFetch;
});

// Rejects if `promise` hasn't settled within `ms`, so a hung Worker fails its test instead of stalling the run.
function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(what + ' did not settle within ' + ms + ' ms')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// `answers` is an object (exact upstream URL → answer) or a function (URL → answer). An answer is
// {body} or {text, status} (a Response), {reject: true} (a failed fetch) or {hang: true} (answers only
// when its signal aborts). Every call is recorded; a URL with no answer is a problem. Every call must
// carry the User-Agent and an AbortSignal (§0, §2–§4); the test asserts `problems` is empty.
function fakeFetch(answers) {
  const calls = [];
  const signals = [];
  const problems = [];
  async function fetch(input, init) {
    const url = String(input);
    calls.push(url);
    const headers = new Headers((init && init.headers) || undefined);
    if (headers.get('user-agent') !== UA) problems.push(url + ': User-Agent ' + JSON.stringify(headers.get('user-agent')));
    const signal = init && init.signal;
    if (signal instanceof AbortSignal) signals.push(signal);
    else problems.push(url + ': no AbortSignal (the contract times every provider call out)');
    const a = typeof answers === 'function' ? answers(url) : answers[url];
    if (!a) {
      problems.push('unexpected upstream URL ' + url);
      throw new TypeError('no fixture for ' + url);
    }
    if (a.reject) throw new TypeError('fetch failed');
    if (a.hang) {
      return new Promise((_, reject) => {
        if (signal) signal.addEventListener('abort', () => reject(new TypeError('aborted')), { once: true });
      });
    }
    const text = a.text !== undefined ? a.text : JSON.stringify(a.body);
    return new Response(text, {
      status: a.status !== undefined ? a.status : 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return { fetch, calls, signals, problems };
}

// One request through handle() with the fake upstream and an optional KV binding.
async function run(urlPath, { method = 'GET', env = ENV, answers = {}, origin, kv } = {}) {
  const headers = origin ? { Origin: origin } : {};
  const request = new Request(BASE + urlPath, { method, headers });
  const ff = fakeFetch(answers);
  const e = Object.assign({}, env);
  if (kv) e.POD_CACHE = kv;
  const res = await within(handle(request, e, { fetch: ff.fetch, now: () => NOW }), RUN_TIMEOUT_MS, method + ' ' + urlPath);
  return Object.assign({ res }, ff);
}

// The error body (§1): exactly {error: {code, message}}, message a non-empty string. Consumes the body.
async function errorOf(res) {
  const body = JSON.parse(await res.text());
  assert.deepEqual(Object.keys(body), ['error'], 'an error body has only "error"');
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message'], 'an error has only code and message');
  assert.equal(typeof body.error.message, 'string', 'error message is a string');
  assert.ok(body.error.message.length > 0, 'error message is not empty');
  return body.error;
}

// Every JSON response (§1): the content type, no-store, and Vary: Origin, whatever the status.
function assertJsonHeaders(res) {
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8', 'content-type');
  assert.equal(res.headers.get('cache-control'), 'no-store', 'cache-control');
  assert.equal(res.headers.get('vary'), 'Origin', 'Vary: Origin');
}

test('the Worker module loads with handle() and a default export', () => {
  assert.equal(typeof handle, 'function');
  assert.equal(typeof defaultExport.fetch, 'function');
});

test('§0 the file never reaches the network: no test called the blocked global fetch', () => {
  assert.deepEqual(blocked, [], 'calls to the global fetch');
});

// (a) methods

for (const method of ['HEAD', 'PUT', 'DELETE']) {
  test(`§1 a ${method} to /drive is 405 method with Allow: GET, OPTIONS, and no upstream call`, async () => {
    const { res, calls, problems } = await run(DRIVE_Q, { method });
    assert.equal(res.status, 405, 'status');
    assert.equal(res.headers.get('allow'), 'GET, OPTIONS', 'Allow header');
    assertJsonHeaders(res);
    assert.equal((await errorOf(res)).code, 'method', 'error code');
    assert.deepEqual(calls, [], 'upstream calls');
    assert.deepEqual(problems, [], 'upstream problems');
  });
}

test('§1 a PUT to an unknown path is 405, not 404 (the method is checked first)', async () => {
  const { res } = await run('/no/such/path', { method: 'PUT' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, OPTIONS');
  assert.equal((await errorOf(res)).code, 'method');
});

test('§0 §1 a PUT to /drive with no USER_AGENT is 405, not 503 (method before configuration)', async () => {
  const { res, calls } = await run(DRIVE_Q, { method: 'PUT', env: {} });
  assert.equal(res.status, 405);
  assert.equal((await errorOf(res)).code, 'method');
  assert.deepEqual(calls, []);
});

test('§1 OPTIONS on an unknown path is 204 with an empty body and the preflight headers', async () => {
  const { res, calls, problems } = await run('/no/such/path', { method: 'OPTIONS', origin: 'https://example.test' });
  assert.equal(res.status, 204, 'status');
  assert.equal(res.headers.get('access-control-allow-methods'), 'GET, OPTIONS', 'Allow-Methods');
  assert.equal(res.headers.get('access-control-max-age'), '86400', 'Max-Age');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.test', 'allowed origin is echoed');
  assert.equal(res.headers.get('vary'), 'Origin', 'Vary');
  assert.equal(await res.text(), '', 'empty body');
  assert.deepEqual(calls, []);
  assert.deepEqual(problems, []);
});

test('§0 §1 OPTIONS answers 204 before the USER_AGENT check (no configuration needed)', async () => {
  const { res } = await run(DRIVE_Q, { method: 'OPTIONS', env: {} });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
});

// (b) paths are exact

for (const p of [
  '/drive/?from=45.834,-109.95&to=45.67,-110.546',
  '/DRIVE?from=45.834,-109.95&to=45.67,-110.546',
  '/drive.json?from=45.834,-109.95&to=45.67,-110.546',
  '//drive?from=45.834,-109.95&to=45.67,-110.546',
  '/geocode/?q=Big+Timber%2C+MT',
  '/Geocode?q=Big+Timber%2C+MT',
  '/nearby/?lat=45.834&lon=-109.95&radius=5',
  '/?from=45.834,-109.95&to=45.67,-110.546',
]) {
  test(`§1 ${p} is 404 no_endpoint (the path must match exactly)`, async () => {
    const { res, calls, problems } = await run(p);
    assert.equal(res.status, 404, 'status');
    assertJsonHeaders(res);
    assert.equal((await errorOf(res)).code, 'no_endpoint', 'error code');
    assert.deepEqual(calls, [], 'upstream calls');
    assert.deepEqual(problems, [], 'upstream problems');
  });
}

// (c) odd query strings never throw

test('§3 an invalid percent escape in q does not throw: the decoded q goes upstream (3 characters)', async () => {
  // URLSearchParams decodes %E0%A4%A to U+FFFD followed by "%A": 3 characters, no control character,
  // so §3 accepts it and sends it to Nominatim. Nominatim answers no hit, so 404 not_found.
  const q = '�%A';
  const { res, calls, problems } = await run('/geocode?q=%E0%A4%A', { answers: () => ({ body: [] }) });
  assert.equal(res.status, 404, 'status');
  assertJsonHeaders(res);
  assert.equal((await errorOf(res)).code, 'not_found', 'error code');
  assert.equal(calls.length, 1, 'one upstream call');
  assert.equal(new URL(calls[0]).searchParams.get('q'), q, 'the decoded q goes upstream');
  assert.deepEqual(problems, []);
});

test('§3 %E0%A4 decodes to one character, so geocode is a 400 bad_param with no upstream call', async () => {
  const { res, calls } = await run('/geocode?q=%E0%A4');
  assert.equal(res.status, 400);
  assertJsonHeaders(res);
  assert.equal((await errorOf(res)).code, 'bad_param');
  assert.deepEqual(calls, []);
});

for (const p of [
  '/drive?from&to=45.67,-110.546',
  '/drive?from=45.834,-109.95&to',
  '/drive?from=%E0%A4%A&to=45.67,-110.546',
]) {
  test(`§1 §2 a /drive parameter with no "=" or a broken escape (${p}) is a 400 bad_param`, async () => {
    const { res, calls } = await run(p);
    assert.equal(res.status, 400, 'status');
    assertJsonHeaders(res);
    assert.equal((await errorOf(res)).code, 'bad_param', 'error code');
    assert.deepEqual(calls, [], 'upstream calls');
  });
}

test('§3 a 10,000-character q is a 400 bad_param, not a throw or a 500', async () => {
  const { res, calls } = await run('/geocode?q=' + 'a'.repeat(10000));
  assert.equal(res.status, 400, 'status');
  assertJsonHeaders(res);
  assert.equal((await errorOf(res)).code, 'bad_param', 'error code');
  assert.deepEqual(calls, [], 'upstream calls');
});

test('§4 an invalid percent escape in lat is a 400 bad_param', async () => {
  const { res, calls } = await run('/nearby?lat=%ZZ&lon=-109.95&radius=5');
  assert.equal(res.status, 400);
  assert.equal((await errorOf(res)).code, 'bad_param');
  assert.deepEqual(calls, []);
});

// (c, sweep) odd query strings on every endpoint. None of them makes a valid parameter: each is a
// missing, empty or one-character value (§3 needs 3 characters for q), so each is a 400 bad_param.

const ODD_QUERIES = ['?', '?&', '?=', '?q=%', '?from=%', '?radius=', '?lat=&lon=&radius=2'];
for (const ep of ['/drive', '/geocode', '/nearby']) {
  for (const q of ODD_QUERIES) {
    test(`§1 §2 §3 §4 ${ep}${q} is a JSON 400 bad_param, never a throw or a 500`, async () => {
      const { res, calls, problems } = await run(ep + q);
      assert.equal(res.status, 400, 'status');
      assertJsonHeaders(res);
      assert.equal((await errorOf(res)).code, 'bad_param', 'error code');
      assert.deepEqual(calls, [], 'upstream calls');
      assert.deepEqual(problems, [], 'upstream problems');
    });
  }
}

// (b, timeouts) a provider that never answers. The three run concurrently, so the file takes about
// as long as the slowest one (Overpass, 9 s).

describe('§2 §3 §4 a provider that never answers is cut off by its timeout and answers 502 upstream', { concurrency: true }, () => {
  test('§2 /drive (OSRM) is cut off at 3.5 s: 502 upstream', { timeout: RUN_TIMEOUT_MS + 2000 }, async () => {
    const t0 = Date.now();
    const { res, calls, signals, problems } = await run(DRIVE_Q, { answers: { [DRIVE_URL]: { hang: true } } });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 502, 'status');
    assertJsonHeaders(res);
    assert.equal((await errorOf(res)).code, 'upstream', 'error code');
    assert.ok(elapsed >= 3000 && elapsed < 6000, 'answered in ' + elapsed + ' ms; the OSRM timeout is 3.5 s');
    assert.equal(signals.length, 1, 'one call with a signal');
    assert.equal(signals[0].aborted, true, 'the provider call\'s AbortSignal fired');
    assert.deepEqual(calls, [DRIVE_URL], 'upstream calls');
    assert.deepEqual(problems, [], 'upstream problems');
  });

  test('§3 /geocode (Nominatim) is cut off at 3.5 s: 502 upstream', { timeout: RUN_TIMEOUT_MS + 2000 }, async () => {
    const t0 = Date.now();
    const answers = (url) => (url.startsWith(NOMINATIM + '/search?') ? { hang: true } : undefined);
    const { res, calls, signals, problems } = await run(GEO_Q, { answers });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 502, 'status');
    assertJsonHeaders(res);
    assert.equal((await errorOf(res)).code, 'upstream', 'error code');
    assert.ok(elapsed >= 3000 && elapsed < 6000, 'answered in ' + elapsed + ' ms; the Nominatim timeout is 3.5 s');
    assert.equal(signals.length, 1, 'one call with a signal');
    assert.equal(signals[0].aborted, true, 'the provider call\'s AbortSignal fired');
    assert.equal(calls.length, 1, 'one upstream call');
    assert.deepEqual(problems, [], 'upstream problems');
  });

  test('§4 /nearby (Overpass) is cut off at 9 s: 502 upstream', { timeout: RUN_TIMEOUT_MS + 2000 }, async () => {
    const t0 = Date.now();
    const answers = (url) => (url.startsWith(OVERPASS + '?') ? { hang: true } : undefined);
    const { res, calls, signals, problems } = await run(NEARBY_Q, { answers });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 502, 'status');
    assertJsonHeaders(res);
    assert.equal((await errorOf(res)).code, 'upstream', 'error code');
    assert.ok(elapsed >= 8500 && elapsed < 12000, 'answered in ' + elapsed + ' ms; the Overpass timeout is 9 s');
    assert.equal(signals.length, 1, 'one call with a signal');
    assert.equal(signals[0].aborted, true, 'the provider call\'s AbortSignal fired');
    assert.equal(calls.length, 1, 'one upstream call');
    assert.deepEqual(problems, [], 'upstream problems');
  });
});

// (e) the default export

test('§0 the default export sends the OSRM request through globalThis.fetch', async () => {
  const seen = [];
  globalThis.fetch = async (input, init) => {
    seen.push({
      url: String(input),
      ua: new Headers(init.headers).get('user-agent'),
      signal: init.signal instanceof AbortSignal,
    });
    return new Response(JSON.stringify(OSRM_OK), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const req = new Request(BASE + DRIVE_Q);
    const res = await within(defaultExport.fetch(req, { USER_AGENT: UA }, {}), RUN_TIMEOUT_MS, 'default export');
    assert.equal(res.status, 200, 'status');
    assert.deepEqual(await res.json(), { miles: 10, minutes: 10, source: 'osrm' }, 'body (§2 rounding)');
  } finally {
    globalThis.fetch = blockedFetch;   // back to the file-wide stub
  }
  assert.deepEqual(seen.map((s) => s.url), [DRIVE_URL], 'the OSRM URL, default base, canonical coordinates');
  assert.equal(seen[0].ua, UA, 'User-Agent from env');
  assert.equal(seen[0].signal, true, 'an AbortSignal');
});

// (f) the error body for every §1 code

test('§1 the Worker\'s error table (util.js MESSAGES) has the eight codes of §1', () => {
  assert.deepEqual(Object.keys(MESSAGES).sort(), CODES.slice().sort());
});

const ERROR_CASES = [
  { code: 'bad_param', status: 400, urlPath: '/drive?from=x&to=45.67,-110.546' },
  { code: 'too_far', status: 400, urlPath: '/drive?from=0,0&to=0,10' },                  // 10 degrees of longitude, about 691 mi
  { code: 'no_endpoint', status: 404, urlPath: '/nope' },
  {
    code: 'no_route', status: 404, urlPath: DRIVE_Q,
    answers: { [DRIVE_URL]: { status: 400, body: { code: 'NoRoute', message: 'No route found' } } },
  },
  {
    code: 'not_found', status: 404, urlPath: '/geocode?q=Qqzzx+Nowhere+Road+99999',
    answers: () => ({ body: [] }),
  },
  { code: 'method', status: 405, urlPath: DRIVE_Q, method: 'PUT' },
  { code: 'upstream', status: 502, urlPath: DRIVE_Q, answers: { [DRIVE_URL]: { reject: true } } },
  { code: 'not_configured', status: 503, urlPath: DRIVE_Q, env: {} },
];

test('§1 the error cases below cover every key of the Worker\'s error table', () => {
  assert.deepEqual(ERROR_CASES.map((c) => c.code).sort(), Object.keys(MESSAGES).sort());
});

for (const c of ERROR_CASES) {
  test(`§1 error ${c.code} is status ${c.status} with exactly {error: {code, message}} and Vary: Origin`, async () => {
    const { res, problems } = await run(c.urlPath, {
      method: c.method,
      env: c.env,
      answers: c.answers,
      origin: 'https://other.test',
    });
    assert.equal(res.status, c.status, 'status');
    assertJsonHeaders(res);
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'a disallowed origin gets no allow header');
    const err = await errorOf(res);
    assert.equal(err.code, c.code, 'error code');
    assert.deepEqual(problems, [], 'upstream problems');
  });
}

// KV values of the wrong shape are a miss (§5).

// A KV whose get() returns `value` whatever the key; put() is recorded.
function kvReturning(value) {
  const gets = [];
  const puts = [];
  return {
    gets,
    puts,
    kv: {
      async get(key, type) {
        gets.push({ key, type });
        return value;
      },
      async put(key, text, opts) {
        puts.push({ key, value: JSON.parse(text), ttl: opts && opts.expirationTtl });
      },
    },
  };
}

// §5: only a stored {ok: plain object} is a hit; {ok: null}, {ok: "x"} and {ok: [1]} are misses too.
const WRONG_SHAPES = ['some string', 'no_route', ['ok', 1], { foo: 1 }, 42, { ok: null }, { ok: 'x' }, { ok: [1] }];

for (const v of WRONG_SHAPES) {
  test(`§5 a KV value of the wrong shape (${JSON.stringify(v)}) is a miss: the provider is asked`, async () => {
    const { kv, gets, puts } = kvReturning(v);
    const { res, calls, problems } = await run(DRIVE_Q, { kv, answers: { [DRIVE_URL]: { body: OSRM_OK } } });
    assert.equal(res.status, 200, 'status');
    assert.deepEqual(await res.json(), { miles: 10, minutes: 10, source: 'osrm' }, 'the provider\'s answer');
    assert.deepEqual(gets.map((g) => g.type), ['json'], 'read with type "json"');
    assert.deepEqual(calls, [DRIVE_URL], 'the provider was asked once');
    assert.deepEqual(problems, [], 'upstream problems');
    assert.equal(puts.length, 1, 'the answer is stored');
    assert.equal(puts[0].key, gets[0].key, 'stored under the same key');
    assert.deepEqual(puts[0].value, { ok: { miles: 10, minutes: 10, source: 'osrm' } }, 'stored as {ok: body}');
    assert.equal(puts[0].ttl, 604800, 'a /drive 200 lives 7 days (§5)');
  });
}
