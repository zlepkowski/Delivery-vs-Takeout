// The BUILD.md §13 checklist, automated (Phase 5 done-when), against docs/ui-contract.md (D-035).
//
// Manual checklist: load the page, switch restaurant, switch to an EV, toggle three cards, type a
// ZIP in another state, pin a distance, reload and confirm it persisted. Plus the §13 scenarios
// that need the page (1-7), the first visit, the example, geolocation, escaping and the layout.
//
// The page runs from a temp copy of the site with the committed fixture tiles (helpers.buildSite).
// Expected prices come from the page's own saved state run through the verified engine, state and
// insights modules in Node (helpers.expected), or are literal facts from the data and fixtures.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const H = require('./helpers');

const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
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
const stateRow = (st) => POD().data.STATES.find((r) => r[0] === st);

async function chooseZip(page, zip) {
  await H.commit(page, '#address', zip);
  await H.waitText(page, '[data-testid="loc-status"]', 'ZIP ' + zip);
}
/** Picks a brand's row in "Near you", opening "Show all" first when the row is past the first 15 (contract §5.2). */
async function pickBrandFromList(page, brand) {
  const row = '[data-testid="near-list"] [data-action="pick-store"][data-brand="' + brand + '"]';
  await page.waitForSelector('[data-testid="near-list"]');
  if (await page.locator(row).count() === 0) await page.click('[data-action="more-stores"]');
  await page.click(row);
  await H.waitText(page, '[data-testid="trip"]', 'mi round trip');
}
/** Clicks a checkbox and checks it took (a re-render replaces the element, so query again). */
async function tick(page, selector) {
  await page.click(selector);
  assert.ok(await page.isChecked(selector), selector + ' is checked');
}
async function chooseCar(page, make, model) {
  await page.selectOption('#make', make);
  await page.selectOption('#model', model);
}
async function addItem(page, i, times = 1) {
  for (let k = 0; k < times; k++) await page.click('[data-action="qty"][data-index="' + i + '"][data-delta="1"]');
}
async function assertResultsMatchSaved(page, label) {
  const exp = H.expected(await H.saved(page));
  assert.ok(exp.R && exp.R.length > 0, label + ': the saved state prices something');
  assert.deepEqual(await H.shownResults(page), H.wantResults(exp), label + ': the results shown are the engine\'s for the saved state');
  assert.equal(await H.text(page, '[data-testid="verdict"]'), 'Cheapest: ' + exp.R[0].name + ' at ' + H.money(exp.R[0].net), label + ': verdict');
  return exp;
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(H.SHOTS, name + '.png'), fullPage: true });
}

// ---- first visit -------------------------------------------------------------------------------

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test('first visit (' + vp + '): asks for location, restaurant and car; offers the example; no console errors', async () => {
    const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: size });
    assert.equal(await H.text(page, '[data-testid="loc-status"]'), 'Type your ZIP or address, or use your location.');
    const missing = await H.text(page, '[data-testid="missing"]');
    assert.ok(missing.startsWith('To compare, we still need: a restaurant, your ZIP or address, your car'), missing);
    assert.ok(await page.locator('[data-action="example"]').isVisible(), 'the example button shows');
    const options = await page.$$eval('#brand option', (os) => os.map((o) => o.value));
    assert.equal(options[0], '');
    assert.equal(options.length, POD().data.BRAND_IDS.length + 1, 'every brand is offered');
    for (const id of ['loc', 'near', 'order', 'trip', 'results', 'insights', 'car', 'wallet', 'settings', 'fine']) {
      assert.equal(await page.locator('section#' + id).count(), 1, 'section ' + id);
    }
    assert.ok(await H.noHorizontalScroll(page) <= 0, 'no horizontal scroll');
    await shot(page, 'first-visit-' + vp);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

// ---- the §13 manual checklist, end to end, then a reload -------------------------------------

test('§13 checklist: load, switch restaurant, EV, three cards, ZIP in another state, pin, reload persists', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);

  // Load the page; a location and a restaurant from "Near you".
  await chooseZip(page, '10118');
  assert.equal(await H.text(page, '[data-testid="loc-status"]'), 'ZIP 10118 · New York, NY');
  assert.ok((await H.text(page, '[data-testid="tax-gas"]')).startsWith('Meal tax ' + stateRow('NY')[3] + '%'));
  await page.waitForSelector('[data-testid="near-list"]');
  // Geo fixtures: 82 brands within 5 mi of 10118; the list shows 15, then "Show all 82" (contract §5.2).
  assert.equal(await page.locator('[data-testid="near-list"] [data-action="pick-store"]').count(), 15, 'the first 15 nearby brands');
  assert.equal(await H.text(page, '[data-action="more-stores"]'), 'Show all 82');
  await pickBrandFromList(page, 'dominos');
  assert.equal(await page.locator('[data-testid="near-list"] [data-action="pick-store"]').count(), 82, 'every brand after "Show all"');
  assert.equal(await page.getAttribute('[data-testid="near-list"] [data-brand="dominos"]', 'aria-pressed'), 'true');
  assert.equal(await page.locator('[data-testid="menu-item"]').count(), POD().data.PROFILES.dominos.menu.length);
  await chooseCar(page, 'Toyota', 'Camry');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '46 mpg · regular');
  await H.waitText(page, '[data-testid="empty-order"]', 'Add something to your order to compare.');
  await addItem(page, 0);
  await addItem(page, 6);
  assert.equal(await H.text(page, '[data-testid="qty-0"]'), '1');
  let exp = await assertResultsMatchSaved(page, 'Domino\'s');
  const ids = exp.R.map((r) => r.id);
  assert.ok(ids.includes('dd-p') && ids.includes('ue-p'), 'app pickup is priced without delivery fees (D-033)');
  assert.ok(!ids.includes('dd-d') && !ids.includes('ue-d'), 'app delivery waits for the user\'s fees (D-032)');
  assert.ok(await page.locator('[data-testid="app-fees-dd"] #need-plats-dd-delFee').count() === 1, 'the page asks for DoorDash\'s delivery fee');

  // Switch restaurant (the cart empties, BUILD.md §5 / state contract §6).
  await page.selectOption('#brand', 'buffalo_wild_wings');
  await H.waitText(page, '[data-testid="empty-order"]', 'Add something to your order to compare.');
  assert.equal(await page.locator('[data-testid="menu-item"]').count(), POD().data.PROFILES.buffalo_wild_wings.menu.length);
  await addItem(page, 0, 2);
  await assertResultsMatchSaved(page, 'Buffalo Wild Wings');

  // Switch to an EV: the pickup receipts say Charging, not Gas (§13 scenario 4).
  await chooseCar(page, 'Tesla', 'Model 3');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '3.8 mi/kWh · electric');
  exp = await assertResultsMatchSaved(page, 'EV');
  const dp = (await H.shownResults(page)).find((r) => r.id === 'direct-p');
  assert.ok(dp.lines.some(([l]) => l === 'Charging') && !dp.lines.some(([l]) => l === 'Gas'), 'EV pickup: a Charging line, no Gas line');

  // Toggle three cards. Buffalo Wild Wings is an Amex Gold dining partner (§13 scenario 3).
  const before = (await H.shownResults(page)).find((r) => r.id === 'direct-p').net;
  for (const card of ['amex_gold', 'chase_sapphire_reserve', 'amex_platinum']) {
    await tick(page, '[data-action="toggle-card"][data-card="' + card + '"]');
  }
  for (const key of ['amex_gold.dining', 'chase_sapphire_reserve.doordash_promo', 'amex_platinum.uber_cash']) {
    assert.equal(await page.locator('[data-testid="credit"][data-key="' + key + '"]').count(), 1, key + ' is listed');
  }
  exp = await assertResultsMatchSaved(page, 'three cards');
  const dpAfter = (await H.shownResults(page)).find((r) => r.id === 'direct-p');
  assert.notEqual(dpAfter.net, before, 'the Gold dining credit lowers ordering direct at a partner');
  assert.ok(dpAfter.lines.some(([l]) => l === 'Card credits'), 'a Card credits line on direct pickup');
  assert.equal(await page.locator('[data-testid="insight"][data-id="wallet"]').count(), 1, 'the Wallet insight shows');

  // Type a ZIP in another state.
  await chooseZip(page, '07030');
  assert.equal(await H.text(page, '[data-testid="loc-status"]'), 'ZIP 07030 · Hoboken, NJ');
  assert.ok((await H.text(page, '[data-testid="tax-gas"]')).startsWith('Meal tax ' + stateRow('NJ')[3] + '%'));
  await H.waitText(page, '[data-testid="trip"]', 'mi round trip');
  await assertResultsMatchSaved(page, 'New Jersey');

  // Pin a distance.
  await H.commit(page, '#pinMiles', '12.5');
  await page.click('[data-action="pin"]');
  await H.waitText(page, '[data-testid="trip"]', '12.5 mi round trip · about 28 min');
  assert.equal(await H.text(page, '[data-testid="trip-src"]'), 'You set this distance.');
  const shownBefore = await H.shownResults(page);
  const insightsBefore = await page.$$eval('[data-testid="insight"]', (xs) => xs.map((x) => x.textContent));
  await assertResultsMatchSaved(page, 'pinned');
  await shot(page, 'checklist-desktop');

  // Reload: everything persisted.
  await page.reload();
  await page.waitForSelector('[data-testid="result-row"]');
  assert.equal(await page.inputValue('#address'), '07030');
  assert.equal(await page.inputValue('#brand'), 'buffalo_wild_wings');
  assert.equal(await H.text(page, '[data-testid="qty-0"]'), '2');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '3.8 mi/kWh · electric');
  for (const card of ['amex_gold', 'chase_sapphire_reserve', 'amex_platinum']) {
    assert.ok(await page.isChecked('[data-action="toggle-card"][data-card="' + card + '"]'), card + ' is still on');
  }
  await H.waitText(page, '[data-testid="trip"]', '12.5 mi round trip');
  assert.deepEqual(await H.shownResults(page), shownBefore, 'the same results after the reload');
  assert.deepEqual(await page.$$eval('[data-testid="insight"]', (xs) => xs.map((x) => x.textContent)), insightsBefore);

  // Unpin: the trip is measured again from the nearest store.
  await page.click('[data-action="unpin"]');
  await H.waitText(page, '[data-testid="trip-src"]', 'To the nearest Buffalo Wild Wings');
  await assertResultsMatchSaved(page, 'unpinned');
  assert.ok(await H.noHorizontalScroll(page) <= 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('§13 checklist at phone width: the same flow fits and prices', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url, { viewport: VIEWPORTS.phone });
  await chooseZip(page, '11201');
  await pickBrandFromList(page, 'dominos');
  await chooseCar(page, 'Toyota', 'Camry');
  await addItem(page, 0);
  await addItem(page, 6);
  await tick(page, '[data-action="toggle-card"][data-card="amex_platinum"]');
  await assertResultsMatchSaved(page, 'phone');
  assert.ok(await H.noHorizontalScroll(page) <= 0, 'no horizontal scroll at 390 px');
  await shot(page, 'checklist-phone');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- §13 scenarios ---------------------------------------------------------------------------

test('§13 scenario 1: Domino\'s in Brooklyn, with DoorDash\'s fees entered, ranks every route', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await chooseZip(page, '11201');
  await page.selectOption('#brand', 'dominos');
  await H.waitText(page, '[data-testid="trip"]', 'mi round trip');
  await chooseCar(page, 'Toyota', 'Camry');
  await addItem(page, 0, 2);
  // The DoorDash fees the page asks for (from the user's checkout), in the app-fees box.
  const fees = { 'plats.dd.delFee': 2.99, 'plats.dd.svcMin': 3, regFee: 0, smallMin: 12, smallFee: 2.5 };
  const asked = H.expected(await H.saved(page)).appMissing('dd');
  assert.deepEqual(asked, Object.keys(fees), 'exactly the fees DoorDash doesn\'t publish are asked for');
  for (const [p, v] of Object.entries(fees)) await H.commit(page, '#need-' + p.replace(/\./g, '-'), v);
  const exp = await assertResultsMatchSaved(page, 'fees entered');
  assert.ok(exp.R.some((r) => r.id === 'dd-d'), 'DoorDash delivery is priced once its fees are in');
  assert.equal(await page.locator('[data-testid="app-fees-dd"]').count(), 0, 'DoorDash no longer asks');
  const dd = (await H.shownResults(page)).find((r) => r.id === 'dd-d');
  assert.deepEqual(dd.lines.map(([l]) => l).slice(0, 3), ['Food', 'Delivery fee', 'Service fee']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('§13 scenario 2: Amex Gold\'s Resy credit never drops a Domino\'s total by $50 until opted in', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await chooseZip(page, '10118');
  await pickBrandFromList(page, 'dominos');
  await chooseCar(page, 'Toyota', 'Camry');
  await addItem(page, 0, 2);
  const net = async () => (await H.shownResults(page)).find((r) => r.id === 'direct-p').net;
  const before = await net();
  await tick(page, '[data-action="toggle-card"][data-card="amex_gold"]');
  assert.equal(await net(), before, 'Gold adds nothing to ordering Domino\'s direct (§9.1)');
  assert.ok((await H.text(page, '[data-testid="credit"][data-key="amex_gold.resy"]')).includes('Some restaurants'));
  assert.ok((await H.text(page, '[data-testid="insight"][data-id="locked"]')).includes('Resy credit'));
  await tick(page, '[data-action="opt-in"][data-key="amex_gold.resy"]');
  const exp = await assertResultsMatchSaved(page, 'opted in');
  assert.notEqual(await net(), before, '"Qualifies here" lets the restricted credit apply');
  assert.ok(exp.S.creditOptIn['amex_gold.resy'] === true);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('§13 scenario 5: rural 59011 vs urban 10118 trips to Domino\'s differ by more than 10×', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await chooseZip(page, '10118');
  await page.selectOption('#brand', 'dominos');
  await H.waitText(page, '[data-testid="trip-src"]', 'To the nearest Domino\'s');
  const urban = parseFloat(await H.text(page, '[data-testid="trip"]'));
  await chooseZip(page, '59011');
  await H.waitText(page, '[data-testid="trip"]', '77.2 mi round trip');    // geo fixtures: 30.9 mi straight × 2 × 1.25
  const rural = parseFloat(await H.text(page, '[data-testid="trip"]'));
  assert.equal(urban, 1.1, 'Midtown → the nearest Domino\'s (geo fixtures)');
  assert.ok(rural / urban >= 10, rural + ' vs ' + urban);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('§13 scenario 6: a DoorDash promo with an unmet minimum shows the Minimum insight with its delta', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await chooseZip(page, '11201');
  await pickBrandFromList(page, 'dominos');
  await chooseCar(page, 'Toyota', 'Camry');
  await addItem(page, 0);
  await addItem(page, 6);
  await page.selectOption('#promos-dd-type', 'dollar');
  await H.commit(page, '#promos-dd-value', 5);
  await H.commit(page, '#promos-dd-min', 35);
  const exp = H.expected(await H.saved(page));
  const want = exp.insights.find((x) => x.id === 'minimum');
  assert.ok(want, 'the verified insights module shows Minimum for this state');
  const shown = await H.text(page, '[data-testid="insight"][data-id="minimum"]');
  assert.ok(shown.includes(want.text), shown);
  assert.deepEqual(await page.$$eval('[data-testid="insight"]', (xs) => xs.map((x) => x.getAttribute('data-id'))),
    exp.insights.map((x) => x.id), 'every insight, in contract order');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('§13 scenario 7: localStorage that throws: defaults render, the page works, nothing persists, no console error', async () => {
  const init = () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
  };
  const { ctx, page, errors } = await H.openPage(browser, site.url, { init });
  assert.equal(await H.text(page, '[data-testid="loc-status"]'), 'Type your ZIP or address, or use your location.');
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  await page.reload();
  await page.waitForSelector('#results');
  assert.equal(await H.text(page, '[data-testid="loc-status"]'), 'Type your ZIP or address, or use your location.');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- render keeps unchanged blocks: a click that starts while a box commits isn't lost ----------

test('a click right after typing lands: the box commits on mouse down and the button survives the render', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  await page.fill('#tipDel', '20');                                   // focus stays in the box: not committed yet
  await page.click('[data-action="qty"][data-index="6"][data-delta="1"]');   // mouse down commits the tip, then the click
  assert.equal(await H.text(page, '[data-testid="qty-6"]'), '1', 'the + click counted');
  const exp = H.expected(await H.saved(page));
  assert.equal(exp.S.tipDel, 20, 'the tip committed');
  await H.commit(page, '#address', '11201');
  await page.fill('#address', '10118');
  await page.click('[data-action="locate"]');                         // same section as the box
  await H.waitText(page, '[data-testid="loc-status"]', 'ZIP 10118');
  // No geolocation permission in this context: the locate click landed if its failure message shows.
  await H.waitText(page, '[data-testid="geo-error"]', 'Couldn\'t get your location. Type your ZIP instead.', 15000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- example, geolocation, missing tiles, escaping, wallet -------------------------------------

test('the example: 10118, a Toyota Camry, Domino\'s and one item, priced', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  assert.equal(await page.inputValue('#address'), '10118');
  assert.equal(await page.inputValue('#brand'), 'dominos');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '46 mpg · regular');
  assert.equal(await H.text(page, '[data-testid="qty-0"]'), '1');
  await assertResultsMatchSaved(page, 'example');
  assert.equal(await page.locator('[data-action="example"]').count(), 0, 'the example button goes once a brand is chosen');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('geolocation: "Use my location" sets a GPS position; a denial shows a message, not an error', async () => {
  const lat = 40.749, lon = -73.986;
  const z = POD().geo.nearestZip(lat, lon, POD().data);
  let { ctx, page, errors } = await H.openPage(browser, site.url, {
    context: { geolocation: { latitude: lat, longitude: lon }, permissions: ['geolocation'] },
  });
  await page.click('[data-action="locate"]');
  await H.waitText(page, '[data-testid="loc-status"]', 'Your location · near ZIP ' + z.z + ', ' + z.c + ', ' + z.st);
  await page.waitForSelector('[data-testid="near-list"]');
  const exp = H.expected(await H.saved(page));
  assert.deepEqual(exp.S.pos, { lat, lon, src: 'gps' }, 'the GPS position is saved');
  assert.deepEqual(errors, []);
  await ctx.close();

  ({ ctx, page, errors } = await H.openPage(browser, site.url, { context: { permissions: [] } }));
  await page.click('[data-action="locate"]');
  await H.waitText(page, '[data-testid="geo-error"]', 'Couldn\'t get your location. Type your ZIP instead.', 15000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a tile that fails to load: the list says it may be incomplete; the only console errors are that file', async () => {
  const partial = H.buildSite({ omitTiles: ['40_-75'] });
  try {
    const { ctx, page, errors } = await H.openPage(browser, partial.url);
    await chooseZip(page, '10118');
    await H.waitText(page, '[data-testid="near-status"]', 'Some store data didn\'t load, so the list may be incomplete.');
    assert.ok(await page.locator('[data-testid="near-list"] [data-action="pick-store"]').count() > 0, 'the stores that loaded are listed');
    assert.ok(errors.length >= 1, 'the browser reports the missing file');
    for (const e of errors) assert.match(e, /^Failed to load resource: net::ERR_FILE_NOT_FOUND$/);
    await ctx.close();
  } finally {
    partial.remove();
  }
});

test('escaping: a manual credit named like markup is shown as text', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  const name = '<img src=x onerror="window.PWNED=1">Gift & "card"';
  await page.fill('#mc-name', name);
  await page.fill('#mc-amount', '25');
  await tick(page, '#mc-plat-direct');
  await page.click('[data-action="add-credit"]');
  const row = page.locator('[data-testid="credit"][data-key="manual.1"]');
  assert.ok((await row.textContent()).includes(name), 'the name is shown verbatim');
  assert.equal(await page.locator('#wallet img').count(), 0, 'no element was created from the name');
  assert.equal(await page.evaluate(() => window.PWNED), undefined);
  await page.click('[data-action="remove-credit"][data-key="manual.1"]');
  assert.equal(await row.count(), 0, 'removed');
  await page.click('[data-action="add-credit"]');
  assert.equal(await H.text(page, '[data-testid="mc-error"]'), 'Give the credit a name, an amount above $0 and where it works.');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('wallet: "Used this period" stops a credit applying and persists', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  await tick(page, '[data-action="toggle-card"][data-card="amex_platinum"]');
  const withCredit = await assertResultsMatchSaved(page, 'Uber Cash on');
  await tick(page, '[data-action="used"][data-key="amex_platinum.uber_cash"]');
  const used = await assertResultsMatchSaved(page, 'Uber Cash used');
  const ue = (x) => x.R.find((r) => r.id === 'ue-p');
  assert.ok(ue(withCredit).credit > 0 && ue(used).credit === 0, 'the used credit no longer applies to Uber Eats pickup');
  await page.reload();
  await page.waitForSelector('[data-testid="result-row"]');
  assert.ok(await page.isChecked('[data-action="used"][data-key="amex_platinum.uber_cash"]'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('settings: a cleared tip is asked for; an unprofiled brand takes a typed menu total', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  await H.commit(page, '#tipDel', '');
  await H.waitText(page, '[data-testid="missing"]', 'the delivery tip');
  await H.commit(page, '#tipDel', '18');
  await page.waitForSelector('[data-testid="result-row"]');
  await page.selectOption('#brand', 'taco_bell');
  // manualSubtotal starts at 0 (a valid value), so the page asks for an order, not for a missing field.
  await H.waitText(page, '[data-testid="empty-order"]', 'Add something to your order to compare.');
  assert.ok((await H.text(page, '#order')).includes('Taco Bell isn\'t profiled'));
  await H.commit(page, '#manualSubtotal', '');
  await H.waitText(page, '[data-testid="missing"]', 'your order\'s menu total');
  await H.commit(page, '#manualSubtotal', '20');
  const exp = await assertResultsMatchSaved(page, 'Taco Bell');
  assert.ok(exp.R.every((r) => r.id !== 'direct-d'), 'no direct delivery for an unprofiled brand (§9.3)');
  assert.ok((await H.shownResults(page)).length === exp.R.length);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---- added after the 5.3 review: what a broken render would otherwise pass ---------------------

test('results: the missing list follows the contract order; rows carry best, member, neg and Estimate', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  await H.commit(page, '#wear', '');
  await H.commit(page, '#tipDel', '');
  assert.equal(await H.text(page, '[data-testid="missing"]'), 'To compare, we still need: the delivery tip, wear per mile.');
  await H.commit(page, '#tipDel', '15');
  await H.commit(page, '#wear', '0.1104');
  await page.waitForSelector('[data-testid="result-row"]');

  // DashPass from the Sapphire Reserve; DoorDash's fees from the checkout.
  await tick(page, '[data-action="toggle-card"][data-card="chase_sapphire_reserve"]');
  for (const [p, v] of Object.entries({ 'plats.dd.delFee': 2.99, 'plats.dd.svcMin': 3, regFee: 0, smallMin: 12, smallFee: 2.5 })) {
    await H.commit(page, '#need-' + p.replace(/\./g, '-'), v);
  }
  const exp = await assertResultsMatchSaved(page, 'DashPass');
  const rows = page.locator('[data-testid="result-row"]');
  assert.equal(await page.locator('[data-testid="result-row"].best').count(), 1, 'one best row');
  assert.ok(await rows.first().evaluate((r) => r.classList.contains('best')), 'the first row is the best');
  const dd = page.locator('[data-testid="result-row"][data-channel="dd-d"]');
  assert.equal(exp.R.find((r) => r.id === 'dd-d').member, 'DashPass');
  assert.ok((await dd.textContent()).includes('DashPass'), 'the member badge shows');
  assert.ok((await dd.locator('summary').textContent()).trim() === 'Receipt');
  const neg = await dd.locator('[data-testid="line"]').evaluateAll((ls) => ls.filter((l) =>
    l.querySelector('[data-testid="line-label"]').textContent.trim() === 'Card credits').map((l) =>
    l.classList.contains('neg') || !!l.querySelector('.neg')));
  assert.deepEqual(neg, [true], 'the Card credits line is marked neg');
  const delivery = await dd.locator('[data-testid="line"]').evaluateAll((ls) => ls.filter((l) =>
    l.querySelector('[data-testid="line-label"]').textContent.trim() === 'Delivery fee').map((l) =>
    l.querySelector('[data-testid="line-amount"]').textContent.trim()));
  assert.deepEqual(delivery, ['waived'], 'DashPass waives the delivery fee');

  // The card's membership can be turned off; then DoorDash charges its delivery fee again.
  assert.ok(await page.isChecked('#cardMember-dd'), 'the card membership is on by default (D-024)');
  assert.equal(await page.locator('#memberOwn-dd').count(), 1);
  await page.click('#cardMember-dd');
  await assertResultsMatchSaved(page, 'membership off');
  assert.ok(!(await dd.textContent()).includes('DashPass'), 'no badge once the membership is off');

  // An unprofiled brand's rows say Estimate.
  await page.selectOption('#brand', 'taco_bell');
  await H.commit(page, '#manualSubtotal', '20');
  await page.waitForSelector('[data-testid="result-row"]');
  assert.ok((await H.text(page, '[data-testid="result-row"]')).includes('Estimate'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('wallet: tier tags, and a credit with nowhere to apply is refused', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await tick(page, '[data-action="toggle-card"][data-card="amex_delta_gold"]');
  await tick(page, '[data-action="toggle-card"][data-card="amex_platinum"]');
  const locked = page.locator('[data-testid="credit"][data-key="amex_delta_gold.rideshare"]');
  assert.ok((await locked.textContent()).includes('Locked'));
  assert.equal(await locked.locator('[data-action="used"]').count(), 0, 'a locked credit has no "Used" box');
  assert.ok((await H.text(page, '[data-testid="credit"][data-key="amex_platinum.uber_cash"]')).includes('Works on Uber Eats'));
  assert.ok((await H.text(page, '[data-testid="credit"][data-key="amex_platinum.resy"]')).includes('Some restaurants'));
  await page.fill('#mc-name', 'Gift');
  await page.fill('#mc-amount', '25');
  await page.click('[data-action="add-credit"]');
  assert.equal(await H.text(page, '[data-testid="mc-error"]'), 'Give the credit a name, an amount above $0 and where it works.');
  assert.equal(await page.locator('[data-testid="credit"][data-key="manual.1"]').count(), 0, 'nothing was added');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('car: switching from a listed car to "Other" asks for the new car\'s mpg instead of keeping the old one', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await page.click('[data-action="example"]');
  await page.waitForSelector('[data-testid="result-row"]');
  await page.selectOption('#make', 'Other');
  await H.waitText(page, '[data-testid="missing"]', 'your car');
  assert.equal(await page.inputValue('#mpg'), '', 'the Camry\'s 46 mpg isn\'t carried over');
  await H.commit(page, '#mpg', '30');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '30 mpg · regular');
  await assertResultsMatchSaved(page, 'Other, 30 mpg');
  await page.selectOption('#fuel', 'ev');
  await H.commit(page, '#miPerKwh', '4');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '4 mi/kWh · electric');
  await assertResultsMatchSaved(page, 'Other EV');
  await page.reload();
  await page.waitForSelector('[data-testid="result-row"]');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '4 mi/kWh · electric', 'the typed car survives a reload');
  assert.deepEqual(errors, []);
  await ctx.close();
});
