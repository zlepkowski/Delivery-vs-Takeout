// data.js — helpers for the data-schema tests.
//
//   const { loadData, haversineMi } = require('../helpers/data');
//   const D = loadData(['src/data/zips.js']);   // POD.data after pod.js + those files
//
// loadData throws 'missing <path>' when a data file doesn't exist yet, so a
// dataset test fails with a readable message instead of a VM stack trace.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadApp, APP_ROOT } = require('./load');

const EARTH_RADIUS_MI = 3958.8;

/** Runs pod.js plus the given app-relative files; returns POD.data. */
function loadData(relPaths) {
  for (const relPath of relPaths) {
    if (!fs.existsSync(path.join(APP_ROOT, relPath))) {
      throw new Error('missing ' + relPath);
    }
  }
  // structuredClone rebuilds the VM-realm data in this realm, so deepStrictEqual against [] or {} works.
  return structuredClone(loadApp({ only: ['pod.js'], extra: relPaths }).POD.data);
}

/** Great-circle distance in miles between two lat/lon points in degrees. */
function haversineMi(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = { loadData, haversineMi };
