// load.js — loads the app's scripts into a DOM-less VM, in the exact order
// index.html lists them, and returns the sandbox (sandbox.POD is the app).
//
// Why a VM and not require(): the shipped files are classic browser scripts
// that attach to a global. Running them the way a browser does means the
// tests exercise the real files with no test-only export boilerplate.
//
// The sandbox deliberately has no `document`, so any file that touches the
// DOM at load time fails here. That rule is what makes the engine testable.
//
//   const { loadApp } = require('../helpers/load');
//   const { POD } = loadApp();                       // every script
//   const { POD } = loadApp({ only: ['pod.js'] });   // a subset, in order
//   const { POD } = loadApp({ globals: { localStorage: fakeStorage } });

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(APP_ROOT, 'index.html');

/** Script paths (relative to the app root) in index.html order. */
function scriptOrder() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const out = [];
  const re = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.only]    basenames or relative paths to include (order still from index.html)
 * @param {object}   [opts.globals] extra globals to expose (localStorage, Date, ...)
 * @param {string[]} [opts.extra]   extra script paths (relative to app root) to run after, e.g. fixtures
 */
function loadApp(opts = {}) {
  let order = scriptOrder();
  if (opts.only) {
    const want = new Set(opts.only);
    order = order.filter((p) => want.has(p) || want.has(path.basename(p)));
    if (order.length !== want.size) {
      throw new Error(`loadApp: some of ${[...want].join(', ')} are not in index.html`);
    }
  }
  if (opts.extra) order = order.concat(opts.extra);

  const sandbox = Object.assign({ console }, opts.globals || {});
  sandbox.window = sandbox; // scripts use `window` as their root when it exists
  vm.createContext(sandbox);

  for (const rel of order) {
    const file = path.join(APP_ROOT, rel);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  return sandbox;
}

module.exports = { loadApp, scriptOrder, APP_ROOT };
