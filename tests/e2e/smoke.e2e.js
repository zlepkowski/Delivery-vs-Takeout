// Smoke: the page opens straight from file:// (BUILD.md §2), renders, and
// logs zero console errors or uncaught exceptions, at phone and desktop
// widths. Screenshots land in tests/e2e/screenshots/ (gitignored).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const URL = pathToFileURL(path.join(APP_ROOT, 'index.html')).href;
const SHOTS = path.join(__dirname, 'screenshots');

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

let browser;
test.before(async () => {
  browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.after(async () => {
  if (browser) await browser.close();
});

for (const vp of VIEWPORTS) {
  test(`loads from file:// with no console errors (${vp.name})`, async () => {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(URL);
    await page.waitForSelector('#app > *');

    assert.equal(await page.title(), 'Pickup or Delivery');
    assert.ok(await page.locator('h1').isVisible());

    // No horizontal scroll at any width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page scrolls horizontally by ${overflow}px`);

    await page.screenshot({ path: path.join(SHOTS, `smoke-${vp.name}.png`), fullPage: true });
    assert.deepEqual(errors, [], `console errors:\n${errors.join('\n')}`);
    await page.close();
  });
}
