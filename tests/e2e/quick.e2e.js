// Phase 11 (D-042, D-043): the quick flow, against docs/ui-contract.md §2, §3, §5.2-§5.5, §5.7-§5.11 and §10.
//
// Written before the UI code (task 11.4). The budgets of §10.1: a first visit at 390x844 shows at most 8
// controls and is at most 1.5 screens tall; at most 3 user actions reach a priced answer with its button.
//
// Expected values come from the contract (titles, strings, the estOf path list, the meter formula, the
// monogram hue) and from the page's own saved state run through the verified modules in Node
// (helpers.expected: engine = oracle + receipts; state = the hand-worked scenarios, including sourceOf;
// links = the links oracle; geo = the geography fixtures). Never from render.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const H = require('./helpers');

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const NYC = { latitude: 40.749, longitude: -73.986 };   // a few blocks from ZIP 10118
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

const POD = () => H.app();
const D = () => POD().data;
const APP_NAME = { dd: 'DoorDash', ue: 'Uber Eats', gh: 'Grubhub' };
const MEMBER_NAME = { dd: 'DashPass', ue: 'Uber One', gh: 'Grubhub+' };
const r2 = (x) => Math.round((x + 1e-9) * 100) / 100;
const mi1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

/** UI contract §5.5: a route's plain-language title. */
function title(id, restName) {
  const [p, m] = id.split('-');
  if (p === 'direct') return m === 'p' ? 'Pick it up from ' + restName : 'Delivery from ' + restName;
  return APP_NAME[p] + (m === 'd' ? ' delivery' : ' pickup');
}

/** UI contract §5.5 estOf: the paths a route uses, each read with the verified POD.state.sourceOf. */
function usedPaths(S, id) {
  const [p, m] = id.split('-');
  const car = [S.fuel === 'ev' ? 'kwh' : 'mpg', 'wear'].concat(typeof S.hourly === 'number' && S.hourly > 0 ? ['speed'] : []);
  if (p === 'direct') return m === 'd' ? ['tipDel'] : ['tipPick'].concat(car);
  if (m === 'p') return ['plats.' + p + '.pickDisc', 'tipPick'].concat(car);
  const out = ['plats.' + p + '.delFee', 'plats.' + p + '.svc', 'plats.' + p + '.svcMin', 'regFee', 'smallMin', 'smallFee', 'tipDel'];
  if (S.plats[p].member) out.push('plats.' + p + '.memberSvc', 'plats.' + p + '.memberMin');
  return out;
}
function estOf(S, id) {
  // An app route also uses the category's typical markup when rest.markupEst (§5.5, engine contract §1).
  if (!id.startsWith('direct-') && S.rest && S.rest.markupEst === true) return true;
  return usedPaths(S, id).some((p) => POD().state.sourceOf(S, D(), p) === 'est');
}

/** State contract §4.8: the state paths that have a default (the ones an input can badge). */
const KEYED = new Set(['mpg', 'wear', 'kwh', 'speed', 'tipDel', 'tipPick', 'regFee', 'smallMin', 'smallFee']);
for (const p of ['dd', 'ue', 'gh']) for (const f of ['delFee', 'svc', 'svcMin', 'memberSvc', 'memberMin', 'pickDisc']) KEYED.add('plats.' + p + '.' + f);

/** UI contract §5.11: the drawer's summary. */
function moreSummary(S) {
  let car;
  if (S.fuel === 'ev' && typeof S.miPerKwh === 'number') car = 'Electric car';
  else if (S.fuel !== 'ev' && typeof S.mpg === 'number' && POD().state.sourceOf(S, D(), 'mpg') === 'est') car = 'Typical car (est.)';
  else if (S.fuel !== 'ev' && typeof S.mpg === 'number') car = S.mpg + ' mpg car';
  else car = 'No car yet';
  const members = ['dd', 'ue', 'gh'].filter((p) => S.plats[p].member).map((p) => MEMBER_NAME[p]);
  return car + ' · ' + (members.length ? members.join(', ') : 'No memberships');
}

/** UI contract §10.1: a control is a link, button, input, select or textarea with a box and visibility visible. */
async function visibleControls(page) {
  return page.$$eval('#app a[href], #app button, #app input, #app select, #app textarea', (els) => els.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible';
  }).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('data-action') ? '[' + e.getAttribute('data-action') + ']' : '')));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(H.SHOTS, name + '.png'), fullPage: true });
}
async function zip(page, code) {
  await H.commit(page, '#address', code);
  await H.waitText(page, '[data-testid="loc-status"]', 'ZIP ' + code);
  await page.waitForSelector('[data-testid="near-list"]');
}
/** The first row of the shown near list whose brand is (or isn't) profiled. */
async function firstRow(page, profiled) {
  const brands = await page.$$eval('[data-testid="near-list"] [data-action="pick-store"]', (bs) => bs.map((b) => b.getAttribute('data-brand')));
  const b = brands.find((x) => Object.prototype.hasOwnProperty.call(D().PROFILES, x) === profiled);
  assert.ok(b, 'the first ' + brands.length + ' near rows hold a ' + (profiled ? '' : 'un') + 'profiled brand');
  return '[data-testid="near-list"] [data-action="pick-store"][data-brand="' + b + '"]';
}
async function answerShows(page) {
  await page.waitForSelector('[data-testid="verdict"]', { state: 'visible' });
  await page.waitForSelector('a[data-testid="cta"]', { state: 'visible' });
}
/** ZIP 10118, the first profiled restaurant, one of its first item: an answer. */
async function toAnswer(page) {
  await zip(page, '10118');
  await page.click(await firstRow(page, true));
  await page.click('[data-action="qty"][data-index="0"][data-delta="1"]');
  await answerShows(page);
}
async function openDrawer(page) {
  await page.click('#drawer');
  await page.waitForSelector('#more section#settings');
}

// ---- §10.1 budgets on a first visit -----------------------------------------------------------

test('first visit (phone): ≤ 8 visible controls, ≤ 1.5 screens, no horizontal scroll, the drawer closed', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  const controls = await visibleControls(page);
  assert.ok(controls.length <= 8, 'visible controls: ' + controls.length + ' > 8: ' + controls.join(', '));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(height <= 1.5 * PHONE.height, 'page height ' + height + ' px > 1.5 screens (' + 1.5 * PHONE.height + ')');
  assert.ok(await H.noHorizontalScroll(page) <= 0, 'no horizontal scroll');

  // §2: the order of #app's children, the headings, the drawer closed, aria-live on #results.
  assert.deepEqual(await page.$$eval('#app > *', (es) => es.map((e) => e.id)), ['loc', 'near', 'order', 'side', 'more', 'fine']);
  assert.deepEqual(await page.$$eval('#side > section', (es) => es.map((e) => e.id)), ['results', 'insights']);
  for (const [id, h] of [['loc', 'Where are you?'], ['near', 'What are you getting?'], ['order', 'Your order'], ['results', 'Your best way to order']]) {
    assert.equal(await H.text(page, '#' + id + ' > h2'), h, id + ' heading');
  }
  assert.equal(await page.getAttribute('#drawer', 'aria-expanded'), 'false');
  assert.equal(await page.getAttribute('#drawer', 'data-action'), 'drawer');
  for (const id of ['trip', 'car', 'wallet', 'settings']) assert.equal(await page.locator('section#' + id).count(), 0, id + ' is not rendered while closed');
  assert.equal(await page.getAttribute('#app', 'aria-live'), null, '#app is no longer a live region');
  assert.equal(await page.getAttribute('#results', 'aria-live'), 'polite');
  assert.equal(await page.getAttribute('#insights', 'hidden'), '', 'no insights yet: the section is hidden');

  // D-042: the typical car means a first visit doesn't ask for a car.
  const missing = await H.text(page, '[data-testid="missing"]');
  assert.equal(missing, 'To compare, we still need: a restaurant, your ZIP or address.');
  assert.equal(await H.text(page, '[data-testid="more-summary"]'), moreSummary(H.expected(await H.saved(page) || '{}').S));
  await shot(page, 'quick-first-phone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('first visit (desktop): no horizontal scroll', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: DESKTOP });
  assert.ok(await H.noHorizontalScroll(page) <= 0, 'no horizontal scroll');
  await shot(page, 'quick-first-desktop');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §10.1 at most 3 interactions -------------------------------------------------------------

test('≤ 3 interactions by ZIP: type the ZIP, tap a restaurant, tap + → the answer card and its button', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  let actions = 0;
  await H.commit(page, '#address', '10118'); actions++;
  await page.waitForSelector('[data-testid="near-list"]');
  await page.click(await firstRow(page, true)); actions++;
  await page.click('[data-action="qty"][data-index="0"][data-delta="1"]'); actions++;
  await answerShows(page);
  assert.ok(actions <= 3, actions + ' actions');
  await shot(page, 'quick-answer-phone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('≤ 3 interactions by location: "Use my location", tap a restaurant, tap + → the answer card and its button', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, {
    viewport: PHONE, context: { geolocation: NYC, permissions: ['geolocation'] },
  });
  let actions = 0;
  await page.click('[data-action="locate"]'); actions++;
  await page.waitForSelector('[data-testid="near-list"]');
  await page.click(await firstRow(page, true)); actions++;
  await page.click('[data-action="qty"][data-index="0"][data-delta="1"]'); actions++;
  await answerShows(page);
  assert.ok(actions <= 3, actions + ' actions');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §5.5 the answer card and the rows --------------------------------------------------------

test('the answer card: title, price, saving, the hand-off, the est. note, the trip; the rows: titles, est., meters, sticky bar', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await toAnswer(page);
  const exp = H.expected(await H.saved(page));
  const S = exp.S, R = exp.R, best = R[0];
  const other = R.find((r) => r.mode !== best.mode) || null;
  const rest = S.rest.name;

  assert.equal(await H.text(page, '[data-testid="answer"] .answer-kicker'), 'Cheapest way');
  assert.equal(await H.text(page, '[data-testid="verdict"]'), title(best.id, rest));
  assert.equal(await H.text(page, '[data-testid="answer-net"]'), H.money(best.net));
  if (other) {
    const d = r2(other.net - best.net);
    assert.equal(await H.text(page, '[data-testid="save"]'), d > 0 ? 'Saves ' + H.money(d) + ' vs ' + title(other.id, rest) : 'Same price as ' + title(other.id, rest));
  } else {
    assert.equal(await page.locator('[data-testid="save"]').count(), 0, 'no route of the other kind: no saving line');
  }
  const links = POD().links.forChannel(best.id, S, D());
  assert.ok(links.length > 0, 'the best route of this fixture hands off');
  const cta = page.locator('a[data-testid="cta"]');
  assert.equal(await cta.getAttribute('href'), links[0].href);
  assert.equal((await cta.textContent()).trim(), links[0].label);
  assert.equal(await cta.getAttribute('target'), '_blank');
  assert.equal(await cta.getAttribute('rel'), 'noopener noreferrer');
  if (links[1]) assert.equal(await page.getAttribute('a[data-testid="cta-alt"]', 'href'), links[1].href);
  else assert.equal(await page.locator('[data-testid="cta-alt"]').count(), 0);

  const wantNote = estOf(S, best.id) || (!!other && estOf(S, other.id));
  assert.equal(await page.locator('[data-testid="est-note"]').count(), wantNote ? 1 : 0, 'est-note');
  if (wantNote) assert.equal(await H.text(page, '[data-testid="est-note"]'), 'Based on estimates (marked est.). Make them yours in Personalize.');
  if (R.some((r) => r.mode === 'p') && typeof S.miles === 'number') {
    assert.equal(await H.text(page, '[data-testid="answer-trip"]'), mi1(S.miles) + ' mi round trip · about ' + S.minutes + ' min');
  }

  // Rows: the engine's order, titles, est. badges, meters; the prices and receipts are the engine's.
  assert.deepEqual(await H.shownResults(page), H.wantResults(exp));
  const M = Math.max(...R.map((r) => r.net));
  for (const r of R) {
    const row = '[data-testid="result-row"][data-channel="' + r.id + '"]';
    assert.ok((await H.text(page, row + ' .result-name')).startsWith(title(r.id, rest)), r.id + ' title');
    assert.equal(await page.locator(row + ' [data-testid="est"]').count(), estOf(S, r.id) ? 1 : 0, r.id + ' est. badge');
    const w = M > 0 ? Math.round(Math.max(r.net, 0) / M * 100) : 0;
    assert.equal((await page.getAttribute(row + ' [data-testid="meter"]', 'style')).replace(/\s/g, ''), 'width:' + w + '%', r.id + ' meter');
    assert.equal(await page.getAttribute(row + ' button.result-head', 'aria-expanded'), 'false');
    assert.equal(await page.locator(row + ' [data-testid="row-more"]').isVisible(), false, r.id + ' starts closed');
  }
  assert.equal(await page.getAttribute('[data-testid="result-row"]:first-child', 'class'), 'result best');

  // D-042: with no car picked, the pickup routes use the typical car, which is an estimate.
  assert.equal(POD().state.sourceOf(S, D(), 'mpg'), 'est', 'the typical car is an estimate');
  assert.ok(R.some((r) => r.mode === 'p' && estOf(S, r.id)), 'some pickup row carries est.');

  // The sticky bar repeats the answer on a phone.
  const sticky = page.locator('[data-testid="sticky"]');
  assert.ok(await sticky.isVisible(), 'the sticky bar shows on a phone');
  assert.equal(await sticky.getAttribute('href'), '#results');
  const st = (await sticky.textContent()).replace(/\s+/g, ' ');
  assert.ok(st.includes(title(best.id, rest)) && st.includes(H.money(best.net)), st);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('desktop: the answer card, no sticky bar, no horizontal scroll with the drawer open', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: DESKTOP });
  await toAnswer(page);
  assert.equal(await page.locator('[data-testid="sticky"]').isVisible(), false, 'no sticky bar on desktop');
  await openDrawer(page);
  assert.ok(await H.noHorizontalScroll(page) <= 0, 'no horizontal scroll');
  await shot(page, 'quick-drawer-desktop');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a row opens on tap and stays open across renders; tapping again closes it', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await toAnswer(page);
  const id = (await H.expected(await H.saved(page))).R[0].id;
  const row = '[data-testid="result-row"][data-channel="' + id + '"]';
  await page.click('#row-' + id);
  assert.equal(await page.getAttribute('#row-' + id, 'aria-expanded'), 'true');
  assert.equal(await page.getAttribute(row, 'class'), 'result best open');
  assert.ok(await page.locator(row + ' [data-testid="row-more"]').isVisible(), 'open');
  assert.ok(await page.locator(row + ' [data-testid="receipt"]').isVisible(), 'its receipt shows');

  // A state change re-renders the rows: the open one stays open, with the new receipt.
  await page.click('[data-action="qty"][data-index="0"][data-delta="1"]');
  await H.waitText(page, '[data-testid="qty-0"]', '2');
  const exp = H.expected(await H.saved(page));
  const now = '[data-testid="result-row"][data-channel="' + id + '"]';
  assert.ok(await page.locator(now + ' [data-testid="row-more"]').isVisible(), 'still open after a render');
  assert.deepEqual(await H.shownResults(page), H.wantResults(exp));
  await page.click('#row-' + id);
  assert.equal(await page.locator(now + ' [data-testid="row-more"]').isVisible(), false, 'closed again');
  assert.equal(await page.getAttribute('#row-' + id, 'aria-expanded'), 'false');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §5.2 search and monograms ----------------------------------------------------------------

test('search: typing filters the near list by name, keeps focus and the same box, and never saves', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await zip(page, '10118');
  const S = H.expected(await H.saved(page)).S;
  const near = POD().geo.storesNear(S.pos.lat, S.pos.lon, D(), { failed: {} });
  const nameOf = (b) => (D().BRANDS[b] && D().BRANDS[b].name) || b;

  // Monograms: decoration from the name and the brand id.
  const b0 = near.stores[0].brand;
  const first = '[data-testid="near-list"] [data-store="0"]';
  assert.equal(await H.text(page, first + ' .mono'), nameOf(b0).charAt(0).toUpperCase());
  const h = b0.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
  assert.equal((await page.getAttribute(first + ' .mono', 'style')).replace(/\s/g, ''), '--h:' + h);
  assert.equal(await page.getAttribute(first + ' .mono', 'aria-hidden'), 'true');

  const box = await page.$('#search');
  assert.equal(await box.getAttribute('value'), null, 'no value attribute');
  await page.focus('#search');
  await page.keyboard.type('pi', { delay: 30 });
  const want = near.stores.map((s, i) => ({ i, brand: s.brand })).filter((x) => nameOf(x.brand).toLowerCase().includes('pi')).slice(0, 15);
  assert.ok(want.length > 0, 'the fixture has a match for "pi"');
  const shown = await page.$$eval('[data-testid="near-list"] [data-action="pick-store"]', (bs) => bs.map((b) => ({ i: Number(b.getAttribute('data-store')), brand: b.getAttribute('data-brand') })));
  assert.deepEqual(shown, want, 'rows matching "pi", each keeping its index in the whole list');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'search', 'focus stays in the box');
  assert.equal(await box.evaluate((e) => e.isConnected), true, 'the same box: never replaced while typing');
  assert.equal(await box.evaluate((e) => e.value), 'pi');

  await page.keyboard.type('zzz', { delay: 30 });
  assert.equal(await H.text(page, '[data-testid="near-empty"]'), 'Nothing near you matches “pizzz”.');
  assert.equal(await page.locator('[data-testid="near-list"]').count(), 0);
  await page.fill('#search', '');
  await page.waitForSelector('[data-testid="near-list"]');
  assert.ok(!(await H.saved(page)).includes('pizzz'), 'the query is never saved');

  // A filtered row picks the right store: its data-store indexes the whole list.
  await page.keyboard.type('pi', { delay: 30 });
  await page.click('[data-testid="near-list"] [data-store="' + want[0].i + '"]');
  await page.waitForFunction((b) => {
    const e = document.querySelector('[data-testid="near-list"] [data-brand="' + b + '"]');
    return !!e && e.getAttribute('aria-pressed') === 'true';
  }, want[0].brand);
  assert.equal(H.expected(await H.saved(page)).S.brand, want[0].brand);

  // A new place resets the query: an empty box and an unfiltered list (§3).
  await page.focus('#search');
  await page.keyboard.type('zzz', { delay: 30 });
  await page.waitForSelector('[data-testid="near-empty"]');
  await zip(page, '10001');
  assert.equal(await page.inputValue('#search'), '', 'the box is cleared');
  const S2 = H.expected(await H.saved(page)).S;
  const near2 = POD().geo.storesNear(S2.pos.lat, S2.pos.lon, D(), { failed: {} });
  assert.equal(await page.locator('[data-testid="near-list"] [data-action="pick-store"]').count(), Math.min(15, near2.stores.length), 'the list is unfiltered');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §5.3 quick totals ------------------------------------------------------------------------

test('quick totals: an unprofiled restaurant takes $15, $25 or $40 in one tap', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await zip(page, '10118');
  await page.click(await firstRow(page, false));
  await page.waitForSelector('[data-action="chip"]');
  assert.deepEqual(await page.$$eval('[data-action="chip"]', (cs) => cs.map((c) => [c.getAttribute('data-amount'), c.textContent.trim(), c.getAttribute('aria-pressed')])),
    [['15', '$15', 'false'], ['25', '$25', 'false'], ['40', '$40', 'false']]);
  await page.click('[data-action="chip"][data-amount="25"]');
  await answerShows(page);
  assert.equal(await page.inputValue('#manualSubtotal'), '25');
  assert.equal(H.expected(await H.saved(page)).S.manualSubtotal, 25);
  assert.deepEqual(await page.$$eval('[data-action="chip"]', (cs) => cs.map((c) => c.getAttribute('aria-pressed'))), ['false', 'true', 'false']);
  await page.click('[data-action="chip"][data-amount="40"]');
  await page.waitForFunction(() => document.querySelector('#manualSubtotal').value === '40');
  const exp = H.expected(await H.saved(page));
  assert.equal(exp.S.manualSubtotal, 40);
  assert.deepEqual(await H.shownResults(page), H.wantResults(exp));
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §5.11 the drawer -------------------------------------------------------------------------

test('the drawer: its summary, opening and closing, a commit inside it keeps it open, memberships first', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await toAnswer(page);
  let exp = H.expected(await H.saved(page));
  assert.equal(await H.text(page, '[data-testid="more-summary"]'), moreSummary(exp.S));
  assert.equal(await H.text(page, '#drawer'), 'Personalize', 'the toggle holds only its title (and an empty chevron)');

  await openDrawer(page);
  assert.equal(await page.getAttribute('#drawer', 'aria-expanded'), 'true');
  assert.deepEqual(await page.$$eval('#more > *', (es) => es.map((e) => e.id || e.getAttribute('data-testid'))),
    ['drawer', 'more-summary', 'trip', 'car', 'wallet', 'settings']);
  assert.equal(await H.text(page, '#wallet > h2'), 'Memberships and cards');
  const membersFirst = await page.evaluate(() => {
    const m = document.getElementById('memberOwn-dd');
    const c = document.querySelector('#wallet [data-action="toggle-card"]');
    return !!m && !!c && !!(m.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(membersFirst, 'the memberships come before the cards');

  // A commit inside the drawer re-renders; the drawer stays open (it's view state, not <details>).
  await H.commit(page, '#tipDel', '20');
  await page.waitForFunction(() => /"tipDel":20/.test(window.localStorage.getItem('pod.v5') || ''));
  assert.equal(await page.getAttribute('#drawer', 'aria-expanded'), 'true');
  assert.equal(await page.locator('#more section#settings').count(), 1, 'still open after a commit');

  await page.click('#memberOwn-dd');
  exp = H.expected(await H.saved(page));
  assert.equal(exp.S.plats.dd.member, true);
  await H.waitText(page, '[data-testid="more-summary"]', 'DashPass');
  assert.equal(await H.text(page, '[data-testid="more-summary"]'), moreSummary(exp.S));

  await page.click('#drawer');
  assert.equal(await page.getAttribute('#drawer', 'aria-expanded'), 'false');
  for (const id of ['trip', 'car', 'wallet', 'settings']) assert.equal(await page.locator('section#' + id).count(), 0, id + ' gone when closed');
  assert.ok(!(await H.saved(page)).includes('drawer'), 'open/closed is never saved');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the drawer toggle: a click while a box inside the drawer commits still lands (§2, §5.11)', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await toAnswer(page);
  await openDrawer(page);
  await page.fill('#tipDel', '21');                  // focus stays in the box: no change event yet
  await page.click('#drawer');                       // mouse down blurs the box -> change -> render -> the click
  await page.waitForFunction(() => /"tipDel":21/.test(window.localStorage.getItem('pod.v5') || ''));
  // Had the commit's render replaced the toggle under the pointer, the click would be lost and the drawer still open.
  // (The click itself then replaces the toggle, since aria-expanded changes: §2. So no element-identity check here.)
  assert.equal(await page.getAttribute('#drawer', 'aria-expanded'), 'false', 'the click landed: the drawer closed');
  assert.equal(await page.locator('section#settings').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- D-042 est. labels and a one-tap correction ----------------------------------------------

test('est. labels: the typical car and the estimated inputs are marked; a typed mpg removes the mark everywhere', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE });
  await toAnswer(page);
  await openDrawer(page);
  let exp = H.expected(await H.saved(page));
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), 'Typical car · ' + String(exp.S.mpg) + ' mpg · est.');

  // Every keyed number input carries the badge exactly when its value is still the estimate.
  const inputs = await page.$$eval('#more input[type="number"][data-bind]', (es) => es.map((e) => ({ id: e.id, path: e.getAttribute('data-bind') })));
  let badged = 0;
  for (const { id, path: p } of inputs) {
    const want = KEYED.has(p) && POD().state.sourceOf(exp.S, D(), p) === 'est';
    if (want) badged++;
    assert.equal(await page.locator('label[for="' + id + '"] [data-testid="est-' + id + '"]').count(), want ? 1 : 0, id + ' badge');
  }
  assert.ok(badged > 0 || inputs.every((x) => !KEYED.has(x.path) || POD().state.sourceOf(exp.S, D(), x.path) !== 'est'), 'badges counted');

  // "Other" keeps the typical car (D-042) and shows its mpg box, marked est.
  await page.selectOption('#make', 'Other');
  await page.waitForSelector('#mpg');
  exp = H.expected(await H.saved(page));
  assert.equal(exp.S.mpg, D().DEFAULTS.trip.mpg, 'Other falls back to the typical car');
  assert.equal(await page.locator('label[for="mpg"] [data-testid="est-mpg"]').count(), 1, 'the mpg box is marked est.');

  // One correction: the user's own mpg. The mark goes from the box, the car summary, the rows and the note.
  await H.commit(page, '#mpg', '31');
  await H.waitText(page, '[data-testid="car-summary"]', '31 mpg');
  exp = H.expected(await H.saved(page));
  assert.equal(POD().state.sourceOf(exp.S, D(), 'mpg'), 'you');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '31 mpg · regular');
  assert.equal(await page.locator('label[for="mpg"] [data-testid="est-mpg"]').count(), 0, 'no mark on the typed mpg');
  for (const r of exp.R) {
    assert.equal(await page.locator('[data-testid="result-row"][data-channel="' + r.id + '"] [data-testid="est"]').count(), estOf(exp.S, r.id) ? 1 : 0, r.id + ' est. after the correction');
  }
  const best = exp.R[0], other = exp.R.find((r) => r.mode !== best.mode) || null;
  assert.equal(await page.locator('[data-testid="est-note"]').count(), estOf(exp.S, best.id) || (!!other && estOf(exp.S, other.id)) ? 1 : 0, 'est-note after the correction');
  assert.ok(await H.noHorizontalScroll(page) <= 0, 'no horizontal scroll with the drawer open');
  await shot(page, 'quick-drawer-phone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §10.2 contrast (WCAG AA) in both themes ---------------------------------------------------

for (const scheme of ['light', 'dark']) {
  test('contrast (' + scheme + '): body text, the answer price and the button text meet WCAG AA 4.5:1', async () => {
    const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: PHONE, context: { colorScheme: scheme } });
    await toAnswer(page);
    const pairs = await page.evaluate(() => {
      const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
      const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = rgb(getComputedStyle(e).backgroundColor);
          if (c.length >= 3 && (c.length < 4 || c[3] > 0)) return c.slice(0, 3);
        }
        return [255, 255, 255];
      };
      const pick = (sel) => {
        const el = document.querySelector(sel);
        return el ? { sel, fg: rgb(getComputedStyle(el).color).slice(0, 3), bg: bgOf(el) } : { sel, missing: true };
      };
      return [pick('[data-testid="missing"], [data-testid="answer"] .answer-kicker'), pick('[data-testid="answer-net"]'), pick('a[data-testid="cta"]'),
        pick('#loc > h2'), pick('[data-testid="result-row"] .result-name')];
    });
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const p of pairs) {
      assert.ok(!p.missing, p.sel + ' is on the page');
      const a = lum(p.fg), b = lum(p.bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 4.5, scheme + ' ' + p.sel + ': contrast ' + ratio.toFixed(2) + ' < 4.5 (' + p.fg + ' on ' + p.bg + ')');
    }
    await shot(page, 'quick-answer-phone-' + scheme);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
