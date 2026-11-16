// helpers.js: shared e2e plumbing (not a test file: the e2e glob is *.e2e.js).
//
// - buildSite(): a throwaway copy of the site (index.html + src/) in the OS temp dir, with the
//   committed fixture tiles (tests/fixtures/stores/) installed as src/data/stores/, the way the
//   Pages build installs real tiles (D-011, D-021). The repo itself is never written to.
// - expected(saved): what the page should show, computed in Node from the state the page saved,
//   with the verified modules (engine: oracle + receipts; state: scenarios; insights: oracle).
//   The UI is what's under test; these modules aren't.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadApp, APP_ROOT } = require('../helpers/load');

const FIXTURE_TILES = path.join(APP_ROOT, 'tests', 'fixtures', 'stores');
const SHOTS = path.join(__dirname, 'screenshots');
const KEY = 'pod.v5';

function buildSite({ omitTiles = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-site-'));
  fs.copyFileSync(path.join(APP_ROOT, 'index.html'), path.join(dir, 'index.html'));
  fs.cpSync(path.join(APP_ROOT, 'src'), path.join(dir, 'src'), {
    recursive: true,
    filter: (p) => !p.startsWith(path.join(APP_ROOT, 'src', 'data', 'stores')),
  });
  fs.mkdirSync(path.join(dir, 'src', 'data', 'stores'), { recursive: true });
  for (const f of fs.readdirSync(FIXTURE_TILES)) {
    if (!f.endsWith('.js') || omitTiles.includes(f.replace(/\.js$/, ''))) continue;
    fs.copyFileSync(path.join(FIXTURE_TILES, f), path.join(dir, 'src', 'data', 'stores', f));
  }
  return { dir, url: pathToFileURL(path.join(dir, 'index.html')).href, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

let APP = null;
function app() {
  if (!APP) {
    const tiles = fs.readdirSync(FIXTURE_TILES).filter((f) => f.endsWith('.js')).map((f) => path.join('tests', 'fixtures', 'stores', f));
    APP = loadApp({ extra: tiles }).POD;
  }
  return APP;
}

const J = (v) => JSON.parse(JSON.stringify(v));

/** What the page should show for a saved state text. */
function expected(saved, now = new Date()) {
  const POD = app();
  const storage = { getItem: () => saved, setItem() {} };
  const S = POD.state.load(storage, POD.data, now, { failed: {} });
  const F = POD.state.forEngine(S);
  const R = F ? POD.engine.allResults(F) : null;
  return {
    S: J(S),
    missing: J(POD.state.missing(S)),
    R: R ? J(R) : null,
    insights: R ? J(POD.insights.build(F, R, now)) : null,
    appMissing: (p) => J(POD.state.appMissing(S, p)),
  };
}

/** POD.util.money's format, written independently: "$1,234.56", negatives with U+2212. */
function money(n) {
  const v = Math.abs(n).toFixed(2).split('.');
  v[0] = v[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '−$' : '$') + v.join('.');
}

/** Opens a page that records console errors and uncaught exceptions. */
async function openPage(browser, url, { viewport = { width: 1280, height: 800 }, context = {}, init = null } = {}) {
  const ctx = await browser.newContext({ viewport, ...context });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForSelector('#results');
  return { ctx, page, errors };
}

/** Sets a text or number box and commits it the way a user does (the box loses focus → change). */
async function commit(page, selector, value) {
  const el = page.locator(selector);
  await el.fill(String(value));
  await el.evaluate((e) => e.blur());
}

async function text(page, selector) {
  return (await page.locator(selector).first().textContent()).replace(/\s+/g, ' ').trim();
}

async function waitText(page, selector, part, timeout = 5000) {
  await page.waitForFunction(([s, t]) => {
    const e = document.querySelector(s);
    return !!e && e.textContent.replace(/\s+/g, ' ').indexOf(t) >= 0;
  }, [selector, part], { timeout });
}

async function saved(page) {
  return page.evaluate((k) => window.localStorage.getItem(k), KEY);
}

/** The results the page shows: [{id, net, lines: [[label, amount]]}]. */
async function shownResults(page) {
  return page.$$eval('[data-testid="result-row"]', (rows) => rows.map((r) => ({
    id: r.getAttribute('data-channel'),
    net: r.querySelector('[data-testid="net"]').textContent.trim(),
    lines: Array.from(r.querySelectorAll('[data-testid="line"]')).map((l) => [
      l.querySelector('[data-testid="line-label"]').textContent.trim(),
      l.querySelector('[data-testid="line-amount"]').textContent.trim(),
    ]),
  })));
}

/** The results the page should show for its saved state, in shownResults' shape. */
function wantResults(exp) {
  return exp.R.map((r) => ({
    id: r.id,
    net: money(r.net),
    lines: r.lines.map(([label, amt]) => [label, label === 'Delivery fee' && amt === 0 ? 'waived' : money(amt)]),
  }));
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

module.exports = {
  buildSite, expected, money, openPage, commit, text, waitText, saved, shownResults, wantResults,
  noHorizontalScroll, SHOTS, KEY, app,
};
