// worker.e2e.js: D-040 on the page (UI contract §1, §3, §5.1-§5.4, §5.10; api contract §6, §8).
// Written by the orchestrator before the builder (D-035 pattern).
//
// Two copies of the site: "off" is the committed one (apiBase ""), "on" has src/js/config.js set to
// https://api.test, the way a deploy sets it. No test reaches the network: every http(s) request is
// recorded and aborted, and https://api.test/ is answered by a stub that serves the Worker's own
// normalized answers from tests/fixtures/api/cases.json (worked by build.py from recorded and
// constructed provider answers), with the CORS header the Worker sends to file:// pages.
// Expected prices come from H.app()'s verified modules on the page's saved state, given the same
// answers in opts.api; expected distances are worked by hand from the recordings (33.9 mi by road
// from Big Timber to the Livingston Domino's, so 67.8 mi round trip).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const H = require('./helpers');
const { APP_ROOT } = require('../helpers/load');

const API = 'https://api.test';
const CASES = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'tests', 'fixtures', 'api', 'cases.json'), 'utf8'));
const body = (name) => {
  const c = CASES.worker.find((w) => w.name === name);
  assert.ok(c && c.expect.status === 200, 'cases.json has the 200 case ' + name);
  return c.expect.body;
};
const BT_DRIVE = body("drive: Big Timber to the Livingston Domino's (recorded)");       // 33.9 mi, 36.3 min
const NY_DRIVE = body("drive: Empire State to the nearest Domino's (recorded)");        // 0.86 mi
const ES_GEO = body('geocode: a street address (recorded)');                            // 40.7484421, -73.9856589, 10118
const SMALL = body('nearby: a small town (constructed)');                               // 12 places, one "Subway"
const canon = (pair) => pair.split(',').map((s) => String(Number(s))).join(',');
const DRIVES = {
  '45.834,-109.95;45.67,-110.546': BT_DRIVE,
  '40.749,-73.986;40.755,-73.989': NY_DRIVE,
  // From the geocoded Empire State point (fmt3 40.748) the nearest Domino's is the 40.744, -73.979 store
  // (POD.geo.nearestStore on the fixture tiles), not the one nearest 10118's centroid. A stub value, not recorded:
  '40.748,-73.986;40.744,-73.979': { miles: 0.7, minutes: 2.9, source: 'osrm' },
};
const GEOS = { '350 5th ave, new york, ny 10118': ES_GEO };
const NEARBY = { '45.834,-109.95/5': SMALL };
const HEADERS = { 'Access-Control-Allow-Origin': 'null', 'Vary': 'Origin', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const DRIVE_KEY_BT = '45.834,-109.950;45.670,-110.546';                                  // POD.api.driveKey, fmt3 strings
const WARN = "Pickup or Delivery: the map server didn't answer, so built-in estimates are used.";
// Chromium's own console error for a request that fails or answers non-2xx (UI contract §0): page code
// can't suppress it, so a test that causes one allows exactly that message, exactly that many times.
const BROWSER_ERR = {
  404: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
  500: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
  abort: 'Failed to load resource: net::ERR_FAILED',
};
function onlyBrowserErrors(errors, text, n, where) {
  assert.deepEqual(errors, Array(n).fill(text), where + ': only the browser\'s own resource error, ' + n + ' time(s)');
}

let browser;
let off;
let on;

test.before(async () => {
  browser = await chromium.launch();
  off = H.buildSite();
  on = H.buildSite();
  fs.writeFileSync(path.join(on.dir, 'src', 'js', 'config.js'),
    '(function (root) { "use strict"; root.POD.config = { apiBase: "' + API + '" }; })(typeof window !== "undefined" ? window : this);\n');
  fs.mkdirSync(H.SHOTS, { recursive: true });
});
test.after(async () => {
  if (browser) await browser.close();
  if (off) off.remove();
  if (on) on.remove();
});

/** The Worker's answer to one seam request, as the stub serves it. */
function answer(u) {
  const q = u.searchParams;
  if (u.pathname === '/drive') {
    const k = canon(q.get('from')) + ';' + canon(q.get('to'));
    return DRIVES[k] ? [200, DRIVES[k]] : [404, { error: { code: 'no_route', message: 'No road route.' } }];
  }
  if (u.pathname === '/geocode') {
    const k = q.get('q').toLowerCase();
    return GEOS[k] ? [200, GEOS[k]] : [404, { error: { code: 'not_found', message: 'Nothing found.' } }];
  }
  if (u.pathname === '/nearby') {
    const r = Number(q.get('radius'));
    const k = canon(q.get('lat') + ',' + q.get('lon')) + '/' + r;
    return [200, NEARBY[k] || { places: [], radius: r, source: 'osm' }];
  }
  return [404, { error: { code: 'no_endpoint', message: 'No such endpoint.' } }];
}

/**
 * Opens a site with the network stubbed before the page loads (the seam can ask at boot).
 * mode: "answer" (the stub above), "500", "garbage", "abort" or "hang". Returns the page, its
 * console errors and warnings, and every http(s) request it made.
 */
async function open(site, { mode = 'answer', viewport = { width: 1280, height: 800 }, ctx: reuse = null } = {}) {
  const ctx = reuse || await browser.newContext({ viewport });
  const requests = [];
  const hung = [];
  if (!reuse) {
    await ctx.route(/^https?:\/\//, (route) => { requests.push(route.request().url()); return route.abort(); });
    await ctx.route(API + '/**', async (route) => {          // registered last, so it runs first
      const req = route.request();
      requests.push(req.url());
      ctx._apiRequests.push({ url: req.url(), method: req.method(), headers: req.headers() });
      if (ctx._mode === 'abort') return route.abort('failed');
      if (ctx._mode === 'hang') { hung.push(route); return undefined; }
      if (ctx._mode === '500') return route.fulfill({ status: 500, headers: HEADERS, body: '{"error":{"code":"upstream","message":"x"}}' });
      if (ctx._mode === 'garbage') {
        const u = new URL(req.url());
        const junk = u.pathname === '/drive' ? '{"miles":"far","minutes":1}' : u.pathname === '/nearby' ? '{"places":"none"}' : '<html>oops</html>';
        return route.fulfill({ status: 200, headers: HEADERS, body: junk });
      }
      const [status, b] = answer(new URL(req.url()));
      return route.fulfill({ status, headers: HEADERS, body: JSON.stringify(b) });
    });
    ctx._apiRequests = [];
  }
  ctx._mode = mode;
  const page = await ctx.newPage();
  const errors = [];
  const warns = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warns.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(site.url);
  await page.waitForSelector('#results');
  return { ctx, page, errors, warns, requests, api: ctx._apiRequests, hung };
}

/** What the page should show for its saved state, given the Worker answers in opts.api (and PLACES). */
function expectedWith(saved, api, extraData) {
  const POD = H.app();
  const D = extraData ? Object.assign({}, POD.data, extraData) : POD.data;
  const opts = { failed: {}, api: Object.assign({ drive: {}, geo: {}, nearby: {} }, api) };
  const S = POD.state.load({ getItem: () => saved, setItem() {} }, D, new Date(), opts);
  const F = POD.state.forEngine(S);
  const R = F ? POD.engine.allResults(F) : null;
  return { S: JSON.parse(JSON.stringify(S)), R: R ? JSON.parse(JSON.stringify(R)) : null };
}

async function chooseZip(page, zip) {
  await H.commit(page, '#address', zip);
  await H.waitText(page, '[data-testid="loc-status"]', 'ZIP ' + zip);
}
async function order(page, zip) {
  await chooseZip(page, zip);
  await page.selectOption('#brand', 'dominos');
  await H.waitText(page, '[data-testid="trip"]', 'mi round trip');
  await page.selectOption('#make', 'Toyota');
  await page.selectOption('#model', 'Camry');
  await page.click('[data-action="qty"][data-index="0"][data-delta="1"]');
  await page.waitForSelector('[data-testid="result-row"]');
}
const settle = (page, ms = 300) => page.waitForTimeout(ms);
const appHtml = (page) => page.$eval('#app', (e) => e.innerHTML);

// ---- off -------------------------------------------------------------------------------------

test('Worker off: no request leaves the page, no opts.api, and none of the Worker\'s text shows', async () => {
  const o = await open(off);
  assert.equal(await o.page.evaluate(() => window.POD.config.apiBase), '');
  assert.equal(await o.page.evaluate(() => window.POD.api.enabled()), false);
  await order(o.page, '59011');
  await settle(o.page);
  assert.equal(await o.page.evaluate(() => typeof window.POD.opts.api), 'undefined');
  assert.deepEqual(o.requests, [], 'no http(s) request at all');
  assert.equal(await H.text(o.page, '[data-testid="trip-src"]'),
    "To the nearest Domino's, 30.9 mi away in a straight line (× 2 × 1.25 for the road).");
  assert.match(await H.text(o.page, '[data-testid="trip"]'), /^77\.2 mi round trip/);
  assert.equal(await o.page.locator('[data-testid="indie-list"]').count(), 0);
  assert.equal(await o.page.locator('[data-testid="fine-osm"]').count(), 0);
  assert.deepEqual(o.errors, []);
  assert.deepEqual(o.warns, []);
  await o.ctx.close();
});

// ---- on, answering ---------------------------------------------------------------------------

test('Worker on: Big Timber gets the road distance (33.9 mi each way, 67.8 round trip) and its prices', async () => {
  const o = await open(on);
  await order(o.page, '59011');
  await H.waitText(o.page, '[data-testid="trip"]', '67.8 mi round trip');
  assert.equal(await H.text(o.page, '[data-testid="trip-src"]'), "To the nearest Domino's, 33.9 mi each way by road.");
  const drives = o.api.filter((r) => r.url.startsWith(API + '/drive'));
  assert.equal(drives.length, 1, 'one /drive request');
  const u = new URL(drives[0].url);
  assert.equal(u.searchParams.get('from'), '45.834,-109.950');
  assert.equal(u.searchParams.get('to'), '45.670,-110.546');
  assert.equal(drives[0].method, 'GET');
  assert.ok(!Object.keys(drives[0].headers).some((h) => /^x-|authorization/i.test(h)), 'no custom headers');
  const exp = expectedWith(await H.saved(o.page), { drive: { [DRIVE_KEY_BT]: { miles: 33.9, minutes: 36.3 } } });
  assert.equal(exp.S.miles, 67.8);
  assert.equal(exp.S.milesSrc, 'drive');
  assert.match(await H.text(o.page, '[data-testid="trip"]'), new RegExp('^67\\.8 mi round trip · about ' + exp.S.minutes + ' min'));
  assert.deepEqual(await H.shownResults(o.page), H.wantResults(exp), 'results priced at 67.8 mi');
  assert.equal(await H.text(o.page, '[data-testid="fine-osm"]'),
    "Road distances, street addresses and independent restaurants: OpenStreetMap (© OpenStreetMap contributors, ODbL), through this site's server.");
  assert.deepEqual(o.errors, []);
  assert.deepEqual(o.warns, []);
  await o.ctx.close();
});

test('Worker on: independents near Big Timber widen 2 → 5 mi, drop the untagged chain, and price as estimates', async () => {
  const o = await open(on);
  await chooseZip(o.page, '59011');
  await o.page.waitForSelector('[data-testid="indie-list"]');
  const radii = o.api.filter((r) => r.url.startsWith(API + '/nearby')).map((r) => new URL(r.url).searchParams.get('radius'));
  assert.deepEqual(radii, ['2', '5'], '2 mi had none, 5 mi had 12 (>= 10): no 10 mi request');
  const rows = await o.page.$$eval('[data-testid="indie-list"] [data-action="pick-place"]',
    (bs) => bs.map((b) => [b.getAttribute('data-brand'), b.getAttribute('data-place'), b.textContent.replace(/\s+/g, ' ').trim()]));
  assert.equal(rows.length, 10, 'NEARBY_SHOW');
  assert.ok(!rows.some(([b]) => b === 'osm:n1011'), '"Subway" without brand tags is dropped (it matches a BRANDS name)');
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map(([b]) => b), ['osm:n1021', 'osm:n1001', 'osm:n1007', 'osm:n1010', 'osm:n1015', 'osm:n1014',
    'osm:n1002', 'osm:w2001', 'osm:n1016', 'osm:n1005'], 'nearest first (the Worker\'s order, from the same point); 13 - Subway = 12, show 10');
  assert.deepEqual(rows.map(([, i]) => i), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  // Each row shows the name, mi1(mi) + " mi" and the tag (UI contract §5.2), in the chain rows' layout.
  const has = (t, parts) => parts.every((x) => t.indexOf(x) >= 0);
  assert.ok(rows[0][2].startsWith('Fixture ' + 'y'.repeat(109) + '\u{1F355}'), 'a 119-unit name with an emoji is shown whole');
  assert.ok(has(rows[0][2], ['0.0 mi', 'Estimate']), rows[0][2]);
  assert.ok(rows[1][2].startsWith('Fixture Diner') && has(rows[1][2], ['0.1 mi', 'Estimate']), rows[1][2]);
  assert.equal(await H.text(o.page, '[data-testid="indie-note"]'),
    "From OpenStreetMap. We don't know which apps list these places: turn off any app that doesn't.");

  await o.page.click('[data-testid="indie-list"] [data-action="pick-place"][data-brand="osm:n1001"]');
  await H.waitText(o.page, '#order', "Fixture Diner isn't profiled: app prices use a typical casual markup, so these totals are estimates.");
  assert.equal(await o.page.$eval('#brand', (s) => s.value), 'osm:n1001');
  assert.equal(await o.page.$eval('#brand option[value="osm:n1001"]', (e) => e.textContent), 'Fixture Diner (estimate)');
  assert.equal(await o.page.getAttribute('[data-action="pick-place"][data-brand="osm:n1001"]', 'aria-pressed'), 'true');
  await H.waitText(o.page, '[data-testid="trip-src"]', 'To the Fixture Diner you picked, ');
  await settle(o.page);
  // The stub has no road route for this pair (404): the straight line stays, with one warning.
  assert.match(await H.text(o.page, '[data-testid="trip-src"]'), /^To the Fixture Diner you picked, 0\.1 mi away in a straight line/);
  await o.page.selectOption('#make', 'Toyota');
  await o.page.selectOption('#model', 'Camry');
  await H.commit(o.page, '#manualSubtotal', '20');
  await o.page.waitForSelector('[data-testid="result-row"]');
  const saved = await H.saved(o.page);
  assert.deepEqual(JSON.parse(saved).place,
    { id: 'osm:n1001', name: 'Fixture Diner', category: 'casual', lat: 45.8345, lon: -109.9512 }, 'the pick is saved');
  const PLACES = { 'osm:n1001': { name: 'Fixture Diner', category: 'casual', lat: 45.8345, lon: -109.9512 } };
  const exp = expectedWith(saved, {}, { PLACES });
  assert.equal(exp.S.rest.name, 'Fixture Diner');
  assert.deepEqual(await H.shownResults(o.page), H.wantResults(exp));
  assert.ok(!exp.R.some((r) => r.id === 'direct-d'), 'no direct delivery for an unprofiled place (D-006)');
  assert.equal(o.warns.filter((w) => w === WARN).length, 1, 'one warning for the failed /drive');
  onlyBrowserErrors(o.errors, BROWSER_ERR[404], 1, 'the /drive with no road route');
  await o.page.screenshot({ path: path.join(H.SHOTS, 'worker-independents-desktop.png'), fullPage: true });

  // A reload brings the independent back from S.place before /nearby answers.
  await o.page.reload();
  await o.page.waitForSelector('[data-testid="result-row"]');
  assert.equal(await o.page.$eval('#brand', (s) => s.value), 'osm:n1001');
  assert.deepEqual(await H.shownResults(o.page), H.wantResults(exp), 'the same prices after a reload');
  await o.ctx.close();
});

test('Worker on: a street address is geocoded; its typed ZIP keeps the tax; the trip starts from the point', async () => {
  const o = await open(on);
  await H.commit(o.page, '#address', '350 5th Ave, New York, NY 10118');
  await H.waitText(o.page, '[data-testid="loc-status"]', 'Street address · ZIP 10118, New York, NY');
  const geos = o.api.filter((r) => r.url.startsWith(API + '/geocode'));
  assert.equal(geos.length, 1);
  assert.equal(new URL(geos[0].url).searchParams.get('q'), '350 5th Ave, New York, NY 10118');
  assert.equal(await o.page.evaluate(() => JSON.stringify(window.POD.S.pos)), JSON.stringify({ lat: 40.7484421, lon: -73.9856589, src: 'addr' }));
  await o.page.selectOption('#brand', 'dominos');
  await H.waitText(o.page, '[data-testid="trip"]', '1.4 mi round trip');
  assert.equal(await H.text(o.page, '[data-testid="trip-src"]'), "To the nearest Domino's, 0.7 mi each way by road.",
    'round1(2 × 0.7) = 1.4; mi1(1.4 / 2) = 0.7 (the 10118-centroid store would give 1.1 by straight line)');
  assert.equal(await o.page.evaluate(() => window.POD.S.store.id), 'dominos@40744,-73979');
  const drive = o.api.filter((r) => r.url.startsWith(API + '/drive')).map((r) => new URL(r.url).searchParams.get('from'));
  assert.deepEqual(drive, ['40.748,-73.986'], 'from the geocoded point, at 3 decimals');
  assert.equal(await o.page.locator('[data-testid="fine-osm"]').count(), 1);
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});

test('Worker on: a bare ZIP is never sent to /geocode', async () => {
  const o = await open(on);
  await chooseZip(o.page, '10118');
  await settle(o.page);
  assert.equal(o.api.filter((r) => r.url.startsWith(API + '/geocode')).length, 0);
  await o.ctx.close();
});

// ---- on, failing: the page is the Worker-off page ---------------------------------------------

for (const mode of ['500', 'garbage', 'abort']) {
  test('Worker failing (' + mode + '): the page is exactly the Worker-off page, with one warning', async () => {
    const a = await open(off);
    const b = await open(on, { mode });
    for (const o of [a, b]) {
      await order(o.page, '10118');
      await H.commit(o.page, '#address', '350 5th Ave, New York, NY 10118');
      await H.waitText(o.page, '[data-testid="loc-status"]', 'ZIP 10118');
      await settle(o.page, 500);
    }
    assert.ok(b.api.length >= 3, 'the seam did ask (drive, nearby, geocode)');
    assert.equal(await appHtml(b.page), await appHtml(a.page), '#app is identical');
    assert.deepEqual(await H.shownResults(b.page), await H.shownResults(a.page));
    assert.equal(b.warns.filter((w) => w === WARN).length, 1, 'exactly one console.warn per page load');
    if (mode === 'garbage') assert.deepEqual(b.errors, [], 'a 200 with a bad body logs nothing');
    else onlyBrowserErrors(b.errors, BROWSER_ERR[mode === '500' ? 500 : 'abort'], b.api.length, mode);   // the page itself never console.errors
    await a.ctx.close();
    await b.ctx.close();
  });
}

test('Worker hanging: nothing waits for it, and the 4 s timeout falls back with one warning', async () => {
  const a = await open(off);
  const b = await open(on, { mode: 'hang' });
  await order(a.page, '10118');
  await order(b.page, '10118');
  assert.equal(await appHtml(b.page), await appHtml(a.page), 'rendered before any answer');
  await b.page.waitForTimeout(4600);
  assert.equal(await appHtml(b.page), await appHtml(a.page), 'still identical after the /drive timeout');
  assert.equal(b.warns.filter((w) => w === WARN).length, 1);
  assert.deepEqual(b.errors, []);
  await a.ctx.close();
  await b.ctx.close();
});

// ---- layout ---------------------------------------------------------------------------------

test('Worker on, phone width: the independents list fits (no horizontal scroll)', async () => {
  const o = await open(on, { viewport: { width: 390, height: 844 } });
  await order(o.page, '59011');
  await o.page.waitForSelector('[data-testid="indie-list"]');
  await H.waitText(o.page, '[data-testid="trip"]', '67.8 mi round trip');
  assert.ok(await H.noHorizontalScroll(o.page) <= 0, 'no horizontal scroll at 390 px');
  await o.page.screenshot({ path: path.join(H.SHOTS, 'worker-phone.png'), fullPage: true });
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});
