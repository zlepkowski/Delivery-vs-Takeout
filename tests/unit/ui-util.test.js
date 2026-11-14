// ui-util.test.js: POD.util.esc (docs/ui-contract.md §9) and the page's script
// load order and DOM-freedom (D-035: insights.js and render.js sit between
// state.js and app.js in index.html). Expected values are written out from the
// contract text, never copied from running esc.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, scriptOrder } = require('../helpers/load');

function esc(s) {
  return loadApp({ only: ['pod.js'] }).POD.util.esc(s);
}

// §9: each special character maps to exactly one entity.
test('D-035 §9 esc maps & to &amp;', () => {
  assert.equal(esc('&'), '&amp;');
});

test('D-035 §9 esc maps < to &lt;', () => {
  assert.equal(esc('<'), '&lt;');
});

test('D-035 §9 esc maps > to &gt;', () => {
  assert.equal(esc('>'), '&gt;');
});

test('D-035 §9 esc maps " to &quot;', () => {
  assert.equal(esc('"'), '&quot;');
});

test("D-035 §9 esc maps ' to &#39;", () => {
  assert.equal(esc("'"), '&#39;');
});

// §9: & goes first, so an existing entity is escaped, not left alone or doubled the other way.
test('D-035 §9 esc escapes & first: "&lt;" becomes "&amp;lt;", not "&lt;"', () => {
  assert.equal(esc('&lt;'), '&amp;lt;');
});

test('D-035 §9 esc escapes an existing "&amp;" to "&amp;amp;"', () => {
  assert.equal(esc('&amp;'), '&amp;amp;');
});

// §9: null and undefined give "".
test('D-035 §9 esc(null) and esc(undefined) return the empty string', () => {
  const { esc: f } = loadApp({ only: ['pod.js'] }).POD.util;
  assert.equal(f(null), '');
  assert.equal(f(undefined), '');
  assert.equal(f(), '');
});

// §9: anything else is String(x) first, so numbers and booleans pass through as text.
test('D-035 §9 esc turns numbers into String(x), including 0 and negatives', () => {
  assert.equal(esc(42), '42');
  assert.equal(esc(0), '0');
  assert.equal(esc(-1.5), '-1.5');
});

test('D-035 §9 esc turns booleans into String(x)', () => {
  assert.equal(esc(true), 'true');
  assert.equal(esc(false), 'false');
});

test('D-035 §9 esc returns a string with no special characters unchanged', () => {
  assert.equal(esc('Brooklyn Costco 123 café'), 'Brooklyn Costco 123 café');
  assert.equal(esc(''), '');
});

// A hostile input, with the expected output written out by hand:
// < → &lt;, " → &quot;, ' → &#39;, > → &gt;, & → &amp;
test('D-035 §9 esc of a hostile tag and a trailing & gives the exact entity string', () => {
  assert.equal(
    esc(`<img src=x onerror="alert('x')">&`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;'
  );
});

test('D-035 §9 esc output has no raw <, >, " or \' for hostile inputs', () => {
  const hostile = [
    `<img src=x onerror="alert('x')">&`,
    `" onmouseover="steal()`,
    `'><script>alert(1)</script>`,
    `<<>>""''&&`,
  ];
  for (const h of hostile) {
    const out = esc(h);
    assert.doesNotMatch(out, /[<>"']/, `raw special character left in esc(${JSON.stringify(h)}) = ${out}`);
  }
});

// Load order and DOM-freedom.
test('D-035 §0 index.html lists insights.js and render.js after state.js and before app.js, in that order', () => {
  const order = scriptOrder();
  const at = (name) => order.findIndex((p) => p === `src/js/${name}`);
  const state = at('state.js');
  const insights = at('insights.js');
  const render = at('render.js');
  const app = at('app.js');
  for (const [name, i] of [['state.js', state], ['insights.js', insights], ['render.js', render], ['app.js', app]]) {
    assert.ok(i >= 0, `${name} is missing from index.html`);
  }
  assert.ok(state < insights, 'insights.js must come after state.js');
  assert.ok(insights < render, 'render.js must come after insights.js');
  assert.ok(render < app, 'render.js must come before app.js');
});

test('D-035 §0 loadApp() runs every script in the DOM-less VM without throwing', () => {
  let sb;
  assert.doesNotThrow(() => { sb = loadApp(); });
  assert.equal(typeof sb.POD, 'object');
});

test('D-035 §0 after loadApp(), POD.insights.build and POD.ui.render are functions', () => {
  const { POD } = loadApp();
  assert.equal(typeof POD.insights.build, 'function');
  assert.equal(typeof POD.ui.render, 'function');
});

// app.js is excluded on purpose: it is the boot file and attaches to document by design.
test('D-035 §0 insights.js and render.js do not touch document at load time (document throws on any access)', () => {
  const trap = new Proxy({}, {
    get() { throw new Error('document touched at load time'); },
    has() { throw new Error('document touched at load time'); },
    set() { throw new Error('document touched at load time'); },
    ownKeys() { throw new Error('document touched at load time'); },
    getPrototypeOf() { throw new Error('document touched at load time'); },
  });
  const upToRender = scriptOrder().filter((p) => p !== 'src/js/app.js');
  assert.ok(upToRender.includes('src/js/render.js') && upToRender.includes('src/js/insights.js'));
  let sb;
  assert.doesNotThrow(() => { sb = loadApp({ only: upToRender, globals: { document: trap } }); });
  assert.equal(typeof sb.POD.insights.build, 'function');
  assert.equal(typeof sb.POD.ui.render, 'function');
});
