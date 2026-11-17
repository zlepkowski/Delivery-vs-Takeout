// links.e2e.js: D-041 on the page (links contract §3; UI contract §5.5 step 3, §5.10).
// Written by the orchestrator before the builder (D-035 pattern).
// Migrated to D-042/D-043 (task 11.5c): a row's hand-off sits in its hidden row-more until the row is
// opened; the trip, car and settings live in the Personalize drawer; the verdict is the plain title.
//
// Phase 9's done-when, "every result row hands off", on the real page over file://, with the
// committed fixture tiles. Every expected link is written out by hand from src/data/links.js and
// the contract: the row ids come from the verified modules on the page's saved state (as in
// checklist.e2e.js), and the stores from the fixture tiles (POD.geo, verified in Phase 3). No test
// reaches the network: every http(s) request is recorded and aborted.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const H = require('./helpers');

const DD = 'https://www.doordash.com/search/store/';
const GDIR = 'https://www.google.com/maps/dir/?api=1&destination=';
const GFIND = 'https://www.google.com/maps/search/?api=1&query=';
const UE = { kind: 'app', label: 'Open Uber Eats', href: 'https://www.ubereats.com/' };
const GH = { kind: 'app', label: 'Open Grubhub', href: 'https://www.grubhub.com/' };
const FINE = "Links open each app, the restaurant's own site or Google Maps. Your order doesn't carry over, so add your items there. A link carries only the restaurant's name or the store's location, never your address.";

let browser;
let site;

test.before(async () => {
  browser = await chromium.launch();
  site = H.buildSite();
  fs.mkdirSync(H.SHOTS, { recursive: true });
});
test.after(async () => {
  if (browser) await browser.close();
  if (site) site.remove();
});

/** A page whose http(s) requests are recorded and aborted (none should happen until a link is clicked). */
async function open({ viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const requests = [];
  await ctx.route(/^https?:\/\//, (route) => { requests.push(route.request().url()); return route.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(site.url);
  await page.waitForSelector('#results');
  return { ctx, page, errors, requests };
}

/** Each result row's hand-off as the page shows it: [{id, blocks, links: [{kind, label, href, target, rel}]}]. */
async function handoffs(page) {
  return page.$$eval('[data-testid="result-row"]', (rows) => rows.map((r) => ({
    id: r.getAttribute('data-channel'),
    blocks: r.querySelectorAll('[data-testid="handoff"]').length,
    links: Array.from(r.querySelectorAll('[data-testid="handoff"] a')).map((a) => ({
      testid: a.getAttribute('data-testid'),
      kind: a.getAttribute('data-kind'),
      label: a.textContent.replace(/\s+/g, ' ').trim(),
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
      cls: a.getAttribute('class'),
    })),
  })));
}

/**
 * Opens every result row that's shut (UI contract §5.5 item 3, D-043): a row's hand-off is in its
 * hidden row-more until its head is clicked. A row that's already open is left alone.
 */
async function openRows(page) {
  const ids = await page.$$eval('[data-testid="result-row"]', (rows) => rows.map((r) => r.getAttribute('data-channel')));
  for (const id of ids) {
    const head = page.locator('#row-' + id);
    if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
    await page.waitForSelector('[data-testid="result-row"][data-channel="' + id + '"] [data-testid="row-more"]:not([hidden])');
  }
}

/** The rows the page should show (verified modules on the saved state), with the links worked by hand. */
async function checkRows(page, want, where) {
  const exp = H.expected(await H.saved(page));
  const got = await handoffs(page);
  assert.deepEqual(got.map((r) => r.id), exp.R.map((r) => r.id), where + ': the rows are the engine\'s');
  assert.deepEqual(got.map((r) => r.id).slice().sort(), Object.keys(want).sort(), where + ': a hand-worked hand-off for every row');
  for (const r of got) {
    assert.equal(r.blocks, 1, where + ' ' + r.id + ': exactly one hand-off block (every row hands off)');
    assert.ok(r.links.length >= 1, where + ' ' + r.id + ': at least one link');
    for (const l of r.links) {
      assert.equal(l.testid, 'handoff-link', where + ' ' + r.id);
      assert.equal(l.cls, 'handoff-link', where + ' ' + r.id);
      assert.equal(l.target, '_blank', where + ' ' + r.id + ': opens a new tab');
      assert.equal(l.rel, 'noopener noreferrer', where + ' ' + r.id);
      assert.ok(l.href.startsWith('https://'), where + ' ' + r.id + ': https only');
    }
    assert.deepEqual(r.links.map(({ kind, label, href }) => ({ kind, label, href })), want[r.id], where + ' ' + r.id);
  }
  // D-043 (UI contract §5.5 item 3): the row is head, notes, then row-more; inside row-more the hand-off
  // comes before the receipt. (Was: the hand-off as a direct child of the row, before a <details> receipt.)
  const order = await page.$$eval('[data-testid="result-row"]', (rows) => rows.map((r) => ({
    row: Array.from(r.children).map((c) => c.className.split(' ')[0]),
    more: Array.from(r.querySelector('[data-testid="row-more"]').children).map((c) =>
      c.getAttribute('data-testid') || c.className.split(' ')[0]),
  })));
  for (const { row, more } of order) {
    assert.ok(row.indexOf('result-head') === 0 && row.indexOf('row-more') > row.indexOf('result-head'),
      where + ': head, then row-more: ' + row.join(','));
    assert.ok(more.indexOf('handoff') >= 0 && more.indexOf('handoff') < more.indexOf('receipt'),
      where + ': in row-more, hand-off, then receipt: ' + more.join(','));
  }
  return exp;
}

async function car(page) {
  await page.selectOption('#make', 'Toyota');
  await page.selectOption('#model', 'Camry');
}
async function chain(page, zip, brand) {
  // The trip and the car are in the Personalize drawer (D-043); it stays open across renders.
  await H.openDrawer(page);
  await H.commit(page, '#address', zip);
  await H.waitText(page, '[data-testid="loc-status"]', 'ZIP ' + zip);
  await page.selectOption('#brand', brand);
  await H.waitText(page, '[data-testid="trip"]', 'mi round trip');
  await car(page);
}

test('the first-visit example: Domino\'s at 10118, every row hands off', async () => {
  const o = await open();
  await o.page.click('[data-action="example"]');
  await o.page.waitForSelector('[data-testid="result-row"]');
  const exp = await checkRows(o.page, {
    'direct-p': [
      { kind: 'order', label: "Order from Domino's", href: 'https://www.dominos.com/' },
      { kind: 'dir', label: 'Directions in Google Maps', href: GDIR + '40.75500%2C-73.98900' },
    ],
    'dd-p': [{ kind: 'search', label: "Search DoorDash for Domino's", href: DD + "Domino's/" }],
    'ue-p': [UE],
  }, 'example');
  assert.deepEqual(exp.S.store, { id: 'dominos@40755,-73989', lat: 40.755, lon: -73.989 }, 'the store the directions go to');
  assert.equal(await H.text(o.page, '[data-testid="fine-links"]'), FINE);
  assert.deepEqual(o.requests, [], 'no request until a link is clicked');
  assert.deepEqual(o.errors, []);
  await o.page.screenshot({ path: path.join(H.SHOTS, 'links-example-desktop.png'), fullPage: true });
  await o.ctx.close();
});

test('an unprofiled chain (Taco Bell at 10118): directions and the apps, no site', async () => {
  const o = await open();
  await chain(o.page, '10118', 'taco_bell');
  await H.commit(o.page, '#manualSubtotal', '20');
  await o.page.waitForSelector('[data-testid="result-row"]');
  await checkRows(o.page, {
    'direct-p': [{ kind: 'dir', label: 'Directions in Google Maps', href: GDIR + '40.74900%2C-73.99500' }],
    'dd-p': [{ kind: 'search', label: 'Search DoorDash for Taco Bell', href: DD + 'Taco%20Bell/' }],
    'ue-p': [UE],
    'gh-p': [GH],
  }, 'taco bell');
  // A pinned distance keeps the store (state contract §6), so the directions stay.
  await H.commit(o.page, '#pinMiles', '3');
  await o.page.click('[data-action="pin"]');
  await H.waitText(o.page, '[data-testid="trip-src"]', 'You set this distance.');
  const pinned = await handoffs(o.page);
  assert.deepEqual(pinned.find((r) => r.id === 'direct-p').links.map((l) => l.href), [GDIR + '40.74900%2C-73.99500']);
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});

test('a profiled chain with no store nearby (Papa John\'s at 59011): the site, then a map search by name', async () => {
  const o = await open();
  await chain(o.page, '59011', 'papa_johns');
  await H.waitText(o.page, '[data-testid="trip-src"]', 'Estimated from how close together restaurants are');
  await o.page.click('[data-action="qty"][data-index="0"][data-delta="1"]');
  await o.page.waitForSelector('[data-testid="result-row"]');
  const exp = await checkRows(o.page, {
    'direct-p': [
      { kind: 'order', label: "Order from Papa John's", href: 'https://www.papajohns.com/' },
      { kind: 'map', label: "Find Papa John's in Google Maps", href: GFIND + "Papa%20John's" },
    ],
    'dd-p': [{ kind: 'search', label: "Search DoorDash for Papa John's", href: DD + "Papa%20John's/" }],
    'ue-p': [UE],
  }, 'papa johns');
  assert.equal(exp.S.store, null, 'no Papa John\'s within 50 mi of Big Timber in the fixture tiles');
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});

test('direct delivery (Wingstop, with DoorDash\'s fees entered): the chain\'s site', async () => {
  const o = await open();
  await chain(o.page, '10118', 'wingstop');
  await o.page.click('[data-action="qty"][data-index="0"][data-delta="1"]');
  await o.page.click('[data-action="qty"][data-index="0"][data-delta="1"]');
  // The fees are entered in the drawer's settings (UI contract §5.9): those boxes always exist, while
  // the §5.5 step 4 "#need-*" boxes show only for a fee that's null in the data (D-042 estimates some).
  for (const [id, v] of [['#plats-dd-delFee', '2.99'], ['#plats-dd-svcMin', '3'], ['#regFee', '0'],
    ['#smallMin', '10'], ['#smallFee', '2']]) {
    await H.commit(o.page, id, v);
  }
  await o.page.waitForSelector('[data-testid="result-row"][data-channel="dd-d"]');
  await checkRows(o.page, {
    'direct-p': [
      { kind: 'order', label: 'Order from Wingstop', href: 'https://www.wingstop.com/' },
      { kind: 'dir', label: 'Directions in Google Maps', href: GDIR + '40.74100%2C-73.98300' },
    ],
    'direct-d': [{ kind: 'order', label: 'Order from Wingstop', href: 'https://www.wingstop.com/' }],
    'dd-p': [{ kind: 'search', label: 'Search DoorDash for Wingstop', href: DD + 'Wingstop/' }],
    'dd-d': [{ kind: 'search', label: 'Search DoorDash for Wingstop', href: DD + 'Wingstop/' }],
  }, 'wingstop');
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});

test('a click opens the link in a new tab and leaves the page as it was', async () => {
  const o = await open();
  await o.page.click('[data-action="example"]');
  await o.page.waitForSelector('[data-testid="result-row"]');
  // Opening the rows is a re-render (D-043), so the snapshot is taken after they're open.
  await openRows(o.page);
  const before = await o.page.$eval('#app', (e) => e.innerHTML);
  const url = o.page.url();
  for (const [ch, href] of [['dd-p', DD + "Domino's/"], ['direct-p', 'https://www.dominos.com/']]) {
    const [t] = await Promise.all([
      o.ctx.waitForEvent('page'),
      o.page.click('[data-testid="result-row"][data-channel="' + ch + '"] [data-testid="handoff-link"]'),
    ]);
    await t.waitForLoadState('domcontentloaded').catch(() => {});
    assert.equal(o.requests[o.requests.length - 1], new URL(href).href, ch + ': the new tab asked for the link');
    await t.close();
  }
  assert.equal(o.page.url(), url, 'the page didn\'t navigate');
  assert.equal(await o.page.$eval('#app', (e) => e.innerHTML), before, 'nothing re-rendered');
  assert.equal(o.requests.length, 2, 'only the two clicks reached the network');
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});

test('phone width: the hand-offs fit (no horizontal scroll), long labels wrap inside their link', async () => {
  const o = await open({ viewport: { width: 390, height: 844 } });
  await chain(o.page, '10118', 'applebees_neighborhood_grill_and_bar');
  await H.commit(o.page, '#manualSubtotal', '30');
  await o.page.waitForSelector('[data-testid="result-row"]');
  await openRows(o.page);                                   // the links are visible only once their row is open (D-043)
  const got = await handoffs(o.page);
  assert.ok(got.length >= 2 && got.every((r) => r.blocks === 1 && r.links.length >= 1), 'every row hands off');
  assert.ok(got.some((r) => r.links.some((l) => l.label === "Search DoorDash for Applebee's Neighborhood Grill & Bar")),
    'the long name is in a label');
  assert.equal(await H.noHorizontalScroll(o.page), 0, 'no horizontal scroll at 390 px');
  const over = await o.page.$$eval('[data-testid="handoff-link"]', (as) => as.filter((a) => {
    const b = a.getBoundingClientRect();
    return b.left < 0 || b.right > window.innerWidth;
  }).length);
  assert.equal(over, 0, 'every link inside the viewport');
  await o.page.locator('[data-testid="results-list"]').screenshot({ path: path.join(H.SHOTS, 'links-phone.png') });
  assert.deepEqual(o.errors, []);
  await o.ctx.close();
});
