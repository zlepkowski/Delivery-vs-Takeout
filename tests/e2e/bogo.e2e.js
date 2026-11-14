// bogo.e2e.js: D-036 on the page (UI contract §5.3, §5.9): menu items as objects, a "Buy one, get one free"
// promo with its item select, the BOGO note and Promo line in the results, persistence, and the item
// cleared when the restaurant changes. Written by the orchestrator before the builder (D-035 pattern).
//
// Expected prices come from the saved state through the verified modules (H.expected); the free item's
// value is also worked here from the data and the contract (engine contract §5.4), not read from the page.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const H = require('./helpers');

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

async function setUp(page) {
  await H.commit(page, '#address', '11201');
  await H.waitText(page, '[data-testid="loc-status"]', 'ZIP 11201');
  await page.waitForSelector('[data-testid="near-list"]');
  const row = '[data-testid="near-list"] [data-action="pick-store"][data-brand="dominos"]';
  if (await page.locator(row).count() === 0) await page.click('[data-action="more-stores"]');
  await page.click(row);
  await H.waitText(page, '[data-testid="trip"]', 'mi round trip');
  await page.selectOption('#make', 'Toyota');
  await page.selectOption('#model', 'Camry');
  for (const [i, n] of [[0, 2], [6, 1]]) {
    for (let k = 0; k < n; k++) await page.click('[data-action="qty"][data-index="' + i + '"][data-delta="1"]');
  }
}

const tagsOf = (page, ch) => page.$$eval('[data-testid="result-row"][data-channel="' + ch + '"] .tag',
  (ts) => ts.map((t) => t.textContent.replace(/\s+/g, ' ').trim()));

test('D-036 menu rows read the object items: name, price and no deal tag', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await setUp(page);
  const menu = POD().data.PROFILES.dominos.menu;
  assert.equal(await page.locator('[data-testid="menu-item"]').count(), menu.length);
  const first = await H.text(page, '[data-testid="menu-item"]');
  assert.ok(first.includes(menu[0].name) && first.includes(H.money(menu[0].price)), first);
  assert.equal(await H.text(page, '[data-testid="qty-0"]'), '2');
  assert.equal(await page.locator('[data-testid="menu-item"] .tag').count(), menu.filter((m) => m.dealItem === true).length);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-036 BOGO on Uber Eats: pick the type, then the item; the free pizza shows as a Promo line and a note', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await setUp(page);
  assert.equal(await page.locator('#promos-ue-item').count(), 0, 'no item select before the type is BOGO');

  await page.selectOption('#promos-ue-type', 'bogo');
  await page.waitForSelector('#promos-ue-item');
  const menu = POD().data.PROFILES.dominos.menu;
  const opts = await page.$$eval('#promos-ue-item option', (os) => os.map((o) => [o.value, o.textContent.trim()]));
  assert.deepEqual(opts, [['', 'Pick the item…']].concat(menu.map((m, i) => [String(i), m.name])));
  assert.equal(await page.inputValue('#promos-ue-item'), '', 'nothing picked yet');
  assert.ok((await H.text(page, 'label[for="promos-ue-item"]')).includes('Free item'));
  let exp = H.expected(await H.saved(page));
  assert.deepEqual([exp.S.promos.ue.type, exp.S.promos.ue.item], ['bogo', null]);
  assert.equal((await tagsOf(page, 'ue-p')).filter((t) => t.startsWith('BOGO')).length, 0, 'no item, no BOGO');

  await page.selectOption('#promos-ue-item', '0');
  await H.waitText(page, '[data-testid="result-row"][data-channel="ue-p"]', 'BOGO: ');
  exp = H.expected(await H.saved(page));
  assert.equal(exp.S.promos.ue.item, 0, 'the select commits the index as a number');
  assert.deepEqual(await H.shownResults(page), H.wantResults(exp), 'the results are the engine\'s for the saved state');

  // Worked from the contract: 2 pizzas -> floor(2/2) = 1 free, at the pizza's own marked-up price.
  const mk = exp.S.plats.ue.markup;
  const free = Math.round(menu[0].price * 1 * (1 + mk / 100) * 100) / 100;
  const ue = (await H.shownResults(page)).find((r) => r.id === 'ue-p');
  assert.ok(ue, 'Uber Eats pickup is priced (its delivery waits for fees, D-033)');
  assert.deepEqual(ue.lines.find(([l]) => l === 'Promo'), ['Promo', H.money(-free)]);
  assert.ok((await tagsOf(page, 'ue-p')).includes('BOGO: ' + menu[0].name));
  assert.equal((await tagsOf(page, 'dd-p')).filter((t) => t.startsWith('BOGO')).length, 0, 'the BOGO is Uber Eats\' own');
  await page.screenshot({ path: path.join(H.SHOTS, 'bogo-desktop.png'), fullPage: true });

  // Persists over a reload.
  const shown = await H.shownResults(page);
  await page.reload();
  await page.waitForSelector('#promos-ue-item');
  assert.equal(await page.inputValue('#promos-ue-type'), 'bogo');
  assert.equal(await page.inputValue('#promos-ue-item'), '0');
  await H.waitText(page, '[data-testid="result-row"][data-channel="ue-p"]', 'BOGO: ');
  assert.deepEqual(await H.shownResults(page), shown, 'same results after the reload');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('D-036 a new restaurant clears the BOGO item; an unprofiled one has no item to pick', async () => {
  const { ctx, page, errors } = await H.openPage(browser, site.url);
  await setUp(page);
  await page.selectOption('#promos-ue-type', 'bogo');
  await page.waitForSelector('#promos-ue-item');
  await page.selectOption('#promos-ue-item', '0');
  await H.waitText(page, '[data-testid="result-row"][data-channel="ue-p"]', 'BOGO: ');

  assert.ok(!Object.prototype.hasOwnProperty.call(POD().data.PROFILES, 'taco_bell'), 'taco_bell is unprofiled (D-028)');
  await page.selectOption('#brand', 'taco_bell');
  await page.waitForSelector('[data-testid="bogo-note-ue"]');
  assert.equal(await H.text(page, '[data-testid="bogo-note-ue"]'), 'Buy one, get one free needs a restaurant with a menu.');
  assert.equal(await page.locator('#promos-ue-item').count(), 0);
  // On the desktop grid (label | input), the note must not take a cell and shift the pairs after it.
  for (const f of ['value', 'cap', 'min']) {
    const lab = await page.locator('label[for="promos-ue-' + f + '"]').boundingBox();
    const box = await page.locator('#promos-ue-' + f).boundingBox();
    assert.ok(Math.abs(lab.y + lab.height / 2 - (box.y + box.height / 2)) < 12,
      'promos-ue-' + f + ': label and input on one row (label y ' + lab.y + ', input y ' + box.y + ')');
  }
  const exp = H.expected(await H.saved(page));
  assert.deepEqual([exp.S.promos.ue.type, exp.S.promos.ue.item], ['bogo', null], 'the type stays; the old index is cleared');

  await page.selectOption('#brand', 'dominos');
  await page.waitForSelector('#promos-ue-item');
  assert.equal(await page.inputValue('#promos-ue-item'), '', 'back at Domino\'s, nothing is picked');
  assert.deepEqual(errors, []);
  await ctx.close();
});
