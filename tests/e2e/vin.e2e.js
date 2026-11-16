// vin.e2e.js: D-037 and D-038 on the page (UI contract §5.7, §5.10, §6b): the VIN box and its
// messages, the model-year select and the EPA-year line, and the fine print. Written by the
// orchestrator before the builder (D-035 pattern).
//
// No test reaches the network: every request to vpic.nhtsa.dot.gov is answered from the recorded
// answers in tests/fixtures/vin/vpic/ (with the CORS header vPIC sends), and every other http(s)
// request is aborted. Expected mpg figures are worked by hand from EPA's records
// (tests/fixtures/vin/README.md), never read from the page.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const H = require('./helpers');
const { APP_ROOT } = require('../helpers/load');

const VPIC = path.join(APP_ROOT, 'tests', 'fixtures', 'vin', 'vpic');
const BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
const VINS = {
  accord2003: '1HGCM82633A004352', camry2018: '4T1B11HK7JU512345', model3_2019: '5YJ3E1EA0KF312345',
  f150_2019: '1FTEW1E56KFA12345', bmw330i_2019: 'WBA5R1C55KA712345', accord1999: '1HGCG5656XA012345',
  undecodable: 'ZZZZZZZZ9ZZZZZZZZ', civic2015: '19XFB2F50FE012345',
};
const BY_VIN = {};
for (const [name, vin] of Object.entries(VINS)) BY_VIN[vin] = name;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const MSG = {
  fail: "Couldn't reach NHTSA's VIN decoder. Pick your car below.",
  undecodable: "NHTSA couldn't decode that VIN. Pick your car below.",
  length: 'A VIN has 17 letters and digits.',
  chars: 'A VIN uses only digits and the letters A–Z except I, O and Q.',
  digit: "That VIN's check digit (its 9th character) doesn't match: check for a typo.",
};

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

/**
 * Opens the page with the network stubbed. `answer(vin, route)` may answer a vPIC request itself;
 * by default the recorded file for that VIN is served. Returns the requests vPIC received.
 */
async function open(answer = null, viewport) {
  const o = await H.openPage(browser, site.url, viewport ? { viewport } : {});
  const requests = [];
  await o.ctx.route(/^https?:\/\//, (route) => route.abort());         // nothing else leaves the machine
  await o.ctx.route(BASE + '**', async (route) => {                     // registered last, so it runs first
    const req = route.request();
    const vin = req.url().slice(BASE.length).split('?')[0];
    requests.push({ url: req.url(), method: req.method(), headers: req.headers() });
    if (answer && (await answer(vin, route)) === true) return;
    const name = BY_VIN[vin];
    if (!name) return route.fulfill({ status: 404, headers: CORS, body: '{}' });
    return route.fulfill({ status: 200, headers: CORS, body: fs.readFileSync(path.join(VPIC, name + '.json'), 'utf8') });
  });
  return Object.assign(o, { requests });
}

async function lookUp(page, typed) {
  await page.fill('#vin', typed);
  await page.click('[data-action="vin"]');
}

const savedState = async (page) => JSON.parse(await H.saved(page));
const value = (page, sel) => page.locator(sel).inputValue();

test('D-038 a VIN fills the car from NHTSA, and D-037 prices its own model year', async () => {
  const { ctx, page, errors, requests } = await open();
  await lookUp(page, ' 1hgcm8-2633a004352 ');
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2003 HONDA Accord.');
  assert.equal(await H.text(page, '[data-testid="vin-status"]'), 'NHTSA says 2003 HONDA Accord.');
  assert.equal(await value(page, '#make'), 'Honda');
  assert.equal(await value(page, '#model'), 'Accord');
  assert.equal(await value(page, '#year'), '2003');
  // EPA's 2003 Accord records: 21, 22, 25, 26 -> (22 + 25) / 2 = 23.5 -> 24 (the newest Accord is 38).
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '24 mpg · regular');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2003 model.');
  assert.equal(await value(page, '#vin'), '1HGCM82633A004352', 'the box shows the cleaned VIN');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, BASE + '1HGCM82633A004352?format=json');
  assert.equal(requests[0].method, 'GET');
  assert.equal(await page.locator('#mpg').count(), 0, 'a listed car has no manual inputs');
  const S = await savedState(page);
  assert.equal(S.year, 2003);
  assert.equal(S.make, 'Honda');
  assert.ok(!(await H.saved(page)).includes('1HGCM82633A004352'), 'the VIN is never saved (D-038)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-037 a reload keeps the year and its figure; the VIN box and message are gone', async () => {
  const { ctx, page, errors } = await open();
  await lookUp(page, VINS.camry2018);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2018 TOYOTA Camry.');
  // EPA's 2018 Camry records: 26, 26, 32, 32, 34, 46, 52 -> 32 (the newest Camry is 46).
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '32 mpg · regular');
  await page.reload();
  await page.waitForSelector('#results');
  assert.equal(await value(page, '#year'), '2018');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '32 mpg · regular');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2018 model.');
  assert.equal(await value(page, '#vin'), '');
  assert.equal(await page.locator('[data-testid="vin-status"]').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 an electric VIN: mi/kWh from EPA, and vPIC\'s F-150 meets EPA\'s F150', async () => {
  const { ctx, page, errors } = await open();
  await lookUp(page, VINS.model3_2019);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2019 TESLA Model 3.');
  assert.equal(await value(page, '#make'), 'Tesla');
  assert.equal(await value(page, '#model'), 'Model 3');
  // 1000/combE for EPA's six 2019 records; middle two 36.38 and 38.64 -> 37.51 -> 38e -> 3.8 mi/kWh.
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '3.8 mi/kWh · electric');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2019 model.');
  await lookUp(page, VINS.f150_2019);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2019 FORD F-150.');
  assert.equal(await value(page, '#make'), 'Ford');
  assert.equal(await value(page, '#model'), 'F150', 'key f150, not F-150 Lightning');
  // 25 regular records beat 5 diesel; the 13th of the 25 sorted values is 19.
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '19 mpg · regular');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 a make without a model match: the page asks for the model and keeps the VIN\'s year', async () => {
  const { ctx, page, errors } = await open();
  await lookUp(page, VINS.bmw330i_2019);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2019 BMW 330i.');
  assert.equal(await H.text(page, '[data-testid="vin-status"]'),
    "NHTSA says 2019 BMW 330i. Pick the model below: EPA's list names it differently.");
  assert.equal(await value(page, '#make'), 'BMW');
  assert.equal(await value(page, '#model'), '');
  assert.equal(await page.locator('#mpg').count(), 0, 'no manual inputs until a model is chosen');
  await page.selectOption('#model', '3 Series');
  // The model change keeps the VIN's 2019 (UI contract §3). EPA 2019 3 Series, premium: 23, 27, 27, 28, 30 -> 27.
  await H.waitText(page, '[data-testid="car-summary"]', 'mpg');
  assert.equal(await value(page, '#year'), '2019');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '27 mpg · premium');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2019 model.');
  assert.equal(await page.locator('[data-testid="vin-status"]').count(), 0, 'a model change clears the VIN message');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 a make EPA doesn\'t list becomes Other, with the manual inputs', async () => {
  const body = JSON.stringify({ Count: 1, Message: 'ok', SearchCriteria: 'VIN(s): x',
    Results: [{ ModelYear: '2019', Make: 'ACME TRUCKS', Model: 'Hauler', ErrorCode: '0' }] });
  const { ctx, page, errors } = await open(async (vin, route) => {
    await route.fulfill({ status: 200, headers: CORS, body });
    return true;
  });
  await lookUp(page, '11111111111111111');
  await H.waitText(page, '[data-testid="vin-status"]', 'ACME TRUCKS');
  assert.equal(await H.text(page, '[data-testid="vin-status"]'),
    "NHTSA says 2019 ACME TRUCKS Hauler. That make isn't in the EPA list: enter its fuel and mpg below.");
  assert.equal(await value(page, '#make'), 'Other');
  assert.equal(await page.locator('#fuel').count(), 1);
  assert.equal(await value(page, '#mpg'), '');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), 'No car yet.');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-037 a year EPA\'s list doesn\'t have: the year option says so and the page asks for mpg', async () => {
  const { ctx, page, errors } = await open();
  await lookUp(page, VINS.accord1999);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 1999 HONDA Accord.');
  assert.equal(await H.text(page, '[data-testid="vin-status"]'),
    "NHTSA says 1999 HONDA Accord. EPA's list has no 1999 figure for it: enter its mpg below.");
  assert.equal(await value(page, '#year'), '1999');
  assert.equal(await H.text(page, '#year option:checked'), '1999 (no EPA figure)');
  assert.equal(await page.locator('[data-testid="car-epa"]').count(), 0);
  assert.equal(await value(page, '#mpg'), '');
  await H.commit(page, '#mpg', '23');
  await H.waitText(page, '[data-testid="car-summary"]', '23 mpg');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '23 mpg · regular');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 a VIN that fails the local check is never sent', async () => {
  const { ctx, page, errors, requests } = await open();
  for (const [typed, msg] of [['1HGCM82643A004352', MSG.digit], ['1HGCM82633A00435', MSG.length],
    ['1HGCM82633I004352', MSG.chars], ['', MSG.length]]) {
    await lookUp(page, typed);
    await H.waitText(page, '[data-testid="vin-status"]', msg);
    assert.equal(await H.text(page, '[data-testid="vin-status"]'), msg, typed);
  }
  assert.equal(requests.length, 0);
  assert.equal((await savedState(page)).make, '');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 NHTSA unreachable, a server error, bad JSON or an undecodable VIN: a message, the car unchanged', async () => {
  for (const [how, msg] of [['abort', MSG.fail], ['500', MSG.fail], ['badjson', MSG.fail], ['undecodable', MSG.undecodable]]) {
    const { ctx, page, errors } = await open(async (vin, route) => {
      if (how === 'abort') { await route.abort('connectionrefused'); return true; }
      if (how === '500') { await route.fulfill({ status: 500, headers: CORS, body: 'oops' }); return true; }
      if (how === 'badjson') { await route.fulfill({ status: 200, headers: CORS, body: '{"Results": [' }); return true; }
      return false;   // undecodable: the recorded answer
    });
    await page.selectOption('#make', 'Toyota');
    await page.selectOption('#model', 'Camry');
    await lookUp(page, how === 'undecodable' ? VINS.undecodable : VINS.accord2003);
    await H.waitText(page, '[data-testid="vin-status"]', msg);
    assert.equal(await H.text(page, '[data-testid="vin-status"]'), msg, how);
    assert.equal(await value(page, '#make'), 'Toyota', how);
    assert.equal(await H.text(page, '[data-testid="car-summary"]'), '46 mpg · regular', how);
    // A refused connection and an HTTP 500 each make the browser log its own resource error, which the
    // page can't suppress (UI contract §0). Only that message, only in that sub-case, is allowed.
    const browserOwn = { abort: /net::ERR_CONNECTION_REFUSED|Failed to load resource/,
      500: /^Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)$/ };
    const own = errors.filter((e) => !(browserOwn[how] && browserOwn[how].test(e)));
    assert.deepEqual(own, [], how);
    await ctx.close();
  }
});

test('D-038 only the latest lookup counts: a slow first answer arriving last changes nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let slowDone;
  const slowFinished = new Promise((r) => { slowDone = r; });
  const { ctx, page, errors } = await open(async (vin, route) => {
    if (vin !== VINS.accord2003) return false;
    await gate;
    await route.fulfill({ status: 200, headers: CORS, body: fs.readFileSync(path.join(VPIC, 'accord2003.json'), 'utf8') });
    slowDone();
    return true;
  });
  await lookUp(page, VINS.accord2003);
  await H.waitText(page, '[data-testid="vin-status"]', 'Looking up 1HGCM82633A004352 with NHTSA…');
  await lookUp(page, VINS.camry2018);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2018 TOYOTA Camry.');
  release();
  await slowFinished;
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));   // let the page's load handler run
  await page.waitForFunction(() => true);
  assert.equal(await H.text(page, '[data-testid="vin-status"]'), 'NHTSA says 2018 TOYOTA Camry.');
  assert.equal(await value(page, '#model'), 'Camry');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '32 mpg · regular');
  assert.deepEqual(errors, []);
  await ctx.close();
});

/** A page whose answer for the 2003 Accord VIN waits until release() is called. */
async function openGated() {
  let release;
  const gate = new Promise((r) => { release = r; });
  let done;
  const finished = new Promise((r) => { done = r; });
  const o = await open(async (vin, route) => {
    if (vin !== VINS.accord2003) return false;
    await gate;
    await route.fulfill({ status: 200, headers: CORS, body: fs.readFileSync(path.join(VPIC, 'accord2003.json'), 'utf8') });
    done();
    return true;
  });
  return Object.assign(o, {
    release: async () => {
      release();
      await finished;
      await o.page.evaluate(() => new Promise((r) => setTimeout(r, 0)));   // let the page's load handler run
    },
  });
}

test('D-038 the latest action wins: a typo clicked while an answer is pending keeps its message', async () => {
  const { ctx, page, errors, release } = await openGated();
  await lookUp(page, VINS.accord2003);
  await H.waitText(page, '[data-testid="vin-status"]', 'Looking up');
  await lookUp(page, '1HGCM82643A004352');
  await H.waitText(page, '[data-testid="vin-status"]', MSG.digit);
  await release();
  assert.equal(await H.text(page, '[data-testid="vin-status"]'), MSG.digit, 'the older answer is ignored (UI contract §6b amendment)');
  assert.equal(await value(page, '#make'), '');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 the latest action wins: a car picked by hand while an answer is pending stays', async () => {
  const { ctx, page, errors, release } = await openGated();
  await lookUp(page, VINS.accord2003);
  await H.waitText(page, '[data-testid="vin-status"]', 'Looking up');
  await page.selectOption('#make', 'Toyota');
  await page.selectOption('#model', 'Camry');
  await H.waitText(page, '[data-testid="car-summary"]', '46 mpg');
  await release();
  assert.equal(await value(page, '#make'), 'Toyota');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '46 mpg · regular');
  assert.equal(await page.locator('[data-testid="vin-status"]').count(), 0, 'the make change cleared the message');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 the first-visit example clears a VIN message', async () => {
  const { ctx, page, errors } = await open();
  await lookUp(page, VINS.civic2015);
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2015 HONDA Civic.');
  await page.click('[data-action="example"]');
  await H.waitText(page, '[data-testid="car-summary"]', '46 mpg');
  assert.equal(await value(page, '#make'), 'Toyota');
  assert.equal(await page.locator('[data-testid="vin-status"]').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-037 the model-year select: Newest first, a year\'s own figure, back to newest; a make change clears it', async () => {
  const { ctx, page, errors } = await open();
  await page.selectOption('#make', 'Honda');
  await page.selectOption('#model', 'Accord');
  // EPA's newest Accord is 2026 (31, 32, 44, 48 -> 38), the same as CAR_DATA.
  assert.equal(await H.text(page, '#year option'), 'Newest (2026)');
  assert.equal(await value(page, '#year'), '');
  const years = await page.$$eval('#year option', (os) => os.slice(1).map((o) => o.value));
  assert.equal(years[0], '2026');
  assert.equal(years[years.length - 1], '2000', 'CAR_YEARS starts at 2000 (D-037)');
  assert.equal(years.length, 27, 'every model year 2000-2026, once each');
  assert.equal(await H.text(page, '[data-testid="car-summary"]'), '38 mpg · regular');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2026 model.');
  await page.selectOption('#year', '2003');
  await H.waitText(page, '[data-testid="car-summary"]', '24 mpg');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2003 model.');
  assert.equal((await savedState(page)).year, 2003);
  await page.selectOption('#year', '2015');
  await page.selectOption('#model', 'Civic');
  // The year stays on a model change. EPA's 2015 Civic: regular 31, 32, 33, 34, 44 -> 33.
  await H.waitText(page, '[data-testid="car-summary"]', '33 mpg');
  assert.equal(await value(page, '#year'), '2015');
  assert.equal(await H.text(page, '[data-testid="car-epa"]'), 'EPA figure for the 2015 model.');
  await page.selectOption('#year', '');
  await H.waitText(page, '[data-testid="car-epa"]', 'EPA figure for the');
  assert.equal((await savedState(page)).year, null);
  await page.selectOption('#year', '2015');
  await page.selectOption('#make', 'Toyota');
  await page.waitForFunction(() => !document.querySelector('#year'));
  assert.equal((await savedState(page)).year, null, 'a new make clears the year');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-038 type then click: a number box committing on the press doesn\'t lose the Look up click', async () => {
  const { ctx, page, errors, requests } = await open();
  await page.fill('#vin', VINS.civic2015);
  await page.evaluate(() => { document.querySelector('[data-action="vin"]').__mark = 'same'; });
  await page.fill('#tipDel', '18');                 // not committed yet: it commits when the click blurs it
  await page.click('[data-action="vin"]');
  await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2015 HONDA Civic.');
  assert.equal(requests.length, 1, 'the click counted');
  assert.equal((await savedState(page)).tipDel, 18, 'and the tip committed');
  assert.equal(await page.evaluate(() => document.querySelector('[data-action="vin"]').__mark), 'same',
    'the button the user pressed is still the one on the page');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-039 D-038 the fine print names the EIA week and says where a VIN goes', async () => {
  const { ctx, page, errors } = await open();
  const week = H.app().data.GAS_WEEK;
  assert.match(week, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'states.js carries GAS_WEEK');
  const fine = await H.text(page, '#fine');
  assert.ok(fine.includes('Gas: U.S. EIA weekly retail prices (week of ' + week + '). Meal tax: state rates. ' +
    'Fuel economy: EPA, by model year.'), fine);
  assert.ok(fine.includes("A VIN lookup goes from your browser to NHTSA's free decoder (vPIC). The VIN isn't saved."), fine);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  test('D-038 the car section after a lookup fits the ' + name + ' width', async () => {
    const { ctx, page, errors } = await open(null, viewport);
    await lookUp(page, VINS.accord2003);
    await H.waitText(page, '[data-testid="vin-status"]', 'NHTSA says 2003 HONDA Accord.');
    assert.equal(await H.noHorizontalScroll(page), 0);
    await page.locator('#car').scrollIntoViewIfNeeded();
    await page.locator('#car').screenshot({ path: path.join(H.SHOTS, 'vin-car-' + name + '.png') });
    await lookUp(page, VINS.accord1999);
    await H.waitText(page, '[data-testid="vin-status"]', 'no 1999 figure');
    assert.equal(await H.noHorizontalScroll(page), 0);
    await page.locator('#car').screenshot({ path: path.join(H.SHOTS, 'vin-car-unlisted-' + name + '.png') });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
